use jcode_protocol::ServerEvent;

/// The internalized core owns the assistant identity. Lyra should not inject a
/// second GUI-only system prompt on top of that runtime prompt.
pub const JCODE_GUI_SYSTEM_PROMPT: &str = "";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JcodeGuiEvent {
    TextDelta(String),
    TextReplace(String),
    MessageEnd,
    ToolStarted {
        id: String,
        name: String,
        label: String,
    },
    ToolFinished {
        id: String,
        name: String,
        label: String,
        failed: bool,
    },
    TurnFinished,
    TurnFailed(String),
}

impl JcodeGuiEvent {
    pub fn from_server_event(event: &ServerEvent) -> Option<Self> {
        match event {
            ServerEvent::TextDelta { text } => Some(Self::TextDelta(text.clone())),
            ServerEvent::TextReplace { text } => Some(Self::TextReplace(text.clone())),
            ServerEvent::MessageEnd => Some(Self::MessageEnd),
            ServerEvent::ToolStart { id, name } | ServerEvent::ToolExec { id, name } => {
                Some(Self::ToolStarted {
                    id: id.clone(),
                    name: name.clone(),
                    label: live_tool_label(name),
                })
            }
            ServerEvent::ToolDone {
                id, name, error, ..
            } => Some(Self::ToolFinished {
                id: id.clone(),
                name: name.clone(),
                label: finished_tool_label(name, error.is_some()),
                failed: error.is_some(),
            }),
            ServerEvent::Interrupted => Some(Self::TurnFailed("interrupted".to_string())),
            ServerEvent::Done { .. } => Some(Self::TurnFinished),
            ServerEvent::Error { message, .. } => Some(Self::TurnFailed(message.clone())),
            _ => None,
        }
    }
}

pub fn live_tool_label(name: &str) -> String {
    match name {
        "read" | "open" | "ls" => "Reading".to_string(),
        "grep"
        | "glob"
        | "codesearch"
        | "agentgrep"
        | "lyra_search"
        | "session_search"
        | "conversation_search" => "Searching".to_string(),
        "bash" | "patch" | "apply_patch" | "edit" | "multiedit" | "write" => "Running".to_string(),
        "webfetch" | "websearch" => "Browsing".to_string(),
        other => format!("Running {other}"),
    }
}

pub fn finished_tool_label(name: &str, failed: bool) -> String {
    let verb = match name {
        "read" | "open" | "ls" => "Read",
        "grep"
        | "glob"
        | "codesearch"
        | "agentgrep"
        | "lyra_search"
        | "session_search"
        | "conversation_search" => "Searched",
        "webfetch" | "websearch" => "Browsed",
        _ => "Ran",
    };
    if failed {
        format!("{verb} with error")
    } else {
        verb.to_string()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JcodeRegisteredCommand {
    pub name: String,
    pub help: String,
    pub autocomplete: bool,
    pub remote_only: bool,
}

pub fn registered_commands_from_vendored_tui() -> Vec<JcodeRegisteredCommand> {
    const SOURCE: &str = include_str!("vendor/root_src/tui/app/state_ui_input_helpers.rs");
    SOURCE
        .lines()
        .filter_map(parse_registered_command_line)
        .collect()
}

fn parse_registered_command_line(line: &str) -> Option<JcodeRegisteredCommand> {
    let trimmed = line.trim();
    let (kind, rest) = trimmed
        .strip_prefix("RegisteredCommand::public(")
        .map(|rest| ("public", rest))
        .or_else(|| {
            trimmed
                .strip_prefix("RegisteredCommand::remote(")
                .map(|rest| ("remote", rest))
        })
        .or_else(|| {
            trimmed
                .strip_prefix("RegisteredCommand::hidden(")
                .map(|rest| ("hidden", rest))
        })?;
    let values = parse_two_string_args(rest)?;
    Some(JcodeRegisteredCommand {
        name: values.0,
        help: values.1,
        autocomplete: kind != "hidden",
        remote_only: kind == "remote",
    })
}

fn parse_two_string_args(input: &str) -> Option<(String, String)> {
    let mut values = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            continue;
        }
        let mut value = String::new();
        let mut escaped = false;
        for next in chars.by_ref() {
            if escaped {
                value.push(next);
                escaped = false;
                continue;
            }
            match next {
                '\\' => escaped = true,
                '"' => break,
                other => value.push(other),
            }
        }
        values.push(value);
        if values.len() == 2 {
            return Some((values.remove(0), values.remove(0)));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_jcode_server_events_to_gui_events() {
        assert_eq!(
            JcodeGuiEvent::from_server_event(&ServerEvent::TextDelta {
                text: "hi".to_string()
            }),
            Some(JcodeGuiEvent::TextDelta("hi".to_string()))
        );
        assert_eq!(
            JcodeGuiEvent::from_server_event(&ServerEvent::ToolStart {
                id: "tool-1".to_string(),
                name: "grep".to_string(),
            }),
            Some(JcodeGuiEvent::ToolStarted {
                id: "tool-1".to_string(),
                name: "grep".to_string(),
                label: "Searching".to_string(),
            })
        );
        assert_eq!(
            JcodeGuiEvent::from_server_event(&ServerEvent::ToolDone {
                id: "tool-1".to_string(),
                name: "grep".to_string(),
                output: "done".to_string(),
                error: None,
            }),
            Some(JcodeGuiEvent::ToolFinished {
                id: "tool-1".to_string(),
                name: "grep".to_string(),
                label: "Searched".to_string(),
                failed: false,
            })
        );
        assert_eq!(
            JcodeGuiEvent::from_server_event(&ServerEvent::Done { id: 7 }),
            Some(JcodeGuiEvent::TurnFinished)
        );
    }

    #[test]
    fn registered_commands_are_loaded_from_vendored_tui_source() {
        let commands = registered_commands_from_vendored_tui();
        assert!(commands.iter().any(|command| command.name == "/resume"));
        assert!(commands.iter().any(|command| command.name == "/account"));
        assert!(commands.iter().any(|command| command.name == "/model"));
        assert!(commands.iter().any(|command| command.name == "/config"));
        for removed in [
            "/changelog",
            "/reload",
            "/restart",
            "/rebuild",
            "/update",
            "/quit",
            "/debug-visual",
            "/screenshot-mode",
            "/screenshot",
            "/record",
            "/client-reload",
            "/server-reload",
            "/transcript",
            "/context",
            "/info",
            "/usage",
            "/swarm",
            "/z",
            "/zz",
            "/zzz",
            "/zstatus",
        ] {
            assert!(
                commands.iter().all(|command| command.name != removed),
                "{removed} should not be registered as a Lyra GUI slash command"
            );
        }
        assert!(commands.len() >= 32);
        assert_eq!(JCODE_GUI_SYSTEM_PROMPT, "");
    }
}
