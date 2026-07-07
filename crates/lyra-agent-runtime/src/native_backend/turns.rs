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
    let only_if_idle = payload
        .get("onlyIfIdle")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let goal_continuation = payload
        .get("goalContinuation")
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
        if only_if_idle {
            let turn_status = state
                .sessions
                .get(&session_id)
                .and_then(|s| s.snapshot.get("turnStatus").and_then(Value::as_str))
                .unwrap_or("idle");
            if turn_status != "idle" {
                return Ok(json!({
                    "sessionId": session_id,
                    "turnId": Value::Null,
                    "status": "idle",
                    "sent": false,
                    "reason": "session_not_idle"
                }));
            }
        }
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
            let mut meta = json!({ "uiHidden": true });
            if goal_continuation {
                meta["goalContinuation"] = json!(true);
            }
            user_message["metadata"] = meta;
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
            );
            // goal continuation: 只在成功 turn 后触发，错误/取消 turn 不继续
            evaluate_goal_continuation(&session_id, &turn_id);
        }
        Err(error) => {
            let failure_message = error.to_string();
            emit_assistant_error_message(&session_id, &turn_id, &failure_message);
            finish_turn_with_metadata(
                &session_id,
                &turn_id,
                "finished",
                None,
                Some(failure_message),
                None,
                None,
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
        session_created_at,
        turn_count,
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
            session_created_at,
            turn_count,
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
                session.created_at.clone(),
                session.runtime_turns.len() as u64,
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
            session_created_at,
            turn_count,
        )
    };
    let provider = providers::transport::auth::provider_with_resolved_api_key(
        provider,
        host_dispatcher.as_ref(),
    )?;
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
    let tools = if capabilities.supports_tool_calling {
        model_tools()
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
    runtime_context["interactionContract"] = interaction_contract_runtime_context();
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
    runtime_context["activeSkills"] = active_skill_context(&active_skills);
    // Phase 4.2: inject code-graph project context into the prompt.
    if let Some(dir) = working_dir.as_deref().filter(|d| !d.is_empty()) {
        runtime_context["projectContext"] =
            tools::project_context_for_prompt(std::path::Path::new(dir));
    }
    // Phase 6: inject CodeGraph signal-driven fragments + presearch hints.
    // Runs deterministic symbol resolution + neighborhood pre-fetch (no LLM,
    // μs-ms level). Falls back gracefully to empty signals when the graph is
    // not Ready — the P6 prompt section is skipped in that case.
    if let Some(dir) = working_dir.as_deref().filter(|d| !d.is_empty()) {
        // Sync the embedding toggle from the host before running signals.
        // This controls whether run_mcp_tool_sync creates McpServer with or
        // without graph_only mode (enables memory search / semantic search).
        if let Some(ref dispatcher) = host_dispatcher {
            if let Ok(value) = super::activity::invoke_host_capability(
                dispatcher,
                "agent.readCodeGraphEmbeddingEnabled",
                json!({}),
            ) {
                let enabled = value.get("enabled").and_then(Value::as_bool).unwrap_or(false);
                tools::codegraph::engine().set_embeddings_enabled(enabled);
            }
        }
        let signals = tools::codegraph_signals_for_prompt(
            Some(std::path::Path::new(dir)),
            &latest_user_text,
            Some(&session_id),
            tools::CODEGRAPH_FRAGMENT_BUDGET_TOKENS,
        );
        let extra_hints = tools::codegraph_presearch_hints_from_signals(&signals);
        runtime_context["codegraphSignals"] =
            tools::codegraph_signals_to_runtime_value(&signals);
        // Extend presearchHints with codegraph tool entries so the model can
        // discover the pre-fetched tools without an extra search round.
        if !extra_hints.is_empty() {
            if let Some(arr) = runtime_context
                .get_mut("toolFilesystem")
                .and_then(|tf| tf.get_mut("presearchHints"))
                .and_then(Value::as_array_mut)
            {
                arr.extend(extra_hints);
            }
        }
    }
    runtime_context["tools"] = json!(if capabilities.supports_tool_calling {
        model_tool_names()
    } else {
        Vec::new()
    });
    // Spatiotemporal awareness: inject session time + workspace layout so the
    // agent has a coherent sense of "how long I've been here" and "what's on
    // screen right now". Session age is derived from the session's created_at
    // timestamp; workspace layout comes from the host capability.
    {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let session_age_seconds = (now_ms - super::helpers::iso_ms(&session_created_at)).max(0) as u64 / 1000;
        let seconds_since_last_interaction = session_messages
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(Value::as_str) == Some("user"))
            .and_then(|m| m.get("createdAt").and_then(Value::as_str))
            .map(|t| ((now_ms - super::helpers::iso_ms(t)).max(0) as u64 / 1000))
            .unwrap_or(0);
        let workspace = if let Some(ref dispatcher) = host_dispatcher {
            super::activity::invoke_host_capability(
                dispatcher,
                "agent.readSpatiotemporalContext",
                json!({}),
            ).unwrap_or_else(|_| json!({}))
        } else {
            json!({})
        };
        runtime_context["spatiotemporal"] = json!({
            "session": {
                "startedAt": session_created_at,
                "ageSeconds": session_age_seconds,
                "turnCount": turn_count,
                "secondsSinceLastInteraction": seconds_since_last_interaction,
            },
            "workspace": workspace,
        });
    }
    let persona_context = read_host_persona_context(host_dispatcher.as_ref());
    // 采集本地信号 → 计算身份 — 纯本地操作，无网络请求，毫秒级
    // ponytail: 每 turn 都重算，未缓存。升级路径：启动时算一次，缓存到 ~/.lyra/modules/persona/
    let local_signals = crate::persona::collect_local_signals(Default::default());
    let computed_persona = crate::persona::compute_persona(&local_signals, None);
    let prompt_report = build_system_prompt_report(
        &runtime_context,
        &latest_user_text,
        &persona_context,
        &active_skill_prompt(&active_skills),
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
        Some(computed_persona),
        state.first_used_at.as_deref(),
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
                "codegraphFragmentReport": prompt_report.codegraph_fragment_report,
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
        // ponytail: 把既有降级信号出声化——降级不是终点而是决策点，
        // 引导模型评估能否用 Lyra 的浏览器/在线 AI 等路径把被省略的输入补回，而非直接放弃。
        messages.insert(
            1,
            json!({
                "role": "system",
                "content": format!(
                    "Structured input downgrade report: {}\nThis input was dropped before reaching U, not lost for good. Judge if it's worth recovering through Lyra — browser can open an online AI/tool that views or processes what U can't here. Decide, don't silently skip.",
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
    active_skill_prompt_for(active_skills)
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
    commit_assistant_message(session_id, turn_id, &message_id);
    Some(message_id)
}

pub(crate) fn emit_assistant_error_message(
    session_id: &str,
    turn_id: &str,
    failure_message: &str,
) -> Option<String> {
    let text = if failure_message.trim().is_empty() {
        "Agent turn failed without an error message.".to_string()
    } else {
        failure_message.trim().to_string()
    };
    let message_id = emit_assistant_message_placeholder(session_id, turn_id)?;
    append_assistant_delta(session_id, turn_id, &message_id, &text).ok()?;
    commit_assistant_message(session_id, turn_id, &message_id);
    attach_metadata_to_active_assistant_message(
        session_id,
        turn_id,
        &message_id,
        json!({ "isApiError": true }),
    );
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
                let existing_text = message
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                ensure_existing_text_block(message, &existing_text);
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
            stamp_reasoning_content(session_id, message_id, reply.reasoning_content.as_deref());
            commit_assistant_message(session_id, turn_id, message_id);
            return true;
        }
        if let Some(content) = reply
            .content
            .as_ref()
            .filter(|content| !content.trim().is_empty())
        {
            reply.ui_message_id = emit_assistant_text(session_id, turn_id, content);
            if let Some(ref id) = reply.ui_message_id {
                stamp_reasoning_content(session_id, id, reply.reasoning_content.as_deref());
            }
            return reply.ui_message_id.is_some();
        }
        return false;
    }

    let message_id = streamed_message_id
        .as_ref()
        .filter(|message_id| !message_id.is_empty())
        .cloned()
        .or_else(|| active_ui_message_id(session_id, turn_id))
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
    if has_streamed_text || assistant_reply_visible_text(reply).is_some() {
        commit_assistant_message(session_id, turn_id, &message_id);
    }
    set_active_ui_message_id(session_id, turn_id, &message_id);
    stamp_reasoning_content(session_id, &message_id, reply.reasoning_content.as_deref());
    reply.ui_message_id = Some(message_id);
    true
}

fn ensure_existing_text_block(message: &mut Value, text: &str) {
    if text.is_empty() {
        return;
    }
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([]);
    }
    let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) else {
        return;
    };
    if blocks.iter().any(|block| {
        block.get("type").and_then(Value::as_str) == Some("text")
            && block
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
    }) {
        return;
    }
    if let Some(block) = blocks
        .first_mut()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
    {
        block["text"] = Value::String(text.to_string());
        return;
    }
    blocks.insert(0, json!({ "type": "text", "id": "text-0", "text": text }));
}

fn append_reasoning_to_message(message: &mut Value, delta: &str, status: &str) -> String {
    append_string_field(message, "reasoningContent", delta);
    let existing_text = missing_text_block(message).then(|| {
        message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    });
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([]);
    }
    if let Some(existing_text) = existing_text {
        ensure_existing_text_block(message, &existing_text);
    }
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        if let Some(block) = blocks
            .last_mut()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("thinking"))
        {
            let block_id = block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("thinking-0")
                .to_string();
            append_string_field(block, "text", delta);
            block["status"] = Value::String(status.to_string());
            return block_id;
        }
        let block_id = format!("thinking-{}", blocks.len());
        blocks.push(json!({ "type": "thinking", "id": block_id, "text": delta, "status": status }));
        return block_id;
    }
    "thinking-0".to_string()
}

fn finish_reasoning_blocks(message: &mut Value, reasoning: &str) {
    let existing_text = message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    ensure_existing_text_block(message, &existing_text);
    let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) else {
        message["blocks"] = json!([
            { "type": "thinking", "id": "thinking-0", "text": reasoning, "status": "done" }
        ]);
        return;
    };
    let has_thinking = blocks
        .iter()
        .any(|block| block.get("type").and_then(Value::as_str) == Some("thinking"));
    if has_thinking {
        for block in blocks {
            if block.get("type").and_then(Value::as_str) == Some("thinking") {
                block["status"] = Value::String("done".to_string());
            }
        }
        return;
    }
    blocks.insert(
        0,
        json!({ "type": "thinking", "id": "thinking-0", "text": reasoning, "status": "done" }),
    );
}

/// Stamp `reasoningContent` onto a UI assistant message and mark status as done.
fn stamp_reasoning_content(session_id: &str, message_id: &str, reasoning: Option<&str>) {
    let (callback, committed_message) = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        let callback = state.event_callback.clone();
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
            .rev()
            .find(|m| m.get("id").and_then(Value::as_str) == Some(message_id))
        else {
            return;
        };
        // Providers that stream thinking deltas hand back reasoning_content: None
        // at commit time — the reasoning already lives on the message from the
        // delta path. Fall back to it so the status still flips to "done" instead
        // of sticking on "thinking" forever.
        let reasoning = reasoning
            .filter(|r| !r.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                message
                    .get("reasoningContent")
                    .and_then(Value::as_str)
                    .filter(|r| !r.trim().is_empty())
                    .map(str::to_string)
            });
        let Some(reasoning) = reasoning else {
            return;
        };
        message["reasoningContent"] = json!(reasoning);
        message["reasoningStatus"] = json!("done");
        finish_reasoning_blocks(message, &reasoning);
        let committed_message = message.clone();
        touch_session(session);
        let _ = state.save_state();
        (callback, committed_message)
    };
    // Tool-call-only replies never reach commit_assistant_message, so without
    // this event the renderer keeps showing the thinking spinner even though
    // the snapshot already says "done".
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
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
    set_active_ui_message_id(session_id, turn_id, &message_id);
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
            let block_id = append_text_to_message(message, delta);
            touch_session(session);
            (callback, block_id)
        }
        Err(_) => {
            return Err(AgentRuntimeError::Core(
                "agent runtime state lock failed".to_string(),
            ));
        }
    };
    // Streaming must stay lightweight: ship only raw text deltas. The frontend
    // renders an immediate plain/code view while the model is still writing,
    // and the finalized assistant message is enriched once at commit time.
    let event = json!({
        "kind": "messageDelta",
        "sessionId": session_id,
        "messageId": message_id,
        "blockId": callback.1,
        "delta": delta,
    });
    emit_with_callback(&callback.0, event);
    Ok(())
}

pub(crate) fn append_assistant_reasoning_delta(
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
                .rev()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
                .ok_or_else(|| {
                    AgentRuntimeError::Core(format!("message not found: {message_id}"))
                })?;
            let block_id = append_reasoning_to_message(message, delta, "thinking");
            message["reasoningStatus"] = json!("thinking");
            touch_session(session);
            (callback, block_id)
        }
        Err(_) => {
            return Err(AgentRuntimeError::Core(
                "agent runtime state lock failed".to_string(),
            ));
        }
    };
    let event = json!({
        "kind": "messageReasoningDelta",
        "sessionId": session_id,
        "messageId": message_id,
        "blockId": callback.1,
        "delta": delta,
    });
    emit_with_callback(&callback.0, event);
    Ok(())
}

pub(crate) struct StreamDeltaBatcher {
    visible: String,
    reasoning: String,
    last_flush: Instant,
}

impl Default for StreamDeltaBatcher {
    fn default() -> Self {
        Self {
            visible: String::new(),
            reasoning: String::new(),
            last_flush: Instant::now(),
        }
    }
}

impl StreamDeltaBatcher {
    const MAX_BYTES: usize = 160;
    const MAX_WAIT: Duration = Duration::from_millis(32);

    pub(crate) fn push_visible(
        &mut self,
        delta: &str,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        let mut flushed = self.flush_reasoning(ui_message_id, session_id, turn_id)?;
        self.visible.push_str(delta);
        flushed |= self.flush_if_ready(ui_message_id, session_id, turn_id)?;
        Ok(flushed)
    }

    pub(crate) fn push_reasoning(
        &mut self,
        delta: &str,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        let mut flushed = self.flush_visible(ui_message_id, session_id, turn_id)?;
        self.reasoning.push_str(delta);
        flushed |= self.flush_if_ready(ui_message_id, session_id, turn_id)?;
        Ok(flushed)
    }

    pub(crate) fn flush(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        let visible_flushed = self.flush_visible(ui_message_id, session_id, turn_id)?;
        let reasoning_flushed = self.flush_reasoning(ui_message_id, session_id, turn_id)?;
        if visible_flushed || reasoning_flushed {
            self.last_flush = Instant::now();
        }
        Ok(visible_flushed || reasoning_flushed)
    }

    fn flush_if_ready(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        if self.visible.len() + self.reasoning.len() < Self::MAX_BYTES
            && self.last_flush.elapsed() < Self::MAX_WAIT
        {
            return Ok(false);
        }
        self.flush(ui_message_id, session_id, turn_id)
    }

    fn flush_visible(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        if self.visible.is_empty() {
            return Ok(false);
        }
        let delta = std::mem::take(&mut self.visible);
        let message_id = ui_message_id
            .get_or_insert_with(|| {
                emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
            })
            .clone();
        if !message_id.is_empty() {
            append_assistant_delta(session_id, turn_id, &message_id, &delta)?;
        }
        Ok(true)
    }

    fn flush_reasoning(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        if self.reasoning.is_empty() {
            return Ok(false);
        }
        let delta = std::mem::take(&mut self.reasoning);
        append_reasoning_delta(&delta, ui_message_id, session_id, turn_id)?;
        Ok(true)
    }
}

/// Stream a reasoning delta to the UI, creating a placeholder message if needed.
pub(crate) fn append_reasoning_delta(
    delta: &str,
    ui_message_id: &mut Option<String>,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    if delta.is_empty() {
        return Ok(());
    }
    let message_id = ui_message_id
        .get_or_insert_with(|| {
            emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
        })
        .clone();
    if !message_id.is_empty() {
        append_assistant_reasoning_delta(session_id, turn_id, &message_id, delta)?;
    }
    Ok(())
}

fn commit_assistant_message(session_id: &str, turn_id: &str, message_id: &str) -> Option<Value> {
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let session = state.sessions.get_mut(session_id)?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return None;
            }
            let messages = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)?;
            let message = messages
                .iter_mut()
                .rev()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))?;
            if message.get("role").and_then(Value::as_str) != Some("assistant") {
                return None;
            }
            let committed_message = message.clone();
            touch_session(session);
            let _ = state.save_state();
            (callback, committed_message)
        }
        Err(_) => return None,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
    Some(committed_message)
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
    Some(message.clone())
}

fn attach_metadata_to_active_assistant_message(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
    metadata: Value,
) -> Option<Value> {
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = state.event_callback.clone();
            let session = state.sessions.get_mut(session_id)?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return None;
            }
            let committed_message =
                attach_metadata_to_assistant_message(&mut session.snapshot, message_id, metadata)?;
            touch_session(session);
            let _ = state.save_state();
            (callback, committed_message)
        }
        Err(_) => return None,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
    Some(committed_message)
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
            Some("thinking") => {
                if block
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.trim().is_empty())
                {
                    return true;
                }
            }
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

pub(crate) fn append_text_to_message(message: &mut Value, delta: &str) -> String {
    let previous_text = missing_text_block(message).then(|| {
        message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    });
    append_string_field(message, "text", delta);
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([{ "type": "text", "id": "text-0", "text": "" }]);
    }
    if let Some(previous_text) = previous_text {
        ensure_existing_text_block(message, &previous_text);
    }
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        if let Some(block) = blocks
            .last_mut()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        {
            let block_id = block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("text-0")
                .to_string();
            append_string_field(block, "text", delta);
            return block_id;
        } else {
            let block_id = format!("text-{}", blocks.len());
            blocks.push(json!({ "type": "text", "id": block_id, "text": delta }));
            return block_id;
        }
    }
    "text-0".to_string()
}

fn append_string_field(value: &mut Value, key: &str, delta: &str) {
    match value.get_mut(key) {
        Some(Value::String(text)) => text.push_str(delta),
        _ => value[key] = Value::String(delta.to_string()),
    }
}

fn missing_text_block(message: &Value) -> bool {
    let Some(text) = message.get("text").and_then(Value::as_str) else {
        return false;
    };
    if text.is_empty() {
        return false;
    }
    !message
        .get("blocks")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|block| {
                block.get("type").and_then(Value::as_str) == Some("text")
                    && block
                        .get("text")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
            })
        })
}

pub(crate) fn finish_turn(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
) {
    finish_turn_with_metadata(
        session_id,
        turn_id,
        status,
        assistant_text,
        failure,
        None,
        None,
    );
}

pub(crate) fn finish_turn_with_metadata(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
    metadata: Option<Value>,
    _failure_kind: Option<String>,
) {
    let failure_for_ledger = failure.clone();
    let mut compress_check_job: Option<(PathBuf, String, String)> = None;
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
            let in_flight = state.active_compressions.contains(session_id);
            if let Some(session) = state.sessions.get_mut(session_id) {
                if session.snapshot.get("activeTurnId").and_then(Value::as_str) == Some(turn_id) {
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
                    session.snapshot["turnStatus"] =
                        Value::String(session_turn_status_for_finish_status(status).to_string());
                    session.snapshot["activeTurnId"] = Value::Null;
                    session.snapshot["follow"] =
                        json!({ "running": false, "activity": Value::Null });
                    update_runtime_turn(session, turn_id, status);
                    let _ = prune_empty_assistant_messages(&mut session.snapshot);
                    let retention_metrics = prune_transient_tool_outputs(session);
                    prune_goal_continuation_messages(&mut session.snapshot);
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
                        let total_tokens =
                            crate::native_backend::token_estimate::estimate_messages_tokens(
                                &session_messages,
                            );
                        let baseline = session
                            .snapshot
                            .pointer("/memoryCompression/compressedTokenBaseline")
                            .and_then(Value::as_u64)
                            .map(|v| v as usize)
                            .unwrap_or(0);
                        let compressed_up_to = session
                            .snapshot
                            .pointer("/memoryCompression/compressedUpToMessageOrdinal")
                            .and_then(Value::as_u64)
                            .map(|v| v as usize)
                            .unwrap_or(0);
                        let has_uncompressed =
                            session_messages.iter().skip(compressed_up_to).any(|msg| {
                                matches!(
                                    msg.get("role").and_then(Value::as_str),
                                    Some("user") | Some("assistant")
                                )
                            });
                        if total_tokens.saturating_sub(baseline)
                            >= super::memory_compress::EXTRACT_COMPRESS_THRESHOLD
                            && has_uncompressed
                            && !in_flight
                        {
                            compress_check_job =
                                Some((root.clone(), session_id.to_string(), turn_id.to_string()));
                        }
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
    if let Some((root, session_id, turn_id)) = compress_check_job {
        super::memory_compress::spawn_extract_and_compress(root, session_id, turn_id);
    }
    if let Some((root, session_id)) = trim_job {
        spawn_post_turn_session_trim(root, session_id);
    }
}

fn session_turn_status_for_finish_status(status: &str) -> &'static str {
    match status {
        "cancelled" => "cancelled",
        _ => "idle",
    }
}

pub(crate) fn update_runtime_turn(session: &mut NativeSession, turn_id: &str, status: &str) {
    let state_name = match status {
        "finished" => "completed",
        "cancelled" => "cancelled_by_user",
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
                "completed" | "cancelled_by_user" | "interrupted"
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

// ── Goal continuation ───────────────────────────────────────────────────
// turn 成功结束后，系统评估是否需要自动继续推进 goal。
// 判定信号：plan 处于 executing_todo 阶段 + 未完成 todo + CodeGraph staleness。
// 触发方式：send_turn(uiHidden=true, goalContinuation=true, onlyIfIdle=true)。
// continuation prompt 在 turn 结束后被 prune_goal_continuation_messages 剪除，
// 不保留在会话历史，不持续占用 model context。

/// 从 messages 中移除 metadata.goalContinuation == true 的 user 消息。
/// 这些是系统自动发送的 continuation prompt，turn 结束后不保留在会话历史。
fn prune_goal_continuation_messages(snapshot: &mut Value) {
    let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) else {
        return;
    };
    messages.retain(|msg| {
        !(msg.get("role").and_then(Value::as_str) == Some("user")
            && msg.pointer("/metadata/goalContinuation") == Some(&Value::Bool(true)))
    });
}

/// CodeGraph 信号：是否需要因为未验证的文件变更而继续。
enum CodeGraphSignal {
    /// 未就绪 / 超时 / 无项目 — 跳过 CodeGraph 判定，仅用 todo 判定
    Skip,
    /// Ready 且无 stale 文件
    Fresh,
    /// Ready 但有未验证的变更文件
    Stale(Vec<String>),
}

/// 等待 CodeGraph 索引就绪，最多等 timeout。
/// 如果当前 Idle，先触发索引再等。
fn wait_codegraph_ready(working_dir: &Path, timeout: Duration) -> lyra_code_intel_core::IndexStatus {
    let start = Instant::now();
    let mut status = index_status(working_dir);
    if matches!(status, lyra_code_intel_core::IndexStatus::Idle) {
        trigger_indexing(working_dir);
        status = index_status(working_dir);
    }
    while matches!(status, lyra_code_intel_core::IndexStatus::Indexing { .. }) {
        if start.elapsed() >= timeout {
            return status;
        }
        thread::sleep(Duration::from_millis(200));
        status = index_status(working_dir);
    }
    status
}

/// 检查 CodeGraph 信号：等待就绪 → 查 staleness。
/// working_dir 为 None 时直接返回 Skip。
fn check_codegraph_signal(working_dir: Option<&str>) -> CodeGraphSignal {
    let Some(dir) = working_dir else {
        return CodeGraphSignal::Skip;
    };
    let path = Path::new(dir);
    let status = wait_codegraph_ready(path, Duration::from_secs(10));
    match status {
        lyra_code_intel_core::IndexStatus::Ready { .. } => {
            match codegraph_staleness(path) {
                Ok(info) if info.stale && !info.changed_files.is_empty() => {
                    CodeGraphSignal::Stale(info.changed_files)
                }
                _ => CodeGraphSignal::Fresh,
            }
        }
        _ => CodeGraphSignal::Skip,
    }
}

/// 动态拼装 continuation prompt。
/// 根据触发的信号（未完成 todo / CodeGraph stale）组合不同内容。
fn build_continuation_prompt(incomplete: &[&Value], codegraph: &CodeGraphSignal) -> String {
    let mut sections = Vec::new();
    sections.push("[Goal Continuation] 当前 plan 仍处于执行阶段，需要继续推进。".to_string());

    if !incomplete.is_empty() {
        sections.push(format!("\n未完成 todo（{} 个）：", incomplete.len()));
        for todo in incomplete {
            let status = todo
                .pointer("/status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            let content = todo
                .pointer("/content")
                .and_then(Value::as_str)
                .unwrap_or("");
            let id = todo
                .pointer("/id")
                .and_then(Value::as_str)
                .unwrap_or("");
            sections.push(format!("  - [{}] [{}] {}", id, status, content));
        }
    }

    if let CodeGraphSignal::Stale(files) = codegraph {
        sections.push("\nCodeGraph 检测到以下文件已修改但尚未完成索引验证：".to_string());
        for file in files.iter().take(10) {
            sections.push(format!("  - {}", file));
        }
        if files.len() > 10 {
            sections.push(format!("  ... 及其他 {} 个文件", files.len() - 10));
        }
        if incomplete.is_empty() {
            sections.push("所有 todo 已完成，请检查这些文件的变更是否正确完整。".to_string());
        }
    }

    if !incomplete.is_empty() {
        sections.push("\n请继续推进未完成的工作。".to_string());
    }
    sections.join("\n")
}

/// turn 成功结束后，评估是否需要 goal continuation。
/// 满足条件时通过 send_turn 发送一条 uiHidden + goalContinuation 的隐式 prompt。
fn evaluate_goal_continuation(session_id: &str, _turn_id: &str) {
    // 1. 持锁读取 session 状态
    let (incomplete, working_dir) = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        let Some(session) = state.sessions.get(session_id) else {
            return;
        };

        // plan 不在执行阶段 → 无活跃 goal
        let phase = session
            .snapshot
            .pointer("/plan/phase")
            .and_then(Value::as_str);
        if phase != Some(PLAN_PHASE_EXECUTING_TODO) {
            return;
        }

        // turnStatus 非 idle → 用户已发新消息，不抢夺
        let turn_status = session
            .snapshot
            .get("turnStatus")
            .and_then(Value::as_str)
            .unwrap_or("idle");
        if turn_status != "idle" {
            return;
        }

        let todos = session.snapshot.get("todos").and_then(Value::as_array);
        let incomplete: Vec<Value> = todos
            .map(|arr| {
                arr.iter()
                    .filter(|t| {
                        let s = t
                            .pointer("/status")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        s == "pending" || s == "in_progress"
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();

        let working_dir = session
            .snapshot
            .get("workingDir")
            .and_then(Value::as_str)
            .map(String::from);
        (incomplete, working_dir)
    }; // 锁释放

    // 2. 检查 CodeGraph（锁外，最多等 10s）
    let codegraph = check_codegraph_signal(working_dir.as_deref());

    // 3. 判定
    let todo_incomplete = !incomplete.is_empty();
    let codegraph_has_issues = matches!(&codegraph, CodeGraphSignal::Stale(f) if !f.is_empty());
    if !todo_incomplete && !codegraph_has_issues {
        return; // 目标完成
    }

    // 4. 动态拼装 prompt
    let incomplete_refs: Vec<&Value> = incomplete.iter().collect();
    let prompt = build_continuation_prompt(&incomplete_refs, &codegraph);

    // 5. 发送 continuation turn（uiHidden + goalContinuation + onlyIfIdle）
    let _ = send_turn(json!({
        "sessionId": session_id,
        "text": prompt,
        "uiHidden": true,
        "goalContinuation": true,
        "onlyIfIdle": true
    }));
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

    #[test]
    fn finished_turn_status_releases_session_to_idle() {
        assert_eq!(session_turn_status_for_finish_status("finished"), "idle");
        assert_eq!(
            session_turn_status_for_finish_status("cancelled"),
            "cancelled"
        );
    }

    #[test]
    fn assistant_blocks_keep_text_after_reasoning_in_order() {
        let mut message = json!({
            "text": "先说一句。",
            "blocks": [{ "type": "text", "id": "text-0", "text": "先说一句。" }]
        });

        let thinking_id = append_reasoning_to_message(&mut message, "中间思考。", "thinking");
        let text_id = append_text_to_message(&mut message, "再说一句。");

        assert_eq!(thinking_id, "thinking-1");
        assert_eq!(text_id, "text-2");
        assert_eq!(
            message["blocks"],
            json!([
                { "type": "text", "id": "text-0", "text": "先说一句。" },
                { "type": "thinking", "id": "thinking-1", "text": "中间思考。", "status": "thinking" },
                { "type": "text", "id": "text-2", "text": "再说一句。" }
            ])
        );
    }

    #[test]
    fn reasoning_preserves_legacy_text_without_blocks() {
        let mut message = json!({
            "text": "先说一句。"
        });

        let thinking_id = append_reasoning_to_message(&mut message, "中间思考。", "thinking");

        assert_eq!(thinking_id, "thinking-1");
        assert_eq!(
            message["blocks"],
            json!([
                { "type": "text", "id": "text-0", "text": "先说一句。" },
                { "type": "thinking", "id": "thinking-1", "text": "中间思考。", "status": "thinking" }
            ])
        );
    }
}

#[cfg(test)]
mod goal_continuation_tests {
    use super::*;

    #[test]
    fn prompt_with_incomplete_todos_only() {
        let todos = vec![
            json!({ "id": "todo-1", "status": "in_progress", "content": "实现核心逻辑" }),
            json!({ "id": "todo-2", "status": "pending", "content": "编写测试" }),
        ];
        let refs: Vec<&Value> = todos.iter().collect();
        let prompt = build_continuation_prompt(&refs, &CodeGraphSignal::Skip);

        assert!(prompt.contains("[Goal Continuation]"));
        assert!(prompt.contains("未完成 todo（2 个）"));
        assert!(prompt.contains("[todo-1] [in_progress] 实现核心逻辑"));
        assert!(prompt.contains("[todo-2] [pending] 编写测试"));
        assert!(prompt.contains("请继续推进未完成的工作。"));
        assert!(!prompt.contains("CodeGraph"));
    }

    #[test]
    fn prompt_with_codegraph_stale_only() {
        let files = vec!["src/main.rs".to_string(), "src/lib.rs".to_string()];
        let prompt = build_continuation_prompt(&[], &CodeGraphSignal::Stale(files));

        assert!(prompt.contains("[Goal Continuation]"));
        assert!(!prompt.contains("未完成 todo"));
        assert!(prompt.contains("CodeGraph 检测到以下文件已修改但尚未完成索引验证"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("所有 todo 已完成，请检查这些文件的变更是否正确完整。"));
    }

    #[test]
    fn prompt_with_both_signals() {
        let todos = vec![json!({ "id": "todo-1", "status": "pending", "content": "收尾" })];
        let refs: Vec<&Value> = todos.iter().collect();
        let files = vec!["src/main.rs".to_string()];
        let prompt = build_continuation_prompt(&refs, &CodeGraphSignal::Stale(files));

        assert!(prompt.contains("未完成 todo（1 个）"));
        assert!(prompt.contains("[todo-1] [pending] 收尾"));
        assert!(prompt.contains("CodeGraph 检测到以下文件已修改"));
        assert!(prompt.contains("请继续推进未完成的工作。"));
        assert!(!prompt.contains("所有 todo 已完成"));
    }

    #[test]
    fn prune_removes_only_goal_continuation_user_messages() {
        let mut snapshot = json!({
            "messages": [
                {
                    "role": "user",
                    "text": "用户原始消息",
                    "id": "msg-1"
                },
                {
                    "role": "user",
                    "text": "[Goal Continuation] ...",
                    "id": "msg-2",
                    "metadata": { "uiHidden": true, "goalContinuation": true }
                },
                {
                    "role": "assistant",
                    "text": "我来继续工作。",
                    "id": "msg-3"
                },
                {
                    "role": "user",
                    "text": "另一个普通 uiHidden 消息",
                    "id": "msg-4",
                    "metadata": { "uiHidden": true }
                }
            ]
        });

        prune_goal_continuation_messages(&mut snapshot);

        let messages = snapshot["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["id"], "msg-1");
        assert_eq!(messages[1]["id"], "msg-3");
        assert_eq!(messages[2]["id"], "msg-4");
    }

    #[test]
    fn prune_preserves_messages_without_metadata() {
        let mut snapshot = json!({
            "messages": [
                { "role": "user", "text": "hello", "id": "a" },
                { "role": "assistant", "text": "hi", "id": "b" }
            ]
        });

        prune_goal_continuation_messages(&mut snapshot);

        let messages = snapshot["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
    }
}
