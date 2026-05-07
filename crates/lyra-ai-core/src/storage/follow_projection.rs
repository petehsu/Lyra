use super::follow_live_edit::read_active_live_draft_summary_from_conn;
use super::*;

struct FollowSessionRow {
    id: String,
    session_id: String,
    runtime_turn_id: Option<String>,
    long_work_run_id: Option<String>,
    status: String,
    active_target_id: Option<String>,
    updated_at: i64,
}

pub(super) fn read_latest_follow_summary_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<AgentFollowSummary>> {
    let Some(row) = read_latest_follow_session_row(conn, session_id)? else {
        return Ok(None);
    };
    read_follow_summary_for_row(conn, row)
}

pub(super) fn read_follow_summary_for_id_from_conn(
    conn: &Connection,
    session_id: &str,
    follow_session_id: &str,
) -> Result<Option<AgentFollowSummary>> {
    let row = conn
        .query_row(
            "SELECT follow_session_id, session_id, runtime_turn_id, long_work_run_id,
                    status, active_target_id, updated_at_ms
             FROM follow_session
             WHERE session_id = ?1 AND follow_session_id = ?2",
            params![session_id, follow_session_id],
            read_follow_session_row,
        )
        .optional()
        .context("failed to read follow summary row")?;
    let Some(row) = row else {
        return Ok(None);
    };
    read_follow_summary_for_row(conn, row)
}

fn read_latest_follow_session_row(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<FollowSessionRow>> {
    conn.query_row(
        "SELECT follow_session_id, session_id, runtime_turn_id, long_work_run_id,
                status, active_target_id, updated_at_ms
         FROM follow_session
         WHERE session_id = ?1
           AND status != 'superseded_by_rollback'
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        read_follow_session_row,
    )
    .optional()
    .context("failed to read latest follow summary row")
}

fn read_follow_session_row(row: &Row<'_>) -> rusqlite::Result<FollowSessionRow> {
    Ok(FollowSessionRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        long_work_run_id: row.get(3)?,
        status: row.get(4)?,
        active_target_id: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn read_follow_summary_for_row(
    conn: &Connection,
    row: FollowSessionRow,
) -> Result<Option<AgentFollowSummary>> {
    let targets = read_follow_targets(conn, &row.id, row.active_target_id.as_deref())?;
    let active_target = row.active_target_id.as_deref().and_then(|active_id| {
        targets
            .iter()
            .find(|target| target.follow_target_id == active_id)
            .cloned()
    });
    let recent_events = read_follow_events(conn, &row.id)?;
    let active_live_draft = read_active_live_draft_summary_from_conn(conn, &row.id)?;
    Ok(Some(AgentFollowSummary {
        follow_session_id: row.id,
        session_id: row.session_id,
        runtime_turn_id: row.runtime_turn_id,
        long_work_run_id: row.long_work_run_id,
        status: row.status,
        active_target_id: row.active_target_id,
        active_target,
        targets,
        recent_events,
        active_live_draft,
        updated_at: row.updated_at,
    }))
}

fn read_follow_targets(
    conn: &Connection,
    follow_session_id: &str,
    active_target_id: Option<&str>,
) -> Result<Vec<AgentFollowTargetSummary>> {
    let mut stmt = conn.prepare(
        "SELECT follow_target_id, kind, title, resource_ref, workspace_uri, status,
                tool_operation_id, artifact_refs_json, evidence_refs_json, updated_at_ms
         FROM follow_target
         WHERE follow_session_id = ?1
         ORDER BY CASE WHEN follow_target_id = ?2 THEN 0 ELSE 1 END,
                  updated_at_ms DESC, created_at_ms DESC
         LIMIT 4",
    )?;
    let rows = stmt.query_map(params![follow_session_id, active_target_id], |row| {
        let artifact_refs_json: String = row.get(7)?;
        let evidence_refs_json: String = row.get(8)?;
        Ok(AgentFollowTargetSummary {
            follow_target_id: row.get(0)?,
            kind: row.get(1)?,
            title: row.get(2)?,
            resource_ref: row.get(3)?,
            workspace_uri: row.get(4)?,
            status: row.get(5)?,
            tool_operation_id: row.get(6)?,
            artifact_refs: parse_json_vec_string(&artifact_refs_json),
            evidence_refs: parse_json_vec_string(&evidence_refs_json),
            updated_at: row.get(9)?,
        })
    })?;
    let mut targets = Vec::new();
    for row in rows {
        targets.push(row?);
    }
    Ok(targets)
}

fn read_follow_events(
    conn: &Connection,
    follow_session_id: &str,
) -> Result<Vec<AgentFollowEventSummary>> {
    let mut stmt = conn.prepare(
        "SELECT follow_event_id, follow_target_id, event_type, payload_json, created_at_ms
         FROM follow_event
         WHERE follow_session_id = ?1
         ORDER BY sequence DESC
         LIMIT 6",
    )?;
    let rows = stmt.query_map(params![follow_session_id], |row| {
        let payload_json: String = row.get(3)?;
        let payload = serde_json::from_str::<Value>(&payload_json).unwrap_or_else(|_| json!({}));
        let event_type: String = row.get(2)?;
        Ok(AgentFollowEventSummary {
            follow_event_id: row.get(0)?,
            follow_target_id: row.get(1)?,
            label: payload
                .get("label")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(|| event_type.replace('_', " ")),
            status: payload
                .get("status")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            event_type,
            created_at: row.get(4)?,
        })
    })?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row?);
    }
    Ok(events)
}
