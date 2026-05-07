use super::*;

const INLINE_DELTA_LIMIT: usize = 4096;

impl AiStore {
    pub fn start_follow_live_edit(
        &self,
        input: StartLiveEditInput,
    ) -> Result<Option<AgentFollowSummary>> {
        let path = trim_to_string(&input.path).ok_or_else(|| anyhow!("path is required"))?;
        let follow = self.ensure_follow_session(EnsureFollowSessionInput {
            session_id: input.session_id.clone(),
            runtime_turn_id: None,
            user_message_id: None,
            long_work_run_id: None,
            status: "enabled".to_string(),
            event_stream_ref: Some("agent.runtime".to_string()),
        })?;
        let follow_session_id = input
            .follow_session_id
            .and_then(|value| trim_to_string(&value))
            .unwrap_or(follow.follow_session_id);
        let follow_target_id = match input
            .follow_target_id
            .and_then(|value| trim_to_string(&value))
        {
            Some(target_id) => target_id,
            None => self
                .upsert_follow_target(FollowTargetInput {
                    session_id: input.session_id.clone(),
                    runtime_turn_id: None,
                    long_work_run_id: None,
                    work_slice_id: None,
                    kind: "file".to_string(),
                    title: path.clone(),
                    resource_ref: None,
                    workspace_uri: Some(path.clone()),
                    status: "active".to_string(),
                    tool_operation_id: None,
                    artifact_refs: Vec::new(),
                    evidence_refs: Vec::new(),
                })?
                .and_then(|summary| summary.active_target_id)
                .ok_or_else(|| anyhow!("failed to create live draft follow target"))?,
        };
        let live_edit_id = new_id("live_edit");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(&input.session_id, |conn| {
            conn.execute(
                "INSERT INTO live_edit_stream (
                    live_edit_id, follow_session_id, follow_target_id, path, base_revision_id,
                    status, draft_buffer_ref, commit_operation_id, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'drafting', ?6, NULL, ?7, ?8, ?7, ?8)",
                params![
                    live_edit_id,
                    follow_session_id,
                    follow_target_id,
                    path,
                    input.base_revision_id,
                    input.draft_buffer_ref,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        self.read_follow_summary(&input.session_id)
    }

    pub fn append_follow_live_edit_delta(
        &self,
        input: AppendLiveEditDeltaInput,
    ) -> Result<Option<AgentFollowSummary>> {
        let now = now_ms();
        let now_iso = now_iso();
        let session_id = input.session_id.clone();
        self.with_session_conn(&session_id, |conn| {
            let follow_session_id = read_live_edit_follow_session(conn, &input.live_edit_id)?;
            let delta_id = new_id("live_edit_delta");
            let sequence = next_live_delta_sequence(conn, &input.live_edit_id)?;
            let (text_delta_ref, payload) =
                self.live_delta_payload(&session_id, &input.live_edit_id, &delta_id, &input)?;
            conn.execute(
                "INSERT INTO live_edit_delta (
                    delta_id, live_edit_id, sequence, kind, range_json, text_delta_ref,
                    payload_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    delta_id,
                    input.live_edit_id,
                    sequence,
                    input.kind,
                    input.range.to_string(),
                    text_delta_ref,
                    payload.to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "UPDATE live_edit_stream
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE live_edit_id = ?4",
                params![
                    if input.ready_to_commit {
                        "ready_to_commit"
                    } else {
                        "drafting"
                    },
                    now,
                    now_iso,
                    input.live_edit_id,
                ],
            )?;
            bump_follow_session_for_live_edit(conn, &follow_session_id, now, &now_iso)?;
            Ok(())
        })?;
        self.read_follow_summary(&session_id)
    }

    pub fn commit_follow_live_edit(
        &self,
        input: CommitLiveEditInput,
    ) -> Result<Option<AgentFollowSummary>> {
        let op_id = trim_to_string(&input.tool_operation_id)
            .ok_or_else(|| anyhow!("toolOperationId is required"))?;
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(&input.session_id, |conn| {
            if tool_operation_exists(conn, &op_id)? == false {
                return Err(anyhow!(
                    "toolOperationId does not reference a recorded operation"
                ));
            }
            let (follow_session_id, path) =
                read_live_edit_session_and_path(conn, &input.live_edit_id)?;
            conn.execute(
                "UPDATE live_edit_stream
                 SET status = 'committed', commit_operation_id = ?1,
                     updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE live_edit_id = ?4",
                params![op_id, now, now_iso, input.live_edit_id],
            )?;
            bind_workspace_commit_to_live_edit(
                conn,
                &follow_session_id,
                &input.live_edit_id,
                &path,
                &op_id,
                now,
                &now_iso,
            )?;
            bump_follow_session_for_live_edit(conn, &follow_session_id, now, &now_iso)?;
            Ok(())
        })?;
        self.read_follow_summary(&input.session_id)
    }

    pub fn discard_follow_live_edit(
        &self,
        input: DiscardLiveEditInput,
    ) -> Result<Option<AgentFollowSummary>> {
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(&input.session_id, |conn| {
            let follow_session_id = read_live_edit_follow_session(conn, &input.live_edit_id)?;
            conn.execute(
                "UPDATE live_edit_stream
                 SET status = 'discarded', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE live_edit_id = ?3",
                params![now, now_iso, input.live_edit_id],
            )?;
            append_live_edit_event(
                conn,
                &follow_session_id,
                &input.session_id,
                &input.live_edit_id,
                "live_draft_discarded",
                input
                    .reason
                    .unwrap_or_else(|| "Draft discarded".to_string()),
                "discarded",
                now,
                &now_iso,
            )?;
            bump_follow_session_for_live_edit(conn, &follow_session_id, now, &now_iso)?;
            Ok(())
        })?;
        self.read_follow_summary(&input.session_id)
    }

    pub fn commit_matching_live_edit_for_operation(
        &self,
        session_id: &str,
        tool_operation_id: &str,
        paths: &[String],
    ) -> Result<()> {
        self.with_session_conn(session_id, |conn| {
            if tool_operation_exists(conn, tool_operation_id)? == false {
                return Ok(());
            }
            let now = now_ms();
            let now_iso = now_iso();
            for path in paths {
                let Some((live_edit_id, follow_session_id)) =
                    read_latest_live_edit_for_path(conn, path, &["drafting", "ready_to_commit"])?
                else {
                    continue;
                };
                conn.execute(
                    "UPDATE live_edit_stream
                     SET status = 'committed', commit_operation_id = ?1,
                         updated_at_ms = ?2, updated_at_iso = ?3
                     WHERE live_edit_id = ?4",
                    params![tool_operation_id, now, now_iso, live_edit_id],
                )?;
                bind_workspace_commit_to_live_edit(
                    conn,
                    &follow_session_id,
                    &live_edit_id,
                    path,
                    tool_operation_id,
                    now,
                    &now_iso,
                )?;
                bump_follow_session_for_live_edit(conn, &follow_session_id, now, &now_iso)?;
            }
            Ok(())
        })
    }

    pub fn mark_matching_live_edit_failed(&self, session_id: &str, paths: &[String]) -> Result<()> {
        self.with_session_conn(session_id, |conn| {
            let now = now_ms();
            let now_iso = now_iso();
            for path in paths {
                if let Some((live_edit_id, follow_session_id)) =
                    read_latest_live_edit_for_path(conn, path, &["drafting", "ready_to_commit"])?
                {
                    conn.execute(
                        "UPDATE live_edit_stream
                         SET status = 'failed', updated_at_ms = ?1, updated_at_iso = ?2
                         WHERE live_edit_id = ?3",
                        params![now, now_iso, live_edit_id],
                    )?;
                    bump_follow_session_for_live_edit(conn, &follow_session_id, now, &now_iso)?;
                }
            }
            Ok(())
        })
    }

    fn live_delta_payload(
        &self,
        session_id: &str,
        live_edit_id: &str,
        delta_id: &str,
        input: &AppendLiveEditDeltaInput,
    ) -> Result<(Option<String>, Value)> {
        let Some(text_delta) = input.text_delta.as_deref() else {
            return Ok((input.text_delta_ref.clone(), input.payload.clone()));
        };
        if text_delta.len() <= INLINE_DELTA_LIMIT {
            let mut payload = input.payload.clone();
            if let Some(object) = payload.as_object_mut() {
                object.insert(
                    "textDelta".to_string(),
                    Value::String(text_delta.to_string()),
                );
            }
            return Ok((input.text_delta_ref.clone(), payload));
        }
        let dir = self
            .session_dir(session_id)
            .join("follow-live-drafts")
            .join(live_edit_id);
        fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create live draft dir {}", dir.display()))?;
        let file_name = format!("{delta_id}.txt");
        fs::write(dir.join(&file_name), text_delta)
            .with_context(|| format!("failed to write live draft delta {}", dir.display()))?;
        Ok((
            Some(format!("{live_edit_id}/{file_name}")),
            input.payload.clone(),
        ))
    }
}

pub(super) fn read_active_live_draft_summary_from_conn(
    conn: &Connection,
    follow_session_id: &str,
) -> Result<Option<AgentLiveDraftSummary>> {
    conn.query_row(
        "SELECT live_edit_id, follow_session_id, follow_target_id, path, base_revision_id,
                status, draft_buffer_ref, commit_operation_id, updated_at_ms
         FROM live_edit_stream
         WHERE follow_session_id = ?1
           AND status IN ('drafting', 'ready_to_commit', 'committing', 'committed', 'discarded', 'conflict', 'failed')
         ORDER BY CASE status
            WHEN 'drafting' THEN 0
            WHEN 'ready_to_commit' THEN 1
            WHEN 'committing' THEN 2
            WHEN 'failed' THEN 3
            WHEN 'conflict' THEN 4
            WHEN 'committed' THEN 5
            ELSE 6
         END, updated_at_ms DESC
         LIMIT 1",
        params![follow_session_id],
        |row| {
            let live_edit_id: String = row.get(0)?;
            Ok(AgentLiveDraftSummary {
                delta_count: count_live_edit_deltas(conn, &live_edit_id).unwrap_or_default(),
                live_edit_id,
                follow_session_id: row.get(1)?,
                follow_target_id: row.get(2)?,
                path: row.get(3)?,
                base_revision_id: row.get(4)?,
                status: row.get(5)?,
                draft_buffer_ref: row.get(6)?,
                commit_operation_id: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .optional()
    .context("failed to read live draft summary")
}

fn count_live_edit_deltas(conn: &Connection, live_edit_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM live_edit_delta WHERE live_edit_id = ?1",
        params![live_edit_id],
        |row| row.get(0),
    )
    .context("failed to count live edit deltas")
}

fn next_live_delta_sequence(conn: &Connection, live_edit_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM live_edit_delta WHERE live_edit_id = ?1",
        params![live_edit_id],
        |row| row.get(0),
    )
    .context("failed to allocate live edit delta sequence")
}

fn read_live_edit_follow_session(conn: &Connection, live_edit_id: &str) -> Result<String> {
    conn.query_row(
        "SELECT follow_session_id FROM live_edit_stream WHERE live_edit_id = ?1",
        params![live_edit_id],
        |row| row.get(0),
    )
    .context("live edit not found")
}

fn read_live_edit_session_and_path(
    conn: &Connection,
    live_edit_id: &str,
) -> Result<(String, String)> {
    conn.query_row(
        "SELECT follow_session_id, path FROM live_edit_stream WHERE live_edit_id = ?1",
        params![live_edit_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .context("live edit not found")
}

fn read_latest_live_edit_for_path(
    conn: &Connection,
    path: &str,
    statuses: &[&str],
) -> Result<Option<(String, String)>> {
    let status_json = statuses
        .iter()
        .map(|status| format!("'{status}'"))
        .collect::<Vec<_>>()
        .join(",");
    conn.query_row(
        &format!(
            "SELECT live_edit_id, follow_session_id
             FROM live_edit_stream
             WHERE path = ?1 AND status IN ({status_json})
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1"
        ),
        params![path],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .context("failed to read live edit for path")
}

fn tool_operation_exists(conn: &Connection, op_id: &str) -> Result<bool> {
    let blob_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tool_result_blob WHERE op_id = ?1",
        params![op_id],
        |row| row.get(0),
    )?;
    if blob_count > 0 {
        return Ok(true);
    }
    let target_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM follow_target WHERE tool_operation_id = ?1",
        params![op_id],
        |row| row.get(0),
    )?;
    Ok(target_count > 0)
}

fn bind_workspace_commit_to_live_edit(
    conn: &Connection,
    follow_session_id: &str,
    live_edit_id: &str,
    path: &str,
    op_id: &str,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE workspace_commit
         SET live_edit_id = ?1, updated_at_ms = ?2, updated_at_iso = ?3
         WHERE follow_session_id = ?4 AND tool_operation_id = ?5 AND path = ?6",
        params![live_edit_id, now, now_iso, follow_session_id, op_id, path],
    )?;
    Ok(())
}

fn bump_follow_session_for_live_edit(
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

fn append_live_edit_event(
    conn: &Connection,
    follow_session_id: &str,
    session_id: &str,
    live_edit_id: &str,
    event_type: &str,
    label: String,
    status: &str,
    now: i64,
    now_iso: &str,
) -> Result<()> {
    let sequence: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM follow_event WHERE follow_session_id = ?1",
        params![follow_session_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO follow_event (
            follow_event_id, follow_session_id, follow_target_id, session_id, runtime_turn_id,
            tool_operation_id, work_slice_id, event_type, payload_ref, payload_json, sequence,
            created_at_ms, created_at_iso
         ) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, NULL, ?5, ?6, ?7, ?8)",
        params![
            new_id("follow_event"),
            follow_session_id,
            session_id,
            event_type,
            json!({
                "label": label,
                "status": status,
                "liveEditId": live_edit_id,
            })
            .to_string(),
            sequence,
            now,
            now_iso,
        ],
    )?;
    Ok(())
}
