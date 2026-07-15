use super::*;
use crate::{ProviderFailure, ProviderFailureCategory, ProviderProtocolFailureKind};

pub(crate) fn resolved_tool_activity_input(mut input: Value, output: &Value) -> Value {
    let Some(input_object) = input.as_object_mut() else {
        return input;
    };
    for (source_key, target_key) in [
        ("tabId", "tabId"),
        ("targetMode", "targetMode"),
        ("workbenchTabId", "workbenchTabId"),
        ("browserTabId", "browserTabId"),
        ("elementId", "lumenElementId"),
        ("targetRef", "lumenTargetRef"),
        ("lumenTargetRef", "lumenTargetRef"),
        ("observationId", "lumenObservationId"),
        ("afterObservationId", "lumenObservationId"),
        ("sessionId", "followSessionId"),
        ("followSessionId", "followSessionId"),
        ("actionId", "followActionId"),
        ("followActionId", "followActionId"),
    ] {
        if let Some(value) = output.get(source_key)
            && !value.is_null()
        {
            input_object.insert(target_key.to_string(), value.clone());
        }
    }
    if let Some(kind) = output.get("kind").and_then(Value::as_str) {
        input_object.insert("resultKind".to_string(), Value::String(kind.to_string()));
    }
    if let Some(ok) = output.get("ok").and_then(Value::as_bool) {
        input_object.insert("resultOk".to_string(), Value::Bool(ok));
    }
    input
}

pub(crate) fn redacted_tool_raw_output(name: &str, action: &str, mut value: Value) -> Value {
    if name == "lyra_lumen" && action == "see" {
        if let Some(object) = value.as_object_mut() {
            object.remove("imageBase64");
            if let Some(screenshot) = object.get_mut("screenshot").and_then(Value::as_object_mut) {
                screenshot.remove("data");
            }
        }
    }
    value
}

pub(crate) fn invoke_host_capability(
    dispatcher: &Arc<HostCapabilityDispatcher>,
    method: &str,
    payload: Value,
) -> Result<Value, String> {
    let payload = serde_json::to_string(&payload)
        .map_err(|error| format!("Failed to serialize host capability payload: {error}"))?;
    let output = dispatcher(method.to_string(), payload)?;
    serde_json::from_str(&output)
        .map_err(|error| format!("Failed to deserialize host capability output: {error}"))
}

pub(crate) fn tool_activity(
    id: &str,
    name: &str,
    label: &str,
    status: &str,
    input: Value,
    output: Option<Value>,
    started_at: &str,
    finished_at: Option<String>,
) -> Value {
    let action = input
        .get("operation")
        .or_else(|| input.get("action"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let tool_path = input
        .get("toolPath")
        .or_else(|| input.get("tool_path"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| crate::native_backend::tools::tool_fs::path_for_activity(name, action));
    let domain = input
        .get("domain")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            tool_path
                .as_deref()
                .and_then(|path| path.trim_start_matches("/tools/").split('/').next())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });
    let manifest = tool_path.as_deref().and_then(|path| {
        crate::native_backend::tools::tool_fs::runtime_registry()
            .inspect_path(path)
            .ok()
    });
    let output_ref = output.as_ref();
    let manifest_title = output_ref
        .and_then(|value| value.get("manifestTitle"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| manifest.as_ref().map(|manifest| manifest.title.clone()))
        .or_else(|| inferred_activity_title(tool_path.as_deref(), action));
    let activity_kind = output_ref
        .and_then(|value| {
            value
                .get("activityKind")
                .or_else(|| value.pointer("/raw/activityKind"))
        })
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            manifest
                .as_ref()
                .map(|manifest| manifest.activity_kind.clone())
        })
        .or_else(|| inferred_activity_kind(tool_path.as_deref(), action));
    let renderer_hint = output_ref
        .and_then(|value| {
            value
                .get("rendererHint")
                .or_else(|| value.pointer("/raw/rendererHint"))
        })
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            manifest
                .as_ref()
                .map(|manifest| manifest.renderer_hint.clone())
        })
        .or_else(|| inferred_renderer_hint(tool_path.as_deref(), action));
    let trace_id = output_ref
        .and_then(|value| value.get("traceId"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            input
                .pointer("/toolOperation/traceId")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    let trace = output_ref
        .and_then(|value| value.get("trace"))
        .filter(|value| value.is_array())
        .cloned();
    let artifact_refs = output_ref
        .map(activity_artifact_refs)
        .filter(|value| value.as_array().is_some_and(|items| !items.is_empty()));
    let changes = output_ref
        .and_then(|value| value.get("changes"))
        .filter(|value| value.is_array())
        .cloned()
        .or_else(|| {
            output_ref
                .map(|value| activity_changes(tool_path.as_deref(), manifest.as_ref(), value))
                .filter(|value| value.as_array().is_some_and(|items| !items.is_empty()))
        });
    json!({
        "id": id,
        "name": name,
        "label": label,
        "status": status,
        "input": input,
        "output": output,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "toolPath": tool_path,
        "domain": domain,
        "operation": if action.is_empty() { Value::Null } else { Value::String(action.to_string()) },
        "manifestTitle": manifest_title,
        "activityKind": activity_kind,
        "rendererHint": renderer_hint,
        "traceId": trace_id,
        "trace": trace,
        "artifactRefs": artifact_refs,
        "changes": changes,
    })
}

fn inferred_activity_title(tool_path: Option<&str>, action: &str) -> Option<String> {
    match (tool_path, action) {
        (Some(path), _) if path.starts_with("/tools/filesystem/") => Some(
            match action {
                "read" => "Read file",
                "list" => "Listed files",
                "glob" => "Found files",
                "write" => "Wrote file",
                "edit" | "strict_edit" | "multiedit" | "apply_patch" => "Edited file",
                _ => return None,
            }
            .to_string(),
        ),
        _ => None,
    }
}

fn inferred_activity_kind(tool_path: Option<&str>, action: &str) -> Option<String> {
    match (tool_path, action) {
        (Some(path), "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch")
            if path.starts_with("/tools/filesystem/") =>
        {
            Some("edit".to_string())
        }
        (Some(path), "read") if path.starts_with("/tools/filesystem/") => Some("read".to_string()),
        (Some(path), "list" | "glob") if path.starts_with("/tools/filesystem/") => {
            Some("search".to_string())
        }
        _ => None,
    }
}

fn inferred_renderer_hint(tool_path: Option<&str>, action: &str) -> Option<String> {
    inferred_activity_kind(tool_path, action)
}

fn filesystem_operation_from_tool_path(path: &str) -> Option<&'static str> {
    match path {
        "/tools/filesystem/write_file" => Some("write"),
        "/tools/filesystem/edit_file" => Some("edit"),
        "/tools/filesystem/multi_edit" => Some("multiedit"),
        "/tools/filesystem/apply_patch" => Some("apply_patch"),
        _ => None,
    }
}

fn activity_artifact_refs(output: &Value) -> Value {
    let mut refs = Vec::new();
    for source in [Some(output), output.get("raw")] {
        let Some(source) = source else {
            continue;
        };
        for key in [
            "artifactRef",
            "rawArtifactRef",
            "diffArtifactRef",
            "projectionRef",
            "dataRef",
            "stdoutRef",
            "stderrRef",
            "stdoutArtifactRef",
            "stderrArtifactRef",
            "logArtifactRef",
            "pageArtifactRef",
            "screenshotArtifactRef",
            "pageshotArtifactRef",
        ] {
            if let Some(value) = source.get(key).filter(|value| value.is_object()) {
                refs.push(value.clone());
            }
        }
        if let Some(values) = source
            .get("artifactRefs")
            .or_else(|| source.get("artifacts"))
            .and_then(Value::as_array)
        {
            refs.extend(values.iter().filter(|value| value.is_object()).cloned());
        }
    }
    Value::Array(dedupe_activity_values(refs))
}

fn activity_changes(
    tool_path: Option<&str>,
    manifest: Option<&lyra_tool_fs_core::ToolManifest>,
    output: &Value,
) -> Value {
    let manifest_domain = manifest
        .map(|manifest| manifest.domain.as_str())
        .or_else(|| tool_path.and_then(|path| path.trim_start_matches("/tools/").split('/').next()))
        .unwrap_or_default();
    let manifest_operation = manifest
        .map(|manifest| manifest.operation.as_str())
        .or_else(|| tool_path.and_then(filesystem_operation_from_tool_path))
        .unwrap_or_default();
    if manifest_domain != "filesystem" {
        return Value::Array(Vec::new());
    }
    let changed_files = output
        .pointer("/raw/changedFiles")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if changed_files.is_empty() {
        return Value::Array(Vec::new());
    }
    let diff_ref = output
        .pointer("/raw/diffArtifactRef")
        .filter(|value| value.is_object())
        .cloned();
    Value::Array(
        changed_files
            .into_iter()
            .map(|file| {
                let operation = file
                    .get("operation")
                    .and_then(Value::as_str)
                    .unwrap_or(manifest_operation)
                    .to_string();
                let path = file.get("path").and_then(Value::as_str).map(str::to_string);
                json!({
                    "schemaVersion": lyra_tool_fs_core::TOOL_FS_SCHEMA_VERSION,
                    "changeId": format!("change-{}", Uuid::new_v4()),
                    "kind": "file",
                    "operation": operation,
                    "path": path,
                    "summary": "Filesystem mutation executed.",
                    "detail": file,
                    "reversible": true,
                    "beforeRef": Value::Null,
                    "afterRef": Value::Null,
                    "diffRef": diff_ref.clone(),
                    "toolPath": tool_path,
                })
            })
            .collect(),
    )
}

fn dedupe_activity_values(values: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| {
            serde_json::to_string(value)
                .ok()
                .is_none_or(|key| seen.insert(key))
        })
        .collect()
}

pub(crate) fn record_tool_activity(
    session_id: &str,
    turn_id: &str,
    mut tool: Value,
    event_kind: &str,
) {
    if let Some(input) = tool.get_mut("input").and_then(Value::as_object_mut) {
        input
            .entry("turnId".to_string())
            .or_insert_with(|| Value::String(turn_id.to_string()));
    }
    if event_kind == "toolFinished" {
        if let Some(tool_call_id) = tool.get("id").and_then(Value::as_str) {
            crate::native_backend::streaming_preview_state::clear_streaming_diff_preview_state(
                session_id,
                turn_id,
                tool_call_id,
            );
        }
    }
    let ui_message_id = tool_ui_message_id(session_id, turn_id, &tool);
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let mut committed_message = None;
            let mut changed = false;
            if let Some(session) = state.sessions.get_mut(session_id) {
                if event_kind == "toolStarted"
                    && let (Some(message_id), Some(tool_id)) = (
                        ui_message_id.as_deref(),
                        tool.get("id").and_then(Value::as_str),
                    )
                {
                    committed_message = append_tool_block_to_message(session, message_id, tool_id);
                }
                upsert_tool(&mut session.snapshot, tool.clone());
                if event_kind == "toolFinished" {
                    super::session_resilience::update_resilience_from_tool_finish(session, &tool);
                }
                record_rollback_file_candidates(session, turn_id, &tool);
                session.snapshot["follow"] = json!({
                    "running": true,
                    "activity": tool.get("label").and_then(Value::as_str).unwrap_or("Using Lyra tool")
                });
                touch_session(session);
                // toolStarted only updates in-memory state (tool block, tool
                // entry, follow activity). Persisting on toolStarted caused write
                // amplification: every tool start DELETEd+re-INSERTed the entire
                // dialog table. The durable save happens on toolFinished instead.
                if event_kind == "toolFinished" {
                    changed = true;
                }
            }
            if changed {
                let _ = state.save_state();
            }
            (callback, committed_message)
        }
        Err(_) => return,
    };
    if let Some(message) = committed_message {
        emit_with_callback(
            &callback,
            json!({
                "kind": "messageCommitted",
                "sessionId": session_id,
                "message": message,
            }),
        );
    }
    let mut event = json!({
        "kind": event_kind,
        "sessionId": session_id,
        "turnId": turn_id,
        "tool": tool,
    });
    if let Some(message_id) = ui_message_id.filter(|message_id| !message_id.is_empty()) {
        event["messageId"] = Value::String(message_id);
    }
    emit_with_callback(&callback, event);
    emit_with_callback(
        &callback,
        json!({
            "kind": "toolUpdated",
            "sessionId": session_id,
            "turnId": turn_id,
            "tool": tool,
        }),
    );
    if event_kind == "toolFinished" {
        if let Ok(state) = state().lock() {
            if let Some(trigger) = memory_trigger_from_tool(&tool, session_id, turn_id) {
                emit_memory_trigger(&state.root, trigger);
            }
        }
    }
}

fn append_tool_block_to_message(
    session: &mut NativeSession,
    message_id: &str,
    tool_id: &str,
) -> Option<Value> {
    let messages = session
        .snapshot
        .get_mut("messages")
        .and_then(Value::as_array_mut)?;
    let linked_elsewhere = messages.iter().any(|message| {
        message
            .get("blocks")
            .and_then(Value::as_array)
            .is_some_and(|blocks| {
                blocks.iter().any(|block| {
                    block.get("type").and_then(Value::as_str) == Some("tool")
                        && block.get("toolId").and_then(Value::as_str) == Some(tool_id)
                })
            })
    });
    if linked_elsewhere {
        return None;
    }
    let message = messages
        .iter_mut()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))?;
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([]);
    }
    let blocks = message.get_mut("blocks").and_then(Value::as_array_mut)?;
    let already_present = blocks.iter().any(|block| {
        block.get("type").and_then(Value::as_str) == Some("tool")
            && block.get("toolId").and_then(Value::as_str) == Some(tool_id)
    });
    if already_present {
        return None;
    }
    blocks.push(json!({
        "type": "tool",
        "id": format!("tool-{tool_id}"),
        "toolId": tool_id,
    }));
    Some(message.clone())
}

pub(crate) fn record_tool_progress(session_id: &str, turn_id: &str, tool: Value) {
    let ui_message_id = tool_ui_message_id(session_id, turn_id, &tool);
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let mut committed_message = None;
            if let Some(session) = state.sessions.get_mut(session_id) {
                if tool.get("status").and_then(Value::as_str) == Some("running")
                    && let (Some(message_id), Some(tool_id)) = (
                        ui_message_id.as_deref(),
                        tool.get("id").and_then(Value::as_str),
                    )
                {
                    committed_message = append_tool_block_to_message(session, message_id, tool_id);
                }
                upsert_tool(&mut session.snapshot, tool.clone());
                session.snapshot["follow"] = json!({
                    "running": true,
                    "activity": tool.get("label").and_then(Value::as_str).unwrap_or("Using Lyra tool")
                });
                touch_session(session);
            }
            // Progress frames are transient and can arrive many times per second
            // while the model streams tool arguments (write_file/edit_file live
            // previews). Persisting the full session on each frame ran
            // synchronously on the provider stream thread and throttled token
            // consumption to a crawl. Durable saves happen at tool boundaries
            // instead: record_tool_activity persists on toolFinished only.
            (callback, committed_message)
        }
        Err(_) => return,
    };
    if let Some(message) = committed_message {
        emit_with_callback(
            &callback,
            json!({
                "kind": "messageCommitted",
                "sessionId": session_id,
                "message": message,
            }),
        );
    }
    emit_with_callback(
        &callback,
        json!({
            "kind": "toolUpdated",
            "sessionId": session_id,
            "turnId": turn_id,
            "tool": tool,
        }),
    );
}

fn tool_ui_message_id(session_id: &str, turn_id: &str, tool: &Value) -> Option<String> {
    if tool.get("name").and_then(Value::as_str) == Some("clarification") {
        return None;
    }
    crate::native_backend::turns::active_ui_message_id(session_id, turn_id).or_else(|| {
        (tool.get("status").and_then(Value::as_str) == Some("running"))
            .then(|| {
                crate::native_backend::turns::emit_assistant_message_placeholder(
                    session_id, turn_id,
                )
            })
            .flatten()
    })
}

pub(crate) fn tool_started_at_for_call(session_id: &str, tool_call_id: &str) -> String {
    if let Ok(state) = state().lock() {
        if let Some(session) = state.sessions.get(session_id) {
            if let Some(tools) = session.snapshot.get("tools").and_then(Value::as_array) {
                for tool in tools {
                    if tool.get("id").and_then(Value::as_str) == Some(tool_call_id) {
                        if let Some(started_at) = tool.get("startedAt").and_then(Value::as_str) {
                            return started_at.to_string();
                        }
                    }
                }
            }
        }
    }
    now()
}

pub(crate) fn upsert_tool(snapshot: &mut Value, tool: Value) {
    if !snapshot.get("tools").is_some_and(Value::is_array) {
        snapshot["tools"] = Value::Array(Vec::new());
    }
    let Some(tools) = snapshot.get_mut("tools").and_then(Value::as_array_mut) else {
        return;
    };
    let id = tool.get("id").and_then(Value::as_str).unwrap_or_default();
    if let Some(existing) = tools
        .iter_mut()
        .find(|existing| existing.get("id").and_then(Value::as_str) == Some(id))
    {
        *existing = merge_tool_activity(existing, tool);
    } else {
        tools.push(tool);
    }
}

fn tool_output_richness(tool: &Value) -> usize {
    let output = tool.get("output").unwrap_or(&Value::Null);
    let raw = output.get("raw").unwrap_or(&Value::Null);
    let diff = raw
        .get("diff")
        .and_then(Value::as_str)
        .map(str::len)
        .unwrap_or(0);
    let content = output
        .get("content")
        .and_then(Value::as_str)
        .map(str::len)
        .unwrap_or(0)
        .min(5_000);
    let preview = if raw.get("preview").and_then(Value::as_bool) == Some(true) {
        10_000
    } else {
        0
    };
    preview + diff.saturating_mul(100) + content
}

fn terminal_tool_status(status: Option<&str>) -> bool {
    matches!(
        status,
        Some("completed" | "failed" | "cancelled" | "uncertain")
    )
}

fn merge_tool_activity(existing: &Value, incoming: Value) -> Value {
    let existing_status = existing.get("status").and_then(Value::as_str);
    let incoming_status = incoming.get("status").and_then(Value::as_str);
    if terminal_tool_status(existing_status) && incoming_status == Some("running") {
        return existing.clone();
    }

    let mut merged = existing.clone();
    if let (Some(target), Some(source)) = (merged.as_object_mut(), incoming.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    } else {
        merged = incoming.clone();
    }

    let incoming_output_richness = tool_output_richness(&incoming);
    if !(incoming_status != Some("running") && incoming_output_richness > 0)
        && tool_output_richness(existing) > incoming_output_richness
        && let Some(output) = existing.get("output")
    {
        merged["output"] = output.clone();
    }
    if let Some(started_at) = existing.get("startedAt").and_then(Value::as_str)
        && !started_at.is_empty()
    {
        merged["startedAt"] = Value::String(started_at.to_string());
    }
    if incoming.get("finishedAt").is_none()
        && let Some(finished_at) = existing.get("finishedAt")
    {
        merged["finishedAt"] = finished_at.clone();
    }
    merged
}

pub(crate) fn tool_runtime_turn_id(tool: &Value) -> Option<&str> {
    tool.pointer("/input/toolOperation/runtimeTurnId")
        .or_else(|| tool.pointer("/input/runtimeCancellation/turnId"))
        .or_else(|| tool.pointer("/input/turnId"))
        .and_then(Value::as_str)
}

pub(crate) fn finish_running_tools_for_turn(
    session: &mut NativeSession,
    turn_id: &str,
    status: &str,
    output: Value,
) {
    let finished_at = now();
    let Some(tools) = session
        .snapshot
        .get_mut("tools")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for tool in tools.iter_mut() {
        if tool.get("status").and_then(Value::as_str) != Some("running") {
            continue;
        }
        let tool_turn_id = tool_runtime_turn_id(tool);
        if tool_turn_id != Some(turn_id) {
            continue;
        }
        tool["status"] = Value::String(status.to_string());
        tool["finishedAt"] = Value::String(finished_at.clone());
        tool["output"] = output.clone();
    }
}

pub(crate) fn reconcile_orphan_running_tools(session: &mut NativeSession) -> bool {
    let turn_status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or("idle");
    let active_turn_id = session
        .snapshot
        .get("activeTurnId")
        .and_then(Value::as_str)
        .map(str::to_string);
    if turn_status == "running" && active_turn_id.is_some() {
        return false;
    }

    let finished_at = now();
    let Some(tools) = session
        .snapshot
        .get_mut("tools")
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    let mut changed = false;
    for tool in tools.iter_mut() {
        if tool.get("status").and_then(Value::as_str) != Some("running") {
            continue;
        }
        tool["status"] = Value::String("cancelled".to_string());
        tool["finishedAt"] = Value::String(finished_at.clone());
        tool["output"] = json!({
            "content": "Lyra marked this tool call as cancelled because its turn is no longer active."
        });
        changed = true;
    }
    changed
}

pub(crate) fn tool_label(name: &str, action: &str) -> String {
    match (name, action) {
        ("workbench", "list_tabs") => "Listed Workbench tabs",
        ("workbench", "read_workspace") => "Read Workbench workspace",
        ("workbench", "read_tab") => "Read Workbench tab",
        ("workbench", "capture_visual_evidence") => "Captured workspace visual evidence",
        ("workbench", "activate_tab") => "Activated Workbench tab",
        ("terminal", "list") => "Listed terminals",
        ("terminal", "create") => "Opened terminal",
        ("terminal", "read") => "Read terminal",
        ("terminal", "screen") => "Read terminal screen",
        ("terminal", "wait") => "Waited for terminal",
        ("terminal", "write") => "Wrote terminal input",
        ("terminal", "close") => "Closed terminal",
        ("terminal", "events") => "Read terminal events",
        ("terminal", "read_until") => "Waited for terminal condition",
        ("terminal", "run") => "Ran terminal command",
        ("terminal", "input") => "Sent terminal input",
        ("terminal", "keys") => "Pressed terminal keys",
        ("terminal", "resize") => "Resized terminal",
        ("terminal", "signal") => "Signaled terminal process",
        ("terminal", "processes") => "Read terminal processes",
        ("terminal", "command_status") => "Read terminal command status",
        ("terminal", "map") => "Mapped terminal screen",
        ("terminal", "act") => "Acted on terminal screen",
        ("terminal", "attach_agent") => "Attached Agent to terminal",
        ("terminal", "detach_agent") => "Detached Agent from terminal",
        ("memory", "remember") => "Updated memory",
        ("memory", "search") => "Searched memory",
        ("artifact", "read") => "Read Lyra artifact",
        ("file", "read") => "Read file",
        ("file", "list") => "Listed files",
        ("file", "glob") => "Matched files",
        ("file", "write") => "Wrote file",
        ("file", "edit") => "Edited file",
        ("file", "multiedit") => "Edited files",
        ("file", "apply_patch") => "Applied patch",
        ("shell", "run") => "Ran shell command",
        ("search", "project") => "Searched project",
        ("code", "search_text") => "Searched code text",
        ("code", "search_symbol") => "Searched code symbols",
        ("code", "graph_expand") => "Expanded code graph",
        ("lsp", "query") => "Queried LSP",
        ("web", "search") => "Searched web",
        ("web", "fetch") => "Fetched web page",
        ("todo", "read") => "Read todos",
        ("todo", "write") => "Updated todos",
        ("clarification", "ask") => "Asked for clarification",
        ("skills", "list") => "Listed Lyra skills",
        ("skills", "inspect") => "Inspected Lyra skill",
        ("skills", "activate") => "Activated Lyra skill",
        ("skills", "deactivate") => "Deactivated Lyra skill",
        ("mcp", _) => "Checked MCP capability",
        ("software", "list_capabilities") => "Listed Lyra software",
        ("software", "inspect_capability") => "Inspected Lyra software",
        ("software", "read_state") => "Read Lyra software state",
        ("software", "invoke_capability") => "Used Lyra software",
        ("lyra_lumen", "map") => "Mapped browser elements",
        ("lyra_lumen", "read") => "Read browser page",
        ("lyra_lumen", "see") => "Captured browser snapshot",
        ("lyra_lumen", "act") => "Acted on browser",
        ("lyra_lumen", "type") => "Typed in browser",
        ("lyra_lumen", "press") => "Pressed browser key",
        ("lyra_lumen", "submit") => "Submitted browser control",
        ("lyra_lumen", "wait") => "Waited for browser",
        ("lyra_lumen", "read_until") => "Read browser until condition",
        ("lyra_lumen", "navigate") => "Navigated browser",
        ("lyra_lumen", "reload") => "Reloaded browser page",
        ("lyra_lumen", "detect_qr") => "Detected browser QR codes",
        ("lyra_lumen", "reveal") => "Revealed browser controls",
        ("lyra_lumen", "focus_scan") => "Scanned browser focus",
        ("lyra_lumen", "follow_audit") => "Read browser follow audit",
        ("lyra_lumen", "explain_target") => "Explained browser target",
        ("lyra_lumen", "audit") => "Audited browser diagnostics",
        ("lyra_lumen", "elevate") => "Elevated browser to visible tab",
        _ => "Used Lyra tool",
    }
    .to_string()
}

pub(crate) fn format_terminal_output(action: &str, value: &Value) -> String {
    if action == "list" {
        let terminals = value
            .get("terminals")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if terminals.is_empty() {
            return "No terminal sessions are available.".to_string();
        }
        return terminals
            .iter()
            .take(20)
            .map(|terminal| {
                let target_type = terminal
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("terminal");
                let session_id = terminal
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-session");
                let title = terminal
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Terminal");
                format!("- {target_type} {title} ({session_id})")
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    let target_type = value
        .pointer("/target/type")
        .and_then(Value::as_str)
        .unwrap_or("terminal");
    let session_id = value
        .get("sessionId")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/target/sessionId").and_then(Value::as_str))
        .unwrap_or("unknown-session");
    let running = value
        .get("running")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let exit_code = value.get("exitCode").and_then(Value::as_i64);
    let reason = value.get("reason").and_then(Value::as_str);
    let output = value
        .get("output")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/screen/visibleText").and_then(Value::as_str))
        .unwrap_or("");
    let memory_output_path = value
        .pointer("/memory/outputTextPath")
        .and_then(Value::as_str);
    let memory_truncated = value
        .pointer("/memory/truncatedByProjection")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut lines = Vec::new();
    if let Some(lifecycle) = value
        .get("lifecycle")
        .or_else(|| value.pointer("/screen/lifecycle"))
        && let Some(line) = format_terminal_lifecycle_line(lifecycle)
    {
        lines.push(line);
    }
    lines.push(format!(
        "{target_type} terminal {session_id}: running={running} exitCode={}",
        exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "null".to_string())
    ));
    if let Some(reason) = reason {
        lines.push(format!("reason={reason}"));
    }
    if action == "screen" {
        let mode = value
            .pointer("/screen/mode")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let version = value
            .pointer("/screen/screenVersion")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        lines.push(format!("screenVersion={version} mode={mode}"));
    }
    if let Some(command_id) = value
        .get("commandId")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/command/commandId").and_then(Value::as_str))
    {
        lines.push(format!("commandId={command_id}"));
    }
    if let Some(input_id) = value.get("inputId").and_then(Value::as_str) {
        lines.push(format!("inputId={input_id}"));
    }
    if let Some(screen_version) = value
        .pointer("/map/screen/screenVersion")
        .or_else(|| value.pointer("/screen/screenVersion"))
        .and_then(Value::as_u64)
        && matches!(action, "map" | "act")
    {
        lines.push(format!("screenVersion={screen_version}"));
    }
    if let Some(regions) = value
        .get("regions")
        .or_else(|| value.pointer("/map/regions"))
        .and_then(Value::as_array)
        && matches!(action, "map" | "act")
    {
        let ids = regions
            .iter()
            .take(12)
            .filter_map(|region| region.get("regionId").and_then(Value::as_str))
            .collect::<Vec<_>>();
        if !ids.is_empty() {
            lines.push(format!("regions={}", ids.join(",")));
        }
    }
    if memory_truncated {
        if let Some(path) = memory_output_path {
            lines.push(format!("fullOutputPath={path}"));
        }
    }
    if !output.trim().is_empty() {
        lines.push(output.to_string());
    }
    lines.join("\n")
}

fn format_terminal_lifecycle_line(lifecycle: &Value) -> Option<String> {
    let state = lifecycle.get("state").and_then(Value::as_str)?;
    let phase = lifecycle
        .get("phase")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let reason = lifecycle
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("none");
    let terminal_running = lifecycle
        .get("terminalRunning")
        .and_then(Value::as_bool)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let command_status = lifecycle
        .get("commandStatus")
        .and_then(Value::as_str)
        .unwrap_or("none");
    let command_id = lifecycle
        .get("commandId")
        .and_then(Value::as_str)
        .unwrap_or("none");
    let exit_code = lifecycle
        .get("exitCode")
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let waiting = lifecycle
        .get("waiting")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let background = lifecycle
        .get("background")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Some(format!(
        "lifecycle state={state} phase={phase} reason={reason} terminalRunning={terminal_running} commandStatus={command_status} commandId={command_id} exitCode={exit_code} waiting={waiting} background={background}"
    ))
}

pub(crate) fn format_tool_output(name: &str, action: &str, value: &Value) -> String {
    if name == "workbench" {
        return format_workbench_output(action, value);
    }
    if name == "terminal" {
        return format_terminal_output(action, value);
    }
    if name == "lyra_lumen" {
        return format_lumen_output(action, value);
    }
    if name == "software" {
        return format_software_output(action, value);
    }
    if name == "memory" {
        return format_memory_output(action, value);
    }
    serde_json::to_string_pretty(value).unwrap_or_else(|_| String::new())
}

pub(crate) fn execute_skill_state_change(name: &str, input: &Value) -> Result<Value, String> {
    match name {
        "skill_list" => skill_list().map_err(|error| error.to_string()),
        "skill_inspect" => skill_inspect(input.clone()).map_err(|error| error.to_string()),
        "skill_activate" => {
            set_skill_active(input.clone(), true).map_err(|error| error.to_string())
        }
        "skill_deactivate" => {
            set_skill_active(input.clone(), false).map_err(|error| error.to_string())
        }
        "skill_install_local" => {
            skill_install_from_local(input.clone()).map_err(|error| error.to_string())
        }
        "skill_install_git" => {
            skill_install_from_git(input.clone()).map_err(|error| error.to_string())
        }
        "skill_install_store" => {
            skill_install_from_store(input.clone()).map_err(|error| error.to_string())
        }
        "skill_uninstall" => skill_uninstall(input.clone()).map_err(|error| error.to_string()),
        _ => Err(format!("Unknown Lyra skill tool: {name}")),
    }
}

pub(crate) fn format_skill_output(action: &str, value: &Value) -> String {
    match action {
        "list" => {
            let skills = value
                .get("skills")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let lines = skills
                .iter()
                .take(8)
                .map(format_skill_line)
                .collect::<Vec<_>>();
            if lines.is_empty() {
                "No Lyra skills are installed.".to_string()
            } else {
                format!("Listed {} Lyra skills:\n{}", skills.len(), lines.join("\n"))
            }
        }
        "inspect" => value
            .get("skill")
            .map(format_skill_detail)
            .unwrap_or_else(|| "Inspected Lyra skill.".to_string()),
        "activate" => value
            .get("skill")
            .map(|skill| format!("Activated Lyra skill:\n{}", format_skill_detail(skill)))
            .unwrap_or_else(|| "Activated Lyra skill.".to_string()),
        "deactivate" => value
            .get("skill")
            .map(|skill| format!("Deactivated Lyra skill:\n{}", format_skill_detail(skill)))
            .unwrap_or_else(|| "Deactivated Lyra skill.".to_string()),
        "install_local" | "install_git" | "install_store" => value
            .get("skill")
            .map(|skill| format!("Installed Lyra skill:\n{}", format_skill_detail(skill)))
            .unwrap_or_else(|| "Installed Lyra skill.".to_string()),
        "uninstall" => {
            let skill_id = value
                .get("skillId")
                .and_then(Value::as_str)
                .unwrap_or("skill");
            let removed = value
                .get("removed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            format!("Uninstalled Lyra skill {skill_id}: removed={removed}")
        }
        _ => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

fn format_skill_line(skill: &Value) -> String {
    let id = skill.get("id").and_then(Value::as_str).unwrap_or("unknown");
    let name = skill.get("name").and_then(Value::as_str).unwrap_or(id);
    let active = if skill
        .get("active")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        "active"
    } else {
        "inactive"
    };
    let description = skill
        .get("description")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("No description");
    format!("- {id} ({name}) [{active}]: {description}")
}

fn format_string_array(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "none".to_string())
}

fn format_skill_detail(skill: &Value) -> String {
    let id = skill.get("id").and_then(Value::as_str).unwrap_or("unknown");
    let name = skill.get("name").and_then(Value::as_str).unwrap_or(id);
    let active = skill
        .get("active")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let description = skill
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let prompt_excerpt = skill
        .get("promptExcerpt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let resource_root = skill
        .get("resourceRoot")
        .and_then(Value::as_str)
        .unwrap_or_default();
    format!(
        "{id} ({name}) active={active}\ndescription: {description}\npermissions: {}\ntoolPaths: {}\nresourceRoot: {resource_root}\npromptExcerpt: {prompt_excerpt}",
        format_string_array(skill, "/permissions"),
        format_string_array(skill, "/toolPaths")
    )
}

pub(crate) fn format_memory_output(action: &str, value: &Value) -> String {
    if action == "remember" {
        let fact = value
            .pointer("/record/fact")
            .or_else(|| value.pointer("/record/content/fact"))
            .and_then(Value::as_str)
            .unwrap_or("memory updated");
        return format!("Remembered: {fact}");
    }
    if action == "update" {
        let fact = value
            .pointer("/record/fact")
            .and_then(Value::as_str)
            .unwrap_or("memory updated");
        return format!("Updated memory: {fact}");
    }
    if action == "forget" {
        let id = value
            .pointer("/result/id")
            .and_then(Value::as_str)
            .unwrap_or("memory");
        return format!("Forgot {id}");
    }
    if action == "link" {
        let target = value
            .pointer("/relation/targetId")
            .and_then(Value::as_str)
            .unwrap_or("memory");
        return format!("Linked memory to {target}");
    }
    let records = value
        .get("records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let session_recall_records = value
        .pointer("/sessionRecall/records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if records.is_empty() && session_recall_records.is_empty() {
        return "No matching memory records.".to_string();
    }
    let mut lines = records
        .iter()
        .take(10)
        .map(|record| {
            let fact = record
                .get("fact")
                .or_else(|| record.pointer("/content/fact"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| serde_json::to_string(record).unwrap_or_default());
            let Some(score) = record.get("score").and_then(Value::as_f64) else {
                return fact;
            };
            let matched_by = record
                .pointer("/scoreBreakdown/matchedBy")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "ranked".to_string());
            let decay = record
                .pointer("/scoreBreakdown/decayPenalty")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            format!("{fact} [score={score:.3}; matched={matched_by}; decay={decay:.3}]")
        })
        .collect::<Vec<_>>();
    lines.extend(session_recall_records.iter().take(10).map(|record| {
        let content = record
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("recalled session message");
        let role = record
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("message");
        let session = record
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or("unknown-session");
        let source = record
            .get("sourceId")
            .and_then(Value::as_str)
            .unwrap_or("unknown-source");
        let score = record.get("score").and_then(Value::as_f64).unwrap_or(0.0);
        format!("Session recall ({role}; session={session}; source={source}; score={score:.3}): {content}")
    }));
    lines.join("\n")
}

pub(crate) fn format_workbench_output(action: &str, value: &Value) -> String {
    match action {
        "list_tabs" => value
            .get("tabs")
            .and_then(Value::as_array)
            .map(|tabs| format_workbench_tabs(tabs))
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "read_workspace" => value
            .get("visibleTabs")
            .and_then(Value::as_array)
            .map(|tabs| {
                tabs.iter()
                    .map(|entry| {
                        let tab = entry.get("tab").unwrap_or(&Value::Null);
                        let header = format_workbench_tab_header(tab);
                        let excerpt = workbench_observation_excerpt(entry);
                        if excerpt.is_empty() {
                            header
                        } else {
                            format!("{header}\n{excerpt}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n---\n\n")
            })
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "read_tab" => {
            let tab = value.get("tab").unwrap_or(&Value::Null);
            let header = format_workbench_tab_header(tab);
            let excerpt = workbench_observation_excerpt(value);
            if excerpt.is_empty() {
                header
            } else {
                format!("{header}\n{excerpt}")
            }
        }
        "capture_visual_evidence" => {
            let scope = value
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("workspace_window");
            let width = value.get("width").and_then(Value::as_u64).unwrap_or(0);
            let height = value.get("height").and_then(Value::as_u64).unwrap_or(0);
            let artifact = value.get("imageArtifact").unwrap_or(&Value::Null);
            let path = artifact
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("visual evidence artifact");
            format!("Captured {scope} visual evidence ({width}x{height})\n{path}")
        }
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| String::new()),
    }
}

pub(crate) fn format_workbench_tabs(tabs: &[Value]) -> String {
    tabs.iter()
        .map(|tab| {
            let title = tab
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled");
            let tab_id = tab
                .get("tabId")
                .or_else(|| tab.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("-");
            let page_kind = tab.get("pageKind").and_then(Value::as_str).unwrap_or("tab");
            let observation_kind = tab
                .get("observationKind")
                .or_else(|| tab.get("appId"))
                .and_then(Value::as_str)
                .unwrap_or(page_kind);
            let flags = workbench_flags(tab);
            let url = tab.get("url").and_then(Value::as_str).unwrap_or("");
            if url.is_empty() {
                format!("- {title} [{tab_id}] {page_kind} ({observation_kind}) flags={flags}")
            } else {
                format!(
                    "- {title} [{tab_id}] {page_kind} ({observation_kind}) flags={flags} | {url}"
                )
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_workbench_tab_header(tab: &Value) -> String {
    let title = tab
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled");
    let tab_id = tab
        .get("tabId")
        .or_else(|| tab.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("-");
    let kind = tab
        .get("observationKind")
        .or_else(|| tab.get("pageKind"))
        .or_else(|| tab.get("appId"))
        .and_then(Value::as_str)
        .unwrap_or("tab");
    format!("{title} [{tab_id}] ({kind})")
}

pub(crate) fn workbench_flags(tab: &Value) -> String {
    let mut flags = Vec::new();
    for (key, label) in [
        ("active", "active"),
        ("visible", "visible"),
        ("focusedPane", "focused"),
        ("observable", "observable"),
    ] {
        if tab.get(key).and_then(Value::as_bool).unwrap_or(false) {
            flags.push(label);
        }
    }
    if flags.is_empty() {
        "none".to_string()
    } else {
        flags.join(",")
    }
}

pub(crate) fn workbench_observation_excerpt(value: &Value) -> String {
    let observation = value.get("observation").unwrap_or(value);
    for path in [
        "/content",
        "/text",
        "/excerpt",
        "/preview",
        "/summary",
        "/body",
        "/terminalText",
    ] {
        if let Some(text) = observation.pointer(path).and_then(Value::as_str)
            && !text.trim().is_empty()
        {
            return text.trim().to_string();
        }
    }
    serde_json::to_string_pretty(observation).unwrap_or_else(|_| String::new())
}

pub(crate) fn format_software_output(action: &str, value: &Value) -> String {
    match action {
        "list_capabilities" => {
            let software = value
                .get("software")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if software.is_empty() {
                return "No Lyra software capabilities are currently available.".to_string();
            }
            software
                .iter()
                .map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str).unwrap_or("-");
                    let title = entry.get("title").and_then(Value::as_str).unwrap_or(id);
                    let action_count = entry
                        .get("actions")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0);
                    format!("- {title} [{id}] actions={action_count}")
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "inspect_capability" => {
            let software = value.get("software").unwrap_or(value);
            let software_id = software.get("id").and_then(Value::as_str).unwrap_or("-");
            let title = software
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(software_id);
            let action = value.get("action");
            let mut lines = vec![format!("Lyra software {title} [{software_id}]")];
            if let Some(action) = action {
                let action_id = action.get("id").and_then(Value::as_str).unwrap_or("-");
                let action_title = action
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(action_id);
                let risk = action.get("risk").and_then(Value::as_str).unwrap_or("read");
                lines.push(format!(
                    "Capability {action_title} [{action_id}] risk={risk}"
                ));
                if let Some(schema) = action.get("inputSchema") {
                    lines.push(format!(
                        "Input schema: {}",
                        serde_json::to_string(schema).unwrap_or_default()
                    ));
                }
            } else if let Some(actions) = software.get("actions").and_then(Value::as_array) {
                lines.push(format!("Capabilities: {}", actions.len()));
                for action in actions.iter().take(20) {
                    let action_id = action.get("id").and_then(Value::as_str).unwrap_or("-");
                    let action_title = action
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or(action_id);
                    lines.push(format!("- {action_title} [{action_id}]"));
                }
            }
            if let Some(state) = value.get("readableState") {
                lines.push(format!(
                    "Readable state: {}",
                    serde_json::to_string(state).unwrap_or_default()
                ));
            }
            lines.join("\n")
        }
        "read_state" => value
            .get("state")
            .or_else(|| value.get("readableState"))
            .map(|state| serde_json::to_string_pretty(state).unwrap_or_default())
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "invoke_capability" => {
            let software_id = value
                .get("softwareId")
                .and_then(Value::as_str)
                .unwrap_or("-");
            let action_id = value
                .get("actionId")
                .or_else(|| value.get("capabilityId"))
                .and_then(Value::as_str)
                .unwrap_or("-");
            if let Some(output) = value.get("output") {
                format!(
                    "Invoked {software_id}/{action_id}\n{}",
                    serde_json::to_string_pretty(output).unwrap_or_default()
                )
            } else {
                format!("Invoked {software_id}/{action_id}")
            }
        }
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| String::new()),
    }
}

pub(crate) fn format_lumen_output(action: &str, value: &Value) -> String {
    match action {
        "map" => {
            let observation_id = value
                .get("observationId")
                .and_then(Value::as_str)
                .unwrap_or("observation");
            let title = value.get("title").and_then(Value::as_str).unwrap_or("page");
            let url = value.get("url").and_then(Value::as_str).unwrap_or("");
            let mut lines = vec![if url.is_empty() {
                format!("Observation {observation_id} (map) for {title}")
            } else {
                format!("Observation {observation_id} (map) for {title} - {url}")
            }];
            if let Some(elements) = value.get("elements").and_then(Value::as_array) {
                for element in elements.iter().take(30) {
                    let id = element
                        .get("id")
                        .or_else(|| element.get("elementId"))
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let role = element
                        .get("role")
                        .and_then(Value::as_str)
                        .unwrap_or("element");
                    let label = element
                        .get("label")
                        .or_else(|| element.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let target_ref = element
                        .get("targetRef")
                        .or_else(|| element.pointer("/target/targetRef"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let bounds = element.get("bounds").unwrap_or(&Value::Null);
                    let x = bounds.get("x").and_then(Value::as_i64).unwrap_or(0);
                    let y = bounds.get("y").and_then(Value::as_i64).unwrap_or(0);
                    let width = bounds.get("width").and_then(Value::as_i64).unwrap_or(0);
                    let height = bounds.get("height").and_then(Value::as_i64).unwrap_or(0);
                    let id_note = if target_ref.is_empty() {
                        format!("[{id} observation-local]")
                    } else {
                        format!("[{id} observation-local; targetRef={target_ref}]")
                    };
                    lines.push(format!(
                        "{id_note} {role}: \"{label}\" at ({x},{y}) {width}x{height}"
                    ));
                }
            }
            if let Some(compaction) = value.get("mapCompaction") {
                if let Some(summary) = compaction.get("summary").and_then(Value::as_str) {
                    if !summary.trim().is_empty() {
                        lines.push(summary.to_string());
                    }
                }
            }
            if let Some(appendix) = value.get("mapAppendix").and_then(Value::as_str) {
                if !appendix.trim().is_empty() {
                    lines.push(appendix.to_string());
                }
            } else if let Some(scroll_hints) = value.get("scrollHints").and_then(Value::as_array) {
                if !scroll_hints.is_empty() {
                    let total_hidden = scroll_hints.len();
                    let remaining = value
                        .get("hiddenBelowCount")
                        .and_then(Value::as_u64)
                        .map(|count| count.saturating_sub(total_hidden as u64))
                        .unwrap_or(0);
                    if remaining > 0 {
                        lines.push(format!(
                            "... ({remaining} more element{} below - scroll to reveal):",
                            if remaining == 1 { "" } else { "s" }
                        ));
                    } else {
                        lines.push("... (scroll to reveal hidden iframe controls):".to_string());
                    }
                    for hint in scroll_hints.iter().take(8) {
                        let frame_ref = hint
                            .get("frameRef")
                            .and_then(Value::as_str)
                            .unwrap_or("iframe");
                        let tag = hint.get("tag").and_then(Value::as_str).unwrap_or("element");
                        let text = hint.get("text").and_then(Value::as_str).unwrap_or("");
                        let pages_down =
                            hint.get("pagesDown").and_then(Value::as_f64).unwrap_or(0.0);
                        let pages_suffix = if pages_down > 0.0 {
                            format!(
                                " ~{pages_down} page{} down",
                                if pages_down == 1.0 { "" } else { "s" }
                            )
                        } else {
                            String::new()
                        };
                        let label = if text.is_empty() { "(no label)" } else { text };
                        lines.push(format!("  [{frame_ref}] <{tag}> \"{label}\"{pages_suffix}"));
                    }
                }
            }
            lines.join("\n")
        }
        "see" => {
            if value.get("kind").and_then(Value::as_str) == Some("lyraLumenSeeFallback") {
                return value
                    .get("content")
                    .and_then(Value::as_str)
                    .filter(|content| !content.trim().is_empty())
                    .map(|content| {
                        format!(
                            "Visual capture was unavailable; Lyra used browser text extraction instead:\n{content}"
                        )
                    })
                    .unwrap_or_else(|| {
                        value
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Visual capture was unavailable; Lyra used browser text extraction instead.")
                            .to_string()
                    });
            }
            let artifact = value.get("imageArtifact").unwrap_or(&Value::Null);
            let artifact_id = artifact
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("visual evidence");
            let path = artifact.get("path").and_then(Value::as_str).unwrap_or("");
            let width = value
                .get("width")
                .or_else(|| artifact.get("width"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let height = value
                .get("height")
                .or_else(|| artifact.get("height"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            if path.is_empty() {
                format!("Captured Lyra Lumen visual evidence {artifact_id} ({width}x{height}).")
            } else {
                format!(
                    "Captured Lyra Lumen visual evidence {artifact_id} ({width}x{height}) at {path}."
                )
            }
        }
        "follow_audit" => value
            .get("compactText")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "explain_target" => {
            let target_ref = value
                .get("targetRef")
                .and_then(Value::as_str)
                .unwrap_or("target");
            let available = value
                .get("available")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if available {
                format!("{target_ref} is available for the current Lyra Lumen registry.")
            } else {
                let reason = value
                    .pointer("/staleTarget/reason")
                    .and_then(Value::as_str)
                    .unwrap_or("notFound");
                format!(
                    "{target_ref} is stale or unavailable ({reason}). Call /tools/browser/map before acting."
                )
            }
        }
        "read_until" | "wait" => value
            .get("content")
            .and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
        "audit" => {
            let summary = value.get("summary").unwrap_or(&Value::Null);
            let errors = summary.get("errors").and_then(Value::as_i64).unwrap_or(0);
            let warnings = summary.get("warnings").and_then(Value::as_i64).unwrap_or(0);
            let network_failures = summary
                .get("networkFailures")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let console_errors = summary
                .get("consoleErrors")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let mut lines = vec![format!(
                "Browser diagnostics: {errors} error(s), {warnings} warning(s), {network_failures} network failure(s), {console_errors} console error(s)."
            )];
            if value.get("available").and_then(Value::as_bool) == Some(false) {
                let reason = value
                    .get("unavailableReason")
                    .and_then(Value::as_str)
                    .unwrap_or("CDP diagnostics are unavailable.");
                lines.push(format!("CDP unavailable: {reason}"));
            }
            if let Some(entries) = value
                .get("diagnostics")
                .or_else(|| value.get("entries"))
                .and_then(Value::as_array)
            {
                for entry in entries.iter().take(12) {
                    let severity = entry
                        .get("severity")
                        .and_then(Value::as_str)
                        .unwrap_or("info");
                    let source = entry
                        .get("source")
                        .and_then(Value::as_str)
                        .unwrap_or("diagnostic");
                    let message = entry.get("message").and_then(Value::as_str).unwrap_or("");
                    let status = entry
                        .get("status")
                        .and_then(Value::as_i64)
                        .map(|status| format!(" HTTP {status}"))
                        .unwrap_or_default();
                    let location = entry
                        .get("url")
                        .and_then(Value::as_str)
                        .filter(|url| !url.is_empty())
                        .map(|url| format!(" - {url}"))
                        .unwrap_or_default();
                    lines.push(format!("[{severity}/{source}{status}] {message}{location}"));
                }
            }
            if let Some(next) = value
                .get("recommendedNextAction")
                .and_then(Value::as_str)
                .filter(|next| !next.is_empty())
            {
                lines.push(format!("Next: {next}"));
            }
            lines.join("\n")
        }
        _ => value
            .get("content")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string_pretty(value).unwrap_or_default()),
    }
}

pub(crate) fn tool_result_content(output: &Value) -> String {
    output
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string_pretty(output).unwrap_or_default())
}

pub(crate) fn fallback_response(error: AgentRuntimeError) -> String {
    if let Some(fault) = super::providers::mimo_faults::parse_mimo_fault_from_error(&error) {
        return super::providers::mimo_faults::mimo_fault_user_message(&fault);
    }
    if is_empty_model_reply_error(&error) {
        return "模型这次返回了空响应，Lyra 没有把无效内容提交到会话。请重试一次；如果连续出现，切换到支持 OpenAI 兼容文本和工具调用的 provider/model。".to_string();
    }
    if is_provider_configuration_error(&error) {
        return format!(
            "Lyra native agent runtime is active, but the provider is not configured or refused authentication: {error}. Configure the provider profile/API key, then retry."
        );
    }
    if is_retryable_provider_error(&error) {
        return format!(
            "Lyra native agent runtime is active, but the provider request hit a transient network/streaming error: {error}. Lyra retried automatically; please retry if the provider is reachable from the browser."
        );
    }
    format!("Lyra native agent runtime is active, but the model call could not run: {error}.")
}

pub(crate) fn guarded_tool_result_content(
    output: &Value,
    max_chars: usize,
) -> (String, Option<Value>) {
    let content = tool_result_content(output);
    if max_chars == 0 || content.chars().count() <= max_chars {
        return (content, None);
    }
    let kept = content.chars().take(max_chars).collect::<String>();
    (
        format!(
            "{kept}\n\n[Tool output truncated before provider retry; full output remains in Lyra tool activity evidence.]"
        ),
        Some(json!({
            "kind": "truncated_tool_output",
            "originalChars": content.chars().count(),
            "keptChars": max_chars,
        })),
    )
}

pub(crate) fn is_empty_model_reply_error(error: &AgentRuntimeError) -> bool {
    matches!(
        error,
        AgentRuntimeError::ProviderFailure {
            failure: ProviderFailure {
                category: ProviderFailureCategory::EmptyResponse,
                ..
            }
        } | AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::EmptyAssistantResponse
                | ProviderProtocolFailureKind::ReasoningOnlyResponse
                | ProviderProtocolFailureKind::IncompleteToolCall,
            ..
        }
    )
}

pub(crate) fn compact_messages_for_retry(
    messages: Vec<Value>,
    context_window: Option<usize>,
) -> Vec<Value> {
    let signals = crate::retention_policy::retention_signals_from_provider_messages(
        &messages,
        context_window,
    );
    crate::retention_policy::compact_provider_messages_for_retry(
        messages,
        &signals,
        crate::retention_policy::TrimAggressiveness::Emergency,
    )
}

pub(crate) fn emit_context_trimmed(session_id: &str, detail: Value) {
    let callback = state()
        .lock()
        .ok()
        .and_then(|state| state.event_callback.clone());
    emit_with_callback(
        &callback,
        json!({
            "kind": "contextTrimmed",
            "sessionId": session_id,
            "detail": detail,
        }),
    );
}

pub(crate) fn emit_context_compression_progress(
    session_id: &str,
    status: &str,
    token_before: Option<usize>,
    token_after: Option<usize>,
) {
    let callback = state()
        .lock()
        .ok()
        .and_then(|state| state.event_callback.clone());
    emit_with_callback(
        &callback,
        json!({
            "kind": "contextCompressionProgress",
            "sessionId": session_id,
            "status": status,
            "tokenBefore": token_before,
            "tokenAfter": token_after,
        }),
    );
}

pub(crate) fn emit_provider_fault(
    session_id: &str,
    turn_id: &str,
    provider_id: &str,
    model_id: &str,
    fault: &super::providers::mimo_faults::MimoProviderFault,
) {
    let callback = state()
        .lock()
        .ok()
        .and_then(|state| state.event_callback.clone());
    emit_with_callback(
        &callback,
        json!({
            "kind": "providerFault",
            "sessionId": session_id,
            "turnId": turn_id,
            "fault": {
                "httpStatus": fault.http_status,
                "code": fault.code,
                "category": mimo_fault_category_label(&fault.category),
                "providerId": provider_id,
                "modelId": model_id,
                "dedupeKey": super::providers::mimo_faults::mimo_fault_dedupe_key(fault, provider_id),
                "titleKey": fault.title_key,
                "bodyKey": fault.body_key,
            },
        }),
    );
}

fn mimo_fault_category_label(
    category: &super::providers::mimo_faults::MimoFaultCategory,
) -> &'static str {
    match category {
        super::providers::mimo_faults::MimoFaultCategory::Format => "format",
        super::providers::mimo_faults::MimoFaultCategory::Auth => "auth",
        super::providers::mimo_faults::MimoFaultCategory::Balance => "balance",
        super::providers::mimo_faults::MimoFaultCategory::Access => "access",
        super::providers::mimo_faults::MimoFaultCategory::Vision => "vision",
        super::providers::mimo_faults::MimoFaultCategory::ContentModeration => "content",
        super::providers::mimo_faults::MimoFaultCategory::RateLimit => "rate_limit",
        super::providers::mimo_faults::MimoFaultCategory::Server => "server",
    }
}

pub(crate) fn emit_provider_protocol_event(session_id: &str, turn_id: &str, detail: Value) {
    let callback = state()
        .lock()
        .ok()
        .and_then(|state| state.event_callback.clone());
    emit_with_callback(
        &callback,
        json!({
            "kind": "providerProtocolEvent",
            "sessionId": session_id,
            "turnId": turn_id,
            "detail": detail,
        }),
    );
}

pub(crate) fn emit_turn_state(session_id: &str, turn_id: &str, state_name: &str, reason: &str) {
    let callback = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let mut changed = false;
            if let Some(session) = state.sessions.get_mut(session_id) {
                if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                    return;
                }
                session.snapshot["follow"] = json!({ "running": true, "activity": state_name });
                update_runtime_turn_state(session, turn_id, state_name, None);
                touch_session(session);
                changed = true;
            }
            if changed {
                let _ = state.save_state();
            }
            callback
        }
        Err(_) => return,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "turnStateChanged",
            "sessionId": session_id,
            "turnId": turn_id,
            "state": state_name,
            "reason": reason,
        }),
    );
}
