use super::*;
use rusqlite::{Connection, params};

#[derive(Clone, Debug)]
pub(crate) struct EmbeddingQualitySnapshot {
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) dimension: usize,
    pub(crate) remote_available: bool,
    pub(crate) fallback_count: u64,
    pub(crate) remote_success_count: u64,
}

pub(crate) fn record_embedding_quality_event(
    conn: &Connection,
    provider: &str,
    model: &str,
    used_fallback: bool,
) -> AgentRuntimeResult<()> {
    init_embedding_quality_schema(conn)?;
    conn.execute(
        "INSERT INTO embedding_quality_events (id, provider, model, used_fallback, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            format!("embed-quality-{}", Uuid::new_v4()),
            provider,
            model,
            i64::from(used_fallback),
            now(),
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(format!("embedding quality sqlite error: {error}")))?;
    Ok(())
}

pub(crate) fn embedding_quality_snapshot(
    conn: &Connection,
) -> AgentRuntimeResult<EmbeddingQualitySnapshot> {
    init_embedding_quality_schema(conn)?;
    let (fallback_count, remote_success_count): (u64, u64) = conn
        .query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN used_fallback = 1 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN used_fallback = 0 THEN 1 ELSE 0 END), 0)
             FROM embedding_quality_events",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, 0));
    let active = super::memory_store::active_embedding_descriptor();
    Ok(EmbeddingQualitySnapshot {
        provider: active.provider,
        model: active.model,
        dimension: active.dimension,
        remote_available: active.remote_available,
        fallback_count,
        remote_success_count,
    })
}

pub(crate) fn embedding_quality_json(conn: &Connection) -> AgentRuntimeResult<Value> {
    let snapshot = embedding_quality_snapshot(conn)?;
    Ok(json!({
        "provider": snapshot.provider,
        "model": snapshot.model,
        "dimension": snapshot.dimension,
        "remoteAvailable": snapshot.remote_available,
        "fallbackCount": snapshot.fallback_count,
        "remoteSuccessCount": snapshot.remote_success_count,
        "fallbackRate": if snapshot.fallback_count + snapshot.remote_success_count == 0 {
            0.0
        } else {
            snapshot.fallback_count as f64
                / (snapshot.fallback_count + snapshot.remote_success_count) as f64
        },
    }))
}

fn init_embedding_quality_schema(conn: &Connection) -> AgentRuntimeResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS embedding_quality_events (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          used_fallback INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_embedding_quality_created
          ON embedding_quality_events(created_at);
        "#,
    )
    .map_err(|error| AgentRuntimeError::Core(format!("embedding quality sqlite error: {error}")))?;
    Ok(())
}
