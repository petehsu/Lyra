use serde::Serialize;
use std::io;
use std::process::Command;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSignal {
    pub name: String,
    pub number: Option<i32>,
    pub control_bytes: Vec<u8>,
    pub risk: String,
    pub requires_permission: bool,
    pub default_reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalDisposition {
    pub signal: TerminalSignal,
    pub delivery: String,
    pub cancellable: bool,
    pub records_process_signal_sent: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignalCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn parse_signal(value: &str) -> Option<TerminalSignal> {
    let normalized = value.trim().trim_start_matches('-').to_ascii_uppercase();
    let normalized = match normalized.as_str() {
        "2" => "SIGINT",
        "9" => "SIGKILL",
        "15" => "SIGTERM",
        "1" => "SIGHUP",
        "3" => "SIGQUIT",
        "INT" => "SIGINT",
        "KILL" => "SIGKILL",
        "TERM" => "SIGTERM",
        "HUP" => "SIGHUP",
        "QUIT" => "SIGQUIT",
        other => other,
    };
    let (number, control_bytes, risk, requires_permission, default_reason) = match normalized {
        "SIGINT" => (
            Some(2),
            vec![3],
            "shell",
            true,
            "interrupt foreground command",
        ),
        "SIGTERM" => (Some(15), Vec::new(), "dangerous", true, "terminate process"),
        "SIGKILL" => (Some(9), Vec::new(), "dangerous", true, "force kill process"),
        "SIGHUP" => (Some(1), Vec::new(), "dangerous", true, "hang up process"),
        "SIGQUIT" => (
            Some(3),
            vec![28],
            "dangerous",
            true,
            "quit foreground command",
        ),
        _ => return None,
    };
    Some(TerminalSignal {
        name: normalized.to_string(),
        number,
        control_bytes,
        risk: risk.to_string(),
        requires_permission,
        default_reason: default_reason.to_string(),
    })
}

pub fn signal_from_key(key: &str) -> Option<TerminalSignal> {
    match key.trim().to_ascii_lowercase().as_str() {
        "ctrl_c" | "ctrl-c" | "c-c" => parse_signal("SIGINT"),
        "ctrl_\\" | "ctrl_backslash" | "ctrl-\\" => parse_signal("SIGQUIT"),
        _ => None,
    }
}

pub fn disposition_for_signal(signal: &TerminalSignal, has_pty: bool) -> SignalDisposition {
    let can_deliver_as_input = has_pty && !signal.control_bytes.is_empty();
    SignalDisposition {
        signal: signal.clone(),
        delivery: if can_deliver_as_input {
            "pty_control_bytes".to_string()
        } else {
            "process_signal".to_string()
        },
        cancellable: matches!(signal.name.as_str(), "SIGINT" | "SIGTERM"),
        records_process_signal_sent: true,
    }
}

pub fn risk_hook_for_signal(signal: &TerminalSignal) -> String {
    match signal.name.as_str() {
        "SIGINT" => "interrupt_running_command",
        "SIGTERM" => "terminate_process_tree",
        "SIGKILL" => "force_kill_process_tree",
        "SIGHUP" => "hangup_process_tree",
        "SIGQUIT" => "quit_and_maybe_core_dump",
        _ => "signal_process",
    }
    .to_string()
}

pub fn planned_signal_command_for_platform(
    process_id: u32,
    signal: &TerminalSignal,
    platform: &str,
) -> Option<SignalCommand> {
    if platform == "windows" {
        let mut args = vec!["/PID".to_string(), process_id.to_string(), "/T".to_string()];
        if signal.name == "SIGKILL" {
            args.push("/F".to_string());
        }
        return Some(SignalCommand {
            program: "taskkill".to_string(),
            args,
        });
    }

    let number = signal.number?;
    Some(SignalCommand {
        program: "kill".to_string(),
        args: vec![format!("-{number}"), process_id.to_string()],
    })
}

pub fn send_signal(process_id: u32, signal: &TerminalSignal) -> io::Result<()> {
    let platform = if cfg!(windows) { "windows" } else { "unix" };
    let Some(command) = planned_signal_command_for_platform(process_id, signal, platform) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "signal has no platform command",
        ));
    };
    let status = Command::new(&command.program)
        .args(&command.args)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "{} exited with status {}",
            command.program,
            status
                .code()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        )))
    }
}
