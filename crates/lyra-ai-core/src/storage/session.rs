use super::*;

impl AiStore {
    pub fn upsert_session_index(&self, session: &AgentSession) -> Result<()> {
        self.with_index_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_session_index (
                    id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    profile_id = excluded.profile_id,
                    project_root = excluded.project_root,
                    project_name = excluded.project_name,
                    collaboration_mode = excluded.collaboration_mode,
                    updated_at = excluded.updated_at",
                params![
                    session.id,
                    session.title,
                    session.profile_id,
                    session.project_root,
                    session.project_name,
                    session.collaboration_mode,
                    session.created_at,
                    session.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<AgentSession>> {
        self.with_index_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
                 FROM agent_session_index ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], read_session_index_row)?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_session_index(&self, session_id: &str) -> Result<Option<AgentSession>> {
        self.with_index_conn(|conn| {
            conn.query_row(
                "SELECT id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
                 FROM agent_session_index WHERE id = ?1",
                params![session_id],
                read_session_index_row,
            )
            .optional()
            .context("failed to read AI session index")
        })
    }

    pub fn append_message(&self, message: &AgentMessage) -> Result<()> {
        let created_iso = now_iso();
        let updated_ms = now_ms();
        let turn_index = self.next_turn_index(&message.session_id)?;
        self.with_session_conn(&message.session_id, |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO session_dialog (
                    msg_id, turn_index, role, content_raw, content_parts_json, token_count, char_count,
                    created_at_ms, created_at_iso, updated_at_ms, metadata_json, stream_id, turn_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10, NULL, ?11)",
                params![
                    message.id,
                    turn_index,
                    message.role,
                    message.content,
                    message
                        .content_parts
                        .as_ref()
                        .map(json_string)
                        .transpose()?,
                    message.content.chars().count() as i64,
                    message.created_at,
                    created_iso,
                    updated_ms,
                    json!({}).to_string(),
                    message.turn_id,
                ],
            )?;
            Ok(())
        })
    }

    fn next_turn_index(&self, session_id: &str) -> Result<i64> {
        self.with_session_conn(session_id, |conn| {
            let index: Option<i64> = conn
                .query_row("SELECT MAX(turn_index) FROM session_dialog", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();
            Ok(index.unwrap_or(0) + 1)
        })
    }

    pub fn append_or_update_assistant_message(
        &self,
        session_id: &str,
        turn_id: &str,
        content: &str,
    ) -> Result<String> {
        let existing: Option<String> = self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT msg_id FROM session_dialog WHERE turn_id = ?1 AND role = 'assistant' LIMIT 1",
                params![turn_id],
                |row| row.get(0),
            )
            .optional()
            .context("failed to read assistant message")
        })?;
        let msg_id = existing.unwrap_or_else(|| new_id("msg"));
        let created_at = now_ms();
        let created_iso = now_iso();
        let turn_index = self.next_turn_index(session_id)?;
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO session_dialog (
                    msg_id, turn_index, role, content_raw, content_parts_json, token_count, char_count,
                    created_at_ms, created_at_iso, updated_at_ms, metadata_json, stream_id, turn_id
                 ) VALUES (?1, ?2, 'assistant', ?3, NULL, 0, ?4, ?5, ?6, ?5, ?7, NULL, ?8)
                 ON CONFLICT(msg_id) DO UPDATE SET
                    content_raw = excluded.content_raw,
                    char_count = excluded.char_count,
                    updated_at_ms = excluded.updated_at_ms",
                params![
                    msg_id,
                    turn_index,
                    content,
                    content.chars().count() as i64,
                    created_at,
                    created_iso,
                    json!({}).to_string(),
                    turn_id
                ],
            )?;
            Ok(())
        })?;
        Ok(msg_id)
    }

    pub fn insert_turn(
        &self,
        turn: &AgentTurn,
        user_message_id: &str,
        policy_ref: Option<&str>,
    ) -> Result<()> {
        let created_iso = now_iso();
        self.with_session_conn(&turn.session_id, |conn| {
            conn.execute(
                "INSERT INTO runtime_turn (
                    runtime_turn_id, session_id, user_message_id, profile_id, status, current_state,
                    collaboration_mode, project_policy_snapshot_id, created_at_ms, created_at_iso,
                    updated_at_ms, error_code, error_message, usage_json, permission_mode
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'user_message_received', ?6, ?7, ?8, ?9, ?10, NULL, NULL, NULL, ?11)",
                params![
                    turn.id,
                    turn.session_id,
                    user_message_id,
                    turn.profile_id,
                    turn.status,
                    turn.collaboration_mode.as_deref(),
                    policy_ref,
                    turn.created_at,
                    created_iso,
                    turn.updated_at,
                    turn.permission_mode,
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_turn_status(
        &self,
        session_id: &str,
        turn_id: &str,
        status: &str,
        current_state: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let updated_at = now_ms();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE runtime_turn
                 SET status = ?1, current_state = ?2, updated_at_ms = ?3, error_code = ?4, error_message = ?5
                 WHERE runtime_turn_id = ?6",
                params![status, current_state, updated_at, error_code, error_message, turn_id],
            )?;
            Ok(())
        })
    }

    pub fn append_event(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        event_type: &str,
        payload: Value,
    ) -> Result<RuntimeStreamEvent> {
        let sequence = self.with_session_conn(session_id, |conn| {
            let max_sequence: Option<i64> = conn
                .query_row("SELECT MAX(sequence) FROM runtime_event", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();
            Ok(max_sequence.unwrap_or(0) + 1)
        })?;
        let created_at = now_iso();
        let event = RuntimeStreamEvent::new(
            sequence,
            session_id.to_string(),
            turn_id.map(ToString::to_string),
            event_type,
            payload,
            created_at.clone(),
        );
        let created_ms = now_ms();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO runtime_event (
                    event_id, sequence, session_id, runtime_turn_id, event_type, payload_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    event.event_id,
                    event.sequence,
                    event.session_id,
                    event.runtime_turn_id,
                    event.event_type,
                    event.payload.to_string(),
                    created_ms,
                    created_at,
                ],
            )?;
            Ok(())
        })?;
        Ok(event)
    }

    pub fn create_timeline_checkpoint(
        &self,
        session_id: &str,
        turn_id: &str,
        user_message_id: &str,
    ) -> Result<String> {
        let checkpoint_id = new_id("checkpoint");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT msg_id FROM session_dialog ORDER BY created_at_ms ASC, turn_index ASC",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut visible_message_ids = Vec::new();
            for row in rows {
                visible_message_ids.push(row?);
            }
            conn.execute(
                "INSERT INTO timeline_checkpoint (
                    checkpoint_id, session_id, runtime_turn_id, user_message_id,
                    conversation_snapshot_json, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    checkpoint_id,
                    session_id,
                    turn_id,
                    user_message_id,
                    json!({
                        "schemaVersion": "v1",
                        "visibleMessageIds": visible_message_ids,
                        "activeCursorMessageId": user_message_id,
                        "createdBeforeAgentResponse": true
                    })
                    .to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(checkpoint_id)
    }

    pub fn read_session_detail(&self, session_id: &str) -> Result<Option<AgentSessionDetail>> {
        let Some(session) = self.read_session_index(session_id)? else {
            return Ok(None);
        };
        let turns = self.read_turns(session_id)?;
        let messages = self.read_messages(session_id)?;
        let runtime_events = self.read_runtime_events(session_id)?;
        let pending_interactions = self.read_pending_approval_interactions(session_id)?;
        let planning_summary = self.read_planning_summary(session_id)?;
        let plan_coverage_summary = self.read_plan_coverage_summary(session_id)?;
        let active_todo = self.read_active_todo_list(session_id)?;
        let execution_summary = self.read_execution_summary(session_id)?;
        let verification_summary = self.read_verification_summary(session_id)?;
        let completion_audit = self.read_completion_audit_summary(session_id)?;
        let delivery_proof = self.read_delivery_proof_summary(session_id)?;
        Ok(Some(AgentSessionDetail {
            session,
            pending_interactions,
            turns,
            messages,
            runtime_events,
            planning_summary,
            plan_coverage_summary,
            active_todo,
            execution_summary,
            verification_summary,
            completion_audit,
            delivery_proof,
        }))
    }

    pub fn read_turns(&self, session_id: &str) -> Result<Vec<AgentTurn>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT runtime_turn_id, session_id, profile_id, status, collaboration_mode,
                        permission_mode, error_code, error_message, usage_json, created_at_ms, updated_at_ms
                 FROM runtime_turn ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let usage_json: Option<String> = row.get(8)?;
                Ok(AgentTurn {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    profile_id: row.get(2)?,
                    status: row.get(3)?,
                    collaboration_mode: row.get(4)?,
                    permission_mode: row.get(5)?,
                    error_code: row.get(6)?,
                    error_message: row.get(7)?,
                    usage: usage_json.and_then(|value| serde_json::from_str(&value).ok()),
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_messages(&self, session_id: &str) -> Result<Vec<AgentMessage>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT msg_id, role, content_raw, content_parts_json, created_at_ms, turn_id
                 FROM session_dialog ORDER BY created_at_ms ASC, turn_index ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let content_parts_json: Option<String> = row.get(3)?;
                let content: String = row.get(2)?;
                Ok(AgentMessage {
                    id: row.get(0)?,
                    session_id: session_id.to_string(),
                    turn_id: row.get(5)?,
                    role: row.get(1)?,
                    display_content: Some(content.clone()),
                    content,
                    content_parts: content_parts_json
                        .and_then(|value| serde_json::from_str(&value).ok()),
                    created_at: row.get(4)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_pending_approval_interactions(&self, session_id: &str) -> Result<Vec<Value>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, session_id, runtime_turn_id, status, approval_mode,
                        title, risk_summary_json, impact_scope_json, requested_action_json,
                        created_at_ms, updated_at_ms
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = 'pending_user'
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id], |row| {
                let risk_json: String = row.get(6)?;
                let impact_json: String = row.get(7)?;
                let requested_json: String = row.get(8)?;
                let approval_ticket_id: String = row.get(0)?;
                let approval_mode: String = row.get(4)?;
                let title: String = row.get(5)?;
                let risk_summary: Value =
                    serde_json::from_str(&risk_json).unwrap_or_else(|_| json!({}));
                let impact_scope: Value =
                    serde_json::from_str(&impact_json).unwrap_or_else(|_| json!({}));
                let requested_action: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                let tool_path = requested_action
                    .get("toolPath")
                    .cloned()
                    .unwrap_or(Value::Null);
                let artifact_id = requested_action
                    .get("artifactId")
                    .or_else(|| requested_action.get("appliedArtifactId"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let patch_ref = requested_action
                    .get("patchRef")
                    .cloned()
                    .unwrap_or(Value::Null);
                Ok(json!({
                    "id": approval_ticket_id,
                    "sessionId": row.get::<_, String>(1)?,
                    "turnId": row.get::<_, String>(2)?,
                    "kind": "tool_approval",
                    "status": "pending",
                    "payload": {
                        "approvalTicketId": approval_ticket_id,
                        "toolPath": tool_path,
                        "artifactId": artifact_id,
                        "patchRef": patch_ref,
                        "riskSummary": risk_summary,
                        "impactScope": impact_scope,
                        "requestedAction": requested_action,
                        "approvalMode": approval_mode,
                        "title": title
                    },
                    "createdAt": row.get::<_, i64>(9)?,
                    "updatedAt": row.get::<_, i64>(10)?,
                }))
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn read_runtime_events(&self, session_id: &str) -> Result<Vec<AgentRuntimeEvent>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT session_id, runtime_turn_id, event_type, payload_json, created_at_ms
                 FROM runtime_event ORDER BY sequence ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let payload_json: String = row.get(3)?;
                Ok(AgentRuntimeEvent {
                    session_id: row.get(0)?,
                    turn_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    phase: row.get(2)?,
                    payload: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
                    timestamp: row.get(4)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }
}
