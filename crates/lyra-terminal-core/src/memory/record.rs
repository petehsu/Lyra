use super::*;

pub(super) fn process_name(shell: &str) -> String {
    Path::new(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| shell.to_string())
}

pub(super) fn append_process_record(
    session_id: &str,
    state: &SessionState,
    process_id: Option<u32>,
    status: &str,
    payload: Value,
) -> MemoryResult<()> {
    append_json_line(
        &state.paths.processes_path,
        &merge_object(
            json!({
                "processRecordId": format!("terminal-process-record-{}", Uuid::new_v4()),
                "terminalSessionId": session_id,
                "processId": process_id,
                "status": status,
                "recordedAt": now_iso()
            }),
            payload,
        ),
    )
}

pub(super) fn append_process_tree_snapshot(
    session_id: &str,
    state: &mut SessionState,
    process_id: Option<u32>,
    process_name: &str,
    correlation: Value,
) -> MemoryResult<()> {
    append_event(
        session_id,
        state,
        "process_tree_snapshot",
        json!({ "kind": "terminal_kernel" }),
        json!({
            "processCount": if process_id.is_some() { 1 } else { 0 },
            "rootProcess": {
                "processId": process_id,
                "processName": process_name,
                "status": "running"
            }
        }),
        correlation,
        "include_as_runtime_state",
        "show_as_status",
    )
    .map(|_| ())
}

pub(super) fn append_agent_link_event(
    session_id: &str,
    state: &mut SessionState,
    kind: &str,
    actor: &Value,
    correlation: &Value,
) -> MemoryResult<()> {
    let Some(agent_session_id) = string_field(actor, "agentSessionId")
        .or_else(|| string_field(correlation, "agentSessionId"))
    else {
        return Ok(());
    };
    let link_id = format!(
        "agent-terminal-link-{}-{}",
        safe_segment(&agent_session_id),
        safe_segment(session_id)
    );
    let link_record = json!({
        "linkRecordId": format!("terminal-link-record-{}", Uuid::new_v4()),
        "linkId": link_id,
        "terminalSessionId": session_id,
        "agentSessionId": agent_session_id.clone(),
        "status": if kind == "agent_attached" { "attached" } else { "detached" },
        "actor": actor,
        "correlation": correlation,
        "recordedAt": now_iso()
    });
    append_json_line(&state.paths.attachments_path, &link_record)?;
    append_agent_link_index(&state.paths, &link_record)?;
    append_event(
        session_id,
        state,
        kind,
        json!({ "kind": "terminal_kernel" }),
        json!({
            "linkId": link_id,
            "agentSessionId": agent_session_id
        }),
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )
    .map(|_| ())
}

pub(super) fn permission_status_for_kind(kind: &str) -> &'static str {
    match kind {
        "permission_requested" => "pending",
        "permission_granted" => "granted",
        "permission_denied" => "denied",
        "permission_expired" => "expired",
        _ => "unknown",
    }
}

pub(super) fn permission_actor_source(kind: &str, input: &PermissionEventInput) -> &'static str {
    if kind == "permission_expired" {
        "system"
    } else if kind == "permission_requested" && input.agent_session_id.is_some() {
        "agent"
    } else if kind == "permission_requested" {
        "system"
    } else {
        "user"
    }
}

pub(super) fn permission_correlation(input: &PermissionEventInput) -> Value {
    merge_object(
        parse_json_object(input.correlation_json.as_deref()),
        json!({
            "permissionId": input.permission_id.clone(),
            "commandId": input.command_id.clone(),
            "inputId": input.input_id.clone(),
            "agentSessionId": input.agent_session_id.clone(),
            "runtimeTurnId": input.runtime_turn_id.clone(),
            "toolCallId": input.tool_call_id.clone()
        }),
    )
}

pub(super) fn append_permission_record(
    session_id: &str,
    state: &SessionState,
    actor: &Value,
    correlation: &Value,
    payload: &Value,
) -> MemoryResult<()> {
    let permission_record_seq = read_last_jsonl(&state.paths.permissions_path)
        .and_then(|record| number_field(&record, "permissionRecordSeq"))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or(1);
    let record = merge_object(
        json!({
            "permissionRecordSeq": permission_record_seq,
            "permissionRecordId": format!("terminal-permission-record-{}", Uuid::new_v4()),
            "terminalSessionId": session_id,
            "actor": actor,
            "correlation": correlation,
            "recordedAt": now_iso()
        }),
        payload.clone(),
    );
    append_json_line(&state.paths.permissions_path, &record)?;
    append_permission_index(&state.paths, &record)
}

pub(super) fn record_permission_event(kind: &str, input: PermissionEventInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let status = permission_status_for_kind(kind);
    let actor = actor_from_request(
        input.actor_json.as_deref(),
        Some(permission_actor_source(kind, &input)),
    );
    let correlation = permission_correlation(&input);
    let payload = json!({
        "permissionId": input.permission_id.clone(),
        "status": status,
        "action": input.action.clone(),
        "risk": input.risk.clone(),
        "summary": input.summary.clone(),
        "title": input.title.clone(),
        "detail": input.detail.clone(),
        "commandId": input.command_id.clone(),
        "inputId": input.input_id.clone(),
        "agentSessionId": input.agent_session_id.clone(),
        "runtimeTurnId": input.runtime_turn_id.clone(),
        "toolCallId": input.tool_call_id.clone(),
        "decision": input.decision.clone(),
        "reason": input.reason.clone(),
        "expiresAt": input.expires_at.clone()
    });
    append_permission_record(&input.session_id, &guard, &actor, &correlation, &payload)?;
    append_event(
        &input.session_id,
        &mut guard,
        kind,
        actor,
        payload,
        correlation,
        "include_as_runtime_state",
        "show_in_timeline",
    )?;
    Ok(())
}

pub fn record_permission_requested(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_requested", input)
}

pub fn record_permission_granted(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_granted", input)
}

pub fn record_permission_denied(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_denied", input)
}

pub fn record_permission_expired(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_expired", input)
}

pub fn record_handoff_started(input: HandoffEventInput) -> MemoryResult<()> {
    record_handoff_event("handoff_started", input)
}

pub fn record_handoff_completed(input: HandoffEventInput) -> MemoryResult<()> {
    record_handoff_event("handoff_completed", input)
}

pub(super) fn record_handoff_event(kind: &str, input: HandoffEventInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let handoff_id = input
        .handoff_id
        .clone()
        .unwrap_or_else(|| format!("terminal-handoff-{}", Uuid::new_v4()));
    let actor = actor_from_request(input.actor_json.as_deref(), Some("system"));
    let correlation = merge_object(
        parse_json_object(input.correlation_json.as_deref()),
        json!({ "handoffId": handoff_id }),
    );
    append_event(
        &input.session_id,
        &mut guard,
        kind,
        actor,
        json!({
            "handoffId": handoff_id,
            "fromActor": parse_json_object(input.from_actor_json.as_deref()),
            "toActor": parse_json_object(input.to_actor_json.as_deref()),
            "reason": input.reason.clone(),
            "summary": input.summary.clone(),
            "status": input.status.clone()
        }),
        correlation,
        "include_as_runtime_state",
        "show_in_timeline",
    )?;
    Ok(())
}

pub fn mark_output_policy(input: OutputPolicyMarkerInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let policy = match input.policy.trim() {
        "redacted" | "encrypted" => input.policy.trim().to_string(),
        other if other.is_empty() => "redacted".to_string(),
        other => other.to_string(),
    };
    let start = input.start.min(input.end);
    let end = input.end.max(start);
    let actor = actor_from_request(input.actor_json.as_deref(), Some("system"));
    let correlation = parse_json_object(input.correlation_json.as_deref());
    let marker = json!({
        "markerId": format!("terminal-output-policy-{}", Uuid::new_v4()),
        "terminalSessionId": input.session_id.clone(),
        "range": { "start": start, "end": end },
        "policy": policy,
        "redacted": policy == "redacted",
        "encrypted": policy == "encrypted",
        "encryptedRef": input.encrypted_ref.clone(),
        "reason": input.reason.clone(),
        "actor": actor.clone(),
        "correlation": correlation.clone(),
        "coordinateSpace": "original_output_byte_offsets",
        "recordedAt": now_iso()
    });
    append_json_line(&guard.paths.output_redactions_path, &marker)?;
    append_event(
        &input.session_id,
        &mut guard,
        "output_policy_marked",
        actor,
        marker,
        correlation,
        "artifact_reference_only",
        "show_in_details_only",
    )?;
    Ok(())
}

pub(super) fn record_audit_read(
    storage_root: &str,
    session_id: &str,
    read_kind: &str,
    detail: Value,
    actor_json: Option<&str>,
    correlation_json: Option<&str>,
) -> MemoryResult<()> {
    let state = initialize_state(storage_root, session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(actor_json, Some("system"));
    let correlation = merge_object(
        parse_json_object(correlation_json),
        json!({ "auditReadKind": read_kind }),
    );
    append_event(
        session_id,
        &mut guard,
        "audit_read",
        actor,
        merge_object(
            json!({
                "reader": read_kind,
                "summary": format!("Terminal memory read: {read_kind}")
            }),
            detail,
        ),
        correlation,
        "exclude",
        "show_in_details_only",
    )?;
    Ok(())
}

pub fn record_session_created(input: SessionCreatedInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some(&input.source));
    let correlation = merge_object(
        parse_json_object(input.correlation_json.as_deref()),
        json!({ "cwd": input.cwd }),
    );
    append_event(
        &input.session_id,
        &mut guard,
        "session_created",
        actor.clone(),
        json!({
            "title": input.title,
            "cwd": input.cwd,
            "shell": input.shell,
            "mode": input.mode,
            "command": input.command.clone(),
            "source": input.source,
            "rows": input.rows,
            "cols": input.cols,
            "persist": input.persist
        }),
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    append_agent_link_event(
        &input.session_id,
        &mut guard,
        "agent_attached",
        &actor,
        &correlation,
    )?;
    if let Some(command) = input
        .command
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        record_known_command(
            &input.session_id,
            &mut guard,
            command,
            actor,
            correlation,
            "running",
            None,
        )?;
        write_summary(&input.session_id, &guard, false)?;
    }
    Ok(())
}

pub fn record_process_started(input: ProcessStartedInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    guard.active_process_id = input.process_id;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("system"));
    let correlation = parse_json_object(input.correlation_json.as_deref());
    let name = process_name(&input.shell);
    let payload = json!({
        "processId": input.process_id,
        "processName": name,
        "shell": input.shell,
        "cwd": input.cwd,
        "command": input.command,
        "mode": input.mode,
        "source": input.source,
        "cols": input.cols,
        "rows": input.rows
    });
    append_process_record(
        &input.session_id,
        &guard,
        input.process_id,
        "running",
        payload.clone(),
    )?;
    append_event(
        &input.session_id,
        &mut guard,
        "process_started",
        actor,
        payload,
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    append_process_tree_snapshot(
        &input.session_id,
        &mut guard,
        input.process_id,
        &name,
        correlation,
    )?;
    Ok(())
}

pub fn record_process_signal_sent(input: ProcessSignalInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("user"));
    let process_id = guard.active_process_id;
    let payload = json!({
        "processId": process_id,
        "signal": input.signal,
        "reason": input.reason
    });
    append_process_record(
        &input.session_id,
        &guard,
        process_id,
        "signal_sent",
        payload.clone(),
    )?;
    append_event(
        &input.session_id,
        &mut guard,
        "process_signal_sent",
        actor,
        payload,
        parse_json_object(input.correlation_json.as_deref()),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    Ok(())
}

pub fn record_write(input: WriteInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), input.source.as_deref());
    let command_text = command_text_from_write(&input);
    let requested_correlation = parse_json_object(input.correlation_json.as_deref());
    let command_id = command_text
        .as_ref()
        .map(|_| {
            command_id_from_correlation(&requested_correlation).unwrap_or_else(create_command_id)
        })
        .or_else(|| command_id_from_correlation(&requested_correlation));
    let correlation = merge_object(
        requested_correlation,
        command_id
            .as_ref()
            .map(|value| json!({ "commandId": value }))
            .unwrap_or_else(|| json!({})),
    );
    let text_for_preview = input
        .text
        .as_deref()
        .or(input.data.as_deref())
        .map(ToString::to_string)
        .or_else(|| input.keys.as_ref().map(|keys| keys.join(", ")))
        .unwrap_or_default();
    let kind = if input.keys.as_ref().is_some_and(|keys| !keys.is_empty()) {
        "input_keys"
    } else {
        "input_text"
    };
    append_event(
        &input.session_id,
        &mut guard,
        kind,
        actor.clone(),
        json!({
            "data": input.data,
            "text": input.text,
            "keys": input.keys,
            "appendNewline": input.append_newline,
            "textPreview": preview_text(&text_for_preview),
            "byteLength": text_for_preview.len()
        }),
        correlation.clone(),
        "artifact_reference_only",
        "show_in_timeline",
    )?;
    if let Some(command_text) = command_text {
        record_known_command(
            &input.session_id,
            &mut guard,
            &command_text,
            actor,
            correlation,
            "running",
            None,
        )?;
        write_summary(&input.session_id, &guard, false)?;
    }
    Ok(())
}

pub fn record_resize(input: ResizeInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("user"));
    append_event(
        &input.session_id,
        &mut guard,
        "input_resize",
        actor,
        json!({ "cols": input.cols, "rows": input.rows }),
        parse_json_object(input.correlation_json.as_deref()),
        "exclude",
        "show_as_status",
    )?;
    Ok(())
}

pub fn record_close(input: CloseInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("user"));
    let correlation = parse_json_object(input.correlation_json.as_deref());
    append_event(
        &input.session_id,
        &mut guard,
        "session_closed",
        actor.clone(),
        json!({}),
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    append_agent_link_event(
        &input.session_id,
        &mut guard,
        "agent_detached",
        &actor,
        &correlation,
    )?;
    Ok(())
}

pub fn record_output(context: &MemoryContext, raw: &[u8]) -> MemoryResult<()> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let raw_start = file_size(&guard.paths.raw_output_path);
    let text_start = file_size(&guard.paths.output_text_path);
    let raw_text = String::from_utf8_lossy(raw).to_string();
    let text = strip_ansi(&raw_text);
    {
        let mut raw_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&guard.paths.raw_output_path)
            .map_err(|error| error.to_string())?;
        raw_file.write_all(raw).map_err(|error| error.to_string())?;
    }
    {
        let mut text_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&guard.paths.output_text_path)
            .map_err(|error| error.to_string())?;
        text_file
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    let raw_byte_length = raw.len() as u64;
    let text_byte_length = text.len() as u64;
    let command_id = guard.active_command_id.clone();
    let output_artifact_id = "session-output";
    let seq = guard.next_seq;
    guard.next_seq = guard.next_seq.saturating_add(1);
    let created_at = now_iso();
    let correlation = command_id
        .as_ref()
        .map(|value| json!({ "commandId": value, "outputArtifactId": output_artifact_id }))
        .unwrap_or_else(|| json!({ "outputArtifactId": output_artifact_id }));
    let event = json!({
        "eventId": format!("terminal-event-{}", Uuid::new_v4()),
        "terminalSessionId": context.session_id,
        "seq": seq,
        "kind": "output_chunk",
        "actor": { "kind": "process" },
        "payload": {
            "rawOffset": raw_start,
            "rawByteLength": raw_byte_length,
            "textOffset": text_start,
            "textByteLength": text_byte_length,
            "commandId": command_id,
            "outputArtifactId": output_artifact_id,
            "textPreview": preview_text(&text),
            "sha256": sha256_hex(raw)
        },
        "createdAt": created_at,
        "createdAtMs": now_ms(),
        "correlation": correlation,
        "visibility": "user_visible",
        "modelContextPolicy": "artifact_reference_only",
        "uiPolicy": "show_in_terminal_only",
        "auditPolicy": "full"
    });
    append_json_line(&guard.paths.events_path, &event)?;
    append_event_index(&guard.paths, &event)?;
    let stored =
        stored_event_from_record(&event).ok_or_else(|| "invalid output event".to_string())?;
    append_timeline_item_for_event(&stored, &mut guard)?;
    index_output_text(
        &context.session_id,
        &mut guard,
        &text,
        text_start,
        seq,
        &created_at,
    )?;
    guard.latest_event_kind = Some("output_chunk".to_string());
    write_summary(&context.session_id, &guard, false)?;
    Ok(())
}

pub(super) fn budget_screen_diff_payload(payload: Value, artifact_path: &Path, seq: u64) -> Value {
    let serialized_len = serde_json::to_vec(&payload)
        .map(|bytes| bytes.len())
        .unwrap_or(0);
    let rows = payload
        .get("dirtyRows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ranges = payload
        .get("dirtyRowRanges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if rows.is_empty() && ranges.is_empty() {
        return payload;
    }
    if rows.len() <= 20 && ranges.len() <= 40 && serialized_len <= 4 * 1024 {
        return payload;
    }
    let mut budgeted = payload.clone();
    if let Some(object) = budgeted.as_object_mut() {
        object.insert("dirtyRowCount".to_string(), json!(rows.len()));
        object.insert("dirtyRowRangeCount".to_string(), json!(ranges.len()));
        object.insert(
            "dirtyRows".to_string(),
            Value::Array(rows.iter().take(20).cloned().collect()),
        );
        object.insert(
            "dirtyRowRanges".to_string(),
            Value::Array(ranges.iter().take(40).cloned().collect()),
        );
        object.insert("truncated".to_string(), Value::Bool(true));
        object.insert(
            "fullDiffArtifact".to_string(),
            json!({
                "label": "screen-diffs.jsonl",
                "path": artifact_path.to_string_lossy(),
                "seq": seq
            }),
        );
    }
    budgeted
}

pub fn record_screen_diff(context: &MemoryContext, payload: Value) -> MemoryResult<()> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let seq = guard.next_seq;
    append_json_line(
        &guard.paths.screen_diffs_path,
        &json!({
            "terminalSessionId": context.session_id,
            "seq": seq,
            "kind": "screen_diff",
            "payload": payload.clone(),
            "createdAt": now_iso()
        }),
    )?;
    let event_payload = budget_screen_diff_payload(payload, &guard.paths.screen_diffs_path, seq);
    append_event(
        &context.session_id,
        &mut guard,
        "screen_diff",
        json!({ "kind": "terminal_kernel" }),
        event_payload,
        json!({}),
        "include_as_runtime_state",
        "show_in_terminal_only",
    )?;
    Ok(())
}

pub fn record_shell_integration_event(
    context: &MemoryContext,
    event: &ShellIntegrationEvent,
) -> MemoryResult<Option<CommandCompletionProjection>> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = json!({ "kind": "terminal_kernel" });
    let command_id = event
        .command_id
        .clone()
        .or_else(|| guard.active_command_id.clone());
    let correlation = command_id
        .as_ref()
        .map(|value| json!({ "commandId": value }))
        .unwrap_or_else(|| json!({}));
    let mut completion = None;

    match event.kind {
        ShellIntegrationEventKind::CommandStart => {
            let command_id = command_id.unwrap_or_else(create_command_id);
            let command_text = event
                .command
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if command_text.is_none()
                && guard.active_command_id.as_deref() != Some(command_id.as_str())
            {
                append_event(
                    &context.session_id,
                    &mut guard,
                    "shell_integration",
                    actor,
                    json!({
                        "eventKind": format!("{:?}", event.kind),
                        "commandId": event.command_id.clone(),
                        "command": event.command.clone(),
                        "cwd": event.cwd.clone(),
                        "exitCode": event.exit_code,
                        "signal": event.signal.clone(),
                        "confidence": event.confidence,
                        "ignored": true,
                        "ignoredReason": "empty_command"
                    }),
                    correlation,
                    "include_as_runtime_state",
                    "show_in_terminal_only",
                )?;
                write_summary(&context.session_id, &guard, false)?;
                return Ok(None);
            }
            let start_correlation = merge_object(
                correlation.clone(),
                json!({ "commandId": command_id.clone(), "boundarySource": "shell_integration" }),
            );
            if latest_command_status_for_id(&guard, &command_id).is_none() {
                record_known_command(
                    &context.session_id,
                    &mut guard,
                    command_text.unwrap_or(command_id.as_str()),
                    actor.clone(),
                    start_correlation,
                    "running",
                    None,
                )?;
            } else if guard.active_command_id.as_deref() != Some(command_id.as_str()) {
                guard.active_command_id = Some(command_id.clone());
                let output_text_start = file_size(&guard.paths.output_text_path);
                let raw_output_start = file_size(&guard.paths.raw_output_path);
                guard.active_command_output_text_start = Some(output_text_start);
                guard.active_command_raw_start = Some(raw_output_start);
                append_command_lifecycle_event(
                    &context.session_id,
                    &mut guard,
                    "command_started",
                    &command_id,
                    event.command.as_deref(),
                    actor.clone(),
                    start_correlation,
                    json!({
                        "outputTextRange": { "start": output_text_start, "end": output_text_start },
                        "rawOutputRange": { "start": raw_output_start, "end": raw_output_start }
                    }),
                )?;
            }
        }
        ShellIntegrationEventKind::CommandEnd => {
            if let Some(command_id) = command_id {
                completion = complete_command_from_shell_event(
                    &context.session_id,
                    &mut guard,
                    command_id,
                    event.command.clone(),
                    event.exit_code,
                    event.signal.clone(),
                    actor.clone(),
                    correlation.clone(),
                )?;
            }
        }
        ShellIntegrationEventKind::CwdChanged
        | ShellIntegrationEventKind::PromptStart
        | ShellIntegrationEventKind::PromptEnd
        | ShellIntegrationEventKind::PromptReady
        | ShellIntegrationEventKind::CommandId
        | ShellIntegrationEventKind::Unknown => {}
    }

    append_event(
        &context.session_id,
        &mut guard,
        "shell_integration",
        actor,
        json!({
            "eventKind": format!("{:?}", event.kind),
            "commandId": event.command_id.clone(),
            "command": event.command.clone(),
            "cwd": event.cwd.clone(),
            "exitCode": event.exit_code,
            "signal": event.signal.clone(),
            "confidence": event.confidence
        }),
        correlation,
        "include_as_runtime_state",
        "show_in_terminal_only",
    )?;
    write_summary(&context.session_id, &guard, false)?;
    Ok(completion)
}

pub fn record_exit(
    context: &MemoryContext,
    exit_code: i32,
) -> MemoryResult<Option<CommandCompletionProjection>> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let command_id = guard.active_command_id.clone();
    let latest = command_id
        .as_ref()
        .and_then(|command_id| latest_command_record_for_id(&guard, command_id));
    let command_text = command_id
        .as_ref()
        .and_then(|command_id| command_text_for_id(&guard, command_id))
        .or_else(|| {
            latest
                .as_ref()
                .and_then(|record| string_field(record, "commandText"))
        });
    let output_text_end = file_size(&guard.paths.output_text_path);
    let raw_output_end = file_size(&guard.paths.raw_output_path);
    let output_text_start = guard
        .active_command_output_text_start
        .unwrap_or(output_text_end)
        .min(output_text_end);
    let raw_output_start = guard
        .active_command_raw_start
        .unwrap_or(raw_output_end)
        .min(raw_output_end);
    let seq = guard.next_seq;
    guard.next_seq = guard.next_seq.saturating_add(1);
    let created_at = now_iso();
    let base_correlation = latest
        .as_ref()
        .and_then(|record| record.get("correlation"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let correlation = merge_object(
        base_correlation,
        command_id
            .as_ref()
            .map(|value| json!({ "commandId": value }))
            .unwrap_or_else(|| json!({})),
    );
    let event = json!({
        "eventId": format!("terminal-event-{}", Uuid::new_v4()),
        "terminalSessionId": context.session_id,
        "seq": seq,
        "kind": "process_exited",
        "actor": { "kind": "process" },
        "correlation": correlation.clone(),
        "payload": { "exitCode": exit_code },
        "createdAt": created_at,
        "createdAtMs": now_ms(),
        "visibility": "user_visible",
        "modelContextPolicy": "include_as_runtime_state",
        "uiPolicy": "show_as_status",
        "auditPolicy": "full"
    });
    append_json_line(&guard.paths.events_path, &event)?;
    append_event_index(&guard.paths, &event)?;
    let stored =
        stored_event_from_record(&event).ok_or_else(|| "invalid exit event".to_string())?;
    append_timeline_item_for_event(&stored, &mut guard)?;
    guard.latest_event_kind = Some("process_exited".to_string());
    flush_pending_output_line(&context.session_id, &mut guard, seq, &created_at)?;
    append_process_record(
        &context.session_id,
        &guard,
        guard.active_process_id,
        if exit_code == 0 { "exited" } else { "failed" },
        json!({
            "exitCode": exit_code,
            "exitedAt": created_at
        }),
    )?;
    guard.active_process_id = None;
    let mut completion = None;
    if let Some(command_id) = command_id {
        let status = if exit_code == 0 {
            "completed"
        } else {
            "failed"
        };
        let artifact_paths = command_artifact_paths(&guard, &command_id);
        let artifact_metadata = command_artifact_metadata(&artifact_paths);
        let completed_at = now_iso();
        append_command_record(
            &mut guard,
            merge_object(
                json!({
                    "commandId": command_id.clone(),
                    "terminalSessionId": context.session_id,
                    "commandText": command_text.clone(),
                    "normalizedCommandText": command_text.as_deref().map(str::trim),
                    "status": status,
                    "exitCode": exit_code,
                    "signal": null,
                    "outputTextRange": { "start": output_text_start, "end": output_text_end },
                    "rawOutputRange": { "start": raw_output_start, "end": raw_output_end },
                    "completedAt": completed_at.clone(),
                    "correlation": correlation.clone(),
                    "confidence": 0.6
                }),
                artifact_metadata.clone(),
            ),
        )?;
        append_command_lifecycle_event(
            &context.session_id,
            &mut guard,
            "command_completed",
            &command_id,
            command_text.as_deref(),
            json!({ "kind": "process" }),
            correlation.clone(),
            merge_object(
                json!({
                    "status": status,
                    "exitCode": exit_code,
                    "outputTextRange": { "start": output_text_start, "end": output_text_end },
                    "rawOutputRange": { "start": raw_output_start, "end": raw_output_end }
                }),
                artifact_metadata.clone(),
            ),
        )?;
        completion = Some(write_command_artifacts(
            &context.session_id,
            &guard,
            &command_id,
            command_text.as_deref(),
            status,
            Some(exit_code),
            None,
            &json!({ "kind": "process" }),
            &correlation,
            output_text_start,
            output_text_end,
            raw_output_start,
            raw_output_end,
            &completed_at,
        )?);
        guard.active_command_id = None;
        guard.active_command_output_text_start = None;
        guard.active_command_raw_start = None;
    }
    write_summary(&context.session_id, &guard, false)?;
    Ok(completion)
}

pub fn record_error(context: &MemoryContext, error: &str) -> MemoryResult<()> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    append_event(
        &context.session_id,
        &mut guard,
        "terminal_error",
        json!({ "kind": "terminal_kernel" }),
        json!({ "error": error }),
        json!({}),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    Ok(())
}
