use super::{
    AgentRuntimeError, AgentRuntimeResult, NativeSession, Value, cut_store, iso_ms, now,
    session_db_path, session_store,
};
use rusqlite::{Connection, params};
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TrimJournalState {
    PendingTrim,
    Archived,
    LiveDeleted,
    ManifestCommitted,
}

impl TrimJournalState {
    fn as_str(&self) -> &'static str {
        match self {
            Self::PendingTrim => "pending_trim",
            Self::Archived => "archived",
            Self::LiveDeleted => "live_deleted",
            Self::ManifestCommitted => "manifest_committed",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "pending_trim" => Some(Self::PendingTrim),
            "archived" => Some(Self::Archived),
            "live_deleted" => Some(Self::LiveDeleted),
            "manifest_committed" => Some(Self::ManifestCommitted),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TrimJournalEntry {
    pub journal_id: String,
    pub state: TrimJournalState,
    pub cut_pack_id: Option<String>,
    pub msg_ids: Vec<String>,
    pub ordinal_start: Option<i64>,
    pub ordinal_end: Option<i64>,
    pub token_before: i64,
    pub token_after: Option<i64>,
}

pub(crate) fn open_session_connection(
    root: &Path,
    session_id: &str,
) -> AgentRuntimeResult<Connection> {
    let path = session_db_path(root, session_id);
    if !path.is_file() {
        return Err(AgentRuntimeError::Core(format!(
            "session database not found: {session_id}"
        )));
    }
    let conn = session_store::schema::open_connection(&path)?;
    session_store::schema::init_schema(&conn)?;
    Ok(conn)
}

pub(crate) fn insert_journal(
    conn: &Connection,
    entry: &TrimJournalEntry,
) -> AgentRuntimeResult<()> {
    let iso = now();
    let ms = iso_ms(&iso);
    let msg_ids_json = serde_json::to_string(&entry.msg_ids)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    conn.execute(
        "INSERT INTO trim_journal (
            journal_id, state, cut_pack_id, msg_ids_json,
            ordinal_start, ordinal_end, token_before, token_after,
            created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            entry.journal_id,
            entry.state.as_str(),
            entry.cut_pack_id,
            msg_ids_json,
            entry.ordinal_start,
            entry.ordinal_end,
            entry.token_before,
            entry.token_after,
            ms,
            iso,
            ms,
            iso,
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

pub(crate) fn update_journal_state(
    conn: &Connection,
    journal_id: &str,
    state: TrimJournalState,
    cut_pack_id: Option<&str>,
    token_after: Option<i64>,
) -> AgentRuntimeResult<()> {
    let iso = now();
    let ms = iso_ms(&iso);
    conn.execute(
        "UPDATE trim_journal
         SET state = ?1,
             cut_pack_id = COALESCE(?2, cut_pack_id),
             token_after = COALESCE(?3, token_after),
             updated_at_ms = ?4,
             updated_at_iso = ?5
         WHERE journal_id = ?6",
        params![
            state.as_str(),
            cut_pack_id,
            token_after,
            ms,
            iso,
            journal_id
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

pub(crate) fn list_incomplete_journals(
    conn: &Connection,
) -> AgentRuntimeResult<Vec<TrimJournalEntry>> {
    let mut statement = conn
        .prepare(
            "SELECT journal_id, state, cut_pack_id, msg_ids_json, ordinal_start, ordinal_end,
                    token_before, token_after
             FROM trim_journal
             WHERE state != 'manifest_committed'
             ORDER BY created_at_ms ASC",
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            let state_raw: String = row.get(1)?;
            Ok(TrimJournalEntry {
                journal_id: row.get(0)?,
                state: TrimJournalState::parse(state_raw.as_str())
                    .unwrap_or(TrimJournalState::PendingTrim),
                cut_pack_id: row.get(2)?,
                msg_ids: serde_json::from_str(row.get::<_, String>(3)?.as_str())
                    .unwrap_or_default(),
                ordinal_start: row.get(4)?,
                ordinal_end: row.get(5)?,
                token_before: row.get(6)?,
                token_after: row.get(7)?,
            })
        })
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|error| AgentRuntimeError::Core(error.to_string()))?);
    }
    Ok(entries)
}

pub(crate) fn load_journal_messages(
    session: &NativeSession,
    entry: &TrimJournalEntry,
) -> AgentRuntimeResult<Vec<cut_store::CutMessageEntry>> {
    let messages = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut selected = Vec::new();
    for (ordinal, message) in messages.iter().enumerate() {
        let msg_id = message.get("id").and_then(Value::as_str).unwrap_or("");
        if entry.msg_ids.iter().any(|id| id == msg_id) {
            selected.push(cut_store::CutMessageEntry {
                message: message.clone(),
                ordinal: ordinal as i64,
            });
        }
    }
    if selected.is_empty()
        && let (Some(start), Some(end)) = (entry.ordinal_start, entry.ordinal_end)
    {
        for (ordinal, message) in messages.iter().enumerate() {
            let ord = ordinal as i64;
            if ord >= start && ord <= end {
                selected.push(cut_store::CutMessageEntry {
                    message: message.clone(),
                    ordinal: ord,
                });
            }
        }
    }
    Ok(selected)
}
