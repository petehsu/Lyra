use super::recovery_checkpoint::preview_summary;
use super::*;

struct PreviewAnchor {
    checkpoint_id: String,
    workspace_snapshot_id: String,
    created_at: i64,
}

struct SideEffectRow {
    side_effect_id: String,
    kind: String,
    target_ref: String,
    rollback_status: String,
}

impl AiStore {
    pub fn read_message_rollback_preview(
        &self,
        session_id: &str,
        rollback_id: &str,
    ) -> Result<Option<AgentPreviewMessageRollbackResult>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT session_id, rollback_id, target_user_message_id, status, impact_level,
                        requires_confirmation, preview_artifact_id, evidence_id,
                        workspace_changes_json, conversation_changes_json, external_side_effects_json
                 FROM rollback_preview
                 WHERE session_id = ?1 AND rollback_id = ?2
                 LIMIT 1",
                params![session_id, rollback_id],
                read_preview_result_row,
            )
            .optional()
            .context("failed to read rollback preview")
        })
    }

    pub fn preview_message_rollback(
        &self,
        session_id: &str,
        target_user_message_id: &str,
    ) -> Result<AgentPreviewMessageRollbackResult> {
        self.with_session_conn(session_id, |conn| {
            let anchor = read_preview_anchor(conn, session_id, target_user_message_id)?
                .ok_or_else(|| anyhow!("rollback anchor not found for message: {target_user_message_id}"))?;
            let workspace_root = read_workspace_root(conn, &anchor.workspace_snapshot_id)?;
            let conversation_changes = read_later_messages(conn, target_user_message_id)?;
            let side_effects = read_side_effects_after(conn, anchor.created_at)?;
            let workspace_changes =
                workspace_changes_for_side_effects(conn, workspace_root.as_deref(), &side_effects)?;
            let external_side_effects = external_side_effects(&side_effects);
            let impact_level = if external_side_effects.is_empty() == false {
                "external_side_effect"
            } else if workspace_changes
                .iter()
                .any(|change| change.status == "conflict")
            {
                "conflict"
            } else {
                "safe"
            };
            let requires_confirmation = conversation_changes.is_empty() == false
                || workspace_changes.is_empty() == false
                || external_side_effects.is_empty() == false;
            let rollback_id = new_id("rollback_preview");
            let now = now_ms();
            let now_iso = now_iso();
            let summary = preview_summary(
                impact_level,
                conversation_changes.len(),
                workspace_changes.len(),
                external_side_effects.len(),
            );
            let artifact_changes = read_artifact_changes_after(conn, anchor.created_at)?;
            let panel_changes = read_panel_changes_after(conn, anchor.created_at)?;
            let process_changes = process_changes(&side_effects);
            let preview_payload = json!({
                "schemaVersion": "v1",
                "rollbackId": rollback_id,
                "sessionId": session_id,
                "targetUserMessageId": target_user_message_id,
                "impactLevel": impact_level,
                "requiresConfirmation": requires_confirmation,
                "summary": summary,
                "conversationChanges": conversation_changes,
                "workspaceChanges": workspace_changes,
                "artifactChanges": artifact_changes,
                "panelChanges": panel_changes,
                "processChanges": process_changes,
                "externalSideEffects": external_side_effects,
            });
            let artifact_id = new_id("artifact");
            let artifact_version_id = new_id("artifact_version");
            let evidence_id = new_id("evidence");
            conn.execute(
                "UPDATE rollback_preview
                 SET status = 'superseded', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE session_id = ?3 AND target_user_message_id = ?4 AND status = 'previewed'",
                params![now, now_iso, session_id, target_user_message_id],
            )?;
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, NULL, 'rollback_preview', 'active', ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?8, ?9)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    "Rollback preview",
                    format!("rollback_preview:{rollback_id}"),
                    preview_payload.to_string(),
                    json!({
                        "type": "rollback_preview",
                        "rollbackId": rollback_id,
                        "targetUserMessageId": target_user_message_id
                    })
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, NULL, 'rollback_preview', 'active', ?3, ?4, ?5, 'medium', ?6, ?7, NULL)",
                params![
                    evidence_id,
                    session_id,
                    json!({
                        "summary": summary,
                        "impactLevel": impact_level,
                        "previewOnly": true
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([]).to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO rollback_preview (
                    rollback_id, session_id, target_user_message_id, checkpoint_id, impact_level,
                    conversation_changes_json, workspace_changes_json, artifact_changes_json,
                    panel_changes_json, process_changes_json, external_side_effects_json,
                    requires_confirmation, status, preview_artifact_id, evidence_id,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'previewed', ?13, ?14, ?15, ?16, ?15, ?16)",
                params![
                    rollback_id,
                    session_id,
                    target_user_message_id,
                    anchor.checkpoint_id,
                    impact_level,
                    serde_json::to_string(&conversation_changes)?,
                    serde_json::to_string(&workspace_changes)?,
                    artifact_changes.to_string(),
                    panel_changes.to_string(),
                    process_changes.to_string(),
                    serde_json::to_string(&external_side_effects)?,
                    if requires_confirmation { 1 } else { 0 },
                    artifact_id,
                    evidence_id,
                    now,
                    now_iso,
                ],
            )?;
            Ok(AgentPreviewMessageRollbackResult {
                session_id: session_id.to_string(),
                rollback_id,
                target_user_message_id: target_user_message_id.to_string(),
                status: "previewed".to_string(),
                impact_level: impact_level.to_string(),
                requires_confirmation,
                artifact_id: Some(artifact_id),
                evidence_id: Some(evidence_id),
                summary,
                workspace_changes,
                conversation_changes,
                external_side_effects,
            })
        })
    }
}

fn read_preview_result_row(row: &Row<'_>) -> rusqlite::Result<AgentPreviewMessageRollbackResult> {
    let workspace_json: String = row.get(8)?;
    let conversation_json: String = row.get(9)?;
    let external_json: String = row.get(10)?;
    let workspace_changes = serde_json::from_str::<Vec<AgentRollbackWorkspaceChange>>(
        &workspace_json,
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let conversation_changes = serde_json::from_str::<Vec<AgentRollbackConversationChange>>(
        &conversation_json,
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let external_side_effects = serde_json::from_str::<Vec<AgentRollbackExternalSideEffect>>(
        &external_json,
    )
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let impact_level: String = row.get(4)?;
    Ok(AgentPreviewMessageRollbackResult {
        session_id: row.get(0)?,
        rollback_id: row.get(1)?,
        target_user_message_id: row.get(2)?,
        status: row.get(3)?,
        impact_level: impact_level.clone(),
        requires_confirmation: row.get::<_, i64>(5)? != 0,
        artifact_id: row.get(6)?,
        evidence_id: row.get(7)?,
        summary: preview_summary(
            &impact_level,
            conversation_changes.len(),
            workspace_changes.len(),
            external_side_effects.len(),
        ),
        workspace_changes,
        conversation_changes,
        external_side_effects,
    })
}

fn read_preview_anchor(
    conn: &Connection,
    session_id: &str,
    target_user_message_id: &str,
) -> Result<Option<PreviewAnchor>> {
    conn.query_row(
        "SELECT checkpoint_id, workspace_snapshot_id, created_at_ms
         FROM message_rollback_anchor
         WHERE session_id = ?1 AND user_message_id = ?2 AND status = 'active'
         LIMIT 1",
        params![session_id, target_user_message_id],
        |row| {
            Ok(PreviewAnchor {
                checkpoint_id: row.get(0)?,
                workspace_snapshot_id: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )
    .optional()
    .context("failed to read rollback preview anchor")
}

fn read_workspace_root(conn: &Connection, workspace_snapshot_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT workspace_root FROM workspace_snapshot WHERE workspace_snapshot_id = ?1",
        params![workspace_snapshot_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read workspace snapshot root")
}

fn read_later_messages(
    conn: &Connection,
    target_user_message_id: &str,
) -> Result<Vec<AgentRollbackConversationChange>> {
    let target_index: Option<i64> = conn
        .query_row(
            "SELECT turn_index FROM session_dialog WHERE msg_id = ?1",
            params![target_user_message_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read target message index")?;
    let Some(target_index) = target_index else {
        return Err(anyhow!(
            "target message not found: {target_user_message_id}"
        ));
    };
    let mut stmt = conn.prepare(
        "SELECT msg_id, role, created_at_ms
         FROM session_dialog
         WHERE turn_index > ?1
         ORDER BY turn_index ASC",
    )?;
    let rows = stmt.query_map(params![target_index], |row| {
        Ok(AgentRollbackConversationChange {
            message_id: row.get(0)?,
            role: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_side_effects_after(conn: &Connection, created_after: i64) -> Result<Vec<SideEffectRow>> {
    let mut stmt = conn.prepare(
        "SELECT side_effect_id, kind, target_ref, rollback_status
         FROM side_effect_record
         WHERE created_at_ms >= ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![created_after], |row| {
        Ok(SideEffectRow {
            side_effect_id: row.get(0)?,
            kind: row.get(1)?,
            target_ref: row.get(2)?,
            rollback_status: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn workspace_changes_for_side_effects(
    conn: &Connection,
    workspace_root: Option<&str>,
    side_effects: &[SideEffectRow],
) -> Result<Vec<AgentRollbackWorkspaceChange>> {
    let mut result = Vec::new();
    for effect in side_effects {
        if matches!(effect.kind.as_str(), "workspace_write" | "workspace_delete") == false {
            continue;
        }
        let expected_hash = read_expected_post_effect_hash(conn, &effect.target_ref)?;
        let current_hash = if let Some(root) = workspace_root {
            hash_workspace_file(root, &effect.target_ref)?
        } else {
            None
        };
        let status =
            if expected_hash.is_some() && current_hash.is_some() && expected_hash != current_hash {
                "conflict"
            } else {
                "safe"
            };
        result.push(AgentRollbackWorkspaceChange {
            path: effect.target_ref.clone(),
            status: status.to_string(),
            side_effect_id: effect.side_effect_id.clone(),
            rollback_status: effect.rollback_status.clone(),
            expected_hash,
            current_hash,
        });
    }
    Ok(result)
}

fn read_expected_post_effect_hash(conn: &Connection, path: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT post_apply_sha256
         FROM file_backup_record
         WHERE path = ?1 AND post_apply_sha256 IS NOT NULL
         ORDER BY created_at_ms DESC
         LIMIT 1",
        params![path],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read expected post-effect hash")
}

fn hash_workspace_file(root: &str, relative_path: &str) -> Result<Option<String>> {
    let root_path = Path::new(root);
    let path = root_path.join(relative_path);
    let canonical_root = root_path.canonicalize().ok();
    let canonical_path = path.canonicalize().ok();
    if let (Some(root), Some(path)) = (canonical_root.as_ref(), canonical_path.as_ref()) {
        if path.starts_with(root) == false {
            return Ok(None);
        }
    }
    if path.is_file() == false {
        return Ok(None);
    }
    let bytes = fs::read(&path).with_context(|| format!("failed to hash {}", path.display()))?;
    Ok(Some(sha256_hex(&bytes)))
}

fn external_side_effects(side_effects: &[SideEffectRow]) -> Vec<AgentRollbackExternalSideEffect> {
    side_effects
        .iter()
        .filter(|effect| {
            matches!(effect.kind.as_str(), "workspace_write" | "workspace_delete") == false
                || matches!(
                    effect.rollback_status.as_str(),
                    "manual_review_required" | "compensation_required" | "not_reversible"
                )
        })
        .map(|effect| AgentRollbackExternalSideEffect {
            side_effect_id: effect.side_effect_id.clone(),
            kind: effect.kind.clone(),
            target_ref: effect.target_ref.clone(),
            rollback_status: effect.rollback_status.clone(),
        })
        .collect()
}

fn process_changes(side_effects: &[SideEffectRow]) -> Value {
    Value::Array(
        side_effects
            .iter()
            .filter(|effect| matches!(effect.kind.as_str(), "process_started" | "unknown"))
            .map(|effect| {
                json!({
                    "sideEffectId": effect.side_effect_id,
                    "kind": effect.kind,
                    "targetRef": effect.target_ref,
                    "rollbackStatus": effect.rollback_status,
                })
            })
            .collect(),
    )
}

fn read_artifact_changes_after(conn: &Connection, created_after: i64) -> Result<Value> {
    Ok(json!({
        "artifacts": read_ids_after(conn, "artifact_record", "artifact_id", created_after)?,
        "evidence": read_ids_after(conn, "evidence_record", "evidence_id", created_after)?,
        "todos": read_ids_after(conn, "execution_todo_list", "todo_list_id", created_after)?,
        "executionRuns": read_ids_after(conn, "execution_run", "execution_run_id", created_after)?,
        "verificationRuns": read_ids_after(conn, "verification_run", "verification_run_id", created_after)?,
        "longWorkRuns": read_ids_after(conn, "long_work_run", "long_work_run_id", created_after)?,
        "followSessions": read_ids_after(conn, "follow_session", "follow_session_id", created_after)?,
        "approvals": read_ids_after(conn, "approval_ticket", "approval_ticket_id", created_after)?,
    }))
}

fn read_panel_changes_after(conn: &Connection, created_after: i64) -> Result<Value> {
    Ok(json!({
        "planPanels": read_ids_after(conn, "plan_review_panel", "panel_id", created_after)?,
        "plans": read_ids_after(conn, "planning_session", "planning_session_id", created_after)?,
    }))
}

fn read_ids_after(
    conn: &Connection,
    table: &str,
    id_column: &str,
    created_after: i64,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {id_column} FROM {table} WHERE created_at_ms >= ?1 ORDER BY created_at_ms ASC"
    ))?;
    let rows = stmt.query_map(params![created_after], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}
