use std::collections::BTreeMap;

use napi::Result;

use crate::agent::answer_quality::{
    compute_display_content, read_session_patterns, repair_display_answer,
    should_repair_display_content,
};
use crate::agent::types::AgentMessage;
use crate::memory::{append_session_dialog_message, MemoryRuntimePhaseEvent};
use crate::profile::types::StoredAiProviderProfile;
use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};
use crate::storage::registry_db;

pub(crate) fn append_assistant_message_to_stores(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    content: &str,
    project_root: Option<&str>,
) -> Result<(AgentMessage, Vec<MemoryRuntimePhaseEvent>)> {
    append_assistant_message_to_stores_with_display(
        storage_root,
        session_id,
        turn_id,
        content,
        None,
        project_root,
    )
}

pub(crate) fn append_assistant_message_to_stores_with_display(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    content: &str,
    display_content_override: Option<&str>,
    project_root: Option<&str>,
) -> Result<(AgentMessage, Vec<MemoryRuntimePhaseEvent>)> {
    let computed_display = compute_display_content(content);
    let normalized_override = display_content_override
        .map(str::trim)
        .filter(|entry| !entry.is_empty());
    let effective_display = normalized_override
        .or_else(|| {
            let trimmed = computed_display.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or("I need one quick clarification to provide a display-safe final answer.");

    let assistant_message = registry_db::append_agent_message_with_display(
        storage_root,
        session_id,
        Some(turn_id.to_string()),
        "assistant",
        content,
        Some(effective_display),
    )?;
    let memory_events = append_session_dialog_message(
        storage_root,
        session_id,
        &assistant_message.id,
        "assistant",
        content,
        Some(turn_id),
        project_root,
    )?;
    Ok((assistant_message, memory_events))
}

pub(crate) fn build_quality_pattern_memory_message(patterns: &[String]) -> Option<String> {
    if patterns.is_empty() {
        return None;
    }
    let lines = patterns
        .iter()
        .map(|pattern| pattern.trim())
        .filter(|pattern| !pattern.is_empty())
        .take(8)
        .map(|pattern| format!("- {pattern}"))
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }
    Some(format!(
        "[Correction Pattern Memory]\nUse these abstract correction patterns as guardrails in this session.\n{}",
        lines.join("\n")
    ))
}

pub(crate) fn inject_quality_pattern_memory(
    session_id: &str,
    provider_messages: &mut Vec<AgentInferenceMessage>,
) {
    let patterns = read_session_patterns(session_id);
    let Some(content) = build_quality_pattern_memory_message(&patterns) else {
        return;
    };
    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::User,
        content,
        tool_call_id: None,
        tool_calls: Vec::new(),
    });
}

pub(crate) fn resolve_display_content_for_final_answer(
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: &AgentInferenceMessage,
    user_input: &str,
    assistant_text: &str,
) -> String {
    let computed = compute_display_content(assistant_text);
    if !should_repair_display_content(assistant_text, &computed) {
        return computed.trim().to_string();
    }
    if let Some(repaired) =
        repair_display_answer(profile, secrets, system_message, user_input, assistant_text)
    {
        let trimmed = repaired.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "I need one quick clarification to provide a display-safe final answer.".to_string()
}
