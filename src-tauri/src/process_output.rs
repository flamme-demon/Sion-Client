//! Bounded subprocesses with owned process trees and pipe readers.
use std::collections::HashMap;
use std::io::{self, Read};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) struct ChildTree {
    pub child: Child,
    registration: Option<u64>,
    terminated: bool,
    #[cfg(windows)]
    job: windows_owner::Handle,
}

#[derive(Clone, Copy)]
struct TreeRef {
    active: bool,
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: usize,
}
struct Registry {
    next_id: u64,
    stopping: bool,
    trees: HashMap<u64, TreeRef>,
}
static REGISTRY: LazyLock<(Mutex<Registry>, Condvar)> = LazyLock::new(|| {
    (
        Mutex::new(Registry {
            next_id: 0,
            stopping: false,
            trees: HashMap::new(),
        }),
        Condvar::new(),
    )
});
static STOPPING: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(crate) static TEST_GATE: Mutex<()> = Mutex::new(());
#[cfg(test)]
pub(crate) fn active_count() -> usize {
    REGISTRY.0.lock().unwrap().trees.len()
}

#[cfg(unix)]
fn terminate_group(pid: u32) {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe {
        kill(-(pid as i32), 9);
    }
}

/// Stop registered process trees and wait for their owners before exit.
/// The registry owns neither Child handles nor Job Objects.
pub(crate) fn shutdown() {
    let (registry, changed) = &*REGISTRY;
    let mut registry = registry.lock().unwrap_or_else(|e| e.into_inner());
    registry.stopping = true;
    STOPPING.store(true, Ordering::Release);
    for tree in registry.trees.values_mut() {
        if !tree.active {
            continue;
        }
        #[cfg(unix)]
        terminate_group(tree.pid);
        #[cfg(windows)]
        windows_owner::terminate_raw(tree.job);
        tree.active = false;
    }
    while !registry.trees.is_empty() {
        registry = changed.wait(registry).unwrap_or_else(|e| e.into_inner());
    }
}

impl ChildTree {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        let job = windows_owner::prepare(command)?;
        let mut registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
        if registry.stopping {
            return Err(io::Error::other("application en cours de fermeture"));
        }
        let child = command.spawn()?;
        let mut tree = Self {
            child,
            registration: None,
            terminated: false,
            #[cfg(windows)]
            job,
        };
        #[cfg(windows)]
        windows_owner::attach_and_resume(&tree.job, &tree.child)?;
        registry.next_id += 1;
        let id = registry.next_id;
        registry.trees.insert(
            id,
            TreeRef {
                active: true,
                #[cfg(unix)]
                pid: tree.child.id(),
                #[cfg(windows)]
                job: tree.job.raw(),
            },
        );
        tree.registration = Some(id);
        Ok(tree)
    }

    /// Terminate descendants too, including the yt-dlp.exe bootloader and ffmpeg.
    pub fn terminate(&mut self) {
        if self.terminated {
            return;
        }
        self.terminated = true;
        let mut registry = self
            .registration
            .map(|_| REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner()));
        let active = self
            .registration
            .and_then(|id| registry.as_mut().and_then(|state| state.trees.get_mut(&id)))
            .map(|tree| {
                let active = tree.active;
                tree.active = false;
                active
            })
            .unwrap_or(true);
        if active {
            #[cfg(unix)]
            {
                // Create the group before exec; our application never attaches
                // unrelated processes to it.
                terminate_group(self.child.id());
            }
            #[cfg(windows)]
            windows_owner::terminate(&self.job);
        }
        drop(registry);
        // Fall back after partial initialization, before job assignment.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    pub fn wait(&mut self) -> io::Result<std::process::ExitStatus> {
        let status = self.child.wait()?;
        self.terminate();
        Ok(status)
    }

    pub fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
        let status = self.child.try_wait()?;
        if status.is_some() {
            self.terminate();
        }
        Ok(status)
    }
}

impl Drop for ChildTree {
    fn drop(&mut self) {
        self.terminate();
        if let Some(id) = self.registration.take() {
            REGISTRY
                .0
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .trees
                .remove(&id);
            REGISTRY.1.notify_all();
        }
    }
}

impl std::ops::Deref for ChildTree {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl std::ops::DerefMut for ChildTree {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}

/// Drain stdout/stderr continuously while retaining a bounded amount.
/// The deadline also covers pipe closure after the parent has exited.
pub(crate) fn output(
    command: &mut Command,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<Output, String> {
    output_inner(
        command,
        timeout,
        cancel,
        8 * 1024 * 1024,
        8 * 1024 * 1024,
        false,
    )
}

/// Keep the existing inference stdout cap and only the diagnostic stderr tail.
pub(crate) fn output_with_limits(
    command: &mut Command,
    timeout: Duration,
    cancel: &AtomicBool,
    stdout_limit: usize,
    stderr_tail_limit: usize,
) -> Result<Output, String> {
    output_inner(
        command,
        timeout,
        cancel,
        stdout_limit,
        stderr_tail_limit,
        true,
    )
}

fn output_inner(
    command: &mut Command,
    timeout: Duration,
    cancel: &AtomicBool,
    stdout_limit: usize,
    stderr_limit: usize,
    stderr_tail: bool,
) -> Result<Output, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("Opération annulée".into());
    }
    let mut tree = ChildTree::spawn(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .map_err(|e| e.to_string())?;
    let stdout = tree.child.stdout.take().ok_or("stdout absent")?;
    let stderr = tree.child.stderr.take().ok_or("stderr absent")?;
    let (done_tx, done_rx) = mpsc::channel();
    let too_large = Arc::new(AtomicBool::new(false));
    let spawn_reader = |name: &str, mut pipe: Box<dyn Read + Send>, limit: usize, tail: bool| {
        let done = done_tx.clone();
        let oversized = too_large.clone();
        thread::Builder::new().name(name.into()).spawn(move || {
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 8192];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tail {
                            bytes.extend_from_slice(&buffer[..n]);
                            if bytes.len() > limit {
                                bytes.drain(..bytes.len() - limit);
                            }
                        } else {
                            let remaining = limit.saturating_sub(bytes.len());
                            bytes.extend_from_slice(&buffer[..n.min(remaining)]);
                            if n > remaining {
                                oversized.store(true, Ordering::Release);
                            }
                        }
                    }
                }
            }
            let _ = done.send(());
            bytes
        })
    };
    let out_reader = spawn_reader("sion-process-stdout", Box::new(stdout), stdout_limit, false)
        .map_err(|e| e.to_string())?;
    let err_reader = match spawn_reader(
        "sion-process-stderr",
        Box::new(stderr),
        stderr_limit,
        stderr_tail,
    ) {
        Ok(reader) => reader,
        Err(e) => {
            tree.terminate();
            let _ = out_reader.join();
            return Err(e.to_string());
        }
    };
    drop(done_tx);
    let started = Instant::now();
    let mut finished_readers = 0;
    let mut status = None;
    let issue = loop {
        if cancel.load(Ordering::Acquire) || STOPPING.load(Ordering::Acquire) {
            break Some("Opération annulée".to_string());
        }
        if too_large.load(Ordering::Acquire) {
            break Some("Sortie du processus trop volumineuse".into());
        }
        if started.elapsed() >= timeout {
            break Some(format!(
                "Le processus n'a pas répondu avant le délai de {} secondes",
                timeout.as_secs()
            ));
        }
        if status.is_none() {
            match tree.try_wait() {
                Ok(s) => status = s,
                Err(e) => break Some(e.to_string()),
            }
        }
        while done_rx.try_recv().is_ok() {
            finished_readers += 1;
        }
        if status.is_some() && finished_readers == 2 {
            break None;
        }
        thread::sleep(Duration::from_millis(20));
    };
    tree.terminate();
    // Join both readers even when the first one panics.
    let stdout = out_reader.join();
    let stderr = err_reader.join();
    let stdout = stdout.map_err(|_| "lecture stdout interrompue")?;
    let stderr = stderr.map_err(|_| "lecture stderr interrompue")?;
    if let Some(issue) = issue {
        return Err(issue);
    }
    Ok(Output {
        status: status.ok_or("état du processus absent")?,
        stdout,
        stderr,
    })
}

#[cfg(windows)]
mod windows_owner {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{
        OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
    };
    pub(super) struct Handle(HANDLE);
    impl Handle {
        pub(super) fn raw(&self) -> usize {
            self.0 .0 as usize
        }
    }
    // Unique ownership can move to the worker; there is no concurrent access.
    unsafe impl Send for Handle {}
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
    fn error(e: windows::core::Error) -> io::Error {
        io::Error::other(e.to_string())
    }
    pub(super) fn prepare(command: &mut Command) -> io::Result<Handle> {
        let job = Handle(unsafe { CreateJobObjectW(None, None).map_err(error)? });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )
            .map_err(error)?;
        }
        // Assign the child before execution so descendants inherit the job
        // without racing the PyInstaller bootloader.
        command.creation_flags(CREATE_NO_WINDOW.0 | CREATE_SUSPENDED.0);
        Ok(job)
    }
    pub(super) fn attach_and_resume(job: &Handle, child: &Child) -> io::Result<()> {
        unsafe {
            AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())).map_err(error)?;
        }
        let snapshot =
            Handle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0).map_err(error)? });
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut found = unsafe { Thread32First(snapshot.0, &mut entry).is_ok() };
        while found {
            if entry.th32OwnerProcessID == child.id() {
                let thread = Handle(unsafe {
                    OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID).map_err(error)?
                });
                if unsafe { ResumeThread(thread.0) } == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                return Ok(());
            }
            found = unsafe { Thread32Next(snapshot.0, &mut entry).is_ok() };
        }
        Err(io::Error::other("thread initial du processus introuvable"))
    }
    pub(super) fn terminate(job: &Handle) {
        unsafe {
            let _ = TerminateJobObject(job.0, 1);
        }
    }
    pub(super) fn terminate_raw(job: usize) {
        unsafe {
            let _ = TerminateJobObject(HANDLE(job as *mut _), 1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        let name = format!(
            "{}::child_fixture",
            module_path!().split_once("::").unwrap().1
        );
        command
            .args(["--exact", &name, "--ignored", "--nocapture"])
            .env("SION_PROCESS_TEST_MODE", mode);
        command
    }
    #[test]
    #[ignore = "child fixture launched by process ownership tests"]
    fn child_fixture() {
        match std::env::var("SION_PROCESS_TEST_MODE").unwrap().as_str() {
            "ok" => {
                println!("version-test");
                eprintln!("stderr-test");
            }
            "hang" => loop {
                thread::sleep(Duration::from_secs(1));
            },
            #[cfg(unix)]
            "closed-pipes" => {
                unsafe extern "C" {
                    fn close(fd: i32) -> i32;
                }
                unsafe {
                    close(1);
                    close(2);
                }
                loop {
                    thread::sleep(Duration::from_secs(1));
                }
            }
            "stderr-tail" => {
                eprint!("{}", "x".repeat(32768));
                eprintln!("GPU out of memory at the end");
            }
            "overflow" => loop {
                println!("{}", "x".repeat(8192));
            },
            "child" => {
                let mut command = fixture("hang");
                let mut child = command.spawn().unwrap();
                std::fs::write(
                    std::env::var("SION_PROCESS_TEST_PID").unwrap(),
                    child.id().to_string(),
                )
                .unwrap();
                let _ = child.wait();
            }
            "shutdown" => {
                let worker = thread::spawn(|| {
                    output(
                        &mut fixture("hang"),
                        Duration::from_secs(30),
                        &AtomicBool::new(false),
                    )
                });
                let start = Instant::now();
                while active_count() == 0 && start.elapsed() < Duration::from_secs(5) {
                    thread::sleep(Duration::from_millis(10));
                }
                assert_eq!(active_count(), 1);
                shutdown();
                assert!(worker.join().unwrap().is_err());
                assert_eq!(active_count(), 0);
            }
            _ => panic!("mode inconnu"),
        }
    }
    #[test]
    fn normal_exit_drains_both_pipes() {
        let _test = TEST_GATE.lock().unwrap();
        let out = output(
            &mut fixture("ok"),
            Duration::from_secs(5),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("version-test"));
        assert!(String::from_utf8_lossy(&out.stderr).contains("stderr-test"));
        assert_eq!(active_count(), 0);
    }
    #[test]
    fn inference_keeps_stderr_tail_and_stops_runaway_stdout() {
        let _test = TEST_GATE.lock().unwrap();
        let out = output_with_limits(
            &mut fixture("stderr-tail"),
            Duration::from_secs(5),
            &AtomicBool::new(false),
            1024,
            4096,
        )
        .unwrap();
        assert!(out.status.success());
        assert_eq!(out.stderr.len(), 4096);
        assert!(String::from_utf8_lossy(&out.stderr).contains("GPU out of memory at the end"));
        let err = output_with_limits(
            &mut fixture("overflow"),
            Duration::from_secs(5),
            &AtomicBool::new(false),
            1024,
            4096,
        )
        .unwrap_err();
        assert!(err.contains("volumineuse"));
        assert_eq!(active_count(), 0);
    }
    // A model can close its pipes while remaining alive. Waiting for it must
    // never prevent the timeout or cancellation from terminating the process.
    #[cfg(unix)]
    #[test]
    fn timeout_still_works_after_both_pipes_close() {
        let _test = TEST_GATE.lock().unwrap();
        let started = Instant::now();
        assert!(output_with_limits(
            &mut fixture("closed-pipes"),
            Duration::from_millis(250),
            &AtomicBool::new(false),
            1024,
            4096,
        )
        .is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(active_count(), 0);
    }
    #[test]
    fn shutdown_releases_live_processes_and_their_readers() {
        let _test = TEST_GATE.lock().unwrap();
        let out = output(
            &mut fixture("shutdown"),
            Duration::from_secs(5),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(out.status.success());
        assert_eq!(active_count(), 0);
    }
    #[test]
    fn timeout_and_cancellation_stop_the_whole_tree_repeatedly() {
        let _test = TEST_GATE.lock().unwrap();
        for cancel_early in [false, true, false, true] {
            let file = std::env::temp_dir().join(format!(
                "sion-process-test-{}-{}.pid",
                std::process::id(),
                cancel_early
            ));
            let _ = std::fs::remove_file(&file);
            let cancel = Arc::new(AtomicBool::new(false));
            let mut command = fixture("child");
            command.env("SION_PROCESS_TEST_PID", &file);
            let worker_cancel = cancel.clone();
            let worker =
                thread::spawn(move || output(&mut command, Duration::from_secs(1), &worker_cancel));
            let started = Instant::now();
            while !file.exists() && started.elapsed() < Duration::from_secs(5) {
                thread::sleep(Duration::from_millis(10));
            }
            let pid = std::fs::read_to_string(&file).expect("l'enfant doit démarrer");
            if cancel_early {
                cancel.store(true, Ordering::Release);
            }
            assert!(worker.join().unwrap().is_err());
            assert_eq!(active_count(), 0);
            #[cfg(target_os = "linux")]
            {
                // SIGKILL delivery is asynchronous for descendants we cannot reap.
                let deadline = Instant::now() + Duration::from_secs(1);
                loop {
                    let Ok(state) = std::fs::read_to_string(format!("/proc/{}/stat", pid.trim()))
                    else {
                        break;
                    };
                    if state.split(')').nth(1).unwrap().split_whitespace().next() == Some("Z") {
                        break;
                    }
                    assert!(
                        Instant::now() < deadline,
                        "descendant still running after termination"
                    );
                    thread::sleep(Duration::from_millis(5));
                }
            }
            #[cfg(windows)]
            {
                use windows::Win32::System::Threading::{
                    OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
                };
                if let Ok(handle) =
                    unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid.trim().parse().unwrap()) }
                {
                    assert_eq!(
                        unsafe { WaitForSingleObject(handle, 1000) },
                        windows::Win32::Foundation::WAIT_OBJECT_0
                    );
                    unsafe {
                        let _ = windows::Win32::Foundation::CloseHandle(handle);
                    }
                }
            }
            let _ = std::fs::remove_file(file);
        }
    }
}
