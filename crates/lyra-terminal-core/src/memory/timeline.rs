use super::*;

pub(super) fn command_summary_records(
    state: &SessionState,
    output_size: u64,
    raw_size: u64,
) -> Vec<Value> {
    let mut commands = Vec::<Value>::new();
    let mut index_by_id = HashMap::<String, usize>::new();
    for record in read_jsonl_with_repair_log(
        &state.paths.commands_path,
        Some(&state.paths.repair_log_path),
    ) {
        let Some(command_id) = string_field(&record, "commandId") else {
            continue;
        };
        let index = if let Some(index) = index_by_id.get(&command_id).copied() {
            index
        } else {
            let index = commands.len();
            index_by_id.insert(command_id.clone(), index);
            commands.push(json!({
                "commandId": command_id,
                "terminalSessionId": string_field(&record, "terminalSessionId"),
                "commandText": null,
                "normalizedCommandText": null,
                "status": null,
                "exitCode": null,
                "signal": null,
                "outputTextRange": null,
                "rawOutputRange": null,
                "artifactRootPath": null,
                "commandMetaPath": null,
                "commandOutputTextPath": null,
                "commandRawOutputPath": null,
                "commandEventsPath": null,
                "commandSummaryPath": null,
                "lastCommandSeq": null,
                "correlation": null
            }));
            index
        };
        if let Some(object) = commands[index].as_object_mut() {
            for key in [
                "commandText",
                "normalizedCommandText",
                "status",
                "exitCode",
                "signal",
                "outputTextRange",
                "rawOutputRange",
                "artifactRootPath",
                "commandMetaPath",
                "commandOutputTextPath",
                "commandRawOutputPath",
                "commandEventsPath",
                "commandSummaryPath",
                "commandSeq",
                "correlation",
            ] {
                if let Some(value) = record.get(key) {
                    let target_key = if key == "commandSeq" {
                        "lastCommandSeq"
                    } else {
                        key
                    };
                    if !value.is_null() {
                        object.insert(target_key.to_string(), value.clone());
                    }
                }
            }
        }
    }

    if let Some(active_command_id) = state.active_command_id.as_ref() {
        if let Some(index) = index_by_id.get(active_command_id).copied() {
            if let Some(object) = commands[index].as_object_mut() {
                let text_start = state
                    .active_command_output_text_start
                    .unwrap_or(output_size);
                let raw_start = state.active_command_raw_start.unwrap_or(raw_size);
                object.insert(
                    "outputTextRange".to_string(),
                    json!({ "start": text_start.min(output_size), "end": output_size }),
                );
                object.insert(
                    "rawOutputRange".to_string(),
                    json!({ "start": raw_start.min(raw_size), "end": raw_size }),
                );
            }
        }
    }

    let errors = read_jsonl_with_repair_log(
        &state.paths.error_index_path,
        Some(&state.paths.repair_log_path),
    );
    for command in &mut commands {
        let Some(command_id) = string_field(command, "commandId") else {
            continue;
        };
        let range = command
            .get("outputTextRange")
            .cloned()
            .unwrap_or(Value::Null);
        let start = number_field(&range, "start")
            .unwrap_or(output_size)
            .min(output_size);
        let end = number_field(&range, "end")
            .unwrap_or(start)
            .min(output_size);
        let output = read_byte_range(&state.paths.output_text_path, start, end)
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default();
        let lines = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let last_error_lines = errors
            .iter()
            .filter(|error| {
                string_field(error, "commandId").as_deref() == Some(command_id.as_str())
                    || number_field(error, "textOffset")
                        .is_some_and(|offset| offset >= start && offset < end)
            })
            .filter_map(|error| string_field(error, "textPreview"))
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        if let Some(object) = command.as_object_mut() {
            object.insert(
                "firstOutputPreview".to_string(),
                lines
                    .first()
                    .map(|line| Value::String(preview_text(line)))
                    .unwrap_or(Value::Null),
            );
            object.insert(
                "lastOutputPreview".to_string(),
                lines
                    .last()
                    .map(|line| Value::String(preview_text(line)))
                    .unwrap_or(Value::Null),
            );
            object.insert("lastErrorLines".to_string(), json!(last_error_lines));
            object.insert(
                "estimatedTokens".to_string(),
                json!(estimate_tokens(end.saturating_sub(start))),
            );
        }
    }
    commands
}

pub(super) fn output_search_hints(state: &SessionState) -> Value {
    json!({
        "message": "Full terminal output is stored as Kernel-managed artifacts.",
        "textArtifactPath": state.paths.output_text_path.to_string_lossy(),
        "rawArtifactPath": state.paths.raw_output_path.to_string_lossy(),
        "lineIndexPath": state.paths.line_index_path.to_string_lossy(),
        "errorIndexPath": state.paths.error_index_path.to_string_lossy(),
        "outputCompactionPath": state.paths.output_compaction_path.to_string_lossy(),
        "outputRedactionsPath": state.paths.output_redactions_path.to_string_lossy(),
        "readRangeMethod": "terminal.output.readRange",
        "artifactListMethod": "terminal.artifacts.list"
    })
}

pub(super) fn write_output_summary(
    session_id: &str,
    state: &SessionState,
    truncated: bool,
) -> MemoryResult<()> {
    let output_size = file_size(&state.paths.output_text_path);
    let raw_size = file_size(&state.paths.raw_output_path);
    let estimated_tokens = estimate_tokens(output_size);
    write_json_pretty(
        &state.paths.output_summary_path,
        &json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "updatedAt": now_iso(),
            "outputByteRange": { "start": 0, "end": output_size },
            "rawOutputByteRange": { "start": 0, "end": raw_size },
            "estimatedTokens": estimated_tokens,
            "projectionRecommendation": output_projection_recommendation(output_size),
            "truncatedByProjection": truncated || estimated_tokens > INLINE_TOKEN_LIMIT,
            "lineCount": state.next_line_number.saturating_sub(1),
            "errorCount": state.error_count,
            "latestOutputPreview": state.latest_output_preview,
            "commands": command_summary_records(state, output_size, raw_size),
            "compaction": {
                "state": "uncompacted",
                "coordinateSpace": "original_output_byte_offsets",
                "manifestPath": state.paths.output_compaction_path.to_string_lossy()
            },
            "redaction": {
                "policy": "none",
                "redactionJournalPath": state.paths.output_redactions_path.to_string_lossy(),
                "supportsEncryptedPolicyMarkers": true
            },
            "searchHints": output_search_hints(state)
        }),
    )
}

pub(super) fn metadata_from_state(state: &SessionState, truncated: bool) -> Value {
    let output_size = file_size(&state.paths.output_text_path);
    let estimated_tokens = estimate_tokens(output_size);
    let event_end = state.next_seq.saturating_sub(1);
    json!({
        "sessionRootPath": state.paths.session_root_path.to_string_lossy(),
        "eventLogPath": state.paths.events_path.to_string_lossy(),
        "summaryPath": state.paths.summary_path.to_string_lossy(),
        "uiTimelinePath": state.paths.ui_timeline_path.to_string_lossy(),
        "outputTextPath": state.paths.output_text_path.to_string_lossy(),
        "rawOutputPath": state.paths.raw_output_path.to_string_lossy(),
        "outputSummaryPath": state.paths.output_summary_path.to_string_lossy(),
        "lineIndexPath": state.paths.line_index_path.to_string_lossy(),
        "errorIndexPath": state.paths.error_index_path.to_string_lossy(),
        "commandsPath": state.paths.commands_path.to_string_lossy(),
        "commandArtifactsRootPath": state.paths.command_artifacts_root_path.to_string_lossy(),
        "permissionsPath": state.paths.permissions_path.to_string_lossy(),
        "processesPath": state.paths.processes_path.to_string_lossy(),
        "attachmentsPath": state.paths.attachments_path.to_string_lossy(),
        "screenDiffsPath": state.paths.screen_diffs_path.to_string_lossy(),
        "retentionManifestPath": state.paths.retention_manifest_path.to_string_lossy(),
        "repairLogPath": state.paths.repair_log_path.to_string_lossy(),
        "indexManifestPath": state.paths.index_manifest_path.to_string_lossy(),
        "terminalSessionsIndexPath": state.paths.index_sessions_path.to_string_lossy(),
        "terminalEventsIndexPath": state.paths.index_events_path.to_string_lossy(),
        "terminalCommandsIndexPath": state.paths.index_commands_path.to_string_lossy(),
        "terminalOutputArtifactsIndexPath": state.paths.index_output_artifacts_path.to_string_lossy(),
        "terminalPermissionsIndexPath": state.paths.index_permissions_path.to_string_lossy(),
        "agentTerminalLinksIndexPath": state.paths.index_agent_terminal_links_path.to_string_lossy(),
        "outputCompactionPath": state.paths.output_compaction_path.to_string_lossy(),
        "outputRedactionsPath": state.paths.output_redactions_path.to_string_lossy(),
        "restoration": restoration_state_json(),
        "eventSeqRange": if event_end > 0 {
            json!({ "start": 1, "end": event_end })
        } else {
            Value::Null
        },
        "outputByteRange": { "start": 0, "end": output_size },
        "estimatedTokens": estimated_tokens,
        "projectionRecommendation": output_projection_recommendation(output_size),
        "lineCount": state.next_line_number.saturating_sub(1),
        "errorCount": state.error_count,
        "latestOutputPreview": state.latest_output_preview,
        "truncatedByProjection": truncated || estimated_tokens > INLINE_TOKEN_LIMIT,
        "searchHints": output_search_hints(state)
    })
}

pub(super) fn write_summary(
    session_id: &str,
    state: &SessionState,
    truncated: bool,
) -> MemoryResult<()> {
    write_output_summary(session_id, state, truncated)?;
    write_retention_manifest(session_id, &state.paths)?;
    write_output_policy_manifests(session_id, &state.paths)?;
    write_index_store_manifest(session_id, &state.paths)?;
    refresh_session_index_from_paths(session_id, &state.paths)?;
    refresh_output_artifact_index(session_id, state)?;
    let memory = metadata_from_state(state, truncated);
    let raw_output_bytes = file_size(&state.paths.raw_output_path);
    write_json_pretty(
        &state.paths.summary_path,
        &json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "updatedAt": now_iso(),
            "latestEventKind": state.latest_event_kind,
            "timelineItemCount": state.timeline_item_count,
            "latestTimelinePreview": state.latest_timeline_preview,
            "activeCommandId": state.active_command_id,
            "rawOutputByteRange": { "start": 0, "end": raw_output_bytes },
            "memory": memory
        }),
    )
}

pub(super) fn timeline_artifacts(state: &SessionState) -> Value {
    Value::Array(artifact_records(state))
}

pub(super) fn timeline_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(preview_text)
        .filter(|text| !text.is_empty())
}

pub(super) fn permission_chain_for_event(event: &StoredEvent, state: &SessionState) -> Vec<Value> {
    let correlation = event.correlation.clone().unwrap_or_else(|| json!({}));
    let payload = event.payload.clone();
    let permission_id = string_field(&correlation, "permissionId")
        .or_else(|| string_field(&payload, "permissionId"));
    let command_id =
        string_field(&correlation, "commandId").or_else(|| string_field(&payload, "commandId"));
    let input_id =
        string_field(&correlation, "inputId").or_else(|| string_field(&payload, "inputId"));
    let tool_call_id =
        string_field(&correlation, "toolCallId").or_else(|| string_field(&payload, "toolCallId"));
    let agent_session_id = string_field(&correlation, "agentSessionId")
        .or_else(|| string_field(&payload, "agentSessionId"));

    read_jsonl_with_repair_log(
        &state.paths.permissions_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|record| {
        permission_id
            .as_ref()
            .is_some_and(|value| string_field(record, "permissionId").as_ref() == Some(value))
            || command_id.as_ref().is_some_and(|value| {
                string_field(record, "commandId").as_ref() == Some(value)
                    || record
                        .get("correlation")
                        .and_then(|correlation| string_field(correlation, "commandId"))
                        .as_ref()
                        == Some(value)
            })
            || input_id.as_ref().is_some_and(|value| {
                string_field(record, "inputId").as_ref() == Some(value)
                    || record
                        .get("correlation")
                        .and_then(|correlation| string_field(correlation, "inputId"))
                        .as_ref()
                        == Some(value)
            })
            || tool_call_id.as_ref().is_some_and(|value| {
                string_field(record, "toolCallId").as_ref() == Some(value)
                    || record
                        .get("correlation")
                        .and_then(|correlation| string_field(correlation, "toolCallId"))
                        .as_ref()
                        == Some(value)
            })
            || (command_id.is_none()
                && input_id.is_none()
                && tool_call_id.is_none()
                && permission_id.is_none()
                && agent_session_id.as_ref().is_some_and(|value| {
                    string_field(record, "agentSessionId").as_ref() == Some(value)
                }))
    })
    .map(|record| {
        json!({
            "permissionRecordSeq": number_field(&record, "permissionRecordSeq"),
            "permissionId": string_field(&record, "permissionId"),
            "status": string_field(&record, "status"),
            "risk": string_field(&record, "risk"),
            "summary": string_field(&record, "summary"),
            "action": string_field(&record, "action"),
            "decision": string_field(&record, "decision"),
            "actor": record.get("actor").cloned().unwrap_or_else(|| json!({})),
            "correlation": record.get("correlation").cloned().unwrap_or_else(|| json!({})),
            "recordedAt": string_field(&record, "recordedAt")
        })
    })
    .collect()
}

pub(super) fn command_audit_answer(event: &StoredEvent, chain: &[Value]) -> Option<String> {
    if !matches!(
        event.kind.as_str(),
        "command_submitted" | "command_started" | "command_completed" | "input_text"
    ) {
        return None;
    }
    let actor = actor_label(&event.actor);
    let latest_permission = chain.last();
    let status = latest_permission
        .and_then(|record| string_field(record, "status"))
        .unwrap_or_else(|| "no_permission_record".to_string());
    let permission_id = latest_permission
        .and_then(|record| string_field(record, "permissionId"))
        .unwrap_or_else(|| "none".to_string());
    Some(format!(
        "Command actor: {actor}; approval: {status}; permissionId: {permission_id}"
    ))
}

pub(super) fn audit_projection_for_event(event: &StoredEvent, state: &SessionState) -> Value {
    let correlation = event.correlation.clone().unwrap_or_else(|| json!({}));
    let permission_chain = permission_chain_for_event(event, state);
    let answer = command_audit_answer(event, &permission_chain);
    let latest_permission = permission_chain.last().cloned().unwrap_or(Value::Null);
    json!({
        "actor": event.actor.clone(),
        "correlation": correlation,
        "permissionChain": permission_chain,
        "latestPermission": latest_permission,
        "answer": answer
    })
}

pub(super) fn timeline_item_from_event(event: &StoredEvent, state: &SessionState) -> Value {
    let actor = &event.actor;
    let actor_kind = string_field(actor, "kind").unwrap_or_else(|| "system".to_string());
    let correlation = event.correlation.clone().unwrap_or_else(|| json!({}));
    let command_id = string_field(&correlation, "commandId");
    let agent_session_id = string_field(&correlation, "agentSessionId")
        .or_else(|| string_field(actor, "agentSessionId"));
    let runtime_turn_id = string_field(&correlation, "runtimeTurnId")
        .or_else(|| string_field(actor, "runtimeTurnId"));
    let tool_call_id =
        string_field(&correlation, "toolCallId").or_else(|| string_field(actor, "toolCallId"));
    let terminal_tool_name = string_field(&correlation, "terminalToolName");
    let payload = &event.payload;
    let mut base = Map::new();
    base.insert(
        "itemId".to_string(),
        Value::String(format!(
            "terminal-timeline-{}-{}",
            event.terminal_session_id, event.seq
        )),
    );
    base.insert(
        "terminalSessionId".to_string(),
        Value::String(event.terminal_session_id.clone()),
    );
    base.insert("seq".to_string(), json!(event.seq));
    base.insert("kind".to_string(), Value::String(event.kind.clone()));
    base.insert("actorKind".to_string(), Value::String(actor_kind));
    base.insert("actorLabel".to_string(), Value::String(actor_label(actor)));
    base.insert(
        "createdAt".to_string(),
        Value::String(event.created_at.clone().unwrap_or_else(now_iso)),
    );
    if let Some(value) = command_id {
        base.insert("commandId".to_string(), Value::String(value));
    }
    if let Some(value) = agent_session_id {
        base.insert("agentSessionId".to_string(), Value::String(value));
    }
    if let Some(value) = runtime_turn_id {
        base.insert("runtimeTurnId".to_string(), Value::String(value));
    }
    if let Some(value) = tool_call_id {
        base.insert("toolCallId".to_string(), Value::String(value));
    }
    if let Some(value) = terminal_tool_name.clone() {
        base.insert("terminalToolName".to_string(), Value::String(value));
    }
    if let Some(value) =
        string_field(&correlation, "permissionId").or_else(|| string_field(payload, "permissionId"))
    {
        base.insert("permissionId".to_string(), Value::String(value));
    }
    base.insert("actor".to_string(), actor.clone());
    base.insert("correlation".to_string(), correlation.clone());
    base.insert(
        "audit".to_string(),
        audit_projection_for_event(event, state),
    );
    base.insert("artifacts".to_string(), timeline_artifacts(state));

    let mut item = Value::Object(base);
    let object = item.as_object_mut().expect("timeline item object");
    match event.kind.as_str() {
        "session_created" => {
            object.insert(
                "title".to_string(),
                Value::String("Session created".to_string()),
            );
            object.insert(
                "subtitle".to_string(),
                Value::String(
                    string_field(payload, "title")
                        .unwrap_or_else(|| "Terminal session".to_string()),
                ),
            );
            let preview = ["cwd", "shell", "mode"]
                .iter()
                .filter_map(|key| string_field(payload, key))
                .collect::<Vec<_>>()
                .join(" - ");
            if !preview.is_empty() {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "input_text" => {
            object.insert(
                "title".to_string(),
                Value::String(
                    if payload
                        .get("appendNewline")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        "Command input"
                    } else {
                        "Terminal input"
                    }
                    .to_string(),
                ),
            );
            if let Some(value) = terminal_tool_name {
                object.insert("subtitle".to_string(), Value::String(value));
            }
            let preview = string_field(payload, "textPreview")
                .or_else(|| timeline_text(payload.get("text")))
                .or_else(|| timeline_text(payload.get("data")));
            if let Some(value) = preview {
                object.insert("preview".to_string(), Value::String(value));
            }
        }
        "input_keys" => {
            object.insert("title".to_string(), Value::String("Key input".to_string()));
            if let Some(keys) = payload.get("keys").and_then(Value::as_array) {
                object.insert(
                    "preview".to_string(),
                    Value::String(
                        keys.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(", "),
                    ),
                );
            }
        }
        "input_resize" => {
            object.insert(
                "title".to_string(),
                Value::String("Terminal resized".to_string()),
            );
            if let (Some(cols), Some(rows)) =
                (number_field(payload, "cols"), number_field(payload, "rows"))
            {
                object.insert(
                    "preview".to_string(),
                    Value::String(format!("{cols}x{rows}")),
                );
            }
        }
        "command_submitted" => {
            object.insert(
                "title".to_string(),
                Value::String("Command submitted".to_string()),
            );
            if let Some(preview) = timeline_text(payload.get("commandText")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "command_started" => {
            object.insert(
                "title".to_string(),
                Value::String("Command started".to_string()),
            );
            if let Some(preview) = timeline_text(payload.get("commandText")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "command_completed" => {
            object.insert(
                "title".to_string(),
                Value::String("Command completed".to_string()),
            );
            if let Some(exit_code) = payload.get("exitCode").and_then(Value::as_i64) {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("exit {exit_code}")),
                );
            }
            if let Some(preview) = timeline_text(payload.get("commandText")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "process_started" => {
            object.insert(
                "title".to_string(),
                Value::String("Process started".to_string()),
            );
            if let Some(process_id) = number_field(payload, "processId") {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("pid {process_id}")),
                );
            }
            if let Some(preview) = string_field(payload, "command")
                .or_else(|| string_field(payload, "shell"))
                .map(|value| preview_text(&value))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "process_signal_sent" => {
            object.insert(
                "title".to_string(),
                Value::String("Process signal sent".to_string()),
            );
            if let Some(signal) = string_field(payload, "signal") {
                object.insert("subtitle".to_string(), Value::String(signal));
            }
            if let Some(reason) = string_field(payload, "reason") {
                object.insert("preview".to_string(), Value::String(reason));
            }
        }
        "process_tree_snapshot" => {
            object.insert(
                "title".to_string(),
                Value::String("Process tree snapshot".to_string()),
            );
            if let Some(process_count) = number_field(payload, "processCount") {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("{process_count} process(es)")),
                );
            }
        }
        "output_chunk" => {
            object.insert(
                "title".to_string(),
                Value::String("Process output".to_string()),
            );
            if let Some(byte_length) = number_field(payload, "textByteLength")
                .or_else(|| number_field(payload, "rawByteLength"))
            {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("{byte_length} bytes")),
                );
            }
            if let Some(preview) = string_field(payload, "textPreview") {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "screen_diff" => {
            object.insert(
                "title".to_string(),
                Value::String("Screen updated".to_string()),
            );
            let mode = string_field(payload, "mode").unwrap_or_else(|| "unknown".to_string());
            if let Some(version) = number_field(payload, "screenVersion") {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("screen {version} - {mode}")),
                );
            }
            let preview = payload
                .get("dirtyRows")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| string_field(row, "text"))
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .map(|text| preview_text(&text))
                .filter(|text| !text.is_empty());
            if let Some(preview) = preview {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "process_exited" => {
            object.insert(
                "title".to_string(),
                Value::String("Process exited".to_string()),
            );
            let exit_code = payload.get("exitCode").and_then(Value::as_i64);
            if let Some(value) = exit_code {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("exit {value}")),
                );
            }
            object.insert(
                "preview".to_string(),
                Value::String(
                    if exit_code == Some(0) {
                        "Completed successfully"
                    } else {
                        "Exited with non-zero status"
                    }
                    .to_string(),
                ),
            );
        }
        "terminal_error" => {
            object.insert(
                "title".to_string(),
                Value::String("Terminal error".to_string()),
            );
            if let Some(preview) = timeline_text(payload.get("error")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "session_closed" => {
            object.insert(
                "title".to_string(),
                Value::String("Session closed".to_string()),
            );
        }
        "agent_attached" => {
            object.insert(
                "title".to_string(),
                Value::String("Agent attached".to_string()),
            );
            if let Some(agent_session_id) = string_field(payload, "agentSessionId") {
                object.insert("preview".to_string(), Value::String(agent_session_id));
            }
        }
        "agent_detached" => {
            object.insert(
                "title".to_string(),
                Value::String("Agent detached".to_string()),
            );
            if let Some(agent_session_id) = string_field(payload, "agentSessionId") {
                object.insert("preview".to_string(), Value::String(agent_session_id));
            }
        }
        "permission_requested"
        | "permission_granted"
        | "permission_denied"
        | "permission_expired" => {
            object.insert(
                "title".to_string(),
                Value::String(event.kind.replace('_', " ")),
            );
            if let Some(preview) =
                string_field(payload, "summary").or_else(|| string_field(payload, "permissionId"))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "handoff_started" | "handoff_completed" | "audit_read" => {
            object.insert(
                "title".to_string(),
                Value::String(event.kind.replace('_', " ")),
            );
            if let Some(preview) =
                string_field(payload, "summary").or_else(|| string_field(payload, "reader"))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        other => {
            object.insert("title".to_string(), Value::String(other.replace('_', " ")));
            if let Some(preview) =
                string_field(payload, "textPreview").or_else(|| timeline_text(payload.get("error")))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
    }
    item
}

pub(super) fn append_timeline_item_for_event(
    event: &StoredEvent,
    state: &mut SessionState,
) -> MemoryResult<()> {
    let mut item = timeline_item_from_event(event, state);
    let item_index = state.timeline_item_count.saturating_add(1);
    state.timeline_item_count = item_index;
    if let Some(object) = item.as_object_mut() {
        object.insert("itemIndex".to_string(), json!(item_index));
        state.latest_timeline_preview =
            string_field(&item, "preview").or_else(|| string_field(&item, "title"));
    }
    append_json_line(&state.paths.ui_timeline_path, &item)
}

pub(super) fn append_event(
    session_id: &str,
    state: &mut SessionState,
    kind: &str,
    actor: Value,
    payload: Value,
    correlation: Value,
    model_context_policy: &str,
    ui_policy: &str,
) -> MemoryResult<u64> {
    let seq = state.next_seq;
    state.next_seq = state.next_seq.saturating_add(1);
    let event = json!({
        "eventId": format!("terminal-event-{}", Uuid::new_v4()),
        "terminalSessionId": session_id,
        "seq": seq,
        "kind": kind,
        "actor": actor,
        "payload": payload,
        "createdAt": now_iso(),
        "createdAtMs": now_ms(),
        "correlation": compact_object(correlation.clone()),
        "visibility": "user_visible",
        "modelContextPolicy": model_context_policy,
        "uiPolicy": ui_policy,
        "auditPolicy": "full"
    });
    append_json_line(&state.paths.events_path, &event)?;
    append_event_index(&state.paths, &event)?;
    let stored = StoredEvent {
        event_id: string_field(&event, "eventId"),
        terminal_session_id: session_id.to_string(),
        seq,
        kind: kind.to_string(),
        actor,
        payload,
        created_at: string_field(&event, "createdAt"),
        correlation: Some(compact_object(correlation)),
    };
    append_timeline_item_for_event(&stored, state)?;
    state.latest_event_kind = Some(kind.to_string());
    write_summary(session_id, state, false)?;
    Ok(seq)
}

pub(super) fn create_command_id() -> String {
    format!("terminal-command-{}", Uuid::new_v4())
}

pub(super) fn append_command_record(state: &mut SessionState, record: Value) -> MemoryResult<()> {
    let command_seq = state.next_command_seq;
    state.next_command_seq = state.next_command_seq.saturating_add(1);
    let record = merge_object(
        record,
        json!({ "commandSeq": command_seq, "recordedAt": now_iso() }),
    );
    append_json_line(&state.paths.commands_path, &record)?;
    append_command_index(&state.paths, &record)
}

pub(super) fn command_id_from_correlation(correlation: &Value) -> Option<String> {
    string_field(correlation, "commandId")
}

pub(super) fn append_command_lifecycle_event(
    session_id: &str,
    state: &mut SessionState,
    kind: &str,
    command_id: &str,
    command_text: Option<&str>,
    actor: Value,
    correlation: Value,
    extra_payload: Value,
) -> MemoryResult<()> {
    let payload = merge_object(
        json!({
            "commandId": command_id,
            "commandText": command_text,
            "normalizedCommandText": command_text.map(str::trim)
        }),
        extra_payload,
    );
    append_event(
        session_id,
        state,
        kind,
        actor,
        payload,
        merge_object(correlation, json!({ "commandId": command_id })),
        "include_as_runtime_state",
        "show_in_timeline",
    )
    .map(|_| ())
}

pub(super) fn record_known_command(
    session_id: &str,
    state: &mut SessionState,
    command_text: &str,
    actor: Value,
    correlation: Value,
    status: &str,
    exit_code: Option<i32>,
) -> MemoryResult<String> {
    let command_id = command_id_from_correlation(&correlation).unwrap_or_else(create_command_id);
    let output_text_start = file_size(&state.paths.output_text_path);
    let raw_output_start = file_size(&state.paths.raw_output_path);
    if status == "running" {
        state.active_command_id = Some(command_id.clone());
        state.active_command_output_text_start = Some(output_text_start);
        state.active_command_raw_start = Some(raw_output_start);
    }
    append_command_record(
        state,
        json!({
            "commandId": command_id,
            "terminalSessionId": session_id,
            "commandText": command_text,
            "normalizedCommandText": command_text.trim(),
            "actor": actor,
            "status": status,
            "exitCode": exit_code,
            "signal": null,
            "outputTextRange": { "start": output_text_start, "end": output_text_start },
            "rawOutputRange": { "start": raw_output_start, "end": raw_output_start },
            "correlation": merge_object(correlation.clone(), json!({ "commandId": command_id })),
            "confidence": 0.6
        }),
    )?;
    if status == "running" {
        append_command_lifecycle_event(
            session_id,
            state,
            "command_submitted",
            &command_id,
            Some(command_text),
            actor.clone(),
            correlation.clone(),
            json!({
                "outputTextRange": { "start": output_text_start, "end": output_text_start },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_start }
            }),
        )?;
        append_command_lifecycle_event(
            session_id,
            state,
            "command_started",
            &command_id,
            Some(command_text),
            actor,
            correlation,
            json!({
                "outputTextRange": { "start": output_text_start, "end": output_text_start },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_start }
            }),
        )?;
    }
    Ok(command_id)
}

pub(super) fn command_text_from_write(input: &WriteInput) -> Option<String> {
    if !input.append_newline || input.keys.as_ref().is_some_and(|keys| !keys.is_empty()) {
        return None;
    }
    input
        .text
        .as_ref()
        .or(input.data.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(super) fn append_output_line_record(
    session_id: &str,
    state: &mut SessionState,
    line_text: &str,
    text_offset: u64,
    output_event_seq: u64,
    created_at: &str,
) -> MemoryResult<()> {
    let line_number = state.next_line_number;
    state.next_line_number = state.next_line_number.saturating_add(1);
    let text_preview = preview_text(line_text);
    if !text_preview.is_empty() {
        state.latest_output_preview = Some(text_preview.clone());
    }
    let line_record = json!({
        "lineNumber": line_number,
        "terminalSessionId": session_id,
        "outputEventSeq": output_event_seq,
        "commandId": state.active_command_id,
        "textOffset": text_offset,
        "byteLength": line_text.len(),
        "textPreview": text_preview,
        "sha256": sha256_hex(line_text.as_bytes()),
        "createdAt": created_at
    });
    append_json_line(&state.paths.line_index_path, &line_record)?;
    if let Some(severity) = classify_output_issue(line_text) {
        state.error_count = state.error_count.saturating_add(1);
        append_json_line(
            &state.paths.error_index_path,
            &merge_object(
                line_record,
                json!({
                    "errorNumber": state.error_count,
                    "severity": severity
                }),
            ),
        )?;
    }
    Ok(())
}

pub(super) fn index_output_text(
    session_id: &str,
    state: &mut SessionState,
    text: &str,
    text_start: u64,
    output_event_seq: u64,
    created_at: &str,
) -> MemoryResult<()> {
    let mut current_offset = text_start;
    let mut segment_start_offset = text_start;
    let mut segment = String::new();
    for character in text.chars() {
        let char_byte_length = character.len_utf8() as u64;
        if character == '\n' {
            let line_text = format!("{}{}", state.pending_line_text, segment);
            let line_offset = if state.pending_line_text.is_empty() {
                segment_start_offset
            } else {
                state.pending_line_text_offset
            };
            append_output_line_record(
                session_id,
                state,
                &line_text,
                line_offset,
                output_event_seq,
                created_at,
            )?;
            state.pending_line_text.clear();
            state.pending_line_text_offset = current_offset.saturating_add(char_byte_length);
            segment.clear();
            segment_start_offset = current_offset.saturating_add(char_byte_length);
        } else {
            segment.push(character);
        }
        current_offset = current_offset.saturating_add(char_byte_length);
    }
    if !segment.is_empty() {
        if state.pending_line_text.is_empty() {
            state.pending_line_text_offset = segment_start_offset;
        }
        state.pending_line_text.push_str(&segment);
        let preview = preview_text(&state.pending_line_text);
        if !preview.is_empty() {
            state.latest_output_preview = Some(preview);
        }
    }
    Ok(())
}

pub(super) fn flush_pending_output_line(
    session_id: &str,
    state: &mut SessionState,
    output_event_seq: u64,
    created_at: &str,
) -> MemoryResult<()> {
    if state.pending_line_text.is_empty() {
        return Ok(());
    }
    let line_text = state.pending_line_text.clone();
    append_output_line_record(
        session_id,
        state,
        &line_text,
        state.pending_line_text_offset,
        output_event_seq,
        created_at,
    )?;
    state.pending_line_text.clear();
    state.pending_line_text_offset = file_size(&state.paths.output_text_path);
    Ok(())
}

pub(super) fn stored_event_from_record(record: &Value) -> Option<StoredEvent> {
    let terminal_session_id = string_field(record, "terminalSessionId")?;
    let seq = number_field(record, "seq")?;
    let kind = string_field(record, "kind")?;
    Some(StoredEvent {
        event_id: string_field(record, "eventId"),
        terminal_session_id,
        seq,
        kind,
        actor: record
            .get("actor")
            .cloned()
            .unwrap_or_else(|| json!({ "kind": "system" })),
        payload: record.get("payload").cloned().unwrap_or_else(|| json!({})),
        created_at: string_field(record, "createdAt"),
        correlation: record.get("correlation").cloned(),
    })
}

pub(super) fn rebuild_timeline_projection(
    session_id: &str,
    state: &mut SessionState,
) -> MemoryResult<()> {
    let mut events =
        read_jsonl_with_repair_log(&state.paths.events_path, Some(&state.paths.repair_log_path))
            .into_iter()
            .filter_map(|record| stored_event_from_record(&record))
            .filter(|event| event.terminal_session_id == session_id)
            .collect::<Vec<_>>();
    events.sort_by_key(|event| event.seq);
    state.timeline_item_count = 0;
    state.latest_timeline_preview = None;
    File::create(&state.paths.ui_timeline_path).map_err(|error| error.to_string())?;
    for event in events {
        append_timeline_item_for_event(&event, state)?;
    }
    Ok(())
}

pub(super) fn timeline_summary(session_id: &str, state: &SessionState) -> Value {
    let memory = metadata_from_state(state, false);
    json!({
        "terminalSessionId": session_id,
        "itemCount": state.timeline_item_count,
        "eventCount": state.next_seq.saturating_sub(1),
        "lineCount": memory.get("lineCount").and_then(Value::as_u64).unwrap_or(0),
        "errorCount": memory.get("errorCount").and_then(Value::as_u64).unwrap_or(0),
        "estimatedTokens": memory.get("estimatedTokens").and_then(Value::as_u64).unwrap_or(0),
        "updatedAt": now_iso(),
        "latestEventKind": state.latest_event_kind,
        "latestItemPreview": state.latest_timeline_preview
    })
}

pub(super) fn normalize_string_filter(values: Option<Vec<String>>) -> Vec<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

pub(super) fn event_actor_kind(event: &Value) -> Option<String> {
    event
        .get("actor")
        .and_then(|actor| string_field(actor, "kind"))
}

pub(super) fn optional_trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
