use crate::TauriRuntime;
use std::sync::{Arc, OnceLock};
use tauri::{
    ipc::{InvokeBody, Request},
    Manager,
};
pub fn control() -> Arc<sion_camera_effects::Control> {
    static CONTROL: OnceLock<Arc<sion_camera_effects::Control>> = OnceLock::new();
    CONTROL
        .get_or_init(|| Arc::new(sion_camera_effects::Control::default()))
        .clone()
}

#[tauri::command]
pub fn voice_native_camera_effects_available() -> bool {
    true
}
#[tauri::command]
pub fn voice_native_camera_effects_status() -> sion_camera_effects::Status {
    control()
        .status
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}
#[tauri::command]
pub async fn voice_native_camera_effects_set(
    settings: sion_camera_effects::Settings,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || control().configure(settings))
        .await
        .map_err(|e| e.to_string())?
}

/// Le fichier choisi traverse l'IPC une fois, en binaire, jamais en base64.
#[tauri::command]
pub async fn voice_native_camera_background_import(
    app: tauri::AppHandle<TauriRuntime>,
    request: Request<'_>,
) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Fichier de fond attendu.".into());
    };
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("Le fond doit peser moins de 40 Mo.".into());
    }
    let extension = request
        .headers()
        .get("x-sion-camera-extension")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let ffmpeg_path = request
        .headers()
        .get("x-sion-ffmpeg-path")
        .and_then(|h| h.to_str().ok())
        .map(str::to_owned);
    if !["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"].contains(&extension.as_str()) {
        return Err("Choisis une image, un GIF ou une vidéo MP4/WebM.".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use sha2::{Digest, Sha256};
        let folder = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("camera-backgrounds");
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let path = folder.join(format!("{}.{}", &hash[..24], extension));
        let animated = ["mp4", "webm", "mov"].contains(&extension.as_str());
        let target = if animated {
            path.with_extension("gif")
        } else {
            path.clone()
        };
        if !target.is_file() {
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            let result = if animated {
                #[cfg(not(target_os = "android"))]
                {
                    let ffmpeg = crate::resolve_ffmpeg(
                        ffmpeg_path.as_deref(),
                        crate::managed_ffmpeg_path(&app)
                            .as_ref()
                            .and_then(|p| p.to_str()),
                    );
                    let status = (|| {
                        let mut child = crate::hidden_command(&ffmpeg)
                            .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
                            .arg(&path)
                            .args([
                                "-t",
                                "6",
                                "-an",
                                "-vf",
                                "fps=10,scale=320:320:force_original_aspect_ratio=decrease",
                                "-loop",
                                "0",
                            ])
                            .arg(&target)
                            .stdin(std::process::Stdio::null())
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .spawn()
                            .map_err(|e| e.to_string())?;
                        let started = std::time::Instant::now();
                        loop {
                            match child.try_wait() {
                                Ok(Some(status)) => return Ok(status),
                                Ok(None)
                                    if started.elapsed() < std::time::Duration::from_secs(30) =>
                                {
                                    std::thread::sleep(std::time::Duration::from_millis(50))
                                }
                                result => {
                                    let _ = child.kill();
                                    let _ = child.wait();
                                    return Err(result
                                        .err()
                                        .map(|e| e.to_string())
                                        .unwrap_or_else(|| {
                                            "La conversion du fond vidéo a pris trop de temps."
                                                .into()
                                        }));
                                }
                            }
                        }
                    })();
                    status.and_then(|s| {
                        if s.success() {
                            Ok(())
                        } else {
                            Err("Cette vidéo ne peut pas servir de fond.".into())
                        }
                    })
                }
                #[cfg(target_os = "android")]
                {
                    let _ = &ffmpeg_path;
                    crate::camera_capture::normaliser_video(&path, &target)
                }
            } else {
                Ok(())
            };
            if animated {
                let _ = std::fs::remove_file(&path);
            }
            if let Err(error) = result {
                let _ = std::fs::remove_file(&target);
                return Err(error);
            }
        }
        if let Err(error) = sion_camera_effects::validate_background(&target) {
            let _ = std::fs::remove_file(&target);
            return Err(error);
        }
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
