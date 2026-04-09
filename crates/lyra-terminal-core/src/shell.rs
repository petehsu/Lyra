use std::path::Path;

use portable_pty::CommandBuilder;

pub fn make_shell_candidates(requested_shell: Option<&str>) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Some(shell) = requested_shell {
        let trimmed = shell.trim();
        if !trimmed.is_empty() && is_supported_requested_shell(trimmed) {
            candidates.push(trimmed.to_string());
        }
    }

    if cfg!(windows) {
        candidates.push("pwsh.exe".to_string());
        candidates.push("powershell.exe".to_string());
        candidates.push("cmd.exe".to_string());
    } else {
        // Prefer bash/zsh first so Lyra prompt/runtime integrations can be applied.
        candidates.push("/usr/bin/bash".to_string());
        candidates.push("/bin/bash".to_string());
        candidates.push("/usr/bin/zsh".to_string());
        candidates.push("/bin/zsh".to_string());
        candidates.push("/usr/bin/sh".to_string());
        candidates.push("/bin/sh".to_string());

        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.trim().is_empty() {
                candidates.push(shell);
            }
        }

        // Name-based fallback for environments where absolute paths differ.
        candidates.push("bash".to_string());
        candidates.push("zsh".to_string());
        candidates.push("sh".to_string());
    }

    let mut deduped: Vec<String> = Vec::new();
    for candidate in candidates {
        if !deduped.iter().any(|it| it == &candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn shell_name_of(shell: &str) -> &str {
    Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
}

pub fn shell_startup_args(shell: &str) -> Vec<String> {
    if cfg!(windows) {
        return Vec::new();
    }

    let shell_name = shell_name_of(shell);
    match shell_name {
        // Safe-mode defaults for v1: skip user startup scripts to avoid third-party
        // shell plugin crashes taking down the embedded terminal.
        "bash" => vec![
            "--noprofile".to_string(),
            "--norc".to_string(),
            "-i".to_string(),
        ],
        "zsh" => vec!["-f".to_string(), "-i".to_string()],
        // Force interactive mode to prevent immediate non-interactive shell exits in PTY contexts.
        "fish" | "sh" => vec!["-i".to_string()],
        _ => Vec::new(),
    }
}

pub fn shell_environment(shell: &str) -> Vec<(String, String)> {
    if cfg!(windows) {
        return Vec::new();
    }

    const ENV_KEYS: &[&str] = &[
        "HOME",
        "PATH",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "PWD",
        "SHELL",
        "XDG_RUNTIME_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "TMPDIR",
    ];

    let mut env_pairs = Vec::new();
    for key in ENV_KEYS {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                env_pairs.push(((*key).to_string(), value));
            }
        }
    }

    // Ensure core terminal variables always exist in sanitized environments.
    env_pairs.push((
        "TERM".to_string(),
        std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string()),
    ));
    env_pairs.push(("SHELL".to_string(), shell.to_string()));

    let mut deduped = Vec::new();
    for (key, value) in env_pairs {
        if let Some(existing) = deduped
            .iter_mut()
            .find(|(existing_key, _)| existing_key == &key)
        {
            *existing = (key, value);
            continue;
        }
        deduped.push((key, value));
    }
    deduped
}

fn is_supported_requested_shell(shell: &str) -> bool {
    let name = shell_name_of(shell);
    if cfg!(windows) {
        return matches!(
            name.to_ascii_lowercase().as_str(),
            "pwsh.exe" | "powershell.exe" | "cmd.exe" | "pwsh" | "powershell" | "cmd"
        );
    }

    matches!(name, "bash" | "zsh" | "sh")
}

pub fn configure_shell_environment(command: &mut CommandBuilder, shell: &str) {
    if cfg!(windows) {
        return;
    }

    command.env_clear();
    for (key, value) in shell_environment(shell) {
        command.env(key, value);
    }
}

pub fn configure_shell_command(command: &mut CommandBuilder, shell: &str) {
    for arg in shell_startup_args(shell) {
        command.arg(arg);
    }
}

pub fn shell_exists(candidate: &str) -> bool {
    if cfg!(windows) {
        return true;
    }
    if candidate.contains('/') {
        return Path::new(candidate).exists();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{
        configure_shell_command, configure_shell_environment, make_shell_candidates,
        shell_environment, shell_exists, shell_startup_args,
    };
    use portable_pty::CommandBuilder;

    #[test]
    fn keeps_supported_requested_shell_as_first_candidate() {
        if cfg!(windows) {
            let candidates = make_shell_candidates(Some("pwsh.exe"));
            assert_eq!(candidates.first().map(|v| v.as_str()), Some("pwsh.exe"));
            return;
        }
        let candidates = make_shell_candidates(Some("/usr/bin/bash"));
        assert_eq!(
            candidates.first().map(|v| v.as_str()),
            Some("/usr/bin/bash")
        );
    }

    #[test]
    fn always_has_fallback_candidates() {
        let candidates = make_shell_candidates(None);
        assert!(!candidates.is_empty());
    }

    #[test]
    fn has_stable_posix_shells_before_env_shell() {
        if cfg!(windows) {
            return;
        }

        let candidates = make_shell_candidates(None);
        let has_bash_or_sh = candidates.iter().any(|value| {
            value == "/usr/bin/bash"
                || value == "/bin/bash"
                || value == "/usr/bin/sh"
                || value == "/bin/sh"
        });
        assert!(has_bash_or_sh);
    }

    #[test]
    fn shell_exists_respects_absolute_path_on_unix() {
        if cfg!(windows) {
            return;
        }
        assert!(!shell_exists("/definitely/not/a/real/shell"));
    }

    #[test]
    fn ignores_unsupported_requested_shell() {
        if cfg!(windows) {
            return;
        }
        let candidates = make_shell_candidates(Some("/usr/bin/nu"));
        assert_ne!(
            candidates.first().map(|it| it.as_str()),
            Some("/usr/bin/nu")
        );
    }

    #[test]
    fn configures_interactive_flag_for_common_unix_shells() {
        if cfg!(windows) {
            return;
        }
        let mut command = CommandBuilder::new("/bin/bash");
        configure_shell_command(&mut command, "/bin/bash");
        let rendered = format!("{command:?}");
        assert!(rendered.contains("-i"));
    }

    #[test]
    fn configures_sanitized_environment() {
        if cfg!(windows) {
            return;
        }
        let mut command = CommandBuilder::new("/bin/sh");
        configure_shell_environment(&mut command, "/bin/sh");
        let rendered = format!("{command:?}");
        assert!(rendered.contains("TERM"));
        assert!(rendered.contains("SHELL"));
    }

    #[test]
    fn exposes_startup_args_for_bash() {
        if cfg!(windows) {
            return;
        }
        let args = shell_startup_args("/bin/bash");
        assert!(args.contains(&"-i".to_string()));
    }

    #[test]
    fn exposes_terminal_environment() {
        if cfg!(windows) {
            return;
        }
        let env_pairs = shell_environment("/bin/sh");
        assert!(env_pairs.iter().any(|(key, _)| key == "TERM"));
        assert!(env_pairs.iter().any(|(key, _)| key == "SHELL"));
    }
}
