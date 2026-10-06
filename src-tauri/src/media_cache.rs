//! Cache disque des médias : LRU, expiration et protection des lecteurs.
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, FileTimes};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

pub const MAX_BYTES: u64 = 250 * 1024 * 1024;
pub const MAX_AGE: Duration = Duration::from_secs(24 * 3600);

#[derive(Default)]
struct State {
    readers: HashMap<PathBuf, usize>,
    remove_on_release: HashSet<PathBuf>,
}

pub struct Cache {
    dir: PathBuf,
    state: Mutex<State>,
}

pub struct Reader {
    cache: Arc<Cache>,
    path: PathBuf,
}

impl Cache {
    pub fn new(dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { dir, state: Mutex::new(State::default()) })
    }

    pub fn retain(self: &Arc<Self>, path: PathBuf) -> Reader {
        let mut state = self.state.lock().unwrap();
        *state.readers.entry(path.clone()).or_default() += 1;
        // Les requêtes par plage ne doivent pas provoquer une écriture disque
        // chacune : une actualisation par minute suffit pour l'ordre LRU.
        if let Ok(file) = File::open(&path) {
            if file.metadata().and_then(|m| m.modified()).ok()
                .and_then(|t| t.elapsed().ok()).is_some_and(|age| age >= Duration::from_secs(60)) {
                let _ = file.set_times(FileTimes::new().set_modified(SystemTime::now()));
            }
        }
        Reader { cache: Arc::clone(self), path }
    }

    /// Les fichiers retenus restent comptés dans le budget. Un fichier trop
    /// gros actuellement lu peut dépasser le budget jusqu'à sa libération.
    pub fn prune(&self, age_max: Duration, max_bytes: u64) -> (usize, u64) {
        let state = self.state.lock().unwrap();
        self.prune_locked(&state, age_max, max_bytes)
    }

    fn prune_locked(&self, state: &State, age_max: Duration, max_bytes: u64) -> (usize, u64) {
        let Ok(entries) = fs::read_dir(&self.dir) else { return (0, 0) };
        let now = SystemTime::now();
        let mut files: Vec<_> = entries.flatten().filter_map(|entry| {
            // Ne suit jamais de lien symbolique ni de sous-dossier.
            let meta = entry.path().symlink_metadata().ok()?;
            if !meta.is_file() { return None; }
            Some((entry.path(), meta.len(), meta.modified().unwrap_or(now)))
        }).collect();
        files.sort_by_key(|(_, _, date)| *date);
        let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
        let (mut count, mut freed) = (0, 0);
        for (path, size, date) in files {
            if state.readers.contains_key(&path) { continue; }
            let age = now.duration_since(date).unwrap_or_default();
            // Un dépôt/préparation est transmis entre plusieurs commandes
            // IPC : lui laisser le temps d'être envoyé, sans conserver les
            // anciens fichiers temporaires indéfiniment.
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            let preparing = !name.starts_with("sion_mx_") && age < Duration::from_secs(300);
            if preparing && max_bytes != 0 { continue; }
            if (age > age_max || total > max_bytes) && fs::remove_file(&path).is_ok() {
                count += 1;
                freed += size;
                total = total.saturating_sub(size);
            }
        }
        (count, freed)
    }

    pub fn clear(&self) -> (usize, u64) {
        let mut state = self.state.lock().unwrap();
        let paths: Vec<_> = state.readers.keys().cloned().collect();
        state.remove_on_release.extend(paths);
        self.prune_locked(&state, Duration::ZERO, 0)
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        let mut state = self.cache.state.lock().unwrap();
        if let Some(count) = state.readers.get_mut(&self.path) {
            *count -= 1;
            if *count == 0 {
                state.readers.remove(&self.path);
                if state.remove_on_release.remove(&self.path) {
                    let _ = fs::remove_file(&self.path);
                }
            }
        }
        // Dernière lecture terminée : l'éventuel dépassement peut être
        // résorbé. Aucun balayage pendant chaque requête d'un lecteur retenu.
        if !state.readers.contains_key(&self.path) {
            self.cache.prune_locked(&state, MAX_AGE, MAX_BYTES);
        }
    }
}

pub fn global() -> &'static Arc<Cache> {
    static CACHE: OnceLock<Arc<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Cache::new(crate::sion_media_dir()))
}

pub fn retain_path(path: &Path) -> Reader {
    global().retain(path.to_owned())
}

pub fn matrix_name(url: &str) -> Option<String> {
    let key = url.strip_prefix("sion-media://localhost/")
        .or_else(|| url.strip_prefix("http://sion-media.localhost/"))?
        .split('?').next()?;
    let hex = key.len() == 16 && key.bytes().all(|b| b.is_ascii_hexdigit());
    let plain = key.len() <= 512 && key.starts_with('m')
        && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    (hex || plain).then(|| format!("sion_mx_{key}"))
}

// Les baux IPC couvrent aussi les pauses entre deux requêtes HTTP.
fn leases() -> &'static Mutex<HashMap<u64, Reader>> {
    static LEASES: OnceLock<Mutex<HashMap<u64, Reader>>> = OnceLock::new();
    LEASES.get_or_init(Default::default)
}

pub fn acquire(url: &str) -> Option<u64> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let name = matrix_name(url)?;
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    leases().lock().unwrap().insert(id, retain_path(&crate::sion_media_dir().join(name)));
    Some(id)
}

pub fn release(id: u64) {
    let reader = leases().lock().unwrap().remove(&id);
    drop(reader);
}

pub fn release_all() {
    let readers = std::mem::take(&mut *leases().lock().unwrap());
    drop(readers);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(dir: &Path, name: &str, size: usize, age: u64) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, vec![0; size]).unwrap();
        File::open(&path).unwrap().set_times(FileTimes::new().set_modified(
            SystemTime::now() - Duration::from_secs(age)
        )).unwrap();
        path
    }

    #[test]
    fn eviction_lru_preserve_le_fichier_reconsulte() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let a = file(dir.path(), "sion_mx_a", 6, 120);
        let b = file(dir.path(), "sion_mx_b", 6, 90);
        drop(cache.retain(a.clone()));
        assert_eq!(cache.prune(MAX_AGE, 6), (1, 6));
        assert!(a.exists()); assert!(!b.exists());
    }

    #[test]
    fn lecteurs_comptes_et_proteges_meme_si_le_budget_est_depasse() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let a = file(dir.path(), "sion_mx_a", 9, 120);
        let b = file(dir.path(), "sion_mx_b", 3, 90);
        let reader = cache.retain(a.clone());
        assert_eq!(cache.prune(MAX_AGE, 8), (1, 3));
        assert!(a.exists()); assert!(!b.exists());
        drop(reader);
        cache.prune(MAX_AGE, 8);
        assert!(!a.exists());
    }

    #[test]
    fn purge_attend_le_dernier_lecteur_et_couvre_un_depot_encore_en_cours() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let path = dir.path().join("sion_mx_pending");
        let one = cache.retain(path.clone());
        let two = cache.retain(path.clone());
        cache.clear();
        fs::write(&path, b"late download").unwrap();
        drop(one); assert!(path.exists());
        drop(two); assert!(!path.exists());
    }

    #[test]
    fn expiration_et_purge_ne_touchent_pas_aux_autres_dossiers() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let old = file(dir.path(), "sion_mx_old", 4, 90_000);
        let fresh = file(dir.path(), "sion_mx_fresh", 3, 0);
        fs::create_dir(dir.path().join("crypto")).unwrap();
        fs::write(dir.path().join("crypto/keys"), b"keys").unwrap();
        assert_eq!(cache.prune(MAX_AGE, 100), (1, 4));
        assert!(!old.exists()); assert!(fresh.exists());
        assert_eq!(cache.clear(), (1, 3));
        assert!(dir.path().join("crypto/keys").exists());
    }

    #[test]
    fn preparation_recente_preservee_jusqua_la_purge_explicite() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path().to_owned());
        let upload = file(dir.path(), "sion_in_upload.mp4", 20, 0);
        assert_eq!(cache.prune(MAX_AGE, 1), (0, 0));
        assert!(upload.exists());
        assert_eq!(cache.clear(), (1, 20));
    }

    #[test]
    fn seules_les_adresses_du_protocole_peuvent_retenir_un_fichier() {
        assert_eq!(matrix_name("http://sion-media.localhost/00ff00ff00ff00ff"), Some("sion_mx_00ff00ff00ff00ff".into()));
        assert!(matrix_name("sion-media://localhost/mabc_-?vignette=1").is_some());
        assert!(matrix_name("http://sion-media.localhost/../../keys").is_none());
        assert!(matrix_name("https://example.test/video").is_none());
    }
}
