use super::*;

pub(crate) fn send_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let text = string_opt(&payload, "text")
        .or_else(|| string_opt(&payload, "prompt"))
        .unwrap_or_default();
    let images = payload
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let requested_session = string_opt(&payload, "sessionId");
    let now = now();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let mut user_message = user_message(text.clone(), images, now.clone());
    let user_message_id = user_message
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("message-{}", Uuid::new_v4()));

    let (session_id, callback, snapshot, soft_interrupt_events, cancellation) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session_id = state.resolve_session_id(requested_session)?;
        let interrupted_turn_id = state
            .sessions
            .get(&session_id)
            .filter(|session| session.snapshot["turnStatus"] == "running")
            .and_then(|session| {
                session
                    .snapshot
                    .get("activeTurnId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        if let Some(previous_turn_id) = interrupted_turn_id.as_ref() {
            state.cancelled_turns.insert(previous_turn_id.clone());
            if let Some(token) = state.active_cancellations.get(previous_turn_id) {
                token.store(true, Ordering::SeqCst);
            }
        }
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let mut soft_interrupt_events = Vec::new();
        if let Some(previous_turn_id) = interrupted_turn_id.as_ref() {
            session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
            session.snapshot["activeTurnId"] = Value::Null;
            finish_running_tools_for_turn(
                session,
                previous_turn_id,
                "cancelled",
                json!({ "content": "Lyra tool call was cancelled by a newer user message." }),
            );
            update_runtime_turn_state(
                session,
                previous_turn_id,
                "interrupted",
                Some("soft_interrupt"),
            );
            soft_interrupt_events.push(json!({
                "kind": "turnStateChanged",
                "sessionId": session_id,
                "turnId": previous_turn_id,
                "state": "interrupted",
                "reason": "soft_interrupt_new_user_message"
            }));
            soft_interrupt_events.push(json!({
                "kind": "turnInterrupted",
                "sessionId": session_id,
                "turnId": previous_turn_id,
                "reason": "soft_interrupt_new_user_message"
            }));
        }
        let checkpoint = rollback_checkpoint(&session_id, &turn_id, &user_message_id, session);
        user_message["rollback"] = json!({
            "available": true,
            "anchorId": checkpoint.id,
            "checkpointAt": checkpoint.created_at,
            "unavailableReason": Value::Null
        });
        session.rollback_checkpoints.push(checkpoint);
        maybe_title_session_from_first_user_message(session, &text);
        push_array(&mut session.snapshot, "messages", user_message.clone());
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "Calling model" });
        touch_session(session);
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "calling_model",
            Some(user_message_id.clone()),
            None,
        ));
        let snapshot = session.snapshot.clone();
        let cancellation = Arc::new(AtomicBool::new(false));
        state
            .active_cancellations
            .insert(turn_id.clone(), cancellation.clone());
        let callback = state.event_callback.clone();
        state.save_state()?;
        (
            session_id,
            callback,
            snapshot,
            soft_interrupt_events,
            cancellation,
        )
    };

    for event in soft_interrupt_events {
        emit_with_callback(&callback, event);
    }
    emit_with_callback(
        &callback,
        json!({ "kind": "messageCommitted", "sessionId": session_id, "message": user_message }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "turnStarted", "sessionId": session_id, "turnId": turn_id, "state": "calling_model" }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "turnStateChanged", "sessionId": session_id, "turnId": turn_id, "state": "calling_model", "reason": "native_turn_started" }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );

    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    thread::spawn(move || run_native_turn(thread_session_id, thread_turn_id, cancellation));

    Ok(json!({ "sessionId": session_id, "turnId": turn_id, "status": "running" }))
}

pub(crate) fn run_native_turn(session_id: String, turn_id: String, cancellation: Arc<AtomicBool>) {
    let model_result = build_model_request(&session_id).and_then(|request| {
        run_model_loop(&session_id, &turn_id, request, &cancellation).or_else(|error| {
            if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(&session_id, &turn_id) {
                Err(error)
            } else {
                Ok(ModelLoopResult::final_text(fallback_response(error)))
            }
        })
    });
    thread::sleep(Duration::from_millis(25));

    if cancellation.load(Ordering::SeqCst) || turn_was_cancelled(&session_id, &turn_id) {
        finish_turn(
            &session_id,
            &turn_id,
            "cancelled",
            None,
            Some("turn cancelled".to_string()),
        );
        return;
    }

    match model_result {
        Ok(result) => finish_turn(&session_id, &turn_id, "finished", result.final_text, None),
        Err(error) => finish_turn(
            &session_id,
            &turn_id,
            "failed",
            None,
            Some(error.to_string()),
        ),
    }
}

pub(crate) fn build_model_request(session_id: &str) -> AgentRuntimeResult<ModelRequest> {
    let (
        provider,
        model,
        session_messages,
        session_tools,
        host_dispatcher,
        memory_records,
        memory_injection_explanation,
        active_skills,
        working_dir,
    ) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let provider_id = state
            .config
            .default_provider
            .clone()
            .unwrap_or_else(|| "openai".to_string());
        let provider = state
            .config
            .providers
            .get(&provider_id)
            .cloned()
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("provider not configured: {provider_id}"))
            })?;
        let model = provider
            .default_model
            .clone()
            .or_else(|| state.config.default_model.clone())
            .unwrap_or_else(|| "gpt-4.1-mini".to_string());
        let (session_messages, session_tools, working_dir) = {
            let session = state.sessions.get(session_id).ok_or_else(|| {
                AgentRuntimeError::Core(format!("session not found: {session_id}"))
            })?;
            let session_messages = session
                .snapshot
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let session_tools = session
                .snapshot
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let working_dir = session
                .snapshot
                .get("workingDir")
                .and_then(Value::as_str)
                .map(str::to_string);
            (session_messages, session_tools, working_dir)
        };
        let active_turn_id = state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.get("activeTurnId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let selected_ranked_memory = select_ranked_long_term_memory_for_injection(
            &state.root,
            &latest_user_text(&session_messages),
            working_dir.as_deref(),
            SHARED_MEMORY_INJECTION_LIMIT,
        )?;
        let memory_query = [
            Some(latest_user_text(&session_messages)),
            working_dir.clone(),
        ]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
        let memory_injection_explanation = record_memory_injection(
            &state.root,
            session_id,
            active_turn_id.as_deref(),
            (!memory_query.trim().is_empty()).then_some(memory_query.as_str()),
            &selected_ranked_memory,
        )
        .unwrap_or_else(|_| json!({ "selected": [] }));
        let selected_memory = selected_ranked_memory
            .iter()
            .map(|ranked| ranked.record.clone())
            .collect::<Vec<_>>();
        (
            provider,
            model,
            session_messages,
            session_tools,
            state.host_dispatcher.clone(),
            selected_memory,
            memory_injection_explanation,
            state.active_skills.clone(),
            working_dir,
        )
    };
    let capabilities = model_capabilities(&provider, &model);
    let latest_user_text = latest_user_text(&session_messages);
    let design_research_required = design_tools::is_design_task(&latest_user_text)
        || active_skills.contains("lyra-design-research");
    let tools = if capabilities.supports_tool_calling {
        model_tools(design_research_required)
    } else {
        Vec::new()
    };
    let mut runtime_context =
        build_runtime_context(host_dispatcher.as_ref(), &memory_records, &capabilities);
    let tool_scene = infer_tool_filesystem_scene(
        working_dir.as_deref(),
        design_research_required,
        &active_skills,
        &runtime_context["workbench"],
    );
    runtime_context["toolFilesystem"] = tool_filesystem_runtime_context(&tool_scene);
    runtime_context["memoryLayers"] = json!({
        "workingMemory": {
            "latestUserIntent": latest_user_text,
            "activeTurn": true,
        },
        "sessionMemory": {
            "messageCount": session_messages.len(),
            "toolCount": session_tools.len(),
            "recentToolEvidence": session_tools.iter().rev().take(8).cloned().collect::<Vec<_>>(),
        },
        "longTermMemory": {
            "selectedCount": memory_records.len(),
            "records": memory_records.iter().map(memory_summary_json).collect::<Vec<_>>(),
            "injection": memory_injection_explanation,
        }
    });
    runtime_context["activeSkills"] = json!(active_skills.iter().cloned().collect::<Vec<_>>());
    runtime_context["tools"] = json!(if capabilities.supports_tool_calling {
        model_tool_names(design_research_required)
    } else {
        Vec::new()
    });
    runtime_context["design"] = json!({
        "researchRequired": design_research_required,
        "availableTools": if design_research_required {
            vec![
                "/tools/design/search_styles",
                "/tools/design/get_style_details",
            ]
        } else {
            Vec::new()
        },
    });
    let system_prompt = build_system_prompt(
        &runtime_context,
        &active_skill_prompt(&active_skills),
        design_research_required,
        &shared_memory_prompt(&memory_records),
    );
    let last_turn_tool_count = estimate_previous_turn_tool_count(&session_tools, &session_messages);
    let context = ContextBuilder::default().build_provider_context(
        system_prompt,
        session_messages,
        ProviderContextOptions {
            supports_image_input: capabilities.supports_image_input,
            context_window: capabilities.context_window,
            max_tool_output_chars: 24_000,
            session_tool_count: session_tools.len(),
            last_turn_tool_count,
        },
    );
    if let Some(overflow) = context.overflow.clone() {
        return Err(AgentRuntimeError::Core(format!(
            "context_overflow: {}",
            serde_json::to_string(&overflow).unwrap_or_else(|_| "{}".to_string())
        )));
    }
    let mut messages = context.messages;
    if !context.input_downgrades.is_empty() {
        messages.insert(
            1,
            json!({
                "role": "system",
                "content": format!(
                    "Structured input downgrade report: {}",
                    serde_json::to_string(&context.input_downgrades).unwrap_or_else(|_| "[]".to_string())
                ),
            }),
        );
    }
    Ok(ModelRequest {
        provider,
        model,
        messages,
        tools,
        host_dispatcher,
        capabilities,
        input_downgrades: context.input_downgrades,
        evidence_refs: context.evidence_refs,
        token_estimate: context.token_estimate,
        context_trimmed: context.trimmed,
    })
}

pub(crate) fn latest_user_text(messages: &[Value]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|message| message.get("text").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn maybe_title_session_from_first_user_message(session: &mut NativeSession, text: &str) {
    if session.custom_title.is_some() {
        return;
    }
    if first_user_message_exists(session) {
        return;
    }
    let title = text.trim();
    if title.is_empty() {
        return;
    }
    let current_title = session.snapshot.get("title").and_then(Value::as_str);
    if current_title == Some(DEFAULT_SESSION_TITLE)
        || current_title == Some(LEGACY_DEFAULT_SESSION_TITLE)
        || current_title.is_none()
    {
        session.snapshot["title"] = Value::String(title.to_string());
    }
}

fn first_user_message_exists(session: &NativeSession) -> bool {
    session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| {
            messages
                .iter()
                .any(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        })
}

pub(crate) fn estimate_previous_turn_tool_count(tools: &[Value], messages: &[Value]) -> usize {
    let user_times = messages
        .iter()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .filter_map(|message| message.get("createdAt").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let Some(latest_user_time) = user_times.last() else {
        return 0;
    };
    let previous_user_time = user_times
        .len()
        .checked_sub(2)
        .and_then(|index| user_times.get(index));
    tools
        .iter()
        .filter_map(|tool| tool.get("startedAt").and_then(Value::as_str))
        .filter(|started_at| {
            let started_at = *started_at;
            previous_user_time
                .map(|previous| started_at >= previous.as_str())
                .unwrap_or(true)
                && started_at < latest_user_time.as_str()
        })
        .count()
}

pub(crate) fn active_skill_prompt(active_skills: &HashSet<String>) -> String {
    let mut prompts = Vec::new();
    if active_skills.contains("lyra-design-research") {
        prompts.push("Skill lyra-design-research: For design or UI work, call Lyra design reference tools first, then include a concise Design Research Summary before proposing or editing UI.");
    }
    prompts.join("\n")
}

pub(crate) fn emit_assistant_text(session_id: &str, turn_id: &str, text: &str) -> Option<String> {
    let message_id = emit_assistant_message_placeholder(session_id, turn_id)?;
    append_assistant_delta(session_id, turn_id, &message_id, text).ok()?;
    Some(message_id)
}

pub(crate) fn emit_assistant_message_placeholder(
    session_id: &str,
    turn_id: &str,
) -> Option<String> {
    let message_id = format!("message-{}", Uuid::new_v4());
    let message = assistant_message_with_id(message_id.clone(), String::new());
    let callback = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let session = state.sessions.get_mut(session_id)?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return None;
            }
            push_array(&mut session.snapshot, "messages", message.clone());
            touch_session(session);
            let _ = state.save_state();
            callback
        }
        Err(_) => return None,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": message,
        }),
    );
    Some(message_id)
}

pub(crate) fn append_assistant_delta(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
    delta: &str,
) -> AgentRuntimeResult<()> {
    let callback = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let session = state.sessions.get_mut(session_id).ok_or_else(|| {
                AgentRuntimeError::Core(format!("session not found: {session_id}"))
            })?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return Err(AgentRuntimeError::Core("turn no longer active".to_string()));
            }
            let messages = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    AgentRuntimeError::Core("session messages are invalid".to_string())
                })?;
            let message = messages
                .iter_mut()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
                .ok_or_else(|| {
                    AgentRuntimeError::Core(format!("message not found: {message_id}"))
                })?;
            append_text_to_message(message, delta);
            touch_session(session);
            callback
        }
        Err(_) => {
            return Err(AgentRuntimeError::Core(
                "agent runtime state lock failed".to_string(),
            ));
        }
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageDelta",
            "sessionId": session_id,
            "messageId": message_id,
            "blockId": "text-0",
            "delta": delta,
        }),
    );
    Ok(())
}

pub(crate) fn append_text_to_message(message: &mut Value, delta: &str) {
    let next_text = format!(
        "{}{}",
        message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        delta
    );
    message["text"] = Value::String(next_text.clone());
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([{ "type": "text", "id": "text-0", "text": "" }]);
    }
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        if let Some(block) = blocks
            .iter_mut()
            .find(|block| block.get("id").and_then(Value::as_str) == Some("text-0"))
        {
            let text = format!(
                "{}{}",
                block
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                delta
            );
            block["text"] = Value::String(text);
        } else {
            blocks.insert(
                0,
                json!({ "type": "text", "id": "text-0", "text": next_text }),
            );
        }
    }
}

pub(crate) fn finish_turn(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
) {
    let mut extraction_job: Option<(PathBuf, String, String, String, Option<String>)> = None;
    let (callback, events) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let mut events = Vec::new();
            let root = state.root.clone();
            state.active_cancellations.remove(turn_id);
            state.cancelled_turns.remove(turn_id);
            if let Some(session) = state.sessions.get_mut(session_id) {
                if session.snapshot.get("activeTurnId").and_then(Value::as_str) == Some(turn_id) {
                    let latest_user = latest_user_text(
                        &session
                            .snapshot
                            .get("messages")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default(),
                    );
                    let assistant_for_extraction = assistant_text.clone();
                    if let Some(text) = assistant_text.filter(|text| !text.trim().is_empty()) {
                        let message = assistant_message(text);
                        push_array(&mut session.snapshot, "messages", message.clone());
                        events.push(json!({
                            "kind": "messageCommitted",
                            "sessionId": session_id,
                            "message": message
                        }));
                    }
                    session.snapshot["turnStatus"] = Value::String(status.to_string());
                    session.snapshot["activeTurnId"] = Value::Null;
                    session.snapshot["follow"] =
                        json!({ "running": false, "activity": Value::Null });
                    update_runtime_turn(session, turn_id, status);
                    let retention_metrics = prune_transient_tool_outputs(session);
                    touch_session(session);
                    events.push(json!({
                        "kind": "sessionSnapshot",
                        "snapshot": session.snapshot
                    }));
                    if retention_metrics
                        .get("pruned")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        > 0
                    {
                        events.push(json!({
                            "kind": "contextTrimmed",
                            "sessionId": session_id,
                            "detail": {
                                "reason": "tool_retention",
                                "metrics": retention_metrics,
                            }
                        }));
                    }
                    if status == "finished" {
                        extraction_job = Some((
                            root,
                            session_id.to_string(),
                            turn_id.to_string(),
                            latest_user,
                            assistant_for_extraction,
                        ));
                    }
                    events.push(json!({
                        "kind": "turnFinished",
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "status": status
                    }));
                    match status {
                        "finished" => events.push(json!({
                            "kind": "turnCompleted",
                            "sessionId": session_id,
                            "turnId": turn_id
                        })),
                        "cancelled" => events.push(json!({
                            "kind": "turnInterrupted",
                            "sessionId": session_id,
                            "turnId": turn_id,
                            "reason": failure.unwrap_or_else(|| "turn cancelled".to_string())
                        })),
                        "failed" => events.push(json!({
                            "kind": "turnFailed",
                            "sessionId": session_id,
                            "turnId": turn_id,
                            "message": failure.unwrap_or_else(|| "turn failed".to_string())
                        })),
                        _ => {}
                    }
                    events.push(json!({
                        "kind": "followStateChanged",
                        "sessionId": session_id,
                        "follow": { "running": false, "activity": Value::Null }
                    }));
                }
            }
            let _ = state.save_state();
            (callback, events)
        }
        Err(_) => return,
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    if let Some((root, session_id, turn_id, user_text, assistant_text)) = extraction_job {
        spawn_post_turn_memory_extraction(root, session_id, turn_id, user_text, assistant_text);
    }
}

pub(crate) fn update_runtime_turn(session: &mut NativeSession, turn_id: &str, status: &str) {
    let state_name = match status {
        "finished" => "completed",
        "cancelled" => "cancelled_by_user",
        "failed" => "failed_recoverable",
        _ => "completed",
    };
    update_runtime_turn_state(session, turn_id, state_name, None);
}

pub(crate) fn update_runtime_turn_state(
    session: &mut NativeSession,
    turn_id: &str,
    state_name: &str,
    failure_kind: Option<&str>,
) {
    let timestamp = now();
    for turn in &mut session.runtime_turns {
        if turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id) {
            turn["state"] = Value::String(state_name.to_string());
            turn["updatedAtIso"] = Value::String(timestamp.clone());
            turn["updatedAtMs"] = Value::Number(Utc::now().timestamp_millis().into());
            if matches!(
                state_name,
                "completed"
                    | "cancelled_by_user"
                    | "failed_recoverable"
                    | "failed_terminal"
                    | "interrupted"
            ) {
                turn["completedAtIso"] = Value::String(timestamp.clone());
                turn["completedAtMs"] = Value::Number(Utc::now().timestamp_millis().into());
            }
            if let Some(failure_kind) = failure_kind {
                turn["failureKind"] = Value::String(failure_kind.to_string());
            }
        }
    }
}

pub(crate) fn set_runtime_turn_state(
    session: &mut NativeSession,
    turn_id: &str,
    state_name: &str,
    failure_kind: Option<&str>,
) {
    update_runtime_turn_state(session, turn_id, state_name, failure_kind);
}

pub(crate) fn turn_was_cancelled(session_id: &str, turn_id: &str) -> bool {
    state()
        .lock()
        .map(|state| {
            state.cancelled_turns.contains(turn_id)
                || state
                    .active_cancellations
                    .get(turn_id)
                    .map(|token| token.load(Ordering::SeqCst))
                    .unwrap_or(false)
                || state
                    .sessions
                    .get(session_id)
                    .and_then(|session| session.snapshot.get("activeTurnId"))
                    .and_then(Value::as_str)
                    != Some(turn_id)
        })
        .unwrap_or(true)
}

pub(crate) fn cancel_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    let (turn_id, callback, events) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let turn_id = state
            .sessions
            .get(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?
            .snapshot
            .get("activeTurnId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("turn not running for session: {id}"))
            })?;
        state.cancelled_turns.insert(turn_id.clone());
        if let Some(token) = state.active_cancellations.get(&turn_id) {
            token.store(true, Ordering::SeqCst);
        }
        let session = state
            .sessions
            .get_mut(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
        session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
        session.snapshot["activeTurnId"] = Value::Null;
        session.snapshot["follow"] = json!({ "running": false, "activity": Value::Null });
        finish_running_tools_for_turn(
            session,
            &turn_id,
            "cancelled",
            json!({ "content": "Lyra tool call was cancelled by the user." }),
        );
        update_runtime_turn(session, &turn_id, "cancelled");
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        let events = vec![
            json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
            json!({
                "kind": "turnStateChanged",
                "sessionId": id,
                "turnId": turn_id,
                "state": "cancelled",
                "reason": "user_cancelled",
            }),
        ];
        (turn_id, callback, events)
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    Ok(json!({
        "sessionId": id,
        "turnId": turn_id,
        "status": "cancelled"
    }))
}
