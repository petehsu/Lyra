use super::*;

pub(super) fn command_text_for_id(state: &SessionState, command_id: &str) -> Option<String> {
    read_jsonl_with_repair_log(
        &state.paths.commands_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|record| string_field(record, "commandId").as_deref() == Some(command_id))
    .find_map(|record| string_field(&record, "commandText"))
}

pub(super) fn latest_command_record_for_id(
    state: &SessionState,
    command_id: &str,
) -> Option<Value> {
    read_jsonl_with_repair_log(
        &state.paths.commands_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .rev()
    .find(|record| string_field(record, "commandId").as_deref() == Some(command_id))
}

pub(super) fn latest_command_status_for_id(
    state: &SessionState,
    command_id: &str,
) -> Option<String> {
    latest_command_record_for_id(state, command_id)
        .and_then(|record| string_field(&record, "status"))
}

pub(super) fn command_range_start(record: Option<&Value>, field: &str, fallback: u64) -> u64 {
    record
        .and_then(|value| value.get(field))
        .and_then(|range| number_field(range, "start"))
        .unwrap_or(fallback)
        .min(fallback)
}

pub(super) struct CommandArtifactPaths {
    root: PathBuf,
    meta: PathBuf,
    output_text: PathBuf,
    raw_output: PathBuf,
    events: PathBuf,
    summary: PathBuf,
}

pub(super) fn command_artifact_paths(
    state: &SessionState,
    command_id: &str,
) -> CommandArtifactPaths {
    let root = state
        .paths
        .command_artifacts_root_path
        .join(safe_segment(command_id));
    CommandArtifactPaths {
        meta: root.join("meta.json"),
        output_text: root.join("output.txt"),
        raw_output: root.join("output.raw"),
        events: root.join("events.jsonl"),
        summary: root.join("summary.json"),
        root,
    }
}

pub(super) fn command_artifact_metadata(paths: &CommandArtifactPaths) -> Value {
    json!({
        "artifactRootPath": paths.root.to_string_lossy(),
        "commandMetaPath": paths.meta.to_string_lossy(),
        "commandOutputTextPath": paths.output_text.to_string_lossy(),
        "commandRawOutputPath": paths.raw_output.to_string_lossy(),
        "commandEventsPath": paths.events.to_string_lossy(),
        "commandSummaryPath": paths.summary.to_string_lossy()
    })
}

pub(super) fn event_command_id(event: &Value) -> Option<String> {
    event
        .get("correlation")
        .and_then(|correlation| string_field(correlation, "commandId"))
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| string_field(payload, "commandId"))
        })
}

pub(super) fn write_command_events_artifact(
    state: &SessionState,
    command_id: &str,
    path: &Path,
) -> MemoryResult<(u64, Option<u64>, Option<u64>)> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    let mut count = 0_u64;
    let mut first_seq = None;
    let mut last_seq = None;
    for event in
        read_jsonl_with_repair_log(&state.paths.events_path, Some(&state.paths.repair_log_path))
            .into_iter()
            .filter(|event| event_command_id(event).as_deref() == Some(command_id))
    {
        let seq = number_field(&event, "seq");
        if first_seq.is_none() {
            first_seq = seq;
        }
        last_seq = seq.or(last_seq);
        serde_json::to_writer(&mut file, &event).map_err(|error| error.to_string())?;
        file.write_all(b"\n").map_err(|error| error.to_string())?;
        count = count.saturating_add(1);
    }
    Ok((count, first_seq, last_seq))
}

pub(super) fn output_lines_for_range(state: &SessionState, start: u64, end: u64) -> Vec<Value> {
    read_jsonl_with_repair_log(
        &state.paths.line_index_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|line| {
        number_field(line, "textOffset").is_some_and(|offset| offset >= start && offset < end)
    })
    .collect()
}

pub(super) fn error_lines_for_range(
    state: &SessionState,
    command_id: &str,
    start: u64,
    end: u64,
) -> Vec<Value> {
    read_jsonl_with_repair_log(
        &state.paths.error_index_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|error| {
        string_field(error, "commandId").as_deref() == Some(command_id)
            || number_field(error, "textOffset")
                .is_some_and(|offset| offset >= start && offset < end)
    })
    .collect()
}

#[allow(clippy::too_many_arguments)]
pub(super) fn write_command_artifacts(
    session_id: &str,
    state: &SessionState,
    command_id: &str,
    command_text: Option<&str>,
    status: &str,
    exit_code: Option<i32>,
    signal: Option<&str>,
    actor: &Value,
    correlation: &Value,
    output_text_start: u64,
    output_text_end: u64,
    raw_output_start: u64,
    raw_output_end: u64,
    completed_at: &str,
) -> MemoryResult<CommandCompletionProjection> {
    let paths = command_artifact_paths(state, command_id);
    fs::create_dir_all(&paths.root).map_err(|error| error.to_string())?;

    let output_bytes = read_byte_range(
        &state.paths.output_text_path,
        output_text_start,
        output_text_end,
    )?;
    let raw_bytes = read_byte_range(
        &state.paths.raw_output_path,
        raw_output_start,
        raw_output_end,
    )?;
    fs::write(&paths.output_text, &output_bytes).map_err(|error| error.to_string())?;
    fs::write(&paths.raw_output, &raw_bytes).map_err(|error| error.to_string())?;

    let (event_count, first_event_seq, last_event_seq) =
        write_command_events_artifact(state, command_id, &paths.events)?;
    let output_text = String::from_utf8_lossy(&output_bytes).to_string();
    let output_lines = output_lines_for_range(state, output_text_start, output_text_end);
    let error_lines = error_lines_for_range(state, command_id, output_text_start, output_text_end);
    let non_empty_lines = output_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let first_output_preview = non_empty_lines.first().map(|line| preview_text(line));
    let last_output_preview = non_empty_lines.last().map(|line| preview_text(line));
    let metadata = command_artifact_metadata(&paths);
    let output_text_range = json!({ "start": output_text_start, "end": output_text_end });
    let raw_output_range = json!({ "start": raw_output_start, "end": raw_output_end });

    let meta = merge_object(
        json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "commandId": command_id,
            "commandText": command_text,
            "normalizedCommandText": command_text.map(str::trim),
            "status": status,
            "exitCode": exit_code,
            "signal": signal,
            "actor": actor,
            "correlation": correlation,
            "outputTextRange": output_text_range.clone(),
            "rawOutputRange": raw_output_range.clone(),
            "completedAt": completed_at,
            "updatedAt": now_iso()
        }),
        metadata.clone(),
    );
    write_json_pretty(&paths.meta, &meta)?;
    write_json_pretty(
        &paths.summary,
        &merge_object(
            json!({
                "schemaVersion": 1,
                "terminalSessionId": session_id,
                "commandId": command_id,
                "status": status,
                "exitCode": exit_code,
                "signal": signal,
                "outputByteLength": output_bytes.len(),
                "rawByteLength": raw_bytes.len(),
                "estimatedTokens": estimate_tokens(output_bytes.len() as u64),
                "firstOutputPreview": first_output_preview,
                "lastOutputPreview": last_output_preview,
                "lineCount": output_lines.len(),
                "errorCount": error_lines.len(),
                "lastErrorLines": error_lines
                    .iter()
                    .filter_map(|line| string_field(line, "textPreview"))
                    .rev()
                    .take(5)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>(),
                "eventCount": event_count,
                "eventSeqRange": match (first_event_seq, last_event_seq) {
                    (Some(start), Some(end)) => json!({ "start": start, "end": end }),
                    _ => Value::Null
                },
                "completedAt": completed_at
            }),
            metadata.clone(),
        ),
    )?;

    Ok(CommandCompletionProjection {
        terminal_session_id: session_id.to_string(),
        command_id: command_id.to_string(),
        command_text: command_text.map(ToString::to_string),
        status: status.to_string(),
        exit_code,
        signal: signal.map(ToString::to_string),
        actor: actor.clone(),
        correlation: correlation.clone(),
        output_text_range,
        raw_output_range,
        artifact_root_path: paths.root.to_string_lossy().to_string(),
        command_meta_path: paths.meta.to_string_lossy().to_string(),
        command_output_text_path: paths.output_text.to_string_lossy().to_string(),
        command_raw_output_path: paths.raw_output.to_string_lossy().to_string(),
        command_events_path: paths.events.to_string_lossy().to_string(),
        command_summary_path: paths.summary.to_string_lossy().to_string(),
        completed_at: completed_at.to_string(),
    })
}

pub(super) fn complete_command_from_shell_event(
    session_id: &str,
    state: &mut SessionState,
    command_id: String,
    command_text: Option<String>,
    exit_code: Option<i32>,
    signal: Option<String>,
    actor: Value,
    correlation: Value,
) -> MemoryResult<Option<CommandCompletionProjection>> {
    if latest_command_status_for_id(state, &command_id)
        .as_deref()
        .is_some_and(|status| status != "running" && status != "pending")
    {
        return Ok(None);
    }

    let latest = latest_command_record_for_id(state, &command_id);
    let output_text_end = file_size(&state.paths.output_text_path);
    let raw_output_end = file_size(&state.paths.raw_output_path);
    let output_text_start = if state.active_command_id.as_deref() == Some(command_id.as_str()) {
        state
            .active_command_output_text_start
            .unwrap_or(output_text_end)
            .min(output_text_end)
    } else {
        command_range_start(latest.as_ref(), "outputTextRange", output_text_end)
    };
    let raw_output_start = if state.active_command_id.as_deref() == Some(command_id.as_str()) {
        state
            .active_command_raw_start
            .unwrap_or(raw_output_end)
            .min(raw_output_end)
    } else {
        command_range_start(latest.as_ref(), "rawOutputRange", raw_output_end)
    };
    let command_text = command_text
        .or_else(|| command_text_for_id(state, &command_id))
        .or_else(|| {
            latest
                .as_ref()
                .and_then(|record| string_field(record, "commandText"))
        });
    let base_correlation = latest
        .as_ref()
        .and_then(|record| record.get("correlation"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let correlation = merge_object(
        merge_object(base_correlation, correlation),
        json!({ "commandId": command_id.clone(), "boundarySource": "shell_integration" }),
    );
    let status = if signal.is_some() {
        "cancelled"
    } else if exit_code.unwrap_or(0) == 0 {
        "completed"
    } else {
        "failed"
    };
    let artifact_paths = command_artifact_paths(state, &command_id);
    let artifact_metadata = command_artifact_metadata(&artifact_paths);
    let completed_at = now_iso();
    append_command_record(
        state,
        merge_object(
            json!({
                "commandId": command_id.clone(),
                "terminalSessionId": session_id,
                "commandText": command_text.clone(),
                "normalizedCommandText": command_text.as_deref().map(str::trim),
                "status": status,
                "exitCode": exit_code,
                "signal": signal.clone(),
                "outputTextRange": { "start": output_text_start, "end": output_text_end },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_end },
                "completedAt": completed_at.clone(),
                "correlation": correlation.clone(),
                "confidence": 1.0
            }),
            artifact_metadata.clone(),
        ),
    )?;
    append_command_lifecycle_event(
        session_id,
        state,
        "command_completed",
        &command_id,
        command_text.as_deref(),
        actor.clone(),
        correlation.clone(),
        merge_object(
            json!({
                "status": status,
                "exitCode": exit_code,
                "outputTextRange": { "start": output_text_start, "end": output_text_end },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_end },
                "boundarySource": "shell_integration"
            }),
            artifact_metadata.clone(),
        ),
    )?;
    let completion = write_command_artifacts(
        session_id,
        state,
        &command_id,
        command_text.as_deref(),
        status,
        exit_code,
        signal.as_deref(),
        &actor,
        &correlation,
        output_text_start,
        output_text_end,
        raw_output_start,
        raw_output_end,
        &completed_at,
    )?;
    if state.active_command_id.as_deref() == Some(command_id.as_str()) {
        state.active_command_id = None;
        state.active_command_output_text_start = None;
        state.active_command_raw_start = None;
    }
    Ok(Some(completion))
}

pub fn active_command_text(storage_root: &str, session_id: &str) -> MemoryResult<Option<String>> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let Some(command_id) = guard.active_command_id.as_deref() else {
        return Ok(None);
    };
    Ok(command_text_for_id(&guard, command_id).or_else(|| Some(command_id.to_string())))
}
