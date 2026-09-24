use std::fs;
use std::path::{Path, PathBuf};

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
        // Same order as the agent exec shell: Git Bash, then Windows
        // PowerShell, PowerShell 7, then cmd. A requested shell stays first.
        push_windows_shells(&mut candidates, find_git_bash());
    } else {
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.trim().is_empty() {
                candidates.push(shell);
            }
        }

        candidates.push("/usr/bin/bash".to_string());
        candidates.push("/bin/bash".to_string());
        candidates.push("/usr/bin/zsh".to_string());
        candidates.push("/bin/zsh".to_string());
        candidates.push("/usr/bin/fish".to_string());
        candidates.push("/bin/fish".to_string());
        candidates.push("/usr/bin/sh".to_string());
        candidates.push("/bin/sh".to_string());

        // Name-based fallback for environments where absolute paths differ.
        candidates.push("bash".to_string());
        candidates.push("zsh".to_string());
        candidates.push("fish".to_string());
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
    shell_startup_args_for_platform(shell, cfg!(windows))
}

pub fn shell_startup_args_for_platform(shell: &str, is_windows: bool) -> Vec<String> {
    let shell_name = shell_name_of(shell);
    if is_windows {
        return match shell_name.to_ascii_lowercase().as_str() {
            "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe" => {
                if let Some(path) =
                    ensure_shell_integration_file("powershell", "powershell-lyra.ps1")
                {
                    vec![
                        "-NoLogo".to_string(),
                        "-NoExit".to_string(),
                        "-ExecutionPolicy".to_string(),
                        "Bypass".to_string(),
                        "-Command".to_string(),
                        format!(". {}", quote_powershell(&path.to_string_lossy())),
                    ]
                } else {
                    vec!["-NoLogo".to_string(), "-NoExit".to_string()]
                }
            }
            _ => Vec::new(),
        };
    }

    match shell_name {
        "bash" => {
            if let Some(path) = ensure_bash_init_file() {
                vec![
                    "--init-file".to_string(),
                    path.to_string_lossy().to_string(),
                    "-i".to_string(),
                ]
            } else {
                vec!["-i".to_string()]
            }
        }
        "zsh" => vec!["-l".to_string(), "-i".to_string()],
        "fish" => {
            if let Some(path) = ensure_shell_integration_file("fish", "fish-lyra.fish") {
                vec![
                    "--interactive".to_string(),
                    "--init-command".to_string(),
                    format!("source {}", quote_fish(&path.to_string_lossy())),
                ]
            } else {
                vec!["-i".to_string()]
            }
        }
        // Force interactive mode to prevent immediate non-interactive shell exits in PTY contexts.
        "sh" => vec!["-i".to_string()],
        _ => Vec::new(),
    }
}

pub fn shell_environment(shell: &str) -> Vec<(String, String)> {
    let env_keys: &[&str] = if cfg!(windows) {
        &[
            "APPDATA",
            "COMPUTERNAME",
            "HOMEDRIVE",
            "HOMEPATH",
            "LOCALAPPDATA",
            "PATH",
            "PATHEXT",
            "BROWSER",
            "GH_BROWSER",
            "LYRA_OPEN_URL_BIN",
            "LYRA_ELECTRON_EXEC",
            "LYRA_ELECTRON_APP_PATH",
            "PSModulePath",
            "SystemRoot",
            "TEMP",
            "TMP",
            "USERDOMAIN",
            "USERNAME",
            "USERPROFILE",
            "WINDIR",
        ]
    } else {
        &[
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
            "BROWSER",
            "GH_BROWSER",
            "LYRA_OPEN_URL_BIN",
            "LYRA_ELECTRON_EXEC",
            "LYRA_ELECTRON_APP_PATH",
            "LYRA_SYSTEM_XDG_OPEN",
            "LYRA_SYSTEM_OPEN",
            "XDG_RUNTIME_DIR",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_STATE_HOME",
            "TMPDIR",
        ]
    };

    let mut env_pairs = Vec::new();
    for key in env_keys {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                env_pairs.push(((*key).to_string(), value));
            }
        }
    }

    // Ensure core terminal variables always exist while preserving the user's environment.
    env_pairs.push((
        "TERM".to_string(),
        std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string()),
    ));
    env_pairs.push((
        "COLORTERM".to_string(),
        std::env::var("COLORTERM").unwrap_or_else(|_| "truecolor".to_string()),
    ));
    env_pairs.push(("TERM_PROGRAM".to_string(), "Lyra".to_string()));
    env_pairs.push(("SHELL".to_string(), shell.to_string()));
    if !cfg!(windows) && shell_name_of(shell) == "zsh" {
        if let Some(zdotdir) = ensure_zsh_integration_dir() {
            env_pairs.push(("ZDOTDIR".to_string(), zdotdir.to_string_lossy().to_string()));
        }
    }

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

fn shell_integration_root() -> Option<PathBuf> {
    let root = std::env::temp_dir()
        .join("lyra-terminal-core")
        .join("shell");
    fs::create_dir_all(&root).ok()?;
    Some(root)
}

fn ensure_shell_integration_file(shell_name: &str, file_name: &str) -> Option<PathBuf> {
    let script = crate::shell_integration::integration_script_for_shell(shell_name)?;
    let path = shell_integration_root()?.join(file_name);
    fs::write(&path, script).ok()?;
    Some(path)
}

fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn quote_fish(value: &str) -> String {
    format!("'{}'", value.replace('\'', "\\'"))
}

fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn ensure_bash_init_file() -> Option<PathBuf> {
    let integration = ensure_shell_integration_file("bash", "bash-lyra.sh")?;
    let root = shell_integration_root()?.join("bash");
    fs::create_dir_all(&root).ok()?;
    let init = root.join("bashrc");
    let script = format!(
        "if [ -r \"$HOME/.bashrc\" ]; then . \"$HOME/.bashrc\"; fi\n. {} 2>/dev/null || true\n",
        quote_posix(&integration.to_string_lossy())
    );
    fs::write(&init, script).ok()?;
    Some(init)
}

fn ensure_zsh_integration_dir() -> Option<PathBuf> {
    let root = shell_integration_root()?.join("zsh");
    fs::create_dir_all(&root).ok()?;
    let zprofile = root.join(".zprofile");
    let zshrc = root.join(".zshrc");
    let integration = ensure_shell_integration_file("zsh", "zsh-lyra.sh")?;
    let original_zdotdir = std::env::var("ZDOTDIR")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let source_user_profile = if let Some(path) = original_zdotdir.as_ref() {
        format!(
            "if [ -r {0}/.zprofile ]; then . {0}/.zprofile; elif [ -r \"$HOME/.zprofile\" ]; then . \"$HOME/.zprofile\"; fi\n",
            quote_posix(path)
        )
    } else {
        "if [ -r \"$HOME/.zprofile\" ]; then . \"$HOME/.zprofile\"; fi\n".to_string()
    };
    let source_user_rc = if let Some(path) = original_zdotdir {
        format!(
            "if [ -r {0}/.zshrc ]; then . {0}/.zshrc; elif [ -r \"$HOME/.zshrc\" ]; then . \"$HOME/.zshrc\"; fi\n",
            quote_posix(&path)
        )
    } else {
        "if [ -r \"$HOME/.zshrc\" ]; then . \"$HOME/.zshrc\"; fi\n".to_string()
    };
    let script = format!(
        "{source_user_rc}. {} 2>/dev/null || true\n",
        quote_posix(&integration.to_string_lossy())
    );
    fs::write(zprofile, source_user_profile).ok()?;
    fs::write(zshrc, script).ok()?;
    Some(root)
}

fn push_windows_shells(candidates: &mut Vec<String>, git_bash: Option<String>) {
    if let Some(bash) = git_bash {
        candidates.push(bash);
    }
    candidates.push("powershell.exe".to_string());
    candidates.push("pwsh.exe".to_string());
    candidates.push("cmd.exe".to_string());
}

/// Git Bash discovery used by the visible terminal. Matches the agent exec
/// order in `shell_kind`: env override, `where.exe bash` without the WSL
/// launcher, bash next to `git`, then the usual install paths.
#[cfg(windows)]
fn find_git_bash() -> Option<String> {
    if let Ok(path) = std::env::var("LYRA_GIT_BASH_PATH") {
        if Path::new(&path).is_file() {
            return Some(path);
        }
    }
    if let Some(path) = where_exe("bash") {
        let lower = path.to_lowercase();
        if !lower.contains("system32") && !lower.contains("windowsapps") && Path::new(&path).is_file()
        {
            return Some(path);
        }
    }
    if let Some(git_path) = where_exe("git") {
        let git_dir = Path::new(&git_path);
        let candidates = [
            git_dir
                .parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("bin").join("bash.exe")),
            git_dir
                .parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("usr").join("bin").join("bash.exe")),
            git_dir.parent().map(|parent| parent.join("bash.exe")),
        ];
        for candidate in candidates.into_iter().flatten() {
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    for location in [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\usr\bin\bash.exe",
    ] {
        if Path::new(location).is_file() {
            return Some(location.to_string());
        }
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let scoop = format!("{userprofile}\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe");
        if Path::new(&scoop).is_file() {
            return Some(scoop);
        }
    }
    None
}

#[cfg(windows)]
fn where_exe(name: &str) -> Option<String> {
    let output = std::process::Command::new("where.exe").arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
}

#[cfg(not(windows))]
fn find_git_bash() -> Option<String> {
    None
}

fn is_supported_requested_shell(shell: &str) -> bool {
    let name = shell_name_of(shell);
    if cfg!(windows) {
        return matches!(
            name.to_ascii_lowercase().as_str(),
            "pwsh.exe"
                | "powershell.exe"
                | "cmd.exe"
                | "pwsh"
                | "powershell"
                | "cmd"
                | "bash.exe"
                | "bash"
        );
    }

    matches!(name, "bash" | "zsh" | "fish" | "sh")
}

pub fn configure_shell_environment(command: &mut CommandBuilder, shell: &str) {
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
        push_windows_shells,
        shell_environment, shell_exists, shell_startup_args, shell_startup_args_for_platform,
    };
    use portable_pty::CommandBuilder;

    #[test]
    fn windows_terminal_uses_git_bash_before_powershell() {
        let mut candidates = Vec::new();
        push_windows_shells(
            &mut candidates,
            Some(r"C:\Program Files\Git\bin\bash.exe".to_string()),
        );
        assert_eq!(
            candidates,
            vec![
                r"C:\Program Files\Git\bin\bash.exe",
                "powershell.exe",
                "pwsh.exe",
                "cmd.exe",
            ]
        );
    }

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
    fn prefers_env_shell_before_stable_posix_fallbacks() {
        if cfg!(windows) {
            return;
        }

        let candidates = make_shell_candidates(None);
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.trim().is_empty() {
                assert_eq!(
                    candidates.first().map(|value| value.as_str()),
                    Some(shell.as_str())
                );
            }
        }
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

    #[test]
    fn exposes_powershell_integration_startup_args() {
        let args = shell_startup_args_for_platform("pwsh.exe", true);
        assert!(args.iter().any(|arg| arg == "-NoExit"));
        assert!(args.iter().any(|arg| arg.contains("powershell-lyra.ps1")));
    }
}
