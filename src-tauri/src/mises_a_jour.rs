//! Signed desktop updates and staged Android APK downloads. Only this repo's
//! published releases may be downloaded; no arbitrary installer paths/URLs.
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const REPO: &str = "flamme-demon/Sion-Client";
#[cfg(target_os = "android")]
const MAX_APK_SIZE: u64 = 512 * 1024 * 1024;

#[derive(Default)]
pub struct UpdateState {
    busy: AtomicBool,
    pending: Mutex<Option<Pending>>,
}
struct Pending {
    #[cfg(not(target_os = "android"))]
    tag: String,
    path: PathBuf,
    #[cfg(not(target_os = "android"))]
    update: tauri_plugin_updater::Update,
    #[cfg(not(target_os = "android"))]
    digest: Vec<u8>,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl UpdateState {
    fn begin(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Une mise à jour est déjà en cours.".to_string())?;
        Ok(Busy(&self.busy))
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    tag: String,
    downloaded: u64,
    total: Option<u64>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}

fn validate_tag(tag: &str, current: &semver::Version) -> Result<semver::Version, String> {
    let version =
        semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag)).map_err(|e| e.to_string())?;
    if !version.cmp_precedence(current).is_gt() {
        return Err("Cette version n'est pas plus récente que Sion.".into());
    }
    Ok(version)
}
fn asset_url(tag: &str, name: &str) -> Result<reqwest::Url, String> {
    if name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Nom d'artefact invalide.".into());
    }
    let mut url =
        reqwest::Url::parse(&format!("https://github.com/{REPO}/releases/download/")).unwrap();
    url.path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .push(tag)
        .push(name);
    Ok(url)
}
fn check_asset_url(tag: &str, asset: &Asset) -> Result<reqwest::Url, String> {
    let expected = asset_url(tag, &asset.name)?;
    let actual = reqwest::Url::parse(&asset.browser_download_url).map_err(|e| e.to_string())?;
    if actual != expected {
        return Err("Le téléchargement ne provient pas de la release Sion.".into());
    }
    Ok(actual)
}

#[tauri::command]
pub fn update_platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

#[tauri::command]
pub async fn update_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
    tag: String,
) -> Result<String, String> {
    let _busy = state.begin()?;
    let version = validate_tag(&tag, &app.package_info().version)?;
    #[cfg(target_os = "android")]
    let _ = version;
    #[cfg(target_os = "linux")]
    {
        let path = PathBuf::from(
            app.env()
                .appimage
                .ok_or("L'installation automatique nécessite la version AppImage de Sion.")?,
        );
        let parent = path.parent().ok_or("Dossier de l'AppImage introuvable.")?;
        let probe = parent.join(format!(".sion-update-probe-{}", std::process::id()));
        std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)
            .map_err(|_| "Le dossier de l'AppImage est protégé. Télécharge la mise à jour manuellement ou déplace Sion dans un dossier personnel.".to_string())?;
        std::fs::remove_file(probe).map_err(|e| e.to_string())?;
    }
    let client = reqwest::Client::builder()
        .user_agent("Sion-Client-updater")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let release: Release = client
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases/tags/{tag}"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if release.draft || release.tag_name != tag {
        return Err("Release non publiée ou incohérente.".into());
    }
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let part = folder.join("package.part");
    let mut downloaded = 0_u64;
    let mut last_event = Instant::now() - Duration::from_secs(1);
    let mut progress = |chunk: usize, total: Option<u64>| {
        downloaded += chunk as u64;
        if last_event.elapsed() >= Duration::from_millis(150) {
            let _ = app.emit(
                "sion-update-progress",
                Progress {
                    tag: tag.clone(),
                    downloaded,
                    total,
                },
            );
            last_event = Instant::now();
        }
    };
    #[cfg(not(target_os = "android"))]
    let pending = {
        use tauri_plugin_updater::UpdaterExt;
        let manifest = release
            .assets
            .iter()
            .find(|a| a.name == "updater.json")
            .ok_or("Cette ancienne release nécessite un téléchargement manuel.")?;
        let endpoint = check_asset_url(&tag, manifest)?;
        let update = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|e| e.to_string())?
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Aucune mise à jour compatible disponible.")?;
        if update.version != version.to_string() {
            return Err("Version incohérente dans le manifeste de mise à jour.".into());
        }
        let asset = release
            .assets
            .iter()
            .find(|a| {
                reqwest::Url::parse(&a.browser_download_url).ok().as_ref()
                    == Some(&update.download_url)
            })
            .ok_or("Le paquet signé ne figure pas dans la release Sion.")?;
        check_asset_url(&tag, asset)?;
        // Tauri verifies the signature before we stage anything installable.
        let bytes = update
            .download(&mut progress, || {})
            .await
            .map_err(|e| e.to_string())?;
        let path = folder.join("package.bin");
        use sha2::Digest;
        let digest = sha2::Sha256::digest(&bytes).to_vec();
        std::fs::write(&part, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
        Pending {
            tag: tag.clone(),
            path,
            update,
            digest,
        }
    };
    #[cfg(target_os = "android")]
    let pending = {
        use std::io::Write;
        if std::env::consts::ARCH != "aarch64" {
            return Err("Aucun APK compatible avec cette architecture.".into());
        }
        let apk = release
            .assets
            .iter()
            .find(|a| {
                let name = a.name.to_lowercase();
                name.ends_with(".apk")
                    && (name.contains("arm64")
                        || name.contains("aarch64")
                        || name.contains("universal"))
            })
            .ok_or("Cette release ne contient pas d'APK compatible.")?;
        let mut response = client
            .get(check_asset_url(&tag, apk)?)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = response.content_length();
        if total.is_some_and(|size| size > MAX_APK_SIZE) {
            return Err("APK trop volumineux.".into());
        }
        let result: Result<(), String> = async {
            let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
            let mut size = 0_u64;
            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                size += chunk.len() as u64;
                if size > MAX_APK_SIZE {
                    return Err("APK trop volumineux.".into());
                }
                file.write_all(&chunk).map_err(|e| e.to_string())?;
                progress(chunk.len(), total);
            }
            file.sync_all().map_err(|e| e.to_string())?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let _ = std::fs::remove_file(&part);
            return Err(error);
        }
        let path = folder.join("package.apk");
        std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
        Pending { path }
    };
    let path = pending.path.to_string_lossy().into_owned();
    *state.pending.lock().map_err(|e| e.to_string())? = Some(pending);
    let _ = app.emit(
        "sion-update-progress",
        Progress {
            tag,
            downloaded,
            total: Some(downloaded),
        },
    );
    Ok(path)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, tag: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<UpdateState>();
        let _busy = state.begin()?;
        let guard = state.pending.lock().map_err(|e| e.to_string())?;
        let pending = guard
            .as_ref()
            .filter(|p| p.tag == tag)
            .ok_or("Télécharge d'abord cette mise à jour.")?;
        let bytes = std::fs::read(&pending.path).map_err(|e| e.to_string())?;
        use sha2::Digest;
        if sha2::Sha256::digest(&bytes).to_vec() != pending.digest {
            return Err("Le paquet téléchargé a été modifié. Télécharge-le à nouveau.".into());
        }
        #[cfg(target_os = "linux")]
        {
            // Keep a recoverable copy even if the machine loses power mid-update.
            let path = PathBuf::from(app.env().appimage.ok_or("AppImage introuvable.")?);
            let backup = path.with_extension("AppImage.previous");
            std::fs::copy(path, backup)
                .map_err(|e| format!("Sauvegarde de l'AppImage impossible : {e}"))?;
        }
        #[cfg(not(target_os = "android"))]
        {
            use tauri_plugin_window_state::{AppHandleExt, StateFlags};
            let _ = app.save_window_state(StateFlags::all());
        }
        pending.update.install(bytes).map_err(|e| e.to_string())?;
        app.restart();
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_downgrades_and_paths_in_tags() {
        let current = semver::Version::parse("2.0.0-beta.7").unwrap();
        for tag in [
            "v2.0.0-beta.6",
            "2.0.0-beta.7",
            "../evil",
            "v2.0.0-beta.01",
            "2.0.0-beta.7+build.2",
        ] {
            assert!(validate_tag(tag, &current).is_err());
        }
        assert!(validate_tag("v2.0.0-beta.10", &current).is_ok());
        assert!(validate_tag("v2.0.0", &current).is_ok());
    }
    #[test]
    fn rejects_artifacts_outside_the_release() {
        let asset = Asset {
            name: "Sion.exe".into(),
            browser_download_url: "https://evil.example/Sion.exe".into(),
        };
        assert!(check_asset_url("v2.0.0", &asset).is_err());
        assert!(asset_url("v2.0.0", "../Sion.exe").is_err());
        assert_eq!(
            asset_url("v2.0.0", "Sion.exe").unwrap().as_str(),
            "https://github.com/flamme-demon/Sion-Client/releases/download/v2.0.0/Sion.exe"
        );
    }
}
