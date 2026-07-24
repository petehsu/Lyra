use std::io::Write;

use crate::lifecycle::terminal_lifecycle;
use crate::process_model;
use crate::protocol::*;
use crate::session_runtime::{now_iso_like, output_state, runtime_for_session, runtime_process_id};
use crate::signals;
use crate::{to_error, Result};

pub(crate) fn read_processes(
    request: TerminalProcessesReadRequest,
) -> Result<TerminalProcessesReadResponse> {
    let runtime = runtime_for_session(&request.session_id);
    let state = runtime
        .as_ref()
        .and_then(|runtime| output_state(runtime).ok());
    let runtime_pid = runtime
        .as_ref()
        .and_then(|runtime| runtime_process_id(runtime));
    let pid = request.pid.or(runtime_pid);
    let include_tree = request.include_tree.unwrap_or(false);
    let running_hint = state
        .as_ref()
        .map(|state| state.running)
        .unwrap_or(pid.is_some());
    let snapshot = if include_tree {
        process_model::snapshot_process_tree(pid, None)
    } else {
        let processes = pid
            .map(|pid| {
                vec![process_model::ProcessInfo {
                    pid,
                    parent_pid: None,
                    process_group_id: None,
                    name: "pty".to_string(),
                    command: None,
                    status: if running_hint { "running" } else { "zombie" }.to_string(),
                }]
            })
            .unwrap_or_default();
        process_model::ProcessTreeSnapshot {
            captured_at: now_iso_like(),
            root_pid: pid,
            foreground_pid: pid,
            running: running_hint,
            limited: true,
            limited_reason: Some(
                "fast runtime snapshot; request includeTree=true for ps tree".to_string(),
            ),
            process_count: processes.len().min(u32::MAX as usize) as u32,
            processes,
        }
    };
    let running = state
        .as_ref()
        .map(|state| state.running)
        .unwrap_or(snapshot.running);
    let exit_code = state.as_ref().and_then(|state| state.exit_code);
    let signal = None;
    let mut processes = snapshot
        .processes
        .iter()
        .map(|process| TerminalProcessSnapshot {
            pid: process.pid,
            parent_pid: process.parent_pid,
            foreground: Some(snapshot.foreground_pid == Some(process.pid)),
            command_id: None,
            name: Some(process.name.clone()),
            command_line: process.command.clone(),
            cwd: None,
            running: process.status != "zombie",
            exit_code: None,
            signal: None,
            children: if include_tree { Some(Vec::new()) } else { None },
        })
        .collect::<Vec<_>>();
    if processes.is_empty() {
        if let Some(pid) = pid {
            processes.push(TerminalProcessSnapshot {
                pid,
                parent_pid: None,
                foreground: Some(true),
                command_id: None,
                name: Some("pty".to_string()),
                command_line: None,
                cwd: None,
                running,
                exit_code,
                signal: signal.clone(),
                children: if include_tree { Some(Vec::new()) } else { None },
            });
        }
    }
    Ok(TerminalProcessesReadResponse {
        session_id: request.session_id.clone(),
        pid,
        foreground_pid: snapshot.foreground_pid,
        running,
        exit_code,
        signal,
        limited: Some(snapshot.limited),
        processes,
        memory: None,
        lifecycle: Some(terminal_lifecycle(
            &request.session_id,
            "processes",
            running,
            exit_code,
            Some("processes"),
            None,
            None,
        )),
    })
}

pub(crate) fn signal_process(
    request: TerminalProcessSignalRequest,
) -> Result<TerminalProcessSignalResponse> {
    let signal = signals::parse_signal(&request.signal)
        .ok_or_else(|| to_error(format!("unsupported terminal signal: {}", request.signal)))?;
    let runtime = runtime_for_session(&request.session_id);
    let pid = request.pid.or_else(|| {
        runtime
            .as_ref()
            .and_then(|runtime| runtime_process_id(runtime))
    });
    let mut status = "sent".to_string();
    if let Some(runtime) = runtime
        .as_ref()
        .filter(|_| !signal.control_bytes.is_empty())
    {
        match runtime.writer.try_lock() {
            Ok(mut writer) => {
                writer
                    .write_all(&signal.control_bytes)
                    .map_err(|error| to_error(format!("pty signal write failed: {error}")))?;
                writer
                    .flush()
                    .map_err(|error| to_error(format!("pty signal flush failed: {error}")))?;
            }
            Err(_) => {
                if let Some(pid) = pid {
                    signals::send_signal(pid, &signal)
                        .map_err(|error| to_error(format!("process signal failed: {error}")))?;
                    status = "sentProcessSignalWriterBusy".to_string();
                } else {
                    status = "writerBusy".to_string();
                }
            }
        }
    } else if let Some(pid) = pid {
        signals::send_signal(pid, &signal)
            .map_err(|error| to_error(format!("process signal failed: {error}")))?;
    } else {
        status = "notImplemented".to_string();
    }
    Ok(TerminalProcessSignalResponse {
        session_id: request.session_id.clone(),
        pid,
        signal: signal.name,
        status,
        input_id: Some(format!("terminal-input-{}", uuid::Uuid::new_v4())),
        permission_id: crate::query::correlation_permission_id(request.correlation_json.as_deref()),
        memory: None,
    })
}
