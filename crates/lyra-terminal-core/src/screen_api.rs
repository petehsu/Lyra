use std::time::{Duration, Instant};

use serde_json::Value;

use crate::memory;
use crate::process_api::{signal_process, wait_command};
use crate::protocol::*;
use crate::query::*;
use crate::session_runtime::{
    observed_runtime_for_session, output_state, read_session, resize_session, runtime_for_session,
};
use crate::tui_act::{self, TuiActPlan};
use crate::tui_map;
use crate::{to_error, Result};

fn normalize_selected_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().chars().take(16_384).collect::<String>())
        .filter(|value| !value.is_empty())
}

fn active_command_from_memory(storage_root: Option<&str>, session_id: &str) -> Option<String> {
    storage_root
        .and_then(|root| memory::active_command_text(root, session_id).ok().flatten())
        .map(|value| value.trim().chars().take(8_192).collect::<String>())
        .filter(|value| !value.is_empty())
}

fn enrich_tui_regions(mut response: TerminalScreenReadResponse) -> TerminalScreenReadResponse {
    let (regions, _truncated) = tui_map::regions_from_screen_read(&response, None, true);
    response.regions = regions;
    response
}

pub(crate) fn read_screen(
    request: TerminalScreenReadRequest,
) -> Result<TerminalScreenReadResponse> {
    let selected_text = normalize_selected_text(request.selected_text.clone());
    let runtime = runtime_for_session(&request.session_id);
    let Some(runtime) = runtime else {
        if let Some(runtime) = observed_runtime_for_session(&request.session_id) {
            let storage_root = request
                .storage_root
                .as_deref()
                .unwrap_or(runtime.storage_root.as_str())
                .to_string();
            let snapshot = {
                let screen = runtime
                    .screen
                    .lock()
                    .map_err(|_| to_error("failed to lock observed terminal screen state"))?;
                screen.snapshot(
                    request.include_scrollback.unwrap_or(false),
                    request.max_rows,
                    request.max_bytes,
                )
            };
            let (lock, _) = &*runtime.state;
            let state = lock
                .lock()
                .map_err(|_| to_error("failed to lock observed terminal state"))?;
            let memory = memory::metadata_for_session(
                &storage_root,
                &runtime.session_id,
                snapshot.truncated,
            )
            .ok();
            let active_command =
                active_command_from_memory(Some(storage_root.as_str()), &runtime.session_id);
            return Ok(enrich_tui_regions(TerminalScreenReadResponse {
                session_id: runtime.session_id.clone(),
                cursor: snapshot.cursor,
                screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
                rows: snapshot.rows,
                cols: snapshot.cols,
                mode: snapshot.mode,
                visible_text: snapshot.visible_text,
                visible_rows: snapshot.visible_rows,
                scrollback_text: snapshot.scrollback_text,
                scrollback_cursor: snapshot.scrollback_cursor,
                scrollback_rows: snapshot.scrollback_rows,
                cursor_position: snapshot.cursor_position,
                cells: snapshot.cells,
                cells_truncated: snapshot.cells_truncated,
                styles: snapshot.styles,
                links: snapshot.links,
                input_modes: snapshot.input_modes,
                selected_text: selected_text.or(snapshot.selected_text),
                active_command: active_command.or(snapshot.active_command),
                prompt: snapshot.prompt,
                regions: snapshot.regions,
                running: state.running,
                exit_code: state.exit_code,
                truncated: snapshot.truncated,
                memory,
            }));
        }
        let storage_root = request
            .storage_root
            .clone()
            .ok_or_else(|| to_error("terminal screen read requires storageRoot"))?;
        let snapshot = memory::replay_screen_snapshot(
            &storage_root,
            &request.session_id,
            request.include_scrollback.unwrap_or(false),
            request.max_rows,
            request.max_bytes,
        )
        .map_err(to_error)?;
        let memory =
            memory::metadata_for_session(&storage_root, &request.session_id, snapshot.truncated)
                .ok();
        let active_command =
            active_command_from_memory(Some(storage_root.as_str()), &request.session_id);
        return Ok(enrich_tui_regions(TerminalScreenReadResponse {
            session_id: request.session_id.clone(),
            cursor: snapshot.cursor,
            screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
            rows: snapshot.rows,
            cols: snapshot.cols,
            mode: snapshot.mode,
            visible_text: snapshot.visible_text,
            visible_rows: snapshot.visible_rows,
            scrollback_text: snapshot.scrollback_text,
            scrollback_cursor: snapshot.scrollback_cursor,
            scrollback_rows: snapshot.scrollback_rows,
            cursor_position: snapshot.cursor_position,
            cells: snapshot.cells,
            cells_truncated: snapshot.cells_truncated,
            styles: snapshot.styles,
            links: snapshot.links,
            input_modes: snapshot.input_modes,
            selected_text: selected_text.or(snapshot.selected_text),
            active_command: active_command.or(snapshot.active_command),
            prompt: snapshot.prompt,
            regions: snapshot.regions,
            running: false,
            exit_code: memory::last_exit_code(&storage_root, &request.session_id)
                .ok()
                .flatten(),
            truncated: snapshot.truncated,
            memory,
        }));
    };
    let snapshot = {
        let screen = runtime
            .screen
            .lock()
            .map_err(|_| to_error("failed to lock terminal screen state"))?;
        screen.snapshot(
            request.include_scrollback.unwrap_or(false),
            request.max_rows,
            request.max_bytes,
        )
    };
    let state = output_state(&runtime)?;
    let memory = request
        .storage_root
        .as_deref()
        .or(runtime.storage_root.as_deref())
        .and_then(|storage_root| {
            memory::metadata_for_session(storage_root, &runtime.session_id, snapshot.truncated).ok()
        });
    let active_command = active_command_from_memory(
        request
            .storage_root
            .as_deref()
            .or(runtime.storage_root.as_deref()),
        &runtime.session_id,
    )
    .or_else(|| {
        if state.running && runtime.mode == "command" {
            runtime.command.clone()
        } else {
            None
        }
    });
    Ok(enrich_tui_regions(TerminalScreenReadResponse {
        session_id: runtime.session_id.clone(),
        cursor: snapshot.cursor,
        screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
        rows: snapshot.rows,
        cols: snapshot.cols,
        mode: snapshot.mode,
        visible_text: snapshot.visible_text,
        visible_rows: snapshot.visible_rows,
        scrollback_text: snapshot.scrollback_text,
        scrollback_cursor: snapshot.scrollback_cursor,
        scrollback_rows: snapshot.scrollback_rows,
        cursor_position: snapshot.cursor_position,
        cells: snapshot.cells,
        cells_truncated: snapshot.cells_truncated,
        styles: snapshot.styles,
        links: snapshot.links,
        input_modes: snapshot.input_modes,
        selected_text: selected_text.or(snapshot.selected_text),
        active_command: active_command.or(snapshot.active_command),
        prompt: snapshot.prompt,
        regions: snapshot.regions,
        running: state.running,
        exit_code: state.exit_code,
        truncated: snapshot.truncated,
        memory,
    }))
}

pub(crate) fn read_map(request: TerminalMapReadRequest) -> Result<TerminalMapReadResponse> {
    let mut screen = read_screen(TerminalScreenReadRequest {
        session_id: request.session_id.clone(),
        storage_root: request.storage_root.clone(),
        cursor: request.screen_cursor.clone(),
        include_scrollback: Some(false),
        max_rows: None,
        max_bytes: Some(64 * 1024),
        selected_text: None,
    })?;
    let include_text = request.include_text.unwrap_or(true);
    let (regions, regions_truncated) =
        tui_map::regions_from_screen_read(&screen, request.max_regions, include_text);
    let stale_warning =
        tui_map::stale_cursor_warning(request.screen_cursor.as_deref(), &screen.cursor);
    let warning = match (stale_warning, regions_truncated) {
        (Some(stale), true) => Some(format!("{stale}; region output truncated")),
        (Some(stale), false) => Some(stale),
        (None, true) => Some("region output truncated".to_string()),
        (None, false) => None,
    };
    screen.regions = regions.clone();
    Ok(TerminalMapReadResponse {
        session_id: request.session_id,
        memory: screen.memory.clone(),
        screen,
        regions,
        stale: Some(
            warning
                .as_deref()
                .is_some_and(|value| value.contains("stale")),
        ),
        warning,
    })
}

fn execute_tui_plan(
    session_id: &str,
    storage_root: Option<String>,
    actor_json: Option<String>,
    correlation_json: Option<String>,
    plan: &TuiActPlan,
) -> Result<Option<String>> {
    if plan.input_action == "read" {
        return Ok(None);
    }
    let keys = if !plan.keys.is_empty() {
        Some(plan.keys.clone())
    } else if plan.input_action == "selectRegion" {
        let key = match plan.target.as_ref().map(|target| target.kind.as_str()) {
            Some("checkbox" | "radio") => "space",
            _ => "enter",
        };
        Some(vec![key.to_string()])
    } else {
        None
    };
    let action = if keys.is_some() {
        "pressKeys"
    } else if plan.text.is_some() {
        "pasteText"
    } else {
        "submitInput"
    };
    let response = execute_input(TerminalInputExecuteRequest {
        session_id: session_id.to_string(),
        storage_root,
        action: action.to_string(),
        command: None,
        text: plan.text.clone(),
        actor_json,
        correlation_json: tui_plan_correlation(correlation_json, plan),
        append_newline: Some(plan.append_newline),
        bracketed_paste: Some(false),
        sensitive_refs: None,
        cols: None,
        rows: None,
        signal: None,
        reason: plan.reason.clone(),
        keys,
    })?;
    Ok(Some(response.input_id))
}

pub(crate) fn execute_act(
    request: TerminalActExecuteRequest,
) -> Result<TerminalActExecuteResponse> {
    let map = read_map(TerminalMapReadRequest {
        session_id: request.session_id.clone(),
        storage_root: request.storage_root.clone(),
        screen_cursor: request.screen_cursor.clone(),
        max_regions: Some(tui_map::MAX_REGIONS as u32),
        include_text: Some(true),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    })?;

    if map.stale.unwrap_or(false) {
        return Ok(TerminalActExecuteResponse {
            session_id: request.session_id,
            act_id: format!("terminal-act-{}", uuid::Uuid::new_v4()),
            status: "staleTarget".to_string(),
            input_id: None,
            permission_id: None,
            screen_cursor: Some(map.screen.cursor.clone()),
            map: Some(map),
            plan: None,
            warning: Some("TUI target is stale; refresh the map and retry".to_string()),
            memory: None,
        });
    }

    let outcome = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &map.screen.cursor,
            regions: &map.regions,
        },
        tui_act::TuiActRequest {
            action: request.action,
            region_id: request.region_id,
            screen_cursor: request.screen_cursor,
            text: request.text,
            direction: request.direction,
            amount: request.amount,
            reason: request.reason,
        },
    );

    match outcome {
        Ok(plan) => {
            let input_id = execute_tui_plan(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                &plan,
            )?;
            Ok(TerminalActExecuteResponse {
                session_id: request.session_id,
                act_id: format!("terminal-act-{}", uuid::Uuid::new_v4()),
                status: "executed".to_string(),
                input_id,
                permission_id: correlation_permission_id(request.correlation_json.as_deref()),
                screen_cursor: Some(plan.screen_cursor.clone()),
                map: None,
                plan: Some(plan),
                warning: None,
                memory: map.memory,
            })
        }
        Err(error) => {
            let status = match error.kind {
                tui_act::TuiActErrorKind::StaleTarget => "staleTarget",
                tui_act::TuiActErrorKind::UnsupportedAction => "notImplemented",
                _ => "error",
            };
            Ok(TerminalActExecuteResponse {
                session_id: request.session_id,
                act_id: format!("terminal-act-{}", uuid::Uuid::new_v4()),
                status: status.to_string(),
                input_id: None,
                permission_id: None,
                screen_cursor: Some(map.screen.cursor.clone()),
                map: if status == "staleTarget" {
                    Some(map)
                } else {
                    None
                },
                plan: None,
                warning: Some(error.message),
                memory: None,
            })
        }
    }
}

pub(crate) fn execute_input(
    request: TerminalInputExecuteRequest,
) -> Result<TerminalInputExecuteResponse> {
    let input_id = format!("terminal-input-{}", uuid::Uuid::new_v4());
    let permission_id = correlation_permission_id(request.correlation_json.as_deref());
    let action = request.action.trim().to_string();
    let mut events = vec![event_ref("input_intent")];
    match action.as_str() {
        "runCommand" => {
            let command = request
                .command
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| to_error("runCommand requires command"))?;
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                Some(command),
                None,
                true,
            )?;
        }
        "submitInput" => {
            let text = request
                .text
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| to_error("submitInput requires text"))?;
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                Some(text),
                None,
                request.append_newline.unwrap_or(true),
            )?;
        }
        "pasteText" => {
            let text = request
                .text
                .clone()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| to_error("pasteText requires text"))?;
            let text = if request.bracketed_paste.unwrap_or(false) {
                format!("\u{1b}[200~{text}\u{1b}[201~")
            } else {
                text
            };
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                Some(text),
                None,
                request.append_newline.unwrap_or(false),
            )?;
        }
        "pressKeys" => {
            let keys = request
                .keys
                .clone()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| to_error("pressKeys requires keys"))?;
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                None,
                Some(keys),
                false,
            )?;
        }
        "sendSignal" => {
            let signal = request
                .signal
                .clone()
                .ok_or_else(|| to_error("sendSignal requires signal"))?;
            let _ = signal_process(TerminalProcessSignalRequest {
                session_id: request.session_id.clone(),
                storage_root: request
                    .storage_root
                    .clone()
                    .ok_or_else(|| to_error("sendSignal requires storageRoot"))?,
                pid: None,
                signal,
                reason: request.reason.clone(),
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })?;
        }
        "resize" => {
            resize_session(TerminalResizeRequest {
                session_id: request.session_id.clone(),
                cols: request
                    .cols
                    .ok_or_else(|| to_error("resize requires cols"))?,
                rows: request
                    .rows
                    .ok_or_else(|| to_error("resize requires rows"))?,
                storage_root: request.storage_root.clone(),
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })?;
        }
        other => {
            return Ok(TerminalInputExecuteResponse {
                session_id: request.session_id.clone(),
                input_id,
                action: other.to_string(),
                status: "notImplemented".to_string(),
                permission_id,
                events,
                memory: request
                    .storage_root
                    .as_deref()
                    .and_then(|root| memory_json(root, &request.session_id, false)),
            });
        }
    }
    events.push(event_ref("input_expanded"));
    let memory = request
        .storage_root
        .as_deref()
        .and_then(|root| memory_json(root, &request.session_id, false));
    Ok(TerminalInputExecuteResponse {
        session_id: request.session_id,
        input_id,
        action,
        status: "executed".to_string(),
        permission_id,
        events,
        memory,
    })
}

pub(crate) fn wait_until(request: TerminalWaitUntilRequest) -> Result<TerminalWaitUntilResponse> {
    match request.target.as_str() {
        "command" => {
            let response = wait_command(TerminalCommandWaitRequest {
                session_id: request.session_id.clone(),
                storage_root: request.storage_root.clone(),
                command_id: request.command_id.clone(),
                status: request.status.clone(),
                timeout_ms: request.timeout_ms,
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })?;
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id,
                matched: response.reason != "timeout" && response.reason != "notFound",
                reason: "command".to_string(),
                cursor: None,
                screen_cursor: None,
                command_id: response.command_id,
                output: None,
                memory: response.memory,
            })
        }
        "screen" | "prompt" => {
            let timeout_ms = request.timeout_ms.unwrap_or(1_000).min(30_000);
            let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
            let runtime = runtime_for_session(&request.session_id);
            loop {
                let screen = read_screen(TerminalScreenReadRequest {
                    session_id: request.session_id.clone(),
                    storage_root: Some(request.storage_root.clone()),
                    cursor: request.screen_cursor.clone(),
                    include_scrollback: Some(false),
                    max_rows: None,
                    max_bytes: request.max_bytes,
                    selected_text: None,
                })?;
                let matched = if request.target == "prompt" {
                    screen
                        .prompt
                        .as_ref()
                        .is_some_and(|prompt| !prompt.trim().is_empty())
                } else {
                    text_projection_matches(
                        &screen.visible_text,
                        request.text.as_deref(),
                        request.regex.as_deref(),
                    )
                };
                if matched {
                    return Ok(TerminalWaitUntilResponse {
                        session_id: request.session_id,
                        matched: true,
                        reason: if request.target == "prompt" {
                            "prompt"
                        } else {
                            "screen"
                        }
                        .to_string(),
                        cursor: None,
                        screen_cursor: Some(screen.cursor),
                        command_id: None,
                        output: Some(screen.visible_text),
                        memory: screen.memory,
                    });
                }
                if Instant::now() >= deadline {
                    return Ok(TerminalWaitUntilResponse {
                        session_id: request.session_id,
                        matched: false,
                        reason: "timeout".to_string(),
                        cursor: None,
                        screen_cursor: Some(screen.cursor),
                        command_id: None,
                        output: Some(screen.visible_text),
                        memory: screen.memory,
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
                        .map_err(|_| to_error("failed to wait for terminal screen"))?;
                } else {
                    break;
                }
            }
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id.clone(),
                matched: false,
                reason: "timeout".to_string(),
                cursor: None,
                screen_cursor: request.screen_cursor,
                command_id: None,
                output: None,
                memory: memory_json(&request.storage_root, &request.session_id, false),
            })
        }
        "event" => {
            let response = memory::read_events(memory::EventsReadInput {
                storage_root: request.storage_root.clone(),
                session_id: request.session_id.clone(),
                cursor: request.cursor.clone(),
                limit: Some(1),
                kinds: None,
                actors: None,
                audit: None,
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })
            .map_err(to_error)?;
            let value: Value =
                serde_json::from_str(&response).map_err(|error| to_error(error.to_string()))?;
            let items = value
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id,
                matched: !items.is_empty(),
                reason: if items.is_empty() { "timeout" } else { "event" }.to_string(),
                cursor: value_string(&value, "nextCursor"),
                screen_cursor: None,
                command_id: None,
                output: None,
                memory: value
                    .get("memory")
                    .and_then(|memory| serde_json::to_string(memory).ok()),
            })
        }
        _ => {
            let response = read_session(TerminalReadRequest {
                session_id: request.session_id.clone(),
                cursor: request.cursor.clone(),
                max_bytes: request.max_bytes,
                wait_ms: request.timeout_ms,
                storage_root: Some(request.storage_root.clone()),
            })?;
            let matched = text_projection_matches(
                &response.output,
                request.text.as_deref(),
                request.regex.as_deref(),
            );
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id,
                matched,
                reason: if matched {
                    "output".to_string()
                } else {
                    response.reason.unwrap_or_else(|| "timeout".to_string())
                },
                cursor: Some(response.cursor),
                screen_cursor: None,
                command_id: None,
                output: Some(response.output),
                memory: response.memory,
            })
        }
    }
}
