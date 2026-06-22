use super::{schema::*, *};
use rusqlite::params;

pub(super) fn load_session(
    root: &Path,
    session_id: &str,
) -> AgentRuntimeResult<Option<NativeSession>> {
    let db_path = session_db_path(root, session_id);
    if !db_path.is_file() {
        return Ok(None);
    }
    let conn = open_connection(&db_path)?;
    init_schema(&conn)?;

    let meta = conn
        .query_row(
            "SELECT title, session_kind, working_dir, project_bound, working_dir_is_home,
                    turn_status, active_turn_id, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso, saved, save_label, archived,
                    custom_title, short_name
             FROM session_meta WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(SessionMetaRow {
                    title: row.get(0)?,
                    session_kind: row.get(1)?,
                    working_dir: row.get(2)?,
                    project_bound: row.get::<_, i64>(3)? != 0,
                    working_dir_is_home: row.get::<_, i64>(4)? != 0,
                    turn_status: row.get(5)?,
                    active_turn_id: row.get(6)?,
                    created_at_ms: row.get(7)?,
                    created_at_iso: row.get(8)?,
                    updated_at_ms: row.get(9)?,
                    updated_at_iso: row.get(10)?,
                    saved: row.get::<_, i64>(11)? != 0,
                    save_label: row.get(12)?,
                    archived: row.get::<_, i64>(13)? != 0,
                    custom_title: row.get(14)?,
                    short_name: row.get(15)?,
                })
            },
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let mut messages = Vec::new();
    let mut statement = conn
        .prepare("SELECT content_raw FROM session_dialog ORDER BY ordinal ASC")
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    for row in rows {
        let raw = row.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let message = serde_json::from_str(&raw)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        messages.push(message);
    }

    let (snapshot_json, runtime_turns_json, rollback_json, file_read_json) = conn
        .query_row(
            "SELECT snapshot_json, runtime_turns_json, rollback_checkpoints_json, file_read_state_json
             FROM session_bundle WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let mut snapshot: Value = serde_json::from_str(&snapshot_json)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    snapshot["id"] = Value::String(session_id.to_string());
    snapshot["title"] = Value::String(meta.title.clone());
    snapshot["sessionKind"] = Value::String(meta.session_kind.clone());
    snapshot["workingDir"] = Value::String(meta.working_dir.clone());
    snapshot["projectBound"] = Value::Bool(meta.project_bound);
    snapshot["workingDirIsHome"] = Value::Bool(meta.working_dir_is_home);
    let turn_status = normalize_persisted_turn_status(&meta.turn_status);
    snapshot["turnStatus"] = Value::String(turn_status.clone());
    snapshot["activeTurnId"] = meta
        .active_turn_id
        .as_ref()
        .filter(|_| turn_status == "running")
        .map(|value| Value::String(value.clone()))
        .unwrap_or(Value::Null);
    snapshot["updatedAt"] = Value::String(meta.updated_at_iso.clone());
    snapshot["messages"] = Value::Array(messages);

    let runtime_turns: Vec<Value> = serde_json::from_str(&runtime_turns_json)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let rollback_checkpoints: Vec<RollbackCheckpoint> = serde_json::from_str(&rollback_json)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let file_read_state: HashMap<String, FileReadStateEntry> =
        serde_json::from_str(&file_read_json)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    Ok(Some(NativeSession {
        id: session_id.to_string(),
        snapshot,
        created_at: meta.created_at_iso,
        saved: meta.saved,
        save_label: meta.save_label,
        archived: meta.archived,
        custom_title: meta.custom_title,
        short_name: meta.short_name,
        runtime_turns,
        rollback_checkpoints,
        file_read_state,
        dirty: false,
    }))
}

pub(super) fn save_session(root: &Path, session: &NativeSession) -> AgentRuntimeResult<()> {
    let session_id = session.id.as_str();
    let db_path = session_db_path(root, session_id);
    let conn = open_connection(&db_path)?;
    init_schema(&conn)?;

    let snapshot = &session.snapshot;
    let title = snapshot
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_SESSION_TITLE)
        .to_string();
    let session_kind = snapshot
        .get("sessionKind")
        .and_then(Value::as_str)
        .unwrap_or("normal")
        .to_string();
    let working_dir = snapshot
        .get("workingDir")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let project_bound = snapshot
        .get("projectBound")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let working_dir_is_home = snapshot
        .get("workingDirIsHome")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let turn_status = normalize_persisted_turn_status(
        snapshot
            .get("turnStatus")
            .and_then(Value::as_str)
            .unwrap_or("idle"),
    );
    let active_turn_id = snapshot
        .get("activeTurnId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .filter(|_| turn_status == "running")
        .map(str::to_string);
    let updated_at_iso = snapshot
        .get("updatedAt")
        .and_then(Value::as_str)
        .unwrap_or(session.created_at.as_str())
        .to_string();
    let created_at_iso = session.created_at.as_str();
    let created_at_ms = iso_ms(created_at_iso);
    let updated_at_ms = iso_ms(&updated_at_iso);

    let mut bundle_snapshot = snapshot.clone();
    bundle_snapshot.as_object_mut().map(|object| {
        object.remove("id");
        object.remove("title");
        object.remove("sessionKind");
        object.remove("workingDir");
        object.remove("projectBound");
        object.remove("workingDirIsHome");
        object.remove("turnStatus");
        object.remove("activeTurnId");
        object.remove("updatedAt");
        object.remove("messages");
    });
    let snapshot_json = serde_json::to_string(&bundle_snapshot)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let runtime_turns_json = serde_json::to_string(&session.runtime_turns)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let rollback_json = serde_json::to_string(&session.rollback_checkpoints)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let file_read_json = serde_json::to_string(&session.file_read_state)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    tx.execute(
        "INSERT INTO session_meta (
            session_id, title, session_kind, working_dir, project_bound, working_dir_is_home,
            turn_status, active_turn_id, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso,
            saved, save_label, archived, custom_title, short_name
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(session_id) DO UPDATE SET
            title = excluded.title,
            session_kind = excluded.session_kind,
            working_dir = excluded.working_dir,
            project_bound = excluded.project_bound,
            working_dir_is_home = excluded.working_dir_is_home,
            turn_status = excluded.turn_status,
            active_turn_id = excluded.active_turn_id,
            updated_at_ms = excluded.updated_at_ms,
            updated_at_iso = excluded.updated_at_iso,
            saved = excluded.saved,
            save_label = excluded.save_label,
            archived = excluded.archived,
            custom_title = excluded.custom_title,
            short_name = excluded.short_name",
        params![
            session_id,
            title,
            session_kind,
            working_dir,
            i64::from(project_bound),
            i64::from(working_dir_is_home),
            turn_status,
            active_turn_id,
            created_at_ms,
            created_at_iso,
            updated_at_ms,
            updated_at_iso,
            i64::from(session.saved),
            session.save_label,
            i64::from(session.archived),
            session.custom_title,
            session.short_name,
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    tx.execute("DELETE FROM session_dialog", [])
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if let Some(messages) = snapshot.get("messages").and_then(Value::as_array) {
        for (ordinal, message) in messages.iter().enumerate() {
            let msg_id = message
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("{session_id}:message-{ordinal}"));
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("runtime")
                .to_string();
            let created_at_iso = message
                .get("createdAt")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| updated_at_iso.clone());
            let created_at_ms = iso_ms(&created_at_iso);
            let char_count = message_char_count(message);
            let token_count = super::super::token_estimate::estimate_message_tokens(message);
            let turn_index = message
                .get("turnIndex")
                .or_else(|| message.pointer("/metadata/turnIndex"))
                .and_then(Value::as_i64);
            let metadata_json = message.get("metadata").map(|value| value.to_string());
            let content_raw = serde_json::to_string(message)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            tx.execute(
                "INSERT INTO session_dialog (
                    msg_id, ordinal, turn_index, role, content_raw,
                    token_count, char_count, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso, metadata_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    msg_id,
                    ordinal as i64,
                    turn_index,
                    role,
                    content_raw,
                    token_count as i64,
                    char_count as i64,
                    created_at_ms,
                    created_at_iso,
                    updated_at_ms,
                    updated_at_iso,
                    metadata_json,
                ],
            )
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        }
    }

    tx.execute(
        "INSERT INTO session_bundle (id, snapshot_json, runtime_turns_json, rollback_checkpoints_json, file_read_state_json)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            snapshot_json = excluded.snapshot_json,
            runtime_turns_json = excluded.runtime_turns_json,
            rollback_checkpoints_json = excluded.rollback_checkpoints_json,
            file_read_state_json = excluded.file_read_state_json",
        params![snapshot_json, runtime_turns_json, rollback_json, file_read_json],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    tx.commit()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

fn normalize_persisted_turn_status(status: &str) -> String {
    match status {
        "running" => "running".to_string(),
        "cancelled" => "cancelled".to_string(),
        _ => "idle".to_string(),
    }
}

fn message_char_count(message: &Value) -> usize {
    message
        .get("text")
        .and_then(Value::as_str)
        .map(|text| text.chars().count())
        .unwrap_or_else(|| {
            serde_json::to_string(message)
                .map(|text| text.chars().count())
                .unwrap_or(0)
        })
}

struct SessionMetaRow {
    title: String,
    session_kind: String,
    working_dir: String,
    project_bound: bool,
    working_dir_is_home: bool,
    turn_status: String,
    active_turn_id: Option<String>,
    created_at_ms: i64,
    created_at_iso: String,
    updated_at_ms: i64,
    updated_at_iso: String,
    saved: bool,
    save_label: Option<String>,
    archived: bool,
    custom_title: Option<String>,
    short_name: Option<String>,
}
