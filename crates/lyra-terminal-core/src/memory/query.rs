use super::*;

pub fn read_events(input: EventsReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let limit = input
        .limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .min(MAX_EVENTS_LIMIT);
    let cursor_seq = input
        .cursor
        .as_deref()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let kind_filter = normalize_string_filter(input.kinds);
    let actor_filter = normalize_string_filter(input.actors);

    let mut events =
        read_jsonl_with_repair_log(&guard.paths.events_path, Some(&guard.paths.repair_log_path))
            .into_iter()
            .filter(|event| {
                string_field(event, "terminalSessionId")
                    .is_some_and(|session_id| session_id == input.session_id)
            })
            .filter(|event| number_field(event, "seq").unwrap_or(0) > cursor_seq)
            .filter(|event| {
                kind_filter.is_empty()
                    || string_field(event, "kind").is_some_and(|kind| kind_filter.contains(&kind))
            })
            .filter(|event| {
                actor_filter.is_empty()
                    || event_actor_kind(event).is_some_and(|actor| actor_filter.contains(&actor))
            })
            .collect::<Vec<_>>();
    events.sort_by_key(|event| number_field(event, "seq").unwrap_or(0));

    let has_more = events.len() > limit;
    let selected = events.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = selected
        .last()
        .and_then(|event| number_field(event, "seq"))
        .unwrap_or(cursor_seq)
        .to_string();
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "cursor": cursor_seq.to_string(),
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "memory": memory,
        "items": selected
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.events.read",
            json!({
                "cursor": cursor_seq.to_string(),
                "nextCursor": next_cursor,
                "limit": limit,
                "kinds": kind_filter,
                "actors": actor_filter
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

pub fn read_commands(input: CommandsReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let limit = input
        .limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_COMMANDS_LIMIT)
        .min(MAX_COMMANDS_LIMIT);
    let cursor_seq = input
        .cursor
        .as_deref()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let status_filter = input
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| *value != "all")
        .map(ToString::to_string);

    let mut commands = read_jsonl_with_repair_log(
        &guard.paths.commands_path,
        Some(&guard.paths.repair_log_path),
    )
    .into_iter()
    .enumerate()
    .filter_map(|(index, mut command)| {
        if !string_field(&command, "terminalSessionId")
            .is_some_and(|session_id| session_id == input.session_id)
        {
            return None;
        }
        let command_seq = number_field(&command, "commandSeq").unwrap_or_else(|| index as u64 + 1);
        if command_seq <= cursor_seq {
            return None;
        }
        if status_filter
            .as_ref()
            .is_some_and(|status| string_field(&command, "status").as_ref() != Some(status))
        {
            return None;
        }
        if let Some(object) = command.as_object_mut() {
            object.insert("commandSeq".to_string(), json!(command_seq));
        }
        Some(command)
    })
    .collect::<Vec<_>>();
    commands.sort_by_key(|command| number_field(command, "commandSeq").unwrap_or(0));

    let has_more = commands.len() > limit;
    let selected = commands.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = selected
        .last()
        .and_then(|command| number_field(command, "commandSeq"))
        .unwrap_or(cursor_seq)
        .to_string();
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "cursor": cursor_seq.to_string(),
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "memory": memory,
        "items": selected
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.commands.read",
            json!({
                "cursor": cursor_seq.to_string(),
                "nextCursor": next_cursor,
                "limit": limit,
                "status": status_filter
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

pub(super) fn read_byte_range(path: &Path, start: u64, end: u64) -> MemoryResult<Vec<u8>> {
    let length = end.saturating_sub(start);
    if length == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::with_capacity(length.min(usize::MAX as u64) as usize);
    file.take(length)
        .read_to_end(&mut buffer)
        .map_err(|error| error.to_string())?;
    Ok(buffer)
}

pub fn read_output_range(input: OutputRangeReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let path = if input.raw {
        &guard.paths.raw_output_path
    } else {
        &guard.paths.output_text_path
    };
    let total_bytes = file_size(path);
    let start = input.start.min(total_bytes);
    let requested_end = input.end.min(total_bytes).max(start);
    let end = start
        .saturating_add(MAX_OUTPUT_RANGE_BYTES)
        .min(requested_end);
    let bytes = read_byte_range(path, start, end)?;
    let output = String::from_utf8_lossy(&bytes).to_string();
    let truncated = end < requested_end;
    let memory = metadata_from_state(&guard, truncated);
    let response = json!({
        "sessionId": input.session_id,
        "raw": input.raw,
        "encoding": if input.raw { "utf8-lossy" } else { "utf8" },
        "requestedRange": { "start": input.start, "end": input.end },
        "range": { "start": start, "end": end },
        "nextStart": end,
        "byteLength": bytes.len(),
        "totalBytes": total_bytes,
        "output": output,
        "rawBytesHex": if input.raw { Value::String(hex_encode(&bytes)) } else { Value::Null },
        "sha256": sha256_hex(&bytes),
        "truncated": truncated,
        "memory": memory
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.output.readRange",
            json!({
                "raw": input.raw,
                "requestedRange": { "start": input.start, "end": input.end },
                "range": { "start": start, "end": end },
                "truncated": truncated
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

pub fn list_artifacts(input: ArtifactsListInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "memory": memory,
        "items": artifact_records(&guard)
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.artifacts.list",
            json!({}),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

pub(super) fn metadata_json(storage_root: &str, session_id: &str, truncated: bool) -> MemoryResult<Value> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let memory = metadata_from_state(&guard, truncated);
    write_summary(
        session_id,
        &guard,
        memory
            .get("truncatedByProjection")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    )?;
    Ok(memory)
}

pub fn metadata_for_session(
    storage_root: &str,
    session_id: &str,
    truncated: bool,
) -> MemoryResult<String> {
    serde_json::to_string(&metadata_json(storage_root, session_id, truncated)?)
        .map_err(|error| error.to_string())
}

pub fn output_text_size(storage_root: &str, session_id: &str) -> MemoryResult<u64> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    Ok(file_size(&guard.paths.output_text_path))
}

pub(super) fn is_utf8_continuation_byte(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

pub(super) fn clamp_to_utf8_boundary(path: &Path, cursor: u64, total_bytes: u64) -> u64 {
    let mut start = cursor.min(total_bytes);
    while start > 0 && start < total_bytes {
        let byte = read_byte_range(path, start, start.saturating_add(1))
            .ok()
            .and_then(|bytes| bytes.first().copied());
        if !byte.is_some_and(is_utf8_continuation_byte) {
            break;
        }
        start = start.saturating_sub(1);
    }
    start
}

pub fn read_output_projection(
    storage_root: &str,
    session_id: &str,
    cursor: u64,
    max_bytes: usize,
) -> MemoryResult<OutputProjection> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let path = &guard.paths.output_text_path;
    let total_bytes = file_size(path);
    let start = clamp_to_utf8_boundary(path, cursor, total_bytes);
    let requested_len = max_bytes.max(1) as u64;
    let read_end = start
        .saturating_add(requested_len)
        .saturating_add(4)
        .min(total_bytes);
    let bytes = read_byte_range(path, start, read_end)?;
    let mut valid_len = bytes.len().min(max_bytes.max(1));
    while valid_len > 0 && std::str::from_utf8(&bytes[..valid_len]).is_err() {
        valid_len -= 1;
    }
    if valid_len == 0 && !bytes.is_empty() {
        valid_len = bytes
            .iter()
            .enumerate()
            .skip(1)
            .find_map(|(index, byte)| {
                if is_utf8_continuation_byte(*byte) {
                    None
                } else {
                    Some(index)
                }
            })
            .unwrap_or(bytes.len());
        while valid_len > 0 && std::str::from_utf8(&bytes[..valid_len]).is_err() {
            valid_len -= 1;
        }
    }
    let output =
        String::from_utf8(bytes[..valid_len].to_vec()).map_err(|error| error.to_string())?;
    let end = start.saturating_add(valid_len as u64);

    Ok(OutputProjection {
        cursor: end,
        output,
        truncated: end < total_bytes,
    })
}

pub(super) fn last_exit_code_from_paths(paths: &SessionPaths, session_id: &str) -> Option<i32> {
    read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path))
        .into_iter()
        .filter(|event| {
            string_field(event, "terminalSessionId").as_deref() == Some(session_id)
                && string_field(event, "kind").as_deref() == Some("process_exited")
        })
        .last()
        .and_then(|event| {
            event
                .get("payload")
                .and_then(|payload| payload.get("exitCode"))
                .and_then(Value::as_i64)
        })
        .and_then(|value| i32::try_from(value).ok())
}

pub fn last_exit_code(storage_root: &str, session_id: &str) -> MemoryResult<Option<i32>> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    Ok(last_exit_code_from_paths(&guard.paths, session_id))
}

pub fn stored_session_metadata(storage_root: &str, session_id: &str) -> MemoryResult<Value> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let created = session_created_record(&guard.paths, session_id);
    let payload = created
        .as_ref()
        .and_then(|event| event.get("payload").cloned())
        .unwrap_or_else(|| json!({}));
    Ok(json!({
        "sessionId": session_id,
        "title": string_field(&payload, "title").unwrap_or_else(|| session_id.to_string()),
        "cwd": string_field(&payload, "cwd"),
        "shell": string_field(&payload, "shell").unwrap_or_else(|| "unknown".to_string()),
        "cols": number_field(&payload, "cols").unwrap_or(80).min(u16::MAX as u64),
        "rows": number_field(&payload, "rows").unwrap_or(24).min(u16::MAX as u64),
        "createdAt": created.as_ref().and_then(|event| string_field(event, "createdAt")).unwrap_or_else(now_iso),
        "source": string_field(&payload, "source").unwrap_or_else(|| "system".to_string()),
        "mode": string_field(&payload, "mode").unwrap_or_else(|| "shell".to_string()),
        "command": string_field(&payload, "command"),
        "persist": payload.get("persist").and_then(Value::as_bool).unwrap_or(true),
        "running": false,
        "exitCode": last_exit_code_from_paths(&guard.paths, session_id).map(Value::from).unwrap_or(Value::Null),
        "restoration": restoration_state_json()
    }))
}

pub fn read_stored_sessions(storage_root: &str) -> MemoryResult<String> {
    let sessions_root = Path::new(storage_root)
        .join("terminal-memory")
        .join("sessions");
    let mut items = Vec::new();
    let entries = match fs::read_dir(&sessions_root) {
        Ok(entries) => entries,
        Err(_) => {
            let response = json!({
                "storageRoot": storage_root,
                "sessionsRoot": sessions_root.to_string_lossy(),
                "items": items
            });
            return serde_json::to_string(&response).map_err(|error| error.to_string());
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let fallback_id = entry.file_name().to_string_lossy().to_string();
        let session_id = fs::read_to_string(path.join("summary.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|summary| string_field(&summary, "terminalSessionId"))
            .unwrap_or(fallback_id);
        if let Ok(metadata) = stored_session_metadata(storage_root, &session_id) {
            items.push(metadata);
        }
    }
    items.sort_by(|left, right| {
        string_field(left, "createdAt")
            .unwrap_or_default()
            .cmp(&string_field(right, "createdAt").unwrap_or_default())
    });
    let response = json!({
        "storageRoot": storage_root,
        "sessionsRoot": sessions_root.to_string_lossy(),
        "items": items
    });
    serde_json::to_string(&response).map_err(|error| error.to_string())
}

pub fn replay_screen_snapshot(
    storage_root: &str,
    session_id: &str,
    include_scrollback: bool,
    max_rows: Option<u32>,
    max_bytes: Option<u32>,
) -> MemoryResult<crate::screen::TerminalScreenSnapshot> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let created = session_created_record(&guard.paths, session_id);
    let payload = created
        .as_ref()
        .and_then(|event| event.get("payload").cloned())
        .unwrap_or_else(|| json!({}));
    let rows = number_field(&payload, "rows")
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(24)
        .max(1);
    let cols = number_field(&payload, "cols")
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(80)
        .max(1);
    let mut screen = TerminalScreenState::new(rows, cols);
    let mut events =
        read_jsonl_with_repair_log(&guard.paths.events_path, Some(&guard.paths.repair_log_path))
            .into_iter()
            .filter(|event| string_field(event, "terminalSessionId").as_deref() == Some(session_id))
            .collect::<Vec<_>>();
    events.sort_by_key(|event| number_field(event, "seq").unwrap_or(0));
    for event in events {
        let payload = event.get("payload").cloned().unwrap_or_else(|| json!({}));
        match string_field(&event, "kind").as_deref() {
            Some("input_resize") => {
                let rows = number_field(&payload, "rows")
                    .and_then(|value| u16::try_from(value).ok())
                    .unwrap_or(rows);
                let cols = number_field(&payload, "cols")
                    .and_then(|value| u16::try_from(value).ok())
                    .unwrap_or(cols);
                screen.resize(rows, cols);
            }
            Some("output_chunk") => {
                let raw_offset = number_field(&payload, "rawOffset").unwrap_or(0);
                let raw_len = number_field(&payload, "rawByteLength").unwrap_or(0);
                let raw_end = raw_offset.saturating_add(raw_len);
                let bytes = read_byte_range(&guard.paths.raw_output_path, raw_offset, raw_end)?;
                screen.feed(&bytes);
            }
            _ => {}
        }
    }
    Ok(screen.snapshot(include_scrollback, max_rows, max_bytes))
}

pub fn read_timeline(input: TimelineReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let event_end = guard.next_seq.saturating_sub(1);
    let last_timeline_seq = read_last_jsonl(&guard.paths.ui_timeline_path)
        .and_then(|record| number_field(&record, "seq"))
        .unwrap_or(0);
    if event_end > 0 && (guard.timeline_item_count == 0 || last_timeline_seq < event_end) {
        rebuild_timeline_projection(&input.session_id, &mut guard)?;
    }

    let limit = input
        .limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_TIMELINE_LIMIT)
        .min(MAX_TIMELINE_LIMIT);
    let cursor_seq = input
        .cursor
        .as_deref()
        .and_then(|value| value.trim().parse::<u64>().ok());
    let kind_filter = input
        .kinds
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let actor_filter = input
        .actors
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let command_id_filter = optional_trimmed(input.command_id);
    let tool_call_id_filter = optional_trimmed(input.tool_call_id);
    let agent_session_id_filter = optional_trimmed(input.agent_session_id);
    let mut all_items = read_jsonl_with_repair_log(
        &guard.paths.ui_timeline_path,
        Some(&guard.paths.repair_log_path),
    )
    .into_iter()
    .filter(|item| {
        kind_filter.is_empty()
            || string_field(item, "kind").is_some_and(|kind| kind_filter.contains(&kind))
    })
    .filter(|item| {
        actor_filter.is_empty()
            || string_field(item, "actorKind").is_some_and(|actor| actor_filter.contains(&actor))
    })
    .filter(|item| {
        command_id_filter
            .as_ref()
            .is_none_or(|value| string_field(item, "commandId").as_ref() == Some(value))
    })
    .filter(|item| {
        tool_call_id_filter
            .as_ref()
            .is_none_or(|value| string_field(item, "toolCallId").as_ref() == Some(value))
    })
    .filter(|item| {
        agent_session_id_filter
            .as_ref()
            .is_none_or(|value| string_field(item, "agentSessionId").as_ref() == Some(value))
    })
    .filter(|item| cursor_seq.is_none_or(|cursor| number_field(item, "seq").unwrap_or(0) < cursor))
    .filter(|item| {
        input
            .seq_start
            .is_none_or(|start| number_field(item, "seq").unwrap_or(0) >= start)
    })
    .filter(|item| {
        input
            .seq_end
            .is_none_or(|end| number_field(item, "seq").unwrap_or(0) <= end)
    })
    .filter(|item| {
        input.time_start_ms.is_none_or(|start| {
            item.get("createdAtMs")
                .and_then(Value::as_i64)
                .or_else(|| {
                    string_field(item, "createdAt")
                        .and_then(|created_at| {
                            chrono::DateTime::parse_from_rfc3339(&created_at).ok()
                        })
                        .map(|created_at| created_at.timestamp_millis())
                })
                .unwrap_or(0)
                >= start
        })
    })
    .filter(|item| {
        input.time_end_ms.is_none_or(|end| {
            item.get("createdAtMs")
                .and_then(Value::as_i64)
                .or_else(|| {
                    string_field(item, "createdAt")
                        .and_then(|created_at| {
                            chrono::DateTime::parse_from_rfc3339(&created_at).ok()
                        })
                        .map(|created_at| created_at.timestamp_millis())
                })
                .unwrap_or(0)
                <= end
        })
    })
    .collect::<Vec<_>>();
    all_items.sort_by_key(|item| number_field(item, "seq").unwrap_or(0));
    let selected_start = all_items.len().saturating_sub(limit);
    let has_more = selected_start > 0;
    let mut selected = all_items.split_off(selected_start);
    for item in &mut selected {
        if let Some(object) = item.as_object_mut() {
            object.remove("itemIndex");
        }
    }
    let next_cursor = if has_more {
        selected
            .first()
            .and_then(|item| number_field(item, "seq"))
            .map(|seq| seq.to_string())
    } else {
        None
    };
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "cursor": input.cursor,
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "summary": timeline_summary(&input.session_id, &guard),
        "memory": memory,
        "items": selected
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.memory.readTimeline",
            json!({
                "cursor": input.cursor,
                "nextCursor": next_cursor,
                "limit": limit,
                "kinds": kind_filter,
                "actors": actor_filter,
                "commandId": command_id_filter,
                "toolCallId": tool_call_id_filter,
                "agentSessionId": agent_session_id_filter,
                "seqStart": input.seq_start,
                "seqEnd": input.seq_end,
                "timeStartMs": input.time_start_ms,
                "timeEndMs": input.time_end_ms
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}
