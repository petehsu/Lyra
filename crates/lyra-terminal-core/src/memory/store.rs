use super::*;

pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(super) fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub(super) fn safe_segment(value: &str) -> String {
    let mut output = String::new();
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            output.push(character);
        } else if !output.ends_with('_') {
            output.push('_');
        }
    }
    let trimmed = output.trim_matches('_');
    if trimmed.is_empty() {
        "terminal-session".to_string()
    } else {
        trimmed.chars().take(160).collect()
    }
}

pub(super) fn state_key(storage_root: &str, session_id: &str) -> String {
    format!("{storage_root}\u{0}{session_id}")
}

pub(super) fn paths_for_session(storage_root: &str, session_id: &str) -> SessionPaths {
    let session_root = Path::new(storage_root)
        .join("terminal-memory")
        .join("sessions")
        .join(safe_segment(session_id));
    let outputs = session_root.join("outputs");
    let indexes = session_root.join("indexes");
    SessionPaths {
        session_root_path: session_root.clone(),
        events_path: session_root.join("events.jsonl"),
        summary_path: session_root.join("summary.json"),
        ui_timeline_path: session_root.join("ui-timeline.jsonl"),
        commands_path: session_root.join("commands.jsonl"),
        command_artifacts_root_path: session_root.join("commands"),
        permissions_path: session_root.join("permissions.jsonl"),
        processes_path: session_root.join("processes.jsonl"),
        attachments_path: session_root.join("attachments.jsonl"),
        screen_diffs_path: session_root.join("screen-diffs.jsonl"),
        retention_manifest_path: session_root.join("retention.json"),
        repair_log_path: session_root.join("repairs.jsonl"),
        index_manifest_path: indexes.join("index.v2.manifest.json"),
        index_sessions_path: indexes.join("terminal_sessions.jsonl"),
        index_events_path: indexes.join("terminal_events.jsonl"),
        index_commands_path: indexes.join("terminal_commands.jsonl"),
        index_output_artifacts_path: indexes.join("terminal_output_artifacts.jsonl"),
        index_permissions_path: indexes.join("terminal_permissions.jsonl"),
        index_agent_terminal_links_path: indexes.join("agent_terminal_links.jsonl"),
        output_compaction_path: outputs.join("session-output.compaction.json"),
        output_redactions_path: outputs.join("session-output.redactions.jsonl"),
        output_text_path: outputs.join("session-output.txt"),
        raw_output_path: outputs.join("session-output.raw"),
        output_summary_path: outputs.join("session-output.summary.json"),
        line_index_path: outputs.join("session-output.lines.jsonl"),
        error_index_path: outputs.join("session-output.errors.jsonl"),
    }
}

pub(super) fn ensure_file(path: &Path) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn append_json_line(path: &Path, value: &Value) -> MemoryResult<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

pub(super) fn write_json_pretty(path: &Path, value: &Value) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

pub(super) fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

pub(super) fn read_jsonl(path: &Path) -> Vec<Value> {
    read_jsonl_with_repair_log(path, None)
}

pub(super) fn append_repair_warning(
    repair_log_path: &Path,
    source_path: &Path,
    line_number: usize,
    error: &str,
) {
    let warning = json!({
        "repairWarningId": format!("terminal-repair-{}", Uuid::new_v4()),
        "sourcePath": source_path.to_string_lossy(),
        "lineNumber": line_number,
        "warning": "corrupt_jsonl_line_skipped",
        "error": error,
        "createdAt": now_iso()
    });
    let _ = append_json_line(repair_log_path, &warning);
}

pub(super) fn read_jsonl_with_repair_log(path: &Path, repair_log_path: Option<&Path>) -> Vec<Value> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    BufReader::new(file)
        .lines()
        .enumerate()
        .filter_map(|(index, line_result)| {
            let line = match line_result {
                Ok(line) => line,
                Err(error) => {
                    if let Some(repair_log_path) = repair_log_path {
                        append_repair_warning(repair_log_path, path, index + 1, &error.to_string());
                    }
                    return None;
                }
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) => Some(value),
                    Err(error) => {
                        if let Some(repair_log_path) = repair_log_path {
                            append_repair_warning(
                                repair_log_path,
                                path,
                                index + 1,
                                &error.to_string(),
                            );
                        }
                        None
                    }
                }
            }
        })
        .collect()
}

pub(super) fn read_last_jsonl(path: &Path) -> Option<Value> {
    read_jsonl(path).into_iter().last()
}

pub(super) fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

pub(super) fn number_field(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

pub(super) fn parse_json_object(input: Option<&str>) -> Value {
    input
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

pub(super) fn compact_object(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return json!({});
    };
    let mut compacted = Map::new();
    for (key, item) in object {
        if !item.is_null() {
            compacted.insert(key.clone(), item.clone());
        }
    }
    Value::Object(compacted)
}

pub(super) fn merge_object(left: Value, right: Value) -> Value {
    let mut merged = Map::new();
    if let Some(object) = left.as_object() {
        for (key, item) in object {
            if !item.is_null() {
                merged.insert(key.clone(), item.clone());
            }
        }
    }
    if let Some(object) = right.as_object() {
        for (key, item) in object {
            if !item.is_null() {
                merged.insert(key.clone(), item.clone());
            }
        }
    }
    Value::Object(merged)
}

pub(super) fn default_actor_for_source(source: Option<&str>) -> Value {
    match source {
        Some("agent") | Some("ai") => json!({ "kind": "agent" }),
        Some("system") => json!({ "kind": "terminal_kernel" }),
        _ => json!({ "kind": "human_user" }),
    }
}

pub(super) fn actor_from_request(actor_json: Option<&str>, source: Option<&str>) -> Value {
    let actor = parse_json_object(actor_json);
    if actor.as_object().is_some_and(|object| !object.is_empty()) {
        actor
    } else {
        default_actor_for_source(source)
    }
}

pub(super) fn actor_label(actor: &Value) -> String {
    if let Some(display_name) = string_field(actor, "displayName") {
        return display_name;
    }
    match string_field(actor, "kind").as_deref() {
        Some("human_user") => "Human",
        Some("agent") => "Agent",
        Some("subagent") => "Subagent",
        Some("terminal_kernel") => "Terminal",
        Some("process") => "Process",
        Some("permission") => "Permission",
        _ => "System",
    }
    .to_string()
}

pub(super) fn estimate_tokens(byte_length: u64) -> u64 {
    byte_length.div_ceil(3)
}

pub(super) fn strip_ansi(value: &str) -> String {
    let without_csi = ANSI_CSI_RE.replace_all(value, "");
    ANSI_OSC_RE
        .replace_all(&without_csi, "")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

pub(super) fn preview_text(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() > OUTPUT_PREVIEW_CHARS {
        let prefix: String = normalized.chars().take(OUTPUT_PREVIEW_CHARS).collect();
        format!("{prefix}...")
    } else {
        normalized
    }
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

pub(super) fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

pub(super) fn classify_output_issue(line: &str) -> Option<&'static str> {
    static ERROR_WORD_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"(?i)\b(error|failed|failure|fatal|exception|panic|traceback|segmentation fault)\b",
        )
        .expect("valid error regex")
    });
    static ERROR_CODE_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?i)\b(err_|e_[a-z0-9_]+)\b").expect("valid code regex"));
    let normalized = line.trim();
    if normalized.is_empty() {
        return None;
    }
    if ERROR_WORD_RE.is_match(normalized)
        || ERROR_CODE_RE.is_match(normalized)
        || normalized
            .get(..normalized.len().min(8))
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("npm ERR!"))
        || normalized
            .get(..normalized.len().min(6))
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("error:"))
        || normalized
            .get(..normalized.len().min(6))
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("error "))
    {
        Some("error")
    } else {
        None
    }
}

pub(super) fn write_retention_manifest(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    if file_size(&paths.retention_manifest_path) > 0 {
        return Ok(());
    }
    write_json_pretty(
        &paths.retention_manifest_path,
        &json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "createdAt": now_iso(),
            "policy": {
                "ttlDays": null,
                "compactionState": "uncompacted",
                "privacyFlags": [],
                "redactionPolicy": "none"
            },
            "artifacts": {
                "truth": "jsonl_and_text_artifacts",
                "indexes": "append_only_jsonl",
                "largeOutput": "stored_on_disk"
            }
        }),
    )
}

pub(super) fn write_output_policy_manifests(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    if file_size(&paths.output_compaction_path) == 0 {
        write_json_pretty(
            &paths.output_compaction_path,
            &json!({
                "schemaVersion": 1,
                "terminalSessionId": session_id,
                "state": "uncompacted",
                "coordinateSpace": "original_output_byte_offsets",
                "guarantee": "line indexes and command ranges remain in original byte coordinates after compaction",
                "compactedArtifacts": [],
                "updatedAt": now_iso()
            }),
        )?;
    }
    ensure_file(&paths.output_redactions_path)
}

pub(super) fn write_index_store_manifest(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    write_json_pretty(
        &paths.index_manifest_path,
        &json!({
            "schemaVersion": 2,
            "terminalSessionId": session_id,
            "updatedAt": now_iso(),
            "decision": {
                "truthStore": "jsonl_text_artifacts",
                "indexStore": "kernel_managed_jsonl_indexes",
                "sqliteTruthStore": false,
                "rationale": "append-only JSONL/text artifacts remain the durable truth; v2 indexes are derived and can be rebuilt from v1 files"
            },
            "migration": {
                "from": "v1_jsonl_text_artifacts",
                "lossless": true,
                "rebuildable": true
            },
            "indexes": {
                "terminal_sessions": paths.index_sessions_path.to_string_lossy(),
                "terminal_events": paths.index_events_path.to_string_lossy(),
                "terminal_commands": paths.index_commands_path.to_string_lossy(),
                "terminal_output_artifacts": paths.index_output_artifacts_path.to_string_lossy(),
                "terminal_permissions": paths.index_permissions_path.to_string_lossy(),
                "agent_terminal_links": paths.index_agent_terminal_links_path.to_string_lossy(),
                "command_artifacts_root": paths.command_artifacts_root_path.to_string_lossy()
            }
        }),
    )
}

pub(super) fn rebuild_output_indexes_from_text(paths: &SessionPaths, session_id: &str) -> MemoryResult<()> {
    let output_size = file_size(&paths.output_text_path);
    if output_size == 0 || file_size(&paths.line_index_path) > 0 {
        return Ok(());
    }
    if output_size > 32 * 1024 * 1024 {
        append_repair_warning(
            &paths.repair_log_path,
            &paths.output_text_path,
            0,
            "output index rebuild skipped for large artifact; use terminal.output.readRange",
        );
        return Ok(());
    }
    File::create(&paths.line_index_path).map_err(|error| error.to_string())?;
    File::create(&paths.error_index_path).map_err(|error| error.to_string())?;

    let file = File::open(&paths.output_text_path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut text_offset = 0_u64;
    let mut line_number = 1_u64;
    let mut error_count = 0_u64;
    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        let mut line_text = line.as_str();
        if let Some(stripped) = line_text.strip_suffix('\n') {
            line_text = stripped;
        }
        if let Some(stripped) = line_text.strip_suffix('\r') {
            line_text = stripped;
        }
        let text_preview = preview_text(line_text);
        let line_record = json!({
            "lineNumber": line_number,
            "terminalSessionId": session_id,
            "outputEventSeq": 0,
            "textOffset": text_offset,
            "byteLength": line_text.len(),
            "textPreview": text_preview,
            "sha256": sha256_hex(line_text.as_bytes()),
            "createdAt": now_iso(),
            "recovered": true
        });
        append_json_line(&paths.line_index_path, &line_record)?;
        if let Some(severity) = classify_output_issue(line_text) {
            error_count = error_count.saturating_add(1);
            append_json_line(
                &paths.error_index_path,
                &merge_object(
                    line_record,
                    json!({
                        "errorNumber": error_count,
                        "severity": severity
                    }),
                ),
            )?;
        }
        text_offset = text_offset.saturating_add(bytes_read as u64);
        line_number = line_number.saturating_add(1);
    }
    Ok(())
}

pub(super) fn initialize_state(
    storage_root: &str,
    session_id: &str,
) -> MemoryResult<Arc<Mutex<SessionState>>> {
    let key = state_key(storage_root, session_id);
    if let Some(existing) = MEMORY_STATES
        .lock()
        .map_err(|_| "failed to lock terminal memory states".to_string())?
        .get(&key)
        .cloned()
    {
        return Ok(existing);
    }

    let paths = paths_for_session(storage_root, session_id);
    fs::create_dir_all(&paths.command_artifacts_root_path).map_err(|error| error.to_string())?;
    for path in [
        &paths.events_path,
        &paths.summary_path,
        &paths.ui_timeline_path,
        &paths.commands_path,
        &paths.permissions_path,
        &paths.processes_path,
        &paths.attachments_path,
        &paths.screen_diffs_path,
        &paths.retention_manifest_path,
        &paths.repair_log_path,
        &paths.index_manifest_path,
        &paths.index_sessions_path,
        &paths.index_events_path,
        &paths.index_commands_path,
        &paths.index_output_artifacts_path,
        &paths.index_permissions_path,
        &paths.index_agent_terminal_links_path,
        &paths.output_compaction_path,
        &paths.output_redactions_path,
        &paths.output_text_path,
        &paths.raw_output_path,
        &paths.output_summary_path,
        &paths.line_index_path,
        &paths.error_index_path,
    ] {
        ensure_file(path)?;
    }
    write_retention_manifest(session_id, &paths)?;
    write_output_policy_manifests(session_id, &paths)?;
    if file_size(&paths.index_manifest_path) == 0 || file_size(&paths.index_events_path) == 0 {
        rebuild_index_store_from_paths(session_id, &paths)?;
    }
    rebuild_output_indexes_from_text(&paths, session_id)?;

    let next_seq = read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path))
        .into_iter()
        .last()
        .and_then(|record| number_field(&record, "seq"))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or(1);
    let command_records =
        read_jsonl_with_repair_log(&paths.commands_path, Some(&paths.repair_log_path));
    let next_command_seq = command_records
        .last()
        .and_then(|record| number_field(record, "commandSeq"))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or_else(|| command_records.len() as u64 + 1);
    let next_line_number = read_last_jsonl(&paths.line_index_path)
        .and_then(|record| number_field(&record, "lineNumber"))
        .map(|line| line.saturating_add(1))
        .unwrap_or(1);
    let error_count = read_last_jsonl(&paths.error_index_path)
        .and_then(|record| number_field(&record, "errorNumber"))
        .unwrap_or(0);
    let last_timeline_item = read_last_jsonl(&paths.ui_timeline_path);
    let timeline_item_count = last_timeline_item
        .as_ref()
        .and_then(|record| number_field(record, "itemIndex"))
        .unwrap_or(0);
    let latest_timeline_preview = last_timeline_item
        .as_ref()
        .and_then(|record| string_field(record, "preview"));
    let latest_output_preview = fs::read_to_string(&paths.summary_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|summary| {
            summary
                .get("memory")
                .and_then(|memory| string_field(memory, "latestOutputPreview"))
        })
        .or_else(|| {
            read_last_jsonl(&paths.line_index_path)
                .and_then(|line| string_field(&line, "textPreview"))
        });
    let mut active_command_id = None;
    let mut active_command_output_text_start = None;
    let mut active_command_raw_start = None;
    for command in &command_records {
        let command_id = string_field(command, "commandId");
        match string_field(command, "status").as_deref() {
            Some("running") => {
                active_command_id = command_id;
                active_command_output_text_start = command
                    .get("outputTextRange")
                    .and_then(|range| number_field(range, "start"));
                active_command_raw_start = command
                    .get("rawOutputRange")
                    .and_then(|range| number_field(range, "start"));
            }
            Some("completed") | Some("failed") => {
                if command_id.is_some() && command_id == active_command_id {
                    active_command_id = None;
                    active_command_output_text_start = None;
                    active_command_raw_start = None;
                }
            }
            _ => {}
        }
    }
    let active_process_id =
        read_jsonl_with_repair_log(&paths.processes_path, Some(&paths.repair_log_path))
            .into_iter()
            .filter(|record| string_field(record, "status").as_deref() == Some("running"))
            .filter_map(|record| number_field(&record, "processId"))
            .last()
            .and_then(|process_id| u32::try_from(process_id).ok());
    let pending_line_text_offset = file_size(&paths.output_text_path);

    let state = Arc::new(Mutex::new(SessionState {
        next_seq,
        next_command_seq,
        next_line_number,
        error_count,
        timeline_item_count,
        paths,
        active_command_id,
        active_command_output_text_start,
        active_command_raw_start,
        active_process_id,
        pending_line_text: String::new(),
        pending_line_text_offset,
        latest_event_kind: None,
        latest_output_preview,
        latest_timeline_preview,
    }));

    MEMORY_STATES
        .lock()
        .map_err(|_| "failed to lock terminal memory states".to_string())?
        .insert(key, Arc::clone(&state));
    Ok(state)
}

pub(super) fn output_projection_recommendation(output_size: u64) -> &'static str {
    let estimated_tokens = estimate_tokens(output_size);
    if estimated_tokens <= INLINE_TOKEN_LIMIT {
        "inline"
    } else if output_size <= 32 * 1024 * 1024 {
        "cache"
    } else {
        "summary"
    }
}

pub(super) fn artifact_record(label: &str, path: &Path, kind: &str, media_type: &str, role: &str) -> Value {
    json!({
        "artifactId": format!("terminal-artifact-{}", safe_segment(label)),
        "label": label,
        "path": path.to_string_lossy(),
        "kind": kind,
        "mediaType": media_type,
        "role": role,
        "byteLength": file_size(path),
        "exists": path.exists()
    })
}

pub(super) fn artifact_records(state: &SessionState) -> Vec<Value> {
    vec![
        artifact_record(
            "summary.json",
            &state.paths.summary_path,
            "summary",
            "application/json",
            "session_summary",
        ),
        artifact_record(
            "session-output.summary.json",
            &state.paths.output_summary_path,
            "summary",
            "application/json",
            "output_summary",
        ),
        artifact_record(
            "session-output.txt",
            &state.paths.output_text_path,
            "output",
            "text/plain; charset=utf-8",
            "stripped_output",
        ),
        artifact_record(
            "session-output.raw",
            &state.paths.raw_output_path,
            "output",
            "application/octet-stream",
            "raw_output",
        ),
        artifact_record(
            "session-output.lines.jsonl",
            &state.paths.line_index_path,
            "index",
            "application/x-ndjson",
            "line_index",
        ),
        artifact_record(
            "session-output.errors.jsonl",
            &state.paths.error_index_path,
            "index",
            "application/x-ndjson",
            "error_index",
        ),
        artifact_record(
            "events.jsonl",
            &state.paths.events_path,
            "journal",
            "application/x-ndjson",
            "event_journal",
        ),
        artifact_record(
            "ui-timeline.jsonl",
            &state.paths.ui_timeline_path,
            "projection",
            "application/x-ndjson",
            "timeline_projection",
        ),
        artifact_record(
            "commands.jsonl",
            &state.paths.commands_path,
            "journal",
            "application/x-ndjson",
            "command_journal",
        ),
        artifact_record(
            "commands/",
            &state.paths.command_artifacts_root_path,
            "directory",
            "inode/directory",
            "command_artifacts_root",
        ),
        artifact_record(
            "permissions.jsonl",
            &state.paths.permissions_path,
            "journal",
            "application/x-ndjson",
            "permission_journal",
        ),
        artifact_record(
            "processes.jsonl",
            &state.paths.processes_path,
            "journal",
            "application/x-ndjson",
            "process_journal",
        ),
        artifact_record(
            "attachments.jsonl",
            &state.paths.attachments_path,
            "journal",
            "application/x-ndjson",
            "agent_terminal_links",
        ),
        artifact_record(
            "screen-diffs.jsonl",
            &state.paths.screen_diffs_path,
            "journal",
            "application/x-ndjson",
            "screen_diff_journal",
        ),
        artifact_record(
            "retention.json",
            &state.paths.retention_manifest_path,
            "manifest",
            "application/json",
            "retention_policy",
        ),
        artifact_record(
            "session-output.compaction.json",
            &state.paths.output_compaction_path,
            "manifest",
            "application/json",
            "output_compaction_policy",
        ),
        artifact_record(
            "session-output.redactions.jsonl",
            &state.paths.output_redactions_path,
            "journal",
            "application/x-ndjson",
            "output_redaction_policy",
        ),
        artifact_record(
            "indexes/index.v2.manifest.json",
            &state.paths.index_manifest_path,
            "manifest",
            "application/json",
            "index_store_manifest",
        ),
        artifact_record(
            "indexes/terminal_sessions.jsonl",
            &state.paths.index_sessions_path,
            "index",
            "application/x-ndjson",
            "terminal_sessions_index",
        ),
        artifact_record(
            "indexes/terminal_events.jsonl",
            &state.paths.index_events_path,
            "index",
            "application/x-ndjson",
            "terminal_events_index",
        ),
        artifact_record(
            "indexes/terminal_commands.jsonl",
            &state.paths.index_commands_path,
            "index",
            "application/x-ndjson",
            "terminal_commands_index",
        ),
        artifact_record(
            "indexes/terminal_output_artifacts.jsonl",
            &state.paths.index_output_artifacts_path,
            "index",
            "application/x-ndjson",
            "terminal_output_artifacts_index",
        ),
        artifact_record(
            "indexes/terminal_permissions.jsonl",
            &state.paths.index_permissions_path,
            "index",
            "application/x-ndjson",
            "terminal_permissions_index",
        ),
        artifact_record(
            "indexes/agent_terminal_links.jsonl",
            &state.paths.index_agent_terminal_links_path,
            "index",
            "application/x-ndjson",
            "agent_terminal_links_index",
        ),
        artifact_record(
            "repairs.jsonl",
            &state.paths.repair_log_path,
            "journal",
            "application/x-ndjson",
            "repair_warnings",
        ),
    ]
}

pub(super) fn truncate_jsonl(path: &Path) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    File::create(path)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn event_index_record(event: &Value) -> Value {
    let payload = event.get("payload").cloned().unwrap_or_else(|| json!({}));
    let correlation = event
        .get("correlation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "terminalSessionId": string_field(event, "terminalSessionId"),
        "seq": number_field(event, "seq"),
        "kind": string_field(event, "kind"),
        "eventId": string_field(event, "eventId"),
        "actorKind": event.get("actor").and_then(|actor| string_field(actor, "kind")),
        "commandId": string_field(&correlation, "commandId").or_else(|| string_field(&payload, "commandId")),
        "permissionId": string_field(&correlation, "permissionId").or_else(|| string_field(&payload, "permissionId")),
        "inputId": string_field(&correlation, "inputId").or_else(|| string_field(&payload, "inputId")),
        "agentSessionId": string_field(&correlation, "agentSessionId"),
        "runtimeTurnId": string_field(&correlation, "runtimeTurnId"),
        "toolCallId": string_field(&correlation, "toolCallId"),
        "createdAt": string_field(event, "createdAt"),
        "createdAtMs": event.get("createdAtMs").and_then(Value::as_i64)
    })
}

pub(super) fn append_event_index(paths: &SessionPaths, event: &Value) -> MemoryResult<()> {
    append_json_line(&paths.index_events_path, &event_index_record(event))
}

pub(super) fn command_index_record(command: &Value) -> Value {
    let correlation = command
        .get("correlation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "terminalSessionId": string_field(command, "terminalSessionId"),
        "commandSeq": number_field(command, "commandSeq"),
        "commandId": string_field(command, "commandId"),
        "status": string_field(command, "status"),
        "exitCode": command.get("exitCode").cloned().unwrap_or(Value::Null),
        "signal": command.get("signal").cloned().unwrap_or(Value::Null),
        "actorKind": command.get("actor").and_then(|actor| string_field(actor, "kind")),
        "agentSessionId": string_field(&correlation, "agentSessionId"),
        "runtimeTurnId": string_field(&correlation, "runtimeTurnId"),
        "toolCallId": string_field(&correlation, "toolCallId"),
        "permissionId": string_field(&correlation, "permissionId"),
        "outputTextRange": command.get("outputTextRange").cloned().unwrap_or(Value::Null),
        "rawOutputRange": command.get("rawOutputRange").cloned().unwrap_or(Value::Null),
        "artifactRootPath": string_field(command, "artifactRootPath"),
        "commandMetaPath": string_field(command, "commandMetaPath"),
        "commandOutputTextPath": string_field(command, "commandOutputTextPath"),
        "commandRawOutputPath": string_field(command, "commandRawOutputPath"),
        "commandEventsPath": string_field(command, "commandEventsPath"),
        "commandSummaryPath": string_field(command, "commandSummaryPath"),
        "recordedAt": string_field(command, "recordedAt")
    })
}

pub(super) fn append_command_index(paths: &SessionPaths, command: &Value) -> MemoryResult<()> {
    append_json_line(&paths.index_commands_path, &command_index_record(command))
}

pub(super) fn permission_index_record(record: &Value) -> Value {
    let correlation = record
        .get("correlation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "terminalSessionId": string_field(record, "terminalSessionId"),
        "permissionRecordSeq": number_field(record, "permissionRecordSeq"),
        "permissionId": string_field(record, "permissionId"),
        "status": string_field(record, "status"),
        "risk": string_field(record, "risk"),
        "action": string_field(record, "action"),
        "summary": string_field(record, "summary"),
        "commandId": string_field(record, "commandId").or_else(|| string_field(&correlation, "commandId")),
        "inputId": string_field(record, "inputId").or_else(|| string_field(&correlation, "inputId")),
        "agentSessionId": string_field(record, "agentSessionId").or_else(|| string_field(&correlation, "agentSessionId")),
        "runtimeTurnId": string_field(record, "runtimeTurnId").or_else(|| string_field(&correlation, "runtimeTurnId")),
        "toolCallId": string_field(record, "toolCallId").or_else(|| string_field(&correlation, "toolCallId")),
        "decision": string_field(record, "decision"),
        "recordedAt": string_field(record, "recordedAt")
    })
}

pub(super) fn append_permission_index(paths: &SessionPaths, record: &Value) -> MemoryResult<()> {
    append_json_line(
        &paths.index_permissions_path,
        &permission_index_record(record),
    )
}

pub(super) fn agent_link_index_record(record: &Value) -> Value {
    json!({
        "terminalSessionId": string_field(record, "terminalSessionId"),
        "linkId": string_field(record, "linkId"),
        "agentSessionId": string_field(record, "agentSessionId"),
        "status": string_field(record, "status"),
        "recordedAt": string_field(record, "recordedAt")
    })
}

pub(super) fn append_agent_link_index(paths: &SessionPaths, record: &Value) -> MemoryResult<()> {
    append_json_line(
        &paths.index_agent_terminal_links_path,
        &agent_link_index_record(record),
    )
}

pub(super) fn refresh_output_artifact_index(session_id: &str, state: &SessionState) -> MemoryResult<()> {
    truncate_jsonl(&state.paths.index_output_artifacts_path)?;
    for artifact in artifact_records(state) {
        append_json_line(
            &state.paths.index_output_artifacts_path,
            &json!({
                "terminalSessionId": session_id,
                "artifactId": string_field(&artifact, "artifactId"),
                "label": string_field(&artifact, "label"),
                "path": string_field(&artifact, "path"),
                "kind": string_field(&artifact, "kind"),
                "role": string_field(&artifact, "role"),
                "byteLength": number_field(&artifact, "byteLength"),
                "exists": artifact.get("exists").and_then(Value::as_bool),
                "indexedAt": now_iso()
            }),
        )?;
    }
    Ok(())
}

pub(super) fn session_created_record(paths: &SessionPaths, session_id: &str) -> Option<Value> {
    read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path))
        .into_iter()
        .filter(|record| {
            string_field(record, "terminalSessionId").as_deref() == Some(session_id)
                && string_field(record, "kind").as_deref() == Some("session_created")
        })
        .last()
}

pub(super) fn latest_process_status(paths: &SessionPaths) -> Option<Value> {
    read_jsonl_with_repair_log(&paths.processes_path, Some(&paths.repair_log_path))
        .into_iter()
        .last()
}

pub(super) fn restoration_state_json() -> Value {
    json!({
        "metadataRestorable": true,
        "historyReadable": true,
        "screenReplayable": true,
        "ptyRestorable": false,
        "ptyRecreatable": true,
        "liveProcessRestorable": false,
        "liveProcessReconnectable": true,
        "reconnectRequiresLivePtyHost": true,
        "reason": "dead_live_pty_processes_cannot_be_restored; while_the_rust_pty_host_is_alive_the_session_can_be_reconnected; after_host_exit_app_exit_or_os_reboot_the_session_can_only_be_recreated_from_metadata_history_and_screen"
    })
}

pub(super) fn refresh_session_index_from_paths(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    truncate_jsonl(&paths.index_sessions_path)?;
    let created = session_created_record(paths, session_id);
    let payload = created
        .as_ref()
        .and_then(|event| event.get("payload").cloned())
        .unwrap_or_else(|| json!({}));
    let process = latest_process_status(paths);
    append_json_line(
        &paths.index_sessions_path,
        &json!({
            "terminalSessionId": session_id,
            "title": string_field(&payload, "title").unwrap_or_else(|| session_id.to_string()),
            "cwd": string_field(&payload, "cwd"),
            "shell": string_field(&payload, "shell"),
            "mode": string_field(&payload, "mode"),
            "source": string_field(&payload, "source"),
            "persist": payload.get("persist").and_then(Value::as_bool).unwrap_or(false),
            "createdAt": created.as_ref().and_then(|event| string_field(event, "createdAt")),
            "updatedAt": now_iso(),
            "status": process.as_ref().and_then(|item| string_field(item, "status")).unwrap_or_else(|| "metadata_only".to_string()),
            "exitCode": process.as_ref().and_then(|item| item.get("exitCode").cloned()).unwrap_or(Value::Null),
            "sessionRootPath": paths.session_root_path.to_string_lossy(),
            "summaryPath": paths.summary_path.to_string_lossy(),
            "eventLogPath": paths.events_path.to_string_lossy(),
            "restoreState": restoration_state_json()
        }),
    )
}

pub(super) fn rebuild_index_store_from_paths(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    for path in [
        &paths.index_sessions_path,
        &paths.index_events_path,
        &paths.index_commands_path,
        &paths.index_output_artifacts_path,
        &paths.index_permissions_path,
        &paths.index_agent_terminal_links_path,
    ] {
        truncate_jsonl(path)?;
    }

    refresh_session_index_from_paths(session_id, paths)?;
    for event in read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path)) {
        append_event_index(paths, &event)?;
    }
    for command in read_jsonl_with_repair_log(&paths.commands_path, Some(&paths.repair_log_path)) {
        append_json_line(&paths.index_commands_path, &command_index_record(&command))?;
    }
    for permission in
        read_jsonl_with_repair_log(&paths.permissions_path, Some(&paths.repair_log_path))
    {
        append_json_line(
            &paths.index_permissions_path,
            &permission_index_record(&permission),
        )?;
    }
    for link in read_jsonl_with_repair_log(&paths.attachments_path, Some(&paths.repair_log_path)) {
        append_json_line(
            &paths.index_agent_terminal_links_path,
            &agent_link_index_record(&link),
        )?;
    }
    write_index_store_manifest(session_id, paths)
}
