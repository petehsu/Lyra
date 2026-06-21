use super::*;
use rusqlite::{Connection, params};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::Path,
};

const PROMPT_CACHE_SCHEMA_VERSION: i64 = 1;

pub(crate) fn prompt_cache_path(root: &Path) -> PathBuf {
    root.join("prompt_cache.sqlite")
}

pub(crate) fn ensure_prompt_cache(root: &Path) -> AgentRuntimeResult<()> {
    let conn = open_prompt_cache_connection(root)?;
    init_prompt_cache_schema(&conn)
}

pub(crate) fn rebuild_prompt_cache_from_injection_events(root: &Path) -> AgentRuntimeResult<Value> {
    super::memory_store::ensure_memory_store(root)?;
    let memory_conn = super::memory_store::open_memory_connection(root)?;
    super::memory_store::init_memory_schema(&memory_conn)?;
    let mut statement = memory_conn
        .prepare(
            "SELECT session_id, turn_id, query, selected_json, created_at
             FROM memory_injection_events
             ORDER BY created_at ASC",
        )
        .map_err(prompt_cache_sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(prompt_cache_sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(prompt_cache_sql_error)?;

    let cache_conn = open_prompt_cache_connection(root)?;
    init_prompt_cache_schema(&cache_conn)?;
    cache_conn
        .execute("DELETE FROM prompt_cache_entries", [])
        .map_err(prompt_cache_sql_error)?;

    let mut rebuilt = 0_usize;
    for (session_id, turn_id, query, selected_json, created_at) in rows {
        let selected: Vec<Value> = serde_json::from_str(&selected_json).unwrap_or_default();
        if selected.is_empty() {
            continue;
        }
        let prompt_text = format!(
            "Lyra shared memory slice L0/L1/L2\n{}",
            selected
                .iter()
                .enumerate()
                .map(|(index, item)| format!("{}. {}", index + 1, item))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let cache_key = stable_prompt_cache_key(
            &session_id,
            turn_id.as_deref(),
            query.as_deref(),
            &prompt_text,
        );
        let content_hash = prompt_cache_hash(&prompt_text);
        let token_estimate = super::token_estimate::estimate_tokens(&prompt_text) as i64;
        cache_conn
            .execute(
                "INSERT INTO prompt_cache_entries (
                    id, session_id, turn_id, cache_key, prompt_text, source_kind,
                    token_estimate, content_hash, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'memory_injection_event', ?6, ?7, ?8, ?8)",
                params![
                    format!("prompt-cache-{}", Uuid::new_v4()),
                    session_id,
                    turn_id,
                    cache_key,
                    prompt_text,
                    token_estimate,
                    content_hash,
                    created_at,
                ],
            )
            .map_err(prompt_cache_sql_error)?;
        rebuilt += 1;
    }
    Ok(json!({
        "rebuiltFromEvents": rebuilt,
        "source": "memory_injection_events",
    }))
}

pub(crate) fn cache_memory_injection_prompt(
    root: &Path,
    session_id: &str,
    turn_id: Option<&str>,
    query: Option<&str>,
    records: &[RankedMemoryRecord],
) -> AgentRuntimeResult<()> {
    if records.is_empty() {
        return Ok(());
    }
    let conn = open_prompt_cache_connection(root)?;
    init_prompt_cache_schema(&conn)?;
    let prompt_text = shared_memory_prompt(records);
    let cache_key = stable_prompt_cache_key(session_id, turn_id, query, &prompt_text);
    let content_hash = prompt_cache_hash(&prompt_text);
    let token_estimate = super::token_estimate::estimate_tokens(&prompt_text) as i64;
    let timestamp = now();
    conn.execute(
        "INSERT INTO prompt_cache_entries (
            id, session_id, turn_id, cache_key, prompt_text, source_kind,
            token_estimate, content_hash, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'memory_injection', ?6, ?7, ?8, ?8)
         ON CONFLICT(cache_key) DO UPDATE SET
           prompt_text = excluded.prompt_text,
           token_estimate = excluded.token_estimate,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at",
        params![
            format!("prompt-cache-{}", Uuid::new_v4()),
            session_id,
            turn_id,
            cache_key,
            prompt_text,
            token_estimate,
            content_hash,
            timestamp,
        ],
    )
    .map_err(prompt_cache_sql_error)?;
    Ok(())
}

pub(crate) fn export_dynamic_prompt_cache_markdown(root: &Path) -> AgentRuntimeResult<Value> {
    let exports_dir = root.join("exports");
    fs::create_dir_all(&exports_dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let md_path = exports_dir.join("dynamic_prompt_cache.md");
    let conn = open_prompt_cache_connection(root)?;
    init_prompt_cache_schema(&conn)?;
    let mut statement = conn
        .prepare(
            "SELECT session_id, turn_id, source_kind, token_estimate, content_hash, updated_at, prompt_text
             FROM prompt_cache_entries
             ORDER BY updated_at DESC
             LIMIT 64",
        )
        .map_err(prompt_cache_sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(prompt_cache_sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(prompt_cache_sql_error)?;

    let mut md = String::from("# Lyra Dynamic Prompt Cache\n\n");
    md.push_str(
        "> Derived L1 cache from `memory_injection_events` / injection prompts. Not primary truth.\n\n",
    );
    md.push_str(&format!("Generated: {}\n\n", now()));
    let entry_count = rows.len();
    md.push_str(&format!("Entries: {entry_count}\n\n"));
    for (session_id, turn_id, source_kind, token_estimate, content_hash, updated_at, prompt_text) in
        &rows
    {
        md.push_str(&format!(
            "## {session_id} / {}\n\n",
            turn_id.as_deref().unwrap_or("latest")
        ));
        md.push_str(&format!(
            "- sourceKind: `{source_kind}`\n- tokenEstimate: {token_estimate}\n- contentHash: `{content_hash}`\n- updatedAt: {updated_at}\n\n",
        ));
        md.push_str("```text\n");
        let preview = if prompt_text.chars().count() > 1200 {
            format!("{}…", prompt_text.chars().take(1197).collect::<String>())
        } else {
            prompt_text.clone()
        };
        md.push_str(&preview);
        md.push_str("\n```\n\n");
    }
    fs::write(&md_path, md).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(json!({
        "markdownPath": md_path.display().to_string(),
        "entryCount": entry_count,
        "generatedAt": now(),
    }))
}

fn open_prompt_cache_connection(root: &Path) -> AgentRuntimeResult<Connection> {
    fs::create_dir_all(root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Connection::open(prompt_cache_path(root)).map_err(prompt_cache_sql_error)
}

fn init_prompt_cache_schema(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompt_cache_entries (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_id TEXT,
          cache_key TEXT NOT NULL UNIQUE,
          prompt_text TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          token_estimate INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_prompt_cache_session_turn
          ON prompt_cache_entries(session_id, turn_id);
        "#,
    )
    .map_err(prompt_cache_sql_error)?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![PROMPT_CACHE_SCHEMA_VERSION, now()],
    )
    .map_err(prompt_cache_sql_error)?;
    Ok(())
}

fn stable_prompt_cache_key(
    session_id: &str,
    turn_id: Option<&str>,
    query: Option<&str>,
    prompt_text: &str,
) -> String {
    prompt_cache_hash(&format!(
        "{}:{}:{}:{}",
        session_id,
        turn_id.unwrap_or(""),
        query.unwrap_or(""),
        prompt_cache_hash(prompt_text)
    ))
}

fn prompt_cache_hash(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn prompt_cache_sql_error(error: rusqlite::Error) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!("prompt cache sqlite error: {error}"))
}
