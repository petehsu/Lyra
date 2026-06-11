use std::io::Write;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::memory;
use crate::process_model;
use crate::protocol::*;
use crate::query::*;
use crate::session_runtime::{now_iso_like, output_state, runtime_for_session, runtime_process_id};
use crate::signals;
use crate::{to_error, Result, DEFAULT_READ_MAX_BYTES};

fn number_to_byte_offset(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    value.floor().min(u64::MAX as f64) as u64
}

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
    let command_id = latest_command_record(&request.storage_root, &request.session_id, None)
        .ok()
        .flatten()
        .and_then(|record| value_string(&record, "commandId"));
    let mut processes = snapshot
        .processes
        .iter()
        .map(|process| TerminalProcessSnapshot {
            pid: process.pid,
            parent_pid: process.parent_pid,
            foreground: Some(snapshot.foreground_pid == Some(process.pid)),
            command_id: if request.include_command.unwrap_or(true) {
                command_id.clone()
            } else {
                None
            },
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
                command_id,
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
        memory: memory_json(&request.storage_root, &request.session_id, false),
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
    let _ = memory::record_process_signal_sent(memory::ProcessSignalInput {
        storage_root: request.storage_root.clone(),
        session_id: request.session_id.clone(),
        signal: signal.name.clone(),
        reason: request
            .reason
            .unwrap_or_else(|| signal.default_reason.clone()),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    });
    Ok(TerminalProcessSignalResponse {
        session_id: request.session_id.clone(),
        pid,
        signal: signal.name,
        status,
        input_id: Some(format!("terminal-input-{}", uuid::Uuid::new_v4())),
        permission_id: correlation_permission_id(request.correlation_json.as_deref()),
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

pub(crate) fn read_command_status(
    request: TerminalCommandStatusRequest,
) -> Result<TerminalCommandStatusResponse> {
    let command = latest_command_record(
        &request.storage_root,
        &request.session_id,
        request.command_id.as_deref(),
    )?
    .and_then(|record| command_snapshot_from_record(&record, &request.session_id));
    let command_id = command
        .as_ref()
        .map(|command| command.command_id.clone())
        .or(request.command_id);
    Ok(TerminalCommandStatusResponse {
        session_id: request.session_id.clone(),
        command_id,
        command,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

pub(crate) fn wait_command(
    request: TerminalCommandWaitRequest,
) -> Result<TerminalCommandWaitResponse> {
    let timeout_ms = request.timeout_ms.unwrap_or(1_000).min(30_000);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
    let runtime = runtime_for_session(&request.session_id);
    loop {
        let status_response = read_command_status(TerminalCommandStatusRequest {
            session_id: request.session_id.clone(),
            storage_root: request.storage_root.clone(),
            command_id: request.command_id.clone(),
            include_output_summary: Some(false),
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
        })?;
        if let Some(command) = status_response.command.as_ref() {
            if status_matches(&command.status, request.status.as_deref()) {
                return Ok(TerminalCommandWaitResponse {
                    session_id: request.session_id.clone(),
                    command_id: Some(command.command_id.clone()),
                    status: command.status.clone(),
                    reason: if command.signal.is_some() {
                        "signal"
                    } else {
                        "status"
                    }
                    .to_string(),
                    exit_code: command.exit_code,
                    signal: command.signal.clone(),
                    memory: status_response.memory,
                });
            }
        } else if request.command_id.is_some() {
            return Ok(TerminalCommandWaitResponse {
                session_id: request.session_id.clone(),
                command_id: request.command_id.clone(),
                status: "unknown".to_string(),
                reason: "notFound".to_string(),
                exit_code: None,
                signal: None,
                memory: status_response.memory,
            });
        }
        if Instant::now() >= deadline {
            let command = status_response.command;
            return Ok(TerminalCommandWaitResponse {
                session_id: request.session_id.clone(),
                command_id: command
                    .as_ref()
                    .map(|command| command.command_id.clone())
                    .or(request.command_id.clone()),
                status: command
                    .as_ref()
                    .map(|command| command.status.clone())
                    .unwrap_or_else(|| "timeout".to_string()),
                reason: "timeout".to_string(),
                exit_code: command.as_ref().and_then(|command| command.exit_code),
                signal: command.as_ref().and_then(|command| command.signal.clone()),
                memory: status_response.memory,
            });
        }
        if let Some(runtime) = runtime.as_ref() {
            let (lock, condvar) = &*runtime.state;
            let state = lock
                .lock()
                .map_err(|_| to_error("failed to lock session state"))?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            let _ = condvar
                .wait_timeout(state, remaining.min(Duration::from_millis(250)))
                .map_err(|_| to_error("failed to wait for command status"))?;
        } else {
            break;
        }
    }
    Ok(TerminalCommandWaitResponse {
        session_id: request.session_id.clone(),
        command_id: request.command_id,
        status: "timeout".to_string(),
        reason: "timeout".to_string(),
        exit_code: None,
        signal: None,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

pub(crate) fn read_command_output(
    request: TerminalCommandOutputReadRequest,
) -> Result<TerminalCommandOutputReadResponse> {
    let command = latest_command_record(
        &request.storage_root,
        &request.session_id,
        Some(&request.command_id),
    )?
    .ok_or_else(|| to_error("terminal command not found"))?;
    let range_key = if request.raw.unwrap_or(false) {
        "rawOutputRange"
    } else {
        "outputTextRange"
    };
    let command_range = range_from_value(command.get(range_key))
        .ok_or_else(|| to_error("terminal command has no output range"))?;
    let command_start = number_to_byte_offset(command_range.start);
    let command_end = number_to_byte_offset(command_range.end);
    let relative_start = number_to_byte_offset(request.start.unwrap_or(0.0));
    let relative_end = request.end.map(number_to_byte_offset).unwrap_or_else(|| {
        relative_start
            .saturating_add(request.max_bytes.unwrap_or(DEFAULT_READ_MAX_BYTES as u32) as u64)
    });
    let absolute_start = command_start
        .saturating_add(relative_start)
        .min(command_end);
    let absolute_end = command_start.saturating_add(relative_end).min(command_end);
    let raw = memory::read_output_range(memory::OutputRangeReadInput {
        storage_root: request.storage_root.clone(),
        session_id: request.session_id.clone(),
        start: absolute_start,
        end: absolute_end,
        raw: request.raw.unwrap_or(false),
        audit: None,
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    })
    .map_err(to_error)?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| to_error(error.to_string()))?;
    Ok(TerminalCommandOutputReadResponse {
        session_id: request.session_id.clone(),
        command_id: request.command_id,
        raw: value.get("raw").and_then(Value::as_bool).unwrap_or(false),
        encoding: value_string(&value, "encoding").unwrap_or_else(|| "utf8".to_string()),
        requested_range: range_from_value(value.get("requestedRange")).unwrap_or(
            TerminalNumberRange {
                start: absolute_start as f64,
                end: absolute_end as f64,
            },
        ),
        range: range_from_value(value.get("range")).unwrap_or(TerminalNumberRange {
            start: absolute_start as f64,
            end: absolute_end as f64,
        }),
        next_start: value_f64(&value, "nextStart").unwrap_or(absolute_end as f64),
        byte_length: value_f64(&value, "byteLength").unwrap_or(0.0),
        total_bytes: value_f64(&value, "totalBytes").unwrap_or(0.0),
        output: value_string(&value, "output").unwrap_or_default(),
        raw_bytes_hex: value_string(&value, "rawBytesHex"),
        sha256: value_string(&value, "sha256"),
        truncated: value
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        memory: value
            .get("memory")
            .and_then(|memory| serde_json::to_string(memory).ok())
            .or_else(|| memory_json(&request.storage_root, &request.session_id, false)),
    })
}
