//! Windows shell abstraction: detection, per-shell command construction,
//! quoting, path conversion, and model-facing context.
//!
//! Blends the approaches of four reference projects:
//! - Claude Code's Git Bash discovery (4-step fallback, WSL-bash filtering)
//! - Codex's per-shell `derive_exec_args` + PowerShell UTF-8 prefix
//! - Zed's `ShellKind` enum + `quote_cmd`/`quote_powershell` quoting
//! - OpenCode's `windowsPath()` POSIX↔Windows path translation
//!
//! On Windows the agent auto-detects the best available shell in priority
//! order (Git Bash → PowerShell → pwsh → cmd) and constructs the spawn
//! command accordingly. On Unix this module is compiled out — `shell.rs`
//! uses `sh -lc` directly.

#![cfg_attr(not(windows), allow(dead_code, unused_imports))]

use std::sync::OnceLock;

use serde_json::{json, Value};
use tokio::process::Command;

// ── ShellKind enum ──────────────────────────────────────────────────────

/// The shell type Lyra will use to execute a command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellKind {
    /// Git for Windows bash.exe — preferred on Windows for POSIX consistency.
    GitBash,
    /// Windows PowerShell 5.x (`powershell.exe`).
    PowerShell,
    /// PowerShell 7+ (`pwsh.exe`).
    Pwsh,
    /// cmd.exe — last-resort fallback.
    Cmd,
    /// POSIX sh/bash/zsh — used on Unix (never selected on Windows).
    Posix,
}

impl ShellKind {
    /// Human-readable name for the model-facing context block.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::GitBash => "Git Bash",
            Self::PowerShell => "Windows PowerShell",
            Self::Pwsh => "PowerShell 7",
            Self::Cmd => "cmd.exe",
            Self::Posix => "sh",
        }
    }

    /// Syntax guidance injected into the model's system prompt so it
    /// generates commands valid for the active shell.
    pub fn syntax_hint(&self) -> &'static str {
        match self {
            Self::GitBash => "Use POSIX/bash syntax. Quote paths with spaces using double quotes. Redirect to /dev/null, not nul. Use rm, ls, cat, grep — not del, dir, type, findstr.",
            Self::PowerShell => "Use Windows PowerShell syntax. Use Remove-Item instead of rm, Get-ChildItem instead of ls. Variables: $env:VAR. Quote paths with spaces using single or double quotes.",
            Self::Pwsh => "Use PowerShell 7 syntax. Use Remove-Item instead of rm, Get-ChildItem instead of ls. Variables: $env:VAR. Quote paths with spaces using single or double quotes.",
            Self::Cmd => "Use CMD syntax. Use %VAR% for variables, del instead of rm, dir instead of ls, type instead of cat, findstr instead of grep. Redirect to nul, not /dev/null.",
            Self::Posix => "Use POSIX shell syntax.",
        }
    }
}

// ── Detection ───────────────────────────────────────────────────────────

/// Cached detection result (Windows only). Resolved once on first access.
static DETECTED_SHELL: OnceLock<Option<DetectedShell>> = OnceLock::new();

#[derive(Clone, Debug)]
struct DetectedShell {
    kind: ShellKind,
    path: String,
}

/// Detect and cache the best available shell on Windows. Returns the
/// `ShellKind`; use [`detected_shell_path`] for the executable path.
///
/// Priority: Git Bash → PowerShell → pwsh → cmd. The first shell whose
/// executable is found wins, and the result is cached for the process
/// lifetime (matching Claude Code / Zed / OpenCode behavior).
#[cfg(windows)]
pub fn detect_windows_shell() -> ShellKind {
    DETECTED_SHELL
        .get_or_init(detect_windows_shell_inner)
        .as_ref()
        .map(|d| d.kind)
        .unwrap_or(ShellKind::Cmd)
}

/// Return the cached executable path for the detected shell. Must be
/// called after [`detect_windows_shell`].
#[cfg(windows)]
pub fn detected_shell_path() -> String {
    DETECTED_SHELL
        .get()
        .and_then(|d| d.as_ref().map(|d| d.path.clone()))
        .unwrap_or_else(|| "cmd.exe".to_string())
}

#[cfg(windows)]
fn detect_windows_shell_inner() -> Option<DetectedShell> {
    // 1. Git Bash (preferred)
    if let Some(path) = find_git_bash() {
        return Some(DetectedShell { kind: ShellKind::GitBash, path });
    }
    // 2. Windows PowerShell 5.x
    if let Some(path) = find_powershell() {
        return Some(DetectedShell { kind: ShellKind::PowerShell, path });
    }
    // 3. PowerShell 7+
    if let Some(path) = find_pwsh() {
        return Some(DetectedShell { kind: ShellKind::Pwsh, path });
    }
    // 4. cmd.exe (always available)
    let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    Some(DetectedShell { kind: ShellKind::Cmd, path: cmd })
}

/// 4-step Git Bash discovery (adapted from Claude Code `findGitBashPath`):
/// 1. `LYRA_GIT_BASH_PATH` env var
/// 2. `where.exe bash` (filtering out WSL bash)
/// 3. Derive from `where.exe git` → `<git>/bin/bash.exe` etc.
/// 4. Scan common default install locations
#[cfg(windows)]
fn find_git_bash() -> Option<String> {
    // 1. Explicit env override
    if let Ok(path) = std::env::var("LYRA_GIT_BASH_PATH") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    // 2. `where.exe bash` — filter WSL bash launcher
    if let Some(path) = where_exe("bash") {
        let lower = path.to_lowercase();
        if !lower.contains("system32") && !lower.contains("windowsapps") {
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    // 3. Derive from git's location
    if let Some(git_path) = where_exe("git") {
        let git_dir = std::path::Path::new(&git_path);
        let candidates = [
            git_dir.parent().and_then(|p| p.parent()).map(|p| p.join("bin").join("bash.exe")),
            git_dir.parent().and_then(|p| p.parent()).map(|p| p.join("usr").join("bin").join("bash.exe")),
            git_dir.parent().map(|p| p.join("bash.exe")),
        ];
        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    // 4. Scan common default install locations
    let default_locations = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\usr\bin\bash.exe",
    ];
    for location in &default_locations {
        if std::path::Path::new(location).exists() {
            return Some(location.to_string());
        }
    }
    // Scoop install
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let scoop = format!("{userprofile}\\scoop\\apps\\git\\current\\usr\\bin\\bash.exe");
        if std::path::Path::new(&scoop).exists() {
            return Some(scoop);
        }
    }

    None
}

#[cfg(windows)]
fn find_powershell() -> Option<String> {
    if let Some(path) = where_exe("powershell") {
        return Some(path);
    }
    let fallback = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
    if std::path::Path::new(fallback).exists() {
        return Some(fallback.to_string());
    }
    None
}

#[cfg(windows)]
fn find_pwsh() -> Option<String> {
    if let Some(path) = where_exe("pwsh") {
        return Some(path);
    }
    let fallback = r"C:\Program Files\PowerShell\7\pwsh.exe";
    if std::path::Path::new(fallback).exists() {
        return Some(fallback.to_string());
    }
    None
}

/// Run `where.exe <name>` and return the first non-cwd, non-WSL result.
/// Falls back to the `which` crate if `where.exe` is unavailable.
#[cfg(windows)]
fn where_exe(name: &str) -> Option<String> {
    // Try `where.exe` first (native Windows, matches Claude Code)
    if let Ok(output) = std::process::Command::new("where.exe")
        .arg(name)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    // Fallback to the `which` crate
    which::which(name).ok().map(|p| p.to_string_lossy().into_owned())
}

// ── Quoting ─────────────────────────────────────────────────────────────

/// Single-quote a string for use as a bash `eval` argument.
///
/// Escapes embedded single quotes via the `'"'"'` idiom (close-single-quote,
/// double-quote-single-quote, reopen-single-quote). This avoids the
/// shell-quote library's `!` → `\!` corruption in jq/awk filters.
///
/// Adapted from Claude Code's `singleQuoteForEval`.
pub fn single_quote_for_eval(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

// ── Null-redirect rewrite ───────────────────────────────────────────────

/// Rewrite CMD-style `>nul` redirects to the shell-appropriate equivalent.
///
/// - Git Bash / Posix: `>nul` → `>/dev/null`
/// - PowerShell / pwsh: `>nul` → `>$null`
/// - Cmd: no rewrite (nul is correct for cmd)
///
/// Matches `>nul`, `2>nul`, `&>nul`, `>>nul` (case-insensitive) followed by
/// a word boundary (space, end of string, or shell operator). Does NOT match
/// `null`, `nul.txt`, or `nul` inside a longer word.
///
/// Adapted from Claude Code's `rewriteWindowsNullRedirect`, but uses a
/// manual boundary check instead of regex lookahead (Rust's `regex` crate
/// does not support lookaround).
pub fn rewrite_null_redirect(command: &str, shell: &ShellKind) -> String {
    match shell {
        ShellKind::GitBash | ShellKind::Posix => {
            rewrite_nul(command, "/dev/null")
        }
        ShellKind::PowerShell | ShellKind::Pwsh => {
            rewrite_nul(command, "$null")
        }
        ShellKind::Cmd => command.to_string(),
    }
}

/// Match `>nul` / `2>nul` / `&>nul` / `>>nul` (case-insensitive) where `nul`
/// is followed by a word boundary. The redirect prefix (digits, `&`, `>`)
/// is captured in group 1 so it can be preserved in the replacement.
const NUL_REDIRECT_REGEX: &str = r"(\d?&?>+\s*)nul";

fn rewrite_nul(command: &str, replacement: &str) -> String {
    let re = regex::Regex::new(r"(?i)(\d?&?>+\s*)nul").expect("valid regex");
    re.replace_all(command, |caps: &regex::Captures| {
        let full_match = caps.get(0).unwrap();
        let end = full_match.end();
        // Check the character after "nul" — it must be a word boundary
        // (whitespace, shell operator, or end of string). If it's an
        // alphanumeric character (e.g. "nul.txt", "null"), skip this match.
        let after = command[end..].chars().next();
        let is_boundary = match after {
            None => true, // end of string
            Some(c) => !c.is_ascii_alphanumeric() && c != '.' && c != '_',
        };
        if is_boundary {
            format!("{}{replacement}", &caps[1])
        } else {
            full_match.as_str().to_string()
        }
    })
    .into_owned()
}

// ── PowerShell UTF-8 prefix ─────────────────────────────────────────────

/// Prefixed command for PowerShell to force UTF-8 console output, preventing
/// mojibake for non-ASCII (CJK, emoji) command output.
///
/// Adapted from Codex's `UTF8_OUTPUT_PREFIX`.
pub const POWERSHELL_UTF8_PREFIX: &str =
    "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n";

// ── Path conversion ─────────────────────────────────────────────────────

/// Convert a Windows path to a Git Bash / MSYS2 POSIX path.
///
/// `C:\Users\foo` → `/c/Users/foo`
/// `\\server\share` → `//server/share`
///
/// Adapted from Claude Code's `windowsPathToPosixPath`.
pub fn windows_to_posix(windows_path: &str) -> String {
    // UNC paths: \\server\share → //server/share
    if windows_path.starts_with("\\\\") {
        return windows_path.replace('\\', "/");
    }
    // Drive letter paths: C:\Users\foo → /c/Users/foo
    if let Some(rest) = windows_path.get(2..) {
        let bytes = windows_path.as_bytes();
        if bytes.len() >= 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes.get(2) == Some(&b'\\') || bytes.get(2) == Some(&b'/'))
        {
            let drive = bytes[0].to_ascii_lowercase() as char;
            return format!("/{drive}{}", rest.replace('\\', "/"));
        }
    }
    // Already POSIX or relative — just flip slashes
    windows_path.replace('\\', "/")
}

/// Convert a Git Bash / MSYS2 POSIX path back to a Windows path.
///
/// `/c/Users/foo` → `C:\Users\foo`
/// `/cygdrive/c/foo` → `C:\foo`
/// `//server/share` → `\\server\share`
///
/// Adapted from Claude Code's `posixPathToWindowsPath` and OpenCode's `windowsPath`.
pub fn posix_to_windows(posix_path: &str) -> String {
    // UNC paths: //server/share → \\server\share
    if posix_path.starts_with("//") {
        return posix_path.replace('/', "\\");
    }
    // /cygdrive/c/... format
    if let Some(rest) = posix_path.strip_prefix("/cygdrive/") {
        if let Some(drive) = rest.chars().next() {
            if drive.is_ascii_alphabetic() {
                let remainder = &rest[1..];
                let drive_upper = drive.to_ascii_uppercase();
                let rest = if remainder.is_empty() {
                    "\\".to_string()
                } else {
                    remainder.replace('/', "\\")
                };
                return format!("{drive_upper}:{rest}");
            }
        }
    }
    // /c/... format (MSYS2/Git Bash)
    if posix_path.starts_with('/') {
        let rest = &posix_path[1..];
        if let Some(drive) = rest.chars().next() {
            if drive.is_ascii_alphabetic() {
                let remainder = &rest[1..];
                let drive_upper = drive.to_ascii_uppercase();
                let rest = if remainder.is_empty() {
                    "\\".to_string()
                } else {
                    remainder.replace('/', "\\")
                };
                return format!("{drive_upper}:{rest}");
            }
        }
    }
    // Already Windows or relative — just flip slashes
    posix_path.replace('/', "\\")
}

// ── Command construction ────────────────────────────────────────────────

/// Build a `tokio::process::Command` for the given shell, pre-wrapping the
/// command string with the shell's quoting and invocation flags.
///
/// On Git Bash, the command is wrapped in `eval '<single-quoted>'` so
/// aliases sourced from the shell profile expand on the second parse pass,
/// and `cd` to the POSIX-converted cwd is prepended so the working directory
/// is correct inside bash (Git Bash's `current_dir` receives a Windows path
/// but bash internally uses POSIX paths).
///
/// On PowerShell, the UTF-8 console prefix is prepended to prevent mojibake.
///
/// On cmd, the command is passed verbatim to `/S /C` (unchanged from the
/// previous behavior).
#[cfg(windows)]
pub fn build_shell_command(
    shell: ShellKind,
    shell_path: &str,
    command: &str,
    cwd_windows: Option<&str>,
) -> Command {
    let normalized = rewrite_null_redirect(command, &shell);
    match shell {
        ShellKind::GitBash => {
            let quoted = single_quote_for_eval(&normalized);
            let script = if let Some(cwd) = cwd_windows {
                let posix_cwd = windows_to_posix(cwd);
                let quoted_cwd = single_quote_for_eval(&posix_cwd);
                format!("cd -- {quoted_cwd} && eval {quoted}")
            } else {
                format!("eval {quoted}")
            };
            let mut cmd = Command::new(shell_path);
            cmd.args(["-lc", &script]);
            cmd
        }
        ShellKind::PowerShell | ShellKind::Pwsh => {
            let script = format!("{POWERSHELL_UTF8_PREFIX}{normalized}");
            let mut cmd = Command::new(shell_path);
            cmd.args(["-NoProfile", "-NoLogo", "-NonInteractive", "-Command", &script]);
            cmd
        }
        ShellKind::Cmd => {
            // Keep the previous behavior: pass the command verbatim as a
            // single arg to cmd /S /C. tokio::process::Command doesn't expose
            // raw_arg, but .arg() on a single string is equivalent to the
            // original Command::new("cmd").args(["/S","/C",command]).
            let mut cmd = Command::new(shell_path);
            cmd.arg("/S").arg("/C").arg(normalized);
            cmd
        }
        ShellKind::Posix => {
            let quoted = single_quote_for_eval(&normalized);
            let script = format!("eval {quoted}");
            let mut cmd = Command::new(shell_path);
            cmd.args(["-lc", &script]);
            cmd
        }
    }
}

// ── Model-facing context ────────────────────────────────────────────────

/// Generate a shell-context block for the model's system prompt.
///
/// Tells the model which shell it's running in and provides syntax guidance.
/// Critically, reminds the model that the working directory is set
/// automatically — preventing the `cd /d "C:\Users\..."` prefix that caused
/// the quoting failures in the original Windows session.
pub fn shell_context_block() -> Value {
    #[cfg(windows)]
    {
        let shell = detect_windows_shell();
        json!({
            "shell": shell.display_name(),
            "syntaxHint": shell.syntax_hint(),
            "rule": "The working directory is set automatically — do not prefix commands with cd. Pass the directory via the workdir parameter instead."
        })
    }
    #[cfg(not(windows))]
    {
        json!({
            "shell": "sh",
            "syntaxHint": ShellKind::Posix.syntax_hint(),
            "rule": "The working directory is set automatically — do not prefix commands with cd. Pass the directory via the workdir parameter instead."
        })
    }
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_quote_for_eval_plain() {
        assert_eq!(single_quote_for_eval("hello"), "'hello'");
    }

    #[test]
    fn single_quote_for_eval_with_single_quote() {
        // The ' becomes '"'"' — close-sq, literal-sq-in-dq, reopen-sq
        assert_eq!(single_quote_for_eval("it's"), "'it'\"'\"'s'");
    }

    #[test]
    fn single_quote_for_eval_with_multiple_single_quotes() {
        assert_eq!(
            single_quote_for_eval("a'b'c"),
            "'a'\"'\"'b'\"'\"'c'"
        );
    }

    #[test]
    fn single_quote_for_eval_empty() {
        assert_eq!(single_quote_for_eval(""), "''");
    }

    #[test]
    fn windows_to_posix_drive_letter() {
        assert_eq!(windows_to_posix(r"C:\Users\foo"), "/c/Users/foo");
    }

    #[test]
    fn windows_to_posix_forward_slash_drive() {
        assert_eq!(windows_to_posix("C:/Users/foo"), "/c/Users/foo");
    }

    #[test]
    fn windows_to_posix_unc() {
        assert_eq!(windows_to_posix(r"\\server\share\path"), "//server/share/path");
    }

    #[test]
    fn windows_to_posix_already_posix() {
        assert_eq!(windows_to_posix("/c/Users/foo"), "/c/Users/foo");
    }

    #[test]
    fn windows_to_posix_relative() {
        assert_eq!(windows_to_posix("folder\\subfolder"), "folder/subfolder");
    }

    #[test]
    fn posix_to_windows_drive_letter() {
        assert_eq!(posix_to_windows("/c/Users/foo"), r"C:\Users\foo");
    }

    #[test]
    fn posix_to_windows_cygdrive() {
        assert_eq!(posix_to_windows("/cygdrive/c/foo"), r"C:\foo");
    }

    #[test]
    fn posix_to_windows_unc() {
        assert_eq!(posix_to_windows("//server/share/path"), r"\\server\share\path");
    }

    #[test]
    fn posix_to_windows_drive_only() {
        assert_eq!(posix_to_windows("/c"), r"C:\");
    }

    #[test]
    fn posix_to_windows_already_windows() {
        assert_eq!(posix_to_windows(r"C:\Users\foo"), r"C:\Users\foo");
    }

    #[test]
    fn rewrite_null_redirect_to_dev_null_for_bash() {
        let result = rewrite_null_redirect("ls 2>nul", &ShellKind::GitBash);
        assert_eq!(result, "ls 2>/dev/null");
    }

    #[test]
    fn rewrite_null_redirect_amp_nul_for_bash() {
        let result = rewrite_null_redirect("cmd &>nul", &ShellKind::GitBash);
        assert_eq!(result, "cmd &>/dev/null");
    }

    #[test]
    fn rewrite_null_redirect_case_insensitive() {
        let result = rewrite_null_redirect("ls 2>NUL", &ShellKind::GitBash);
        assert_eq!(result, "ls 2>/dev/null");
    }

    #[test]
    fn rewrite_null_redirect_to_null_for_powershell() {
        let result = rewrite_null_redirect("cmd 2>nul", &ShellKind::PowerShell);
        assert_eq!(result, "cmd 2>$null");
    }

    #[test]
    fn rewrite_null_redirect_no_change_for_cmd() {
        let result = rewrite_null_redirect("ls 2>nul", &ShellKind::Cmd);
        assert_eq!(result, "ls 2>nul");
    }

    #[test]
    fn rewrite_null_redirect_does_not_match_null_word() {
        let result = rewrite_null_redirect("echo null", &ShellKind::GitBash);
        assert_eq!(result, "echo null");
    }

    #[test]
    fn rewrite_null_redirect_does_not_match_nul_dot_txt() {
        let result = rewrite_null_redirect("cat nul.txt", &ShellKind::GitBash);
        assert_eq!(result, "cat nul.txt");
    }

    #[test]
    fn shell_context_block_has_shell_name() {
        let block = shell_context_block();
        assert!(block.get("shell").is_some());
        assert!(block.get("syntaxHint").is_some());
        assert!(block.get("rule").is_some());
        // The rule must tell the model not to use cd
        let rule = block.get("rule").and_then(Value::as_str).unwrap_or("");
        assert!(rule.contains("do not prefix commands with cd"));
    }
}