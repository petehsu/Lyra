use super::*;

pub(super) fn read_diff_artifact_blob_row(
    row: &Row<'_>,
) -> rusqlite::Result<DiffArtifactBlobRecord> {
    let metadata_json: String = row.get(4)?;
    Ok(DiffArtifactBlobRecord {
        artifact_id: row.get(0)?,
        runtime_turn_id: row.get(1)?,
        evidence_id: None,
        status: row.get(9)?,
        title: row.get(2)?,
        content_ref: row.get(3)?,
        metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({})),
        content: row.get(5)?,
        content_sha256: row.get(6)?,
        content_bytes: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub(super) fn read_approval_ticket_row(row: &Row<'_>) -> rusqlite::Result<ApprovalTicketRecord> {
    Ok(ApprovalTicketRecord {
        approval_ticket_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        status: row.get(3)?,
        approval_mode: row.get(4)?,
        title: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub(super) fn read_patch_file_backup_row(row: &Row<'_>) -> rusqlite::Result<PatchFileBackupRecord> {
    Ok(PatchFileBackupRecord {
        backup_ref: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        approval_ticket_id: row.get(3)?,
        source_artifact_id: row.get(4)?,
        patch_ref: row.get(5)?,
        path: row.get(6)?,
        existed: row.get::<_, i64>(7)? != 0,
        content_ref: row.get(8)?,
        content_sha256: row.get(9)?,
        content_bytes: row.get(10)?,
        post_apply_sha256: row.get(11)?,
        post_apply_bytes: row.get(12)?,
    })
}

pub(super) fn read_todo_list_row(row: &Row<'_>) -> rusqlite::Result<AgentExecutionTodoList> {
    let source_json: String = row.get(6)?;
    Ok(AgentExecutionTodoList {
        todo_list_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        kind: row.get(3)?,
        status: row.get(4)?,
        title: row.get(5)?,
        source: serde_json::from_str(&source_json).unwrap_or_else(|_| json!({})),
        items: Vec::new(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub(super) fn read_todo_item_row(row: &Row<'_>) -> rusqlite::Result<AgentTodoItem> {
    let actions_json: String = row.get(4)?;
    let expected_tools_json: String = row.get(5)?;
    let completion_criteria_json: String = row.get(7)?;
    let evidence_refs_json: String = row.get(8)?;
    let blockers_json: String = row.get(9)?;
    let source_json: String = row.get(10)?;
    Ok(AgentTodoItem {
        todo_item_id: row.get(0)?,
        todo_list_id: row.get(1)?,
        status: row.get(2)?,
        title: row.get(3)?,
        actions: parse_json_vec_string(&actions_json),
        expected_tools: parse_json_vec_string(&expected_tools_json),
        risk_level: row.get(6)?,
        completion_criteria: parse_json_vec_string(&completion_criteria_json),
        evidence_refs: parse_json_vec_string(&evidence_refs_json),
        blockers: serde_json::from_str(&blockers_json).unwrap_or_else(|_| json!([])),
        source: serde_json::from_str(&source_json).unwrap_or_else(|_| json!({})),
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

pub(super) fn read_todo_items_for_list(
    conn: &Connection,
    todo_list_id: &str,
) -> Result<Vec<AgentTodoItem>> {
    let mut stmt = conn.prepare(
        "SELECT todo_item_id, todo_list_id, status, title, actions_json,
                expected_tools_json, risk_level, completion_criteria_json,
                evidence_refs_json, blockers_json, source_json, created_at_ms, updated_at_ms
         FROM todo_item
         WHERE todo_list_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![todo_list_id], read_todo_item_row)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn read_evidence_id_for_artifact(
    conn: &Connection,
    session_id: &str,
    artifact_id: &str,
) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT evidence_id, artifact_ids_json
         FROM evidence_record
         WHERE session_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (evidence_id, artifact_ids_json) = row?;
        let artifact_ids: Vec<String> =
            serde_json::from_str(&artifact_ids_json).unwrap_or_default();
        if artifact_ids.iter().any(|id| id == artifact_id) {
            return Ok(Some(evidence_id));
        }
    }
    Ok(None)
}

pub(super) fn read_profile_row(
    conn: &Connection,
    profile_id: &str,
) -> Result<Option<AiProviderProfile>> {
    let row = conn
        .query_row(
            "SELECT id, name, provider_id, protocol_id, runtime_provider_id, runtime_supported,
                    preset_id, connection_config_json, auth_config_json, headers_json, model,
                    model_runtime_metadata_json, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             FROM ai_profile WHERE id = ?1",
            params![profile_id],
            |row| {
                let connection_json: String = row.get(7)?;
                let auth_json: String = row.get(8)?;
                let headers_json: String = row.get(9)?;
                let runtime_metadata_json: Option<String> = row.get(11)?;
                let custom_models_json: String = row.get(12)?;
                let discovery_json: String = row.get(13)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)? != 0,
                    row.get::<_, Option<String>>(6)?,
                    connection_json,
                    auth_json,
                    headers_json,
                    row.get::<_, String>(10)?,
                    runtime_metadata_json,
                    custom_models_json,
                    discovery_json,
                    row.get::<_, i64>(14)? != 0,
                    row.get::<_, i64>(15)?,
                    row.get::<_, i64>(16)?,
                ))
            },
        )
        .optional()?;
    let Some(row) = row else {
        return Ok(None);
    };
    let secret_rows = {
        let mut stmt = conn.prepare(
            "SELECT field_id, secret_ref_id FROM profile_secret WHERE profile_id = ?1 ORDER BY field_id",
        )?;
        let rows = stmt.query_map(params![profile_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        result
    };
    let configured_secret_fields = secret_rows
        .iter()
        .map(|(field, _)| field.clone())
        .collect::<Vec<_>>();
    let secret_status = if configured_secret_fields.is_empty() {
        "missing"
    } else {
        "configured"
    }
    .to_string();
    Ok(Some(AiProviderProfile {
        id: row.0,
        name: row.1,
        provider_id: row.2,
        protocol_id: row.3,
        runtime_provider_id: row.4,
        runtime_supported: row.5,
        secret_status,
        preset_id: row.6,
        connection_config: parse_json_or(row.7, HashMap::new()),
        auth_config: parse_json_or(row.8, HashMap::new()),
        configured_secret_fields,
        headers: parse_json_or(row.9, HashMap::new()),
        model: row.10,
        model_runtime_metadata: row.11.and_then(|value| serde_json::from_str(&value).ok()),
        custom_models: parse_json_or(row.12, Vec::new()),
        discovery_state: parse_json_or(row.13, AiModelDiscoveryState::default()),
        is_default: row.14,
        created_at: row.15,
        updated_at: row.16,
    }))
}

pub(super) fn read_session_index_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSession> {
    Ok(AgentSession {
        id: row.get(0)?,
        title: row.get(1)?,
        profile_id: row.get(2)?,
        model_id: row.get(3)?,
        system_prompt: row.get(4)?,
        permission_mode: row.get(5)?,
        execution_target: row.get(6)?,
        project_root: row.get(7)?,
        project_name: row.get(8)?,
        collaboration_mode: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}
