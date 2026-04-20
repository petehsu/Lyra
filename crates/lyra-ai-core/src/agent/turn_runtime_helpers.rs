use napi::Result;
use serde_json::json;

use crate::agent::prompt_pipeline::estimate_tokens;
use crate::agent::prompt_repetition::PromptRepetitionResult;
use crate::agent::runtime_events::emit_event;
use crate::agent::terminal_policy::{terminal_policy_payload, TerminalInteractionPolicy};
use crate::agent::turn_strategy::TurnStrategy;
use crate::agent::types::{AgentTurn, AgentUsage};
use crate::memory::MemoryRuntimePhaseEvent;
use crate::provider::types::{
    AgentInferenceMessage, AgentInferenceMessageRole, AgentInferenceUsage,
};
use crate::storage::registry_db;

pub(crate) fn usage_from_accumulator(
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
    seen_any: bool,
) -> Option<AgentUsage> {
    if !seen_any {
        return None;
    }
    Some(AgentUsage {
        input_tokens: Some(prompt_tokens),
        output_tokens: Some(completion_tokens),
        total_tokens: Some(total_tokens),
    })
}

pub(crate) fn apply_usage(accumulator: &mut (i64, i64, i64, bool), usage: &AgentInferenceUsage) {
    if let Some(value) = usage.input_tokens {
        accumulator.0 += value;
        accumulator.3 = true;
    }
    if let Some(value) = usage.output_tokens {
        accumulator.1 += value;
        accumulator.3 = true;
    }
    if let Some(value) = usage.total_tokens {
        accumulator.2 += value;
        accumulator.3 = true;
    }
}

pub(crate) fn build_turn_failed_assistant_message(code: &str, message: &str) -> String {
    format!(
        "This turn failed ({code}): {message}\n\nYou can continue right away by rephrasing the request or asking me to retry with a narrower scope."
    )
}

pub(crate) fn build_turn_paused_assistant_message(reason: &str, assistant_text: &str) -> String {
    let prefix = assistant_text.trim();
    if prefix.is_empty() {
        format!(
            "I paused here: {reason}\n\nYou can continue from this point right away, or tighten the scope if you want me to be more targeted."
        )
    } else {
        format!(
            "{prefix}\n\nI paused here: {reason}\n\nYou can continue from this point right away, or tighten the scope if you want me to be more targeted."
        )
    }
}

pub(crate) fn emit_memory_events(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    events: Vec<MemoryRuntimePhaseEvent>,
) -> Result<()> {
    for event in events {
        emit_event(
            storage_root,
            session_id,
            turn_id,
            &event.phase,
            event.payload,
        )?;
    }
    Ok(())
}

pub(crate) fn total_message_tokens(messages: &[AgentInferenceMessage]) -> usize {
    messages
        .iter()
        .map(|message| estimate_tokens(&message.content))
        .sum()
}

pub(crate) fn replace_latest_user_message(
    messages: &mut [AgentInferenceMessage],
    transformed_input: &str,
) -> bool {
    for message in messages.iter_mut().rev() {
        if matches!(message.role, AgentInferenceMessageRole::User) {
            message.content = transformed_input.to_string();
            return true;
        }
    }
    false
}

pub(crate) fn emit_input_postprocessed(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    target: &str,
    result: &PromptRepetitionResult,
) -> Result<()> {
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "input_postprocessed",
        json!({
            "target": target,
            "mode": result.mode.as_str(),
            "originalTokens": result.original_tokens,
            "addedTokens": result.added_tokens,
            "anchorTokens": result.anchor_tokens,
        }),
    )
}

pub(crate) fn emit_turn_strategy_selected(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    turn_strategy: &TurnStrategy,
    planning_enabled: bool,
    reflection_enabled: bool,
    effective_max_steps: Option<u32>,
) -> Result<()> {
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "turn_strategy_selected",
        json!({
            "strategy": turn_strategy.kind.as_str(),
            "reasons": &turn_strategy.reasons,
            "reasoningIntensity": turn_strategy.reasoning_intensity(),
            "planningEnabled": planning_enabled,
            "reflectionEnabled": reflection_enabled,
            "requestUserInputEnabled": turn_strategy.request_user_input_enabled(),
            "maxSteps": effective_max_steps,
        }),
    )
}

pub(crate) fn emit_terminal_interaction_policy_selected(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    policy: &TerminalInteractionPolicy,
) -> Result<()> {
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "terminal_interaction_policy_selected",
        terminal_policy_payload(policy),
    )
}

pub(crate) fn finalize_failed_turn(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    code: &str,
    message: &str,
) -> Result<AgentTurn> {
    let turn = registry_db::fail_agent_turn(storage_root, turn_id, code, message)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "failed",
        json!({
            "code": code,
            "message": message,
        }),
    )?;
    Ok(turn)
}

pub(crate) fn finalize_paused_turn(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    code: &str,
    message: &str,
    usage: Option<&AgentUsage>,
) -> Result<AgentTurn> {
    let turn = registry_db::pause_agent_turn(storage_root, turn_id, code, message, usage)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "paused",
        json!({
            "code": code,
            "message": message,
            "usage": usage,
        }),
    )?;
    Ok(turn)
}
