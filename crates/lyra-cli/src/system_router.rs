use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteDecision {
    Empty,
    Control,
    Shell,
    Agent,
}

pub trait CommandValidator {
    fn command_exists(&self, command: &str, cwd: &Path) -> bool;
}

#[derive(Debug, Default)]
pub struct SystemInputRouter {
    raw_passthrough: bool,
}

impl SystemInputRouter {
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(dead_code)]
    pub fn set_raw_passthrough(&mut self, raw_passthrough: bool) {
        self.raw_passthrough = raw_passthrough;
    }

    pub fn route(
        &self,
        input: &str,
        cwd: &Path,
        validator: &dyn CommandValidator,
    ) -> RouteDecision {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return RouteDecision::Empty;
        }
        if self.raw_passthrough {
            return RouteDecision::Shell;
        }
        if trimmed == "/" || trimmed.starts_with("/follow") {
            return RouteDecision::Control;
        }
        let Some(command) = first_command_token(trimmed) else {
            return RouteDecision::Agent;
        };
        if validator.command_exists(&command, cwd) {
            RouteDecision::Shell
        } else {
            RouteDecision::Agent
        }
    }
}

#[derive(Debug, Clone)]
pub struct ShellCommandValidator {
    shell: String,
}

impl ShellCommandValidator {
    pub fn new(shell: impl Into<String>) -> Self {
        Self {
            shell: shell.into(),
        }
    }
}

impl CommandValidator for ShellCommandValidator {
    fn command_exists(&self, command: &str, cwd: &Path) -> bool {
        if executable_path_exists(command, cwd) {
            return true;
        }
        let probe = format!(
            "command -v -- {} >/dev/null 2>&1 || type -- {} >/dev/null 2>&1",
            shell_quote(command),
            shell_quote(command)
        );
        Command::new(&self.shell)
            .arg("-lc")
            .arg(probe)
            .current_dir(cwd)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

pub fn first_command_token(input: &str) -> Option<String> {
    let tokens = shlex::split(input)?;
    tokens
        .into_iter()
        .skip_while(|token| is_assignment_prefix(token))
        .next()
}

fn is_assignment_prefix(token: &str) -> bool {
    let Some((key, _value)) = token.split_once('=') else {
        return false;
    };
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn executable_path_exists(command: &str, cwd: &Path) -> bool {
    if !command.contains('/') && !command.contains('\\') {
        return false;
    }
    let path = if Path::new(command).is_absolute() {
        PathBuf::from(command)
    } else {
        cwd.join(command)
    };
    path.is_file()
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    struct FakeValidator {
        commands: HashSet<String>,
    }

    impl FakeValidator {
        fn new(commands: &[&str]) -> Self {
            Self {
                commands: commands.iter().map(|value| value.to_string()).collect(),
            }
        }
    }

    impl CommandValidator for FakeValidator {
        fn command_exists(&self, command: &str, _cwd: &Path) -> bool {
            self.commands.contains(command)
        }
    }

    #[test]
    fn routes_known_shell_commands_to_shell() {
        let router = SystemInputRouter::new();
        let validator = FakeValidator::new(&["ls", "git", "npm"]);
        let cwd = Path::new(".");
        assert_eq!(router.route("ls", cwd, &validator), RouteDecision::Shell);
        assert_eq!(
            router.route("git status", cwd, &validator),
            RouteDecision::Shell
        );
        assert_eq!(
            router.route("npm run dev", cwd, &validator),
            RouteDecision::Shell
        );
    }

    #[test]
    fn routes_natural_language_and_unknown_commands_to_agent() {
        let router = SystemInputRouter::new();
        let validator = FakeValidator::new(&["ls"]);
        let cwd = Path::new(".");
        assert_eq!(
            router.route("帮我看看这个项目", cwd, &validator),
            RouteDecision::Agent
        );
        assert_eq!(
            router.route("Please explain this project", cwd, &validator),
            RouteDecision::Agent
        );
        assert_eq!(
            router.route("not-a-real-command --flag", cwd, &validator),
            RouteDecision::Agent
        );
    }

    #[test]
    fn raw_passthrough_always_routes_to_shell() {
        let mut router = SystemInputRouter::new();
        let validator = FakeValidator::new(&[]);
        router.set_raw_passthrough(true);
        assert_eq!(
            router.route("anything at all", Path::new("."), &validator),
            RouteDecision::Shell
        );
    }

    #[test]
    fn slash_opens_control_menu_not_agent() {
        let router = SystemInputRouter::new();
        let validator = FakeValidator::new(&[]);
        assert_eq!(
            router.route("/", Path::new("."), &validator),
            RouteDecision::Control
        );
        assert_eq!(
            router.route("/follow", Path::new("."), &validator),
            RouteDecision::Control
        );
    }
}
