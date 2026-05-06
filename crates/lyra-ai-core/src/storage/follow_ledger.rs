use super::follow_projection::{
    read_follow_summary_for_id_from_conn, read_latest_follow_summary_from_conn,
};
use super::*;

impl AiStore {
    pub fn ensure_follow_session(
        &self,
        input: EnsureFollowSessionInput,
    ) -> Result<AgentFollowSummary> {
        self.with_session_conn(&input.session_id, |conn| {
            let now = now_ms();
            let now_iso = now_iso();
            let follow_session_id = ensure_follow_session_in_conn(conn, &input, now, &now_iso)?;
            read_follow_summary_for_id_from_conn(conn, &input.session_id, &follow_session_id)?
                .ok_or_else(|| anyhow!("created follow summary could not be read"))
        })
    }

    pub fn read_follow_summary(&self, session_id: &str) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(session_id, |conn| {
            read_latest_follow_summary_from_conn(conn, session_id)
        })
    }

    pub fn pause_follow_session(
        &self,
        session_id: &str,
        follow_session_id: Option<&str>,
    ) -> Result<Option<AgentFollowSummary>> {
        self.update_follow_status(
            session_id,
            follow_session_id,
            "paused_by_user",
            "follow_paused",
        )
    }

    pub fn resume_follow_session(
        &self,
        session_id: &str,
        follow_session_id: Option<&str>,
    ) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(session_id, |conn| {
            let Some(row) = read_target_follow_session(conn, session_id, follow_session_id)? else {
                return Ok(None);
            };
            let status = if row.long_work_run_id.is_some() {
                "auto_following"
            } else {
                "enabled"
            };
            update_follow_status_in_conn(conn, session_id, &row.id, status, "follow_resumed")
        })
    }

    pub fn upsert_follow_target(
        &self,
        input: FollowTargetInput,
    ) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(follow_session_id) = active_follow_session_id(
                conn,
                &input.session_id,
                input.long_work_run_id.as_deref(),
                input.runtime_turn_id.as_deref(),
            )?
            else {
                return Ok(None);
            };
            let now = now_ms();
            let now_iso = now_iso();
            let target_id =
                upsert_follow_target_in_conn(conn, &follow_session_id, &input, now, &now_iso)?;
            focus_target_in_conn(conn, &follow_session_id, &target_id, now, &now_iso)?;
            read_follow_summary_for_id_from_conn(conn, &input.session_id, &follow_session_id)
        })
    }

    pub fn append_follow_event(
        &self,
        input: FollowEventInput,
    ) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(follow_session_id) = active_follow_session_id(
                conn,
                &input.session_id,
                input.long_work_run_id.as_deref(),
                input.runtime_turn_id.as_deref(),
            )?
            else {
                return Ok(None);
            };
            let now = now_ms();
            let now_iso = now_iso();
            append_follow_event_in_conn(conn, &follow_session_id, &input, now, &now_iso)?;
            bump_follow_session(conn, &follow_session_id, now, &now_iso)?;
            read_follow_summary_for_id_from_conn(conn, &input.session_id, &follow_session_id)
        })
    }

    pub fn append_workspace_commit(
        &self,
        input: WorkspaceCommitInput,
    ) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(follow_session_id) = active_follow_session_id(
                conn,
                &input.session_id,
                input.long_work_run_id.as_deref(),
                input.runtime_turn_id.as_deref(),
            )?
            else {
                return Ok(None);
            };
            let now = now_ms();
            let now_iso = now_iso();
            conn.execute(
                "INSERT INTO workspace_commit (
                    workspace_commit_id, follow_session_id, follow_target_id, live_edit_id,
                    path, base_revision_id, final_revision_id, tool_operation_id, method,
                    diff_ref, status, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?12, ?13)",
                params![
                    new_id("workspace_commit"),
                    follow_session_id,
                    input.follow_target_id,
                    input.live_edit_id,
                    input.path,
                    input.base_revision_id,
                    input.final_revision_id,
                    input.tool_operation_id,
                    input.method,
                    input.diff_ref,
                    input.status,
                    now,
                    now_iso,
                ],
            )?;
            bump_follow_session(conn, &follow_session_id, now, &now_iso)?;
            read_follow_summary_for_id_from_conn(conn, &input.session_id, &follow_session_id)
        })
    }

    pub fn mark_workspace_commits_rolled_back(
        &self,
        session_id: &str,
        long_work_run_id: Option<&str>,
        runtime_turn_id: Option<&str>,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(session_id, |conn| {
            let Some(follow_session_id) =
                active_follow_session_id(conn, session_id, long_work_run_id, runtime_turn_id)?
            else {
                return Ok(None);
            };
            let now = now_ms();
            let now_iso = now_iso();
            if let Some(patch_ref) = patch_ref {
                conn.execute(
                    "UPDATE workspace_commit
                     SET status = 'rolled_back', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE follow_session_id = ?3 AND diff_ref = ?4
                       AND status IN ('pending', 'committed')",
                    params![now, now_iso, follow_session_id, patch_ref],
                )?;
            }
            if let Some(artifact_id) = artifact_id {
                let mut stmt = conn.prepare(
                    "SELECT follow_target_id, artifact_refs_json
                     FROM follow_target
                     WHERE follow_session_id = ?1",
                )?;
                let rows = stmt.query_map(params![follow_session_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                let mut target_ids = Vec::new();
                for row in rows {
                    let (target_id, refs_json) = row?;
                    if parse_json_vec_string(&refs_json)
                        .iter()
                        .any(|value| value == artifact_id)
                    {
                        target_ids.push(target_id);
                    }
                }
                for target_id in target_ids {
                    conn.execute(
                        "UPDATE workspace_commit
                         SET status = 'rolled_back', updated_at_ms = ?1, updated_at_iso = ?2
                         WHERE follow_session_id = ?3 AND follow_target_id = ?4
                           AND status IN ('pending', 'committed')",
                        params![now, now_iso, follow_session_id, target_id],
                    )?;
                }
            }
            bump_follow_session(conn, &follow_session_id, now, &now_iso)?;
            read_follow_summary_for_id_from_conn(conn, session_id, &follow_session_id)
        })
    }

    fn update_follow_status(
        &self,
        session_id: &str,
        follow_session_id: Option<&str>,
        status: &str,
        event_type: &str,
    ) -> Result<Option<AgentFollowSummary>> {
        self.with_session_conn(session_id, |conn| {
            let Some(row) = read_target_follow_session(conn, session_id, follow_session_id)? else {
                return Ok(None);
            };
            update_follow_status_in_conn(conn, session_id, &row.id, status, event_type)
        })
    }
}

struct FollowSessionLookupRow {
    id: String,
    long_work_run_id: Option<String>,
}

fn ensure_follow_session_in_conn(
    conn: &Connection,
    input: &EnsureFollowSessionInput,
    now: i64,
    now_iso: &str,
) -> Result<String> {
    let existing = active_follow_session_id(
        conn,
        &input.session_id,
        input.long_work_run_id.as_deref(),
        input.runtime_turn_id.as_deref(),
    )?;
    let Some(follow_session_id) = existing else {
        let follow_session_id = new_id("follow_session");
        conn.execute(
            "INSERT INTO follow_session (
                follow_session_id, session_id, runtime_turn_id, user_message_id, long_work_run_id,
                status, active_target_id, target_ids_json, event_stream_ref, created_at_ms,
                created_at_iso, updated_at_ms, updated_at_iso
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, '[]', ?7, ?8, ?9, ?8, ?9)",
            params![
                follow_session_id,
                input.session_id,
                input.runtime_turn_id,
                input.user_message_id,
                input.long_work_run_id,
                normalize_follow_status(&input.status),
                input.event_stream_ref,
                now,
                now_iso,
            ],
        )?;
        return Ok(follow_session_id);
    };
    let current_status: String = conn.query_row(
        "SELECT status FROM follow_session WHERE follow_session_id = ?1",
        params![follow_session_id],
        |row| row.get(0),
    )?;
    let next_status = if current_status == "paused_by_user" {
        current_status
    } else {
        normalize_follow_status(&input.status).to_string()
    };
    conn.execute(
        "UPDATE follow_session
         SET runtime_turn_id = COALESCE(?1, runtime_turn_id),
             user_message_id = COALESCE(?2, user_message_id),
             long_work_run_id = COALESCE(?3, long_work_run_id),
             status = ?4,
             event_stream_ref = COALESCE(?5, event_stream_ref),
             updated_at_ms = ?6,
             updated_at_iso = ?7
         WHERE follow_session_id = ?8",
        params![
            input.runtime_turn_id,
            input.user_message_id,
            input.long_work_run_id,
            next_status,
            input.event_stream_ref,
            now,
            now_iso,
            follow_session_id,
        ],
    )?;
    Ok(follow_session_id)
}

fn read_target_follow_session(
    conn: &Connection,
    session_id: &str,
    follow_session_id: Option<&str>,
) -> Result<Option<FollowSessionLookupRow>> {
    if let Some(follow_session_id) = follow_session_id {
        return conn
            .query_row(
                "SELECT follow_session_id, long_work_run_id
                 FROM follow_session
                 WHERE session_id = ?1 AND follow_session_id = ?2",
                params![session_id, follow_session_id],
                |row| {
                    Ok(FollowSessionLookupRow {
                        id: row.get(0)?,
                        long_work_run_id: row.get(1)?,
                    })
                },
            )
            .optional()
            .context("failed to read target follow session");
    }
    conn.query_row(
        "SELECT follow_session_id, long_work_run_id
         FROM follow_session
         WHERE session_id = ?1
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| {
            Ok(FollowSessionLookupRow {
                id: row.get(0)?,
                long_work_run_id: row.get(1)?,
            })
        },
    )
    .optional()
    .context("failed to read latest follow session")
}

fn active_follow_session_id(
    conn: &Connection,
    session_id: &str,
    long_work_run_id: Option<&str>,
    runtime_turn_id: Option<&str>,
) -> Result<Option<String>> {
    if let Some(long_work_run_id) = long_work_run_id {
        let existing = conn
            .query_row(
                "SELECT follow_session_id
                 FROM follow_session
                 WHERE session_id = ?1 AND long_work_run_id = ?2
                   AND status NOT IN ('closed', 'superseded_by_rollback')
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id, long_work_run_id],
                |row| row.get(0),
            )
            .optional()
            .context("failed to find follow session by work run")?;
        if existing.is_some() {
            return Ok(existing);
        }
    }
    if let Some(runtime_turn_id) = runtime_turn_id {
        let existing = conn
            .query_row(
                "SELECT follow_session_id
                 FROM follow_session
                 WHERE session_id = ?1 AND runtime_turn_id = ?2
                   AND status NOT IN ('closed', 'superseded_by_rollback')
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id, runtime_turn_id],
                |row| row.get(0),
            )
            .optional()
            .context("failed to find follow session by turn")?;
        if existing.is_some() {
            return Ok(existing);
        }
    }
    conn.query_row(
        "SELECT follow_session_id
         FROM follow_session
         WHERE session_id = ?1
           AND status IN ('enabled', 'auto_following', 'paused_by_user', 'pinned_target', 'detached_view')
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to find active follow session")
}

fn upsert_follow_target_in_conn(
    conn: &Connection,
    follow_session_id: &str,
    input: &FollowTargetInput,
    now: i64,
    now_iso: &str,
) -> Result<String> {
    let existing = if let Some(op_id) = input.tool_operation_id.as_deref() {
        conn.query_row(
            "SELECT follow_target_id FROM follow_target
             WHERE follow_session_id = ?1 AND tool_operation_id = ?2
             ORDER BY updated_at_ms DESC LIMIT 1",
            params![follow_session_id, op_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    } else {
        None
    };
    let target_id = match existing {
        Some(target_id) => {
            let (artifact_refs, evidence_refs) = conn.query_row(
                "SELECT artifact_refs_json, evidence_refs_json FROM follow_target WHERE follow_target_id = ?1",
                params![target_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?;
            let artifact_refs =
                merge_string_refs(&parse_json_vec_string(&artifact_refs), &input.artifact_refs);
            let evidence_refs =
                merge_string_refs(&parse_json_vec_string(&evidence_refs), &input.evidence_refs);
            conn.execute(
                "UPDATE follow_target
                 SET runtime_turn_id = COALESCE(?1, runtime_turn_id),
                     work_slice_id = COALESCE(?2, work_slice_id),
                     kind = ?3,
                     title = ?4,
                     resource_ref = COALESCE(?5, resource_ref),
                     workspace_uri = COALESCE(?6, workspace_uri),
                     status = ?7,
                     artifact_refs_json = ?8,
                     evidence_refs_json = ?9,
                     updated_at_ms = ?10,
                     updated_at_iso = ?11
                 WHERE follow_target_id = ?12",
                params![
                    input.runtime_turn_id,
                    input.work_slice_id,
                    normalize_target_kind(&input.kind),
                    trim_to_string(&input.title).unwrap_or_else(|| "Operation".to_string()),
                    input.resource_ref,
                    input.workspace_uri,
                    normalize_target_status(&input.status),
                    json_string(&artifact_refs)?,
                    json_string(&evidence_refs)?,
                    now,
                    now_iso,
                    target_id,
                ],
            )?;
            target_id
        }
        None => {
            let target_id = new_id("follow_target");
            conn.execute(
                "INSERT INTO follow_target (
                    follow_target_id, follow_session_id, session_id, runtime_turn_id,
                    work_slice_id, kind, title, resource_ref, workspace_uri, status,
                    tool_operation_id, artifact_refs_json, evidence_refs_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?14, ?15)",
                params![
                    target_id,
                    follow_session_id,
                    input.session_id,
                    input.runtime_turn_id,
                    input.work_slice_id,
                    normalize_target_kind(&input.kind),
                    trim_to_string(&input.title).unwrap_or_else(|| "Operation".to_string()),
                    input.resource_ref,
                    input.workspace_uri,
                    normalize_target_status(&input.status),
                    input.tool_operation_id,
                    json_string(&input.artifact_refs)?,
                    json_string(&input.evidence_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            target_id
        }
    };
    append_target_id(conn, follow_session_id, &target_id)?;
    Ok(target_id)
}

fn focus_target_in_conn(
    conn: &Connection,
    follow_session_id: &str,
    target_id: &str,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE follow_session
         SET active_target_id = ?1, updated_at_ms = ?2, updated_at_iso = ?3
         WHERE follow_session_id = ?4",
        params![target_id, now, now_iso, follow_session_id],
    )?;
    Ok(())
}

fn append_follow_event_in_conn(
    conn: &Connection,
    follow_session_id: &str,
    input: &FollowEventInput,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    let sequence = next_follow_sequence(conn, follow_session_id)?;
    conn.execute(
        "INSERT INTO follow_event (
            follow_event_id, follow_session_id, follow_target_id, session_id, runtime_turn_id,
            tool_operation_id, work_slice_id, event_type, payload_ref, payload_json, sequence,
            created_at_ms, created_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            new_id("follow_event"),
            follow_session_id,
            input.follow_target_id,
            input.session_id,
            input.runtime_turn_id,
            input.tool_operation_id,
            input.work_slice_id,
            input.event_type,
            input.payload_ref,
            input.payload.to_string(),
            sequence,
            now,
            now_iso,
        ],
    )?;
    Ok(())
}

fn update_follow_status_in_conn(
    conn: &Connection,
    session_id: &str,
    follow_session_id: &str,
    status: &str,
    event_type: &str,
) -> Result<Option<AgentFollowSummary>> {
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "UPDATE follow_session
         SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
         WHERE follow_session_id = ?4",
        params![
            normalize_follow_status(status),
            now,
            now_iso,
            follow_session_id
        ],
    )?;
    append_follow_event_in_conn(
        conn,
        follow_session_id,
        &FollowEventInput {
            session_id: session_id.to_string(),
            runtime_turn_id: None,
            long_work_run_id: None,
            follow_target_id: None,
            tool_operation_id: None,
            work_slice_id: None,
            event_type: event_type.to_string(),
            payload_ref: None,
            payload: json!({
                "label": if event_type == "follow_paused" { "Following paused" } else { "Following resumed" },
                "status": normalize_follow_status(status)
            }),
        },
        now,
        &now_iso,
    )?;
    read_follow_summary_for_id_from_conn(conn, session_id, follow_session_id)
}

fn append_target_id(conn: &Connection, follow_session_id: &str, target_id: &str) -> Result<()> {
    let target_ids_json: String = conn.query_row(
        "SELECT target_ids_json FROM follow_session WHERE follow_session_id = ?1",
        params![follow_session_id],
        |row| row.get(0),
    )?;
    let mut target_ids = parse_json_vec_string(&target_ids_json);
    if target_ids.iter().any(|value| value == target_id) == false {
        target_ids.push(target_id.to_string());
        conn.execute(
            "UPDATE follow_session SET target_ids_json = ?1 WHERE follow_session_id = ?2",
            params![json_string(&target_ids)?, follow_session_id],
        )?;
    }
    Ok(())
}

fn bump_follow_session(
    conn: &Connection,
    follow_session_id: &str,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE follow_session
         SET updated_at_ms = ?1, updated_at_iso = ?2
         WHERE follow_session_id = ?3",
        params![now, now_iso, follow_session_id],
    )?;
    Ok(())
}

fn next_follow_sequence(conn: &Connection, follow_session_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM follow_event WHERE follow_session_id = ?1",
        params![follow_session_id],
        |row| row.get(0),
    )
    .context("failed to allocate follow event sequence")
}

fn normalize_follow_status(status: &str) -> &'static str {
    match status.trim() {
        "enabled" => "enabled",
        "auto_following" => "auto_following",
        "paused_by_user" => "paused_by_user",
        "pinned_target" => "pinned_target",
        "detached_view" => "detached_view",
        "closed" => "closed",
        "superseded_by_rollback" => "superseded_by_rollback",
        _ => "enabled",
    }
}

fn normalize_target_kind(kind: &str) -> &'static str {
    match kind.trim() {
        "file" => "file",
        "diff" => "diff",
        "terminal" => "terminal",
        "test_report" => "test_report",
        "build_report" => "build_report",
        "lint_report" => "lint_report",
        "artifact" => "artifact",
        "todo" => "todo",
        _ => "operation",
    }
}

fn normalize_target_status(status: &str) -> &'static str {
    match status.trim() {
        "active" => "active",
        "background" => "background",
        "completed" => "completed",
        "failed" => "failed",
        "discarded" => "discarded",
        "superseded_by_rollback" => "superseded_by_rollback",
        _ => "active",
    }
}
