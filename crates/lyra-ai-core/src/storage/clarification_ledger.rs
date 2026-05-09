use super::*;

impl AiStore {
    pub fn create_question_ticket(
        &self,
        input: CreateQuestionTicketInput,
    ) -> Result<QuestionTicket> {
        if input.options.len() != 4
            || input
                .options
                .iter()
                .map(|option| option.id.as_str())
                .collect::<Vec<_>>()
                != ["A", "B", "C", "D"]
        {
            return Err(anyhow!("QuestionTicket options must be exactly A/B/C/D"));
        }
        let now = now_ms();
        let now_iso = now_iso();
        let ticket = QuestionTicket {
            question_ticket_id: new_id("question_ticket"),
            session_id: input.session_id,
            runtime_turn_id: input.runtime_turn_id,
            user_message_id: input.user_message_id,
            intent_id: input.intent_id,
            status: "open".to_string(),
            blocking_level: input.blocking_level,
            title: input.title,
            question: input.question,
            why: input.why,
            target_summary: input.target_summary,
            options: input.options,
            allow_custom_answer: input.allow_custom_answer,
            selected_option_id: None,
            answer_text: None,
            related_ids: input.related_ids,
            target_bindings: input.target_bindings,
            created_at: now,
            updated_at: now,
            answered_at: None,
        };
        self.with_session_conn(&ticket.session_id, |conn| {
            conn.execute(
                "INSERT INTO question_ticket (
                    question_ticket_id, session_id, runtime_turn_id, user_message_id,
                    intent_id, status, blocking_level, title, question, why, target_summary,
                    options_json, allow_custom_answer, selected_option_id, answer_text,
                    answer_source, related_ids_json, target_bindings_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso, answered_at_ms,
                    answered_at_iso, superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, NULL, ?13, ?14, ?15, ?16, ?15, ?16, NULL, NULL, NULL)",
                params![
                    ticket.question_ticket_id,
                    ticket.session_id,
                    ticket.runtime_turn_id,
                    ticket.user_message_id,
                    ticket.intent_id,
                    ticket.blocking_level,
                    ticket.title,
                    ticket.question,
                    ticket.why,
                    ticket.target_summary,
                    json_string(&ticket.options)?,
                    if ticket.allow_custom_answer { 1 } else { 0 },
                    json_string(&ticket.related_ids)?,
                    ticket.target_bindings.to_string(),
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(ticket)
    }

    pub fn create_assumption_record(
        &self,
        input: CreateAssumptionRecordInput,
    ) -> Result<AssumptionRecord> {
        if input.risk_level == "high" || input.risk_level == "critical" {
            return Err(anyhow!("high-risk assumptions are forbidden"));
        }
        let now = now_ms();
        let now_iso = now_iso();
        let assumption = AssumptionRecord {
            assumption_id: new_id("assumption"),
            session_id: input.session_id,
            runtime_turn_id: input.runtime_turn_id,
            user_message_id: input.user_message_id,
            intent_id: input.intent_id,
            status: "active".to_string(),
            statement: input.statement,
            basis: input.basis,
            risk_level: input.risk_level,
            reversible: input.reversible,
            source_refs: input.source_refs,
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&assumption.session_id, |conn| {
            conn.execute(
                "INSERT INTO assumption_record (
                    assumption_id, session_id, runtime_turn_id, user_message_id,
                    intent_id, status, statement, basis, risk_level, reversible,
                    source_refs_json, created_at_ms, created_at_iso, updated_at_ms,
                    updated_at_iso, superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11, ?12, NULL)",
                params![
                    assumption.assumption_id,
                    assumption.session_id,
                    assumption.runtime_turn_id,
                    assumption.user_message_id,
                    assumption.intent_id,
                    assumption.statement,
                    assumption.basis,
                    assumption.risk_level,
                    if assumption.reversible { 1 } else { 0 },
                    json_string(&assumption.source_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(assumption)
    }

    pub fn resolve_question_ticket(
        &self,
        session_id: &str,
        question_ticket_id: &str,
        selected_option_id: Option<&str>,
        custom_answer: Option<&str>,
        answer_text: Option<&str>,
    ) -> Result<QuestionTicket> {
        let now = now_ms();
        let now_iso = now_iso();
        let selected = selected_option_id.and_then(trim_to_string);
        if let Some(value) = selected.as_deref() {
            if !matches!(value, "A" | "B" | "C" | "D") {
                return Err(anyhow!("selectedOptionId must be A, B, C, or D"));
            }
        }
        let answer = answer_text
            .and_then(trim_to_string)
            .or_else(|| custom_answer.and_then(trim_to_string))
            .or_else(|| selected.clone());
        let Some(answer) = answer else {
            return Err(anyhow!("clarification answer is required"));
        };
        self.with_session_conn(session_id, |conn| {
            let existing_status: Option<String> = conn
                .query_row(
                    "SELECT status FROM question_ticket
                     WHERE session_id = ?1 AND question_ticket_id = ?2",
                    params![session_id, question_ticket_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(status) = existing_status else {
                return Err(anyhow!("question ticket not found: {question_ticket_id}"));
            };
            if status != "open" {
                return Err(anyhow!("question ticket is not open: {status}"));
            }
            conn.execute(
                "UPDATE question_ticket
                 SET status = 'answered',
                     selected_option_id = ?1,
                     answer_text = ?2,
                     answer_source = ?3,
                     updated_at_ms = ?4,
                     updated_at_iso = ?5,
                     answered_at_ms = ?4,
                     answered_at_iso = ?5
                 WHERE session_id = ?6 AND question_ticket_id = ?7",
                params![
                    selected,
                    answer,
                    if custom_answer.and_then(trim_to_string).is_some() {
                        "custom"
                    } else {
                        "option"
                    },
                    now,
                    now_iso,
                    session_id,
                    question_ticket_id,
                ],
            )?;
            Ok(())
        })?;
        self.read_question_ticket(session_id, question_ticket_id)?
            .ok_or_else(|| anyhow!("question ticket not found after resolve: {question_ticket_id}"))
    }

    pub fn read_question_ticket(
        &self,
        session_id: &str,
        question_ticket_id: &str,
    ) -> Result<Option<QuestionTicket>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT question_ticket_id, session_id, runtime_turn_id, user_message_id,
                        intent_id, status, blocking_level, title, question, why, target_summary,
                        options_json, allow_custom_answer, selected_option_id, answer_text,
                        related_ids_json, target_bindings_json, created_at_ms, updated_at_ms,
                        answered_at_ms
                 FROM question_ticket
                 WHERE session_id = ?1 AND question_ticket_id = ?2",
                params![session_id, question_ticket_id],
                read_question_ticket_row,
            )
            .optional()
            .context("failed to read question ticket")
        })
    }

    pub fn read_pending_clarification_interactions(&self, session_id: &str) -> Result<Vec<Value>> {
        self.with_session_conn(session_id, |conn| {
            let tickets = read_question_tickets_by_status_from_conn(conn, session_id, "open", 12)?;
            let mut groups: Vec<(String, Value, Vec<QuestionTicket>)> = Vec::new();
            for ticket in tickets {
                let panel = ticket
                    .target_bindings
                    .get("panel")
                    .cloned()
                    .unwrap_or_else(|| default_panel_payload_for_ticket(&ticket));
                let panel_id = ticket
                    .target_bindings
                    .get("panelId")
                    .or_else(|| panel.get("panelId"))
                    .and_then(Value::as_str)
                    .and_then(trim_to_string)
                    .unwrap_or_else(|| ticket.question_ticket_id.clone());
                if let Some((_, _, group_tickets)) =
                    groups.iter_mut().find(|(id, _, _)| id == &panel_id)
                {
                    group_tickets.push(ticket);
                } else {
                    groups.push((panel_id, panel, vec![ticket]));
                }
            }
            Ok(groups
                .into_iter()
                .filter_map(|(panel_id, panel, tickets)| {
                    let first = tickets.first()?;
                    let questions = tickets
                        .iter()
                        .map(question_payload)
                        .collect::<Vec<_>>();
                    let title = panel
                        .get("title")
                        .and_then(Value::as_str)
                        .and_then(trim_to_string)
                        .unwrap_or_else(|| first.title.clone());
                    let description = panel
                        .get("description")
                        .and_then(Value::as_str)
                        .and_then(trim_to_string)
                        .unwrap_or_else(|| first.why.clone());
                    let presentation = panel
                        .get("presentation")
                        .and_then(Value::as_str)
                        .and_then(trim_to_string)
                        .unwrap_or_else(|| "inline_card".to_string());
                    let blocks_execution = panel
                        .get("blocksExecution")
                        .and_then(Value::as_bool)
                        .unwrap_or_else(|| first.blocking_level == "hard_block");
                    let blocked_operation_ids = panel
                        .get("blockedOperationIds")
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(Value::as_str)
                                .filter_map(trim_to_string)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let updated_at = tickets
                        .iter()
                        .map(|ticket| ticket.updated_at)
                        .max()
                        .unwrap_or(first.updated_at);
                    Some(json!({
                        "id": panel_id,
                        "sessionId": first.session_id,
                        "turnId": first.runtime_turn_id,
                        "kind": "clarification",
                        "status": "pending",
                        "payload": {
                            "schemaVersion": "v1",
                            "panelId": panel_id,
                            "source": panel.get("source").and_then(Value::as_str).unwrap_or("agent_runtime"),
                            "presentation": presentation,
                            "blocksExecution": blocks_execution,
                            "blockedOperationIds": blocked_operation_ids,
                            "resumeToken": panel.get("resumeToken").cloned().unwrap_or(Value::Null),
                            "title": title,
                            "description": description,
                            "questionTicketIds": tickets.iter().map(|ticket| ticket.question_ticket_id.clone()).collect::<Vec<_>>(),
                            "questions": questions,
                            "questionTicketId": first.question_ticket_id,
                            "blockingLevel": first.blocking_level,
                            "question": first.question,
                            "why": first.why,
                            "targetSummary": first.target_summary,
                            "options": first.options,
                            "allowCustomAnswer": first.allow_custom_answer,
                        },
                        "createdAt": first.created_at,
                        "updatedAt": updated_at,
                    }))
                })
                .collect())
        })
    }

    pub fn read_clarification_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentClarification>> {
        self.with_session_conn(session_id, |conn| {
            let pending = read_question_tickets_by_status_from_conn(conn, session_id, "open", 8)?
                .into_iter()
                .map(|ticket| AgentQuestionTicket {
                    question_ticket_id: ticket.question_ticket_id,
                    session_id: ticket.session_id,
                    runtime_turn_id: ticket.runtime_turn_id,
                    status: ticket.status,
                    blocking_level: ticket.blocking_level,
                    title: ticket.title,
                    question: ticket.question,
                    why: ticket.why,
                    target_summary: ticket.target_summary,
                    options: ticket.options,
                    allow_custom_answer: ticket.allow_custom_answer,
                    created_at: ticket.created_at,
                    updated_at: ticket.updated_at,
                })
                .collect::<Vec<_>>();
            let recent_answered =
                read_question_tickets_by_status_from_conn(conn, session_id, "answered", 4)?;
            if pending.is_empty() && recent_answered.is_empty() {
                return Ok(None);
            }
            Ok(Some(AgentClarification {
                pending,
                recent_answered,
            }))
        })
    }

    pub fn read_assumption_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentAssumptionSummary>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT assumption_id, session_id, runtime_turn_id, user_message_id,
                        intent_id, status, statement, basis, risk_level, reversible,
                        source_refs_json, created_at_ms, updated_at_ms
                 FROM assumption_record
                 WHERE session_id = ?1 AND status = 'active'
                 ORDER BY created_at_ms DESC
                 LIMIT 8",
            )?;
            let rows = stmt.query_map(params![session_id], read_assumption_record_row)?;
            let mut active = Vec::new();
            for row in rows {
                active.push(row?);
            }
            if active.is_empty() {
                return Ok(None);
            }
            let updated_at = active
                .iter()
                .map(|assumption| assumption.updated_at)
                .max()
                .unwrap_or(0);
            Ok(Some(AgentAssumptionSummary { active, updated_at }))
        })
    }
}

fn read_question_tickets_by_status_from_conn(
    conn: &Connection,
    session_id: &str,
    status: &str,
    limit: usize,
) -> Result<Vec<QuestionTicket>> {
    let mut stmt = conn.prepare(
        "SELECT question_ticket_id, session_id, runtime_turn_id, user_message_id,
                intent_id, status, blocking_level, title, question, why, target_summary,
                options_json, allow_custom_answer, selected_option_id, answer_text,
                related_ids_json, target_bindings_json, created_at_ms, updated_at_ms,
                answered_at_ms
         FROM question_ticket
         WHERE session_id = ?1 AND status = ?2
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![session_id, status, limit as i64],
        read_question_ticket_row,
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    result.reverse();
    Ok(result)
}

fn default_panel_payload_for_ticket(ticket: &QuestionTicket) -> Value {
    json!({
        "schemaVersion": "v1",
        "source": "agent_runtime",
        "presentation": if ticket.blocking_level == "hard_block" { "modal" } else { "inline_card" },
        "blocksExecution": ticket.blocking_level == "hard_block",
        "blockedOperationIds": ticket.related_ids.clone(),
        "resumeToken": format!("runtime_turn:{}", ticket.runtime_turn_id),
        "title": ticket.title.clone(),
        "description": ticket.why.clone(),
    })
}

fn question_payload(ticket: &QuestionTicket) -> Value {
    json!({
        "questionTicketId": ticket.question_ticket_id.clone(),
        "blockingLevel": ticket.blocking_level.clone(),
        "title": ticket.title.clone(),
        "question": ticket.question.clone(),
        "why": ticket.why.clone(),
        "whyItMatters": ticket.why.clone(),
        "targetSummary": ticket.target_summary.clone(),
        "options": ticket.options.clone(),
        "allowCustomAnswer": ticket.allow_custom_answer,
        "questionType": ticket.target_bindings.get("questionType").cloned().unwrap_or(Value::Null),
        "reasonCode": ticket.target_bindings.get("reasonCode").cloned().unwrap_or(Value::Null),
    })
}

fn read_question_ticket_row(row: &Row<'_>) -> rusqlite::Result<QuestionTicket> {
    let options_json: String = row.get(11)?;
    let related_ids_json: String = row.get(15)?;
    let target_bindings_json: String = row.get(16)?;
    Ok(QuestionTicket {
        question_ticket_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        user_message_id: row.get(3)?,
        intent_id: row.get(4)?,
        status: row.get(5)?,
        blocking_level: row.get(6)?,
        title: row.get(7)?,
        question: row.get(8)?,
        why: row.get(9)?,
        target_summary: row.get(10)?,
        options: serde_json::from_str(&options_json).unwrap_or_default(),
        allow_custom_answer: row.get::<_, i64>(12)? != 0,
        selected_option_id: row.get(13)?,
        answer_text: row.get(14)?,
        related_ids: parse_json_vec_string(&related_ids_json),
        target_bindings: serde_json::from_str(&target_bindings_json).unwrap_or_else(|_| json!({})),
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        answered_at: row.get(19)?,
    })
}

fn read_assumption_record_row(row: &Row<'_>) -> rusqlite::Result<AssumptionRecord> {
    let source_refs_json: String = row.get(10)?;
    Ok(AssumptionRecord {
        assumption_id: row.get(0)?,
        session_id: row.get(1)?,
        runtime_turn_id: row.get(2)?,
        user_message_id: row.get(3)?,
        intent_id: row.get(4)?,
        status: row.get(5)?,
        statement: row.get(6)?,
        basis: row.get(7)?,
        risk_level: row.get(8)?,
        reversible: row.get::<_, i64>(9)? != 0,
        source_refs: parse_json_vec_string(&source_refs_json),
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}
