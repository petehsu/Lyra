use super::recovery_execution::read_latest_execution_summary;
use super::*;

struct AnchorRow {
    anchor_id: String,
    session_id: String,
    user_message_id: String,
    runtime_turn_id: String,
    checkpoint_id: String,
    conversation_snapshot_id: String,
    workspace_snapshot_id: String,
    status: String,
    created_at: i64,
}

impl AiStore {
    pub fn create_recovery_anchor(
        &self,
        input: CreateRecoveryAnchorInput,
    ) -> Result<AgentMessageCheckpointSummary> {
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(&input.session_id, |conn| {
            if let Some(existing) =
                read_active_anchor_for_message(conn, &input.session_id, &input.user_message_id)?
            {
                return Ok(anchor_summary(existing));
            }
            let conversation_snapshot_id = new_id("conversation_snapshot");
            let workspace_snapshot_id = new_id("workspace_snapshot");
            let anchor_id = new_id("rollback_anchor");
            let visible_message_ids = read_visible_message_ids(conn)?;
            let open_follow_session_ids = read_open_follow_session_ids(conn, &input.session_id)?;
            let active_plan_ids = read_active_plan_ids(conn, &input.session_id)?;
            conn.execute(
                "INSERT INTO conversation_snapshot (
                    conversation_snapshot_id, session_id, user_message_id, runtime_turn_id,
                    visible_message_ids_json, active_cursor_message_id, open_panel_ids_json,
                    open_follow_session_ids_json, active_plan_ids_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    conversation_snapshot_id,
                    input.session_id,
                    input.user_message_id,
                    input.runtime_turn_id,
                    serde_json::to_string(&visible_message_ids)?,
                    input.user_message_id,
                    json!([]).to_string(),
                    serde_json::to_string(&open_follow_session_ids)?,
                    serde_json::to_string(&active_plan_ids)?,
                    now,
                    now_iso,
                ],
            )?;
            let workspace_status = if input.workspace_root.as_deref().and_then(trim_to_string).is_some() {
                "lightweight"
            } else {
                "unavailable"
            };
            conn.execute(
                "INSERT INTO workspace_snapshot (
                    workspace_snapshot_id, session_id, runtime_turn_id, user_message_id,
                    workspace_root, status, file_count, source, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'message_checkpoint', ?7, ?8, ?7, ?8)",
                params![
                    workspace_snapshot_id,
                    input.session_id,
                    input.runtime_turn_id,
                    input.user_message_id,
                    input.workspace_root,
                    workspace_status,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO message_rollback_anchor (
                    anchor_id, session_id, user_message_id, runtime_turn_id, checkpoint_id,
                    conversation_snapshot_id, workspace_snapshot_id, created_before_agent_response,
                    status, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'active', ?8, ?9, ?8, ?9)",
                params![
                    anchor_id,
                    input.session_id,
                    input.user_message_id,
                    input.runtime_turn_id,
                    input.checkpoint_id,
                    conversation_snapshot_id,
                    workspace_snapshot_id,
                    now,
                    now_iso,
                ],
            )?;
            let row = read_active_anchor_for_message(conn, &input.session_id, &input.user_message_id)?
                .ok_or_else(|| anyhow!("failed to create rollback anchor"))?;
            Ok(anchor_summary(row))
        })
    }

    pub fn read_active_recovery_anchor_for_turn(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
    ) -> Result<Option<AgentMessageCheckpointSummary>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT anchor_id, session_id, user_message_id, runtime_turn_id, checkpoint_id,
                        conversation_snapshot_id, workspace_snapshot_id, status, created_at_ms
                 FROM message_rollback_anchor
                 WHERE session_id = ?1 AND runtime_turn_id = ?2 AND status = 'active'
                 ORDER BY created_at_ms DESC LIMIT 1",
                params![session_id, runtime_turn_id],
                read_anchor_row,
            )
            .optional()
            .map(|row| row.map(anchor_summary))
            .context("failed to read rollback anchor for turn")
        })
    }

    pub fn read_recovery_summary(&self, session_id: &str) -> Result<Option<AgentRecoverySummary>> {
        self.with_session_conn(session_id, read_recovery_summary_from_conn)
    }

    pub fn capture_workspace_snapshot_files_for_turn(
        &self,
        session_id: &str,
        runtime_turn_id: &str,
        paths: &[String],
        source: &str,
    ) -> Result<()> {
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let Some(anchor) = conn
                .query_row(
                    "SELECT anchor_id, session_id, user_message_id, runtime_turn_id, checkpoint_id,
                            conversation_snapshot_id, workspace_snapshot_id, status, created_at_ms
                     FROM message_rollback_anchor
                     WHERE session_id = ?1 AND runtime_turn_id = ?2 AND status = 'active'
                     ORDER BY created_at_ms DESC LIMIT 1",
                    params![session_id, runtime_turn_id],
                    read_anchor_row,
                )
                .optional()
                .context("failed to read rollback anchor for workspace snapshot capture")?
            else {
                return Err(anyhow!(
                    "write operation blocked: message rollback checkpoint is missing"
                ));
            };
            let workspace_root: Option<String> = conn
                .query_row(
                    "SELECT workspace_root FROM workspace_snapshot WHERE workspace_snapshot_id = ?1",
                    params![anchor.workspace_snapshot_id.as_str()],
                    |row| row.get(0),
                )
                .optional()
                .context("failed to read workspace snapshot root")?
                .flatten();
            let Some(workspace_root) = workspace_root.and_then(|value| trim_to_string(&value)) else {
                return Err(anyhow!(
                    "write operation blocked: workspace snapshot root is unavailable"
                ));
            };
            let mut captured_count = 0_i64;
            for path in normalized_unique_paths(paths) {
                if capture_workspace_file_snapshot(
                    self,
                    conn,
                    &anchor.workspace_snapshot_id,
                    &workspace_root,
                    &path,
                    now,
                    &now_iso,
                )? {
                    captured_count += 1;
                }
            }
            let status = if captured_count > 0 { "captured" } else { "lightweight" };
            conn.execute(
                "UPDATE workspace_snapshot
                 SET status = ?1, file_count = (
                        SELECT COUNT(*) FROM workspace_file_snapshot
                        WHERE workspace_snapshot_id = ?2
                     ),
                     source = ?3, updated_at_ms = ?4, updated_at_iso = ?5
                 WHERE workspace_snapshot_id = ?2",
                params![
                    status,
                    anchor.workspace_snapshot_id,
                    source,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })
    }
}

pub(super) fn read_recovery_summary_from_conn(
    conn: &Connection,
) -> Result<Option<AgentRecoverySummary>> {
    let latest_anchor = conn
        .query_row(
            "SELECT anchor_id, session_id, user_message_id, runtime_turn_id, checkpoint_id,
                    conversation_snapshot_id, workspace_snapshot_id, status, created_at_ms
             FROM message_rollback_anchor
             WHERE status = 'active'
             ORDER BY created_at_ms DESC
             LIMIT 1",
            [],
            read_anchor_row,
        )
        .optional()
        .context("failed to read latest rollback anchor")?
        .map(anchor_summary);
    let rollback_ready_message_ids = read_ready_message_ids(conn)?;
    let rollback_previews = read_preview_summaries(conn, None, 4)?;
    let active_rollback_preview = rollback_previews
        .iter()
        .find(|preview| preview.status == "previewed")
        .cloned();
    let latest_execution = read_latest_execution_summary(conn)?;
    let reopened_message_id = latest_execution
        .as_ref()
        .and_then(|execution| execution.reopened_user_message_id.clone());
    if latest_anchor.is_none() && rollback_previews.is_empty() && latest_execution.is_none() {
        return Ok(None);
    }
    Ok(Some(AgentRecoverySummary {
        latest_anchor,
        rollback_previews,
        rollback_ready_message_ids,
        active_rollback_preview,
        latest_execution,
        reopened_message_id,
    }))
}

pub(super) fn read_preview_summaries(
    conn: &Connection,
    rollback_id: Option<&str>,
    limit: usize,
) -> Result<Vec<AgentRollbackPreviewSummary>> {
    let sql = if rollback_id.is_some() {
        "SELECT rollback_id, session_id, target_user_message_id, status, impact_level,
                requires_confirmation, preview_artifact_id, evidence_id,
                conversation_changes_json, workspace_changes_json, external_side_effects_json,
                updated_at_ms
         FROM rollback_preview
         WHERE rollback_id = ?1
         ORDER BY updated_at_ms DESC
         LIMIT ?2"
    } else {
        "SELECT rollback_id, session_id, target_user_message_id, status, impact_level,
                requires_confirmation, preview_artifact_id, evidence_id,
                conversation_changes_json, workspace_changes_json, external_side_effects_json,
                updated_at_ms
         FROM rollback_preview
         ORDER BY updated_at_ms DESC
         LIMIT ?1"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = if let Some(rollback_id) = rollback_id {
        stmt.query_map(params![rollback_id, limit as i64], read_preview_summary_row)?
    } else {
        stmt.query_map(params![limit as i64], read_preview_summary_row)?
    };
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_preview_summary_row(row: &Row<'_>) -> rusqlite::Result<AgentRollbackPreviewSummary> {
    let conversation_json: String = row.get(8)?;
    let workspace_json: String = row.get(9)?;
    let external_json: String = row.get(10)?;
    let conversation_count = serde_json::from_str::<Vec<Value>>(&conversation_json)
        .map(|items| items.len())
        .unwrap_or(0);
    let workspace_count = serde_json::from_str::<Vec<Value>>(&workspace_json)
        .map(|items| items.len())
        .unwrap_or(0);
    let external_count = serde_json::from_str::<Vec<Value>>(&external_json)
        .map(|items| items.len())
        .unwrap_or(0);
    let impact_level: String = row.get(4)?;
    Ok(AgentRollbackPreviewSummary {
        rollback_id: row.get(0)?,
        session_id: row.get(1)?,
        target_user_message_id: row.get(2)?,
        status: row.get(3)?,
        summary: preview_summary(
            &impact_level,
            conversation_count,
            workspace_count,
            external_count,
        ),
        impact_level,
        requires_confirmation: row.get::<_, i64>(5)? != 0,
        artifact_id: row.get(6)?,
        evidence_id: row.get(7)?,
        message_count: conversation_count,
        workspace_change_count: workspace_count,
        external_side_effect_count: external_count,
        updated_at: row.get(11)?,
    })
}

pub(super) fn preview_summary(
    impact_level: &str,
    message_count: usize,
    workspace_count: usize,
    external_count: usize,
) -> String {
    let label = match impact_level {
        "conflict" => "Conflict",
        "external_side_effect" => "External effect",
        "destructive" => "Destructive",
        _ => "Safe preview",
    };
    format!(
        "{label}: {message_count} message(s), {workspace_count} workspace change(s), {external_count} external effect(s)."
    )
}

fn read_ready_message_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT user_message_id
         FROM message_rollback_anchor
         WHERE status = 'active'
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_active_anchor_for_message(
    conn: &Connection,
    session_id: &str,
    user_message_id: &str,
) -> Result<Option<AnchorRow>> {
    conn.query_row(
        "SELECT anchor_id, session_id, user_message_id, runtime_turn_id, checkpoint_id,
                conversation_snapshot_id, workspace_snapshot_id, status, created_at_ms
         FROM message_rollback_anchor
         WHERE session_id = ?1 AND user_message_id = ?2 AND status = 'active'
         LIMIT 1",
        params![session_id, user_message_id],
        read_anchor_row,
    )
    .optional()
    .context("failed to read rollback anchor")
}

fn read_anchor_row(row: &Row<'_>) -> rusqlite::Result<AnchorRow> {
    Ok(AnchorRow {
        anchor_id: row.get(0)?,
        session_id: row.get(1)?,
        user_message_id: row.get(2)?,
        runtime_turn_id: row.get(3)?,
        checkpoint_id: row.get(4)?,
        conversation_snapshot_id: row.get(5)?,
        workspace_snapshot_id: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn anchor_summary(row: AnchorRow) -> AgentMessageCheckpointSummary {
    AgentMessageCheckpointSummary {
        anchor_id: row.anchor_id,
        session_id: row.session_id,
        user_message_id: row.user_message_id,
        runtime_turn_id: row.runtime_turn_id,
        checkpoint_id: row.checkpoint_id,
        conversation_snapshot_id: row.conversation_snapshot_id,
        workspace_snapshot_id: row.workspace_snapshot_id,
        status: row.status,
        created_at: row.created_at,
    }
}

fn read_visible_message_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT msg_id FROM session_dialog ORDER BY created_at_ms ASC, turn_index ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_open_follow_session_ids(conn: &Connection, session_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT follow_session_id
         FROM follow_session
         WHERE session_id = ?1 AND status NOT IN ('closed', 'superseded_by_rollback')
         ORDER BY updated_at_ms DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_active_plan_ids(conn: &Connection, session_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT planning_session_id
         FROM planning_session
         WHERE session_id = ?1 AND status NOT IN ('superseded_by_rollback')
         ORDER BY updated_at_ms DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn normalized_unique_paths(paths: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for path in paths {
        let Some(path) = trim_to_string(path) else {
            continue;
        };
        if result.iter().any(|entry| entry == &path) == false {
            result.push(path);
        }
    }
    result
}

fn capture_workspace_file_snapshot(
    store: &AiStore,
    conn: &Connection,
    workspace_snapshot_id: &str,
    workspace_root: &str,
    relative_path: &str,
    now: i64,
    now_iso: &str,
) -> Result<bool> {
    if is_safe_relative_path(relative_path) == false {
        return Err(anyhow!(
            "workspace snapshot path is outside workspace: {relative_path}"
        ));
    }
    let already_captured = conn
        .query_row(
            "SELECT 1 FROM workspace_file_snapshot
             WHERE workspace_snapshot_id = ?1 AND path = ?2
             LIMIT 1",
            params![workspace_snapshot_id, relative_path],
            |_| Ok(()),
        )
        .optional()
        .context("failed to check workspace file snapshot")?
        .is_some();
    if already_captured {
        return Ok(false);
    }
    let root = Path::new(workspace_root);
    let path = root.join(relative_path);
    let canonical_root = root
        .canonicalize()
        .with_context(|| format!("failed to canonicalize workspace root {}", root.display()))?;
    let canonical_path = path.canonicalize().ok();
    if let Some(canonical_path) = canonical_path.as_ref() {
        if canonical_path.starts_with(&canonical_root) == false {
            return Err(anyhow!(
                "workspace snapshot path is outside workspace: {relative_path}"
            ));
        }
    }
    let file_snapshot_id = new_id("workspace_file_snapshot");
    let exists = path.is_file();
    let mut content_hash = None;
    let mut content_ref = None;
    let mut size_bytes = 0_i64;
    let mut encoding = None;
    let mut unavailable_reason = None;
    if exists {
        let bytes = fs::read(&path).with_context(|| {
            format!("failed to read workspace snapshot file {}", path.display())
        })?;
        content_hash = Some(sha256_hex(&bytes));
        size_bytes = bytes.len() as i64;
        encoding = if std::str::from_utf8(&bytes).is_ok() {
            Some("utf-8".to_string())
        } else {
            Some("binary".to_string())
        };
        if bytes.len() <= 1024 * 1024 {
            let snapshot_dir = store
                .session_dir(
                    conn.query_row(
                        "SELECT session_id FROM message_rollback_anchor
                         WHERE workspace_snapshot_id = ?1 LIMIT 1",
                        params![workspace_snapshot_id],
                        |row| row.get::<_, String>(0),
                    )
                    .context("failed to read workspace snapshot session")?
                    .as_str(),
                )
                .join("workspace-snapshots")
                .join(workspace_snapshot_id);
            fs::create_dir_all(&snapshot_dir).with_context(|| {
                format!(
                    "failed to create workspace snapshot dir {}",
                    snapshot_dir.display()
                )
            })?;
            let file_name = format!("{file_snapshot_id}.bin");
            fs::write(snapshot_dir.join(&file_name), &bytes).with_context(|| {
                format!(
                    "failed to write workspace snapshot content {}",
                    snapshot_dir.display()
                )
            })?;
            content_ref = Some(format!("{workspace_snapshot_id}/{file_name}"));
        } else {
            unavailable_reason = Some("oversized".to_string());
        }
    }
    conn.execute(
        "INSERT INTO workspace_file_snapshot (
            workspace_file_snapshot_id, workspace_snapshot_id, path, exists_at_snapshot,
            content_hash, content_ref, size_bytes, encoding, unavailable_reason,
            captured_at_ms, captured_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            file_snapshot_id,
            workspace_snapshot_id,
            relative_path,
            if exists { 1_i64 } else { 0_i64 },
            content_hash,
            content_ref,
            size_bytes,
            encoding,
            unavailable_reason,
            now,
            now_iso,
        ],
    )?;
    Ok(true)
}

fn is_safe_relative_path(path: &str) -> bool {
    let candidate = Path::new(path);
    candidate.is_relative()
        && candidate.components().all(|component| {
            matches!(
                component,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
}
