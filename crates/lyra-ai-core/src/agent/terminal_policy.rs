use serde_json::json;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalInteractionPolicyKind {
    AvoidTui,
    AllowFallbackPty,
    RequireRequestedTui,
}

impl TerminalInteractionPolicyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AvoidTui => "avoid_tui",
            Self::AllowFallbackPty => "allow_fallback_pty",
            Self::RequireRequestedTui => "require_requested_tui",
        }
    }
}

#[derive(Clone, Debug)]
pub struct TerminalInteractionPolicy {
    pub kind: TerminalInteractionPolicyKind,
    pub reasons: Vec<String>,
    pub explicit_tui_request: bool,
    pub user_insistence: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalCommandCategory {
    OneShotNonInteractive,
    InteractivePrompt,
    FullscreenTui,
    ShellEditor,
    LongRunningStream,
}

impl TerminalCommandCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OneShotNonInteractive => "one_shot_non_interactive",
            Self::InteractivePrompt => "interactive_prompt",
            Self::FullscreenTui => "fullscreen_tui",
            Self::ShellEditor => "shell_editor",
            Self::LongRunningStream => "long_running_stream",
        }
    }

    pub fn requires_pty(&self) -> bool {
        !matches!(self, Self::OneShotNonInteractive)
    }
}

#[derive(Clone, Debug)]
pub struct TerminalRewriteAdvice {
    pub replacement_command: Option<String>,
    pub suggested_tool: Option<String>,
    pub reason: String,
}

const TUI_HINTS: &[&str] = &[
    "top", "htop", "btop", "less", "more", "vim", "nvim", "nano", "watch",
    "interactive shell", "pty", "tui", "terminal ui", "交互终端", "交互式", "终端界面",
    "就用 top", "就用 htop", "用 vim", "用 nano",
];

const INSISTENCE_HINTS: &[&str] = &[
    "just use", "must use", "need to use", "do not replace", "don't replace",
    "no fallback", "no substitute", "must be", "必须用", "就用", "一定用", "不要平替",
    "不要替代", "别换", "不要换", "不能换",
];

pub fn select_terminal_interaction_policy(input: &str) -> TerminalInteractionPolicy {
    let lowered = input.to_ascii_lowercase();
    let explicit_tui_request = contains_any(&lowered, TUI_HINTS) || contains_any(input, TUI_HINTS);
    let user_insistence = contains_any(&lowered, INSISTENCE_HINTS) || contains_any(input, INSISTENCE_HINTS);

    let mut reasons = Vec::new();
    let kind = if explicit_tui_request && user_insistence {
        reasons.push("user explicitly insisted on an interactive or TUI workflow".to_string());
        TerminalInteractionPolicyKind::RequireRequestedTui
    } else if explicit_tui_request {
        reasons.push("user referenced an interactive or TUI workflow without insisting on it".to_string());
        TerminalInteractionPolicyKind::AllowFallbackPty
    } else {
        reasons.push("default to non-interactive commands and direct alternatives unless the user insists".to_string());
        TerminalInteractionPolicyKind::AvoidTui
    };

    TerminalInteractionPolicy {
        kind,
        reasons,
        explicit_tui_request,
        user_insistence,
    }
}

pub fn classify_terminal_command(command: &str) -> TerminalCommandCategory {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return TerminalCommandCategory::OneShotNonInteractive;
    }

    let first = trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|ch: char| ch == '"' || ch == '\'');

    match first {
        "top" | "htop" | "btop" | "less" | "more" | "tig" | "gitui" | "lazygit" => {
            return TerminalCommandCategory::FullscreenTui;
        }
        "vim" | "nvim" | "nano" | "vi" | "emacs" => {
            return TerminalCommandCategory::ShellEditor;
        }
        "watch" => {
            return TerminalCommandCategory::LongRunningStream;
        }
        _ => {}
    }

    let lowered = trimmed.to_ascii_lowercase();
    if lowered.contains("read -p")
        || lowered.contains("select ")
        || lowered.contains("sudo ")
        || lowered.contains("passwd")
        || lowered.contains("ssh ")
    {
        return TerminalCommandCategory::InteractivePrompt;
    }

    TerminalCommandCategory::OneShotNonInteractive
}

pub fn rewrite_interactive_command_if_possible(command: &str) -> Option<TerminalRewriteAdvice> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }
    let first = trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|ch: char| ch == '"' || ch == '\'');

    match first {
        "top" | "htop" | "btop" => {
            let replacement = if cfg!(target_os = "macos") {
                "top -l 1 -n 0 && printf '\n' && ps -Ao pid,pcpu,pmem,comm -r | head".to_string()
            } else {
                "top -b -n 1 && printf '\n' && ps aux --sort=-%cpu | head".to_string()
            };
            Some(TerminalRewriteAdvice {
                replacement_command: Some(replacement),
                suggested_tool: None,
                reason: "prefer a one-shot system snapshot instead of a fullscreen TUI".to_string(),
            })
        }
        "less" | "more" => {
            let target = trimmed.split_whitespace().nth(1).unwrap_or("<file>");
            Some(TerminalRewriteAdvice {
                replacement_command: Some(format!("sed -n '1,220p' {target}")),
                suggested_tool: Some("filesystem.read_range".to_string()),
                reason: "prefer a bounded file read instead of a pager TUI".to_string(),
            })
        }
        "watch" => {
            let stripped = trimmed
                .strip_prefix("watch")
                .map(str::trim)
                .unwrap_or_default();
            let replacement = stripped
                .split_once(' ')
                .map(|(_, rest)| rest.trim())
                .filter(|value| !value.is_empty())
                .unwrap_or("date")
                .to_string();
            Some(TerminalRewriteAdvice {
                replacement_command: Some(replacement),
                suggested_tool: None,
                reason: "prefer a single bounded probe instead of a long-running watch loop".to_string(),
            })
        }
        "vim" | "nvim" | "nano" | "vi" | "emacs" => {
            Some(TerminalRewriteAdvice {
                replacement_command: None,
                suggested_tool: Some("filesystem.edit".to_string()),
                reason: "prefer direct file editing tools instead of launching a shell editor".to_string(),
            })
        }
        _ => None,
    }
}

pub fn terminal_policy_payload(policy: &TerminalInteractionPolicy) -> serde_json::Value {
    json!({
        "policy": policy.kind.as_str(),
        "reasons": policy.reasons,
        "explicitTuiRequest": policy.explicit_tui_request,
        "userInsistence": policy.user_insistence,
    })
}

fn contains_any(input: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| input.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_terminal_command, rewrite_interactive_command_if_possible,
        select_terminal_interaction_policy, TerminalCommandCategory,
        TerminalInteractionPolicyKind,
    };

    #[test]
    fn defaults_to_avoid_tui_for_plain_requests() {
        let policy = select_terminal_interaction_policy("看一下电脑现在状态怎么样");
        assert_eq!(policy.kind, TerminalInteractionPolicyKind::AvoidTui);
    }

    #[test]
    fn allows_fallback_pty_when_user_mentions_tui_without_insisting() {
        let policy = select_terminal_interaction_policy("可以用 htop 看看吗");
        assert_eq!(policy.kind, TerminalInteractionPolicyKind::AllowFallbackPty);
    }

    #[test]
    fn requires_requested_tui_when_user_insists() {
        let policy = select_terminal_interaction_policy("就用 htop，不要平替");
        assert_eq!(policy.kind, TerminalInteractionPolicyKind::RequireRequestedTui);
    }

    #[test]
    fn classifies_interactive_commands() {
        assert_eq!(classify_terminal_command("htop"), TerminalCommandCategory::FullscreenTui);
        assert_eq!(classify_terminal_command("less foo.log"), TerminalCommandCategory::FullscreenTui);
        assert_eq!(classify_terminal_command("vim file.ts"), TerminalCommandCategory::ShellEditor);
        assert_eq!(classify_terminal_command("watch -n 1 date"), TerminalCommandCategory::LongRunningStream);
    }

    #[test]
    fn provides_rewrite_advice_for_common_tui_commands() {
        let advice = rewrite_interactive_command_if_possible("top").expect("rewrite advice");
        assert!(advice.replacement_command.is_some());
    }
}
