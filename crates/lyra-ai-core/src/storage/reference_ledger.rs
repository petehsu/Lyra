use super::*;

impl AiStore {
    pub fn create_inline_reference(
        &self,
        input: CreateInlineReferenceInput,
    ) -> Result<InlineReference> {
        let now = now_ms();
        let now_iso = now_iso();
        let reference = InlineReference {
            inline_reference_id: new_id("inline_reference"),
            session_id: input.session_id,
            runtime_turn_id: input.runtime_turn_id,
            user_message_id: input.user_message_id,
            kind: input.kind,
            target_ref: input.target_ref,
            label: input.label,
            anchor: input.anchor,
            status: "active".to_string(),
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&reference.session_id, |conn| {
            conn.execute(
                "INSERT INTO inline_reference (
                    inline_reference_id, session_id, runtime_turn_id, user_message_id,
                    kind, target_ref, label, anchor_json, insertion_index, char_start,
                    char_end, source_part_index, status, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?14, ?15)",
                params![
                    reference.inline_reference_id,
                    reference.session_id,
                    reference.runtime_turn_id,
                    reference.user_message_id,
                    reference.kind,
                    reference.target_ref,
                    reference.label,
                    json_string(&reference.anchor)?,
                    reference.anchor.insertion_index,
                    reference.anchor.char_start,
                    reference.anchor.char_end,
                    reference.anchor.source_part_index,
                    reference.status,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(reference)
    }

    pub fn create_reference_resolution(
        &self,
        input: CreateReferenceResolutionInput,
    ) -> Result<ReferenceResolution> {
        let now = now_ms();
        let now_iso = now_iso();
        let resolution = ReferenceResolution {
            resolution_id: new_id("reference_resolution"),
            inline_reference_id: input.inline_reference_id,
            session_id: input.session_id,
            runtime_turn_id: input.runtime_turn_id,
            kind: input.kind,
            target_ref: input.target_ref,
            status: input.status,
            resolved_ref: input.resolved_ref,
            content_hash: input.content_hash,
            content_bytes: input.content_bytes,
            reason: input.reason,
            metadata: input.metadata,
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&resolution.session_id, |conn| {
            conn.execute(
                "INSERT INTO reference_resolution (
                    resolution_id, inline_reference_id, session_id, runtime_turn_id, kind,
                    target_ref, status, resolved_ref, content_hash, content_bytes, reason,
                    metadata_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?13, ?14)",
                params![
                    resolution.resolution_id,
                    resolution.inline_reference_id,
                    resolution.session_id,
                    resolution.runtime_turn_id,
                    resolution.kind,
                    resolution.target_ref,
                    resolution.status,
                    resolution.resolved_ref,
                    resolution.content_hash,
                    resolution.content_bytes,
                    resolution.reason,
                    resolution.metadata.to_string(),
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(resolution)
    }

    pub fn read_reference_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentReferenceSummary>> {
        self.with_session_conn(session_id, |conn| {
            let references = read_recent_inline_references_from_conn(conn, session_id, 8)?;
            if references.is_empty() {
                return Ok(None);
            }
            let resolutions = read_recent_reference_resolutions_from_conn(conn, session_id, 8)?;
            let resolved = resolutions
                .iter()
                .filter(|resolution| resolution.status == "resolved")
                .count();
            let unresolved = resolutions.len().saturating_sub(resolved);
            let updated_at = references
                .iter()
                .map(|reference| reference.updated_at)
                .chain(resolutions.iter().map(|resolution| resolution.updated_at))
                .max()
                .unwrap_or(0);
            Ok(Some(AgentReferenceSummary {
                total: references.len(),
                resolved,
                unresolved,
                references,
                resolutions,
                updated_at,
            }))
        })
    }

    #[cfg(test)]
    pub fn read_reference_resolutions_for_test(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReferenceResolution>> {
        self.with_session_conn(session_id, |conn| {
            read_recent_reference_resolutions_from_conn(conn, session_id, 100)
        })
    }
}

fn read_recent_inline_references_from_conn(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<InlineReference>> {
    let mut stmt = conn.prepare(
        "SELECT inline_reference_id, session_id, runtime_turn_id, user_message_id,
                kind, target_ref, label, anchor_json, status, created_at_ms, updated_at_ms
         FROM inline_reference
         WHERE session_id = ?1 AND status != 'superseded_by_rollback'
         ORDER BY created_at_ms DESC, insertion_index ASC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![session_id, limit as i64], |row| {
        let anchor_json: String = row.get(7)?;
        Ok(InlineReference {
            inline_reference_id: row.get(0)?,
            session_id: row.get(1)?,
            runtime_turn_id: row.get(2)?,
            user_message_id: row.get(3)?,
            kind: row.get(4)?,
            target_ref: row.get(5)?,
            label: row.get(6)?,
            anchor: serde_json::from_str(&anchor_json).unwrap_or(ReferenceAnchor {
                insertion_index: 0,
                char_start: 0,
                char_end: 0,
                source_part_index: 0,
            }),
            status: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    result.sort_by_key(|reference| reference.anchor.insertion_index);
    Ok(result)
}

fn read_recent_reference_resolutions_from_conn(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<ReferenceResolution>> {
    let mut stmt = conn.prepare(
        "SELECT resolution_id, inline_reference_id, session_id, runtime_turn_id,
                kind, target_ref, status, resolved_ref, content_hash, content_bytes,
                reason, metadata_json, created_at_ms, updated_at_ms
         FROM reference_resolution
         WHERE session_id = ?1 AND status != 'superseded_by_rollback'
         ORDER BY created_at_ms DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![session_id, limit as i64], |row| {
        let metadata_json: String = row.get(11)?;
        Ok(ReferenceResolution {
            resolution_id: row.get(0)?,
            inline_reference_id: row.get(1)?,
            session_id: row.get(2)?,
            runtime_turn_id: row.get(3)?,
            kind: row.get(4)?,
            target_ref: row.get(5)?,
            status: row.get(6)?,
            resolved_ref: row.get(7)?,
            content_hash: row.get(8)?,
            content_bytes: row.get(9)?,
            reason: row.get(10)?,
            metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({})),
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    result.reverse();
    Ok(result)
}
