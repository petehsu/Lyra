use super::*;

#[derive(Debug, Default)]
pub(crate) struct ModelLoopProgressGuard {
    last_fingerprint: Option<String>,
    repeated_occurrences: usize,
    browser_loop_detector: browser_loop_detector::BrowserLoopDetector,
    browser_automation_paused: bool,
    browser_tools_used_this_turn: usize,
    tool_loop_detector: tool_loop_detector::ToolLoopDetector,
}

#[derive(Debug)]
pub(crate) enum ModelLoopProgressAction {
    Continue,
    Warn {
        reason: &'static str,
        observed_occurrences: usize,
    },
    Synthesize {
        reason: &'static str,
        observed_occurrences: usize,
    },
}

impl ModelLoopProgressGuard {
    fn observe_tool_round(
        &mut self,
        calls: &[ModelToolCall],
        provider_results: &[String],
    ) -> ModelLoopProgressAction {
        if calls.is_empty() {
            self.last_fingerprint = None;
            self.repeated_occurrences = 0;
            return ModelLoopProgressAction::Continue;
        }

        let fingerprint = tool_round_progress_fingerprint(calls, provider_results);
        if self.last_fingerprint.as_deref() == Some(fingerprint.as_str()) {
            self.repeated_occurrences = self.repeated_occurrences.saturating_add(1);
        } else {
            self.last_fingerprint = Some(fingerprint);
            self.repeated_occurrences = 1;
        }

        let reason = "repeated_identical_tool_round_without_new_evidence";
        if self.repeated_occurrences >= REPEATED_TOOL_ROUND_HARD_OCCURRENCES {
            return ModelLoopProgressAction::Synthesize {
                reason,
                observed_occurrences: self.repeated_occurrences,
            };
        }
        if self.repeated_occurrences == REPEATED_TOOL_ROUND_SOFT_OCCURRENCES {
            return ModelLoopProgressAction::Warn {
                reason,
                observed_occurrences: self.repeated_occurrences,
            };
        }
        ModelLoopProgressAction::Continue
    }
}

pub(crate) fn tool_round_progress_fingerprint(
    calls: &[ModelToolCall],
    provider_results: &[String],
) -> String {
    let calls = calls
        .iter()
        .map(|call| {
            format!(
                "{}:{}",
                call.name,
                serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let results = provider_results
        .iter()
        .map(|content| {
            let content = content
                .lines()
                .filter(|line| {
                    !line.starts_with("Evidence activity ID: ")
                        && !line.starts_with("Failed tool activity ID (not valid evidence): ")
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!("{}:{content}", content.chars().count())
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("calls:\n{calls}\nresults:\n{results}")
}

pub(crate) fn tool_output_failed(output: &Value) -> bool {
    output.get("error").is_some_and(|value| !value.is_null())
        || matches!(
            output.get("status").and_then(Value::as_str),
            Some("failed" | "cancelled")
        )
        || output.get("cancelled").and_then(Value::as_bool) == Some(true)
        || output.pointer("/raw/ok").and_then(Value::as_bool) == Some(false)
        || output.pointer("/raw/success").and_then(Value::as_bool) == Some(false)
}

pub(crate) fn provider_visible_tool_result_content(
    output: &Value,
    tool_call_id: &str,
    max_chars: usize,
) -> (String, Option<Value>) {
    let (content, evidence_ref) = guarded_tool_result_content(output, max_chars);
    let label = if tool_output_failed(output) {
        "Failed tool activity ID (not valid evidence)"
    } else {
        "Evidence activity ID"
    };
    (
        format!("{content}\n\n{label}: {tool_call_id}"),
        evidence_ref,
    )
}

pub(crate) fn run_model_loop(
    session_id: &str,
    turn_id: &str,
    request: ModelRequest,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<ModelLoopResult> {
    super::turn_engine::block_on(run_model_loop_with_ui_commit_async(
        session_id,
        turn_id,
        request,
        cancellation,
        true,
    ))
}

pub(crate) async fn run_model_loop_async(
    session_id: &str,
    turn_id: &str,
    request: ModelRequest,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<ModelLoopResult> {
    run_model_loop_with_ui_commit_async(session_id, turn_id, request, cancellation, true).await
}

pub(crate) async fn run_model_loop_without_ui_commit_async(
    session_id: &str,
    turn_id: &str,
    request: ModelRequest,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<ModelLoopResult> {
    run_model_loop_with_ui_commit_async(session_id, turn_id, request, cancellation, false).await
}

pub(crate) async fn run_model_loop_with_ui_commit_async(
    session_id: &str,
    turn_id: &str,
    mut request: ModelRequest,
    cancellation: &CancellationToken,
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelLoopResult> {
    let mut messages = request.messages.clone();
    if request.context_trimmed
        || !request.evidence_refs.is_empty()
        || !request.input_downgrades.is_empty()
    {
        emit_context_trimmed(
            session_id,
            json!({
                "reason": "provider_context_prepared",
                "estimatedTokens": request.token_estimate,
                "trimmed": request.context_trimmed,
                "inputDowngrades": request.input_downgrades,
                "evidenceRefs": request.evidence_refs,
            }),
        );
    }
    let mut retried_after_context_error = false;
    let mut retried_after_image_input_error = false;
    let mut retried_after_empty_reply = false;
    let mut protocol_leak_retries = 0_u8;
    let mut missing_tool_retries = 0_u8;
    let mut quality_gate_retries = 0_u8;
    let mut transient_provider_retries = 0_u8;
    let mut continuation_retries = 0_u8;
    let mut truncated_prefix: Option<String> = None;
    let mut progress_guard = ModelLoopProgressGuard::default();
    let mut provider_transcript = Vec::new();
    let mut provider_replay_items = Vec::new();
    let mut observations = ModelLoopObservations::default();
    let mut retried_without_prompt_cache = false;
    let mut retried_without_previous_response = false;
    loop {
        if cancellation.is_cancelled() || turn_was_cancelled(session_id, turn_id) {
            return Err(AgentRuntimeError::Cancelled);
        }
        emit_turn_state(
            session_id,
            turn_id,
            if request.capabilities.supports_streaming {
                "streaming_model"
            } else {
                "calling_model"
            },
            "provider_request_started",
        );
        let reply = match call_model_once_for_loop_async(
            session_id,
            turn_id,
            &request.provider,
            &request.model,
            &messages,
            &request.tools,
            &request.tool_choice,
            &request.capabilities,
            cancellation,
            commit_assistant_text,
        )
        .await
        {
            Ok(reply) => {
                observe_successful_provider_capabilities(session_id, &request, &messages, &reply);
                super::session_runtime::record_progress(turn_id);
                observations.observe(&reply);
                checkpoint_model_loop_observations(session_id, turn_id, &observations, &messages);
                reply
            }
            Err(error)
                if !retried_without_prompt_cache
                    && rejected_provider_parameter(
                        &error,
                        &[
                            "prompt_cache_key",
                            "prompt_cache_options",
                            "prompt_cache_breakpoint",
                            "cache_control",
                            "cachepoint",
                        ],
                    )
                    .is_some() =>
            {
                retried_without_prompt_cache = true;
                let parameter = rejected_provider_parameter(
                    &error,
                    &[
                        "prompt_cache_key",
                        "prompt_cache_options",
                        "prompt_cache_breakpoint",
                        "cache_control",
                        "cachepoint",
                    ],
                )
                .unwrap_or("prompt_cache");
                mark_prompt_cache_rejected(&request.provider, &request.model);
                disable_prompt_cache(&mut messages);
                observations.warning(
                    "prompt_cache_parameter_rejected",
                    parameter,
                    &error.to_string(),
                );
                checkpoint_model_loop_observations(session_id, turn_id, &observations, &messages);
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_prompt_cache_disabled_retry",
                    1,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if !retried_without_previous_response
                    && rejected_provider_parameter(&error, &["previous_response_id"]).is_some() =>
            {
                retried_without_previous_response = true;
                disable_stateful_responses(&mut messages);
                observations.warning(
                    "stateful_response_cursor_rejected",
                    "previous_response_id",
                    &error.to_string(),
                );
                checkpoint_model_loop_observations(session_id, turn_id, &observations, &messages);
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_stateful_cursor_full_replay_retry",
                    1,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if !retried_after_image_input_error
                    && providers::model_capabilities::is_image_input_unsupported_error(&error) =>
            {
                retried_after_image_input_error = true;
                let evidence = error.to_string();
                let _ = providers::model_capabilities::record_observed_model_capability(
                    session_id,
                    &request.provider.id,
                    &request.model,
                    providers::model_capabilities::ObservedCapability::ImageInput,
                    false,
                    &evidence,
                );
                request.capabilities.supports_image_input = false;
                let (stripped, downgrades) =
                    providers::model_capabilities::strip_images_from_provider_messages(messages);
                messages = stripped;
                reset_stateful_responses(&mut messages);
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "image-input-downgrade",
                    format!(
                        "Structured input downgrade report: {}\nThe active model/provider rejected image input. Lyra marked it as non-vision and will retry without images. Prefer semantic browser mapping/action for this endpoint.",
                        serde_json::to_string(&downgrades).unwrap_or_else(|_| "[]".to_string())
                    ),
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_image_input_downgrade_retry",
                    1,
                    &evidence,
                );
                continue;
            }
            Err(error)
                if !retried_after_context_error
                    && matches!(
                        error,
                        AgentRuntimeError::ProviderFailure {
                            failure: ProviderFailure {
                                category: ProviderFailureCategory::ContextLimit,
                                ..
                            }
                        }
                    ) =>
            {
                retried_after_context_error = true;
                messages =
                    compact_messages_for_retry(messages, request.capabilities.context_window);
                reset_stateful_responses(&mut messages);
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "provider_context_length_error_retry",
                        "retry": true,
                    }),
                );
                continue;
            }
            Err(error) if !retried_after_empty_reply && is_empty_model_reply_error(&error) => {
                retried_after_empty_reply = true;
                clear_failed_assistant_draft(session_id, turn_id);
                let signals = crate::retention_policy::retention_signals_from_provider_messages(
                    &messages,
                    request.capabilities.context_window,
                );
                messages = crate::retention_policy::compact_provider_messages_for_retry(
                    messages,
                    &signals,
                    crate::retention_policy::TrimAggressiveness::Elevated,
                );
                reset_stateful_responses(&mut messages);
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "provider_empty_reply_retry",
                        "retry": true,
                    }),
                );
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "empty-provider-reply",
                    "The previous provider response was empty and could not be committed to Lyra's factual timeline. Continue the same request now. Emit a structured tool call if needed; otherwise return normal assistant text.",
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_empty_reply_retry",
                    1,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if protocol_leak_retries < max_protocol_leak_retry()
                    && is_textual_protocol_leak_error(&error) =>
            {
                protocol_leak_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "protocol-correction",
                    protocol_leak_corrective_prompt(),
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_textual_protocol_leak_retry",
                    protocol_leak_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if protocol_leak_retries < max_protocol_leak_retry()
                    && is_tool_payload_leak_error(&error) =>
            {
                protocol_leak_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "tool-protocol-correction",
                    tool_protocol::TOOL_OUTPUT_ECHO_CORRECTIVE_PROMPT,
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_tool_payload_leak_retry",
                    protocol_leak_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if missing_tool_retries < max_missing_tool_retry()
                    && is_browser_anchor_without_tools_error(&error) =>
            {
                missing_tool_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "missing-browser-tool-correction",
                    tool_protocol::ACTION_TASK_WITHOUT_TOOLS_CORRECTIVE_PROMPT,
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_browser_anchor_without_tools_retry",
                    missing_tool_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if missing_tool_retries < max_missing_tool_retry()
                    && is_missing_tool_call_reply_error(&error) =>
            {
                missing_tool_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "missing-tool-correction",
                    no_tools_used_corrective_prompt(!request.tools.is_empty()),
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_missing_tool_call_retry",
                    missing_tool_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if providers::routes::mimo::is_mimo_route(&request.provider.route_id)
                    && providers::mimo_faults::parse_mimo_fault_from_error(&error).is_some_and(
                        |fault| providers::mimo_faults::is_mimo_notify_and_fail_fault(&fault),
                    ) =>
            {
                let fault =
                    providers::mimo_faults::parse_mimo_fault_from_error(&error).expect("fault");
                emit_provider_fault(
                    session_id,
                    turn_id,
                    &request.provider.id,
                    &request.model,
                    &fault,
                );
                return Err(error);
            }
            Err(error)
                if providers::routes::mimo::is_mimo_route(&request.provider.route_id)
                    && transient_provider_retries
                        < providers::mimo_faults::MIMO_TRANSIENT_RETRY_LIMIT
                    && providers::mimo_faults::parse_mimo_fault_from_error(&error).is_some_and(
                        |fault| providers::mimo_faults::is_mimo_backoff_fault(&fault),
                    ) =>
            {
                transient_provider_retries += 1;
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "mimo_provider_backoff_retry",
                    transient_provider_retries,
                    &error.to_string(),
                );
                sleep_before_provider_retry_async(transient_provider_retries, cancellation).await?;
                continue;
            }
            Err(error)
                if providers::routes::mimo::is_mimo_route(&request.provider.route_id)
                    && providers::mimo_faults::parse_mimo_fault_from_error(&error).is_some_and(
                        |fault| providers::mimo_faults::should_notify_for_mimo_fault(&fault, true),
                    ) =>
            {
                let fault =
                    providers::mimo_faults::parse_mimo_fault_from_error(&error).expect("fault");
                emit_provider_fault(
                    session_id,
                    turn_id,
                    &request.provider.id,
                    &request.model,
                    &fault,
                );
                return Err(error);
            }
            Err(error) if transient_provider_retries < 2 && is_retryable_provider_error(&error) => {
                transient_provider_retries += 1;
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_transient_error_retry",
                    transient_provider_retries,
                    &error.to_string(),
                );
                sleep_before_provider_retry_async(transient_provider_retries, cancellation).await?;
                continue;
            }
            Err(error) => return Err(error),
        };
        let reply_response_id = reply.response_meta.response_id.clone();
        if reply.tool_calls.is_empty() {
            // A missing tool call is retryable only when the provider's native
            // stop signal says it intended tool use. Visible prose is never
            // classified to infer intent.
            let wants_tool_retry =
                !request.tools.is_empty() && reply.stop_signal == TurnStopSignal::ToolUse;
            if wants_tool_retry && missing_tool_retries < max_missing_tool_retry() {
                missing_tool_retries += 1;
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                let input_start = messages.len();
                advance_stateful_responses(
                    &mut messages,
                    reply_response_id.as_deref(),
                    input_start,
                );
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "missing-tool-correction",
                    no_tools_used_corrective_prompt(!request.tools.is_empty()),
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_missing_tool_call_retry",
                    missing_tool_retries,
                    "assistant promised tool use without structured tool_call",
                );
                continue;
            }
            if reply
                .content
                .as_ref()
                .is_none_or(|text| text.trim().is_empty())
            {
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                if !retried_after_empty_reply {
                    retried_after_empty_reply = true;
                    let input_start = messages.len();
                    advance_stateful_responses(
                        &mut messages,
                        reply_response_id.as_deref(),
                        input_start,
                    );
                    append_provider_context_update(
                        &mut messages,
                        &mut provider_transcript,
                        "empty-visible-reply",
                        "The previous response had no visible assistant text and was not committed. Continue the same request now; use a structured tool call if needed, otherwise return normal assistant text.",
                    );
                    emit_provider_retry(
                        session_id,
                        turn_id,
                        "provider_empty_visible_reply_retry",
                        1,
                        "assistant reply contained no visible text",
                    );
                    continue;
                }
                return Err(AgentRuntimeError::ProviderProtocol {
                    kind: ProviderProtocolFailureKind::EmptyAssistantResponse,
                    detail: "provider returned no assistant text or tool call".to_string(),
                });
            }
            if tool_protocol::should_reject_browser_anchor_without_browser_tools(
                &messages,
                &request.tools,
                progress_guard.browser_tools_used_this_turn,
                true,
            ) {
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                return Err(AgentRuntimeError::ProviderProtocol {
                    kind: ProviderProtocolFailureKind::BrowserAnchorWithoutTools,
                    detail: "browser-anchored turn completed without a browser tool call"
                        .to_string(),
                });
            }
            if let Err(failure) =
                super::tools::validate_final_response_for_session(session_id, turn_id)
            {
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                if quality_gate_retries < 2 && !request.tools.is_empty() {
                    quality_gate_retries += 1;
                    if let Some(tool_choice) = quality_gate_retry_tool_choice(&failure.code) {
                        request.tool_choice = tool_choice;
                    }
                    let input_start = messages.len();
                    advance_stateful_responses(
                        &mut messages,
                        reply_response_id.as_deref(),
                        input_start,
                    );
                    append_provider_context_update(
                        &mut messages,
                        &mut provider_transcript,
                        "quality-gate-correction",
                        format!(
                            "Lyra's native execution contract rejected the previous final response: {} ({}) {} Use structured tools now; do not repeat the unsupported completion claim.",
                            failure.message, failure.code, failure.recommended_next_action,
                        ),
                    );
                    emit_provider_retry(
                        session_id,
                        turn_id,
                        "provider_native_quality_gate_retry",
                        quality_gate_retries,
                        &failure.message,
                    );
                    continue;
                }
                if super::tools::is_completion_gate_failure(&failure.code) {
                    let blocked = super::tools::record_completion_blocked_for_session(
                        session_id, turn_id, &failure,
                    );
                    let result = ModelLoopResult::final_text(format!(
                        "Completion is blocked: {} {}",
                        failure.message, failure.recommended_next_action
                    ))
                    .with_metadata(json!({ "completionBlocked": blocked }))
                    .with_provider_transcript(provider_transcript)
                    .with_provider_replay_items(provider_replay_items);
                    return Ok(with_model_loop_observations(
                        result,
                        &observations,
                        &messages,
                        false,
                    ));
                }
                return Err(AgentRuntimeError::Core(format!(
                    "{}: {}",
                    failure.code, failure.message
                )));
            }
            let this_segment = reply.content.clone().unwrap_or_default();
            let response_replay_items =
                retained_provider_replay_items(&reply.provider_replay_items, &[]);
            if !response_replay_items.is_empty() {
                provider_replay_items.extend(response_replay_items.clone());
            }
            if reply.stop_signal == TurnStopSignal::MaxTokens
                && continuation_retries < MAX_CONTINUATION_RETRIES
                && !this_segment.trim().is_empty()
            {
                continuation_retries += 1;
                let mut accumulated = truncated_prefix.take().unwrap_or_default();
                accumulated.push_str(&this_segment);
                truncated_prefix = Some(accumulated);
                let has_response_replay = !response_replay_items.is_empty();
                if has_response_replay {
                    messages.extend(response_replay_items);
                }
                let mut segment_assistant = json!({
                    "role": "assistant",
                    "content": this_segment,
                });
                if has_response_replay {
                    segment_assistant["openaiResponsesShadow"] = Value::Bool(true);
                }
                messages.push(segment_assistant.clone());
                provider_transcript.push(segment_assistant);
                let input_start = messages.len();
                advance_stateful_responses(
                    &mut messages,
                    reply_response_id.as_deref(),
                    input_start,
                );
                if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                    let _ = remove_assistant_message(session_id, message_id);
                } else {
                    clear_failed_assistant_draft(session_id, turn_id);
                }
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "max-tokens-continuation",
                    MAX_TOKENS_CONTINUATION_PROMPT,
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_max_tokens_continuation_retry",
                    continuation_retries,
                    "model output truncated by max_tokens; continuing",
                );
                continue;
            }
            let had_truncated_prefix = truncated_prefix.is_some();
            let mut final_text = match truncated_prefix.take() {
                Some(mut prefix) => {
                    prefix.push_str(&this_segment);
                    prefix
                }
                None => this_segment,
            };
            let continuation_exhausted =
                reply.stop_signal == TurnStopSignal::MaxTokens && had_truncated_prefix;
            if continuation_exhausted {
                if !final_text.ends_with('\n') {
                    final_text.push_str("\n\n");
                }
                final_text.push_str(MAX_TOKENS_EXHAUSTED_VISIBLE_NOTE);
            }
            if had_truncated_prefix
                && let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty())
            {
                let _ = remove_assistant_message(session_id, message_id);
            }
            let mut final_assistant = json!({
                "role": "assistant",
                "content": final_text,
            });
            if let Some(reasoning_content) = reply
                .reasoning_content
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                final_assistant["reasoning_content"] = Value::String(reasoning_content.clone());
                provider_transcript.push(final_assistant);
            }
            let mut result = ModelLoopResult::final_text(final_text)
                .with_ui_text_committed(reply.ui_message_id.is_some() && !had_truncated_prefix)
                .with_provider_transcript(provider_transcript)
                .with_provider_replay_items(provider_replay_items);
            if continuation_exhausted {
                result = result.with_metadata(json!({
                    "providerContinuation": {
                        "truncated": true,
                        "continuationExhausted": true,
                        "continuationRetries": continuation_retries,
                        "maxContinuationRetries": MAX_CONTINUATION_RETRIES,
                    }
                }));
            }
            return Ok(with_model_loop_observations(
                result,
                &observations,
                &messages,
                true,
            ));
        }

        let mut tool_calls = reply.tool_calls;
        let stop_after_plan_finalize = tool_calls.iter().position(|call| {
            call.name == PLAN_FINALIZE_MODEL_TOOL
                || (call.name == UPDATE_PLAN_MODEL_TOOL
                    && call.arguments.get("action").and_then(Value::as_str) == Some("finalize"))
        });
        if let Some(index) = stop_after_plan_finalize {
            tool_calls.truncate(index + 1);
        }
        let response_replay_items =
            retained_provider_replay_items(&reply.provider_replay_items, &tool_calls);
        if !response_replay_items.is_empty() {
            provider_replay_items.extend(response_replay_items.clone());
            messages.extend(response_replay_items.clone());
        }
        let assistant_content = reply.content.unwrap_or_default();
        let assistant_tool_calls = tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string())
                    }
                })
            })
            .collect::<Vec<_>>();
        let mut assistant_message = json!({
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": assistant_tool_calls,
        });
        if !response_replay_items.is_empty() {
            assistant_message["openaiResponsesShadow"] = Value::Bool(true);
        }
        if let Some(reasoning_content) = reply
            .reasoning_content
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            assistant_message["reasoning_content"] = Value::String(reasoning_content.clone());
        }
        messages.push(assistant_message.clone());
        provider_transcript.push(assistant_message);
        let input_start = messages.len();
        advance_stateful_responses(&mut messages, reply_response_id.as_deref(), input_start);

        let mut provider_tool_results = Vec::new();
        let mut browser_tool_calls = Vec::new();
        let mut browser_tool_outputs = Vec::new();
        if !tool_calls.is_empty() {
            if cancellation.is_cancelled() || turn_was_cancelled(session_id, turn_id) {
                return Err(AgentRuntimeError::Cancelled);
            }
            emit_turn_state(session_id, turn_id, "waiting_for_tool", "tool_call_started");
            let runtime = ToolExecutionRuntime::from_model_capabilities(&request.capabilities);
            let dispatcher = &request.host_dispatcher;
            let browser_paused = progress_guard.browser_automation_paused;
            // Pre-check: block calls that have been looping with identical failing args.
            let loop_blocks: Vec<Option<String>> = tool_calls
                .iter()
                .map(|call| {
                    match progress_guard
                        .tool_loop_detector
                        .pre_check(&call.name, &call.arguments)
                    {
                        tool_loop_detector::LoopDetectorAction::Block(msg) => Some(msg),
                        _ => None,
                    }
                })
                .collect();
            // All tools in one model batch are supervised by the shared Tokio
            // runtime under one absolute deadline. Blocking tool bodies stay on
            // the blocking pool, while timeout/cancellation orchestration remains
            // async and cannot multiply the deadline by the number of tools.
            let mut outputs: Vec<Value> = if tool_calls.len() > 1
                && stop_after_plan_finalize.is_none()
            {
                let join_timeout = tool_join_deadline();
                let thread_session_id = session_id.to_string();
                let thread_turn_id = turn_id.to_string();
                let thread_dispatcher = dispatcher.clone();
                let thread_cancellation = cancellation.clone();
                let tasks = tool_calls
                    .iter()
                    .enumerate()
                    .map(|(idx, call)| {
                    let call = call.clone();
                    let loop_block = loop_blocks[idx].clone();
                    let session_id = thread_session_id.clone();
                    let turn_id = thread_turn_id.clone();
                    let dispatcher = thread_dispatcher.clone();
                    let cancellation = thread_cancellation.clone();
                    Box::pin(async move {
                        let result = if let Some(block_msg) = loop_block {
                            json!({
                                "content": block_msg,
                                "error": {
                                    "code": "tool_loop_blocked",
                                    "message": block_msg,
                                },
                                "truncated": false,
                                "recommendedNextAction": "Use a different tool or different arguments.",
                            })
                        } else if browser_paused
                            && tool_protocol::is_browser_tool_name(&call.name)
                        {
                            json!({
                                "content": "Browser automation is paused because an upload or permission dialog is blocking the page. Close the dialog, then retry.",
                                "raw": {
                                    "ok": false,
                                    "status": "blocked",
                                    "browserBlocked": true,
                                    "skipped": true,
                                    "reason": "browser_automation_paused",
                                }
                            })
                        } else {
                            execute_model_tool_with_runtime(
                                &session_id,
                                &turn_id,
                                &dispatcher,
                                &cancellation,
                                runtime,
                                call,
                            )
                            .await
                        };
                        result
                    }) as Pin<Box<dyn Future<Output = Value> + Send + 'static>>
                })
                .collect::<Vec<_>>();
                let results =
                    super::turn_engine::run_batch_for_turn(tasks, join_timeout, turn_id).await;
                if results.iter().any(|result| {
                    matches!(
                        result,
                        Err(super::turn_engine::BlockingTaskFailure::Timeout)
                    )
                }) {
                    cancellation.cancel();
                    super::session_runtime::request_turn_cancellation(turn_id);
                }
                results
                    .into_iter()
                    .map(|result| match result {
                        Ok(output) => output,
                        Err(super::turn_engine::BlockingTaskFailure::Timeout) => json!({
                            "content": "Lyra tool execution timed out.",
                            "error": {
                                "code": "tool_join_timeout",
                                "message": "Tool did not complete before the batch deadline.",
                            },
                            "truncated": false,
                            "recommendedNextAction": "Retry the tool call in a new turn or use a different approach.",
                        }),
                        Err(super::turn_engine::BlockingTaskFailure::Panic) => json!({
                            "content": "Lyra tool execution failed.",
                            "error": {
                                "code": "tool_worker_panicked",
                                "message": "Tool worker panicked.",
                            },
                            "truncated": false,
                            "recommendedNextAction": "Retry the tool call or use a different approach.",
                        }),
                    })
                    .collect()
            } else {
                let mut sequential_outputs = Vec::with_capacity(tool_calls.len());
                for (idx, call) in tool_calls.iter().enumerate() {
                    if let Some(block_msg) = &loop_blocks[idx] {
                        sequential_outputs.push(json!({
                            "content": block_msg,
                            "error": {
                                "code": "tool_loop_blocked",
                                "message": block_msg,
                            },
                            "truncated": false,
                            "recommendedNextAction": "Use a different tool or different arguments.",
                        }));
                        continue;
                    }
                    if browser_paused && tool_protocol::is_browser_tool_name(&call.name) {
                        sequential_outputs.push(json!({
                            "content": "Browser automation is paused because an upload or permission dialog is blocking the page. Close the dialog, then retry.",
                            "raw": {
                                "ok": false,
                                "status": "blocked",
                                "browserBlocked": true,
                                "skipped": true,
                                "reason": "browser_automation_paused",
                            }
                        }));
                        continue;
                    }
                    sequential_outputs.push(
                        execute_model_tool_with_runtime(
                            session_id,
                            turn_id,
                            dispatcher,
                            cancellation,
                            runtime,
                            call.clone(),
                        )
                        .await,
                    );
                }
                sequential_outputs
            };
            super::session_runtime::record_progress(turn_id);
            let tool_call_ids: Vec<String> = tool_calls.iter().map(|c| c.id.clone()).collect();
            tools::enforce_turn_tool_budget(session_id, turn_id, &mut outputs, &tool_call_ids);
            let quality_gate_recovery_completed = quality_gate_retries > 0
                && outputs.iter().any(|output| !tool_output_failed(output));
            let clarification_completed =
                completed_successful_tool_call(&tool_calls, &outputs, LYRA_CLARIFICATION_ASK_TOOL);
            let plan_finalize_completed = stop_after_plan_finalize.is_some()
                && tool_calls.iter().zip(outputs.iter()).any(|(call, output)| {
                    (call.name == PLAN_FINALIZE_MODEL_TOOL
                        || (call.name == UPDATE_PLAN_MODEL_TOOL
                            && call.arguments.get("action").and_then(Value::as_str)
                                == Some("finalize")))
                        && output.pointer("/raw/phase").and_then(Value::as_str)
                            == Some(PLAN_PHASE_REVIEWING)
                });
            for (call, output) in tool_calls.iter().zip(outputs.into_iter()) {
                let failed = tool_output_failed(&output);
                let (mut content, evidence_ref) =
                    provider_visible_tool_result_content(&output, &call.id, 24_000);
                let progress_content = content.clone();
                // Observe tool call result with the generic loop detector
                match progress_guard
                    .tool_loop_detector
                    .observe(&call.name, &call.arguments, failed)
                {
                    tool_loop_detector::LoopDetectorAction::Warn(msg) => {
                        content = format!("{content}\n\n---\n⚠ {msg}");
                    }
                    tool_loop_detector::LoopDetectorAction::Block(msg) => {
                        content = format!(
                            "{msg}\n\nFailed tool activity ID (not valid evidence): {}",
                            call.id
                        );
                    }
                    tool_loop_detector::LoopDetectorAction::Continue => {}
                }
                provider_tool_results.push(progress_content);
                if tool_protocol::is_browser_tool_name(&call.name) {
                    progress_guard.browser_tools_used_this_turn = progress_guard
                        .browser_tools_used_this_turn
                        .saturating_add(1);
                }
                if let Some(parsed) =
                    browser_loop_detector::parse_browser_tool_call(&call.name, &call.arguments)
                {
                    browser_tool_calls.push(parsed);
                    browser_tool_outputs.push(output.clone());
                }
                if tool_protocol::is_browser_tool_blocked_output(&output) {
                    progress_guard.browser_automation_paused = true;
                }
                if let Some(evidence_ref) = evidence_ref {
                    emit_context_trimmed(
                        session_id,
                        json!({
                            "reason": "tool_output_truncated_for_provider",
                            "evidenceRef": evidence_ref,
                        }),
                    );
                }
                let mut tool_message = json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": content,
                    "lyraToolStatus": if failed { "failed" } else { "completed" },
                    "lyraToolFailure": output.get("error")
                        .or_else(|| output.pointer("/raw/error"))
                        .cloned()
                        .unwrap_or(Value::Null),
                });
                if !provider_replay_items.is_empty() {
                    tool_message["openaiResponsesShadow"] = Value::Bool(true);
                    let output_item =
                        openai_responses::function_call_output_item(&call.id, content.clone());
                    provider_replay_items.push(output_item.clone());
                    messages.push(output_item);
                }
                messages.push(tool_message.clone());
                provider_transcript.push(tool_message);
                if let Some(content) =
                    provider_image_message_from_tool_output(&output, &request.capabilities)
                {
                    let user_message = json!({
                        "role": "user",
                        "content": content,
                    });
                    messages.push(user_message.clone());
                    provider_transcript.push(user_message);
                }
            }
            if clarification_completed || quality_gate_recovery_completed {
                request.tool_choice = ModelToolChoice::Auto;
            }
            crate::native_backend::turns::clear_active_ui_message_id(session_id, turn_id);
            emit_turn_state(
                session_id,
                turn_id,
                if request.capabilities.supports_streaming {
                    "streaming_model"
                } else {
                    "calling_model"
                },
                "tool_results_ready",
            );
            if plan_finalize_completed {
                let result = ModelLoopResult {
                    final_text: None,
                    metadata: Some(json!({
                        "planReview": {
                            "requested": true,
                            "stoppedAfterFinalize": true,
                        }
                    })),
                    provider_transcript,
                    provider_replay_items,
                    ui_text_committed: false,
                };
                return Ok(with_model_loop_observations(
                    result,
                    &observations,
                    &messages,
                    false,
                ));
            }
        }

        // microCompact + MidTurn 压缩 — 在 model loop 中间减小 context。
        // 两级阈值：先 microCompact 清理旧工具结果（不调 LLM），
        // 如果 token 仍超限，MidTurn 用非损 checkpoint 替换旧消息（不调 LLM）。
        let current_tokens = estimate_messages_tokens(&messages);
        if current_tokens > MICRO_COMPACT_THRESHOLD {
            let cleared = micro_compact_messages(&mut messages, MICRO_COMPACT_KEEP_RECENT);
            let mut compacted = cleared > 0;
            if cleared > 0 {
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "micro_compact",
                        "clearedToolResults": cleared,
                        "tokensBefore": current_tokens,
                    }),
                );
            }
            if let Some((before, after)) = midturn_compact_messages(&mut messages) {
                compacted = true;
                emit_context_trimmed(
                    session_id,
                    json!({
                        "reason": "midturn_compress",
                        "tokensBefore": before,
                        "tokensAfter": after,
                    }),
                );
            }
            if compacted {
                reset_stateful_responses(&mut messages);
            }
        }

        if let Some(nudge) = progress_guard
            .browser_loop_detector
            .observe_browser_tools(&browser_tool_calls, &browser_tool_outputs)
        {
            append_provider_context_update(
                &mut messages,
                &mut provider_transcript,
                "browser-loop-correction",
                nudge,
            );
        }
        if progress_guard.browser_automation_paused {
            append_provider_context_update(
                &mut messages,
                &mut provider_transcript,
                "browser-blocked-correction",
                tool_protocol::BROWSER_BLOCKED_CORRECTIVE_PROMPT,
            );
        }

        match progress_guard.observe_tool_round(&tool_calls, &provider_tool_results) {
            ModelLoopProgressAction::Continue => {}
            ModelLoopProgressAction::Warn {
                reason,
                observed_occurrences,
            } => {
                emit_tool_progress_guard_event(
                    session_id,
                    turn_id,
                    "toolProgressGuardWarning",
                    reason,
                    observed_occurrences,
                );
                append_provider_context_update(
                    &mut messages,
                    &mut provider_transcript,
                    "progress-guard-warning",
                    PROGRESS_GUARD_WARNING_PROMPT,
                );
            }
            ModelLoopProgressAction::Synthesize {
                reason,
                observed_occurrences,
            } => {
                return synthesize_after_progress_guard_async(
                    session_id,
                    turn_id,
                    &request,
                    messages,
                    provider_transcript,
                    provider_replay_items,
                    observations,
                    cancellation,
                    reason,
                    observed_occurrences,
                    commit_assistant_text,
                )
                .await;
            }
        }
    }
}

pub(crate) async fn synthesize_after_progress_guard_async(
    session_id: &str,
    turn_id: &str,
    request: &ModelRequest,
    mut messages: Vec<Value>,
    mut provider_transcript: Vec<Value>,
    mut provider_replay_items: Vec<Value>,
    mut observations: ModelLoopObservations,
    cancellation: &CancellationToken,
    reason: &str,
    observed_occurrences: usize,
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelLoopResult> {
    emit_tool_progress_guard_event(
        session_id,
        turn_id,
        "toolProgressGuardTriggered",
        reason,
        observed_occurrences,
    );
    append_provider_context_update(
        &mut messages,
        &mut provider_transcript,
        "progress-guard-final-synthesis",
        PROGRESS_GUARD_FINAL_SYNTHESIS_PROMPT,
    );
    emit_turn_state(
        session_id,
        turn_id,
        if request.capabilities.supports_streaming {
            "streaming_model"
        } else {
            "calling_model"
        },
        "tool_progress_guard_final_synthesis",
    );
    let clarification_tools = progress_guard_clarification_tools(request);
    let reply = call_model_once_for_loop_async(
        session_id,
        turn_id,
        &request.provider,
        &request.model,
        &messages,
        &clarification_tools,
        &ModelToolChoice::Auto,
        &request.capabilities,
        cancellation,
        commit_assistant_text,
    )
    .await?;
    observe_successful_provider_capabilities(session_id, request, &messages, &reply);
    observations.observe(&reply);
    checkpoint_model_loop_observations(session_id, turn_id, &observations, &messages);
    if reply.tool_calls.is_empty() {
        provider_replay_items.extend(retained_provider_replay_items(
            &reply.provider_replay_items,
            &[],
        ));
        let result = ModelLoopResult::final_text(reply.content.unwrap_or_default())
            .with_ui_text_committed(reply.ui_message_id.is_some())
            .with_provider_transcript(provider_transcript)
            .with_provider_replay_items(provider_replay_items);
        return Ok(with_model_loop_observations(
            result,
            &observations,
            &messages,
            true,
        ));
    }
    if reply.tool_calls.len() != 1
        || reply
            .tool_calls
            .first()
            .is_none_or(|call| call.name != LYRA_CLARIFICATION_ASK_TOOL)
    {
        return Err(AgentRuntimeError::Core(
            "provider requested non-clarification tools during progress-guard synthesis"
                .to_string(),
        ));
    }
    let reply_response_id = reply.response_meta.response_id.clone();
    let tool_call = reply
        .tool_calls
        .first()
        .expect("checked clarification call")
        .clone();
    let response_replay_items = retained_provider_replay_items(
        &reply.provider_replay_items,
        std::slice::from_ref(&tool_call),
    );
    if !response_replay_items.is_empty() {
        provider_replay_items.extend(response_replay_items.clone());
        messages.extend(response_replay_items.clone());
    }
    let assistant_content = reply.content.unwrap_or_default();
    let assistant_message = json!({
        "role": "assistant",
        "content": assistant_content,
        "tool_calls": [{
            "id": tool_call.id,
            "type": "function",
            "function": {
                "name": tool_call.name,
                "arguments": serde_json::to_string(&tool_call.arguments)
                    .unwrap_or_else(|_| "{}".to_string())
            }
        }],
    });
    let mut assistant_message = assistant_message;
    if !response_replay_items.is_empty() {
        assistant_message["openaiResponsesShadow"] = Value::Bool(true);
    }
    messages.push(assistant_message.clone());
    provider_transcript.push(assistant_message);
    let input_start = messages.len();
    advance_stateful_responses(&mut messages, reply_response_id.as_deref(), input_start);
    emit_turn_state(
        session_id,
        turn_id,
        "waiting_for_tool",
        "progress_guard_clarification_started",
    );
    let output = execute_model_tool_with_runtime(
        session_id,
        turn_id,
        &request.host_dispatcher,
        cancellation,
        ToolExecutionRuntime::from_model_capabilities(&request.capabilities),
        tool_call.clone(),
    )
    .await;
    let (content, _) = provider_visible_tool_result_content(&output, &tool_call.id, 24_000);
    let mut tool_message = json!({
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": content,
        "lyraToolStatus": if tool_output_failed(&output) {
            "failed"
        } else {
            "completed"
        },
        "lyraToolFailure": output.get("error")
            .or_else(|| output.pointer("/raw/error"))
            .cloned()
            .unwrap_or(Value::Null),
    });
    if !provider_replay_items.is_empty() {
        tool_message["openaiResponsesShadow"] = Value::Bool(true);
        let output_item =
            openai_responses::function_call_output_item(&tool_call.id, content.clone());
        provider_replay_items.push(output_item.clone());
        messages.push(output_item);
    }
    messages.push(tool_message.clone());
    provider_transcript.push(tool_message);
    append_provider_context_update(
        &mut messages,
        &mut provider_transcript,
        "progress-guard-clarification-complete",
        "Member answered structured clarification. Produce final answer now from gathered evidence and member decision. Do not call more tools.",
    );
    emit_turn_state(
        session_id,
        turn_id,
        if request.capabilities.supports_streaming {
            "streaming_model"
        } else {
            "calling_model"
        },
        "tool_progress_guard_after_clarification",
    );
    let no_tools = Vec::new();
    let final_reply = call_model_once_for_loop_async(
        session_id,
        turn_id,
        &request.provider,
        &request.model,
        &messages,
        &no_tools,
        &ModelToolChoice::None,
        &request.capabilities,
        cancellation,
        commit_assistant_text,
    )
    .await?;
    observe_successful_provider_capabilities(session_id, request, &messages, &final_reply);
    observations.observe(&final_reply);
    checkpoint_model_loop_observations(session_id, turn_id, &observations, &messages);
    if !final_reply.tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider requested tools after progress-guard clarification".to_string(),
        ));
    }
    provider_replay_items.extend(retained_provider_replay_items(
        &final_reply.provider_replay_items,
        &[],
    ));
    let result = ModelLoopResult::final_text(final_reply.content.unwrap_or_default())
        .with_ui_text_committed(final_reply.ui_message_id.is_some())
        .with_provider_transcript(provider_transcript)
        .with_provider_replay_items(provider_replay_items);
    Ok(with_model_loop_observations(
        result,
        &observations,
        &messages,
        true,
    ))
}

pub(crate) fn progress_guard_clarification_tools(request: &ModelRequest) -> Vec<Value> {
    if !request.capabilities.supports_tool_calling {
        return Vec::new();
    }
    request
        .tools
        .iter()
        .filter(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str)
                == Some(LYRA_CLARIFICATION_ASK_TOOL)
        })
        .cloned()
        .collect()
}

pub(crate) fn provider_image_message_from_tool_output(
    output: &Value,
    capabilities: &ModelCapabilityProfile,
) -> Option<Value> {
    if !capabilities.supports_image_input {
        return None;
    }
    let image = output.pointer("/raw/providerImage")?;
    let path = image.get("path").and_then(Value::as_str)?;
    let artifact = resolve_lyra_artifact_path(path).ok().flatten()?;
    let metadata = fs::metadata(&artifact.absolute).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_PROVIDER_IMAGE_TOOL_BYTES {
        return None;
    }
    let bytes = fs::read(&artifact.absolute).ok()?;
    let data_url = format!(
        "data:{};base64,{}",
        artifact.media_type,
        BASE64_STANDARD.encode(bytes)
    );
    Some(json!([
        {
            "type": "text",
            "text": format!(
                "Lyra attached artifact image {} ({}, {} bytes) as model vision evidence for the previous tool result.",
                artifact.artifact_id,
                artifact.media_type,
                metadata.len()
            )
        },
        {
            "type": "image_url",
            "image_url": { "url": data_url }
        }
    ]))
}

pub(crate) fn emit_tool_progress_guard_event(
    session_id: &str,
    turn_id: &str,
    event_type: &str,
    reason: &str,
    observed_occurrences: usize,
) {
    emit_provider_protocol_event(
        session_id,
        turn_id,
        json!({
            "type": event_type,
            "reason": reason,
            "observedOccurrences": observed_occurrences,
        }),
    );
}

pub(crate) fn emit_provider_retry(
    session_id: &str,
    turn_id: &str,
    reason: &str,
    attempt: u8,
    message: &str,
) {
    set_oma_execution_parent_status(session_id, "retrying");
    emit_turn_state(session_id, turn_id, "retrying_provider", reason);
    emit_provider_protocol_event(
        session_id,
        turn_id,
        json!({
            "type": "retry",
            "reason": reason,
            "attempt": attempt,
            "message": message,
        }),
    );
    emit_context_trimmed(
        session_id,
        json!({
            "reason": reason,
            "attempt": attempt,
            "message": message,
            "retry": true,
        }),
    );
}

pub(crate) fn sleep_before_provider_retry(
    attempt: u8,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<()> {
    super::turn_engine::block_on(sleep_before_provider_retry_async(attempt, cancellation))
}

pub(crate) async fn sleep_before_provider_retry_async(
    attempt: u8,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<()> {
    let wait_ms = 250_u64.saturating_mul(2_u64.saturating_pow(attempt.saturating_sub(1).into()));
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    while Instant::now() < deadline {
        if cancellation.is_cancelled() {
            return Err(AgentRuntimeError::Cancelled);
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Ok(())
}

pub(crate) fn is_retryable_provider_error(error: &AgentRuntimeError) -> bool {
    matches!(
        error,
        AgentRuntimeError::ProviderFailure {
            failure: ProviderFailure {
                category: ProviderFailureCategory::RateLimit | ProviderFailureCategory::Server,
                ..
            }
        }
    )
}

/// Classify a `reqwest::Error` into a transport category using reqwest's typed
/// predicates — never its message text — so the category stays correct across
/// reqwest versions and wording changes.
pub(crate) fn classify_reqwest_transport(error: &reqwest::Error) -> ProviderTransportKind {
    if error.is_timeout() {
        ProviderTransportKind::Timeout
    } else if error.is_connect() {
        ProviderTransportKind::Connect
    } else if error.is_decode() || error.is_body() {
        ProviderTransportKind::StreamInterrupted
    } else {
        ProviderTransportKind::Other
    }
}

/// Build a typed transport error from a failed request. A `reqwest` send/read
/// failure is always a transport failure (HTTP error *responses* never fail
/// these calls — they are inspected via the status code instead).
pub(crate) fn reqwest_transport_error(error: reqwest::Error) -> AgentRuntimeError {
    AgentRuntimeError::ProviderTransport {
        kind: classify_reqwest_transport(&error),
        detail: error.to_string(),
    }
}

/// Classify a failure that occurs while reading lines from the streamed SSE
/// response body. Such a read fails mid-stream when the provider drops the
/// connection or the body transfer/decoding is interrupted; reqwest surfaces it
/// as an I/O error wrapping a `reqwest::Error`. Recover the typed reqwest
/// category when present; otherwise a body read failure is by construction a
/// stream interruption.
pub(crate) fn streaming_body_read_error(error: std::io::Error) -> AgentRuntimeError {
    let kind = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<reqwest::Error>())
        .map(classify_reqwest_transport)
        .unwrap_or(ProviderTransportKind::StreamInterrupted);
    AgentRuntimeError::ProviderTransport {
        kind,
        detail: format!("provider streaming response body read failed: {error}"),
    }
}

/// A provider transport failure is identified by the typed error variant, not by
/// matching on the error's message text.
pub(crate) fn is_provider_transport_error(error: &AgentRuntimeError) -> bool {
    matches!(error, AgentRuntimeError::ProviderTransport { .. })
}

pub(crate) fn is_provider_configuration_error(error: &AgentRuntimeError) -> bool {
    matches!(
        error,
        AgentRuntimeError::ProviderFailure {
            failure: ProviderFailure {
                category: ProviderFailureCategory::Configuration
                    | ProviderFailureCategory::Authentication
                    | ProviderFailureCategory::Authorization,
                ..
            }
        }
    )
}
