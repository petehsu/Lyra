use crate::protocol::{TerminalCommandSnapshot, TerminalLifecycleProjection};

fn terminal_exit_state(exit_code: Option<i32>, running: bool) -> String {
    if running {
        return "running".to_string();
    }
    match exit_code {
        Some(0) => "completed".to_string(),
        Some(_) => "failed".to_string(),
        None => "unknown".to_string(),
    }
}

fn command_state(status: Option<&str>, exit_code: Option<i32>, signal: Option<&str>) -> String {
    match status.unwrap_or("unknown") {
        "completed" => "completed".to_string(),
        "failed" => "failed".to_string(),
        "cancelled" => "cancelled".to_string(),
        "running" => "running".to_string(),
        "unknown" if signal.is_some() => "cancelled".to_string(),
        "unknown" => terminal_exit_state(exit_code, false),
        other => other.to_string(),
    }
}

fn waiting_reason(reason: Option<&str>) -> bool {
    matches!(reason, Some("timeout" | "wait" | "waiting"))
}

pub(crate) fn terminal_lifecycle(
    session_id: &str,
    phase: &str,
    running: bool,
    exit_code: Option<i32>,
    reason: Option<&str>,
    source: Option<&str>,
    mode: Option<&str>,
) -> TerminalLifecycleProjection {
    let waiting = running && waiting_reason(reason);
    TerminalLifecycleProjection {
        session_id: session_id.to_string(),
        state: if waiting {
            "waiting".to_string()
        } else {
            terminal_exit_state(exit_code, running)
        },
        phase: phase.to_string(),
        reason: reason.map(str::to_string),
        terminal_running: running,
        command_id: None,
        command_status: None,
        exit_code,
        signal: None,
        source: source.map(str::to_string),
        mode: mode.map(str::to_string),
        current_cwd: None,
        waiting,
        background: false,
    }
}

pub(crate) fn command_lifecycle(
    session_id: &str,
    phase: &str,
    command: Option<&TerminalCommandSnapshot>,
    reason: Option<&str>,
) -> TerminalLifecycleProjection {
    let waiting =
        command.is_some_and(|command| command.status == "running") && waiting_reason(reason);
    let state = if matches!(reason, Some("runtimeUnavailable")) {
        "runtimeUnavailable".to_string()
    } else if waiting {
        "waiting".to_string()
    } else {
        command
            .map(|command| {
                command_state(
                    Some(command.status.as_str()),
                    command.exit_code,
                    command.signal.as_deref(),
                )
            })
            .unwrap_or_else(|| "unknown".to_string())
    };
    TerminalLifecycleProjection {
        session_id: session_id.to_string(),
        state,
        phase: phase.to_string(),
        reason: reason.map(str::to_string),
        terminal_running: command.is_some_and(|command| command.status == "running"),
        command_id: command.map(|command| command.command_id.clone()),
        command_status: command.map(|command| command.status.clone()),
        exit_code: command.and_then(|command| command.exit_code),
        signal: command.and_then(|command| command.signal.clone()),
        source: None,
        mode: None,
        current_cwd: None,
        waiting,
        background: false,
    }
}

pub(crate) fn command_wait_lifecycle(
    session_id: &str,
    command_id: Option<&str>,
    status: &str,
    reason: &str,
    exit_code: Option<i32>,
    signal: Option<&str>,
) -> TerminalLifecycleProjection {
    let waiting = status == "running" && waiting_reason(Some(reason));
    TerminalLifecycleProjection {
        session_id: session_id.to_string(),
        state: if reason == "runtimeUnavailable" {
            "runtimeUnavailable".to_string()
        } else if waiting {
            "waiting".to_string()
        } else {
            command_state(Some(status), exit_code, signal)
        },
        phase: "command_wait".to_string(),
        reason: Some(reason.to_string()),
        terminal_running: status == "running",
        command_id: command_id.map(str::to_string),
        command_status: Some(status.to_string()),
        exit_code,
        signal: signal.map(str::to_string),
        source: None,
        mode: None,
        current_cwd: None,
        waiting,
        background: false,
    }
}

pub(crate) fn input_lifecycle(
    session_id: &str,
    action: &str,
    status: &str,
    reason: Option<&str>,
) -> TerminalLifecycleProjection {
    let state = match status {
        "executed" => "inputSent",
        "notImplemented" => "failed",
        other => other,
    };
    TerminalLifecycleProjection {
        session_id: session_id.to_string(),
        state: state.to_string(),
        phase: format!("input:{action}"),
        reason: reason.map(str::to_string),
        terminal_running: true,
        command_id: None,
        command_status: None,
        exit_code: None,
        signal: None,
        source: None,
        mode: None,
        current_cwd: None,
        waiting: false,
        background: false,
    }
}
