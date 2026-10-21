//! Diagnostic local, activé dans les réglages avancés. La capture d'un crash
//! natif Windows est confiée à WER : le processus peut avoir son tas corrompu.
use std::sync::atomic::{AtomicBool, Ordering};

static ACTIF: AtomicBool = AtomicBool::new(false);

pub fn actif() -> bool {
    ACTIF.load(Ordering::Relaxed)
}

fn module_sion(cible: &str) -> bool {
    ["app_lib", "sion_matrix"].iter().any(|prefixe| {
        cible == *prefixe
            || cible
                .strip_prefix(prefixe)
                .is_some_and(|suite| suite.starts_with("::"))
    })
}

pub fn filtrer(meta: &log::Metadata<'_>) -> bool {
    meta.level() <= log::Level::Info
        || (actif() && module_sion(meta.target()) && meta.level() <= log::Level::Debug)
}

/// Un échec d'eval JavaScript est journalisé par tauri_runtime_wry. Lui
/// renvoyer son erreur dans la même webview crée une boucle sans fin.
pub fn vers_console(meta: &log::Metadata<'_>) -> bool {
    module_sion(meta.target()) && (cfg!(debug_assertions) || meta.level() <= log::Level::Warn)
}

#[cfg(not(target_os = "android"))]
mod bureau {
    use super::*;
    use std::fs::{self, File};
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicU64;
    use std::sync::{Condvar, Mutex, Once};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use serde::{Deserialize, Serialize};
    use tauri::Manager;

    use crate::TauriRuntime;

    static MODIFICATION: Mutex<()> = Mutex::new(());
    static EXPORT: AtomicBool = AtomicBool::new(false);
    static EXPIRE_A: AtomicU64 = AtomicU64::new(0);
    static SURVEILLANCE: Once = Once::new();
    static REVEIL: (Mutex<Option<Instant>>, Condvar) = (Mutex::new(None), Condvar::new());
    const CONFIG: &str = "diagnostic.json";

    fn maintenant() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    #[derive(Default, Deserialize, Serialize)]
    struct Configuration {
        actif: bool,
        #[serde(default)]
        expire_a: u64,
    }

    #[derive(Serialize)]
    pub struct EtatDiagnostic {
        actif: bool,
        expire_a: u64,
        plateforme: &'static str,
        capture_disponible: bool,
        capture_active: bool,
        capture_erreur: Option<String>,
        rapports: usize,
        taille_rapports: u64,
    }

    fn dossier_crashs(app: &tauri::AppHandle<TauriRuntime>) -> Result<PathBuf, String> {
        Ok(app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("CrashDumps"))
    }

    /// Fichiers ordinaires seulement, sans suivre de liens ni parcourir les
    /// données de session. Les noms d'archive sont composés par le backend.
    fn fichiers(
        dossier: &Path,
        extension: &str,
    ) -> Result<Vec<(PathBuf, u64, SystemTime)>, String> {
        let entries = match fs::read_dir(dossier) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.to_string()),
        };
        let mut fichiers = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file()
                || !path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
            {
                continue;
            }
            fichiers.push((path, meta.len(), meta.modified().unwrap_or(UNIX_EPOCH)));
        }
        fichiers.sort_by_key(|(_, _, date)| std::cmp::Reverse(*date));
        Ok(fichiers)
    }

    fn etat(app: &tauri::AppHandle<TauriRuntime>) -> Result<EtatDiagnostic, String> {
        let rapports = fichiers(&dossier_crashs(app)?, "dmp")?;
        #[cfg(target_os = "linux")]
        let systeme = crate::diagnostic_linux::lister();
        Ok(EtatDiagnostic {
            actif: actif(),
            expire_a: EXPIRE_A.load(Ordering::Relaxed),
            plateforme: std::env::consts::OS,
            #[cfg(target_os = "linux")]
            capture_disponible: systeme.disponible,
            #[cfg(not(target_os = "linux"))]
            capture_disponible: cfg!(target_os = "windows"),
            #[cfg(target_os = "windows")]
            capture_active: crate::diagnostic_windows::capture_active(),
            #[cfg(target_os = "linux")]
            capture_active: systeme.disponible,
            #[cfg(not(any(target_os = "windows", target_os = "linux")))]
            capture_active: false,
            #[cfg(target_os = "linux")]
            capture_erreur: systeme.erreur,
            #[cfg(not(target_os = "linux"))]
            capture_erreur: None,
            #[cfg(target_os = "linux")]
            rapports: rapports.len() + systeme.rapports.len(),
            #[cfg(not(target_os = "linux"))]
            rapports: rapports.len(),
            #[cfg(target_os = "linux")]
            taille_rapports: rapports.iter().map(|(_, taille, _)| taille).sum::<u64>()
                + systeme.rapports.iter().map(|r| r.taille).sum::<u64>(),
            #[cfg(not(target_os = "linux"))]
            taille_rapports: rapports.iter().map(|(_, taille, _)| taille).sum(),
        })
    }

    pub fn initialiser(app: &tauri::AppHandle<TauriRuntime>) {
        let config = app
            .path()
            .app_local_data_dir()
            .ok()
            .and_then(|dir| fs::read(dir.join(CONFIG)).ok())
            .and_then(|data| serde_json::from_slice::<Configuration>(&data).ok())
            .unwrap_or_default();
        let restant = config.expire_a.saturating_sub(maintenant()).min(3600);
        EXPIRE_A.store(
            if config.actif && restant > 0 {
                maintenant() + restant
            } else {
                0
            },
            Ordering::Relaxed,
        );
        ACTIF.store(config.actif && restant > 0, Ordering::Relaxed);
        *REVEIL.0.lock().unwrap_or_else(|e| e.into_inner()) =
            (config.actif && restant > 0).then(|| Instant::now() + Duration::from_secs(restant));
    }

    pub fn demarrer(app: &tauri::AppHandle<TauriRuntime>) {
        let ancien = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            log::error!(
                "[Sion][panic] {info}\n{}",
                std::backtrace::Backtrace::force_capture()
            );
            log::logger().flush();
            ancien(info);
        }));
        log::info!(
            "[Sion][demarrage] version={} pid={} os={} arch={} diagnostic={}",
            app.package_info().version,
            std::process::id(),
            std::env::consts::OS,
            std::env::consts::ARCH,
            actif()
        );
        if actif() {
            surveiller();
        }
    }

    fn surveiller() {
        SURVEILLANCE.call_once(|| { std::thread::spawn(|| {
            let mut garde = REVEIL.0.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                while !actif() { garde = REVEIL.1.wait(garde).unwrap_or_else(|e| e.into_inner()); }
                let restant = garde.map(|fin| fin.saturating_duration_since(Instant::now())).unwrap_or_default();
                if restant.is_zero() {
                    ACTIF.store(false, Ordering::Relaxed);
                    EXPIRE_A.store(0, Ordering::Relaxed);
                    log::set_max_level(log::LevelFilter::Info);
                    log::info!("[Sion][diagnostic] fin automatique des journaux détaillés après une heure");
                    continue;
                }
                let (retour, delai) = REVEIL.1.wait_timeout(garde, restant.min(Duration::from_secs(30)))
                    .unwrap_or_else(|e| e.into_inner());
                garde = retour;
                if delai.timed_out() && actif() {
                    log::debug!("[Sion][diagnostic] pid={} memoire_residente_octets={:?}", std::process::id(), memoire_residente());
                }
            }
        }); });
    }

    fn memoire_residente() -> Option<u64> {
        #[cfg(target_os = "linux")]
        {
            let status = fs::read_to_string("/proc/self/status").ok()?;
            return status.lines().find_map(|ligne| {
                ligne
                    .strip_prefix("VmRSS:")?
                    .split_whitespace()
                    .next()?
                    .parse::<u64>()
                    .ok()?
                    .checked_mul(1024)
            });
        }
        #[cfg(target_os = "windows")]
        {
            return crate::diagnostic_windows::memoire_residente();
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        None
    }

    #[tauri::command]
    pub async fn diagnostic_etat(
        app: tauri::AppHandle<TauriRuntime>,
    ) -> Result<EtatDiagnostic, String> {
        tauri::async_runtime::spawn_blocking(move || etat(&app))
            .await
            .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn diagnostic_configurer(
        app: tauri::AppHandle<TauriRuntime>,
        active: bool,
    ) -> Result<EtatDiagnostic, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let _garde = MODIFICATION.lock().map_err(|e| e.to_string())?;
            let config = app
                .path()
                .app_local_data_dir()
                .map_err(|e| e.to_string())?
                .join(CONFIG);
            let expire_a = if active { maintenant() + 3600 } else { 0 };
            crate::write_private_file_atomic(
                &config,
                &serde_json::to_vec(&Configuration {
                    actif: active,
                    expire_a,
                })
                .map_err(|e| e.to_string())?,
            )?;
            let mut garde = REVEIL.0.lock().map_err(|e| e.to_string())?;
            *garde = active.then(|| Instant::now() + Duration::from_secs(3600));
            EXPIRE_A.store(expire_a, Ordering::Relaxed);
            ACTIF.store(active, Ordering::Relaxed);
            log::set_max_level(if active {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            });
            drop(garde);
            if active {
                surveiller();
            }
            REVEIL.1.notify_one();
            log::info!(
                "[Sion][diagnostic] journaux détaillés {} expire_a={expire_a}",
                if active { "activés" } else { "désactivés" }
            );
            etat(&app)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[cfg(target_os = "windows")]
    #[tauri::command]
    pub async fn diagnostic_configurer_capture(
        app: tauri::AppHandle<TauriRuntime>,
        active: bool,
    ) -> Result<EtatDiagnostic, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let _garde = MODIFICATION.lock().map_err(|e| e.to_string())?;
            {
                fs::create_dir_all(dossier_crashs(&app)?).map_err(|e| e.to_string())?;
                crate::diagnostic_windows::configurer(active)?;
            }
            etat(&app)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn diagnostic_ouvrir_dossier(
        app: tauri::AppHandle<TauriRuntime>,
        crashs: bool,
    ) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || {
            let path = if crashs {
                dossier_crashs(&app)?
            } else {
                app.path().app_log_dir().map_err(|e| e.to_string())?
            };
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            open::that_detached(path).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    fn exporter(
        app: &tauri::AppHandle<TauriRuntime>,
        destination: &Path,
        inclure_crashs: bool,
    ) -> Result<String, String> {
        // Un fichier en cours d'écriture est lu à la taille relevée avant
        // l'export : le journal ne peut pas allonger la copie à l'infini.
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let partiel =
            destination.with_extension(format!("zip.partiel-{}-{nonce}", std::process::id()));
        let resultat = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut zip = zip::ZipWriter::new(options.open(&partiel).map_err(|e| e.to_string())?);
            let compression = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .large_file(true);
            let mut inclus = Vec::new();
            #[cfg(target_os = "linux")]
            let _copies = if inclure_crashs {
                Some(crate::diagnostic_linux::extraire()?)
            } else {
                None
            };
            #[cfg(target_os = "linux")]
            let cores = if let Some(copies) = &_copies {
                fichiers(&copies.0, "core")?
            } else {
                Vec::new()
            };
            #[cfg(not(target_os = "linux"))]
            let cores = Vec::new();
            // Relever les tailles après l'extraction des cores, qui peut
            // prendre du temps : le journal a pu tourner entre-temps.
            let journaux = fichiers(&app.path().app_log_dir().map_err(|e| e.to_string())?, "log")?;
            let crashs = if inclure_crashs {
                fichiers(&dossier_crashs(app)?, "dmp")?
            } else {
                Vec::new()
            };
            for (prefixe, liste, maximum) in [
                ("journaux", &journaux, 3),
                ("crashs", &crashs, 2),
                ("crashs", &cores, 2),
            ] {
                for (path, taille, _) in liste.iter().take(maximum) {
                    if *taille == 0 {
                        continue;
                    }
                    let nom = format!(
                        "{prefixe}/{}",
                        path.file_name()
                            .ok_or("Nom de fichier invalide")?
                            .to_string_lossy()
                    );
                    let fichier = File::open(path).map_err(|e| format!("{nom} : {e}"))?;
                    zip.start_file(&nom, compression)
                        .map_err(|e| e.to_string())?;
                    let copie = std::io::copy(&mut fichier.take(*taille), &mut zip)
                        .map_err(|e| e.to_string())?;
                    if copie != *taille {
                        return Err(format!("{nom} a changé pendant l'export. Réessayer."));
                    }
                    inclus.push(nom);
                }
            }
            let rapport = serde_json::json!({
                "format": "sion-diagnostic", "schema": 1,
                "version": app.package_info().version.to_string(),
                "systeme": std::env::consts::OS, "architecture": std::env::consts::ARCH,
                "pid": std::process::id(), "memoire_residente_octets": memoire_residente(),
                "date_unix": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
                "diagnostic": etat(app)?, "fichiers": inclus,
            });
            zip.start_file("diagnostic.json", compression)
                .map_err(|e| e.to_string())?;
            zip.write_all(&serde_json::to_vec_pretty(&rapport).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let fichier = zip.finish().map_err(|e| e.to_string())?;
            fichier.sync_all().map_err(|e| e.to_string())?;
            drop(fichier);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::ffi::OsStrExt;
                use windows::Win32::Storage::FileSystem::{
                    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
                };
                let from: Vec<u16> = partiel.as_os_str().encode_wide().chain(Some(0)).collect();
                let to: Vec<u16> = destination
                    .as_os_str()
                    .encode_wide()
                    .chain(Some(0))
                    .collect();
                unsafe {
                    MoveFileExW(
                        windows_core::PCWSTR(from.as_ptr()),
                        windows_core::PCWSTR(to.as_ptr()),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                }
                .map_err(|e| e.to_string())?;
            }
            #[cfg(not(target_os = "windows"))]
            fs::rename(&partiel, destination).map_err(|e| e.to_string())?;
            Ok(destination.to_string_lossy().into_owned())
        })();
        if resultat.is_err() {
            let _ = fs::remove_file(&partiel);
        }
        resultat
    }

    #[tauri::command]
    pub async fn diagnostic_exporter(
        app: tauri::AppHandle<TauriRuntime>,
        inclure_crashs: bool,
    ) -> Result<Option<String>, String> {
        if EXPORT.swap(true, Ordering::AcqRel) {
            return Err("Un export est déjà en cours.".into());
        }
        struct Garde;
        impl Drop for Garde {
            fn drop(&mut self) {
                EXPORT.store(false, Ordering::Release);
            }
        }
        let _garde = Garde;
        let date = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let Some(fichier) = rfd::AsyncFileDialog::new()
            .set_title("Exporter un diagnostic Sion")
            .set_file_name(format!(
                "sion-diagnostic-{}-{date}.zip",
                app.package_info().version
            ))
            .add_filter("Diagnostic Sion (ZIP)", &["zip"])
            .save_file()
            .await
        else {
            return Ok(None);
        };
        let mut destination = fichier.path().to_path_buf();
        if !destination
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
        {
            destination.set_extension("zip");
        }
        tauri::async_runtime::spawn_blocking(move || exporter(&app, &destination, inclure_crashs))
            .await
            .map_err(|e| e.to_string())?
            .map(Some)
    }
}

#[cfg(not(target_os = "android"))]
pub use bureau::*;
