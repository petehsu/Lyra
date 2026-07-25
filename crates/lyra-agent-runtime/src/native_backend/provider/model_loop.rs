use super::*;

mod progress_guard_synthesis;
mod recovery;
pub(crate) use progress_guard_synthesis::*;
use recovery::*;

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
    let original_tool_choice = request.tool_choice.clone();
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
    let mut reasoning_only_retries = 0_u8;
    let mut terminal_empty_retries = 0_u8;
    let mut truncated_tool_retries = 0_u8;
    let mut protocol_leak_retries = 0_u8;
    let mut missing_tool_retries = 0_u8;
    let mut quality_gate_retries = 0_u8;
    let mut transient_provider_retries = 0_u8;
    let mut continuation_retries = 0_u8;
    let mut truncated_prefix: Option<String> = None;
    let mut progress_guard = ModelLoopProgressGuard::default();
    let mut provider_transcript = Vec::new();
    let mut provider_protocol_transcript_cursor = 0_usize;
    let mut provider_replay_items = Vec::new();
    let mut deferred_provider_protocol_steps = Vec::new();
    let mut observations = ModelLoopObservations::default();
    let mut retried_without_prompt_cache = false;
    let mut retried_without_previous_response = false;
    let mut tool_choice_recovery_active = false;
    let mut attempt_local_overlay_start = None;
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
        let attempt_result = call_model_once_for_loop_async(
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
        .await;
        clear_attempt_local_overlay(&mut messages, &mut attempt_local_overlay_start);
        let reply = match attempt_result {
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
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
            Err(error)
                if reasoning_only_retries < 1
                    && matches!(
                        error,
                        AgentRuntimeError::ProviderProtocol {
                            kind: ProviderProtocolFailureKind::ReasoningOnlyResponse,
                            ..
                        }
                    ) =>
            {
                reasoning_only_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
                    "reasoning-only-recovery",
                    "Finish the current response now. Return normal assistant text, or emit a complete structured tool call if a tool is required. Do not return reasoning alone.",
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_reasoning_only_retry",
                    reasoning_only_retries,
                    &error.to_string(),
                );
                continue;
            }
            Err(error)
                if terminal_empty_retries < 1
                    && matches!(
                        error,
                        AgentRuntimeError::ProviderProtocol {
                            kind: ProviderProtocolFailureKind::EmptyAssistantResponse,
                            ..
                        }
                    ) =>
            {
                terminal_empty_retries += 1;
                clear_failed_assistant_draft(session_id, turn_id);
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
                    "terminal-empty-recovery",
                    "The previous response ended without assistant text or a tool call. Complete the same request now with normal assistant text or one complete structured tool call.",
                );
                emit_provider_retry(
                    session_id,
                    turn_id,
                    "provider_terminal_empty_retry",
                    terminal_empty_retries,
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
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
                if !request.tools.is_empty() {
                    request.tool_choice = if request.capabilities.supports_tool_choice {
                        ModelToolChoice::Required
                    } else {
                        ModelToolChoice::Auto
                    };
                    tool_choice_recovery_active = true;
                }
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
                if !request.tools.is_empty() {
                    request.tool_choice = if request.capabilities.supports_tool_choice {
                        ModelToolChoice::Required
                    } else {
                        ModelToolChoice::Auto
                    };
                    tool_choice_recovery_active = true;
                }
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
            Err(AgentRuntimeError::ProviderProtocol { kind, detail }) => {
                clear_failed_assistant_draft(session_id, turn_id);
                return Err(AgentRuntimeError::ProviderProtocol {
                    kind,
                    detail: format!(
                        "provider `{}` model `{}` exhausted recovery for `{kind}` (stop reason: `unknown`): {detail}",
                        request.provider.id, request.model,
                    ),
                });
            }
            Err(AgentRuntimeError::ProviderTransport { kind, detail }) => {
                clear_failed_assistant_draft(session_id, turn_id);
                return Err(AgentRuntimeError::ProviderTransport {
                    kind,
                    detail: format!(
                        "provider `{}` model `{}` exhausted transport recovery: {detail}",
                        request.provider.id, request.model,
                    ),
                });
            }
            Err(error) => {
                clear_failed_assistant_draft(session_id, turn_id);
                return Err(error);
            }
        };
        let reply_response_id = reply.response_meta.response_id.clone();
        let attempt_outcome = classify_attempt_outcome(&reply);
        let recovery_action = recovery_action_for_attempt(
            attempt_outcome,
            reasoning_only_retries,
            terminal_empty_retries,
            truncated_tool_retries,
            missing_tool_retries,
            continuation_retries,
        );
        if matches!(
            attempt_outcome,
            AttemptOutcome::Refusal | AttemptOutcome::ContentFilter
        ) {
            if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                let _ = remove_assistant_message(session_id, message_id);
            } else {
                clear_failed_assistant_draft(session_id, turn_id);
            }
            return Err(AgentRuntimeError::ProviderProtocol {
                kind: ProviderProtocolFailureKind::ContentBlocked,
                detail: format!(
                    "provider `{}` model `{}` stopped the response with `{}`",
                    request.provider.id,
                    request.model,
                    reply
                        .raw_stop_reason
                        .as_deref()
                        .unwrap_or(reply.stop_signal.label()),
                ),
            });
        }
        if attempt_outcome == AttemptOutcome::MaxTokensWithToolCalls {
            if let Some(message_id) = reply.ui_message_id.as_ref().filter(|id| !id.is_empty()) {
                let _ = remove_assistant_message(session_id, message_id);
            } else {
                clear_failed_assistant_draft(session_id, turn_id);
            }
            if matches!(
                recovery_action,
                RecoveryAction::Fail(ProviderProtocolFailureKind::IncompleteToolCall)
            ) {
                return Err(AgentRuntimeError::ProviderProtocol {
                    kind: ProviderProtocolFailureKind::IncompleteToolCall,
                    detail: format!(
                        "provider `{}` model `{}` repeatedly returned tool calls truncated by `{}`; no tool was executed",
                        request.provider.id,
                        request.model,
                        reply.raw_stop_reason.as_deref().unwrap_or("max_tokens"),
                    ),
                });
            }
            truncated_tool_retries += 1;
            append_truncated_tool_call_recovery(
                &mut messages,
                &mut attempt_local_overlay_start,
                &reply,
            );
            emit_provider_retry(
                session_id,
                turn_id,
                "provider_truncated_tool_call_retry",
                truncated_tool_retries,
                "tool calls were returned with max_tokens; no tool executed",
            );
            continue;
        }
        if reply.tool_calls.is_empty() {
            // A missing tool call is retryable only when the provider's native
            // stop signal says it intended tool use. Visible prose is never
            // classified to infer intent.
            let wants_tool_retry = !request.tools.is_empty()
                && recovery_action == RecoveryAction::RetryMissingToolCall;
            if wants_tool_retry {
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
                request.tool_choice = if request.capabilities.supports_tool_choice {
                    ModelToolChoice::Required
                } else {
                    ModelToolChoice::Auto
                };
                tool_choice_recovery_active = true;
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
            if attempt_outcome == AttemptOutcome::ToolUseWithoutCall {
                return Err(AgentRuntimeError::ProviderProtocol {
                    kind: ProviderProtocolFailureKind::IncompleteToolCall,
                    detail: format!(
                        "provider `{}` model `{}` stopped for tool use without one complete structured tool call",
                        request.provider.id, request.model,
                    ),
                });
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
                if matches!(
                    recovery_action,
                    RecoveryAction::Fail(ProviderProtocolFailureKind::ContentBlocked)
                ) {
                    return Err(AgentRuntimeError::ProviderProtocol {
                        kind: ProviderProtocolFailureKind::ContentBlocked,
                        detail: format!(
                            "provider `{}` model `{}` stopped the response with `{}`",
                            request.provider.id,
                            request.model,
                            reply
                                .raw_stop_reason
                                .as_deref()
                                .unwrap_or(reply.stop_signal.label()),
                        ),
                    });
                }
                if recovery_action == RecoveryAction::RetryReasoningOnly {
                    reasoning_only_retries += 1;
                    let input_start = messages.len();
                    advance_stateful_responses(
                        &mut messages,
                        reply_response_id.as_deref(),
                        input_start,
                    );
                    append_attempt_local_context_update(
                        &mut messages,
                        &mut attempt_local_overlay_start,
                        "reasoning-only-recovery",
                        "Finish the current response now. Return normal assistant text, or emit a complete structured tool call if a tool is required. Do not return reasoning alone.",
                    );
                    emit_provider_retry(
                        session_id,
                        turn_id,
                        "provider_reasoning_only_retry",
                        reasoning_only_retries,
                        "provider returned reasoning without final assistant text or tool call",
                    );
                    continue;
                }
                if recovery_action == RecoveryAction::RetryTerminalEmpty {
                    terminal_empty_retries += 1;
                    let input_start = messages.len();
                    advance_stateful_responses(
                        &mut messages,
                        reply_response_id.as_deref(),
                        input_start,
                    );
                    append_attempt_local_context_update(
                        &mut messages,
                        &mut attempt_local_overlay_start,
                        "terminal-empty-recovery",
                        "The previous response ended without assistant text or a tool call. Complete the same request now with normal assistant text or one complete structured tool call.",
                    );
                    emit_provider_retry(
                        session_id,
                        turn_id,
                        "provider_terminal_empty_retry",
                        terminal_empty_retries,
                        "assistant reply contained no visible text or tool call",
                    );
                    continue;
                }
                let reasoning_only = attempt_outcome == AttemptOutcome::ReasoningOnly;
                return Err(AgentRuntimeError::ProviderProtocol {
                    kind: match recovery_action {
                        RecoveryAction::Fail(kind) => kind,
                        _ if reasoning_only => ProviderProtocolFailureKind::ReasoningOnlyResponse,
                        _ => ProviderProtocolFailureKind::EmptyAssistantResponse,
                    },
                    detail: format!(
                        "provider `{}` model `{}` returned {} twice (stop reason: `{}`)",
                        request.provider.id,
                        request.model,
                        if reasoning_only {
                            "reasoning without final assistant text or tool call"
                        } else {
                            "no assistant text or tool call"
                        },
                        reply.raw_stop_reason.as_deref().unwrap_or("unknown"),
                    ),
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
                        request.tool_choice = if request.capabilities.supports_tool_choice {
                            tool_choice
                        } else {
                            ModelToolChoice::Auto
                        };
                    }
                    let input_start = messages.len();
                    advance_stateful_responses(
                        &mut messages,
                        reply_response_id.as_deref(),
                        input_start,
                    );
                    append_attempt_local_context_update(
                        &mut messages,
                        &mut attempt_local_overlay_start,
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
            let response_replay_items = if reply.provider_replay_protocol.as_deref()
                == Some(openai_responses::PROTOCOL_ID)
            {
                retained_provider_replay_items(&reply.provider_replay_items, &[])
            } else {
                Vec::new()
            };
            if !response_replay_items.is_empty() {
                provider_replay_items.extend(response_replay_items.clone());
            }
            if recovery_action == RecoveryAction::ContinueVisibleText
                && !this_segment.trim().is_empty()
            {
                reasoning_only_retries = 0;
                terminal_empty_retries = 0;
                truncated_tool_retries = 0;
                missing_tool_retries = 0;
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
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
            if !had_truncated_prefix
                && reply.provider_replay_protocol.as_deref() != Some(openai_responses::PROTOCOL_ID)
                && let Some(protocol) = reply.provider_replay_protocol.as_ref()
                && !reply.provider_replay_items.is_empty()
            {
                final_assistant["lyraProviderReplay"] = json!({
                    "protocol": protocol,
                    "items": reply.provider_replay_items.clone(),
                });
            }
            if let Some(reasoning_content) = reply
                .reasoning_content
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                final_assistant["reasoning_content"] = Value::String(reasoning_content.clone());
            }
            provider_transcript.push(final_assistant);
            let auxiliary_messages = take_provider_protocol_auxiliary_messages(
                &provider_transcript,
                &mut provider_protocol_transcript_cursor,
            );
            let mut final_protocol_step = provider_protocol_step(
                &request,
                turn_id,
                &reply,
                &[],
                "complete",
                Vec::new(),
                auxiliary_messages,
            );
            final_protocol_step["assistant"]["content"] = Value::String(final_text.clone());
            if had_truncated_prefix {
                // The last native reply only represents the final continuation
                // segment. Replaying it would silently discard the earlier
                // visible segments, so fall back to the canonical full text.
                final_protocol_step["replay"] = Value::Null;
            }
            attach_prior_provider_protocol_steps(
                &mut final_protocol_step,
                &deferred_provider_protocol_steps,
            );
            if !had_truncated_prefix
                && let Some(message_id) = reply
                    .ui_message_id
                    .as_ref()
                    .filter(|id| !id.trim().is_empty())
            {
                crate::native_backend::turns::persist_provider_protocol_step(
                    session_id,
                    turn_id,
                    message_id,
                    final_protocol_step.clone(),
                )?;
            }
            let mut result = ModelLoopResult::final_text(final_text)
                .with_ui_text_committed(reply.ui_message_id.is_some() && !had_truncated_prefix)
                .with_final_message_id(
                    (!had_truncated_prefix)
                        .then(|| reply.ui_message_id.clone())
                        .flatten(),
                )
                .with_provider_transcript(provider_transcript)
                .with_provider_replay_items(if had_truncated_prefix {
                    Vec::new()
                } else {
                    provider_replay_items
                })
                .with_merged_metadata(json!({ "providerProtocol": final_protocol_step }));
            if continuation_exhausted {
                result = result.with_merged_metadata(json!({
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

        let mut tool_calls = reply.tool_calls.clone();
        let stop_after_plan_finalize = tool_calls.iter().position(|call| {
            call.name == PLAN_FINALIZE_MODEL_TOOL
                || (call.name == UPDATE_PLAN_MODEL_TOOL
                    && call.arguments.get("action").and_then(Value::as_str) == Some("finalize"))
        });
        let plan_finalize_truncated =
            stop_after_plan_finalize.is_some_and(|index| index + 1 < tool_calls.len());
        if let Some(index) = stop_after_plan_finalize {
            tool_calls.truncate(index + 1);
        }
        let response_replay_items = if !plan_finalize_truncated
            && reply.provider_replay_protocol.as_deref() == Some(openai_responses::PROTOCOL_ID)
        {
            retained_provider_replay_items(&reply.provider_replay_items, &tool_calls)
        } else {
            Vec::new()
        };
        if !response_replay_items.is_empty() {
            provider_replay_items.extend(response_replay_items.clone());
            messages.extend(response_replay_items.clone());
        }
        let assistant_content = reply.content.clone().unwrap_or_default();
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
        } else if !plan_finalize_truncated
            && let Some(protocol) = reply.provider_replay_protocol.as_ref()
            && !reply.provider_replay_items.is_empty()
        {
            assistant_message["lyraProviderReplay"] = json!({
                "protocol": protocol,
                "items": reply.provider_replay_items.clone(),
            });
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
        let tool_step_message_id = reply.ui_message_id.clone();
        let auxiliary_messages = take_provider_protocol_auxiliary_messages(
            &provider_transcript,
            &mut provider_protocol_transcript_cursor,
        );
        let mut tool_protocol_step = provider_protocol_step(
            &request,
            turn_id,
            &reply,
            &tool_calls,
            "awaitingToolResults",
            Vec::new(),
            auxiliary_messages,
        );
        if plan_finalize_truncated {
            // Never persist opaque calls that Lyra deliberately did not
            // execute after plan finalization.
            tool_protocol_step["replay"] = Value::Null;
        }
        persist_tool_protocol_checkpoint(
            session_id,
            turn_id,
            tool_step_message_id.as_deref(),
            &tool_protocol_step,
        )?;
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
                let mut completed_tool_results = vec![None; tool_calls.len()];
                let results = super::turn_engine::run_batch_for_turn_with_completion(
                    tasks,
                    join_timeout,
                    turn_id,
                    |index, output| {
                        let call = &tool_calls[index];
                        let failed = tool_output_failed(output);
                        let (content, _) =
                            provider_visible_tool_result_content(output, &call.id, 24_000);
                        completed_tool_results[index] = Some(json!({
                            "toolCallId": call.id,
                            "content": content,
                            "status": if failed { "failed" } else { "completed" },
                        }));
                        tool_protocol_step["toolResults"] = Value::Array(
                            completed_tool_results
                                .iter()
                                .filter_map(Clone::clone)
                                .collect(),
                        );
                        persist_tool_protocol_checkpoint(
                            session_id,
                            turn_id,
                            tool_step_message_id.as_deref(),
                            &tool_protocol_step,
                        )
                    },
                )
                .await?;
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
                    let output = if let Some(block_msg) = &loop_blocks[idx] {
                        json!({
                            "content": block_msg,
                            "error": {
                                "code": "tool_loop_blocked",
                                "message": block_msg,
                            },
                            "truncated": false,
                            "recommendedNextAction": "Use a different tool or different arguments.",
                        })
                    } else if browser_paused && tool_protocol::is_browser_tool_name(&call.name) {
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
                            session_id,
                            turn_id,
                            dispatcher,
                            cancellation,
                            runtime,
                            call.clone(),
                        )
                        .await
                    };
                    let failed = tool_output_failed(&output);
                    let (content, _) =
                        provider_visible_tool_result_content(&output, &call.id, 24_000);
                    if let Some(results) = tool_protocol_step
                        .get_mut("toolResults")
                        .and_then(Value::as_array_mut)
                    {
                        results.push(json!({
                            "toolCallId": call.id,
                            "content": content,
                            "status": if failed { "failed" } else { "completed" },
                        }));
                    }
                    persist_tool_protocol_checkpoint(
                        session_id,
                        turn_id,
                        tool_step_message_id.as_deref(),
                        &tool_protocol_step,
                    )?;
                    sequential_outputs.push(output);
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
            tool_protocol_step["toolResults"] = json!([]);
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
                    "content": content.clone(),
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
                if let Some(results) = tool_protocol_step
                    .get_mut("toolResults")
                    .and_then(Value::as_array_mut)
                {
                    results.push(json!({
                        "toolCallId": call.id,
                        "content": content.clone(),
                        "status": if failed { "failed" } else { "completed" },
                    }));
                }
                persist_tool_protocol_checkpoint(
                    session_id,
                    turn_id,
                    tool_step_message_id.as_deref(),
                    &tool_protocol_step,
                )?;
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
            tool_protocol_step["status"] = json!("complete");
            tool_protocol_step["auxiliaryMessagesAfterToolResults"] =
                Value::Array(take_provider_protocol_auxiliary_messages(
                    &provider_transcript,
                    &mut provider_protocol_transcript_cursor,
                ));
            persist_tool_protocol_checkpoint(
                session_id,
                turn_id,
                tool_step_message_id.as_deref(),
                &tool_protocol_step,
            )?;
            if tool_step_message_id.is_none() {
                deferred_provider_protocol_steps.push(tool_protocol_step.clone());
            }
            if clarification_completed || quality_gate_recovery_completed {
                request.tool_choice = ModelToolChoice::Auto;
            } else if tool_choice_recovery_active {
                request.tool_choice = original_tool_choice.clone();
            }
            tool_choice_recovery_active = false;
            reasoning_only_retries = 0;
            terminal_empty_retries = 0;
            truncated_tool_retries = 0;
            missing_tool_retries = 0;
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
                let mut result = ModelLoopResult {
                    final_text: None,
                    final_message_id: None,
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
                if let Some(provider_protocol) =
                    combined_provider_protocol_steps(deferred_provider_protocol_steps)
                {
                    result = result
                        .with_merged_metadata(json!({ "providerProtocol": provider_protocol }));
                }
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
            append_attempt_local_context_update(
                &mut messages,
                &mut attempt_local_overlay_start,
                "browser-loop-correction",
                nudge,
            );
        }
        if progress_guard.browser_automation_paused {
            append_attempt_local_context_update(
                &mut messages,
                &mut attempt_local_overlay_start,
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
                append_attempt_local_context_update(
                    &mut messages,
                    &mut attempt_local_overlay_start,
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
                    deferred_provider_protocol_steps,
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
