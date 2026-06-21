use super::*;

pub(crate) fn send_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let requested_session = string_opt(&payload, "sessionId");
    if let Ok(mut state) = state().lock() {
        if let Ok(session_id) = state.resolve_session_id(requested_session.clone()) {
            if let Some(session) = state.sessions.get(&session_id) {
                if let Some(failure) = gate_turn_on_blocked_browser(session) {
                    return Err(AgentRuntimeError::Core(failure));
                }
            }
        }
    }
    let text = string_opt(&payload, "text")
        .or_else(|| string_opt(&payload, "prompt"))
        .unwrap_or_default();
    let inline_images = parse_inline_images(&payload);
    let uses_inline_image_markers = text_has_inline_image_markers(&text);
    if uses_inline_image_markers {
        validate_inline_image_turn_commit(&text, &inline_images)
            .map_err(AgentRuntimeError::Core)?;
    }
    let legacy_images = if uses_inline_image_markers {
        Vec::new()
    } else {
        payload
            .get("images")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let citations = parse_transcript_citations(&payload);
    let page_citations = parse_page_citations(&payload);
    let file_citations = parse_file_citations(&payload);
    let ui_hidden = payload
        .get("uiHidden")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let requested_session = string_opt(&payload, "sessionId");
    let now = now();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let mut user_message = user_message(text.clone(), legacy_images.clone(), now.clone());
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
            super::session_runtime::request_turn_cancellation(previous_turn_id);
        }
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let mut soft_interrupt_events = Vec::new();
        if let Some(previous_turn_id) = interrupted_turn_id.as_ref() {
            session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
            session.snapshot["activeTurnId"] = Value::Null;
            finalize_interrupt_state(session, "soft_interrupt_new_user_message");
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
        if !citations.is_empty() {
            let existing_messages = session
                .snapshot
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let (accepted, rejected) =
                validate_transcript_citations(&existing_messages, &citations);
            apply_transcript_citations_to_user_message(&mut user_message, &accepted, &rejected);
        }
        if !page_citations.is_empty() {
            apply_page_citations_to_user_message(&mut user_message, &page_citations);
        }
        if !file_citations.is_empty() {
            apply_file_citations_to_user_message(&mut user_message, &file_citations);
        }
        if uses_inline_image_markers {
            apply_inline_images_to_user_message(&mut user_message, &inline_images);
        }
        if ui_hidden {
            user_message["metadata"] = json!({ "uiHidden": true });
            user_message["rollback"] = json!({
                "available": false,
                "unavailableReason": "Rollback is unavailable for menu action turns."
            });
        } else {
            let checkpoint = rollback_checkpoint(&session_id, &turn_id, &user_message_id, session);
            user_message["rollback"] = json!({
                "available": true,
                "anchorId": checkpoint.id,
                "checkpointAt": checkpoint.created_at,
                "unavailableReason": Value::Null
            });
            session.rollback_checkpoints.push(checkpoint);
            maybe_title_session_from_first_user_message(session, &text);
        }
        push_array(&mut session.snapshot, "messages", user_message.clone());
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
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
        super::session_runtime::register_active_turn(&session_id, &turn_id, cancellation.clone());
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

pub(crate) fn retry_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let requested_session = string_opt(&payload, "sessionId");
    let requested_turn_id = string_opt(&payload, "turnId");
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let (
        session_id,
        callback,
        snapshot,
        parent_turn_id,
        user_message_id,
        cancellation,
        recovery_hint,
    ) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session_id = state.resolve_session_id(requested_session)?;
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        if session.snapshot["turnStatus"] == "running" {
            return Err(AgentRuntimeError::Core(
                "cannot retry while another turn is running".to_string(),
            ));
        }
        if let Some(failure) = gate_turn_on_blocked_browser(session) {
            return Err(AgentRuntimeError::Core(failure));
        }
        let recovery_hint = should_apply_failure_recovery(session);
        let failed_turn = if let Some(turn_id) = requested_turn_id.as_deref() {
            session
                .runtime_turns
                .iter()
                .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id))
        } else {
            session.runtime_turns.iter().rfind(|turn| {
                turn.get("state").and_then(Value::as_str) == Some("failed_recoverable")
            })
        }
        .ok_or_else(|| {
            AgentRuntimeError::Core("no failed turn is available to retry".to_string())
        })?;
        let parent_turn_id = failed_turn
            .get("runtimeTurnId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core("failed turn is missing runtimeTurnId".to_string())
            })?;
        let user_message_id = failed_turn
            .get("userMessageId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core(
                    "failed turn is missing userMessageId; cannot retry without a visible user anchor"
                        .to_string(),
                )
            })?;
        let messages = session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let user_message_exists = messages.iter().any(|message| {
            message.get("id").and_then(Value::as_str) == Some(user_message_id.as_str())
        });
        if !user_message_exists {
            return Err(AgentRuntimeError::Core(format!(
                "user message {user_message_id} is not present in the session transcript"
            )));
        }
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "retrying_provider" });
        touch_session(session);
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "retrying_provider",
            Some(user_message_id.clone()),
            Some(parent_turn_id.clone()),
        ));
        let snapshot = session.snapshot.clone();
        let cancellation = Arc::new(AtomicBool::new(false));
        state
            .active_cancellations
            .insert(turn_id.clone(), cancellation.clone());
        super::session_runtime::register_active_turn(&session_id, &turn_id, cancellation.clone());
        let callback = state.event_callback.clone();
        state.save_state()?;
        (
            session_id,
            callback,
            snapshot,
            parent_turn_id,
            user_message_id,
            cancellation,
            recovery_hint,
        )
    };

    if recovery_hint {
        emit_context_trimmed(
            &session_id,
            json!({
                "reason": "consecutive_failed_recoverable",
                "message": "Multiple recoverable turn failures detected before retry; compact context and continue from pending todos.",
                "retry": true,
            }),
        );
    }

    emit_with_callback(
        &callback,
        json!({
            "kind": "turnStarted",
            "sessionId": session_id,
            "turnId": turn_id,
            "state": "retrying_provider",
            "parentTurnId": parent_turn_id,
            "userMessageId": user_message_id,
            "retry": true,
            "recoveryHint": recovery_hint
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "turnStateChanged",
            "sessionId": session_id,
            "turnId": turn_id,
            "state": "retrying_provider",
            "reason": "turn_retry",
            "parentTurnId": parent_turn_id,
            "userMessageId": user_message_id
        }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );

    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    thread::spawn(move || run_native_turn(thread_session_id, thread_turn_id, cancellation));

    Ok(json!({
        "sessionId": session_id,
        "turnId": turn_id,
        "parentTurnId": parent_turn_id,
        "userMessageId": user_message_id,
        "status": "running",
        "retry": true
    }))
}

pub(crate) fn run_native_turn(session_id: String, turn_id: String, cancellation: Arc<AtomicBool>) {
    let model_result = build_model_request(&session_id)
        .and_then(|request| run_model_loop(&session_id, &turn_id, request, &cancellation));
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
        Ok(result) => {
            let metadata = result.session_metadata();
            let assistant_text = if result.ui_text_committed {
                None
            } else {
                result.final_text
            };
            finish_turn_with_metadata(
                &session_id,
                &turn_id,
                "finished",
                assistant_text,
                None,
                metadata,
                None,
            )
        }
        Err(error) => {
            let failure_message = error.to_string();
            let failure_kind = tool_protocol::classify_turn_failure(&failure_message);
            finish_turn_with_failure_kind(
                &session_id,
                &turn_id,
                "failed",
                None,
                Some(failure_message),
                Some(failure_kind),
            )
        }
    }
}

pub(crate) fn build_model_request(session_id: &str) -> AgentRuntimeResult<ModelRequest> {
    let (
        root,
        provider,
        model,
        session_messages,
        session_tools,
        host_dispatcher,
        active_skills,
        working_dir,
        session_kind,
        active_turn_id,
        pinned_context_prompt,
        previous_runtime_contract,
        previous_prompt_hash,
        previous_context_trimmed,
        configured_prompt_delivery_mode,
        configured_stateful_prompt_contract,
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
            .unwrap_or_else(|| "gpt-5-mini".to_string());
        let (
            session_messages,
            session_tools,
            working_dir,
            session_kind,
            previous_runtime_contract,
            previous_prompt_hash,
            previous_context_trimmed,
        ) = {
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
            let session_kind = session
                .snapshot
                .get("sessionKind")
                .and_then(Value::as_str)
                .map(str::to_string);
            let previous_runtime_contract = session.snapshot.get("promptRuntimeContract").cloned();
            let previous_prompt_hash = session
                .snapshot
                .get("promptDelivery")
                .and_then(|delivery| delivery.get("stablePromptHash"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let previous_context_trimmed = session
                .snapshot
                .get("promptDelivery")
                .and_then(|delivery| delivery.get("contextTrimmed"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            (
                session_messages,
                session_tools,
                working_dir,
                session_kind,
                previous_runtime_contract,
                previous_prompt_hash,
                previous_context_trimmed,
            )
        };
        let active_turn_id = state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.get("activeTurnId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let pinned_context_prompt = state
            .sessions
            .get(session_id)
            .map(|session| {
                let clarification = active_clarification_projection(&state, session_id);
                let items = pinned_context::collect_pinned_items(session, clarification.as_ref());
                pinned_context::pinned_context_prompt(&items)
            })
            .unwrap_or_default();
        (
            state.root.clone(),
            provider,
            model,
            session_messages,
            session_tools,
            state.host_dispatcher.clone(),
            state.active_skills.clone(),
            working_dir,
            session_kind,
            active_turn_id,
            pinned_context_prompt,
            previous_runtime_contract,
            previous_prompt_hash,
            previous_context_trimmed,
            state.config.prompt_delivery_mode.clone(),
            state.config.openai_responses_stateful_prompt_contract,
        )
    };
    let prompt_delivery_mode =
        prompt_policy::PromptDeliveryMode::resolve(configured_prompt_delivery_mode.as_deref());
    let latest_user = latest_user_text(&session_messages);
    let selected_ranked_memory = select_ranked_long_term_memory_for_injection(
        &root,
        &latest_user,
        working_dir.as_deref(),
        SHARED_MEMORY_INJECTION_LIMIT,
    )?;
    let memory_query = [Some(latest_user.clone()), working_dir.clone()]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let memory_injection_explanation = record_memory_injection(
        &root,
        session_id,
        active_turn_id.as_deref(),
        (!memory_query.trim().is_empty()).then_some(memory_query.as_str()),
        &selected_ranked_memory,
    )
    .unwrap_or_else(|_| json!({ "selected": [] }));
    let memory_records = selected_ranked_memory.clone();
    let system_recall_records = select_system_recall_for_injection(
        &root,
        Some(session_id),
        &latest_user,
        working_dir.as_deref(),
        &session_messages,
    )
    .unwrap_or_default();
    let capabilities = model_capabilities(&provider, &model);
    let retention_signals = crate::retention_policy::retention_signals_from_session_messages(
        &session_messages,
        session_tools.len(),
        capabilities.context_window,
    );
    let previous_tool_telemetry = previous_turn_tool_telemetry(&session_tools, &session_messages);
    let recent_tool_failure_count = previous_tool_telemetry.recent_failure_count;
    debug_assert_eq!(
        recent_tool_failure_count,
        estimate_previous_turn_failed_tool_count(&session_tools, &session_messages)
    );
    let mut session_messages = session_messages;
    let mut provider_context_trimmed = false;
    {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        if let Some(session) = state.sessions.get(session_id) {
            let active_clarification = active_clarification_projection(&state, session_id);
            let trim_config = crate::retention_policy::trim_controller_config_from_policy(
                crate::retention_policy::retention_policy_from_messages(
                    &session_messages,
                    &retention_signals,
                ),
            );
            if let Some(plan) = context_window::build_context_window_plan(
                session,
                &trim_config,
                active_clarification.as_ref(),
            ) {
                let (filtered, dropped) =
                    context_window::filter_messages_by_window_plan(&session_messages, &plan);
                if dropped > 0 {
                    session_messages = filtered;
                    provider_context_trimmed = true;
                }
            }
        }
    }
    let route = providers::registry::require_route(&provider.route_id)?;
    let openai_responses_replay =
        route.protocol_id == providers::protocol::openai_responses::PROTOCOL_ID;
    let latest_user_text = latest_user_text(&session_messages);
    let user_correction_detected = detect_user_correction(&latest_user_text);
    let design_research_required = design_tools::is_design_task(&latest_user_text)
        || active_skills.contains("lyra-design-research");
    let tools = if capabilities.supports_tool_calling {
        model_tools(design_research_required)
    } else {
        Vec::new()
    };
    let memory_record_summaries = memory_records
        .iter()
        .map(|ranked| ranked.record.clone())
        .collect::<Vec<_>>();
    let mut runtime_context = build_runtime_context(
        host_dispatcher.as_ref(),
        &memory_record_summaries,
        &capabilities,
    );
    let stateful_prompt_contract_enabled = route.supports_stateful_prompt_contract
        && openai_responses_stateful_prompt_contract_enabled(configured_stateful_prompt_contract);
    runtime_context["providerStatefulPrompt"] = json!({
        "routeSupportsStatefulPromptContract": route.supports_stateful_prompt_contract,
        "enabled": stateful_prompt_contract_enabled,
        "defaultEnabled": false,
        "billingNote": "Provider stateful prompt inheritance is experimental and does not guarantee lower billed input tokens; Lyra's default token saving path is sending less stable prompt text in lean mode."
    });
    runtime_context["promptRecoverySignals"] = json!({
        "recentToolFailureCount": recent_tool_failure_count,
        "recentToolMismatchCount": previous_tool_telemetry.recent_mismatch_count,
        "consecutiveToolFailureCount": previous_tool_telemetry.consecutive_failure_count,
        "recentToolPaths": previous_tool_telemetry.recent_tool_paths.clone(),
        "recentToolDomains": previous_tool_telemetry.recent_tool_domains.clone(),
        "recentFailedToolDomains": previous_tool_telemetry.recent_failed_tool_domains.clone(),
        "recentSceneModules": previous_tool_telemetry.recent_scene_modules.clone(),
        "recentFailedSceneModules": previous_tool_telemetry.recent_failed_scene_modules.clone(),
        "consecutiveFailedToolDomains": previous_tool_telemetry.consecutive_failed_tool_domains.clone(),
        "userCorrectionDetected": user_correction_detected,
        "effect": "Lean prompt delivery upgrades to a full refresh on failure/mismatch signals and keeps recent scene modules active after relevant tool use."
    });
    let tool_scene = infer_tool_filesystem_scene(
        session_kind.as_deref(),
        working_dir.as_deref(),
        design_research_required,
        &active_skills,
        &runtime_context["workbench"],
    );
    runtime_context["toolFilesystem"] =
        tool_filesystem_runtime_context(&tool_scene, Some(&session_id), host_dispatcher.as_ref());
    runtime_context["toolFilesystem"]["presearchHints"] =
        tools::tool_fs::presearch_hints_for_message(
            &latest_user_text,
            &tool_scene,
            active_turn_id.as_deref(),
            host_dispatcher.as_ref(),
        );
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
            "records": memory_record_summaries
                .iter()
                .map(memory_summary_json)
                .collect::<Vec<_>>(),
            "injection": memory_injection_explanation,
        },
        "systemRecall": system_recall_json(&system_recall_records)
    });
    runtime_context["activeSkills"] = json!(active_skills.iter().cloned().collect::<Vec<_>>());
    runtime_context["tools"] = json!(if capabilities.supports_tool_calling {
        model_tool_names(design_research_required)
    } else {
        Vec::new()
    });
    runtime_context["design"] = json!({
        "researchRequired": design_research_required,
        "discovery": if design_research_required {
            "Design work: first discover/use design ref caps through Tool-FS search/inspect/run"
        } else {
            "No design ref discovery needed for latest msg"
        },
    });
    let persona_context = read_host_persona_context(host_dispatcher.as_ref());
    let prompt_report = build_system_prompt_report(
        &runtime_context,
        &latest_user_text,
        &persona_context,
        &active_skill_prompt(&active_skills),
        design_research_required,
        &combined_memory_prompt(
            &memory_records,
            &system_recall_records,
            &pinned_context_prompt,
        ),
        previous_runtime_contract,
        previous_prompt_hash,
        provider_context_trimmed || previous_context_trimmed,
        recent_tool_failure_count,
        previous_tool_telemetry.recent_mismatch_count,
        previous_tool_telemetry.consecutive_failure_count,
        user_correction_detected,
        Some(prompt_delivery_mode),
    );
    let system_prompt = prompt_report.prompt.clone();
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
            openai_responses_replay,
            tool_outputs_by_id: tool_outputs_by_id_from_session_tools(&session_tools),
            halve_tool_output_message_ids: HashSet::new(),
        },
    );
    let request_context_trimmed = provider_context_trimmed || context.trimmed;
    {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.snapshot["promptRuntimeContract"] =
                serde_json::to_value(&prompt_report.contract).unwrap_or_else(|_| json!({}));
            session.snapshot["promptDelivery"] = json!({
                "promptMode": prompt_report.prompt_mode,
                "refreshReason": prompt_report.refresh_reason,
                "stablePromptHash": prompt_report.stable_prompt_hash,
                "estimatedPromptTokens": prompt_report.estimated_prompt_tokens,
                "estimatedSavedTokens": prompt_report.estimated_saved_tokens,
                "omittedStableTokens": prompt_report.omitted_stable_tokens,
                "prefixCacheEligibleTokens": prompt_report.prefix_cache_eligible_tokens,
                "sceneModules": prompt_report.scene_modules,
                "missedModuleRecovery": prompt_report.missed_module_recovery,
                "sectionHashes": prompt_report.section_hashes,
                "contextTrimmed": request_context_trimmed,
            });
            touch_session(session);
            state.save_state()?;
        }
    }
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
        context_trimmed: provider_context_trimmed || context.trimmed,
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

pub(crate) fn active_skill_prompt(active_skills: &HashSet<String>) -> String {
    let mut prompts = Vec::new();
    if active_skills.contains("lyra-design-research") {
        prompts.push("Skill lyra-design-research: Design/UI work: call Lyra design ref tools first, then include concise Design Research Summary before proposal/UI edit");
    }
    prompts.join("\n")
}

fn openai_responses_stateful_prompt_contract_enabled(configured: bool) -> bool {
    env_bool_override("LYRA_OPENAI_RESPONSES_STATEFUL_PROMPT_CONTRACT").unwrap_or(configured)
}

pub(crate) fn env_bool_override(name: &str) -> Option<bool> {
    std::env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "yes" | "on"))
        .ok()
}

pub(crate) fn combined_memory_prompt(
    memory_records: &[RankedMemoryRecord],
    system_recall_records: &[RankedSystemRecallItem],
    pinned_context_prompt: &str,
) -> String {
    [
        pinned_context_prompt.to_string(),
        shared_memory_prompt(memory_records),
        system_recall_prompt(system_recall_records),
    ]
    .into_iter()
    .filter(|section| !section.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n")
}

pub(crate) fn emit_assistant_text(session_id: &str, turn_id: &str, text: &str) -> Option<String> {
    let message_id = emit_assistant_message_placeholder(session_id, turn_id)?;
    append_assistant_delta(session_id, turn_id, &message_id, text).ok()?;
    Some(message_id)
}

fn active_ui_turn_key(session_id: &str, turn_id: &str) -> String {
    format!("{session_id}:{turn_id}")
}

pub(crate) fn set_active_ui_message_id(session_id: &str, turn_id: &str, message_id: &str) {
    super::session_runtime::set_active_ui_message_id(session_id, turn_id, message_id);
    if let Ok(mut state) = state().lock() {
        state.active_ui_message_by_turn.insert(
            active_ui_turn_key(session_id, turn_id),
            message_id.to_string(),
        );
    }
}

pub(crate) fn active_ui_message_id(session_id: &str, turn_id: &str) -> Option<String> {
    super::session_runtime::active_ui_message_id(session_id, turn_id).or_else(|| {
        state().lock().ok().and_then(|state| {
            state
                .active_ui_message_by_turn
                .get(&active_ui_turn_key(session_id, turn_id))
                .cloned()
        })
    })
}

pub(crate) fn clear_active_ui_message_id(session_id: &str, turn_id: &str) {
    super::session_runtime::clear_active_ui_message_id(session_id, turn_id);
    if let Ok(mut state) = state().lock() {
        state
            .active_ui_message_by_turn
            .remove(&active_ui_turn_key(session_id, turn_id));
    }
}

pub(crate) fn append_tool_block_to_ui_message(session_id: &str, message_id: &str, tool_id: &str) {
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let committed_message = {
                let Some(session) = state.sessions.get_mut(session_id) else {
                    return;
                };
                let Some(messages) = session
                    .snapshot
                    .get_mut("messages")
                    .and_then(Value::as_array_mut)
                else {
                    return;
                };
                let Some(message) = messages
                    .iter_mut()
                    .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
                else {
                    return;
                };
                if !message.get("blocks").is_some_and(Value::is_array) {
                    message["blocks"] = json!([]);
                }
                let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) else {
                    return;
                };
                let already_present = blocks.iter().any(|block| {
                    block.get("type").and_then(Value::as_str) == Some("tool")
                        && block.get("toolId").and_then(Value::as_str) == Some(tool_id)
                });
                if already_present {
                    return;
                }
                blocks.push(json!({
                    "type": "tool",
                    "id": format!("tool-{tool_id}"),
                    "toolId": tool_id,
                }));
                let committed_message = message.clone();
                touch_session(session);
                committed_message
            };
            let _ = state.save_state();
            (callback, committed_message)
        }
        Err(_) => return,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
}

fn assistant_reply_visible_text(
    reply: &crate::native_backend::provider::ModelReply,
) -> Option<String> {
    reply
        .content
        .as_ref()
        .filter(|content| !content.trim().is_empty())
        .cloned()
}

/// Commit assistant text to the factual UI timeline.
/// Tool-round preambles are anchored in the chat transcript and receive tool blocks.
pub(crate) fn commit_visible_assistant_reply(
    session_id: &str,
    turn_id: &str,
    reply: &mut crate::native_backend::provider::ModelReply,
    streamed_message_id: &Option<String>,
) -> bool {
    if reply.tool_calls.is_empty() {
        clear_active_ui_message_id(session_id, turn_id);
        if let Some(message_id) = streamed_message_id
            .as_ref()
            .filter(|message_id| !message_id.is_empty())
        {
            reply.ui_message_id = Some(message_id.clone());
            return true;
        }
        if let Some(content) = reply
            .content
            .as_ref()
            .filter(|content| !content.trim().is_empty())
        {
            reply.ui_message_id = emit_assistant_text(session_id, turn_id, content);
            return reply.ui_message_id.is_some();
        }
        return false;
    }

    let message_id = streamed_message_id
        .as_ref()
        .filter(|message_id| !message_id.is_empty())
        .cloned()
        .or_else(|| emit_assistant_message_placeholder(session_id, turn_id));
    let Some(message_id) = message_id else {
        return false;
    };
    let streamed_live = streamed_message_id
        .as_ref()
        .is_some_and(|message_id| !message_id.is_empty());
    let has_streamed_text = reply
        .content
        .as_ref()
        .is_some_and(|content| !content.trim().is_empty());
    if !(streamed_live && has_streamed_text) {
        if let Some(visible_text) = assistant_reply_visible_text(reply)
            && append_assistant_delta(session_id, turn_id, &message_id, &visible_text).is_err()
        {
            return false;
        }
    }
    set_active_ui_message_id(session_id, turn_id, &message_id);
    reply.ui_message_id = Some(message_id);
    true
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
            // Streaming deltas target the most recently appended assistant message,
            // which lives at the tail of the array. Searching from the back finds it
            // in O(1) for the common case instead of scanning the whole conversation
            // on every token. The message id is unique, so the match is identical to a
            // forward scan.
            let message = messages
                .iter_mut()
                .rev()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
                .ok_or_else(|| {
                    AgentRuntimeError::Core(format!("message not found: {message_id}"))
                })?;
            append_text_to_message(message, delta);
            // Capture the revision before enrich so we can tell whether the
            // render actually changed. enrich only bumps the revision when the
            // rendered AST changed; if it stayed the same we skip re-sending the
            // (potentially large) renderDocument over the event channel.
            let previous_revision = message
                .get("renderRevision")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let (render_document, render_revision) =
                super::message_render::enrich_assistant_message_render(message, true);
            let render_changed = render_revision != previous_revision;
            touch_session(session);
            (callback, render_document, render_revision, render_changed)
        }
        Err(_) => {
            return Err(AgentRuntimeError::Core(
                "agent runtime state lock failed".to_string(),
            ));
        }
    };
    let (callback, render_document, render_revision, render_changed) = callback;
    // Always carry the delta so the frontend can accumulate the raw text, but
    // only attach the render snapshot when it actually changed. The reducer
    // treats a missing renderDocument/renderRevision as "keep the current AST",
    // so this avoids shipping an unchanged AST on every token.
    let mut event = json!({
        "kind": "messageDelta",
        "sessionId": session_id,
        "messageId": message_id,
        "blockId": "text-0",
        "delta": delta,
    });
    if render_changed {
        event["renderDocument"] = render_document;
        event["renderRevision"] = json!(render_revision);
    }
    emit_with_callback(&callback, event);
    Ok(())
}

fn attach_metadata_to_assistant_message(
    snapshot: &mut Value,
    message_id: &str,
    metadata: Value,
) -> Option<Value> {
    if metadata.is_null() || metadata.as_object().is_some_and(Map::is_empty) {
        return None;
    }
    let messages = snapshot.get_mut("messages").and_then(Value::as_array_mut)?;
    let message = messages
        .iter_mut()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))?;
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let existing = message
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut merged = existing;
    if let Some(incoming) = metadata.as_object() {
        for (key, value) in incoming {
            merged.insert(key.clone(), value.clone());
        }
    }
    message["metadata"] = Value::Object(merged);
    super::message_render::enrich_assistant_message_render(message, false);
    Some(message.clone())
}

pub(crate) fn remove_assistant_message(session_id: &str, message_id: &str) -> bool {
    let (callback, removed) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let Some(session) = state.sessions.get_mut(session_id) else {
                return false;
            };
            let Some(messages) = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)
            else {
                return false;
            };
            let original_len = messages.len();
            messages
                .retain(|message| message.get("id").and_then(Value::as_str) != Some(message_id));
            let removed = messages.len() < original_len;
            if removed {
                touch_session(session);
                let _ = state.save_state();
            }
            (callback, removed)
        }
        Err(_) => return false,
    };
    if removed {
        emit_with_callback(
            &callback,
            json!({
                "kind": "sessionSnapshot",
                "snapshot": state()
                    .lock()
                    .ok()
                    .and_then(|state| {
                        state
                            .sessions
                            .get(session_id)
                            .map(|session| session.snapshot.clone())
                    })
                    .unwrap_or(Value::Null),
            }),
        );
    }
    removed
}

fn assistant_message_has_visible_timeline_content(message: &Value) -> bool {
    if message
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| {
            crate::native_backend::tool_protocol::sanitize_visible_assistant_text(text).is_some()
        })
    {
        return true;
    }
    let Some(blocks) = message.get("blocks").and_then(Value::as_array) else {
        return false;
    };
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("tool") | Some("image") => return true,
            Some("text") => {
                if block
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| {
                        crate::native_backend::tool_protocol::sanitize_visible_assistant_text(text)
                            .is_some()
                    })
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn prune_empty_assistant_messages(snapshot: &mut Value) -> usize {
    let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) else {
        return 0;
    };
    let original_len = messages.len();
    messages.retain(|message| {
        message.get("role").and_then(Value::as_str) != Some("assistant")
            || assistant_message_has_visible_timeline_content(message)
    });
    original_len.saturating_sub(messages.len())
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
    let next_text = sanitize_visible_assistant_text(&next_text).unwrap_or_default();
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
            block["text"] = Value::String(
                crate::native_backend::tool_protocol::sanitize_visible_assistant_text(&text)
                    .unwrap_or_default(),
            );
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
    let failure_kind = failure.as_deref().map(tool_protocol::classify_turn_failure);
    finish_turn_with_metadata(
        session_id,
        turn_id,
        status,
        assistant_text,
        failure,
        None,
        failure_kind,
    );
}

pub(crate) fn finish_turn_with_failure_kind(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
    failure_kind: Option<String>,
) {
    finish_turn_with_metadata(
        session_id,
        turn_id,
        status,
        assistant_text,
        failure,
        None,
        failure_kind,
    );
}

pub(crate) fn finish_turn_with_metadata(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
    metadata: Option<Value>,
    failure_kind: Option<String>,
) {
    let failure_for_ledger = failure.clone();
    let failure_kind_for_turn = failure_kind.clone();
    let mut extraction_job: Option<(PathBuf, String, String, String, Option<String>, Vec<Value>)> =
        None;
    let mut recall_index_job: Option<(PathBuf, NativeSession)> = None;
    let mut trim_job: Option<(PathBuf, String)> = None;
    let mut ledger_turn: Option<(PathBuf, NativeSession, String, String, Option<String>)> = None;
    let (callback, events) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let mut events = Vec::new();
            let root = state.root.clone();
            state.active_cancellations.remove(turn_id);
            state.cancelled_turns.remove(turn_id);
            super::session_runtime::clear_active_turn(session_id, turn_id);
            let streamed_message_id = state
                .active_ui_message_by_turn
                .get(&active_ui_turn_key(session_id, turn_id))
                .cloned();
            state
                .active_ui_message_by_turn
                .remove(&active_ui_turn_key(session_id, turn_id));
            let streamed_message_id = streamed_message_id
                .or_else(|| super::session_runtime::active_ui_message_id(session_id, turn_id));
            super::session_runtime::clear_active_ui_message_id(session_id, turn_id);
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
                        let message = assistant_message_with_metadata(text, metadata.clone());
                        push_array(&mut session.snapshot, "messages", message.clone());
                        events.push(json!({
                            "kind": "messageCommitted",
                            "sessionId": session_id,
                            "message": message
                        }));
                    } else if let (Some(metadata), Some(message_id)) =
                        (metadata.clone(), streamed_message_id)
                    {
                        if let Some(message) = attach_metadata_to_assistant_message(
                            &mut session.snapshot,
                            &message_id,
                            metadata,
                        ) {
                            events.push(json!({
                                "kind": "messageCommitted",
                                "sessionId": session_id,
                                "message": message
                            }));
                        }
                    }
                    session.snapshot["turnStatus"] = Value::String(status.to_string());
                    session.snapshot["activeTurnId"] = Value::Null;
                    session.snapshot["follow"] =
                        json!({ "running": false, "activity": Value::Null });
                    if status == "failed" {
                        if let Some(failure_kind) = failure_kind_for_turn.as_deref() {
                            update_runtime_turn_state(
                                session,
                                turn_id,
                                "failed_recoverable",
                                Some(failure_kind),
                            );
                        } else {
                            update_runtime_turn(session, turn_id, status);
                        }
                        sync_failure_resilience_state(session);
                    } else {
                        update_runtime_turn(session, turn_id, status);
                    }
                    let _ = prune_empty_assistant_messages(&mut session.snapshot);
                    let retention_metrics = prune_transient_tool_outputs(session);
                    touch_session(session);
                    recall_index_job = Some((root.clone(), session.clone()));
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
                        let session_messages = session
                            .snapshot
                            .get("messages")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        extraction_job = Some((
                            root.clone(),
                            session_id.to_string(),
                            turn_id.to_string(),
                            latest_user,
                            assistant_for_extraction,
                            session_messages,
                        ));
                        trim_job = Some((root.clone(), session_id.to_string()));
                    }
                    ledger_turn = Some((
                        root.clone(),
                        session.clone(),
                        turn_id.to_string(),
                        status.to_string(),
                        failure_for_ledger.clone(),
                    ));
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
                            "message": failure.clone().unwrap_or_else(|| "turn failed".to_string()),
                            "failureKind": failure_kind_for_turn
                                .clone()
                                .unwrap_or_else(|| tool_protocol::classify_turn_failure(
                                    failure.as_deref().unwrap_or("turn failed")
                                ))
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
    if let Some((root, session)) = recall_index_job {
        let _ = index_session_messages_for_recall(&root, &session);
    }
    if let Some((root, session, turn_id, status, failure)) = ledger_turn {
        let _ = record_turn_finished(&root, &session, &turn_id, &status, failure.as_deref());
    }
    if let Some((root, session_id, turn_id, user_text, assistant_text, session_messages)) =
        extraction_job
    {
        spawn_post_turn_memory_extraction(
            root.clone(),
            session_id.clone(),
            turn_id.clone(),
            user_text,
            assistant_text,
        );
        maybe_emit_token_checkpoint_trigger(&root, &session_id, &turn_id, &session_messages);
    }
    if let Some((root, session_id)) = trim_job {
        spawn_post_turn_session_trim(root, session_id);
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

pub(crate) const STALE_WAITING_FOR_TOOL_WITHOUT_RUNNING_TOOL_MS: i64 = 60_000;

pub(crate) fn reconcile_orphan_running_turn(
    session: &mut NativeSession,
    has_live_cancellation_token: bool,
    reason: &str,
) -> bool {
    let turn_status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or("idle");
    let active_turn_id = session
        .snapshot
        .get("activeTurnId")
        .and_then(Value::as_str)
        .map(str::to_string);
    if turn_status != "running" {
        return false;
    }
    let stale_waiting_for_tool = active_turn_id
        .as_deref()
        .is_some_and(|turn_id| stale_waiting_for_tool_without_running_tool(session, turn_id));
    if has_live_cancellation_token && active_turn_id.is_some() && !stale_waiting_for_tool {
        return false;
    }
    let turn_id = active_turn_id.unwrap_or_else(|| format!("orphan-turn-{}", Uuid::new_v4()));
    session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
    session.snapshot["activeTurnId"] = Value::Null;
    finalize_interrupt_state(session, reason);
    let recovery_message = if stale_waiting_for_tool {
        "Lyra marked this turn as interrupted because it was still waiting for a tool even though no tool was running."
    } else {
        "Lyra marked this turn as cancelled because no live runtime worker was attached to it."
    };
    finish_running_tools_for_turn(
        session,
        &turn_id,
        "cancelled",
        json!({ "content": recovery_message }),
    );
    let failure_kind = if stale_waiting_for_tool {
        "stale_waiting_for_tool_without_running_tools"
    } else {
        reason
    };
    update_runtime_turn_state(session, &turn_id, "interrupted", Some(failure_kind));
    touch_session(session);
    true
}

fn stale_waiting_for_tool_without_running_tool(session: &NativeSession, turn_id: &str) -> bool {
    let Some(turn) = session
        .runtime_turns
        .iter()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id))
    else {
        return false;
    };
    if turn.get("state").and_then(Value::as_str) != Some("waiting_for_tool") {
        return false;
    }
    if running_tool_for_turn(session, turn_id) {
        return false;
    }
    let updated_at_ms = turn
        .get("updatedAtMs")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    Utc::now().timestamp_millis().saturating_sub(updated_at_ms)
        >= STALE_WAITING_FOR_TOOL_WITHOUT_RUNNING_TOOL_MS
}

fn running_tool_for_turn(session: &NativeSession, turn_id: &str) -> bool {
    session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|tool| {
            if tool.get("status").and_then(Value::as_str) != Some("running") {
                return false;
            }
            let tool_turn_id = super::activity::tool_runtime_turn_id(tool);
            tool_turn_id.is_none_or(|value| value == turn_id)
        })
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
    if super::session_runtime::turn_cancellation_requested(turn_id) {
        return true;
    }
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
    if let Some(turn_id) = super::session_runtime::active_turn_id(&id) {
        super::session_runtime::request_turn_cancellation(&turn_id);
    }
    let (turn_id, callback, events, ledger_turn) = {
        let mut state = match state().try_lock() {
            Ok(state) => state,
            Err(std::sync::TryLockError::WouldBlock) => {
                return Ok(json!({
                    "sessionId": id,
                    "status": "cancelling",
                    "deferred": true,
                }));
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err(AgentRuntimeError::Core(
                    "agent runtime state lock failed".to_string(),
                ));
            }
        };
        let root = state.root.clone();
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
        super::session_runtime::request_turn_cancellation(&turn_id);
        let session = state
            .sessions
            .get_mut(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
        session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
        session.snapshot["activeTurnId"] = Value::Null;
        finalize_interrupt_state(session, "cancelled_by_user");
        finish_running_tools_for_turn(
            session,
            &turn_id,
            "cancelled",
            json!({ "content": "Lyra tool call was cancelled by the user." }),
        );
        update_runtime_turn(session, &turn_id, "cancelled");
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let ledger_session = session.clone();
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
        (
            turn_id,
            callback,
            events,
            (root, ledger_session, "cancelled".to_string()),
        )
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    let (root, session, status) = ledger_turn;
    let _ = record_turn_finished(
        &root,
        &session,
        &turn_id,
        &status,
        Some("turn cancelled by user"),
    );
    Ok(json!({
        "sessionId": id,
        "turnId": turn_id,
        "status": "cancelling"
    }))
}

#[cfg(test)]
mod narration_tests {
    use super::*;
    use crate::native_backend::provider::ModelToolCall;

    #[test]
    fn omits_visible_text_when_model_returns_tool_calls_without_prose() {
        let visible = assistant_reply_visible_text(&crate::native_backend::provider::ModelReply {
            content: None,
            reasoning_content: None,
            tool_calls: vec![ModelToolCall {
                id: "call-1".to_string(),
                name: "tool_fs_run".to_string(),
                arguments: json!({ "path": "/tools/browser/map" }),
            }],
            ui_message_id: None,
            provider_replay_items: Vec::new(),
            stop_signal: Default::default(),
        });
        assert_eq!(visible, None);
    }

    #[test]
    fn returns_model_prose_for_tool_rounds() {
        let visible = assistant_reply_visible_text(&crate::native_backend::provider::ModelReply {
            content: Some("Opening Google.".to_string()),
            reasoning_content: None,
            tool_calls: vec![ModelToolCall {
                id: "call-1".to_string(),
                name: "tool_fs_run".to_string(),
                arguments: json!({ "path": "/tools/browser/navigate" }),
            }],
            ui_message_id: None,
            provider_replay_items: Vec::new(),
            stop_signal: Default::default(),
        });
        assert_eq!(visible.as_deref(), Some("Opening Google."));
    }
}
