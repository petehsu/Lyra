use super::recovery_supersede::{supersede_records_after_checkpoint, RecoverySupersedeResult};
use super::recovery_workspace::restore_workspace_snapshot_changes;
use super::*;

struct ExecutionPreviewRow {
    rollback_id: String,
    session_id: String,
    target_user_message_id: String,
    checkpoint_id: String,
    impact_level: String,
    requires_confirmation: bool,
    status: String,
    workspace_changes: Vec<AgentRollbackWorkspaceChange>,
    conversation_changes: Vec<AgentRollbackConversationChange>,
    external_side_effects: Vec<AgentRollbackExternalSideEffect>,
}

struct ExecutionAnchorRow {
    runtime_turn_id: String,
    checkpoint_id: String,
    conversation_snapshot_id: String,
    workspace_snapshot_id: String,
    created_at: i64,
}

impl AiStore {
    pub fn execute_message_rollback(
        &self,
        session_id: &str,
        rollback_id: &str,
        confirmation_token: Option<&str>,
        strategy: Option<&str>,
    ) -> Result<AgentExecuteMessageRollbackResult> {
        self.with_session_conn(session_id, |conn| {
            if let Some(existing) = read_execution_result(conn, session_id, rollback_id)? {
                return Ok(existing);
            }
            let preview = read_execution_preview(conn, session_id, rollback_id)?
                .ok_or_else(|| anyhow!("rollback preview not found: {rollback_id}"))?;
            if preview.status != "previewed" {
                return block_preview(
                    conn,
                    &preview,
                    "rollback preview is not executable",
                    Vec::new(),
                );
            }
            if preview.impact_level != "safe" {
                return block_preview(
                    conn,
                    &preview,
                    if preview.impact_level == "external_side_effect" {
                        "TOOL_ROLLBACK_EXTERNAL_SIDE_EFFECT: external side effects require manual handling"
                    } else {
                        "TOOL_ROLLBACK_CONFLICT: rollback preview is not safe to execute"
                    },
                    preview
                        .external_side_effects
                        .iter()
                        .map(|effect| effect.side_effect_id.clone())
                        .collect(),
                );
            }
            if preview.external_side_effects.is_empty() == false {
                return block_preview(
                    conn,
                    &preview,
                    "TOOL_ROLLBACK_EXTERNAL_SIDE_EFFECT: external side effects require manual handling",
                    preview
                        .external_side_effects
                        .iter()
                        .map(|effect| effect.side_effect_id.clone())
                        .collect(),
                );
            }
            if preview
                .workspace_changes
                .iter()
                .any(|change| change.status == "conflict")
            {
                return block_preview(
                    conn,
                    &preview,
                    "TOOL_ROLLBACK_CONFLICT: workspace changed since rollback preview",
                    Vec::new(),
                );
            }
            if preview.requires_confirmation
                && confirmation_token.and_then(trim_to_string).is_none()
            {
                return block_preview(
                    conn,
                    &preview,
                    "rollback execution requires explicit confirmation",
                    Vec::new(),
                );
            }
            if matches!(strategy, Some("keep_user_changes")) {
                return block_preview(
                    conn,
                    &preview,
                    "keep_user_changes is not supported by safe rollback v1",
                    Vec::new(),
                );
            }
            let anchor = read_execution_anchor(conn, session_id, &preview.target_user_message_id)?
                .ok_or_else(|| anyhow!("rollback anchor not found for message: {}", preview.target_user_message_id))?;
            if anchor.checkpoint_id != preview.checkpoint_id {
                return block_preview(
                    conn,
                    &preview,
                    "TOOL_ROLLBACK_CONFLICT: rollback checkpoint no longer matches active branch",
                    Vec::new(),
                );
            }
            let restore_changes = preview
                .workspace_changes
                .iter()
                .map(|change| RestoreWorkspaceChange {
                    path: change.path.clone(),
                    expected_hash: change.expected_hash.clone(),
                })
                .collect::<Vec<_>>();
            let workspace_result = match restore_workspace_snapshot_changes(
                self,
                conn,
                session_id,
                &anchor.workspace_snapshot_id,
                &restore_changes,
            ) {
                Ok(result) => result,
                Err(error) if error.to_string().contains("TOOL_ROLLBACK_CONFLICT") => {
                    return block_preview(conn, &preview, &error.to_string(), Vec::new());
                }
                Err(error) => return Err(error),
            };
            let supersede = supersede_records_after_checkpoint(
                conn,
                session_id,
                rollback_id,
                &preview.target_user_message_id,
                &anchor.runtime_turn_id,
                anchor.created_at,
            )?;
            let (artifact_id, evidence_id) = append_execution_artifact_and_evidence(
                conn,
                &preview,
                &workspace_result,
                &supersede,
            )?;
            conn.execute(
                "UPDATE rollback_preview
                 SET status = 'executed', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE rollback_id = ?3",
                params![now_ms(), now_iso(), rollback_id],
            )?;
            let detail = format!(
                "Restored {} workspace file(s), superseded {} message(s), reopened target message.",
                workspace_result.restored_paths.len(),
                supersede.superseded_message_ids.len()
            );
            insert_execution_result(
                conn,
                &preview,
                "completed",
                workspace_result.restored_workspace_snapshot_id.clone(),
                Some(anchor.conversation_snapshot_id),
                supersede.superseded_message_ids.clone(),
                supersede.unresolved_side_effect_ids.clone(),
                Some(preview.target_user_message_id.clone()),
                Some(artifact_id.clone()),
                Some(evidence_id.clone()),
                &detail,
            )
        })
    }
}

fn read_execution_preview(
    conn: &Connection,
    session_id: &str,
    rollback_id: &str,
) -> Result<Option<ExecutionPreviewRow>> {
    conn.query_row(
        "SELECT rollback_id, session_id, target_user_message_id, checkpoint_id, impact_level,
                requires_confirmation, status, workspace_changes_json,
                conversation_changes_json, external_side_effects_json
         FROM rollback_preview
         WHERE session_id = ?1 AND rollback_id = ?2
         LIMIT 1",
        params![session_id, rollback_id],
        |row| {
            let workspace_json: String = row.get(7)?;
            let conversation_json: String = row.get(8)?;
            let external_json: String = row.get(9)?;
            let workspace_changes = serde_json::from_str(&workspace_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    7,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            let conversation_changes =
                serde_json::from_str(&conversation_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        8,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            let external_side_effects = serde_json::from_str(&external_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    9,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(ExecutionPreviewRow {
                rollback_id: row.get(0)?,
                session_id: row.get(1)?,
                target_user_message_id: row.get(2)?,
                checkpoint_id: row.get(3)?,
                impact_level: row.get(4)?,
                requires_confirmation: row.get::<_, i64>(5)? != 0,
                status: row.get(6)?,
                workspace_changes,
                conversation_changes,
                external_side_effects,
            })
        },
    )
    .optional()
    .context("failed to read rollback preview for execution")
}

fn read_execution_anchor(
    conn: &Connection,
    session_id: &str,
    target_user_message_id: &str,
) -> Result<Option<ExecutionAnchorRow>> {
    conn.query_row(
        "SELECT runtime_turn_id, checkpoint_id, conversation_snapshot_id,
                workspace_snapshot_id, created_at_ms
         FROM message_rollback_anchor
         WHERE session_id = ?1 AND user_message_id = ?2 AND status = 'active'
         LIMIT 1",
        params![session_id, target_user_message_id],
        |row| {
            Ok(ExecutionAnchorRow {
                runtime_turn_id: row.get(0)?,
                checkpoint_id: row.get(1)?,
                conversation_snapshot_id: row.get(2)?,
                workspace_snapshot_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
    .optional()
    .context("failed to read rollback execution anchor")
}

fn block_preview(
    conn: &Connection,
    preview: &ExecutionPreviewRow,
    detail: &str,
    unresolved_side_effect_ids: Vec<String>,
) -> Result<AgentExecuteMessageRollbackResult> {
    conn.execute(
        "UPDATE rollback_preview
         SET status = 'blocked', updated_at_ms = ?1, updated_at_iso = ?2
         WHERE rollback_id = ?3 AND status = 'previewed'",
        params![now_ms(), now_iso(), preview.rollback_id],
    )?;
    insert_execution_result(
        conn,
        preview,
        "blocked",
        None,
        None,
        Vec::new(),
        unresolved_side_effect_ids,
        None,
        None,
        None,
        detail,
    )
}

fn append_execution_artifact_and_evidence(
    conn: &Connection,
    preview: &ExecutionPreviewRow,
    workspace_result: &RestoreWorkspaceResult,
    supersede: &RecoverySupersedeResult,
) -> Result<(String, String)> {
    let artifact_id = new_id("artifact");
    let artifact_version_id = new_id("artifact_version");
    let evidence_id = new_id("evidence");
    let now = now_ms();
    let now_iso = now_iso();
    let payload = json!({
        "schemaVersion": "v1",
        "rollbackId": preview.rollback_id,
        "targetUserMessageId": preview.target_user_message_id,
        "restoredWorkspaceSnapshotId": workspace_result.restored_workspace_snapshot_id,
        "restoredPaths": workspace_result.restored_paths,
        "supersededMessageIds": supersede.superseded_message_ids,
        "unresolvedSideEffectIds": supersede.unresolved_side_effect_ids,
        "previewConversationChanges": preview.conversation_changes,
    });
    conn.execute(
        "INSERT INTO artifact_record (
            artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
            title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
            created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, NULL, 'rollback_execution', 'completed', 'Rollback execution',
            ?4, NULL, ?5, ?6, ?7, ?8, ?7, ?8)",
        params![
            artifact_id,
            artifact_version_id,
            preview.session_id,
            format!("rollback_execution:{}", preview.rollback_id),
            payload.to_string(),
            json!({
                "type": "rollback_execution",
                "rollbackId": preview.rollback_id,
                "targetUserMessageId": preview.target_user_message_id,
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
         ) VALUES (?1, ?2, NULL, 'rollback_execution', 'active', ?3, ?4, '[]', 'high', ?5, ?6, NULL)",
        params![
            evidence_id,
            preview.session_id,
            json!({
                "claim": "A safe message rollback was executed.",
                "rollbackId": preview.rollback_id,
                "targetUserMessageId": preview.target_user_message_id,
                "restoredPathCount": workspace_result.restored_paths.len(),
                "supersededMessageCount": supersede.superseded_message_ids.len(),
            })
            .to_string(),
            json!([artifact_id]).to_string(),
            now,
            now_iso,
        ],
    )?;
    Ok((artifact_id, evidence_id))
}

#[allow(clippy::too_many_arguments)]
fn insert_execution_result(
    conn: &Connection,
    preview: &ExecutionPreviewRow,
    status: &str,
    restored_workspace_snapshot_id: Option<String>,
    restored_conversation_snapshot_id: Option<String>,
    superseded_message_ids: Vec<String>,
    unresolved_side_effect_ids: Vec<String>,
    reopened_user_message_id: Option<String>,
    artifact_id: Option<String>,
    evidence_id: Option<String>,
    detail: &str,
) -> Result<AgentExecuteMessageRollbackResult> {
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT OR REPLACE INTO rollback_execution (
            rollback_execution_id, rollback_id, session_id, target_user_message_id, status,
            impact_level, restored_workspace_snapshot_id, restored_conversation_snapshot_id,
            superseded_message_ids_json, unresolved_side_effect_ids_json,
            reopened_user_message_id, artifact_id, evidence_id, detail, created_at_ms,
            created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (
            COALESCE((SELECT rollback_execution_id FROM rollback_execution WHERE session_id = ?1 AND rollback_id = ?2), ?3),
            ?2, ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
            COALESCE((SELECT created_at_ms FROM rollback_execution WHERE session_id = ?1 AND rollback_id = ?2), ?15),
            COALESCE((SELECT created_at_iso FROM rollback_execution WHERE session_id = ?1 AND rollback_id = ?2), ?16),
            ?15, ?16
         )",
        params![
            preview.session_id,
            preview.rollback_id,
            new_id("rollback_execution"),
            preview.target_user_message_id,
            status,
            preview.impact_level,
            restored_workspace_snapshot_id,
            restored_conversation_snapshot_id,
            json_string(&superseded_message_ids)?,
            json_string(&unresolved_side_effect_ids)?,
            reopened_user_message_id,
            artifact_id,
            evidence_id,
            detail,
            now,
            now_iso,
        ],
    )?;
    read_execution_result(conn, &preview.session_id, &preview.rollback_id)?
        .ok_or_else(|| anyhow!("failed to read rollback execution result"))
}

pub(super) fn read_execution_result(
    conn: &Connection,
    session_id: &str,
    rollback_id: &str,
) -> Result<Option<AgentExecuteMessageRollbackResult>> {
    conn.query_row(
        "SELECT session_id, rollback_id, status, impact_level, restored_workspace_snapshot_id,
                restored_conversation_snapshot_id, superseded_message_ids_json,
                unresolved_side_effect_ids_json, reopened_user_message_id, artifact_id,
                evidence_id, detail
         FROM rollback_execution
         WHERE session_id = ?1 AND rollback_id = ?2
         LIMIT 1",
        params![session_id, rollback_id],
        |row| {
            let superseded_json: String = row.get(6)?;
            let unresolved_json: String = row.get(7)?;
            Ok(AgentExecuteMessageRollbackResult {
                session_id: row.get(0)?,
                rollback_id: row.get(1)?,
                status: row.get(2)?,
                impact_level: row.get(3)?,
                restored_workspace_snapshot_id: row.get(4)?,
                restored_conversation_snapshot_id: row.get(5)?,
                superseded_message_ids: parse_json_vec_string(&superseded_json),
                unresolved_side_effect_ids: parse_json_vec_string(&unresolved_json),
                reopened_user_message_id: row.get(8)?,
                artifact_id: row.get(9)?,
                evidence_id: row.get(10)?,
                detail: row.get(11)?,
            })
        },
    )
    .optional()
    .context("failed to read rollback execution result")
}

pub(super) fn read_latest_execution_summary(
    conn: &Connection,
) -> Result<Option<AgentRollbackExecutionSummary>> {
    conn.query_row(
        "SELECT rollback_id, status, impact_level, reopened_user_message_id,
                superseded_message_ids_json, unresolved_side_effect_ids_json, detail, updated_at_ms
         FROM rollback_execution
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        [],
        |row| {
            let superseded_json: String = row.get(4)?;
            let unresolved_json: String = row.get(5)?;
            Ok(AgentRollbackExecutionSummary {
                rollback_id: row.get(0)?,
                status: row.get(1)?,
                impact_level: row.get(2)?,
                reopened_user_message_id: row.get(3)?,
                superseded_message_count: parse_json_vec_string(&superseded_json).len(),
                unresolved_side_effect_count: parse_json_vec_string(&unresolved_json).len(),
                detail: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read latest rollback execution summary")
}
