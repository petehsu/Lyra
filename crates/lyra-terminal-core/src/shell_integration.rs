use serde::Serialize;

const MAX_PENDING_OSC_BYTES: usize = 64 * 1024;

pub const OSC_PROMPT_START: &str = "133;A";
pub const OSC_PROMPT_END: &str = "133;B";
pub const OSC_COMMAND_START: &str = "133;C";
pub const OSC_COMMAND_END_PREFIX: &str = "133;D";
pub const OSC_LYRA_PROMPT_READY: &str = "633;LyraPrompt";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationConfig {
    pub enabled: bool,
    pub shell: String,
    pub family: Option<String>,
    pub script_asset: Option<String>,
    pub disabled_reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellIntegrationEventKind {
    PromptStart,
    PromptEnd,
    PromptReady,
    CommandStart,
    CommandEnd,
    CwdChanged,
    CommandId,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationEvent {
    pub kind: ShellIntegrationEventKind,
    pub raw: String,
    pub command_id: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub confidence: f64,
}

#[derive(Clone, Debug, Default)]
pub struct ShellIntegrationParser {
    pending: Vec<u8>,
}

impl ShellIntegrationParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<ShellIntegrationEvent> {
        self.pending.extend_from_slice(bytes);
        let mut events = Vec::new();

        loop {
            let Some(start) = find_osc_start(&self.pending) else {
                if self.pending.len() > MAX_PENDING_OSC_BYTES {
                    let keep_from = self.pending.len().saturating_sub(MAX_PENDING_OSC_BYTES / 2);
                    self.pending.drain(0..keep_from);
                }
                break;
            };
            if start > 0 {
                self.pending.drain(0..start);
            }

            let Some((end, terminator_len)) = find_osc_terminator(&self.pending, 2) else {
                if self.pending.len() > MAX_PENDING_OSC_BYTES {
                    self.pending.clear();
                }
                break;
            };

            let payload = String::from_utf8_lossy(&self.pending[2..end]).to_string();
            if let Some(event) = parse_osc_payload(&payload) {
                events.push(event);
            }
            self.pending.drain(0..end.saturating_add(terminator_len));
        }

        events
    }
}

pub fn shell_integration_config(shell: &str, disabled: bool) -> ShellIntegrationConfig {
    let family = shell_family(shell).map(ToString::to_string);
    let script_asset = family
        .as_deref()
        .and_then(integration_script_asset_name)
        .map(ToString::to_string);
    ShellIntegrationConfig {
        enabled: !disabled && script_asset.is_some(),
        shell: shell.to_string(),
        family,
        script_asset,
        disabled_reason: if disabled {
            Some("disabled_by_session_or_profile".to_string())
        } else {
            None
        },
    }
}

pub fn shell_family(shell: &str) -> Option<&'static str> {
    let name = shell
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell)
        .to_ascii_lowercase();
    match name.as_str() {
        "bash" | "bash.exe" => Some("bash"),
        "zsh" | "zsh.exe" => Some("zsh"),
        "fish" | "fish.exe" => Some("fish"),
        "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe" => Some("powershell"),
        _ => None,
    }
}

pub fn integration_script_asset_name(family: &str) -> Option<&'static str> {
    match family {
        "bash" => Some("bash-lyra.sh"),
        "zsh" => Some("zsh-lyra.sh"),
        "fish" => Some("fish-lyra.fish"),
        "powershell" => Some("powershell-lyra.ps1"),
        _ => None,
    }
}

pub fn integration_script_for_shell(shell: &str) -> Option<&'static str> {
    match shell_family(shell)? {
        "bash" => Some(include_str!("../assets/shell/bash-lyra.sh")),
        "zsh" => Some(include_str!("../assets/shell/zsh-lyra.sh")),
        "fish" => Some(include_str!("../assets/shell/fish-lyra.fish")),
        "powershell" => Some(include_str!("../assets/shell/powershell-lyra.ps1")),
        _ => None,
    }
}

pub fn powershell_integration_plan() -> &'static str {
    "PowerShell support is implemented with a profile-safe prompt wrapper and PSReadLine Enter hook that emit OSC 133 A/B/C/D, OSC 7 cwd, and Lyra OSC commandId markers without replacing the user's visual prompt."
}

fn find_osc_start(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == [0x1b, b']'])
}

fn find_osc_terminator(bytes: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut index = from;
    while index < bytes.len() {
        if bytes[index] == 0x07 {
            return Some((index, 1));
        }
        if index + 1 < bytes.len() && bytes[index] == 0x1b && bytes[index + 1] == b'\\' {
            return Some((index, 2));
        }
        index += 1;
    }
    None
}

fn parse_osc_payload(payload: &str) -> Option<ShellIntegrationEvent> {
    if payload.starts_with("7;") {
        return Some(ShellIntegrationEvent {
            kind: ShellIntegrationEventKind::CwdChanged,
            raw: payload.to_string(),
            command_id: None,
            command: None,
            cwd: parse_osc7_cwd(payload.strip_prefix("7;").unwrap_or_default()),
            exit_code: None,
            signal: None,
            confidence: 1.0,
        });
    }

    let fields = payload.split(';').collect::<Vec<_>>();
    match fields.as_slice() {
        ["133", "A", ..] => Some(simple_event(
            ShellIntegrationEventKind::PromptStart,
            payload,
            1.0,
        )),
        ["133", "B", ..] => Some(simple_event(
            ShellIntegrationEventKind::PromptEnd,
            payload,
            1.0,
        )),
        ["133", "C", rest @ ..] => {
            let params = parse_params(rest);
            Some(ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandStart,
                raw: payload.to_string(),
                command_id: params.command_id,
                command: params.command,
                cwd: params.cwd,
                exit_code: None,
                signal: None,
                confidence: 1.0,
            })
        }
        ["133", "D", rest @ ..] => {
            let leading_exit_code = rest
                .first()
                .and_then(|value| value.trim().parse::<i32>().ok());
            let params = if leading_exit_code.is_some() && !rest.is_empty() {
                parse_params(&rest[1..])
            } else {
                parse_params(rest)
            };
            Some(ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandEnd,
                raw: payload.to_string(),
                command_id: params.command_id,
                command: params.command,
                cwd: params.cwd,
                exit_code: leading_exit_code.or(params.exit_code),
                signal: params.signal,
                confidence: 1.0,
            })
        }
        ["633", "LyraPrompt", ..] => Some(simple_event(
            ShellIntegrationEventKind::PromptReady,
            payload,
            1.0,
        )),
        ["633", "CommandId", command_id, ..] => Some(ShellIntegrationEvent {
            kind: ShellIntegrationEventKind::CommandId,
            raw: payload.to_string(),
            command_id: Some(percent_decode(command_id)),
            command: None,
            cwd: None,
            exit_code: None,
            signal: None,
            confidence: 1.0,
        }),
        ["633", "CommandStart", rest @ ..] => {
            let params = parse_params(rest);
            Some(ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandStart,
                raw: payload.to_string(),
                command_id: params.command_id,
                command: params.command,
                cwd: params.cwd,
                exit_code: None,
                signal: None,
                confidence: 1.0,
            })
        }
        ["633", "CommandEnd", rest @ ..] => {
            let params = parse_params(rest);
            Some(ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandEnd,
                raw: payload.to_string(),
                command_id: params.command_id,
                command: params.command,
                cwd: params.cwd,
                exit_code: params.exit_code,
                signal: params.signal,
                confidence: 1.0,
            })
        }
        ["633", "Cwd", cwd, ..] => Some(ShellIntegrationEvent {
            kind: ShellIntegrationEventKind::CwdChanged,
            raw: payload.to_string(),
            command_id: None,
            command: None,
            cwd: Some(percent_decode(cwd)),
            exit_code: None,
            signal: None,
            confidence: 1.0,
        }),
        _ => None,
    }
}

fn simple_event(
    kind: ShellIntegrationEventKind,
    payload: &str,
    confidence: f64,
) -> ShellIntegrationEvent {
    ShellIntegrationEvent {
        kind,
        raw: payload.to_string(),
        command_id: None,
        command: None,
        cwd: None,
        exit_code: None,
        signal: None,
        confidence,
    }
}

#[derive(Default)]
struct ParsedParams {
    command_id: Option<String>,
    command: Option<String>,
    cwd: Option<String>,
    exit_code: Option<i32>,
    signal: Option<String>,
}

fn parse_params(params: &[&str]) -> ParsedParams {
    let mut parsed = ParsedParams::default();
    for param in params {
        let trimmed = param.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let decoded = percent_decode(value);
            match key {
                "commandId" | "command_id" | "id" => parsed.command_id = Some(decoded),
                "command" | "cmd" => parsed.command = Some(decoded),
                "cwd" => parsed.cwd = Some(decoded),
                "exitCode" | "exit_code" | "status" => {
                    parsed.exit_code = decoded.parse::<i32>().ok();
                }
                "signal" => parsed.signal = Some(decoded),
                _ => {}
            }
            continue;
        }
        if parsed.command_id.is_none() {
            parsed.command_id = Some(percent_decode(trimmed));
        }
    }
    parsed
}

fn parse_osc7_cwd(value: &str) -> Option<String> {
    if let Some(rest) = value.strip_prefix("file://") {
        let path_start = rest.find('/').unwrap_or(0);
        return Some(percent_decode(&rest[path_start..]));
    }
    Some(percent_decode(value))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}
