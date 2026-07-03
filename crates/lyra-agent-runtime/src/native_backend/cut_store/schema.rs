use super::{AgentRuntimeError, AgentRuntimeResult, iso_ms, now};
use crate::native_backend::open_sqlite_connection;
use rusqlite::Connection;
use std::{fs, path::Path};

pub(super) const CUT_PACK_SCHEMA_VERSION: i64 = 1;

pub(crate) fn open_cut_pack(path: &Path) -> AgentRuntimeResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    let conn = open_sqlite_connection(path)?;
    init_cut_pack_schema(&conn)?;
    Ok(conn)
}

pub(super) fn init_cut_pack_schema(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at_ms INTEGER NOT NULL,
          applied_at_iso TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cut_meta (
          pack_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          ordinal_start INTEGER NOT NULL,
          ordinal_end INTEGER NOT NULL,
          token_total INTEGER NOT NULL,
          msg_count INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cut_payload (
          msg_id TEXT PRIMARY KEY,
          ordinal INTEGER NOT NULL,
          turn_index INTEGER,
          role TEXT NOT NULL,
          content_raw TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cut_refs (
          msg_id TEXT NOT NULL,
          ref_kind TEXT NOT NULL,
          ref_value TEXT NOT NULL,
          PRIMARY KEY (msg_id, ref_kind, ref_value)
        );

        CREATE TABLE IF NOT EXISTS cut_normalized (
          msg_id TEXT PRIMARY KEY,
          content_kind TEXT NOT NULL,
          normalized_text TEXT NOT NULL,
          content_hash TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cut_normalized_hash
          ON cut_normalized(content_hash);
        "#,
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let iso = now();
    let ms = iso_ms(&iso);
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at_ms, applied_at_iso) VALUES (?1, ?2, ?3)",
        rusqlite::params![CUT_PACK_SCHEMA_VERSION, ms, iso],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}
