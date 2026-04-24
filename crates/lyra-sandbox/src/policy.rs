use serde::{Deserialize, Serialize};

/// Risk level assigned to a command.
///
/// Inspired by Claude Code's dangerous pattern detection and Zed's
/// tool_permission mode classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandRiskLevel {
    /// Safe read-only operations (cat, ls, grep, git status, etc.)
    /// Can execute without user approval.
    Safe,
    /// Low-risk write operations (echo >> file, mkdir, touch, etc.)
    /// May trigger approval depending on sandbox mode.
    LowRisk,
    /// Medium-risk operations (package installs, git push, chmod, etc.)
    /// Require user approval in default mode.
    MediumRisk,
    /// High-risk operations (sudo, network tools, process signals, etc.)
    /// Always require explicit user approval.
    HighRisk,
    /// Critical/dangerous operations (rm -rf /, mkfs, fork bombs, etc.)
    /// Denied by default, can only run with explicit override.
    Critical,
}

impl CommandRiskLevel {
    /// Whether this risk level can execute without user approval
    /// in the default sandbox mode.
    pub fn is_auto_approvable(&self) -> bool {
        matches!(self, CommandRiskLevel::Safe)
    }

    /// Whether this risk level should always be denied.
    pub fn is_always_denied(&self) -> bool {
        matches!(self, CommandRiskLevel::Critical)
    }

    /// Human-readable label for the risk level.
    pub fn label(&self) -> &'static str {
        match self {
            CommandRiskLevel::Safe => "safe",
            CommandRiskLevel::LowRisk => "low",
            CommandRiskLevel::MediumRisk => "medium",
            CommandRiskLevel::HighRisk => "high",
            CommandRiskLevel::Critical => "critical",
        }
    }

    /// UI color hint (CSS class suffix).
    pub fn color_hint(&self) -> &'static str {
        match self {
            CommandRiskLevel::Safe => "green",
            CommandRiskLevel::LowRisk => "yellow",
            CommandRiskLevel::MediumRisk => "orange",
            CommandRiskLevel::HighRisk => "red",
            CommandRiskLevel::Critical => "dark-red",
        }
    }
}

/// Three-tier sandbox mode used by Lyra's local agent runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SandboxMode {
    /// Only read-only commands allowed. Write operations require approval.
    ReadOnly,
    /// Read + write within workspace directory allowed.
    WorkspaceWrite,
    /// Full access — all commands permitted (with user approval for risky ones).
    FullAccess,
}

impl Default for SandboxMode {
    fn default() -> Self {
        SandboxMode::ReadOnly
    }
}

/// Result of evaluating a command against the sandbox rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEvaluation {
    pub risk_level: CommandRiskLevel,
    pub matched_rule: Option<String>,
    pub requires_approval: bool,
    pub is_denied: bool,
    pub reason: Option<String>,
    /// Whether the command needs interactive PTY (vim, ssh, top, etc.)
    pub needs_pty: bool,
    /// Detected environment variable injections
    pub env_injections: Vec<String>,
}

impl CommandEvaluation {
    pub fn can_execute(&self) -> bool {
        !self.is_denied && !self.requires_approval
    }
}

/// Determines if a command needs an interactive PTY session.
///
/// Commands like vim, ssh, less, top require a real TTY to function properly.
/// This detection mirrors Claude Code's PTY routing logic.
pub fn needs_interactive_pty(command: &str) -> bool {
    let cmd = command
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    // Strip any leading path
    let base = cmd.rsplit('/').next().unwrap_or(&cmd);

    matches!(
        base,
        "vim"
            | "vi"
            | "nano"
            | "emacs"
            | "less"
            | "more"
            | "man"
            | "top"
            | "htop"
            | "ssh"
            | "telnet"
            | "mysql"
            | "psql"
            | "sqlite3"
            | "python"
            | "python3"
            | "node"
            | "ruby"
            | "irb"
            | "bash"
            | "zsh"
            | "fish"
            | "sh"
            | "tmux"
            | "screen"
            | "git" // git commit/merge may need editor
    ) || base.starts_with("nvim")
}

/// Evaluates whether a command requires PTY based on interactive flags.
/// -i or -t flags in ssh, or explicit tty allocation.
pub fn has_tty_flag(command: &str) -> bool {
    command.contains(" -t ") || command.contains(" -tt ") || command.contains(" --tty")
}
