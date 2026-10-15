//! Run one link probe at a time; superseded or cancelled requests cannot
//! start later. Share bounded version checks instead of starting two
//! yt-dlp processes from the settings panel.
use std::collections::VecDeque;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};

struct Requests {
    current: Option<(String, Arc<AtomicBool>)>,
    cancelled: VecDeque<String>,
}
static REQUESTS: Mutex<Requests> = Mutex::new(Requests {
    current: None,
    cancelled: VecDeque::new(),
});
static PROBE_GATE: Mutex<()> = Mutex::new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

pub(crate) struct ProbeLease {
    id: String,
    cancel: Arc<AtomicBool>,
}
pub(crate) fn reserve(request_id: Option<String>) -> Result<ProbeLease, String> {
    let id =
        request_id.unwrap_or_else(|| format!("native-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));
    if id.len() > 128 || id.is_empty() {
        return Err("Identifiant d'analyse invalide".into());
    }
    let mut requests = REQUESTS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(index) = requests.cancelled.iter().position(|s| s == &id) {
        requests.cancelled.remove(index);
        return Err("Analyse annulée".into());
    }
    if let Some((_, previous)) = requests.current.take() {
        previous.store(true, Ordering::Release);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    requests.current = Some((id.clone(), cancel.clone()));
    Ok(ProbeLease { id, cancel })
}

pub(crate) fn cancel(id: String) {
    if id.len() > 128 {
        return;
    }
    let mut requests = REQUESTS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((current, flag)) = requests.current.as_ref() {
        if current == &id {
            flag.store(true, Ordering::Release);
            return;
        }
    }
    // Cancellation can reach Rust before the start command.
    if requests.cancelled.len() == 128 {
        requests.cancelled.pop_front();
    }
    requests.cancelled.push_back(id);
}

impl Drop for ProbeLease {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        let mut requests = REQUESTS.lock().unwrap_or_else(|e| e.into_inner());
        if requests
            .current
            .as_ref()
            .is_some_and(|(_, flag)| Arc::ptr_eq(flag, &self.cancel))
        {
            requests.current = None;
        }
    }
}

pub(crate) fn run(command: &mut Command, lease: ProbeLease) -> Result<Output, String> {
    let _gate = PROBE_GATE.lock().unwrap_or_else(|e| e.into_inner());
    if lease.cancel.load(Ordering::Acquire) {
        return Err("Analyse annulée".into());
    }
    log::info!(
        "[Sion][yt-dlp] analyse {} démarrée (délai maximal 60 s)",
        lease.id
    );
    let out = crate::process_output::output(command, Duration::from_secs(60), &lease.cancel);
    log::info!(
        "[Sion][yt-dlp] analyse {} terminée : {}",
        lease.id,
        if out.is_ok() {
            "processus libérés"
        } else {
            "annulée ou échouée, processus libérés"
        }
    );
    out
}

struct VersionEntry {
    bin: String,
    stamp: Option<SystemTime>,
    checked: Instant,
    version: Option<String>,
}
static VERSION: LazyLock<Mutex<Option<VersionEntry>>> = LazyLock::new(|| Mutex::new(None));

pub(crate) fn version(bin: &str) -> Option<String> {
    // Holding the lock through the check shares concurrent calls from
    // detect_ytdlp and ytdlp_versions instead of starting two bootloaders.
    let mut cache = VERSION.lock().unwrap_or_else(|e| e.into_inner());
    let stamp = std::fs::metadata(bin).ok().and_then(|m| m.modified().ok());
    if let Some(entry) = cache.as_ref() {
        let ttl = if entry.version.is_some() {
            Duration::from_secs(30)
        } else {
            Duration::from_secs(2)
        };
        if entry.bin == bin && entry.stamp == stamp && entry.checked.elapsed() < ttl {
            return entry.version.clone();
        }
    }
    let mut command = crate::hidden_command(bin);
    command.arg("--version");
    let version = crate::process_output::output(
        &mut command,
        Duration::from_secs(10),
        &AtomicBool::new(false),
    )
    .ok()
    .filter(|out| out.status.success())
    .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
    .filter(|s| !s.is_empty());
    *cache = Some(VersionEntry {
        bin: bin.into(),
        stamp,
        checked: Instant::now(),
        version: version.clone(),
    });
    version
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaced_or_closed_requests_cannot_start_and_old_cleanup_does_not_cancel_new() {
        let _test = crate::process_output::TEST_GATE.lock().unwrap();
        let first = reserve(Some("first".into())).unwrap();
        let next = reserve(Some("next".into())).unwrap();
        assert!(first.cancel.load(Ordering::Acquire));
        drop(first);
        assert!(!next.cancel.load(Ordering::Acquire));
        cancel("next".into());
        assert!(next.cancel.load(Ordering::Acquire));
        drop(next);
        cancel("not-started".into());
        assert!(reserve(Some("not-started".into())).is_err());
        assert!(REQUESTS.lock().unwrap().current.is_none());
    }
    #[test]
    fn twenty_retries_do_not_leave_twenty_hanging_processes() {
        let _test = crate::process_output::TEST_GATE.lock().unwrap();
        let mut workers = Vec::new();
        for n in 0..20 {
            let lease = reserve(Some(format!("retry-{n}"))).unwrap();
            workers.push(std::thread::spawn(move || {
                let mut command = Command::new(std::env::current_exe().unwrap());
                command
                    .args([
                        "--exact",
                        "process_output::tests::child_fixture",
                        "--ignored",
                        "--nocapture",
                    ])
                    .env("SION_PROCESS_TEST_MODE", "hang");
                run(&mut command, lease)
            }));
            if n == 0 {
                let start = Instant::now();
                while crate::process_output::active_count() == 0
                    && start.elapsed() < Duration::from_secs(5)
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                assert_eq!(crate::process_output::active_count(), 1);
            }
            assert!(crate::process_output::active_count() <= 1);
        }
        cancel("retry-19".into());
        for worker in workers {
            assert!(worker.join().unwrap().is_err());
        }
        assert_eq!(crate::process_output::active_count(), 0);
        assert!(REQUESTS.lock().unwrap().current.is_none());
    }
    #[cfg(unix)]
    #[test]
    fn concurrent_version_checks_share_one_process() {
        use std::os::unix::fs::PermissionsExt;
        let _test = crate::process_output::TEST_GATE.lock().unwrap();
        let path =
            std::env::temp_dir().join(format!("sion-ytdlp-version-test-{}", std::process::id()));
        let count = path.with_extension("count");
        let _ = std::fs::remove_file(&count);
        std::fs::write(
            &path,
            format!(
                "#!/bin/sh\nprintf x >> '{}'\nprintf '2026.10.14\\n'\n",
                count.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let bin = path.to_string_lossy().into_owned();
                std::thread::spawn(move || version(&bin))
            })
            .collect();
        for worker in workers {
            assert_eq!(worker.join().unwrap().as_deref(), Some("2026.10.14"));
        }
        assert_eq!(std::fs::read(&count).unwrap(), b"x");
        assert_eq!(crate::process_output::active_count(), 0);
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(count);
    }
}
