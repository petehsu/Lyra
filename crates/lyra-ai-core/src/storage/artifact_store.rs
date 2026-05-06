use super::*;

impl AiStore {
    pub fn append_tool_result_blob(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        tool_path: &str,
        status: &str,
        content_json: &str,
    ) -> Result<ToolResultBlobMeta> {
        let result_ref = new_id("tool_result");
        let created_at = now_ms();
        let content_bytes = content_json.len() as i64;
        let content_sha256 = sha256_hex(content_json.as_bytes());
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO tool_result_blob (
                    result_ref, runtime_turn_id, op_id, tool_path, status,
                    content_json, content_sha256, content_bytes, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    result_ref,
                    turn_id,
                    op_id,
                    tool_path,
                    status,
                    content_json,
                    content_sha256,
                    content_bytes,
                    created_at,
                ],
            )?;
            Ok(())
        })?;
        Ok(ToolResultBlobMeta {
            result_ref,
            content_sha256,
            content_bytes,
            content_preview: preview_text(content_json, 480),
        })
    }

    pub fn append_patch_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        title: &str,
        patch_ref: &str,
        metadata: Value,
        changed_files: Value,
    ) -> Result<PatchArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'diff', 'created', ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    title,
                    patch_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'not_run_record', 'active', ?4, ?5, ?6, 'medium', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "runtime_objective",
                        "claim": "A patch was proposed but not applied or tested.",
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchArtifactRefs {
            artifact_id,
            evidence_id,
        })
    }

    pub fn append_applied_patch_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        title: &str,
        patch_ref: &str,
        metadata: Value,
        changed_files: Value,
    ) -> Result<PatchArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'diff', 'applied', ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    title,
                    patch_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'apply_patch_record', 'active', ?4, ?5, ?6, 'high', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "workspace",
                        "claim": "A patch proposal was applied to workspace files.",
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchArtifactRefs {
            artifact_id,
            evidence_id,
        })
    }

    pub fn append_rollback_patch_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        title: &str,
        patch_ref: &str,
        metadata: Value,
        changed_files: Value,
    ) -> Result<PatchArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'patch_rollback', 'completed', ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    title,
                    patch_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'rollback_patch_record', 'active', ?4, ?5, ?6, 'high', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "workspace",
                        "claim": "An applied patch was rolled back using recorded backup refs.",
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(PatchArtifactRefs {
            artifact_id,
            evidence_id,
        })
    }

    #[cfg(test)]
    pub fn read_tool_result_blob(
        &self,
        session_id: &str,
        result_ref: &str,
    ) -> Result<Option<ToolResultBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT result_ref, runtime_turn_id, op_id, tool_path, status,
                        content_json, content_sha256, content_bytes, created_at_ms
                 FROM tool_result_blob WHERE result_ref = ?1",
                params![result_ref],
                |row| {
                    Ok(ToolResultBlobRecord {
                        result_ref: row.get(0)?,
                        runtime_turn_id: row.get(1)?,
                        op_id: row.get(2)?,
                        tool_path: row.get(3)?,
                        status: row.get(4)?,
                        content_json: row.get(5)?,
                        content_sha256: row.get(6)?,
                        content_bytes: row.get(7)?,
                        created_at: row.get(8)?,
                    })
                },
            )
            .optional()
            .context("failed to read ToolFS result blob")
        })
    }

    pub fn read_diff_artifact_blob(
        &self,
        session_id: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<DiffArtifactBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            let row = if let Some(artifact_id) = artifact_id {
                conn.query_row(
                    "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                            b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                            a.status
                     FROM artifact_record a
                     JOIN tool_result_blob b ON b.result_ref = a.content_ref
                     WHERE a.session_id = ?1 AND a.kind = 'diff' AND a.artifact_id = ?2",
                    params![session_id, artifact_id],
                    read_diff_artifact_blob_row,
                )
                .optional()?
            } else if let Some(patch_ref) = patch_ref {
                conn.query_row(
                    "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                            b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                            a.status
                     FROM artifact_record a
                     JOIN tool_result_blob b ON b.result_ref = a.content_ref
                     WHERE a.session_id = ?1 AND a.kind = 'diff' AND a.content_ref = ?2
                     ORDER BY CASE WHEN a.status = 'created' THEN 0 ELSE 1 END, a.created_at_ms ASC
                     LIMIT 1",
                    params![session_id, patch_ref],
                    read_diff_artifact_blob_row,
                )
                .optional()?
            } else {
                None
            };
            let Some(mut row) = row else {
                return Ok(None);
            };
            row.evidence_id = read_evidence_id_for_artifact(conn, session_id, &row.artifact_id)?;
            Ok(Some(row))
        })
        .context("failed to read AI diff artifact")
    }

    pub fn find_applied_patch_artifact(
        &self,
        session_id: &str,
        source_artifact_id: &str,
        patch_ref: &str,
    ) -> Result<Option<DiffArtifactBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                        b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                        a.status
                 FROM artifact_record a
                 JOIN tool_result_blob b ON b.result_ref = a.content_ref
                 WHERE a.session_id = ?1
                   AND a.kind = 'diff'
                   AND a.status IN ('applied', 'rolled_back')
                 ORDER BY a.created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id], read_diff_artifact_blob_row)?;
            for row in rows {
                let mut record = row?;
                let metadata_patch_ref = record.metadata.get("patchRef").and_then(Value::as_str);
                let metadata_source_artifact_id = record
                    .metadata
                    .get("appliedFromArtifactId")
                    .and_then(Value::as_str);
                if record.content_ref == patch_ref
                    || metadata_patch_ref == Some(patch_ref)
                    || metadata_source_artifact_id == Some(source_artifact_id)
                {
                    record.evidence_id =
                        read_evidence_id_for_artifact(conn, session_id, &record.artifact_id)?;
                    return Ok(Some(record));
                }
            }
            Ok(None)
        })
    }

    pub fn read_patch_artifact_record(
        &self,
        session_id: &str,
        artifact_id: &str,
    ) -> Result<Option<DiffArtifactBlobRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut row = conn
                .query_row(
                    "SELECT a.artifact_id, a.runtime_turn_id, a.title, a.content_ref, a.metadata_json,
                            b.content_json, b.content_sha256, b.content_bytes, a.created_at_ms,
                            a.status
                     FROM artifact_record a
                     JOIN tool_result_blob b ON b.result_ref = a.content_ref
                     WHERE a.session_id = ?1 AND a.kind = 'diff' AND a.artifact_id = ?2",
                    params![session_id, artifact_id],
                    read_diff_artifact_blob_row,
                )
                .optional()?;
            if let Some(row) = row.as_mut() {
                row.evidence_id = read_evidence_id_for_artifact(conn, session_id, &row.artifact_id)?;
            }
            Ok(row)
        })
    }

    pub fn update_artifact_status(
        &self,
        session_id: &str,
        artifact_id: &str,
        status: &str,
    ) -> Result<()> {
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let rows = conn.execute(
                "UPDATE artifact_record
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE session_id = ?4 AND artifact_id = ?5",
                params![status, updated_at, updated_iso, session_id, artifact_id],
            )?;
            if rows == 0 {
                return Err(anyhow!("artifact not found: {artifact_id}"));
            }
            Ok(())
        })
    }
}
