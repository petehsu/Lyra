use std::process::{Child, Command, Stdio};

const DISABLE_ENV: &str = "JCODE_DISABLE_POWER_INHIBIT";

/// Best-effort inhibitor that keeps laptops awake while Jcode is actively
/// streaming/processing. The helper process is kept alive only while active work
/// exists, then killed immediately so normal power management resumes.
pub(crate) struct PowerInhibitor {
    child: Option<Child>,
    available: bool,
}

impl PowerInhibitor {
    pub(crate) fn new() -> Self {
        Self {
            child: None,
            available: current_platform().is_some() && std::env::var_os(DISABLE_ENV).is_none(),
        }
    }

    pub(crate) fn set_active(&mut self, active: bool) {
        if !self.available {
            return;
        }

        if active {
            self.acquire();
        } else {
            self.release();
        }
    }

    fn acquire(&mut self) {
        if self.child.as_mut().is_some_and(child_is_running) {
            return;
        }
        self.release();

        let Some(platform) = current_platform() else {
            self.available = false;
            return;
        };

        match build_inhibit_command(platform).spawn() {
            Ok(child) => {
                self.child = Some(child);
            }
            Err(error) => {
                eprintln!("jcode: failed to acquire power inhibitor: {error}");
                self.available = false;
            }
        }
    }

    fn release(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for PowerInhibitor {
    fn drop(&mut self) {
        self.release();
    }
}

fn child_is_running(child: &mut Child) -> bool {
    matches!(child.try_wait(), Ok(None))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum InhibitPlatform {
    LinuxSystemd,
    MacosCaffeinate,
}

fn current_platform() -> Option<InhibitPlatform> {
    if cfg!(target_os = "linux") {
        Some(InhibitPlatform::LinuxSystemd)
    } else if cfg!(target_os = "macos") {
        Some(InhibitPlatform::MacosCaffeinate)
    } else {
        None
    }
}

fn build_inhibit_command(platform: InhibitPlatform) -> Command {
    match platform {
        InhibitPlatform::LinuxSystemd => build_linux_systemd_inhibit_command(),
        InhibitPlatform::MacosCaffeinate => build_macos_caffeinate_command(),
    }
}

fn build_linux_systemd_inhibit_command() -> Command {
    let mut command = Command::new("systemd-inhibit");
    command
        .arg("--what=sleep:handle-lid-switch")
        .arg("--who=jcode")
        .arg("--why=Jcode is streaming or processing active work")
        .arg("sleep")
        .arg("infinity")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn build_macos_caffeinate_command() -> Command {
    let mut command = Command::new("caffeinate");
    command
        // -i prevents idle sleep. -s prevents system sleep while on AC power.
        // We intentionally do not use -d so the display can sleep/turn off.
        .arg("-i")
        .arg("-s")
        .arg("sleep")
        .arg("infinity")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(test)]
mod tests {
    use super::InhibitPlatform;

    fn command_name(command: &std::process::Command) -> String {
        command.get_program().to_string_lossy().to_string()
    }

    fn command_args(command: &std::process::Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    }

    #[test]
    fn linux_inhibitor_blocks_sleep_and_lid_switch() {
        let command = super::build_inhibit_command(InhibitPlatform::LinuxSystemd);
        let args = command_args(&command);

        assert_eq!(command_name(&command), "systemd-inhibit");
        assert!(args.contains(&"--what=sleep:handle-lid-switch".to_string()));
        assert!(args.contains(&"--who=jcode".to_string()));
        assert!(args.contains(&"sleep".to_string()));
        assert!(args.contains(&"infinity".to_string()));
    }

    #[test]
    fn macos_inhibitor_prevents_system_sleep_without_display_assertion() {
        let command = super::build_inhibit_command(InhibitPlatform::MacosCaffeinate);
        let args = command_args(&command);

        assert_eq!(command_name(&command), "caffeinate");
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"-s".to_string()));
        assert!(!args.contains(&"-d".to_string()));
        assert!(args.contains(&"sleep".to_string()));
        assert!(args.contains(&"infinity".to_string()));
    }
}
