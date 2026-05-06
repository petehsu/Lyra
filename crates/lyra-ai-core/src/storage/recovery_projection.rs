use super::*;

impl AiStore {
    pub fn append_side_effect_record(&self, input: SideEffectRecordInput) -> Result<String> {
        let now = now_ms();
        let now_iso = now_iso();
        let side_effect_id = new_id("side_effect");
        self.with_session_conn(&input.session_id, |conn| {
            conn.execute(
                "INSERT INTO side_effect_record (
                    side_effect_id, session_id, runtime_turn_id, user_message_id,
                    tool_operation_id, kind, target_ref, rollback_status, evidence_ref,
                    follow_target_id, artifact_refs_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    side_effect_id,
                    input.session_id,
                    input.runtime_turn_id,
                    input.user_message_id,
                    input.tool_operation_id,
                    input.kind,
                    input.target_ref,
                    input.rollback_status,
                    input.evidence_ref,
                    input.follow_target_id,
                    serde_json::to_string(&input.artifact_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(side_effect_id)
    }

    #[cfg(test)]
    pub fn count_side_effects_for_test(&self, session_id: &str) -> Result<i64> {
        self.count_rows_for_test(session_id, "side_effect_record")
    }

    #[cfg(test)]
    pub fn latest_side_effect_kind_for_test(&self, session_id: &str) -> Result<Option<String>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT kind FROM side_effect_record ORDER BY created_at_ms DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .context("failed to read latest side effect kind")
        })
    }
}
