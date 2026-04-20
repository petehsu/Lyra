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
use crate::agent::plan_helpers::{
    approved_plan_from_tool_calls, build_plan_mode_enforcement_prompt, proposed_plan_from_content,
    select_plan_handoff_input,
};
use crate::agent::prefetch::PrefetchCache;
use crate::agent::prompt_pipeline::{build_system_prompt, PromptBuildInput};
use crate::agent::prompt_repetition::{
    build_live_repeated_user_input, build_post_compact_user_input,
};
use crate::agent::runtime_events::{emit_event, emit_transient_event};
use crate::agent::runtime_optimization_state::RuntimeOptimizationStateSnapshot;
use crate::agent::terminal_policy::{
    select_terminal_interaction_policy, TerminalInteractionPolicy,
};
use crate::agent::tool_budget::ToolResultBudgetState;
use crate::agent::tool_execution_flow::execute_tool_calls;
use crate::agent::tools::{
    cleanup_transient_ai_sessions, derive_browser_strategy_routing_context,
    derive_workbench_web_routing_context, get_browser_strategy_runtime_state,
    merge_browser_strategy_runtime_state, readonly_tool_definitions_for_input_with_context,
    render_activated_skill_prompts, render_mcp_tools_prompt_json, ToolRankingContext,
};
use crate::agent::turn_gates::{
    apply_grounding_gate, apply_intent_clarification_gate, apply_quality_gate, GroundingGateState,
    IntentClarificationState, QualityClarificationState, TurnGateAction,
};
use crate::agent::turn_guardrails::should_emit_live_assistant_delta;
use crate::agent::turn_progress_guard::{TurnProgressGuardState, AGENT_TURN_PAUSED_NO_PROGRESS};
use crate::agent::turn_runtime_helpers::{
    apply_usage, build_turn_failed_assistant_message, build_turn_paused_assistant_message,
    emit_input_postprocessed, emit_memory_events, finalize_failed_turn, finalize_paused_turn,
    total_message_tokens, usage_from_accumulator,
};
use crate::agent::turn_strategy::select_turn_strategy;
use crate::agent::types::{
    AgentMessage, AgentSendTurnRequest, AgentSendTurnResult, AgentSession, AgentToolCall,
    AgentTurn, AgentUsage, AGENT_PROVIDER_INVALID_RESPONSE, AGENT_TURN_FAILED,
    AGENT_WAITING_INTERACTION,
};
use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::error::to_error;
use crate::memory::{build_turn_context, kick_memory_pipeline};
use crate::profile::types::StoredAiProviderProfile;
use crate::provider;
use crate::provider::types::{
    AgentInferenceMessage, AgentInferenceMessageRole, AgentToolDefinition, AgentToolInvocation,
};
use crate::storage::registry_db;

const AGENT_ERROR_PREFIX: &str = "AGENT_ERROR::";

fn agent_error(code: &str, message: impl Into<String>) -> napi::Error {
    to_error(format!("{AGENT_ERROR_PREFIX}{code}::{}", message.into()))
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
fn missing_provider_output(assistant_text: &str, tool_calls: &[AgentToolInvocation]) -> bool {
    tool_calls.is_empty() && assistant_text.trim().is_empty()
}

fn provider_invalid_response_error() -> napi::Error {
    agent_error(
        AGENT_PROVIDER_INVALID_RESPONSE,
        "provider returned neither tool calls nor assistant text",
    )
}

pub(crate) fn build_tool_ranking_context(
    storage_root: &str,
    session_id: &str,
) -> Result<ToolRankingContext> {
    let tool_calls = registry_db::list_agent_tool_calls(storage_root, session_id)?;
    Ok(ToolRankingContext {
        workbench_web: derive_workbench_web_routing_context(&tool_calls),
        browser_strategy: merge_browser_strategy_runtime_state(
            derive_browser_strategy_routing_context(&tool_calls),
        ),
    })
}

pub(crate) fn browser_tool_families_prompt() -> String {
    let state = get_browser_strategy_runtime_state();
    let mut families = vec!["lyra.web.*".to_string()];
    if state.browser_use_tool_exposed {
        families.push("browser_use.*".to_string());
    }
    families.join(", ")
}

pub(crate) fn run_provider_loop(
    storage_root: &str,
    session_id: &str,
    running_turn: &AgentTurn,
    current_input: &str,
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: AgentInferenceMessage,
    mut provider_messages: Vec<AgentInferenceMessage>,
    tools: Vec<AgentToolDefinition>,
    effective_project_root: Option<String>,
    terminal_policy: &TerminalInteractionPolicy,
    enable_context_collapse: bool,
    plan_mode: bool,
    enable_reflection: bool,
    reflection_min_calls: usize,
    resume_optimization_state_payload: Option<Value>,
) -> Result<(
    AgentTurn,
    Option<AgentMessage>,
    Vec<AgentToolCall>,
    Option<AgentUsage>,
    Option<String>,
    Option<Value>,
)> {
    let mut tool_trace = Vec::new();
    let mut usage_accumulator = (0_i64, 0_i64, 0_i64, false);
    let mut progress_guard = TurnProgressGuardState::default();
    let mut budget = ToolResultBudgetState::new();
    let mut file_cache = FileStateCache::new();
    let mut compact_breaker = CompactCircuitBreaker::new();
    let mut snip_state = SnipState::default();
    let mut micro_tracker = MicroCompactTracker::new();
    let prefetch_cache = PrefetchCache::new();
    let mut current_round: u32 = 0;
    let mut error_withholding = ErrorWithholdingBuffer::new();
    let mut plan_mode_enforcement_attempted = false;
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

    inject_quality_pattern_memory(session_id, &mut provider_messages);

    let turn_result = (|| -> Result<(
        AgentTurn,
        Option<AgentMessage>,
        Vec<AgentToolCall>,
        Option<AgentUsage>,
        Option<String>,
    )> {
        let mut step_index = 0_u32;
        loop {
            if !plan_mode && step_index == 0 && tool_trace.is_empty() {
                match apply_intent_clarification_gate(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    profile,
                    secrets,
                    &system_message,
                    current_input,
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
                            storage_root,
                            session_id,
                            &running_turn.id,
                            &reason,
                            effective_project_root.as_deref(),
                        )?;
                        emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                        let usage = usage_from_accumulator(
                            usage_accumulator.0,
                            usage_accumulator.1,
                            usage_accumulator.2,
                            usage_accumulator.3,
                        );
                        let paused_turn = finalize_paused_turn(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            AGENT_TURN_PAUSED_NO_PROGRESS,
                            &reason,
                            usage.as_ref(),
                        )?;
                        kick_memory_pipeline(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            effective_project_root.clone(),
                        )?;
                        return Ok((
                            paused_turn,
                            Some(assistant_message),
                            tool_trace.clone(),
                            usage,
                            None,
                        ));
                    }
                }
            }

            let model_hint = profile.model.as_str();
            let effective_window = get_effective_context_window(model_hint);
            let compact_threshold = get_auto_compact_threshold(model_hint);
            let total_chars: usize = provider_messages.iter().map(|m| m.content.len()).sum();
            let estimated_tokens = total_chars / 4;

            if estimated_tokens > (compact_threshold as f64 * 0.82) as usize {
                try_snip(&mut provider_messages, &mut snip_state, estimated_tokens, effective_window);
            }

            if estimated_tokens > compact_threshold {
                let warning_state = calculate_token_warning_state(estimated_tokens, model_hint);
                if warning_state.should_auto_compact && compact_breaker.can_compact() {
                    match run_auto_compact(
                        &profile.to_public(),
                        secrets,
                        &provider_messages,
                        current_input,
                    ) {
                        Ok(summary) => {
                            emit_event(
                                storage_root,
                                session_id,
                                &running_turn.id,
                                "auto_compact_completed",
                                json!({
                                    "summary_length": summary.len(),
                                    "tokens_before": estimated_tokens,
                                    "tokens_after": summary.len() / 4,
                                }),
                            )?;
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
                                current_input,
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
                                storage_root,
                                session_id,
                                &running_turn.id,
                                "post_compact_anchor",
                                &post_compact_input,
                            )?;
                            file_cache.clear();
                            compact_breaker.record_success();
                        }
                        Err(error) => {
                            compact_breaker.record_failure(&error.to_string());
                            emit_event(
                                storage_root,
                                session_id,
                                &running_turn.id,
                                "auto_compact_failed",
                                json!({
                                    "error": error.to_string(),
                                    "consecutive_failures": compact_breaker.consecutive_failures,
                                }),
                            )?;
                        }
                    }
                }
            }

            let inference_messages =
                collapse_view_with_override(&provider_messages, Some(enable_context_collapse));

            let inference = provider::run_agent_inference(
                &profile.to_public(),
                secrets,
                &inference_messages,
                &tools,
                Some(&mut |delta| {
                    if delta.is_empty() {
                        return;
                    }
                    if !should_emit_live_assistant_delta(plan_mode) {
                        return;
                    }
                    let _ = emit_transient_event(
                        session_id,
                        &running_turn.id,
                        "assistant_delta",
                        json!({ "delta": delta }),
                    );
                }),
                Some(&mut |thought| {
                    if thought.is_empty() {
                        return;
                    }
                    let _ = emit_transient_event(
                        session_id,
                        &running_turn.id,
                        "reasoning_thought",
                        json!({ "thought": thought }),
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
                        storage_root,
                        session_id,
                        &running_turn.id,
                        &assistant_text,
                        effective_project_root.as_deref(),
                    )?;
                    emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                    let usage = usage_from_accumulator(
                        usage_accumulator.0,
                        usage_accumulator.1,
                        usage_accumulator.2,
                        usage_accumulator.3,
                    );
                    let paused_turn = finalize_paused_turn(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        AGENT_TURN_PAUSED_NO_PROGRESS,
                        &reason.message,
                        usage.as_ref(),
                    )?;
                    kick_memory_pipeline(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        effective_project_root.clone(),
                    )?;
                    return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage, None));
                }

                provider_messages.push(AgentInferenceMessage {
                    role: AgentInferenceMessageRole::Assistant,
                    content: inference.assistant_text.clone(),
                    tool_call_id: None,
                    tool_calls: inference.tool_calls.clone(),
                });
                let executed = execute_tool_calls(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    &inference.tool_calls,
                    effective_project_root.as_deref(),
                    terminal_policy,
                    plan_mode,
                    &mut provider_messages,
                    &mut budget,
                    &mut file_cache,
                    &mut error_withholding,
                )?;
                tool_trace.extend(executed.clone());
                if plan_mode {
                    if let Some(approved_plan) = approved_plan_from_tool_calls(&executed) {
                        let assistant_text =
                            "Plan approved. Exiting Plan Mode and starting implementation.";
                        let (assistant_message, memory_events) = append_assistant_message_to_stores(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            assistant_text,
                            effective_project_root.as_deref(),
                        )?;
                        emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                        let usage = usage_from_accumulator(
                            usage_accumulator.0,
                            usage_accumulator.1,
                            usage_accumulator.2,
                            usage_accumulator.3,
                        );
                        let completed_turn = registry_db::complete_agent_turn(
                            storage_root,
                            &running_turn.id,
                            usage.as_ref(),
                        )?;
                        emit_event(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            "completed",
                            json!({
                                "assistantMessageId": assistant_message.id,
                                "toolCallCount": tool_trace.len(),
                                "usage": usage,
                                "planApproved": true,
                            }),
                        )?;
                        kick_memory_pipeline(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            effective_project_root.clone(),
                        )?;
                        return Ok((
                            completed_turn,
                            Some(assistant_message),
                            tool_trace.clone(),
                            usage,
                            Some(approved_plan),
                        ));
                    }
                }
                current_round += 1;
                for tool_call in &inference.tool_calls {
                    micro_tracker.record_creation(&tool_call.id, &tool_call.name, current_round);
                }
                micro_tracker.try_compact(&mut provider_messages, current_round);
                prefetch_cache.purge_stale(60_000);
                crate::agent::prefetch::schedule_prefetch(
                    &inference.tool_calls,
                    effective_project_root.as_deref(),
                    &prefetch_cache,
                );
                if let Some(reason) = progress_guard.observe_tool_results(&executed) {
                    let assistant_text =
                        build_turn_paused_assistant_message(&reason.message, &inference.assistant_text);
                    let (assistant_message, memory_events) = append_assistant_message_to_stores(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        &assistant_text,
                        effective_project_root.as_deref(),
                    )?;
                    emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                    let usage = usage_from_accumulator(
                        usage_accumulator.0,
                        usage_accumulator.1,
                        usage_accumulator.2,
                        usage_accumulator.3,
                    );
                    let paused_turn = finalize_paused_turn(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        AGENT_TURN_PAUSED_NO_PROGRESS,
                        &reason.message,
                        usage.as_ref(),
                    )?;
                    kick_memory_pipeline(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        effective_project_root.clone(),
                    )?;
                    return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage, None));
                }
                step_index = step_index.saturating_add(1);
                continue;
            }

            let mut assistant_text = inference.assistant_text.trim().to_string();
            if plan_mode && proposed_plan_from_content(&assistant_text).is_none() {
                if !plan_mode_enforcement_attempted {
                    if !assistant_text.is_empty() {
                        provider_messages.push(AgentInferenceMessage {
                            role: AgentInferenceMessageRole::Assistant,
                            content: assistant_text.clone(),
                            tool_call_id: None,
                            tool_calls: Vec::new(),
                        });
                    }
                    provider_messages.push(AgentInferenceMessage {
                        role: AgentInferenceMessageRole::User,
                        content: build_plan_mode_enforcement_prompt(&assistant_text),
                        tool_call_id: None,
                        tool_calls: Vec::new(),
                    });
                    plan_mode_enforcement_attempted = true;
                    emit_event(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        "plan_mode_enforcement_retry",
                        json!({
                            "reason": "plain_text_without_structured_interaction",
                            "hadDraftText": !assistant_text.is_empty(),
                        }),
                    )?;
                    step_index = step_index.saturating_add(1);
                    continue;
                }

                let pause_reason =
                    "Plan Mode requires either `request_user_input` or `plan.submit_for_approval` before the turn can end.";
                let paused_text =
                    build_turn_paused_assistant_message(pause_reason, &assistant_text);
                let (assistant_message, memory_events) = append_assistant_message_to_stores(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    &paused_text,
                    effective_project_root.as_deref(),
                )?;
                emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                let usage = usage_from_accumulator(
                    usage_accumulator.0,
                    usage_accumulator.1,
                    usage_accumulator.2,
                    usage_accumulator.3,
                );
                let paused_turn = finalize_paused_turn(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    AGENT_TURN_PAUSED_NO_PROGRESS,
                    pause_reason,
                    usage.as_ref(),
                )?;
                kick_memory_pipeline(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    effective_project_root.clone(),
                )?;
                return Ok((paused_turn, Some(assistant_message), tool_trace.clone(), usage, None));
            }

            if !plan_mode
                && !assistant_text.is_empty()
                && tool_trace.is_empty()
            {
                match apply_quality_gate(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    profile,
                    secrets,
                    &system_message,
                    current_input,
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
                            storage_root,
                            session_id,
                            &running_turn.id,
                            &paused_text,
                            effective_project_root.as_deref(),
                        )?;
                        emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                        let usage = usage_from_accumulator(
                            usage_accumulator.0,
                            usage_accumulator.1,
                            usage_accumulator.2,
                            usage_accumulator.3,
                        );
                        let paused_turn = finalize_paused_turn(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            AGENT_TURN_PAUSED_NO_PROGRESS,
                            &reason,
                            usage.as_ref(),
                        )?;
                        kick_memory_pipeline(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            effective_project_root.clone(),
                        )?;
                        return Ok((
                            paused_turn,
                            Some(assistant_message),
                            tool_trace.clone(),
                            usage,
                            None,
                        ));
                    }
                }
            }

            if !plan_mode
                && !assistant_text.is_empty()
            {
                match apply_grounding_gate(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    current_input,
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
                            storage_root,
                            session_id,
                            &running_turn.id,
                            &paused_text,
                            effective_project_root.as_deref(),
                        )?;
                        emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
                        let usage = usage_from_accumulator(
                            usage_accumulator.0,
                            usage_accumulator.1,
                            usage_accumulator.2,
                            usage_accumulator.3,
                        );
                        let paused_turn = finalize_paused_turn(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            AGENT_TURN_PAUSED_NO_PROGRESS,
                            &reason,
                            usage.as_ref(),
                        )?;
                        kick_memory_pipeline(
                            storage_root,
                            session_id,
                            &running_turn.id,
                            effective_project_root.clone(),
                        )?;
                        return Ok((
                            paused_turn,
                            Some(assistant_message),
                            tool_trace.clone(),
                            usage,
                            None,
                        ));
                    }
                }
            }

            if enable_reflection && tool_trace.len() >= reflection_min_calls && !assistant_text.is_empty() {
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
                    secrets,
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
                        storage_root,
                        session_id,
                        &running_turn.id,
                        "pre_answer_self_check_completed",
                        json!({
                            "corrected": !reflection_text.is_empty() && !reflection_text.starts_with("LGTM"),
                        }),
                    )?;
                }
            }

            let display_content = resolve_display_content_for_final_answer(
                profile,
                secrets,
                &system_message,
                current_input,
                &assistant_text,
            );
            let (assistant_message, memory_events) = append_assistant_message_to_stores_with_display(
                storage_root,
                session_id,
                &running_turn.id,
                &assistant_text,
                Some(&display_content),
                effective_project_root.as_deref(),
            )?;
            emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
            let usage = usage_from_accumulator(
                usage_accumulator.0,
                usage_accumulator.1,
                usage_accumulator.2,
                usage_accumulator.3,
            );
            let completed_turn =
                registry_db::complete_agent_turn(storage_root, &running_turn.id, usage.as_ref())?;
            emit_event(
                storage_root,
                session_id,
                &running_turn.id,
                "completed",
                json!({
                    "assistantMessageId": assistant_message.id,
                    "toolCallCount": tool_trace.len(),
                    "usage": usage,
                }),
            )?;
            kick_memory_pipeline(
                storage_root,
                session_id,
                &running_turn.id,
                effective_project_root.clone(),
            )?;
            error_withholding.reset();
            return Ok((completed_turn, Some(assistant_message), tool_trace.clone(), usage, None));
        }
    })();

    let (turn, assistant_message, tool_calls, usage, approved_plan) = match turn_result {
        Ok(value) => value,
        Err(error) => {
            let error_display = error.to_string();
            let (code, message) = parse_agent_error_message(&error_display);
            let is_waiting_interaction = code == AGENT_WAITING_INTERACTION;
            let failed_turn = if is_waiting_interaction {
                finalize_paused_turn(
                    storage_root,
                    session_id,
                    &running_turn.id,
                    code,
                    message,
                    None,
                )?
            } else {
                finalize_failed_turn(storage_root, session_id, &running_turn.id, code, message)?
            };
            let failure_message = if is_waiting_interaction {
                build_turn_paused_assistant_message(message, "")
            } else {
                build_turn_failed_assistant_message(code, message)
            };
            let (assistant_message, memory_events) = append_assistant_message_to_stores(
                storage_root,
                session_id,
                &running_turn.id,
                &failure_message,
                effective_project_root.as_deref(),
            )?;
            emit_memory_events(storage_root, session_id, &running_turn.id, memory_events)?;
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
                None,
            )
        }
    };

    let optimization_state = if turn.status == "paused" {
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
            storage_root,
            session_id,
            &turn.id,
            "runtime_optimization_state_restored",
            json!({
                "restored": true,
                "pauseSnapshotPersisted": optimization_state.is_some(),
                "turnStatus": turn.status,
            }),
        )?;
    }

    Ok((
        turn,
        assistant_message,
        tool_calls,
        usage,
        approved_plan,
        optimization_state,
    ))
}

pub(crate) fn run_plan_implementation_handoff(
    storage_root: &str,
    session_id: &str,
    fallback_input: &str,
    request: &AgentSendTurnRequest,
    profile: &StoredAiProviderProfile,
    session: &AgentSession,
    approved_plan: &str,
) -> Result<AgentSendTurnResult> {
    let effective_project_root = session.project_root.clone();
    let profile_id = session
        .profile_id
        .clone()
        .unwrap_or_else(|| profile.id.clone());
    let handoff_input = select_plan_handoff_input(storage_root, session_id, fallback_input)?;
    let running_turn = registry_db::create_agent_turn(storage_root, session_id, &profile_id)?;
    emit_event(
        storage_root,
        session_id,
        &running_turn.id,
        "accepted",
        json!({
            "profileId": profile.id,
            "source": "plan_handoff",
        }),
    )?;
    emit_event(
        storage_root,
        session_id,
        &running_turn.id,
        "started",
        json!({
            "profileId": profile.id,
            "providerId": profile.provider_id,
            "protocolId": profile.protocol_id,
            "model": profile.model,
            "source": "plan_handoff",
        }),
    )?;

    let secrets = resolve_secret_values(&profile.secret_refs, None, &KeyringSecretStore)?;
    let tool_ranking_context = build_tool_ranking_context(storage_root, session_id)?;
    let tools = readonly_tool_definitions_for_input_with_context(
        &handoff_input,
        Some(&tool_ranking_context),
    );
    let turn_strategy = select_turn_strategy(&handoff_input);
    let terminal_policy = select_terminal_interaction_policy();
    let turn_context = build_turn_context(
        storage_root,
        session_id,
        &profile.to_public(),
        effective_project_root.as_deref(),
    )?;
    let turn_number = registry_db::list_agent_turns(storage_root, session_id)?.len();
    let activated_skill_prompts = render_activated_skill_prompts();
    let mcp_tools_json = render_mcp_tools_prompt_json();
    let browser_strategy_state = get_browser_strategy_runtime_state();
    let browser_tool_families = browser_tool_families_prompt();
    let workbench_web_context = tool_ranking_context.workbench_web.as_ref();
    let focus_atlas_status = workbench_web_context.map(|web| {
        if web.focus_atlas_ready {
            if web.last_focus_probe_verified {
                "ready (probe_verified)"
            } else {
                "ready"
            }
        } else {
            "not_ready"
        }
    });
    let prompt_result = build_system_prompt(&PromptBuildInput {
        session_id,
        turn_number,
        user_input: &handoff_input,
        project_root: effective_project_root.as_deref(),
        memory_snapshot: &turn_context.memory_snapshot,
        activated_skill_prompts: &activated_skill_prompts,
        mcp_tools_json: &mcp_tools_json,
        execution_profile: None,
        approval_profile: None,
        turn_strategy: &turn_strategy,
        ui_style_profile: None,
        ui_style_plugin: None,
        ui_style_user: None,
        ui_style_project: None,
        browser_engine_preference: browser_strategy_state.preferred_engine.as_deref(),
        browser_use_health: browser_strategy_state.browser_use_health.as_deref(),
        browser_tool_families: &browser_tool_families,
        browser_page_mode: workbench_web_context.and_then(|web| web.page_mode.as_deref()),
        focus_atlas_status,
        active_widget_id: workbench_web_context.and_then(|web| web.active_widget_id.as_deref()),
        active_item_id: workbench_web_context.and_then(|web| web.active_item_id.as_deref()),
        active_focus_region_id: workbench_web_context
            .and_then(|web| web.active_focus_region_id.as_deref()),
        current_browser_subgoal: workbench_web_context
            .and_then(|web| web.current_browser_subgoal.as_deref()),
        last_reveal_observed: workbench_web_context.map(|web| {
            if web.last_reveal_observed {
                "yes"
            } else {
                "no"
            }
        }),
        last_workflow_failure: workbench_web_context
            .and_then(|web| web.last_workflow_failure.as_deref()),
    });
    let system_message = AgentInferenceMessage {
        role: AgentInferenceMessageRole::System,
        content: prompt_result.prompt.clone(),
        tool_call_id: None,
        tool_calls: Vec::new(),
    };
    let mut provider_messages = turn_context.messages;
    provider_messages.insert(0, system_message.clone());
    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::User,
        content: format!("[Approved Plan]\n{approved_plan}"),
        tool_call_id: None,
        tool_calls: Vec::new(),
    });
    let repeated_main_input = build_live_repeated_user_input(
        &format!(
            "Implement the approved plan for the current task.\n\nOriginal task:\n{}",
            handoff_input
        ),
        total_message_tokens(&provider_messages),
        profile.model.as_str(),
    );
    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::User,
        content: repeated_main_input.transformed_input.clone(),
        tool_call_id: None,
        tool_calls: Vec::new(),
    });
    emit_event(
        storage_root,
        session_id,
        &running_turn.id,
        "prompt_compiled",
        json!({
            "turnStrategy": turn_strategy.kind.as_str(),
            "totalTokens": prompt_result.total_tokens,
            "sectionTokens": prompt_result.section_tokens,
            "truncatedSections": prompt_result.truncated_sections,
            "truncated": !prompt_result.truncated_sections.is_empty(),
            "source": "plan_handoff",
        }),
    )?;
    emit_input_postprocessed(
        storage_root,
        session_id,
        &running_turn.id,
        "main",
        &repeated_main_input,
    )?;
    let (turn, assistant_message, tool_calls, usage, _, _) = run_provider_loop(
        storage_root,
        session_id,
        &running_turn,
        &handoff_input,
        profile,
        &secrets,
        system_message,
        provider_messages,
        tools,
        effective_project_root,
        &terminal_policy,
        request.enable_context_collapse.unwrap_or(true),
        false,
        true,
        request.reflection_min_tool_calls.unwrap_or(3),
        None,
    )?;
    cleanup_transient_ai_sessions(session_id, &running_turn.id);
    let next_session = registry_db::read_agent_session(storage_root, session_id)?
        .unwrap_or_else(|| session.clone());
    Ok(AgentSendTurnResult {
        session: next_session,
        turn,
        assistant_message,
        tool_calls,
        usage,
    })
}
