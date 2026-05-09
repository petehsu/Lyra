use super::*;

pub(in crate::agent_runtime) fn run_turn_worker_inner(
    store: &AiStore,
    config: ProviderRuntimeConfig,
    session_id: &str,
    turn_id: &str,
    workspace_root_override: Option<&str>,
    permission_mode: PermissionMode,
    execution_target: ExecutionTarget,
    cancel: Arc<AtomicBool>,
    mut invoke_model: impl FnMut(
        ProviderRuntimeConfig,
        Vec<ChatMessage>,
        Vec<ToolDefinition>,
        &AtomicBool,
        &mut dyn FnMut(&str) -> Result<()>,
        &mut dyn FnMut(usize, &str) -> Result<()>,
    ) -> Result<ChatResponse>,
) -> Result<()> {
    let detail = store
        .read_session_detail(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "runtime_turn_started",
        json!({ "turnId": turn_id }),
    )?;
    let workspace_root = workspace_root_override
        .and_then(trim_to_string)
        .or_else(|| detail.session.project_root.clone());
    let history = detail
        .messages
        .iter()
        .filter(|message| message.role == "user" || message.role == "assistant")
        .map(|message| ChatMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect::<Vec<_>>();
    let turn = detail.turns.iter().find(|turn| turn.id == turn_id);
    let collaboration_mode = turn
        .and_then(|turn| turn.collaboration_mode.as_deref())
        .map(|mode| normalize_collaboration_mode(Some(mode)))
        .unwrap_or_else(|| detail.session.collaboration_mode.clone());
    let denied_approval_summaries = store.read_recent_denied_approval_summaries(session_id, 5)?;
    let failed_plan_coverage_summaries = detail
        .plan_coverage_summary
        .as_ref()
        .filter(|coverage| coverage.status != "valid")
        .map(|coverage| {
            json!({
                "planId": coverage.plan_id.clone(),
                "approvedVersionId": coverage.approved_version_id.clone(),
                "status": coverage.status.clone(),
                "missingPlanStepIds": coverage.missing_plan_step_ids.clone(),
                "verificationGaps": coverage.verification_gaps.clone(),
                "missingReferenceIds": coverage.missing_reference_ids.clone(),
                "mismatchedReferenceIds": coverage.mismatched_reference_ids.clone(),
            })
        })
        .into_iter()
        .collect();
    let work_run_summaries = detail
        .durable_work_summary
        .as_ref()
        .map(|summary| serde_json::to_value(summary).unwrap_or_else(|_| json!({})))
        .into_iter()
        .collect();
    let recovery_summaries = detail
        .recovery_summary
        .as_ref()
        .map(|summary| serde_json::to_value(summary).unwrap_or_else(|_| json!({})))
        .into_iter()
        .collect();
    let intake_summaries = project_intake_prompt_value(&detail).into_iter().collect();
    let input_reference_summaries = detail
        .reference_summary
        .as_ref()
        .map(|summary| serde_json::to_value(summary).unwrap_or_else(|_| json!({})))
        .into_iter()
        .collect();
    let clarification_state = Some(project_clarification_prompt_value(&detail));
    let memory_context = store.read_memory_prompt_context(session_id, 8).ok();
    let pinned_memory_context = memory_context
        .as_ref()
        .and_then(|memory| memory.get("pinned").cloned())
        .unwrap_or_else(|| json!({}));
    let policy_summary = detail
        .policy_summary
        .as_ref()
        .map(|summary| serde_json::to_value(summary).unwrap_or_else(|_| json!({})));
    let security_prompt_state = project_security_prompt_value(&detail);
    let security_summary = security_prompt_state.get("security").cloned();
    let mut messages = compose_messages(
        PromptContext {
            collaboration_mode,
            workspace_root: workspace_root.clone(),
            policy_summary,
            security_summary,
            read_only_tools_available: workspace_root.is_some(),
            permission_mode: permission_mode.as_str().to_string(),
            execution_target: execution_target.as_str().to_string(),
            denied_approval_summaries,
            failed_plan_coverage_summaries,
            work_run_summaries,
            recovery_summaries,
            intake_summaries,
            input_reference_summaries,
            clarification_state,
            memory_context,
        },
        history,
    );
    if let Some(message) = clarification_resume_context_message(&detail, turn_id) {
        messages.push(message);
    }
    if let Some(system_prompt) = detail
        .session
        .system_prompt
        .as_deref()
        .and_then(trim_to_string)
    {
        let insert_at = messages
            .iter()
            .rposition(|message| message.role == "system")
            .map(|index| index + 1)
            .unwrap_or(0);
        messages.insert(
            insert_at,
            ChatMessage {
                role: "system".to_string(),
                content: format!("User configured system prompt:\n{system_prompt}"),
            },
        );
    }
    if let Some(policy) = apply_prompt_repetition(&config, &mut messages) {
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "prompt_repetition_policy_applied",
            json!({ "policy": policy }),
        )?;
    }
    let mut final_usage: Option<Usage>;
    let tool_context = ToolExecutionContext {
        workspace_root: workspace_root.clone(),
    };
    let mut tool_definitions = built_in_tool_definitions();
    tool_definitions.extend(mcp_tool_definitions(&store.root, workspace_root.as_deref()));
    let mut inspected_tool_paths = HashSet::<String>::new();
    let managed_output = detail.active_todo.is_some() || detail.durable_work_summary.is_some();
    let mut streamed_model_chars = 0_usize;
    loop {
        let mut assistant_text: String;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow!("turn cancelled"));
            }
            emit_runtime_state(store, session_id, turn_id, "model_invoking")?;
            redact_model_input_for_turn(store, session_id, turn_id, &mut messages)?;
            if let Some(stats) = context_window::enforce_context_window_for_turn(
                store,
                session_id,
                turn_id,
                &config,
                &mut messages,
                pinned_memory_context.clone(),
            )? {
                emit_store_event(
                    store,
                    session_id,
                    Some(turn_id),
                    "context_window_truncated",
                    context_window::context_window_event_payload(&stats),
                )?;
            }
            let mut stream_emitter = AgentOutputGate::new(
                store,
                session_id,
                turn_id,
                managed_output,
                streamed_model_chars,
            );
            let mut on_delta = |delta: &str| stream_emitter.push(delta);
            let mut on_retry = |attempt: usize, error: &str| {
                emit_store_event(
                    store,
                    session_id,
                    Some(turn_id),
                    "model_call_retrying",
                    json!({
                        "turnId": turn_id,
                        "attempt": attempt,
                        "error": error,
                    }),
                )
            };
            let response = invoke_model(
                config.clone(),
                messages.clone(),
                tool_definitions.clone(),
                &cancel,
                &mut on_delta,
                &mut on_retry,
            )?;
            stream_emitter.flush()?;
            streamed_model_chars = stream_emitter.cumulative_chars();
            final_usage = response.usage.clone();
            if !response.tool_calls.is_empty() {
                for tool_call in &response.tool_calls {
                    let outcome = tool_call::run_tool_call(
                        store,
                        session_id,
                        turn_id,
                        &tool_context,
                        tool_call,
                        permission_mode,
                        &mut messages,
                        &mut inspected_tool_paths,
                    )?;
                    if matches!(outcome, tool_call::ToolCallRunOutcome::StopTurn) {
                        return Ok(());
                    }
                }
                continue;
            }
            let model_text = stream_emitter.visible_candidate_text(&response.text)?;
            match parse_tool_operation(&model_text) {
                Ok(Some(operation)) => {
                    reset_model_stream_draft(store, session_id, turn_id, "tool_operation")?;
                    tool_dispatch::run_tool_operation(
                        store,
                        session_id,
                        turn_id,
                        &tool_context,
                        &operation,
                        permission_mode,
                        &mut messages,
                        &mut inspected_tool_paths,
                    )?;
                }
                Err(ToolOperationParseError::InvalidEnvelope(message)) => {
                    reset_model_stream_draft(store, session_id, turn_id, "invalid_tool_operation")?;
                    reject_invalid_tool_operation(
                        store,
                        session_id,
                        turn_id,
                        &model_text,
                        &message,
                        &mut messages,
                    )?;
                }
                Ok(None) | Err(ToolOperationParseError::InvalidJson(_)) => {
                    assistant_text = model_text;
                    break;
                }
            }
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        if assistant_text.trim().is_empty() && !managed_output {
            assistant_text =
                "I could not produce a final response from the model for this turn.".to_string();
        }
        emit_runtime_state(store, session_id, turn_id, "completion_evaluating")?;
        if let Some(audit) =
            store.evaluate_completion_audit_and_delivery_proof(session_id, Some(turn_id))?
        {
            project_work_after_completion(store, session_id, Some(turn_id))?;
            let detail = store.read_session_detail(session_id)?;
            emit_completion_projection_events(store, session_id, Some(turn_id), detail.as_ref())?;
            if let Some(projected) = detail
                .as_ref()
                .and_then(|detail| delivery_gate_response(&audit, detail.delivery_proof.as_ref()))
            {
                assistant_text = projected;
            }
        }
        let work_projection =
            project_work_after_model_candidate(store, session_id, Some(turn_id), &assistant_text)?;
        if let Some(replacement_text) = work_projection.replacement_text {
            assistant_text = replacement_text;
        }
        if work_projection.suppress_user_output {
            if let Some(continuation_id) = work_projection.continuation_id.as_deref() {
                if let Some(summary) = resume_work_continuation(store, session_id, continuation_id)?
                {
                    if summary.status == "auto_resuming" {
                        messages.push(continuation_steering_message(&summary));
                        continue;
                    }
                }
            }
            delivery::complete_turn_without_visible_message(
                store,
                session_id,
                turn_id,
                final_usage.clone(),
            )?;
            store.extract_shared_memory_after_turn(session_id, Some(turn_id))?;
            store.write_frozen_memory_projection()?;
            memory_pipeline::spawn_memory_gateway_worker(store.root.clone(), config.clone());
            return Ok(());
        }
        if current_turn_has_pending_interaction(store, session_id, turn_id)? {
            emit_store_event(
                store,
                session_id,
                Some(turn_id),
                "model_output_suppressed",
                json!({
                    "turnId": turn_id,
                    "reason": "pending_runtime_interaction",
                }),
            )?;
            delivery::complete_turn_without_visible_message(
                store,
                session_id,
                turn_id,
                final_usage.clone(),
            )?;
            store.extract_shared_memory_after_turn(session_id, Some(turn_id))?;
            store.write_frozen_memory_projection()?;
            memory_pipeline::spawn_memory_gateway_worker(store.root.clone(), config.clone());
            return Ok(());
        }
        if assistant_text.trim().is_empty() && managed_output {
            delivery::complete_turn_without_visible_message(
                store,
                session_id,
                turn_id,
                final_usage.clone(),
            )?;
            store.extract_shared_memory_after_turn(session_id, Some(turn_id))?;
            store.write_frozen_memory_projection()?;
            memory_pipeline::spawn_memory_gateway_worker(store.root.clone(), config.clone());
            return Ok(());
        }
        if assistant_text.trim().is_empty() {
            assistant_text =
                "I need more workspace context before I can give a reliable final answer."
                    .to_string();
        }
        let text_event = store.append_event(
            session_id,
            Some(turn_id),
            "model_text_delta",
            json!({ "delta": assistant_text }),
        )?;
        emit_event(&text_event);
        let message_id =
            store.append_or_update_assistant_message(session_id, turn_id, &assistant_text)?;
        let assistant_message = AgentMessage {
            id: message_id,
            session_id: session_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            role: "assistant".to_string(),
            content: assistant_text.clone(),
            content_parts: None,
            display_content: Some(assistant_text),
            created_at: now_ms(),
        };
        store.update_turn_status(session_id, turn_id, "completed", "completed", None, None)?;
        let detail = store.read_session_detail(session_id)?;
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "model_message_end",
            json!({
                "message": assistant_message,
                "usage": final_usage,
                "detail": detail
            }),
        )?;
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "runtime_turn_completed",
            json!({
                "turnId": turn_id,
                "detail": detail
            }),
        )?;
        if let Some(mut session) = store.read_session_index(session_id)? {
            session.updated_at = now_ms();
            store.upsert_session_index(&session)?;
        }
        if let Some(detail) = store.read_session_detail(session_id)? {
            emit_store_event(
                store,
                session_id,
                None,
                "session_updated",
                json!({ "detail": detail }),
            )?;
        }
        store.extract_shared_memory_after_turn(session_id, Some(turn_id))?;
        store.write_frozen_memory_projection()?;
        memory_pipeline::spawn_memory_gateway_worker(store.root.clone(), config.clone());
        return Ok(());
    }
}

fn current_turn_has_pending_interaction(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
) -> Result<bool> {
    let Some(detail) = store.read_session_detail(session_id)? else {
        return Ok(false);
    };
    Ok(detail.pending_interactions.iter().any(|interaction| {
        interaction.get("turnId").and_then(Value::as_str) == Some(turn_id)
            && interaction.get("status").and_then(Value::as_str) == Some("pending")
    }))
}

fn continuation_steering_message(summary: &AgentLongWorkSummary) -> ChatMessage {
    let state = serde_json::to_string(summary).unwrap_or_else(|_| "{}".to_string());
    ChatMessage {
        role: "system".to_string(),
        content: format!(
            "Lyra Runtime automatically resumed the active Native Long Work run. Continue the unfinished work in the next WorkSlice. Do not ask the user whether to continue unless there is a real blocker.\nLongWorkState: {state}"
        ),
    }
}

pub(super) fn invoke_model_buffered(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    on_delta: &mut dyn FnMut(&str) -> Result<()>,
    on_retry: &mut dyn FnMut(usize, &str) -> Result<()>,
) -> Result<ChatResponse> {
    let mut streamed_text = String::new();
    let mut response = stream_completion_with_tools_retrying(
        config,
        messages,
        tools,
        cancel,
        |delta| {
            streamed_text.push_str(delta);
            on_delta(delta)
        },
        |attempt, error| on_retry(attempt, error),
    )?;
    if !streamed_text.is_empty() {
        response.text = streamed_text;
    }
    Ok(response)
}

fn reset_model_stream_draft(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    reason: &str,
) -> Result<()> {
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "model_stream_reset",
        json!({
            "turnId": turn_id,
            "draftId": format!("draft:{turn_id}"),
            "reason": reason,
        }),
    )
}

fn reject_invalid_tool_operation(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    model_text: &str,
    error_message: &str,
    messages: &mut Vec<ChatMessage>,
) -> Result<()> {
    let operation = synthetic_invalid_tool_operation(model_text);
    let mut result = ToolResultEnvelope::failed(
        &operation,
        TOOL_INVALID_ARGUMENT,
        format!("Rejected invalid ToolFS operation envelope: {error_message}"),
    );
    result.metadata = Some(json!({
        "kind": "invalid_tool_operation",
        "rejectedBy": "toolfs_protocol",
    }));
    let result_blob = store.append_tool_result_blob(
        session_id,
        turn_id,
        &result.op_id,
        &result.path,
        verification::tool_result_status_str(&result.status),
        &result.content,
    )?;
    result.result_ref = Some(result_blob.result_ref.clone());
    emit_tool_event(
        store,
        session_id,
        turn_id,
        "tool_operation_failed",
        json!({
            "operation": tool_operation_payload(&operation),
            "result": tool_result_payload(&result, &result_blob),
        }),
    )?;
    messages.push(ChatMessage {
        role: "assistant".to_string(),
        content: serde_json::to_string(&operation)?,
    });
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: tool_result_chat_message(&result)?,
    });
    Ok(())
}

fn synthetic_invalid_tool_operation(model_text: &str) -> ToolOperationEnvelope {
    let value = serde_json::from_str::<Value>(model_text).unwrap_or_else(|_| json!({}));
    let op_id = string_field(&value, "opId")
        .or_else(|| string_field(&value, "operationId"))
        .unwrap_or_else(|| "invalid-tool-operation".to_string());
    let path = string_field(&value, "path")
        .filter(|path| path.starts_with("/tools"))
        .unwrap_or_else(|| TOOL_SEARCH.to_string());
    let op = string_field(&value, "op")
        .and_then(|op| serde_json::from_value::<ToolFsOp>(Value::String(op)).ok())
        .unwrap_or(ToolFsOp::Run);
    let args = value
        .get("args")
        .filter(|args| args.is_object())
        .cloned()
        .unwrap_or(Value::Null);
    ToolOperationEnvelope {
        schema_version: string_field(&value, "schemaVersion")
            .unwrap_or_else(|| TOOL_SCHEMA_VERSION.to_string()),
        kind: TOOL_OPERATION_KIND.to_string(),
        op_id,
        op,
        path,
        args,
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .map(ToString::to_string)
}

struct AgentOutputGate<'a> {
    store: &'a AiStore,
    session_id: &'a str,
    turn_id: &'a str,
    cumulative_chars: usize,
    pending_public_delta: String,
    raw_text: String,
    last_emit: std::time::Instant,
}

impl<'a> AgentOutputGate<'a> {
    fn new(
        store: &'a AiStore,
        session_id: &'a str,
        turn_id: &'a str,
        _managed: bool,
        cumulative_chars: usize,
    ) -> Self {
        Self {
            store,
            session_id,
            turn_id,
            cumulative_chars,
            pending_public_delta: String::new(),
            raw_text: String::new(),
            last_emit: std::time::Instant::now(),
        }
    }

    fn push(&mut self, delta: &str) -> Result<()> {
        if delta.is_empty() {
            return Ok(());
        }
        self.raw_text.push_str(delta);
        self.cumulative_chars = self.cumulative_chars.saturating_add(delta.chars().count());
        self.pending_public_delta.push_str(delta);
        if self.pending_public_delta.chars().count() >= 100
            || self.last_emit.elapsed() >= std::time::Duration::from_millis(50)
        {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<()> {
        if self.pending_public_delta.is_empty() {
            return Ok(());
        }
        let text = std::mem::take(&mut self.pending_public_delta);
        self.last_emit = std::time::Instant::now();
        emit_store_event(
            self.store,
            self.session_id,
            Some(self.turn_id),
            "model_stream_delta",
            json!({
                "turnId": self.turn_id,
                "draftId": format!("draft:{}", self.turn_id),
                "text": text,
                "cumulativeLength": self.cumulative_chars,
                "source": "model_stream",
            }),
        )
    }

    fn cumulative_chars(&self) -> usize {
        self.cumulative_chars
    }

    fn visible_candidate_text(&mut self, response_text: &str) -> Result<String> {
        self.flush()?;
        let fallback = if self.raw_text.trim().is_empty() {
            response_text
        } else {
            self.raw_text.as_str()
        };
        Ok(fallback.trim().to_string())
    }
}

pub(super) fn redact_model_input_for_turn(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    messages: &mut [ChatMessage],
) -> Result<()> {
    let Some((snapshot_id, policy)) = store.read_effective_policy_for_turn(session_id, turn_id)?
    else {
        return Ok(());
    };
    let outcomes = redact_model_messages_for_turn(
        store,
        session_id,
        turn_id,
        Some(&snapshot_id),
        messages,
        policy.security.redaction_profile.as_str(),
    )?;
    for outcome in outcomes {
        emit_tool_event(
            store,
            session_id,
            turn_id,
            "security_redaction_applied",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "snapshotId": snapshot_id,
                "resourceKind": "model_input",
                "security": security_event_payload(&outcome),
            }),
        )?;
    }
    Ok(())
}
