use super::*;
use rusqlite::{Connection, OptionalExtension, params};
use std::{fs, path::Path};

pub(crate) fn export_layer_memory_projections(
    root: &Path,
    incremental: bool,
) -> AgentRuntimeResult<Value> {
    let exports_dir = root.join("exports");
    fs::create_dir_all(&exports_dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let shared_path = exports_dir.join("shared_memory.md");
    let frozen_path = exports_dir.join("frozen_memory.md");

    let conn = open_memory_connection(root)?;
    init_memory_schema(&conn)?;

    let shared = list_long_term_memory(
        root,
        MemoryQuery {
            layer: Some(LAYER_SHARED.to_string()),
            status: Some("active".to_string()),
            limit: 500,
            ..MemoryQuery::default()
        },
    )?;
    let frozen = list_long_term_memory(
        root,
        MemoryQuery {
            layer: Some(LAYER_FROZEN.to_string()),
            status: Some("active".to_string()),
            limit: 500,
            ..MemoryQuery::default()
        },
    )?;

    let (shared_to_export, shared_delta) = filter_incremental_records(&conn, &shared, incremental)?;
    let (frozen_to_export, frozen_delta) = filter_incremental_records(&conn, &frozen, incremental)?;

    let shared_md = render_layer_memory_markdown(
        "Shared Memory",
        &shared_to_export,
        incremental.then_some(shared_delta),
    );
    let frozen_md = render_layer_memory_markdown(
        "Frozen Memory",
        &frozen_to_export,
        incremental.then_some(frozen_delta),
    );

    if incremental {
        append_or_replace_layer_markdown(&shared_path, &shared_md, "Shared Memory")?;
        append_or_replace_layer_markdown(&frozen_path, &frozen_md, "Frozen Memory")?;
    } else {
        fs::write(&shared_path, shared_md)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        fs::write(&frozen_path, frozen_md)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }

    for record in shared.iter().chain(frozen.iter()) {
        upsert_projection_state(&conn, &record.id, record.revision)?;
    }

    Ok(json!({
        "sharedMarkdownPath": shared_path.display().to_string(),
        "frozenMarkdownPath": frozen_path.display().to_string(),
        "sharedCount": shared.len(),
        "frozenCount": frozen.len(),
        "sharedDeltaCount": shared_to_export.len(),
        "frozenDeltaCount": frozen_to_export.len(),
        "incremental": incremental,
        "generatedAt": now(),
    }))
}

fn filter_incremental_records(
    conn: &Connection,
    records: &[LongTermMemoryRecord],
    incremental: bool,
) -> AgentRuntimeResult<(Vec<LongTermMemoryRecord>, usize)> {
    if !incremental {
        return Ok((records.to_vec(), records.len()));
    }
    let mut delta = Vec::new();
    for record in records {
        let exported_revision: Option<i64> = conn
            .query_row(
                "SELECT revision FROM layer_projection_state WHERE memory_id = ?1",
                params![record.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(memory_sql_error)?;
        if exported_revision.map(|value| value as u64) != Some(record.revision) {
            delta.push(record.clone());
        }
    }
    Ok((delta.clone(), delta.len()))
}

fn upsert_projection_state(
    conn: &Connection,
    memory_id: &str,
    revision: u64,
) -> AgentRuntimeResult<()> {
    let timestamp = now();
    conn.execute(
        "INSERT INTO layer_projection_state (memory_id, revision, exported_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(memory_id) DO UPDATE SET
           revision = excluded.revision,
           exported_at = excluded.exported_at",
        params![memory_id, revision as i64, timestamp],
    )
    .map_err(memory_sql_error)?;
    Ok(())
}

fn append_or_replace_layer_markdown(
    path: &Path,
    delta_md: &str,
    title: &str,
) -> AgentRuntimeResult<()> {
    if !path.is_file() {
        fs::write(path, delta_md).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        return Ok(());
    }
    let existing =
        fs::read_to_string(path).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let marker = format!("\n\n<!-- incremental:{title} -->\n");
    let merged = if existing.contains(&marker) {
        let (head, _) = existing
            .split_once(&marker)
            .unwrap_or((existing.as_str(), ""));
        format!("{head}{marker}{delta_md}")
    } else {
        format!("{existing}{marker}{delta_md}")
    };
    fs::write(path, merged).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

fn render_layer_memory_markdown(
    title: &str,
    records: &[LongTermMemoryRecord],
    delta_count: Option<usize>,
) -> String {
    let mut md = format!("# Lyra {title} Projection\n\n");
    md.push_str("> Derived read-only view. Primary truth remains `memory.sqlite`.\n\n");
    md.push_str(&format!("Generated: {}\n\n", now()));
    if let Some(delta_count) = delta_count {
        md.push_str(&format!("Incremental records: {delta_count}\n\n"));
    }
    md.push_str(&format!("Active records in export: {}\n\n", records.len()));
    if records.is_empty() {
        md.push_str("_No active records._\n");
        return md;
    }
    for record in records {
        md.push_str(&format!("## {}\n\n", record.fact));
        md.push_str(&format!(
            "- id: `{}`\n- layer: `{}`\n- valueClass: `{}`\n- scope: `{}`\n- category: `{}`\n- confidence: {:.2}\n- sourceType: `{}`\n- revision: {}\n",
            record.id,
            record.layer,
            record.value_class,
            record.scope,
            record.category,
            record.confidence,
            record.source_type,
            record.revision,
        ));
        if let Some(abstract_text) = record.abstract_text.as_deref() {
            md.push_str(&format!("- abstract: {abstract_text}\n"));
        }
        if let Some(device) = record.source_device.as_deref() {
            md.push_str(&format!("- sourceDevice: `{device}`\n"));
        }
        md.push_str("\n```json\n");
        md.push_str(
            &serde_json::to_string_pretty(&record.content).unwrap_or_else(|_| "{}".to_string()),
        );
        md.push_str("\n```\n\n");
    }
    md
}

fn memory_sql_error(error: rusqlite::Error) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!("memory sqlite error: {error}"))
}
