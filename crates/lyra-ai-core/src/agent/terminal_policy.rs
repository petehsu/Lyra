use serde_json::json;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalInteractionPolicyKind {
    AvoidTui,
}

impl TerminalInteractionPolicyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AvoidTui => "avoid_tui",
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

pub fn select_terminal_interaction_policy() -> TerminalInteractionPolicy {
    TerminalInteractionPolicy {
        kind: TerminalInteractionPolicyKind::AvoidTui,
        reasons: vec![
            "terminal interaction policy is derived from the explicit terminal tool invocation, not from user text analysis".to_string(),
        ],
        explicit_tui_request: false,
        user_insistence: false,
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
                reason: "prefer a single bounded probe instead of a long-running watch loop"
                    .to_string(),
            })
        }
        "vim" | "nvim" | "nano" | "vi" | "emacs" => Some(TerminalRewriteAdvice {
            replacement_command: None,
            suggested_tool: Some("filesystem.edit".to_string()),
            reason: "prefer direct file editing tools instead of launching a shell editor"
                .to_string(),
        }),
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

#[cfg(test)]
mod tests {
    use super::{
        classify_terminal_command, rewrite_interactive_command_if_possible,
        select_terminal_interaction_policy, TerminalCommandCategory, TerminalInteractionPolicyKind,
    };

    #[test]
    fn defaults_to_avoid_tui_for_plain_requests() {
        let policy = select_terminal_interaction_policy();
        assert_eq!(policy.kind, TerminalInteractionPolicyKind::AvoidTui);
    }

    #[test]
    fn no_longer_infers_tui_intent_from_user_text() {
        let policy = select_terminal_interaction_policy();
        assert_eq!(policy.kind, TerminalInteractionPolicyKind::AvoidTui);
    }

    #[test]
    fn no_longer_infers_tui_insistence_from_user_text() {
        let policy = select_terminal_interaction_policy();
        assert_eq!(policy.kind, TerminalInteractionPolicyKind::AvoidTui);
    }

    #[test]
    fn classifies_interactive_commands() {
        assert_eq!(
            classify_terminal_command("htop"),
            TerminalCommandCategory::FullscreenTui
        );
        assert_eq!(
            classify_terminal_command("less foo.log"),
            TerminalCommandCategory::FullscreenTui
        );
        assert_eq!(
            classify_terminal_command("vim file.ts"),
            TerminalCommandCategory::ShellEditor
        );
        assert_eq!(
            classify_terminal_command("watch -n 1 date"),
            TerminalCommandCategory::LongRunningStream
        );
    }

    #[test]
    fn provides_rewrite_advice_for_common_tui_commands() {
        let advice = rewrite_interactive_command_if_possible("top").expect("rewrite advice");
        assert!(advice.replacement_command.is_some());
    }
}
