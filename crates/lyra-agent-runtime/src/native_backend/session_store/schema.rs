use super::*;
use rusqlite::{Connection, params};

pub(crate) const SESSION_SCHEMA_VERSION: i64 = 2;

pub(crate) fn open_connection(path: &Path) -> AgentRuntimeResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    Connection::open(path).map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

pub(crate) fn init_schema(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at_ms INTEGER NOT NULL,
          applied_at_iso TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_meta (
          session_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          session_kind TEXT NOT NULL,
          working_dir TEXT NOT NULL,
          project_bound INTEGER NOT NULL,
          working_dir_is_home INTEGER NOT NULL,
          turn_status TEXT NOT NULL,
          active_turn_id TEXT,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          updated_at_iso TEXT NOT NULL,
          saved INTEGER NOT NULL DEFAULT 0,
          save_label TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          custom_title TEXT,
          short_name TEXT
        );

        CREATE TABLE IF NOT EXISTS session_dialog (
          msg_id TEXT PRIMARY KEY,
          ordinal INTEGER NOT NULL,
          turn_index INTEGER,
          role TEXT NOT NULL,
          content_raw TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          char_count INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          updated_at_iso TEXT NOT NULL,
          metadata_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_session_dialog_ordinal
          ON session_dialog(ordinal);

        CREATE TABLE IF NOT EXISTS session_bundle (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          snapshot_json TEXT NOT NULL,
          runtime_turns_json TEXT NOT NULL,
          rollback_checkpoints_json TEXT NOT NULL,
          file_read_state_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trim_journal (
          journal_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          cut_pack_id TEXT,
          msg_ids_json TEXT NOT NULL,
          ordinal_start INTEGER,
          ordinal_end INTEGER,
          token_before INTEGER NOT NULL,
          token_after INTEGER,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          updated_at_iso TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let iso = now();
    let ms = iso_ms(&iso);
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at_ms, applied_at_iso) VALUES (?1, ?2, ?3)",
        params![SESSION_SCHEMA_VERSION, ms, iso],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}
