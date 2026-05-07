use super::*;

impl AiStore {
    pub fn create_user_intent_envelope(
        &self,
        input: CreateIntentEnvelopeInput,
    ) -> Result<UserIntentEnvelope> {
        let now = now_ms();
        let now_iso = now_iso();
        let envelope = UserIntentEnvelope {
            intent_id: new_id("intent"),
            session_id: input.session_id,
            conversation_id: input.conversation_id,
            user_message_id: input.user_message_id,
            runtime_turn_id: input.runtime_turn_id,
            kind: input.kind,
            confidence: input.confidence,
            mode_candidate: input.mode_candidate,
            source_message_ref: input.source_message_ref,
            ui_action_id: input.ui_action_id,
            raw_text_ref: input.raw_text_ref,
            segment_refs: input.segment_refs,
            inline_reference_ids: input.inline_reference_ids,
            constraints: input.constraints,
            classification_evidence_refs: input.classification_evidence_refs,
            ambiguity_flags: input.ambiguity_flags,
            status: "active".to_string(),
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&envelope.session_id, |conn| {
            conn.execute(
                "INSERT INTO user_intent_envelope (
                    intent_id, session_id, conversation_id, user_message_id, runtime_turn_id,
                    kind, confidence, mode_candidate, source_message_ref, ui_action_id,
                    raw_text_ref, segment_refs_json, inline_reference_ids_json, constraints_json,
                    classification_evidence_refs_json, ambiguity_flags_json, status,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?18, ?19)",
                params![
                    envelope.intent_id,
                    envelope.session_id,
                    envelope.conversation_id,
                    envelope.user_message_id,
                    envelope.runtime_turn_id,
                    envelope.kind,
                    envelope.confidence,
                    envelope.mode_candidate,
                    envelope.source_message_ref,
                    envelope.ui_action_id,
                    envelope.raw_text_ref,
                    json_string(&envelope.segment_refs)?,
                    json_string(&envelope.inline_reference_ids)?,
                    envelope.constraints.to_string(),
                    json_string(&envelope.classification_evidence_refs)?,
                    json_string(&envelope.ambiguity_flags)?,
                    envelope.status,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(envelope)
    }

    pub fn create_intent_target_binding(
        &self,
        input: CreateIntentTargetBindingInput,
    ) -> Result<IntentTargetBinding> {
        let now = now_ms();
        let now_iso = now_iso();
        let binding = IntentTargetBinding {
            binding_id: new_id("intent_binding"),
            intent_id: input.intent_id,
            session_id: input.session_id,
            runtime_turn_id: input.runtime_turn_id,
            target_kind: input.target_kind,
            target_id: input.target_id,
            freshness_status: input.freshness_status,
            confidence: input.confidence,
            status: "active".to_string(),
            evidence_refs: input.evidence_refs,
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&binding.session_id, |conn| {
            conn.execute(
                "INSERT INTO intent_target_binding (
                    binding_id, intent_id, session_id, runtime_turn_id, target_kind, target_id,
                    freshness_status, confidence, status, evidence_refs_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11, ?12)",
                params![
                    binding.binding_id,
                    binding.intent_id,
                    binding.session_id,
                    binding.runtime_turn_id,
                    binding.target_kind,
                    binding.target_id,
                    binding.freshness_status,
                    binding.confidence,
                    binding.status,
                    json_string(&binding.evidence_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(binding)
    }

    pub fn create_runtime_decision_record(
        &self,
        input: CreateRuntimeDecisionRecordInput,
    ) -> Result<RuntimeDecisionRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = RuntimeDecisionRecord {
            decision_id: new_id("runtime_decision"),
            session_id: input.session_id,
            runtime_turn_id: input.runtime_turn_id,
            user_message_id: input.user_message_id,
            intent_id: input.intent_id,
            kind: input.kind,
            status: input.status,
            summary: input.summary,
            reason: input.reason,
            evidence_refs: input.evidence_refs,
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO runtime_decision_record (
                    decision_id, session_id, runtime_turn_id, user_message_id, intent_id,
                    kind, status, summary, reason_json, evidence_refs_json,
                    created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    record.decision_id,
                    record.session_id,
                    record.runtime_turn_id,
                    record.user_message_id,
                    record.intent_id,
                    record.kind,
                    record.status,
                    record.summary,
                    record.reason.to_string(),
                    json_string(&record.evidence_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn read_latest_intent_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentIntentSummary>> {
        self.with_session_conn(session_id, |conn| {
            let Some(envelope) = conn
                .query_row(
                    "SELECT intent_id, session_id, conversation_id, user_message_id,
                            runtime_turn_id, kind, confidence, mode_candidate,
                            source_message_ref, ui_action_id, raw_text_ref, segment_refs_json,
                            inline_reference_ids_json, constraints_json,
                            classification_evidence_refs_json, ambiguity_flags_json,
                            status, created_at_ms, updated_at_ms
                     FROM user_intent_envelope
                     WHERE session_id = ?1 AND status != 'superseded_by_rollback'
                     ORDER BY created_at_ms DESC
                     LIMIT 1",
                    params![session_id],
                    read_user_intent_envelope_row,
                )
                .optional()?
            else {
                return Ok(None);
            };
            let target_bindings = read_intent_target_bindings_from_conn(conn, &envelope.intent_id)?;
            let recent_decisions = read_recent_runtime_decisions_from_conn(conn, session_id, 6)?;
            Ok(Some(AgentIntentSummary {
                intent_id: envelope.intent_id,
                kind: envelope.kind,
                confidence: envelope.confidence,
                mode_candidate: envelope.mode_candidate,
                target_bindings,
                ambiguity_flags: envelope.ambiguity_flags,
                recent_decisions,
                updated_at: envelope.updated_at,
            }))
        })
    }

    #[cfg(test)]
    pub fn read_user_intent_envelopes_for_test(
        &self,
        session_id: &str,
    ) -> Result<Vec<UserIntentEnvelope>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT intent_id, session_id, conversation_id, user_message_id,
                        runtime_turn_id, kind, confidence, mode_candidate,
                        source_message_ref, ui_action_id, raw_text_ref, segment_refs_json,
                        inline_reference_ids_json, constraints_json,
                        classification_evidence_refs_json, ambiguity_flags_json,
                        status, created_at_ms, updated_at_ms
                 FROM user_intent_envelope
                 WHERE session_id = ?1
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id], read_user_intent_envelope_row)?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }
}

fn read_user_intent_envelope_row(row: &Row<'_>) -> rusqlite::Result<UserIntentEnvelope> {
    let segment_refs_json: String = row.get(11)?;
    let inline_reference_ids_json: String = row.get(12)?;
    let constraints_json: String = row.get(13)?;
    let classification_evidence_refs_json: String = row.get(14)?;
    let ambiguity_flags_json: String = row.get(15)?;
    Ok(UserIntentEnvelope {
        intent_id: row.get(0)?,
        session_id: row.get(1)?,
        conversation_id: row.get(2)?,
        user_message_id: row.get(3)?,
        runtime_turn_id: row.get(4)?,
        kind: row.get(5)?,
        confidence: row.get(6)?,
        mode_candidate: row.get(7)?,
        source_message_ref: row.get(8)?,
        ui_action_id: row.get(9)?,
        raw_text_ref: row.get(10)?,
        segment_refs: parse_json_vec_string(&segment_refs_json),
        inline_reference_ids: parse_json_vec_string(&inline_reference_ids_json),
        constraints: serde_json::from_str(&constraints_json).unwrap_or_else(|_| json!({})),
        classification_evidence_refs: parse_json_vec_string(&classification_evidence_refs_json),
        ambiguity_flags: serde_json::from_str(&ambiguity_flags_json).unwrap_or_default(),
        status: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

fn read_intent_target_bindings_from_conn(
    conn: &Connection,
    intent_id: &str,
) -> Result<Vec<IntentTargetBinding>> {
    let mut stmt = conn.prepare(
        "SELECT binding_id, intent_id, session_id, runtime_turn_id, target_kind, target_id,
                freshness_status, confidence, status, evidence_refs_json, created_at_ms, updated_at_ms
         FROM intent_target_binding
         WHERE intent_id = ?1 AND status != 'superseded_by_rollback'
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![intent_id], |row| {
        let evidence_refs_json: String = row.get(9)?;
        Ok(IntentTargetBinding {
            binding_id: row.get(0)?,
            intent_id: row.get(1)?,
            session_id: row.get(2)?,
            runtime_turn_id: row.get(3)?,
            target_kind: row.get(4)?,
            target_id: row.get(5)?,
            freshness_status: row.get(6)?,
            confidence: row.get(7)?,
            status: row.get(8)?,
            evidence_refs: parse_json_vec_string(&evidence_refs_json),
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_recent_runtime_decisions_from_conn(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<RuntimeDecisionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT decision_id, session_id, runtime_turn_id, user_message_id, intent_id,
                kind, status, summary, reason_json, evidence_refs_json, created_at_ms
         FROM runtime_decision_record
         WHERE session_id = ?1
         ORDER BY created_at_ms DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![session_id, limit as i64], |row| {
        let reason_json: String = row.get(8)?;
        let evidence_refs_json: String = row.get(9)?;
        Ok(RuntimeDecisionRecord {
            decision_id: row.get(0)?,
            session_id: row.get(1)?,
            runtime_turn_id: row.get(2)?,
            user_message_id: row.get(3)?,
            intent_id: row.get(4)?,
            kind: row.get(5)?,
            status: row.get(6)?,
            summary: row.get(7)?,
            reason: serde_json::from_str(&reason_json).unwrap_or_else(|_| json!({})),
            evidence_refs: parse_json_vec_string(&evidence_refs_json),
            created_at: row.get(10)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}
