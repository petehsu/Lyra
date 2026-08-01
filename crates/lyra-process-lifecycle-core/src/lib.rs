use std::process::{Command, Stdio};
use std::time::Duration;

pub const WATCHER_BIN_ENV: &str = "LYRA_DAEMON_WATCHER_BIN";
pub const WATCHER_PARENT_PID_ENV: &str = "LYRA_DAEMON_PARENT_PID";
pub const PARENT_DEATH_SIGNAL: i32 = 15;

const DEFAULT_WATCHER_GRACE_MS: u64 = 1_500;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParentWatcherConfig {
    pub parent_pid: u32,
    pub target_pid: u32,
    pub kill_group: bool,
    pub grace_ms: u64,
}

pub fn configure_daemon_child_command(command: &mut Command) {
    #[cfg(unix)]
    configure_unix_daemon_child_command(command);

    #[cfg(not(unix))]
    let _ = command;
}

#[cfg(unix)]
fn configure_unix_daemon_child_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
    unsafe {
        command.pre_exec(|| {
            install_linux_parent_death_signal(PARENT_DEATH_SIGNAL)?;
            Ok(())
        });
    }
}

pub fn spawn_parent_death_watcher(target_pid: u32, kill_group: bool) {
    let Ok(binary) = std::env::var(WATCHER_BIN_ENV) else {
        return;
    };
    let parent_pid = std::env::var(WATCHER_PARENT_PID_ENV)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_else(std::process::id);

    let mut command = Command::new(binary);
    command
        .arg("--watch-parent")
        .arg("--parent-pid")
        .arg(parent_pid.to_string())
        .arg("--target-pid")
        .arg(target_pid.to_string())
        .arg("--grace-ms")
        .arg(DEFAULT_WATCHER_GRACE_MS.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if kill_group {
        command.arg("--target-group");
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let _ = command.spawn();
}

pub fn terminate_process_tree(target_pid: u32, force: bool) {
    terminate_target(target_pid, true, force);
}

pub fn terminate_process(target_pid: u32, force: bool) {
    terminate_target(target_pid, false, force);
}

pub fn run_parent_watcher_from_args<I>(args: I) -> Option<i32>
where
    I: IntoIterator<Item = String>,
{
    let config = parse_parent_watcher_args(args)?;
    if wait_for_parent_or_target_exit(config.parent_pid, config.target_pid) {
        terminate_target(config.target_pid, config.kill_group, false);
        std::thread::sleep(Duration::from_millis(config.grace_ms));
        terminate_target(config.target_pid, config.kill_group, true);
    }
    Some(0)
}

pub fn parse_parent_watcher_args<I>(args: I) -> Option<ParentWatcherConfig>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    if args.next().as_deref() != Some("--watch-parent") {
        return None;
    }

    let mut parent_pid = None;
    let mut target_pid = None;
    let mut kill_group = false;
    let mut grace_ms = DEFAULT_WATCHER_GRACE_MS;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--parent-pid" => parent_pid = args.next().and_then(|value| value.parse().ok()),
            "--target-pid" => target_pid = args.next().and_then(|value| value.parse().ok()),
            "--target-group" => kill_group = true,
            "--grace-ms" => {
                grace_ms = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(DEFAULT_WATCHER_GRACE_MS)
            }
            _ => {}
        }
    }

    Some(ParentWatcherConfig {
        parent_pid: parent_pid?,
        target_pid: target_pid?,
        kill_group,
        grace_ms,
    })
}

fn wait_for_parent_or_target_exit(parent_pid: u32, target_pid: u32) -> bool {
    #[cfg(any(
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    ))]
    if let Ok(parent_exited_first) = wait_for_parent_or_target_exit_kqueue(parent_pid, target_pid) {
        return parent_exited_first;
    }

    #[cfg(windows)]
    if let Ok(parent_exited_first) = wait_for_parent_or_target_exit_windows(parent_pid, target_pid)
    {
        return parent_exited_first;
    }

    wait_for_parent_or_target_exit_poll(parent_pid, target_pid)
}

#[cfg(target_os = "linux")]
pub fn install_linux_parent_death_signal(signal: i32) -> std::io::Result<()> {
    let result = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, signal) };
    if result != 0 {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe { libc::getppid() } == 1 {
        unsafe {
            libc::raise(signal);
        }
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn install_linux_parent_death_signal(_signal: i32) -> std::io::Result<()> {
    Ok(())
}

#[cfg(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd",
    target_os = "dragonfly"
))]
fn wait_for_parent_or_target_exit_kqueue(
    parent_pid: u32,
    target_pid: u32,
) -> std::io::Result<bool> {
    use std::mem::zeroed;
    use std::ptr::null;

    let kq = unsafe { libc::kqueue() };
    if kq < 0 {
        return Err(std::io::Error::last_os_error());
    }

    let mut changes = [unsafe { zeroed::<libc::kevent>() }, unsafe {
        zeroed::<libc::kevent>()
    }];
    for (change, pid) in changes.iter_mut().zip([parent_pid, target_pid]) {
        change.ident = pid as libc::uintptr_t;
        change.filter = libc::EVFILT_PROC;
        change.flags = libc::EV_ADD | libc::EV_ENABLE | libc::EV_ONESHOT;
        change.fflags = libc::NOTE_EXIT;
    }

    let mut event = unsafe { zeroed::<libc::kevent>() };
    let result = unsafe { libc::kevent(kq, changes.as_ptr(), 2, &mut event, 1, null()) };
    let close_result = unsafe { libc::close(kq) };
    if result < 0 {
        return Err(std::io::Error::last_os_error());
    }
    if close_result < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(event.ident == parent_pid as libc::uintptr_t)
}

fn wait_for_parent_or_target_exit_poll(parent_pid: u32, target_pid: u32) -> bool {
    loop {
        if !process_exists(target_pid) {
            return false;
        }
        if !process_exists(parent_pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(not(unix))]
fn process_exists(_pid: u32) -> bool {
    false
}

#[cfg(unix)]
fn terminate_target(target_pid: u32, kill_group: bool, force: bool) {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    let pid = if kill_group {
        -(target_pid as libc::pid_t)
    } else {
        target_pid as libc::pid_t
    };
    unsafe {
        libc::kill(pid, signal);
    }
}

#[cfg(windows)]
fn terminate_target(target_pid: u32, _kill_group: bool, force: bool) {
    let mut command = Command::new("taskkill");
    command.arg("/PID").arg(target_pid.to_string()).arg("/T");
    if force {
        command.arg("/F");
    }
    let _ = command.status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_target(_target_pid: u32, _kill_group: bool, _force: bool) {}

#[cfg(windows)]
pub struct WindowsJobGuard(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for WindowsJobGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
pub fn install_windows_kill_on_close_job() -> std::io::Result<WindowsJobGuard> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ACCESS_DENIED};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let mut info = unsafe { std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() };
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let ok = unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            (&mut info as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(handle);
        }
        return Err(std::io::Error::last_os_error());
    }
    let assigned = unsafe { AssignProcessToJobObject(handle, GetCurrentProcess()) };
    if assigned == 0 {
        let error = unsafe { GetLastError() };
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(handle);
        }
        if error == ERROR_ACCESS_DENIED {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "process is already assigned to a Windows job object",
            ));
        }
        return Err(std::io::Error::last_os_error());
    }
    Ok(WindowsJobGuard(handle))
}

#[cfg(not(windows))]
pub fn install_windows_kill_on_close_job() -> std::io::Result<()> {
    Ok(())
}

#[cfg(windows)]
fn wait_for_parent_or_target_exit_windows(
    parent_pid: u32,
    target_pid: u32,
) -> std::io::Result<bool> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForMultipleObjects};

    let parent = unsafe { OpenProcess(SYNCHRONIZE, 0, parent_pid) };
    if parent.is_null() {
        return Ok(true);
    }
    let target = unsafe { OpenProcess(SYNCHRONIZE, 0, target_pid) };
    if target.is_null() {
        unsafe {
            CloseHandle(parent);
        }
        return Ok(false);
    }
    let handles = [parent, target];
    let result = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, u32::MAX) };
    unsafe {
        CloseHandle(parent);
        CloseHandle(target);
    }
    Ok(result == WAIT_OBJECT_0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_parent_watcher_args() {
        let config = parse_parent_watcher_args([
            "--watch-parent".to_string(),
            "--parent-pid".to_string(),
            "10".to_string(),
            "--target-pid".to_string(),
            "20".to_string(),
            "--target-group".to_string(),
            "--grace-ms".to_string(),
            "30".to_string(),
        ])
        .expect("watcher config");

        assert_eq!(
            config,
            ParentWatcherConfig {
                parent_pid: 10,
                target_pid: 20,
                kill_group: true,
                grace_ms: 30,
            }
        );
    }

    #[test]
    fn ignores_non_watcher_args() {
        assert_eq!(parse_parent_watcher_args(["--socket".to_string()]), None);
    }
}
