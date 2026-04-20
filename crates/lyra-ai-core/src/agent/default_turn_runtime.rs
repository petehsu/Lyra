use std::collections::BTreeMap;

use napi::Result;
use serde_json::{json, Value};

use crate::agent::assistant_output::{
    append_assistant_message_to_stores, append_assistant_message_to_stores_with_display,
    inject_quality_pattern_memory, resolve_display_content_for_final_answer,
};
use crate::agent::auto_compact::{
    calculate_token_warning_state, get_auto_compact_threshold, get_effective_context_window,
    run_auto_compact, CompactCircuitBreaker,
};
use crate::agent::context_collapse::collapse_view_with_override;
use crate::agent::context_snip::{try_snip, SnipState};
use crate::agent::error_recovery::ErrorWithholdingBuffer;
use crate::agent::file_state_cache::FileStateCache;
use crate::agent::micro_compact::MicroCompactTracker;
use crate::agent::prefetch::PrefetchCache;
use crate::agent::prompt_pipeline::estimate_tokens;
use crate::agent::prompt_repetition::{
    build_live_repeated_user_input, build_post_compact_user_input,
};
use crate::agent::runtime_events::{emit_event, emit_transient_event};
use crate::agent::runtime_optimization_state::RuntimeOptimizationStateSnapshot;
use crate::agent::terminal_policy::TerminalInteractionPolicy;
use crate::agent::tool_budget::ToolResultBudgetState;
use crate::agent::tool_execution_flow::execute_tool_calls;
use crate::agent::tools::cleanup_transient_ai_sessions;
use crate::agent::turn_gates::{
    apply_grounding_gate, apply_intent_clarification_gate, apply_quality_gate, GroundingGateState,
    IntentClarificationState, QualityClarificationState, TurnGateAction,
};
use crate::agent::turn_guardrails::{
    browser_action_failure_requires_retry, browser_action_retry_message,
    browser_action_unmet_message, browser_observed_without_local_action,
    browser_workflow_retry_message, browser_workflow_unmet_message, local_browser_workflow_ready,
    restricted_browser_action_tools, should_emit_live_assistant_delta,
};
use crate::agent::turn_progress_guard::{TurnProgressGuardState, AGENT_TURN_PAUSED_NO_PROGRESS};
use crate::agent::turn_runtime_helpers::{
    apply_usage, build_turn_failed_assistant_message, build_turn_paused_assistant_message,
    emit_input_postprocessed, emit_memory_events, finalize_failed_turn, finalize_paused_turn,
    total_message_tokens, usage_from_accumulator,
};
use crate::agent::turn_strategy::TurnStrategy;
use crate::agent::types::{
    AgentMessage, AgentSendTurnRequest, AgentSendTurnResult, AgentSession, AgentToolCall,
    AgentTurn, AgentUsage, AGENT_PROVIDER_INVALID_RESPONSE, AGENT_TURN_FAILED,
    AGENT_WAITING_INTERACTION,
};
use crate::memory::kick_memory_pipeline;
use crate::provider;
use crate::provider::types::{
    AgentInferenceMessage, AgentInferenceMessageRole, AgentToolDefinition, AgentToolInvocation,
};
use crate::storage::registry_db;

const AGENT_ERROR_PREFIX: &str = "AGENT_ERROR::";

fn agent_error(code: &str, message: impl Into<String>) -> napi::Error {
    crate::error::to_error(format!("{AGENT_ERROR_PREFIX}{code}::{}", message.into()))
}

fn parse_agent_error_message(raw: &str) -> (&str, &str) {
    let Some(prefix_index) = raw.find(AGENT_ERROR_PREFIX) else {
        return (AGENT_TURN_FAILED, raw);
    };
    let rest = &raw[prefix_index + AGENT_ERROR_PREFIX.len()..];
    let mut parts = rest.splitn(2, "::");
    let code = parts.next().unwrap_or(AGENT_TURN_FAILED);
    let message = parts.next().unwrap_or(raw);
    if code.trim().is_empty() {
        (AGENT_TURN_FAILED, message)
    } else {
        (code, message)
    }
}

fn is_structured_plan_step(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if matches!(trimmed.chars().next(), Some('-' | '*' | '•' | '1'..='9')) {
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("• ") {
            return true;
        }
        let digit_prefix_len = trimmed.chars().take_while(|ch| ch.is_ascii_digit()).count();
        if digit_prefix_len > 0 {
            let suffix = trimmed[digit_prefix_len..].trim_start();
            return suffix.starts_with('.')
                || suffix.starts_with(')')
                || suffix.starts_with('、')
                || suffix.starts_with(':')
                || suffix.starts_with('-');
        }
    }
    false
}

pub(crate) fn sanitize_planning_output(raw: &str) -> String {
    let normalized = raw
        .replace("<｜end▁of▁thinking｜>", "")
        .replace("<|end_of_thinking|>", "")
        .replace("<end_of_thinking>", "");
    let steps = normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| is_structured_plan_step(line))
        .take(8)
        .map(str::to_string)
        .collect::<Vec<_>>();

    steps.join("\n")
}

fn missing_provider_output(assistant_text: &str, tool_calls: &[AgentToolInvocation]) -> bool {
    tool_calls.is_empty() && assistant_text.trim().is_empty()
}

fn provider_invalid_response_error() -> napi::Error {
    agent_error(
        AGENT_PROVIDER_INVALID_RESPONSE,
        "provider returned neither tool calls nor assistant text",
    )
}

pub(crate) struct DefaultTurnRuntimeParams {
    pub storage_root: String,
    pub session_id: String,
    pub request: AgentSendTurnRequest,
    pub running_turn: AgentTurn,
    pub session: AgentSession,
    pub input: String,
    pub profile: crate::profile::types::StoredAiProviderProfile,
    pub secrets: BTreeMap<String, String>,
    pub system_message: AgentInferenceMessage,
    pub provider_messages: Vec<AgentInferenceMessage>,
    pub effective_project_root: Option<String>,
    pub turn_strategy: TurnStrategy,
    pub explicit_max_steps: Option<u32>,
    pub effective_max_steps: Option<u32>,
    pub effective_planning: bool,
    pub effective_reflection: bool,
    pub terminal_policy: TerminalInteractionPolicy,
    pub tools: Vec<AgentToolDefinition>,
    pub resume_optimization_state_payload: Option<Value>,
}

pub(crate) struct DefaultTurnRuntimeOutcome {
    pub result: AgentSendTurnResult,
    pub optimization_state: Option<Value>,
}

pub(crate) fn execute_default_turn_runtime(
    params: DefaultTurnRuntimeParams,
) -> Result<DefaultTurnRuntimeOutcome> {
    let DefaultTurnRuntimeParams {
        storage_root,
        session_id,
        request,
        running_turn,
        session,
        input,
        profile,
        secrets,
        system_message,
        mut provider_messages,
        effective_project_root,
        turn_strategy,
        explicit_max_steps,
        effective_max_steps,
        effective_planning,
        effective_reflection,
        terminal_policy,
        tools,
        resume_optimization_state_payload,
    } = params;
    let mut tool_trace = Vec::new();
    let mut usage_accumulator = (0_i64, 0_i64, 0_i64, false);
    let mut progress_guard = TurnProgressGuardState::new(
        effective_max_steps,
        effective_max_steps
            .and_then(|cap| turn_strategy.soft_cap_message(cap, explicit_max_steps.is_some())),
    );
    let mut budget = ToolResultBudgetState::new();
    let mut file_cache = FileStateCache::new();
    let mut compact_breaker = CompactCircuitBreaker::new();
    let mut snip_state = SnipState::default();
    let mut micro_tracker = MicroCompactTracker::new();
    let prefetch_cache = PrefetchCache::new();
    let mut current_round: u32 = 0;
    let mut error_withholding = ErrorWithholdingBuffer::new();
    let mut strategy_reminder_injected = false;
    let mut browser_action_retry_injected = false;
    let mut browser_workflow_retry_injected = false;
    let mut grounding_gate_state = GroundingGateState::default();
    let mut quality_clarification_state = QualityClarificationState::default();
    let mut intent_clarification_state = IntentClarificationState::default();
    let mut restored_runtime_optimization = false;

    if let Some(snapshot_payload) = resume_optimization_state_payload.as_ref() {
        if let Some(snapshot) = RuntimeOptimizationStateSnapshot::from_payload(snapshot_payload) {
            current_round = snapshot.restore(
                &mut file_cache,
                &mut budget,
                &mut snip_state,
                &mut micro_tracker,
                &prefetch_cache,
            );
            restored_runtime_optimization = true;
        }
    }

    inject_quality_pattern_memory(&session_id, &mut provider_messages);

    // --- Planning step ---
    let strategy_planning_min_chars = turn_strategy.planning_min_chars_hint();
    let planning_min_chars = request
        .planning_min_chars
        .map(|value| value.max(1).min(strategy_planning_min_chars))
        .unwrap_or(strategy_planning_min_chars);
    if effective_planning && input.len() >= planning_min_chars {
        let planning_prefix = "[Lyra Internal Planning Module] Analyze the request and produce a concise step-by-step plan. Do NOT execute tools. Output a practical plan with at most 8 steps.\n\nUser request:\n";
        let planning_input = build_live_repeated_user_input(
            &input,
            estimate_tokens(&system_message.content)
                + estimate_tokens(planning_prefix)
                + estimate_tokens(&input),
            profile.model.as_str(),
        );
        emit_input_postprocessed(
            &storage_root,
            &session_id,
            &running_turn.id,
            "planning",
            &planning_input,
        )?;
        let planning_messages = vec![
            system_message.clone(),
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: format!("{planning_prefix}{}", planning_input.transformed_input),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
        ];
        if let Ok(plan_inference) = provider::run_agent_inference(
            &profile.to_public(),
            &secrets,
            &planning_messages,
            &[], // No tools — pure reasoning
            None::<&mut dyn FnMut(&str)>,
            None::<&mut dyn FnMut(&str)>,
        ) {
            apply_usage(&mut usage_accumulator, &plan_inference.usage);
            let plan_text = sanitize_planning_output(plan_inference.assistant_text.trim());
            if !plan_text.is_empty() {
                // Inject plan as a user hint into provider messages
                provider_messages.push(AgentInferenceMessage {
                    role: AgentInferenceMessageRole::User,
                    content: format!("[Plan]\n{plan_text}"),
                    tool_call_id: None,
                    tool_calls: Vec::new(),
                });
                emit_event(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    "planning_completed",
                    json!({ "plan": plan_text }),
                )?;
            }
        }
    }

    let turn_result = (|| -> Result<(AgentTurn, Option<AgentMessage>, Vec<AgentToolCall>, Option<AgentUsage>)> {
    let mut step_index = 0_u32;
    loop {
        if step_index == 0 && tool_trace.is_empty() {
            match apply_intent_clarification_gate(
                &storage_root,
                &session_id,
                &running_turn.id,
                &profile,
                &secrets,
                &system_message,
                &input,
                &mut provider_messages,
                &mut intent_clarification_state,
            )? {
                TurnGateAction::Continue => {}
                TurnGateAction::Retry => {
                    step_index = step_index.saturating_add(1);
                    continue;
                }
                TurnGateAction::Pause {
                    reason,
                    include_assistant_prefix: _,
                } => {
                    let (assistant_message, memory_events) = append_assistant_message_to_stores(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        &reason,
                        effective_project_root.as_deref(),
                    )?;
                    emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
                    let usage = usage_from_accumulator(
                        usage_accumulator.0,
                        usage_accumulator.1,
                        usage_accumulator.2,
                        usage_accumulator.3,
                    );
                    let paused_turn = finalize_paused_turn(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        AGENT_TURN_PAUSED_NO_PROGRESS,
                        &reason,
                        usage.as_ref(),
                    )?;
                    kick_memory_pipeline(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        effective_project_root.clone(),
                    )?;
                    return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
                }
            }
        }

        if let Some(reason) = progress_guard.before_step(step_index) {
            let assistant_text = build_turn_paused_assistant_message(&reason.message, "");
            let (assistant_message, memory_events) = append_assistant_message_to_stores(
                &storage_root,
                &session_id,
                &running_turn.id,
                &assistant_text,
                effective_project_root.as_deref(),
            )?;
            emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
            let usage = usage_from_accumulator(
                usage_accumulator.0,
                usage_accumulator.1,
                usage_accumulator.2,
                usage_accumulator.3,
            );
            let paused_turn = finalize_paused_turn(
                &storage_root,
                &session_id,
                &running_turn.id,
                &reason.code,
                &reason.message,
                usage.as_ref(),
            )?;
            kick_memory_pipeline(
                &storage_root,
                &session_id,
                &running_turn.id,
                effective_project_root.clone(),
            )?;
            return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
        }

        if !strategy_reminder_injected {
            if let Some(reminder_after_step) = turn_strategy.reminder_after_step() {
                if step_index >= reminder_after_step {
                    if let Some(reminder) = turn_strategy.reminder_message() {
                        provider_messages.push(AgentInferenceMessage {
                            role: AgentInferenceMessageRole::User,
                            content: reminder.to_string(),
                            tool_call_id: None,
                            tool_calls: Vec::new(),
                        });
                        strategy_reminder_injected = true;
                        emit_event(
                            &storage_root,
                            &session_id,
                            &running_turn.id,
                            "turn_strategy_reminder",
                            json!({
                                "strategy": turn_strategy.kind.as_str(),
                                "stepIndex": step_index,
                            }),
                        )?;
                    }
                }
            }
        }

        // --- Auto-Compact: check context window pressure before inference ---
        let model_hint = profile.model.as_str();
        let effective_window = get_effective_context_window(model_hint);
        let compact_threshold = get_auto_compact_threshold(model_hint);

        // Rough token count of current provider messages
        let total_chars: usize = provider_messages.iter().map(|m| m.content.len()).sum();
        let estimated_tokens = total_chars / 4;

        // --- Snip: lightweight message trimming (zero LLM cost) ---
        // Triggers earlier than auto-compact (70% vs ~85%) and removes only Tool messages
        if estimated_tokens > (compact_threshold as f64 * 0.82) as usize {
            try_snip(&mut provider_messages, &mut snip_state, estimated_tokens, effective_window);
        }

        if estimated_tokens > compact_threshold {
            let warning_state = calculate_token_warning_state(estimated_tokens, model_hint);
            if warning_state.should_auto_compact && compact_breaker.can_compact() {
                match run_auto_compact(
                    &profile.to_public(),
                    &secrets,
                    &provider_messages,
                    &input,
                ) {
                    Ok(summary) => {
                        emit_event(
                            &storage_root,
                            &session_id,
                            &running_turn.id,
                            "auto_compact_completed",
                            json!({
                                "summary_length": summary.len(),
                                "tokens_before": estimated_tokens,
                                "tokens_after": summary.len() / 4,
                            }),
                        )?;

                        // Replace provider messages with boundary marker + summary
                        let boundary_marker = format!(
                            "<context_boundary>\nPrevious conversation was compacted for brevity. Summary of prior work:\n{}\n</context_boundary>",
                            summary
                        );
                        provider_messages.clear();
                        provider_messages.push(system_message.clone());
                        provider_messages.push(AgentInferenceMessage {
                            role: AgentInferenceMessageRole::User,
                            content: boundary_marker,
                            tool_call_id: None,
                            tool_calls: Vec::new(),
                        });
                        let post_compact_input = build_post_compact_user_input(
                            &input,
                            total_message_tokens(&provider_messages),
                            model_hint,
                        );
                        provider_messages.push(AgentInferenceMessage {
                            role: AgentInferenceMessageRole::User,
                            content: post_compact_input.transformed_input.clone(),
                            tool_call_id: None,
                            tool_calls: Vec::new(),
                        });
                        emit_input_postprocessed(
                            &storage_root,
                            &session_id,
                            &running_turn.id,
                            "post_compact_anchor",
                            &post_compact_input,
                        )?;

                        // Clear file state cache after compaction (context reset)
                        file_cache.clear();
                        compact_breaker.record_success();
                    }
                    Err(e) => {
                        compact_breaker.record_failure(&e.to_string());
                        emit_event(
                            &storage_root,
                            &session_id,
                            &running_turn.id,
                            "auto_compact_failed",
                            json!({
                                "error": e.to_string(),
                                "consecutive_failures": compact_breaker.consecutive_failures,
                            }),
                        )?;
                    }
                }
            }
        }

        // --- Context Collapse: apply folded view before inference (experimental) ---
        let inference_messages = collapse_view_with_override(
            &provider_messages,
            Some(request.enable_context_collapse.unwrap_or(true)),
        );

        let browser_action_enforcement_active =
            browser_action_retry_injected && browser_observed_without_local_action(&tool_trace);
        let browser_local_workflow_restricted =
            local_browser_workflow_ready(&tool_trace)
                && browser_observed_without_local_action(&tool_trace);
        let available_tools = if browser_action_enforcement_active
            || browser_local_workflow_restricted
        {
            restricted_browser_action_tools(&tools)
        } else {
            tools.clone()
        };

        let inference = provider::run_agent_inference(
            &profile.to_public(),
            &secrets,
            &inference_messages,
            &available_tools,
            Some(&mut |delta| {
                if delta.is_empty() {
                    return;
                }
                if !should_emit_live_assistant_delta(false) {
                    return;
                }
                let _ = emit_transient_event(
                    &session_id,
                    &running_turn.id,
                    "assistant_delta",
                    json!({
                        "delta": delta,
                    }),
                );
            }),
            Some(&mut |thought| {
                if thought.is_empty() {
                    return;
                }
                let _ = emit_transient_event(
                    &session_id,
                    &running_turn.id,
                    "reasoning_thought",
                    json!({
                        "thought": thought,
                    }),
                );
            }),
        )
        .map_err(|error| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("provider inference failed: {error}"),
            )
        })?;

        apply_usage(&mut usage_accumulator, &inference.usage);

        if missing_provider_output(&inference.assistant_text, &inference.tool_calls) {
            return Err(provider_invalid_response_error());
        }

        if !inference.tool_calls.is_empty() {
            if let Some(reason) =
                progress_guard.observe_inference(&inference.assistant_text, &inference.tool_calls)
            {
                let assistant_text =
                    build_turn_paused_assistant_message(&reason.message, &inference.assistant_text);
                let (assistant_message, memory_events) = append_assistant_message_to_stores(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    &assistant_text,
                    effective_project_root.as_deref(),
                )?;
                emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
                let usage = usage_from_accumulator(
                    usage_accumulator.0,
                    usage_accumulator.1,
                    usage_accumulator.2,
                    usage_accumulator.3,
                );
                let paused_turn = finalize_paused_turn(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    &reason.code,
                    &reason.message,
                    usage.as_ref(),
                )?;
                kick_memory_pipeline(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    effective_project_root.clone(),
                )?;
                return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
            }

            let assistant_tool_text = inference.assistant_text.clone();
            provider_messages.push(AgentInferenceMessage {
                role: AgentInferenceMessageRole::Assistant,
                content: assistant_tool_text,
                tool_call_id: None,
                tool_calls: inference.tool_calls.clone(),
            });

            let executed = execute_tool_calls(
                &storage_root,
                &session_id,
                &running_turn.id,
                &inference.tool_calls,
                effective_project_root.as_deref(),
                &terminal_policy,
                false,
                &mut provider_messages,
                &mut budget,
                &mut file_cache,
                &mut error_withholding,
            )?;
            tool_trace.extend(executed.clone());

            // --- Micro-Compact: record creation times for new tool results ---
            current_round += 1;
            for tool_call in &inference.tool_calls {
                micro_tracker.record_creation(&tool_call.id, &tool_call.name, current_round);
            }

            // --- Micro-Compact: compress stale tool results ---
            micro_tracker.try_compact(&mut provider_messages, current_round);

            // --- Prefetch: schedule background prefetch for next round ---
            prefetch_cache.purge_stale(60_000); // 60s TTL
            crate::agent::prefetch::schedule_prefetch(
                &inference.tool_calls,
                effective_project_root.as_deref(),
                &prefetch_cache,
            );
            if let Some(reason) = progress_guard.observe_tool_results(&executed) {
                let assistant_text =
                    build_turn_paused_assistant_message(&reason.message, &inference.assistant_text);
                let (assistant_message, memory_events) = append_assistant_message_to_stores(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    &assistant_text,
                    effective_project_root.as_deref(),
                )?;
                emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
                let usage = usage_from_accumulator(
                    usage_accumulator.0,
                    usage_accumulator.1,
                    usage_accumulator.2,
                    usage_accumulator.3,
                );
                let paused_turn = finalize_paused_turn(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    &reason.code,
                    &reason.message,
                    usage.as_ref(),
                )?;
                kick_memory_pipeline(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    effective_project_root.clone(),
                )?;
                return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
            }
            step_index = step_index.saturating_add(1);
            continue;
        }

        let mut assistant_text = inference.assistant_text.trim().to_string();
        if !browser_workflow_retry_injected
            && !assistant_text.is_empty()
            && browser_action_failure_requires_retry(&tool_trace)
        {
            browser_workflow_retry_injected = true;
            provider_messages.push(AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: browser_workflow_retry_message(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            });
            emit_event(
                &storage_root,
                &session_id,
                &running_turn.id,
                "browser_workflow_retry_injected",
                json!({
                    "reason": "retryable_browser_workflow_failure",
                    "toolTraceCount": tool_trace.len(),
                }),
            )?;
            step_index = step_index.saturating_add(1);
            continue;
        }

        if !browser_action_retry_injected
            && !assistant_text.is_empty()
            && browser_observed_without_local_action(&tool_trace)
        {
            browser_action_retry_injected = true;
            provider_messages.push(AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: browser_action_retry_message(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            });
            emit_event(
                &storage_root,
                &session_id,
                &running_turn.id,
                "browser_action_retry_injected",
                json!({
                    "reason": "observation_only_browser_turn",
                    "observationOnly": true,
                    "toolTraceCount": tool_trace.len(),
                }),
            )?;
            step_index = step_index.saturating_add(1);
            continue;
        }

        if browser_workflow_retry_injected
            && !assistant_text.is_empty()
            && browser_action_failure_requires_retry(&tool_trace)
        {
            let assistant_text = build_turn_paused_assistant_message(
                &browser_workflow_unmet_message(),
                &assistant_text,
            );
            let (assistant_message, memory_events) = append_assistant_message_to_stores(
                &storage_root,
                &session_id,
                &running_turn.id,
                &assistant_text,
                effective_project_root.as_deref(),
            )?;
            emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
            let usage = usage_from_accumulator(
                usage_accumulator.0,
                usage_accumulator.1,
                usage_accumulator.2,
                usage_accumulator.3,
            );
            emit_event(
                &storage_root,
                &session_id,
                &running_turn.id,
                "browser_workflow_required_unmet",
                json!({
                    "reason": "retryable_browser_workflow_failure",
                    "toolTraceCount": tool_trace.len(),
                }),
            )?;
            let paused_turn = finalize_paused_turn(
                &storage_root,
                &session_id,
                &running_turn.id,
                AGENT_TURN_PAUSED_NO_PROGRESS,
                &browser_workflow_unmet_message(),
                usage.as_ref(),
            )?;
            kick_memory_pipeline(
                &storage_root,
                &session_id,
                &running_turn.id,
                effective_project_root.clone(),
            )?;
            return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
        }

        if browser_action_retry_injected
            && !assistant_text.is_empty()
            && browser_observed_without_local_action(&tool_trace)
        {
            let assistant_text = build_turn_paused_assistant_message(
                &browser_action_unmet_message(),
                &assistant_text,
            );
            let (assistant_message, memory_events) = append_assistant_message_to_stores(
                &storage_root,
                &session_id,
                &running_turn.id,
                &assistant_text,
                effective_project_root.as_deref(),
            )?;
            emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
            let usage = usage_from_accumulator(
                usage_accumulator.0,
                usage_accumulator.1,
                usage_accumulator.2,
                usage_accumulator.3,
            );
            emit_event(
                &storage_root,
                &session_id,
                &running_turn.id,
                "browser_action_required_unmet",
                json!({
                    "reason": "observation_only_browser_turn",
                    "toolTraceCount": tool_trace.len(),
                }),
            )?;
            let paused_turn = finalize_paused_turn(
                &storage_root,
                &session_id,
                &running_turn.id,
                AGENT_TURN_PAUSED_NO_PROGRESS,
                &browser_action_unmet_message(),
                usage.as_ref(),
            )?;
            kick_memory_pipeline(
                &storage_root,
                &session_id,
                &running_turn.id,
                effective_project_root.clone(),
            )?;
            return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
        }

        if !assistant_text.is_empty()
            && tool_trace.is_empty()
        {
            match apply_quality_gate(
                &storage_root,
                &session_id,
                &running_turn.id,
                &profile,
                &secrets,
                &system_message,
                &input,
                &mut assistant_text,
                &tool_trace,
                &mut provider_messages,
                &mut quality_clarification_state,
            )? {
                TurnGateAction::Continue => {}
                TurnGateAction::Retry => {
                    step_index = step_index.saturating_add(1);
                    continue;
                }
                TurnGateAction::Pause {
                    reason,
                    include_assistant_prefix,
                } => {
                    let paused_text = build_turn_paused_assistant_message(
                        &reason,
                        if include_assistant_prefix {
                            &assistant_text
                        } else {
                            ""
                        },
                    );
                    let (assistant_message, memory_events) = append_assistant_message_to_stores(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        &paused_text,
                        effective_project_root.as_deref(),
                    )?;
                    emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
                    let usage = usage_from_accumulator(
                        usage_accumulator.0,
                        usage_accumulator.1,
                        usage_accumulator.2,
                        usage_accumulator.3,
                    );
                    let paused_turn = finalize_paused_turn(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        AGENT_TURN_PAUSED_NO_PROGRESS,
                        &reason,
                        usage.as_ref(),
                    )?;
                    kick_memory_pipeline(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        effective_project_root.clone(),
                    )?;
                    return Ok((
                        paused_turn,
                        Some(assistant_message),
                        tool_trace.clone(),
                        usage,
                    ));
                }
            }
        }

        if !assistant_text.is_empty() {
            match apply_grounding_gate(
                &storage_root,
                &session_id,
                &running_turn.id,
                &input,
                &assistant_text,
                &tool_trace,
                &mut provider_messages,
                &mut grounding_gate_state,
            )? {
                TurnGateAction::Continue => {}
                TurnGateAction::Retry => {
                    step_index = step_index.saturating_add(1);
                    continue;
                }
                TurnGateAction::Pause {
                    reason,
                    include_assistant_prefix,
                } => {
                    let paused_text = build_turn_paused_assistant_message(
                        &reason,
                        if include_assistant_prefix {
                            &assistant_text
                        } else {
                            ""
                        },
                    );
                    let (assistant_message, memory_events) = append_assistant_message_to_stores(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        &paused_text,
                        effective_project_root.as_deref(),
                    )?;
                    emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
                    let usage = usage_from_accumulator(
                        usage_accumulator.0,
                        usage_accumulator.1,
                        usage_accumulator.2,
                        usage_accumulator.3,
                    );
                    let paused_turn = finalize_paused_turn(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        AGENT_TURN_PAUSED_NO_PROGRESS,
                        &reason,
                        usage.as_ref(),
                    )?;
                    kick_memory_pipeline(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        effective_project_root.clone(),
                    )?;
                    return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage));
                }
            }
        }

        if !assistant_text.is_empty() {
            let reflection_min_calls = request.reflection_min_tool_calls.unwrap_or(3);
            if effective_reflection && tool_trace.len() >= reflection_min_calls {
                let tool_summary: Vec<String> = tool_trace
                    .iter()
                    .map(|tc| {
                        format!(
                            "{}({})",
                            tc.tool_name,
                            tc.input.to_string().chars().take(80).collect::<String>()
                        )
                    })
                    .collect();
                let reflection_messages = vec![
                    system_message.clone(),
                    AgentInferenceMessage {
                        role: AgentInferenceMessageRole::User,
                        content: format!(
                            "[Lyra Pre-Answer Self Check]\\nReview the draft answer for correctness and completeness.\\nIf it is correct, output exactly `LGTM`.\\nIf it is not correct, output only a corrected final answer in the user language (no explanations, no tags).\\n\\nTools used: {}\\n\\nDraft answer:\\n{}",
                            tool_summary.join(", "),
                            assistant_text
                        ),
                        tool_call_id: None,
                        tool_calls: Vec::new(),
                    },
                ];
                if let Ok(reflection) = provider::run_agent_inference(
                    &profile.to_public(),
                    &secrets,
                    &reflection_messages,
                    &[],
                    None::<&mut dyn FnMut(&str)>,
                    None::<&mut dyn FnMut(&str)>,
                ) {
                    apply_usage(&mut usage_accumulator, &reflection.usage);
                    let reflection_text = reflection.assistant_text.trim();
                    if !reflection_text.is_empty() && !reflection_text.starts_with("LGTM") {
                        assistant_text = reflection_text.to_string();
                    }
                    emit_event(
                        &storage_root,
                        &session_id,
                        &running_turn.id,
                        "pre_answer_self_check_completed",
                        json!({
                            "corrected": !reflection_text.is_empty() && !reflection_text.starts_with("LGTM"),
                        }),
                    )?;
                }
            }
        }

        let display_content = resolve_display_content_for_final_answer(
            &profile,
            &secrets,
            &system_message,
            &input,
            &assistant_text,
        );
        let (assistant_message, memory_events) = append_assistant_message_to_stores_with_display(
            &storage_root,
            &session_id,
            &running_turn.id,
            &assistant_text,
            Some(&display_content),
            effective_project_root.as_deref(),
        )?;
        emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;

        let usage = usage_from_accumulator(
            usage_accumulator.0,
            usage_accumulator.1,
            usage_accumulator.2,
            usage_accumulator.3,
        );
        let completed_turn =
            registry_db::complete_agent_turn(&storage_root, &running_turn.id, usage.as_ref())?;

        emit_event(
            &storage_root,
            &session_id,
            &running_turn.id,
            "completed",
            json!({
                "assistantMessageId": assistant_message.id,
                "toolCallCount": tool_trace.len(),
                "usage": usage,
            }),
        )?;

        kick_memory_pipeline(
            &storage_root,
            &session_id,
            &running_turn.id,
            effective_project_root.clone(),
        )?;

        // Reset error withholding buffer for next turn
        error_withholding.reset();

        return Ok((completed_turn, Some(assistant_message), tool_trace.clone(), usage));
    }
})();

    let (turn, assistant_message, tool_calls, usage) = match turn_result {
        Ok(value) => value,
        Err(error) => {
            let error_display = error.to_string();
            let (code, message) = parse_agent_error_message(&error_display);
            let is_waiting_interaction = code == AGENT_WAITING_INTERACTION;
            let failed_turn = if is_waiting_interaction {
                finalize_paused_turn(
                    &storage_root,
                    &session_id,
                    &running_turn.id,
                    code,
                    message,
                    None,
                )?
            } else {
                finalize_failed_turn(&storage_root, &session_id, &running_turn.id, code, message)?
            };
            let failure_message = if is_waiting_interaction {
                build_turn_paused_assistant_message(message, "")
            } else {
                build_turn_failed_assistant_message(code, message)
            };
            let (assistant_message, memory_events) = append_assistant_message_to_stores(
                &storage_root,
                &session_id,
                &running_turn.id,
                &failure_message,
                effective_project_root.as_deref(),
            )?;
            emit_memory_events(&storage_root, &session_id, &running_turn.id, memory_events)?;
            let usage = usage_from_accumulator(
                usage_accumulator.0,
                usage_accumulator.1,
                usage_accumulator.2,
                usage_accumulator.3,
            );
            (
                failed_turn,
                Some(assistant_message),
                tool_trace.clone(),
                usage,
            )
        }
    };

    cleanup_transient_ai_sessions(&session_id, &running_turn.id);

    let next_session =
        registry_db::read_agent_session(&storage_root, &session_id)?.unwrap_or(session);

    let result = AgentSendTurnResult {
        session: next_session,
        turn,
        assistant_message,
        tool_calls,
        usage,
    };

    let optimization_state = if result.turn.status == "paused" {
        let snapshot = RuntimeOptimizationStateSnapshot::capture(
            &file_cache,
            &budget,
            &snip_state,
            &micro_tracker,
            &prefetch_cache,
            current_round,
        );
        if snapshot.is_empty() {
            None
        } else {
            Some(snapshot.to_payload())
        }
    } else {
        None
    };

    if restored_runtime_optimization {
        emit_event(
            &storage_root,
            &session_id,
            &result.turn.id,
            "runtime_optimization_state_restored",
            json!({
                "restored": true,
                "pauseSnapshotPersisted": optimization_state.is_some(),
                "turnStatus": result.turn.status,
            }),
        )?;
    }

    Ok(DefaultTurnRuntimeOutcome {
        result,
        optimization_state,
    })
}
