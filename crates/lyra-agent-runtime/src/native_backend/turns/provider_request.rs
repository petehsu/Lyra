use super::*;

/// All session + config data extracted from the global state lock in one pass.
/// Destructured by `build_model_request` so the rest of the function stays lock-free.
struct SessionContextData {
    root: PathBuf,
    provider: NativeProviderProfile,
    model: String,
    session_snapshot: Value,
    session_messages: Vec<Value>,
    session_tools: Vec<Value>,
    host_dispatcher: Option<Arc<HostCapabilityDispatcher>>,
    active_skills: HashSet<String>,
    working_dir: Option<String>,
    session_kind: Option<String>,
    active_turn_id: Option<String>,
    active_user_message_id: Option<String>,
    pinned_context_prompt: String,
    previous_runtime_contract: Option<Value>,
    previous_prompt_hash: Option<String>,
    previous_context_trimmed: bool,
    configured_prompt_delivery_mode: Option<String>,
    configured_stateful_prompt_contract: bool,
    session_created_at: String,
    turn_count: u64,
}

fn assemble_session_context(session_id: &str) -> AgentRuntimeResult<SessionContextData> {
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
        session_snapshot,
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
        let session = state
            .sessions
            .get(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let session_snapshot = session.snapshot.clone();
        let session_messages = session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let session_messages =
            oma_messages_for_active_channel(&session_snapshot, &session_messages);
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
            .and_then(|delivery| {
                delivery
                    .get("stableBaseHash")
                    .or_else(|| delivery.get("stablePromptHash"))
            })
            .and_then(Value::as_str)
            .map(str::to_string);
        let previous_context_trimmed = session
            .snapshot
            .get("promptDelivery")
            .and_then(|delivery| delivery.get("contextTrimmed"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        (
            session_snapshot,
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
    let runtime_user_message_id = active_turn_id.as_deref().and_then(|turn_id| {
        state
            .sessions
            .get(session_id)?
            .runtime_turns
            .iter()
            .rev()
            .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id))
            .and_then(|turn| turn.get("userMessageId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let active_user_message_id =
        active_user_message_id_for_messages(&session_messages, runtime_user_message_id);
    let pinned_context_prompt = state
        .sessions
        .get(session_id)
        .map(|session| {
            let clarification = active_clarification_projection(&state, session_id);
            let items = pinned_context::collect_pinned_items(session, clarification.as_ref());
            pinned_context::pinned_context_prompt(&items)
        })
        .unwrap_or_default();
    Ok(SessionContextData {
        root: state.root.clone(),
        provider,
        model,
        session_snapshot,
        session_messages,
        session_tools,
        host_dispatcher: host_dispatcher(),
        active_skills: state.active_skills.clone(),
        working_dir,
        session_kind,
        active_turn_id,
        active_user_message_id,
        pinned_context_prompt,
        previous_runtime_contract,
        previous_prompt_hash,
        previous_context_trimmed,
        configured_prompt_delivery_mode: state.config.prompt_delivery_mode.clone(),
        configured_stateful_prompt_contract: state.config.openai_responses_stateful_prompt_contract,
        session_created_at,
        turn_count,
    })
}

fn active_user_message_id_for_messages(
    messages: &[Value],
    runtime_user_message_id: Option<String>,
) -> Option<String> {
    runtime_user_message_id
        .filter(|message_id| {
            messages.iter().any(|message| {
                message.get("role").and_then(Value::as_str) == Some("user")
                    && message.get("id").and_then(Value::as_str) == Some(message_id)
            })
        })
        .or_else(|| {
            messages.iter().rev().find_map(|message| {
                (message.get("role").and_then(Value::as_str) == Some("user"))
                    .then(|| {
                        message
                            .get("id")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .flatten()
            })
        })
}

/// build_model_request 是同步重 I/O（sqlite + codegraph block_on + FFI），
/// 直接在 turn_engine 的 tokio runtime 上调用会触发 codegraph engine 的
/// 嵌套 block_on panic（"Cannot start a runtime from within a runtime"）。
/// 用 spawn_blocking 让它跑在阻塞线程池——该线程不驱动 async tasks，
/// codegraph 自己的 runtime block_on 才能正常工作。
pub(super) async fn build_model_request_async(
    session_id: String,
) -> AgentRuntimeResult<ModelRequest> {
    match tokio::task::spawn_blocking(move || build_model_request(&session_id)).await {
        Ok(result) => result,
        Err(join_err) => Err(AgentRuntimeError::Core(format!(
            "build_model_request worker panicked: {join_err}"
        ))),
    }
}

fn provider_context_tail(messages: &[Value], message_id: Option<&str>) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| {
            message.get("role").and_then(Value::as_str) == Some("user")
                && message_id.is_none_or(|id| message.get("id").and_then(Value::as_str) == Some(id))
        })
        .and_then(|message| {
            message
                .pointer("/metadata/providerContext/renderedTail")
                .and_then(Value::as_str)
        })
        .map(str::to_string)
}

fn set_provider_context_tail(
    messages: &mut [Value],
    message_id: Option<&str>,
    rendered_tail: &str,
) -> bool {
    let Some(message) = messages.iter_mut().rev().find(|message| {
        message.get("role").and_then(Value::as_str) == Some("user")
            && message_id.is_none_or(|id| message.get("id").and_then(Value::as_str) == Some(id))
    }) else {
        return false;
    };
    message["metadata"]["providerContext"] = json!({
        "version": crate::context_builder::PROVIDER_CONTEXT_METADATA_VERSION,
        "renderedTail": rendered_tail,
    });
    true
}

fn freeze_provider_context_tail(
    session_id: &str,
    message_id: Option<&str>,
    rendered_tail: &str,
) -> AgentRuntimeResult<String> {
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session = state
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
    let messages = session
        .snapshot
        .get_mut("messages")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| AgentRuntimeError::Core("session messages unavailable".to_string()))?;
    let index = messages
        .iter()
        .rposition(|message| {
            message.get("role").and_then(Value::as_str) == Some("user")
                && message_id.is_none_or(|id| message.get("id").and_then(Value::as_str) == Some(id))
        })
        .ok_or_else(|| AgentRuntimeError::Core("active user message unavailable".to_string()))?;
    if let Some(existing) = messages[index]
        .pointer("/metadata/providerContext/renderedTail")
        .and_then(Value::as_str)
    {
        return Ok(existing.to_string());
    }
    messages[index]["metadata"]["providerContext"] = json!({
        "version": crate::context_builder::PROVIDER_CONTEXT_METADATA_VERSION,
        "renderedTail": rendered_tail,
    });
    mark_dialog_dirty_from(session, index);
    state.save_state()?;
    Ok(rendered_tail.to_string())
}

fn append_turn_context_section(target: &mut String, title: &str, content: &str) {
    if content.trim().is_empty() {
        return;
    }
    if !target.trim().is_empty() {
        target.push_str("\n\n");
    }
    target.push_str(title);
    target.push_str(":\n");
    target.push_str(content.trim());
}

pub(super) fn provider_history_fingerprint(messages: &[Value]) -> String {
    let projected = messages
        .iter()
        .map(|message| {
            json!({
                "role": message.get("role").cloned().unwrap_or(Value::Null),
                "text": message.get("text").cloned().unwrap_or(Value::Null),
                "blocks": message.get("blocks").cloned().unwrap_or(Value::Null),
                "providerContext": message.pointer("/metadata/providerContext").cloned().unwrap_or(Value::Null),
                "providerTranscript": message.pointer("/metadata/providerTranscript").cloned().unwrap_or(Value::Null),
                "openaiResponsesReplay": message.pointer("/metadata/openaiResponsesReplay").cloned().unwrap_or(Value::Null),
                "providerProtocol": message.pointer("/metadata/providerProtocol").cloned().unwrap_or(Value::Null),
                "transcriptCitations": message.pointer("/metadata/transcriptCitations").cloned().unwrap_or(Value::Null),
                "pageCitations": message.pointer("/metadata/pageCitations").cloned().unwrap_or(Value::Null),
                "fileAttachments": message.pointer("/metadata/fileAttachments").cloned().unwrap_or(Value::Null),
                "inlineImages": message.pointer("/metadata/inlineImages").cloned().unwrap_or(Value::Null),
                "metadataKind": message.pointer("/metadata/kind").cloned().unwrap_or(Value::Null),
            })
        })
        .collect::<Vec<_>>();
    let bytes = serde_json::to_vec(&projected).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
}

fn context_epoch(
    provider: &NativeProviderProfile,
    model: &str,
    stable_prompt_hash: &str,
    tools: &[Value],
    contract: &Value,
) -> String {
    let bytes = serde_json::to_vec(&json!({
        "providerId": provider.id,
        "routeId": provider.route_id,
        "model": model,
        "stablePromptHash": stable_prompt_hash,
        "tools": tools,
        "contract": contract,
    }))
    .unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
}

fn prompt_cache_key(provider: &NativeProviderProfile, model: &str, epoch: &str) -> String {
    let digest = Sha256::digest(
        format!("{}\0{}\0{model}\0{epoch}", provider.id, provider.route_id).as_bytes(),
    );
    format!("lyra:{digest:x}").chars().take(53).collect()
}

fn matching_openai_response_id(
    history: &[Value],
    provider: &NativeProviderProfile,
    model: &str,
    epoch: &str,
    history_fingerprint: &str,
) -> Option<String> {
    history.iter().rev().find_map(|message| {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            return None;
        }
        let state = message.pointer("/metadata/openaiResponsesState")?;
        (state.get("providerId").and_then(Value::as_str) == Some(provider.id.as_str())
            && state.get("routeId").and_then(Value::as_str) == Some(provider.route_id.as_str())
            && state.get("model").and_then(Value::as_str) == Some(model)
            && state.get("contextEpoch").and_then(Value::as_str) == Some(epoch)
            && state
                .get("providerContextFingerprint")
                .and_then(Value::as_str)
                == Some(history_fingerprint))
        .then(|| {
            state
                .get("responseId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .flatten()
    })
}

fn bedrock_prompt_cache_supported(model: &str) -> bool {
    let model = model.to_ascii_lowercase();
    model.contains("anthropic.claude")
        && [
            "claude-opus-4",
            "claude-sonnet-4",
            "claude-haiku-4",
            "claude-3-7-sonnet",
            "claude-3-5-sonnet-20241022",
        ]
        .iter()
        .any(|family| model.contains(family))
}

pub(crate) fn build_model_request(session_id: &str) -> AgentRuntimeResult<ModelRequest> {
    let SessionContextData {
        root,
        provider,
        model,
        session_snapshot,
        session_messages,
        session_tools,
        host_dispatcher,
        active_skills,
        working_dir,
        session_kind,
        active_turn_id,
        active_user_message_id,
        pinned_context_prompt,
        previous_runtime_contract,
        previous_prompt_hash,
        previous_context_trimmed,
        configured_prompt_delivery_mode,
        configured_stateful_prompt_contract,
        session_created_at,
        turn_count,
    } = assemble_session_context(session_id)?;
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
            if session_snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
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
    }
    let route = providers::registry::require_route(&provider.route_id)?;
    let openai_responses_replay =
        route.protocol_id == providers::protocol::openai_responses::PROTOCOL_ID;
    let latest_user_text = latest_user_text(&session_messages);
    let oma_context = oma_runtime_context_for_prompt(&session_snapshot, &session_messages);
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
    let latest_user_message = session_messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"));
    runtime_context["inputSignals"] = json!({
        "hasCitation": latest_user_message.is_some_and(|message| {
            message
                .get("metadata")
                .is_some_and(|metadata| {
                    metadata.get("transcriptCitations").is_some()
                        || metadata.get("pageCitations").is_some()
                        || metadata.get("fileCitations").is_some()
                })
        }),
        "hasImage": latest_user_message.is_some_and(|message| {
            message
                .get("blocks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|block| block.get("type").and_then(Value::as_str) == Some("image"))
        }),
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
        "userCorrectionDetected": false,
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
            if let Ok(value) = invoke_host_capability_with_timeout(
                dispatcher.clone(),
                "agent.readCodeGraphEmbeddingEnabled".to_string(),
                json!({}),
                DEFAULT_HOST_TOOL_TIMEOUT_MS,
            ) {
                let enabled = value
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                tools::codegraph::engine().set_embeddings_enabled(enabled);
            }
        }
        let signals = tools::codegraph_signals_for_prompt(
            Some(std::path::Path::new(dir)),
            Some(&latest_user_text),
            Some(&session_id),
            tools::CODEGRAPH_FRAGMENT_BUDGET_TOKENS,
        );
        let extra_hints = tools::codegraph_presearch_hints_from_signals(&signals);
        runtime_context["codegraphSignals"] = tools::codegraph_signals_to_runtime_value(&signals);
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
        let session_age_seconds =
            (now_ms - super::helpers::iso_ms(&session_created_at)).max(0) as u64 / 1000;
        let seconds_since_last_interaction = session_messages
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(Value::as_str) == Some("user"))
            .and_then(|m| m.get("createdAt").and_then(Value::as_str))
            .map(|t| (now_ms - super::helpers::iso_ms(t)).max(0) as u64 / 1000)
            .unwrap_or(0);
        let workspace = if let Some(ref dispatcher) = host_dispatcher {
            invoke_host_capability_with_timeout(
                dispatcher.clone(),
                "agent.readSpatiotemporalContext".to_string(),
                json!({}),
                DEFAULT_HOST_TOOL_TIMEOUT_MS,
            )
            .unwrap_or_else(|_| json!({}))
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
    let first_used_at = state().lock().ok().and_then(|s| s.first_used_at.clone());
    let prompt_report = build_system_prompt_report(
        &runtime_context,
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
        false,
        Some(prompt_delivery_mode),
        Some(computed_persona),
        first_used_at.as_deref(),
    );
    let mut stable_system_prompt = prompt_report.stable_prefix_prompt.clone();
    if let Some(oma_prompt) =
        oma_context
            .as_ref()
            .and_then(oma_prompt_message)
            .and_then(|message| {
                message
                    .get("content")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
    {
        append_turn_context_section(
            &mut stable_system_prompt,
            "Oma runtime instructions",
            &oma_prompt,
        );
    }
    let stable_prompt_hash = format!("{:x}", Sha256::digest(stable_system_prompt.as_bytes()));
    let last_turn_tool_count = estimate_previous_turn_tool_count(&session_tools, &session_messages);
    let provider_context_options = ProviderContextOptions {
        supports_image_input: capabilities.supports_image_input,
        context_window: capabilities.context_window,
        max_tool_output_chars: 24_000,
        session_tool_count: session_tools.len(),
        last_turn_tool_count,
        openai_responses_replay,
        provider_id: Some(provider.id.clone()),
        route_id: Some(provider.route_id.clone()),
        protocol_id: Some(route.protocol_id.clone()),
        model: Some(model.clone()),
        tool_outputs_by_id: tool_outputs_by_id_from_session_tools(&session_tools),
        halve_tool_output_message_ids: HashSet::new(),
    };
    let active_user_message_id = active_user_message_id.as_deref();
    let frozen_tail = provider_context_tail(&session_messages, active_user_message_id);
    let rendered_tail = if let Some(frozen_tail) = frozen_tail {
        frozen_tail
    } else {
        let mut rendered_tail = prompt_report.turn_tail_prompt.clone();
        if let Some(oma_turn_context) = oma_context.as_ref().and_then(oma_turn_context_message) {
            append_turn_context_section(
                &mut rendered_tail,
                "Oma current turn context",
                &oma_turn_context,
            );
        }
        let mut preview_messages = session_messages.clone();
        set_provider_context_tail(
            &mut preview_messages,
            active_user_message_id,
            &rendered_tail,
        );
        let preview = ContextBuilder::default().build_provider_context(
            stable_system_prompt.clone(),
            preview_messages,
            provider_context_options.clone(),
        );
        if !preview.input_downgrades.is_empty() {
            append_turn_context_section(
                &mut rendered_tail,
                "Structured input downgrade report",
                &format!(
                    "{}\nThis input was dropped before reaching U, not lost for good. Judge whether it is worth recovering through Lyra instead of silently skipping it.",
                    serde_json::to_string(&preview.input_downgrades)
                        .unwrap_or_else(|_| "[]".to_string())
                ),
            );
        }
        freeze_provider_context_tail(session_id, active_user_message_id, &rendered_tail)?
    };
    if !set_provider_context_tail(
        &mut session_messages,
        active_user_message_id,
        &rendered_tail,
    ) {
        return Err(AgentRuntimeError::Core(
            "active user message unavailable for provider context".to_string(),
        ));
    }
    let context = ContextBuilder::default().build_provider_context(
        stable_system_prompt,
        session_messages.clone(),
        provider_context_options,
    );
    let request_context_trimmed = provider_context_trimmed || context.trimmed;
    let contract_value =
        serde_json::to_value(&prompt_report.contract).unwrap_or_else(|_| json!({}));
    let context_epoch = context_epoch(
        &provider,
        &model,
        &stable_prompt_hash,
        &tools,
        &contract_value,
    );
    {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.snapshot["promptRuntimeContract"] = contract_value.clone();
            session.snapshot["promptDelivery"] = json!({
                "promptMode": prompt_report.prompt_mode,
                "refreshReason": prompt_report.refresh_reason,
                "stablePromptHash": stable_prompt_hash,
                "stableBaseHash": prompt_report.stable_base_hash,
                "contextEpoch": context_epoch,
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
    let active_user_index = session_messages
        .iter()
        .rposition(|message| {
            message.get("role").and_then(Value::as_str) == Some("user")
                && active_user_message_id
                    .is_none_or(|id| message.get("id").and_then(Value::as_str) == Some(id))
        })
        .unwrap_or(session_messages.len());
    let history_fingerprint = provider_history_fingerprint(&session_messages[..active_user_index]);
    let stateful_eligible = stateful_prompt_contract_enabled
        && provider.route_id == providers::routes::openai::ROUTE_ID
        && !request_context_trimmed
        && !previous_context_trimmed;
    let previous_response_id = stateful_eligible
        .then(|| {
            matching_openai_response_id(
                &session_messages[..active_user_index],
                &provider,
                &model,
                &context_epoch,
                &history_fingerprint,
            )
            .or_else(|| {
                env::var("LYRA_OPENAI_RESPONSES_PREVIOUS_RESPONSE_ID")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
        })
        .flatten();
    let current_provider_user_index = messages.iter().rposition(|message| {
        message.get("lyraCacheBoundary").and_then(Value::as_str) == Some("turnTail")
    });
    if let Some(first) = messages.first_mut() {
        first["lyraRequestContext"] = json!({
            "sessionId": session_id,
            "providerId": provider.id,
            "routeId": provider.route_id,
            "model": model,
            "contextEpoch": context_epoch,
            "promptCacheKey": prompt_cache_key(&provider, &model, &context_epoch),
            "promptCacheEnabled": true,
            "openaiExplicitPromptCache": provider.route_id == providers::routes::openai::ROUTE_ID
                && model.to_ascii_lowercase().starts_with("gpt-5.6"),
            "anthropicPromptCache": provider.route_id == providers::routes::anthropic::ROUTE_ID,
            "bedrockPromptCache": provider.route_id == providers::routes::aws_bedrock::ROUTE_ID
                && bedrock_prompt_cache_supported(&model),
            "stateful": {
                "enabled": stateful_eligible,
                "store": stateful_eligible,
                "previousResponseId": previous_response_id.clone(),
                "inputStart": previous_response_id
                    .as_ref()
                    .and(current_provider_user_index)
                    .unwrap_or(0),
            }
        });
    }
    Ok(ModelRequest {
        provider,
        model,
        messages,
        tools,
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher,
        capabilities,
        input_downgrades: context.input_downgrades,
        evidence_refs: context.evidence_refs,
        token_estimate: context.token_estimate,
        context_trimmed: provider_context_trimmed || context.trimmed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_user_message_falls_back_to_the_current_oma_channel() {
        let messages = vec![
            json!({ "id": "channel-user-1", "role": "user", "text": "first" }),
            json!({ "id": "channel-assistant-1", "role": "assistant", "text": "answer" }),
            json!({ "id": "channel-user-2", "role": "user", "text": "second" }),
        ];

        assert_eq!(
            active_user_message_id_for_messages(&messages, Some("parent-channel-user".to_string()))
                .as_deref(),
            Some("channel-user-2")
        );
        assert_eq!(
            active_user_message_id_for_messages(&messages, Some("channel-user-1".to_string()))
                .as_deref(),
            Some("channel-user-1")
        );
    }

    #[test]
    fn prompt_cache_key_is_shared_by_sessions_with_the_same_exact_prefix() {
        let provider = NativeProviderProfile {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            route_id: "openai".to_string(),
            base_url: None,
            default_model: None,
            api_key: None,
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        };

        assert_eq!(
            prompt_cache_key(&provider, "gpt-5.6", "same-context-epoch"),
            prompt_cache_key(&provider, "gpt-5.6", "same-context-epoch")
        );
        assert_ne!(
            prompt_cache_key(&provider, "gpt-5.6", "same-context-epoch"),
            prompt_cache_key(&provider, "gpt-5.6", "changed-context-epoch")
        );
    }
}
