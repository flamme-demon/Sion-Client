//! One owned inference per engine, including TTS voice cloning and retries.
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum Engine {
    Tts,
    Summary,
}

#[derive(Default)]
struct Jobs {
    active: HashMap<Engine, (String, Arc<AtomicBool>)>,
    cancelled: VecDeque<(Engine, String)>,
}
static JOBS: LazyLock<Mutex<Jobs>> = LazyLock::new(|| Mutex::new(Jobs::default()));
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

pub(crate) struct InferenceJob {
    engine: Engine,
    id: String,
    cancel: Arc<AtomicBool>,
}

pub(crate) fn reserve(engine: Engine, request_id: Option<String>) -> Result<InferenceJob, String> {
    let id = request_id
        .unwrap_or_else(|| format!("inference-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));
    if id.is_empty() || id.len() > 128 {
        return Err("Identifiant de génération invalide".into());
    }
    let mut jobs = JOBS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(index) = jobs
        .cancelled
        .iter()
        .position(|(kind, previous)| *kind == engine && previous == &id)
    {
        jobs.cancelled.remove(index);
        return Err("Génération annulée".into());
    }
    if jobs.active.contains_key(&engine) {
        return Err("Une génération de ce moteur est déjà en cours".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.active.insert(engine, (id.clone(), cancel.clone()));
    Ok(InferenceJob { engine, id, cancel })
}

pub(crate) fn cancel(engine: Engine, id: String) {
    if id.is_empty() || id.len() > 128 {
        return;
    }
    let mut jobs = JOBS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((current, flag)) = jobs.active.get(&engine) {
        if current == &id {
            flag.store(true, Ordering::Release);
            return;
        }
    }
    // Cancellation may arrive before the generation command is dispatched.
    if jobs.cancelled.len() == 128 {
        jobs.cancelled.pop_front();
    }
    jobs.cancelled.push_back((engine, id));
}

impl InferenceJob {
    pub(crate) fn cancelled(&self) -> &AtomicBool {
        &self.cancel
    }
    pub(crate) fn ensure_active(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Acquire) {
            Err("Génération annulée".into())
        } else {
            Ok(())
        }
    }
}

impl Drop for InferenceJob {
    fn drop(&mut self) {
        let mut jobs = JOBS.lock().unwrap_or_else(|e| e.into_inner());
        if jobs
            .active
            .get(&self.engine)
            .is_some_and(|(_, flag)| Arc::ptr_eq(flag, &self.cancel))
        {
            jobs.active.remove(&self.engine);
        }
        log::info!("[Sion][inference] {:?} {} terminé", self.engine, self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn cancellation_reaps_the_process_before_the_engine_can_be_reserved_again() {
        let _test = crate::process_output::TEST_GATE.lock().unwrap();
        for n in 0..8 {
            let id = format!("live-model-{n}");
            let job = reserve(Engine::Tts, Some(id.clone())).unwrap();
            let (cleaned_tx, cleaned_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let worker = std::thread::spawn(move || {
                let mut command = std::process::Command::new(std::env::current_exe().unwrap());
                command
                    .args([
                        "--exact",
                        "process_output::tests::child_fixture",
                        "--ignored",
                        "--nocapture",
                    ])
                    .env("SION_PROCESS_TEST_MODE", "hang");
                let result = crate::process_output::output_with_limits(
                    &mut command,
                    Duration::from_secs(5),
                    job.cancelled(),
                    1024,
                    4096,
                );
                cleaned_tx.send(result.is_err()).unwrap();
                release_rx.recv().unwrap();
                drop(job);
            });
            let start = Instant::now();
            while crate::process_output::active_count() == 0
                && start.elapsed() < Duration::from_secs(3)
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            assert_eq!(crate::process_output::active_count(), 1);
            assert!(reserve(Engine::Tts, None).is_err());
            cancel(Engine::Tts, id);
            assert!(cleaned_rx.recv_timeout(Duration::from_secs(3)).unwrap());
            assert_eq!(crate::process_output::active_count(), 0);
            assert!(reserve(Engine::Tts, None).is_err());
            release_tx.send(()).unwrap();
            worker.join().unwrap();
            assert!(JOBS.lock().unwrap().active.is_empty());
        }
    }

    #[test]
    fn repeated_cancelled_jobs_keep_the_engine_reserved_until_process_cleanup() {
        let _test = crate::process_output::TEST_GATE.lock().unwrap();
        for n in 0..16 {
            let id = format!("tts-cycle-{n}");
            let job = reserve(Engine::Tts, Some(id.clone())).unwrap();
            cancel(Engine::Tts, "another-request".into());
            assert!(job.ensure_active().is_ok());
            cancel(Engine::Tts, id);
            assert!(job.ensure_active().is_err());
            assert!(reserve(Engine::Tts, None).is_err());
            let summary = reserve(Engine::Summary, None).unwrap();
            assert!(summary.ensure_active().is_ok());
            drop(summary);
            drop(job);
            assert!(JOBS.lock().unwrap().active.is_empty());
        }
        cancel(Engine::Summary, "cancel-before-start".into());
        assert!(reserve(Engine::Summary, Some("cancel-before-start".into())).is_err());
        assert!(JOBS.lock().unwrap().active.is_empty());
    }
}
