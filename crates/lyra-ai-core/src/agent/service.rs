use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use napi::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::agent::auto_compact::{
    calculate_token_warning_state, get_auto_compact_threshold, get_effective_context_window,
    run_auto_compact, CompactCircuitBreaker,
};
use crate::agent::context_collapse::collapse_view_with_override;
use crate::agent::context_snip::{try_snip, SnipState};
use crate::agent::emit_runtime_event;
use crate::agent::error_recovery::{classify_tool_error, ErrorWithholdingBuffer};
use crate::agent::file_state_cache::FileStateCache;
use crate::agent::interaction_manager::{
    cancel_pending_interaction, create_pending_interaction, list_pending_interactions,
    resolve_pending_interaction,
};
use crate::agent::micro_compact::MicroCompactTracker;
use crate::agent::prefetch::PrefetchCache;
use crate::agent::prompt_pipeline::{
    build_plan_mode_system_prompt, build_system_prompt, estimate_tokens, PromptBuildInput,
};
use crate::agent::prompt_repetition::{
    build_live_repeated_user_input, build_post_compact_user_input, PromptRepetitionResult,
};
use crate::agent::terminal_policy::{
    select_terminal_interaction_policy, terminal_policy_payload, TerminalInteractionPolicy,
};
use crate::agent::tool_budget::ToolResultBudgetState;
use crate::agent::tool_diagnostics::build_tool_error_payload;
use crate::agent::tools::{
    cancel_plan_approval, cancel_plan_question, cleanup_transient_ai_sessions,
    derive_workbench_web_routing_context, execute_tool_with_progress, grant_approval_once,
    plan_mode_tool_definitions_for_input_with_context,
    readonly_tool_definitions_for_input_with_context, register_plan_approval_waiter,
    register_plan_question_waiter, render_activated_skill_prompts, render_mcp_tools_prompt_json,
    tool_executes_serially, ToolExecutionContext, ToolRankingContext,
};
use crate::agent::turn_strategy::{select_turn_strategy, TurnStrategy};
use crate::agent::types::{
    AgentAnswerPlanQuestionRequest, AgentAnswerQuestionRequest, AgentBindSessionProjectRequest,
    AgentCollaborationMode, AgentCreateSessionRequest, AgentDeleteSessionRequest,
    AgentEnterPlanModeRequest, AgentGetPendingInteractionsRequest, AgentGetPlanRequest,
    AgentGetSessionRequest, AgentListSessionsRequest, AgentMessage, AgentPendingInteraction,
    AgentPendingInteractionKind, AgentPendingInteractionStatus, AgentPlanState, AgentPlanStatus,
    AgentResolvePlanApprovalRequest, AgentRuntimeEvent, AgentSendTurnRequest, AgentSendTurnResult,
    AgentSession, AgentSessionDetail, AgentToolCall, AgentTurn, AgentUsage,
    CommandApprovalSubmitRequest, AGENT_PLAN_APPROVAL_REQUIRED, AGENT_PLAN_QUESTION_REQUIRED,
    AGENT_PROFILE_NOT_FOUND, AGENT_PROVIDER_UNSUPPORTED, AGENT_TOOL_APPROVAL_REQUIRED,
    AGENT_TOOL_EXEC_FAILED, AGENT_TURN_FAILED,
};
use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::error::{normalize_optional_text, normalize_required_text, now_ms, to_error};
use crate::memory::{
    append_session_dialog_message, build_turn_context, delete_session_storage,
    initialize_session_storage, kick_memory_pipeline, MemoryRuntimePhaseEvent,
};
use crate::profile::types::StoredAiProviderProfile;
use crate::provider;
use crate::provider::types::{
    AgentInferenceMessage, AgentInferenceMessageRole, AgentInferenceUsage, AgentToolInvocation,
};
use crate::storage::registry_db;

const AGENT_ERROR_PREFIX: &str = "AGENT_ERROR::";
const AGENT_TURN_PAUSED_SOFT_CAP: &str = "AGENT_TURN_PAUSED_SOFT_CAP";
const AGENT_TURN_PAUSED_NO_PROGRESS: &str = "AGENT_TURN_PAUSED_NO_PROGRESS";

static ACTIVE_SESSION_TURNS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));
static PROPOSED_PLAN_BLOCK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<proposed_plan>(.*?)</proposed_plan>").expect("valid proposed_plan regex")
});

struct TurnExecutionGuard {
    session_id: String,
}

impl Drop for TurnExecutionGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_SESSION_TURNS.lock() {
            active.remove(&self.session_id);
        }
    }
}

fn acquire_turn_guard(session_id: &str) -> Result<TurnExecutionGuard> {
    let mut active = ACTIVE_SESSION_TURNS
        .lock()
        .map_err(|_| to_error("agent turn lock is poisoned"))?;
    if active.contains(session_id) {
        return Err(agent_error(
            AGENT_TURN_FAILED,
            "another turn is already running in this session",
        ));
    }
    active.insert(session_id.to_string());
    Ok(TurnExecutionGuard {
        session_id: session_id.to_string(),
    })
}

fn agent_error(code: &str, message: impl Into<String>) -> napi::Error {
    to_error(format!("{AGENT_ERROR_PREFIX}{code}::{}", message.into()))
}

fn parse_agent_error_message(raw: &str) -> (&str, &str) {
    let Some(rest) = raw.strip_prefix(AGENT_ERROR_PREFIX) else {
        return (AGENT_TURN_FAILED, raw);
    };
    let mut parts = rest.splitn(2, "::");
    let code = parts.next().unwrap_or(AGENT_TURN_FAILED);
    let message = parts.next().unwrap_or(raw);
    if code.trim().is_empty() {
        (AGENT_TURN_FAILED, message)
    } else {
        (code, message)
    }
}

fn emit_event(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    phase: &str,
    payload: Value,
) -> Result<()> {
    let event = AgentRuntimeEvent {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        phase: phase.to_string(),
        payload,
        timestamp: now_ms(),
    };
    let stored_event = registry_db::append_agent_runtime_event(storage_root, &event)?;
    emit_runtime_event(stored_event);
    Ok(())
}

fn emit_transient_event(
    session_id: &str,
    turn_id: &str,
    phase: &str,
    payload: Value,
) -> Result<()> {
    emit_runtime_event(AgentRuntimeEvent {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        phase: phase.to_string(),
        payload,
        timestamp: now_ms(),
    });
    Ok(())
}

fn emit_interaction_pending_event(
    storage_root: &str,
    interaction: &AgentPendingInteraction,
) -> Result<()> {
    emit_event(
        storage_root,
        &interaction.session_id,
        &interaction.turn_id,
        "interaction_pending",
        json!({ "interaction": interaction }),
    )
}

fn emit_interaction_resolved_event(
    storage_root: &str,
    interaction: &AgentPendingInteraction,
) -> Result<()> {
    emit_event(
        storage_root,
        &interaction.session_id,
        &interaction.turn_id,
        "interaction_resolved",
        json!({ "interaction": interaction }),
    )
}

fn emit_interaction_queue_updated(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<()> {
    let pending = list_pending_interactions(storage_root, session_id)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "interaction_queue_updated",
        json!({ "pendingInteractions": pending }),
    )
}

fn emit_tool_failure_diagnosed_event(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    error_payload: &Value,
) -> Result<()> {
    let diagnosis = error_payload
        .as_object()
        .and_then(|value| value.get("diagnosis"))
        .cloned()
        .unwrap_or(Value::Null);
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_failure_diagnosed",
        json!({
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "error": error_payload,
            "diagnosis": diagnosis,
        }),
    )
}

fn build_tool_ranking_context(storage_root: &str, session_id: &str) -> Result<ToolRankingContext> {
    let tool_calls = registry_db::list_agent_tool_calls(storage_root, session_id)?;
    Ok(ToolRankingContext {
        workbench_web: derive_workbench_web_routing_context(&tool_calls),
    })
}

fn normalize_project_root(value: &str) -> Result<String> {
    let candidate = PathBuf::from(value.trim());
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(candidate))
            .map_err(|error| {
                agent_error(
                    AGENT_TURN_FAILED,
                    format!("failed to resolve project root: {error}"),
                )
            })?
    };
    let metadata = std::fs::metadata(&resolved).map_err(|error| {
        agent_error(
            AGENT_TURN_FAILED,
            format!("project root is not accessible: {error}"),
        )
    })?;
    if !metadata.is_dir() {
        return Err(agent_error(
            AGENT_TURN_FAILED,
            "project root must be a directory",
        ));
    }
    let normalized = resolved
        .canonicalize()
        .unwrap_or(resolved)
        .to_string_lossy()
        .to_string();
    Ok(normalized)
}

fn project_name_from_root(project_root: &str) -> Option<String> {
    let path = PathBuf::from(project_root);
    path.file_name()
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|value| !value.is_empty())
}

fn non_empty_string_field(input: &Value, key: &str) -> bool {
    input
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn absolutize_tool_path(raw_path: &str, project_root: &str) -> String {
    let candidate = PathBuf::from(raw_path.trim());
    if candidate.is_absolute() {
        return candidate.to_string_lossy().to_string();
    }
    PathBuf::from(project_root)
        .join(candidate)
        .to_string_lossy()
        .to_string()
}

fn ensure_absolute_path_field(
    input: &Value,
    next: &mut serde_json::Map<String, Value>,
    field: &str,
    project_root: &str,
) {
    let maybe_value = input
        .as_object()
        .and_then(|object| object.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = maybe_value {
        next.insert(
            field.to_string(),
            Value::String(absolutize_tool_path(value, project_root)),
        );
    }
}

fn apply_project_scope_to_tool_input(
    tool_name: &str,
    input: &Value,
    project_root: Option<&str>,
) -> Value {
    let Some(project_root) = project_root else {
        return input.clone();
    };
    let Some(object) = input.as_object() else {
        return input.clone();
    };
    let mut next = object.clone();
    match tool_name {
        "filesystem.list" => {
            if !non_empty_string_field(input, "path") {
                next.insert("path".to_string(), Value::String(project_root.to_string()));
            }
        }
        "filesystem.glob" => {
            if !non_empty_string_field(input, "root") {
                next.insert("root".to_string(), Value::String(project_root.to_string()));
            }
        }
        "filesystem.search" => {
            if !non_empty_string_field(input, "path") {
                next.insert("path".to_string(), Value::String(project_root.to_string()));
            }
        }
        "filesystem.read_range"
        | "filesystem.write"
        | "filesystem.edit"
        | "filesystem.multi_edit" => {
            ensure_absolute_path_field(input, &mut next, "path", project_root);
        }
        _ => {}
    }
    match tool_name {
        "filesystem.list"
        | "filesystem.search"
        | "filesystem.read_range"
        | "filesystem.write"
        | "filesystem.edit"
        | "filesystem.multi_edit" => {
            ensure_absolute_path_field(input, &mut next, "path", project_root);
        }
        "filesystem.glob" => {
            ensure_absolute_path_field(input, &mut next, "root", project_root);
        }
        _ => {}
    }
    Value::Object(next)
}

fn resolve_profile_for_turn(
    storage_root: &str,
    session: &AgentSession,
    requested_profile_id: Option<&str>,
) -> Result<StoredAiProviderProfile> {
    let from_request = requested_profile_id
        .map(|value| normalize_required_text(value, "profileId"))
        .transpose()?;
    let selected_profile = if let Some(profile_id) = from_request {
        registry_db::read_profile_record(storage_root, &profile_id)?
    } else if let Some(profile_id) = session.profile_id.as_deref() {
        registry_db::read_profile_record(storage_root, profile_id)?
    } else {
        registry_db::read_default_profile_record(storage_root)?
    };

    selected_profile.ok_or_else(|| {
        agent_error(
            AGENT_PROFILE_NOT_FOUND,
            "no AI profile is available for the current agent turn",
        )
    })
}

fn is_supported_protocol(protocol_id: &str) -> bool {
    matches!(
        protocol_id,
        "openai_compatible"
            | "lmstudio_openai"
            | "anthropic_messages"
            | "gemini_generate_content"
            | "ollama_chat"
            | "bedrock_converse"
    )
}

fn usage_from_accumulator(
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

fn apply_usage(accumulator: &mut (i64, i64, i64, bool), usage: &AgentInferenceUsage) {
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

fn build_turn_failed_assistant_message(code: &str, message: &str) -> String {
    format!(
        "This turn failed ({code}): {message}\n\nYou can continue right away by rephrasing the request or asking me to retry with a narrower scope."
    )
}

fn build_turn_paused_assistant_message(reason: &str, assistant_text: &str) -> String {
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

fn emit_memory_events(
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

fn total_message_tokens(messages: &[AgentInferenceMessage]) -> usize {
    messages
        .iter()
        .map(|message| estimate_tokens(&message.content))
        .sum()
}

fn replace_latest_user_message(
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

fn emit_input_postprocessed(
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

fn emit_turn_strategy_selected(
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
            "planningEnabled": planning_enabled,
            "reflectionEnabled": reflection_enabled,
            "maxSteps": effective_max_steps,
        }),
    )
}

fn emit_terminal_interaction_policy_selected(
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

#[derive(Clone, Debug)]
struct PauseReason {
    code: String,
    message: String,
}

#[derive(Default)]
struct TurnProgressGuardState {
    caller_soft_cap: Option<u32>,
    soft_cap_message: Option<String>,
    repeated_tool_fingerprint: Option<(String, u32)>,
    repeated_failure_fingerprint: Option<(String, u32)>,
    repeated_loop_fingerprint: Option<(String, u32)>,
    repeated_zero_write: Option<(String, u32)>,
}

impl TurnProgressGuardState {
    fn new(caller_soft_cap: Option<u32>, soft_cap_message: Option<String>) -> Self {
        Self {
            caller_soft_cap,
            soft_cap_message,
            ..Self::default()
        }
    }

    fn before_step(&self, step_index: u32) -> Option<PauseReason> {
        let cap = self.caller_soft_cap?;
        if step_index < cap {
            return None;
        }
        Some(PauseReason {
            code: AGENT_TURN_PAUSED_SOFT_CAP.to_string(),
            message: self.soft_cap_message.clone().unwrap_or_else(|| {
                format!(
                    "the current request reached the caller-provided soft cap ({cap} tool steps)"
                )
            }),
        })
    }

    fn observe_inference(
        &mut self,
        assistant_text: &str,
        tool_calls: &[AgentToolInvocation],
    ) -> Option<PauseReason> {
        if tool_calls.is_empty() {
            self.repeated_tool_fingerprint = None;
            self.repeated_loop_fingerprint = None;
            return None;
        }

        let tool_fingerprint = fingerprint_tool_invocations(tool_calls);
        let tool_count =
            bump_repeated_fingerprint(&mut self.repeated_tool_fingerprint, tool_fingerprint);

        let loop_fingerprint = format!(
            "{}::{}",
            assistant_text.trim(),
            fingerprint_tool_invocations(tool_calls)
        );
        let loop_count =
            bump_repeated_fingerprint(&mut self.repeated_loop_fingerprint, loop_fingerprint);

        if tool_count >= 3 || loop_count >= 3 {
            return Some(PauseReason {
                code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                message: "I detected a repeated tool loop with the same plan and inputs, so I paused instead of spinning.".to_string(),
            });
        }

        None
    }

    fn observe_tool_results(&mut self, tool_calls: &[AgentToolCall]) -> Option<PauseReason> {
        if let Some(message) = interaction_timeout_message(tool_calls) {
            return Some(PauseReason {
                code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                message,
            });
        }

        if let Some(fingerprint) = fingerprint_recoverable_failure(tool_calls) {
            let count =
                bump_repeated_fingerprint(&mut self.repeated_failure_fingerprint, fingerprint);
            if count >= 3 {
                return Some(PauseReason {
                    code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                    message: "the same recoverable tool failure repeated several times without converging".to_string(),
                });
            }
        } else {
            self.repeated_failure_fingerprint = None;
        }

        if let Some(path) = fingerprint_zero_write(tool_calls) {
            let count = bump_repeated_fingerprint(&mut self.repeated_zero_write, path);
            if count >= 2 {
                return Some(PauseReason {
                    code: AGENT_TURN_PAUSED_NO_PROGRESS.to_string(),
                    message: "the same file write loop produced no net change, so I paused to avoid thrashing".to_string(),
                });
            }
        } else {
            self.repeated_zero_write = None;
        }

        None
    }
}

fn interaction_timeout_message(tool_calls: &[AgentToolCall]) -> Option<String> {
    tool_calls.iter().find_map(|tool_call| {
        if tool_call.status == "failed"
            && tool_call.error_code.as_deref() == Some(AGENT_TOOL_APPROVAL_REQUIRED)
        {
            return Some(
                "I paused because a tool action needs your approval before I can continue."
                    .to_string(),
            );
        }
        if tool_call.status == "failed"
            && tool_call.error_code.as_deref() == Some("AGENT_TOOL_DENIED")
        {
            return Some(
                "I paused because a required tool action was denied, so I cannot claim it completed."
                    .to_string(),
            );
        }
        let message = tool_call.error_message.as_deref()?;
        if message.contains("timed out waiting for user input")
            || message.contains("timed out waiting for user response")
        {
            return Some(
                "I paused because the turn is waiting on a user decision that never reached the UI in time."
                    .to_string(),
            );
        }
        None
    })
}

#[cfg(test)]
mod interaction_guard_tests {
    use super::{
        interaction_timeout_message, TurnProgressGuardState, AGENT_TURN_PAUSED_NO_PROGRESS,
    };
    use crate::agent::types::AgentToolCall;
    use serde_json::json;

    fn failed_tool_call(message: &str) -> AgentToolCall {
        AgentToolCall {
            id: "tool-1".to_string(),
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            tool_name: "request_user_input".to_string(),
            input: json!({}),
            output: None,
            status: "failed".to_string(),
            error_code: Some("AGENT_TURN_FAILED".to_string()),
            error_message: Some(message.to_string()),
            started_at: 1,
            finished_at: Some(2),
        }
    }

    fn failed_tool_call_with_code(code: &str, message: &str) -> AgentToolCall {
        AgentToolCall {
            id: "tool-1".to_string(),
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            tool_name: "workbench.web_action.mutate".to_string(),
            input: json!({}),
            output: None,
            status: "failed".to_string(),
            error_code: Some(code.to_string()),
            error_message: Some(message.to_string()),
            started_at: 1,
            finished_at: Some(2),
        }
    }

    #[test]
    fn detects_interaction_timeout_failures() {
        let message = interaction_timeout_message(&[failed_tool_call(
            "plan question timed out waiting for user input",
        )]);
        assert!(message.is_some());
    }

    #[test]
    fn progress_guard_pauses_on_interaction_timeout() {
        let mut guard = TurnProgressGuardState::default();
        let reason = guard.observe_tool_results(&[failed_tool_call(
            "plan approval timed out waiting for user response",
        )]);
        assert!(reason.is_some());
        let reason = reason.expect("pause reason");
        assert_eq!(reason.code, AGENT_TURN_PAUSED_NO_PROGRESS);
        assert!(reason.message.contains("waiting on a user decision"));
    }

    #[test]
    fn progress_guard_pauses_on_approval_required_failure() {
        let mut guard = TurnProgressGuardState::default();
        let reason = guard.observe_tool_results(&[failed_tool_call_with_code(
            "AGENT_TOOL_APPROVAL_REQUIRED",
            "external tool requires user approval: workbench.web_action.mutate",
        )]);
        assert!(reason.is_some());
        let reason = reason.expect("pause reason");
        assert_eq!(reason.code, AGENT_TURN_PAUSED_NO_PROGRESS);
        assert!(reason.message.contains("needs your approval"));
    }
}

fn bump_repeated_fingerprint(slot: &mut Option<(String, u32)>, fingerprint: String) -> u32 {
    if let Some((current, count)) = slot.as_mut() {
        if *current == fingerprint {
            *count += 1;
            return *count;
        }
    }
    *slot = Some((fingerprint, 1));
    1
}

fn fingerprint_tool_invocations(tool_calls: &[AgentToolInvocation]) -> String {
    tool_calls
        .iter()
        .map(|tool_call| {
            let normalized = normalize_json_value(&tool_call.input);
            format!(
                "{}:{}",
                tool_call.name,
                serde_json::to_string(&normalized).unwrap_or_else(|_| "{}".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn normalize_json_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(normalize_json_value).collect()),
        Value::Object(map) => {
            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            let mut normalized = serde_json::Map::new();
            for (key, value) in entries {
                normalized.insert(key.clone(), normalize_json_value(value));
            }
            Value::Object(normalized)
        }
        _ => value.clone(),
    }
}

fn fingerprint_recoverable_failure(tool_calls: &[AgentToolCall]) -> Option<String> {
    let fingerprints = tool_calls
        .iter()
        .filter_map(|tool_call| {
            if tool_call.status == "failed" {
                let code = tool_call.error_code.clone().unwrap_or_default();
                let message = tool_call.error_message.clone().unwrap_or_default();
                return Some(format!(
                    "failed:{}:{}:{}",
                    tool_call.tool_name, code, message
                ));
            }
            let kind = tool_call
                .output
                .as_ref()
                .and_then(|output| output.get("kind"))
                .and_then(Value::as_str)?;
            if matches!(
                kind,
                "no_match" | "unchanged" | "interactive_advisory" | "interactive_policy_blocked"
            ) {
                let path = extract_tool_path(tool_call).unwrap_or_default();
                return Some(format!(
                    "recoverable:{}:{}:{}",
                    tool_call.tool_name, kind, path
                ));
            }
            None
        })
        .collect::<Vec<_>>();

    if fingerprints.is_empty() {
        None
    } else {
        Some(fingerprints.join("|"))
    }
}

fn fingerprint_zero_write(tool_calls: &[AgentToolCall]) -> Option<String> {
    let fingerprints = tool_calls
        .iter()
        .filter_map(|tool_call| {
            if !matches!(
                tool_call.tool_name.as_str(),
                "filesystem.write" | "filesystem.edit" | "filesystem.multi_edit"
            ) {
                return None;
            }
            let kind = tool_call
                .output
                .as_ref()
                .and_then(|output| output.get("kind"))
                .and_then(Value::as_str)?;
            if !matches!(kind, "unchanged" | "no_match") {
                return None;
            }
            extract_tool_path(tool_call)
        })
        .collect::<Vec<_>>();
    if fingerprints.is_empty() {
        None
    } else {
        Some(fingerprints.join("|"))
    }
}

fn extract_tool_path(tool_call: &AgentToolCall) -> Option<String> {
    tool_call
        .output
        .as_ref()
        .and_then(|output| output.get("path"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            tool_call
                .input
                .as_object()
                .and_then(|input| input.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn finalize_failed_turn(
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

fn finalize_paused_turn(
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

pub fn list_sessions(request: AgentListSessionsRequest) -> Result<Vec<AgentSession>> {
    registry_db::list_agent_sessions(&request.storage_root)
}

pub fn create_session(request: AgentCreateSessionRequest) -> Result<AgentSession> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let title =
        normalize_optional_text(request.title).unwrap_or_else(|| "New Agent Session".to_string());
    let profile_id = request
        .profile_id
        .map(|value| normalize_required_text(&value, "profileId"))
        .transpose()?;

    let now = now_ms();
    let session = AgentSession {
        id: format!("agent-session-{}", Uuid::new_v4()),
        title,
        profile_id,
        project_root: None,
        project_name: None,
        collaboration_mode: AgentCollaborationMode::Default,
        created_at: now,
        updated_at: now,
    };
    initialize_session_storage(&storage_root, &session.id)?;
    let session = registry_db::create_agent_session(&storage_root, &session)?;
    Ok(session)
}

pub fn bind_session_project(request: AgentBindSessionProjectRequest) -> Result<AgentSession> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let project_root = normalize_required_text(&request.project_root, "projectRoot")?;
    let normalized_root = normalize_project_root(&project_root)?;
    let project_name = project_name_from_root(&normalized_root);
    registry_db::update_agent_session_project(
        &storage_root,
        &session_id,
        Some(normalized_root),
        project_name,
    )
}

pub fn get_session(request: AgentGetSessionRequest) -> Result<AgentSessionDetail> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let session =
        registry_db::read_agent_session(&storage_root, &session_id)?.ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    let plan = registry_db::read_agent_plan(&storage_root, &session_id)?;
    let pending_interactions = list_pending_interactions(&storage_root, &session_id)?;
    let turns = registry_db::list_agent_turns(&storage_root, &session_id)?;
    let messages = registry_db::list_agent_messages(&storage_root, &session_id)?;
    let tool_calls = registry_db::list_agent_tool_calls(&storage_root, &session_id)?;
    let runtime_events = registry_db::list_agent_runtime_events(&storage_root, &session_id)?;
    Ok(AgentSessionDetail {
        session,
        plan,
        pending_interactions,
        turns,
        messages,
        tool_calls,
        runtime_events,
    })
}

pub fn get_pending_interactions(
    request: AgentGetPendingInteractionsRequest,
) -> Result<Vec<AgentPendingInteraction>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    list_pending_interactions(&storage_root, &session_id)
}

fn blank_plan_state() -> AgentPlanState {
    AgentPlanState {
        status: AgentPlanStatus::Draft,
        version: 0,
        draft_markdown: String::new(),
        proposed_markdown: None,
        approved_markdown: None,
        last_submitted_version: None,
        updated_at: now_ms(),
    }
}

fn ensure_plan_state(storage_root: &str, session_id: &str) -> Result<AgentPlanState> {
    if let Some(plan) = registry_db::read_agent_plan(storage_root, session_id)? {
        return Ok(plan);
    }
    let plan = blank_plan_state();
    registry_db::upsert_agent_plan(storage_root, session_id, &plan)
}

pub fn enter_plan_mode(request: AgentEnterPlanModeRequest) -> Result<AgentSessionDetail> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let existing_session = registry_db::read_agent_session(&storage_root, &session_id)?
        .ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    let phase = if existing_session.collaboration_mode == AgentCollaborationMode::Plan {
        "plan_mode_reentered"
    } else {
        "plan_mode_entered"
    };
    let session = registry_db::set_agent_session_collaboration_mode(
        &storage_root,
        &session_id,
        AgentCollaborationMode::Plan,
    )?;
    let plan = ensure_plan_state(&storage_root, &session_id)?;
    emit_transient_event(
        &session_id,
        &format!("plan-mode-{}", Uuid::new_v4()),
        phase,
        json!({
            "collaborationMode": "plan",
            "status": plan.status,
            "version": plan.version,
        }),
    )?;
    let mut detail = get_session(AgentGetSessionRequest {
        storage_root,
        session_id,
    })?;
    detail.session = session;
    detail.plan = Some(plan);
    Ok(detail)
}

pub fn get_plan(request: AgentGetPlanRequest) -> Result<Option<AgentPlanState>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    registry_db::read_agent_plan(&storage_root, &session_id)
}

pub fn answer_question(request: AgentAnswerQuestionRequest) -> Result<()> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let request_id = normalize_required_text(&request.request_id, "requestId")?;
    let note = request.note.clone();
    crate::agent::tools::resolve_plan_question(&request_id, request.answers.clone(), note.clone());
    if let Some(interaction) = resolve_pending_interaction(
        &storage_root,
        &request_id,
        AgentPendingInteractionStatus::Resolved,
        Some(json!({
            "answers": request.answers,
            "note": note,
        })),
    )? {
        emit_interaction_resolved_event(&storage_root, &interaction)?;
    }
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        "plan_question_answered",
        json!({
            "requestId": request_id,
        }),
    )?;
    emit_interaction_queue_updated(&storage_root, &session_id, &turn_id)
}

pub fn answer_plan_question(request: AgentAnswerPlanQuestionRequest) -> Result<()> {
    answer_question(request)
}

pub fn resolve_plan_approval(
    request: AgentResolvePlanApprovalRequest,
) -> Result<Option<AgentSendTurnResult>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let request_id = normalize_required_text(&request.request_id, "requestId")?;
    let decision = normalize_required_text(&request.decision, "decision")?;
    let feedback = request.feedback.clone();
    let resolved_live_waiter =
        crate::agent::tools::resolve_plan_approval(&request_id, &decision, feedback.clone());
    let resolved_interaction = resolve_pending_interaction(
        &storage_root,
        &request_id,
        AgentPendingInteractionStatus::Resolved,
        Some(json!({
            "decision": decision,
            "feedback": feedback,
        })),
    )?;
    if let Some(interaction) = resolved_interaction.as_ref() {
        emit_interaction_resolved_event(&storage_root, interaction)?;
    }
    let phase = if decision == "approve_and_implement" {
        "plan_approved"
    } else {
        "plan_rejected"
    };
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        phase,
        json!({
            "requestId": request_id,
            "decision": decision,
            "feedback": request.feedback,
        }),
    )?;
    emit_interaction_queue_updated(&storage_root, &session_id, &turn_id)?;

    if resolved_live_waiter {
        return Ok(None);
    }

    let Some(session) = registry_db::read_agent_session(&storage_root, &session_id)? else {
        return Ok(None);
    };
    if decision != "approve_and_implement" {
        return Ok(None);
    }

    let approved_plan = resolved_interaction
        .as_ref()
        .and_then(|interaction| interaction.payload.get("proposedMarkdown"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            registry_db::read_agent_plan(&storage_root, &session_id)
                .ok()
                .flatten()
                .and_then(|plan| plan.proposed_markdown.or(plan.approved_markdown))
        })
        .unwrap_or_default();
    if approved_plan.trim().is_empty() {
        return Ok(None);
    }

    let requested_profile_id = session
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let profile = resolve_profile_for_turn(&storage_root, &session, requested_profile_id)?;
    registry_db::set_agent_session_collaboration_mode(
        &storage_root,
        &session_id,
        AgentCollaborationMode::Default,
    )?;
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        "plan_mode_exited",
        json!({
            "reason": "approved_and_implement",
            "source": "pending_interaction",
        }),
    )?;
    let fallback_input = select_plan_handoff_input(&storage_root, &session_id, "")?;
    run_plan_implementation_handoff(
        &storage_root,
        &session_id,
        &fallback_input,
        &AgentSendTurnRequest {
            storage_root: storage_root.clone(),
            session_id: session_id.clone(),
            input: fallback_input.clone(),
            profile_id: session.profile_id.clone(),
            project_root: session.project_root.clone(),
            max_steps: None,
            enable_planning: true,
            planning_min_chars: None,
            enable_reflection: true,
            reflection_min_tool_calls: None,
            enable_context_collapse: Some(true),
        },
        &profile,
        &session,
        &approved_plan,
    )
    .map(Some)
}

pub fn delete_session(request: AgentDeleteSessionRequest) -> Result<()> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    registry_db::delete_agent_session(&storage_root, &session_id)?;
    delete_session_storage(&storage_root, &session_id)
}

fn execute_tool_calls(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    tool_calls: &[AgentToolInvocation],
    project_root: Option<&str>,
    terminal_policy: &TerminalInteractionPolicy,
    plan_mode: bool,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    budget: &mut ToolResultBudgetState,
    file_cache: &mut FileStateCache,
    error_withholding: &mut ErrorWithholdingBuffer,
) -> Result<Vec<AgentToolCall>> {
    // Partition tools into read-only (concurrent) and write (serial) batches.
    // Mirrors Claude Code's StreamingToolExecutor: read-only tools execute
    // concurrently in batches, write tools execute serially for safety.
    let mut results = Vec::new();
    let mut i = 0;

    while i < tool_calls.len() {
        if tool_executes_serially(&tool_calls[i].name) {
            // Serial execution for write tools
            let finished = execute_single_tool(
                storage_root,
                session_id,
                turn_id,
                &tool_calls[i],
                project_root,
                terminal_policy,
                plan_mode,
                provider_messages,
                budget,
                file_cache,
                error_withholding,
            )?;
            results.push(finished);
            i += 1;
        } else {
            // Collect consecutive read-only tools into a batch
            let batch_start = i;
            while i < tool_calls.len() && !tool_executes_serially(&tool_calls[i].name) {
                i += 1;
            }
            let batch = &tool_calls[batch_start..i];

            // Execute read-only batch concurrently
            let batch_results =
                execute_readonly_batch(storage_root, session_id, turn_id, batch, project_root)?;

            // Push results in order with budget enforcement
            for (idx, (finished_call, tool_content)) in batch_results.into_iter().enumerate() {
                let inv = &batch[idx];
                let budgeted_content = budget.enforce(&inv.id, &inv.name, &tool_content);
                provider_messages.push(AgentInferenceMessage {
                    role: AgentInferenceMessageRole::Tool,
                    content: budgeted_content,
                    tool_call_id: Some(inv.id.clone()),
                    tool_calls: Vec::new(),
                });
                results.push(finished_call);
            }
        }
    }

    Ok(results)
}

fn complete_tool_call_and_push_result(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    invocation: &AgentToolInvocation,
    started_call_id: &str,
    tool_result: &Value,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    budget: &mut ToolResultBudgetState,
) -> Result<AgentToolCall> {
    let finished_call =
        registry_db::complete_agent_tool_call(storage_root, started_call_id, tool_result)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_finished",
        json!({
            "toolCallId": finished_call.id,
            "toolName": finished_call.tool_name,
            "status": "completed",
            "output": finished_call.output,
        }),
    )?;
    let tool_content = serde_json::to_string(tool_result).unwrap_or_else(|_| "{}".to_string());
    let budgeted_content = budget.enforce(&invocation.id, &invocation.name, &tool_content);
    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::Tool,
        content: budgeted_content,
        tool_call_id: Some(invocation.id.clone()),
        tool_calls: Vec::new(),
    });
    Ok(finished_call)
}

/// Execute a single tool call with full lifecycle management.
fn execute_single_tool(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    invocation: &AgentToolInvocation,
    project_root: Option<&str>,
    terminal_policy: &TerminalInteractionPolicy,
    plan_mode: bool,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    budget: &mut ToolResultBudgetState,
    file_cache: &mut FileStateCache,
    error_withholding: &mut ErrorWithholdingBuffer,
) -> Result<AgentToolCall> {
    let effective_input =
        apply_project_scope_to_tool_input(&invocation.name, &invocation.input, project_root);
    let started_call = registry_db::create_agent_tool_call(
        storage_root,
        session_id,
        turn_id,
        &invocation.name,
        &effective_input,
    )?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_started",
        json!({
            "toolCallId": started_call.id,
            "toolName": invocation.name,
            "input": effective_input.clone(),
        }),
    )?;

    let mut progress_emit_error: Option<napi::Error> = None;
    let tool_result = match execute_tool_with_progress(
        &invocation.name,
        &effective_input,
        ToolExecutionContext {
            storage_root: Some(storage_root),
            project_root,
            agent_session_id: Some(session_id),
            agent_turn_id: Some(turn_id),
            tool_call_id: Some(&started_call.id),
            terminal_policy: Some(terminal_policy),
            plan_mode,
        },
        |progress_payload| {
            if progress_emit_error.is_some() {
                return;
            }
            if let Err(error) = emit_event(
                storage_root,
                session_id,
                turn_id,
                "tool_progress",
                json!({
                    "toolCallId": started_call.id,
                    "toolName": invocation.name,
                    "status": "running",
                    "input": effective_input.clone(),
                    "progress": progress_payload,
                }),
            ) {
                progress_emit_error = Some(error);
            }
        },
    ) {
        Ok(value) => value,
        Err(error) => {
            // Check if this is an approval-required error
            if error.code == AGENT_TOOL_APPROVAL_REQUIRED {
                let approval_metadata = error.metadata.clone().unwrap_or_else(|| json!({}));
                let tool_call_id = started_call.id.clone();

                // Register approval waiter before emitting the event
                let rx = crate::agent::tools::register_approval_waiter(&tool_call_id);
                let interaction = create_pending_interaction(
                    storage_root,
                    session_id,
                    turn_id,
                    &tool_call_id,
                    AgentPendingInteractionKind::CommandApproval,
                    json!({
                        "requestId": tool_call_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "input": effective_input.clone(),
                        "metadata": approval_metadata.clone(),
                        "message": error.message,
                    }),
                )?;
                emit_interaction_pending_event(storage_root, &interaction)?;
                emit_interaction_queue_updated(storage_root, session_id, turn_id)?;

                // Emit approval request event to frontend
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "command_approval_request",
                    json!({
                        "toolCallId": tool_call_id,
                        "toolName": invocation.name,
                        "input": effective_input.clone(),
                        "metadata": approval_metadata.clone(),
                        "message": error.message,
                    }),
                )?;

                // Block waiting for user decision until the user responds or the waiter is cancelled.
                let decision = match rx.recv() {
                    Ok(d) => d.decision,
                    Err(_error) => {
                        crate::agent::tools::cancel_approval(&tool_call_id);
                        if let Some(interaction) = cancel_pending_interaction(
                            storage_root,
                            &tool_call_id,
                            "command approval was cancelled before a response was received",
                        )? {
                            emit_interaction_resolved_event(storage_root, &interaction)?;
                            emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                        }
                        "deny".to_string()
                    }
                };

                // Handle the decision
                if decision == "allow_once" || decision == "allow_always" {
                    if let Some(interaction) = resolve_pending_interaction(
                        storage_root,
                        &tool_call_id,
                        AgentPendingInteractionStatus::Resolved,
                        Some(json!({ "decision": decision })),
                    )? {
                        emit_interaction_resolved_event(storage_root, &interaction)?;
                        emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                    }
                    // Always grant current-call approval token. For allow_always this guarantees
                    // immediate re-execution succeeds even when no project root is bound.
                    if decision == "allow_once" || decision == "allow_always" {
                        grant_approval_once(&tool_call_id, &approval_metadata);
                    }
                    // Persist "allow_always" rule if chosen
                    if decision == "allow_always" {
                        if let (Some(proj_root), Some(rule)) = (
                            project_root,
                            approval_metadata
                                .get("approvalPattern")
                                .and_then(Value::as_str)
                                .or_else(|| {
                                    approval_metadata.get("command").and_then(Value::as_str)
                                }),
                        ) {
                            let mut perms = lyra_sandbox::PermissionsStore::load(proj_root);
                            let _ = perms.add_rule(
                                proj_root,
                                rule,
                                lyra_sandbox::PermissionDecision::AllowAlways,
                            );
                        }
                    }

                    // Re-execute the tool (approval satisfied)
                    match execute_tool_with_progress(
                        &invocation.name,
                        &effective_input,
                        ToolExecutionContext {
                            storage_root: Some(storage_root),
                            project_root,
                            agent_session_id: Some(session_id),
                            agent_turn_id: Some(turn_id),
                            tool_call_id: Some(&started_call.id),
                            terminal_policy: Some(terminal_policy),
                            plan_mode,
                        },
                        |_| {},
                    ) {
                        Ok(value) => value,
                        Err(retry_error) => {
                            let failed_call = registry_db::fail_agent_tool_call(
                                storage_root,
                                &started_call.id,
                                &retry_error.code,
                                &retry_error.message,
                            )?;
                            let error_payload = build_tool_error_payload(
                                &invocation.name,
                                &retry_error.code,
                                &retry_error.message,
                                retry_error.metadata,
                            );
                            emit_event(
                                storage_root,
                                session_id,
                                turn_id,
                                "tool_finished",
                                json!({
                                    "toolCallId": failed_call.id,
                                    "toolName": failed_call.tool_name,
                                    "status": "failed",
                                    "error": error_payload.clone(),
                                }),
                            )?;
                            emit_tool_failure_diagnosed_event(
                                storage_root,
                                session_id,
                                turn_id,
                                &failed_call.id,
                                &failed_call.tool_name,
                                &error_payload,
                            )?;
                            let agent_error_result = json!({
                                "ok": false,
                                "recoverable": false,
                                "error": error_payload,
                            });
                            provider_messages.push(AgentInferenceMessage {
                                role: AgentInferenceMessageRole::Tool,
                                content: serde_json::to_string(&agent_error_result)
                                    .unwrap_or_else(|_| "{}".to_string()),
                                tool_call_id: Some(invocation.id.clone()),
                                tool_calls: Vec::new(),
                            });
                            return Ok(failed_call);
                        }
                    }
                } else {
                    if let Some(interaction) = resolve_pending_interaction(
                        storage_root,
                        &tool_call_id,
                        AgentPendingInteractionStatus::Resolved,
                        Some(json!({ "decision": "deny" })),
                    )? {
                        emit_interaction_resolved_event(storage_root, &interaction)?;
                        emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                    }
                    // Deny — return failure to LLM
                    let failed_call = registry_db::fail_agent_tool_call(
                        storage_root,
                        &started_call.id,
                        "AGENT_TOOL_DENIED",
                        "command execution denied by user",
                    )?;
                    let error_payload = build_tool_error_payload(
                        &invocation.name,
                        "AGENT_TOOL_DENIED",
                        "command execution denied by user",
                        None,
                    );
                    emit_event(
                        storage_root,
                        session_id,
                        turn_id,
                        "tool_finished",
                        json!({
                            "toolCallId": failed_call.id,
                            "toolName": failed_call.tool_name,
                            "status": "denied",
                            "user_message": "Command execution was denied by the user.",
                            "error": error_payload.clone(),
                        }),
                    )?;
                    emit_tool_failure_diagnosed_event(
                        storage_root,
                        session_id,
                        turn_id,
                        &failed_call.id,
                        &failed_call.tool_name,
                        &error_payload,
                    )?;
                    let agent_error_result = json!({
                        "ok": false,
                        "recoverable": false,
                        "error": error_payload,
                    });
                    provider_messages.push(AgentInferenceMessage {
                        role: AgentInferenceMessageRole::Tool,
                        content: serde_json::to_string(&agent_error_result)
                            .unwrap_or_else(|_| "{}".to_string()),
                        tool_call_id: Some(invocation.id.clone()),
                        tool_calls: Vec::new(),
                    });
                    return Ok(failed_call);
                }
            } else if error.code == AGENT_PLAN_QUESTION_REQUIRED {
                let question_metadata = error.metadata.clone().unwrap_or_else(|| json!({}));
                let request_id = started_call.id.clone();
                let rx = register_plan_question_waiter(&request_id);
                let interaction = create_pending_interaction(
                    storage_root,
                    session_id,
                    turn_id,
                    &request_id,
                    AgentPendingInteractionKind::UserQuestion,
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "questions": question_metadata.get("questions").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
                        "allowNote": question_metadata.get("allowNote").and_then(Value::as_bool).unwrap_or(false),
                    }),
                )?;
                emit_interaction_pending_event(storage_root, &interaction)?;
                emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "plan_question_requested",
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "questions": question_metadata.get("questions").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
                        "allowNote": question_metadata.get("allowNote").and_then(Value::as_bool).unwrap_or(false),
                    }),
                )?;
                let resolution = match rx.recv() {
                    Ok(value) => value,
                    Err(_error) => {
                        cancel_plan_question(&request_id);
                        if let Some(interaction) = cancel_pending_interaction(
                            storage_root,
                            &request_id,
                            "question was cancelled before a response was received",
                        )? {
                            emit_interaction_resolved_event(storage_root, &interaction)?;
                            emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                        }
                        let failed_call = registry_db::fail_agent_tool_call(
                            storage_root,
                            &started_call.id,
                            AGENT_TURN_FAILED,
                            "plan question was cancelled before a response was received",
                        )?;
                        let agent_error_result = json!({
                            "ok": false,
                            "recoverable": true,
                            "error": {
                                "code": AGENT_TURN_FAILED,
                                "message": "plan question was cancelled before a response was received",
                            }
                        });
                        provider_messages.push(AgentInferenceMessage {
                            role: AgentInferenceMessageRole::Tool,
                            content: serde_json::to_string(&agent_error_result)
                                .unwrap_or_else(|_| "{}".to_string()),
                            tool_call_id: Some(invocation.id.clone()),
                            tool_calls: Vec::new(),
                        });
                        return Ok(failed_call);
                    }
                };
                let tool_result = json!({
                    "kind": "user_input_answered",
                    "requestId": request_id,
                    "answers": resolution.answers,
                    "note": resolution.note,
                });
                return complete_tool_call_and_push_result(
                    storage_root,
                    session_id,
                    turn_id,
                    invocation,
                    &started_call.id,
                    &tool_result,
                    provider_messages,
                    budget,
                );
            } else if error.code == AGENT_PLAN_APPROVAL_REQUIRED {
                let approval_metadata = error.metadata.clone().unwrap_or_else(|| json!({}));
                let request_id = started_call.id.clone();
                let rx = register_plan_approval_waiter(&request_id);
                let interaction = create_pending_interaction(
                    storage_root,
                    session_id,
                    turn_id,
                    &request_id,
                    AgentPendingInteractionKind::PlanApproval,
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "version": approval_metadata.get("version").cloned().unwrap_or(Value::Null),
                        "status": approval_metadata.get("status").cloned().unwrap_or(Value::String("submitted".to_string())),
                        "summary": approval_metadata.get("summary").cloned().unwrap_or(Value::String("Proposed plan".to_string())),
                        "proposedMarkdown": approval_metadata.get("proposedMarkdown").cloned().unwrap_or(Value::String(String::new())),
                        "draftMarkdown": approval_metadata.get("draftMarkdown").cloned().unwrap_or(Value::String(String::new())),
                    }),
                )?;
                emit_interaction_pending_event(storage_root, &interaction)?;
                emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "plan_approval_requested",
                    json!({
                        "requestId": request_id,
                        "toolCallId": started_call.id,
                        "toolName": invocation.name,
                        "version": approval_metadata.get("version").cloned().unwrap_or(Value::Null),
                        "status": approval_metadata.get("status").cloned().unwrap_or(Value::String("submitted".to_string())),
                        "summary": approval_metadata.get("summary").cloned().unwrap_or(Value::String("Proposed plan".to_string())),
                        "proposedMarkdown": approval_metadata.get("proposedMarkdown").cloned().unwrap_or(Value::String(String::new())),
                        "draftMarkdown": approval_metadata.get("draftMarkdown").cloned().unwrap_or(Value::String(String::new())),
                    }),
                )?;
                let resolution = match rx.recv() {
                    Ok(value) => value,
                    Err(_error) => {
                        cancel_plan_approval(&request_id);
                        if let Some(interaction) = cancel_pending_interaction(
                            storage_root,
                            &request_id,
                            "plan approval was cancelled before a response was received",
                        )? {
                            emit_interaction_resolved_event(storage_root, &interaction)?;
                            emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
                        }
                        let failed_call = registry_db::fail_agent_tool_call(
                            storage_root,
                            &started_call.id,
                            AGENT_TURN_FAILED,
                            "plan approval was cancelled before a response was received",
                        )?;
                        let agent_error_result = json!({
                            "ok": false,
                            "recoverable": false,
                            "error": {
                                "code": AGENT_TURN_FAILED,
                                "message": "plan approval was cancelled before a response was received",
                            }
                        });
                        provider_messages.push(AgentInferenceMessage {
                            role: AgentInferenceMessageRole::Tool,
                            content: serde_json::to_string(&agent_error_result)
                                .unwrap_or_else(|_| "{}".to_string()),
                            tool_call_id: Some(invocation.id.clone()),
                            tool_calls: Vec::new(),
                        });
                        return Ok(failed_call);
                    }
                };
                if let Some(mut plan) = registry_db::read_agent_plan(storage_root, session_id)? {
                    match resolution.decision.as_str() {
                        "approve_and_implement" => {
                            plan.status = AgentPlanStatus::Approved;
                            plan.approved_markdown = approval_metadata
                                .get("proposedMarkdown")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .or_else(|| plan.proposed_markdown.clone());
                        }
                        "reject" => {
                            plan.status = AgentPlanStatus::Rejected;
                        }
                        _ => {
                            plan.status = AgentPlanStatus::Draft;
                        }
                    }
                    plan.updated_at = now_ms();
                    let _ = registry_db::upsert_agent_plan(storage_root, session_id, &plan)?;
                }
                let tool_result = json!({
                    "kind": "plan_approval_resolved",
                    "requestId": request_id,
                    "decision": resolution.decision,
                    "feedback": resolution.feedback,
                    "proposedMarkdown": approval_metadata.get("proposedMarkdown").cloned().unwrap_or(Value::String(String::new())),
                });
                return complete_tool_call_and_push_result(
                    storage_root,
                    session_id,
                    turn_id,
                    invocation,
                    &started_call.id,
                    &tool_result,
                    provider_messages,
                    budget,
                );
            } else {
                // Original non-approval error handling
                let failed_call = registry_db::fail_agent_tool_call(
                    storage_root,
                    &started_call.id,
                    &error.code,
                    &error.message,
                )?;
                let error_metadata = error.metadata.clone();

                // Classify the tool error for recovery strategy
                let severity = classify_tool_error(
                    &invocation.name,
                    failed_call.error_code.as_deref(),
                    failed_call
                        .error_message
                        .as_deref()
                        .unwrap_or(&error.message),
                );

                // Emit runtime event with withholding — suppress transient errors
                let withheld = error_withholding.process(severity.clone(), 0);
                if let Some(user_msg) = withheld {
                    let error_payload = build_tool_error_payload(
                        &invocation.name,
                        &error.code,
                        &error.message,
                        error_metadata.clone(),
                    );
                    emit_event(
                        storage_root,
                        session_id,
                        turn_id,
                        "tool_finished",
                        json!({
                            "toolCallId": failed_call.id,
                            "toolName": failed_call.tool_name,
                            "status": "failed",
                            "user_message": user_msg,
                            "error": error_payload,
                        }),
                    )?;
                } else {
                    // Error withheld — emit minimal event for diagnostics only
                    emit_event(
                        storage_root,
                        session_id,
                        turn_id,
                        "tool_finished",
                        json!({
                            "toolCallId": failed_call.id,
                            "toolName": failed_call.tool_name,
                            "status": "failed",
                            "suppressed": true,
                        }),
                    )?;
                }

                let code = failed_call
                    .error_code
                    .as_deref()
                    .unwrap_or(AGENT_TOOL_EXEC_FAILED)
                    .to_string();
                let message = failed_call
                    .error_message
                    .clone()
                    .unwrap_or_else(|| "tool execution failed".to_string());
                let error_payload = build_tool_error_payload(
                    &invocation.name,
                    &code,
                    &message,
                    error_metadata.clone(),
                );

                // Build agent-facing error message — include recovery hints for recoverable errors
                let agent_error_result = if severity.is_recoverable() {
                    json!({
                        "ok": false,
                        "recoverable": true,
                        "error": error_payload.clone(),
                        "hint": format!("This error is recoverable. Consider reading the latest state and retrying with adjusted parameters."),
                    })
                } else {
                    json!({
                        "ok": false,
                        "recoverable": false,
                        "error": error_payload.clone(),
                    })
                };
                emit_tool_failure_diagnosed_event(
                    storage_root,
                    session_id,
                    turn_id,
                    &failed_call.id,
                    &failed_call.tool_name,
                    &error_payload,
                )?;

                provider_messages.push(AgentInferenceMessage {
                    role: AgentInferenceMessageRole::Tool,
                    content: serde_json::to_string(&agent_error_result)
                        .unwrap_or_else(|_| "{}".to_string()),
                    tool_call_id: Some(invocation.id.clone()),
                    tool_calls: Vec::new(),
                });
                return Ok(failed_call);
            }
        }
    };
    if let Some(error) = progress_emit_error {
        return Err(error);
    }

    let finished_call =
        registry_db::complete_agent_tool_call(storage_root, &started_call.id, &tool_result)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_finished",
        json!({
            "toolCallId": finished_call.id,
            "toolName": finished_call.tool_name,
            "status": "completed",
            "output": finished_call.output,
        }),
    )?;
    if invocation.name == "plan.update_draft" {
        emit_event(
            storage_root,
            session_id,
            turn_id,
            "plan_draft_updated",
            json!({
                "toolCallId": finished_call.id,
                "output": finished_call.output,
            }),
        )?;
    }

    // Record read in file state cache for read tools
    let tool_content = serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
    if invocation.name == "filesystem.read_range" {
        if let Some(path) = effective_input.get("path").and_then(Value::as_str) {
            file_cache.record_read(path, &tool_content);
        }
    }

    // Apply tool result budget enforcement
    let budgeted_content = budget.enforce(&invocation.id, &invocation.name, &tool_content);

    provider_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::Tool,
        content: budgeted_content,
        tool_call_id: Some(invocation.id.clone()),
        tool_calls: Vec::new(),
    });

    Ok(finished_call)
}

/// Raw result from concurrent tool execution (no napi types).
struct RawToolExecResult {
    tool_result: Option<serde_json::Value>,
    error_code: Option<String>,
    error_message: Option<String>,
    error_metadata: Option<serde_json::Value>,
}

/// Execute tools concurrently in a pure-Rust context (no napi errors).
fn run_concurrent_tools(
    invocations: Vec<(String, serde_json::Value, Option<String>)>,
) -> Vec<RawToolExecResult> {
    std::thread::scope(|s| {
        let threads: Vec<_> = invocations
            .iter()
            .map(|(name, input, proj_root)| {
                let name = name.clone();
                let input = input.clone();
                let proj_root = proj_root.clone();
                s.spawn(move || {
                    match crate::agent::tools::execute_readonly_tool(
                        &name,
                        &input,
                        proj_root.as_deref(),
                    ) {
                        Ok(value) => RawToolExecResult {
                            tool_result: Some(value),
                            error_code: None,
                            error_message: None,
                            error_metadata: None,
                        },
                        Err(err) => RawToolExecResult {
                            tool_result: None,
                            error_code: Some(err.code),
                            error_message: Some(err.message),
                            error_metadata: err.metadata,
                        },
                    }
                })
            })
            .collect();

        threads
            .into_iter()
            .map(|t| {
                t.join().unwrap_or_else(|_| RawToolExecResult {
                    tool_result: None,
                    error_code: Some("AGENT_TOOL_EXEC_FAILED".to_string()),
                    error_message: Some("concurrent tool execution panicked".to_string()),
                    error_metadata: None,
                })
            })
            .collect()
    })
}

/// Execute a batch of read-only tools concurrently using thread scopes.
/// Returns (AgentToolCall, serialized_tool_result) pairs in original order.
fn execute_readonly_batch(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    invocations: &[AgentToolInvocation],
    project_root: Option<&str>,
) -> napi::Result<Vec<(AgentToolCall, String)>> {
    if invocations.len() == 1 {
        let inv = &invocations[0];
        let effective_input =
            apply_project_scope_to_tool_input(&inv.name, &inv.input, project_root);
        let started_call = registry_db::create_agent_tool_call(
            storage_root,
            session_id,
            turn_id,
            &inv.name,
            &effective_input,
        )?;
        let _ = emit_event(
            storage_root,
            session_id,
            turn_id,
            "tool_started",
            json!({"toolCallId": started_call.id, "toolName": inv.name, "input": effective_input.clone()}),
        );

        let tool_result = execute_tool_with_progress(
            &inv.name,
            &effective_input,
            ToolExecutionContext::readonly(project_root),
            |_| {},
        )
        .map_err(|e| agent_error(&e.code, &e.message))?;
        let finished_call =
            registry_db::complete_agent_tool_call(storage_root, &started_call.id, &tool_result)?;
        let tool_content = serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
        let _ = emit_event(
            storage_root,
            session_id,
            turn_id,
            "tool_finished",
            json!({"toolCallId": finished_call.id, "toolName": finished_call.tool_name, "status": "completed", "output": finished_call.output}),
        );

        return Ok(vec![(finished_call, tool_content)]);
    }

    // Prepare inputs for concurrent execution
    let mut started_calls = Vec::new();
    let mut tool_inputs = Vec::new();
    for inv in invocations {
        let effective_input =
            apply_project_scope_to_tool_input(&inv.name, &inv.input, project_root);
        let started_call = registry_db::create_agent_tool_call(
            storage_root,
            session_id,
            turn_id,
            &inv.name,
            &effective_input,
        )?;
        let _ = emit_event(
            storage_root,
            session_id,
            turn_id,
            "tool_started",
            json!({"toolCallId": started_call.id, "toolName": inv.name, "input": effective_input.clone()}),
        );
        started_calls.push(started_call);
        tool_inputs.push((
            inv.name.clone(),
            effective_input,
            project_root.map(String::from),
        ));
    }

    // Execute concurrently in a separate function that avoids napi types
    let exec_results = run_concurrent_tools(tool_inputs);

    // Collect results
    let mut results = Vec::new();
    for (idx, raw) in exec_results.into_iter().enumerate() {
        let started_id = &started_calls[idx].id;
        if let Some(tool_result) = raw.tool_result {
            let finished_call =
                registry_db::complete_agent_tool_call(storage_root, started_id, &tool_result)?;
            let tool_content =
                serde_json::to_string(&tool_result).unwrap_or_else(|_| "{}".to_string());
            let _ = emit_event(
                storage_root,
                session_id,
                turn_id,
                "tool_finished",
                json!({"toolCallId": finished_call.id, "toolName": finished_call.tool_name, "status": "completed", "output": finished_call.output}),
            );
            results.push((finished_call, tool_content));
        } else {
            let error_code = raw
                .error_code
                .unwrap_or_else(|| "AGENT_TOOL_EXEC_FAILED".to_string());
            let error_msg = raw
                .error_message
                .unwrap_or_else(|| "tool execution failed".to_string());
            let error_metadata = raw.error_metadata;
            let error_payload = build_tool_error_payload(
                &invocations[idx].name,
                &error_code,
                &error_msg,
                error_metadata.clone(),
            );
            let failed_call = registry_db::fail_agent_tool_call(
                storage_root,
                started_id,
                &error_code,
                &error_msg,
            )?;
            let _ = emit_event(
                storage_root,
                session_id,
                turn_id,
                "tool_finished",
                json!({"toolCallId": failed_call.id, "toolName": failed_call.tool_name, "status": "failed",
                    "error": error_payload.clone()}),
            );
            let _ = emit_tool_failure_diagnosed_event(
                storage_root,
                session_id,
                turn_id,
                &failed_call.id,
                &failed_call.tool_name,
                &error_payload,
            );
            let error_result = json!({
                "ok": false,
                "error": error_payload
            });
            let error_content =
                serde_json::to_string(&error_result).unwrap_or_else(|_| "{}".to_string());
            results.push((failed_call, error_content));
        }
    }

    Ok(results)
}

fn append_assistant_message_to_stores(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    content: &str,
    project_root: Option<&str>,
) -> Result<(AgentMessage, Vec<MemoryRuntimePhaseEvent>)> {
    let assistant_message = registry_db::append_agent_message(
        storage_root,
        session_id,
        Some(turn_id.to_string()),
        "assistant",
        content,
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

fn approved_plan_from_tool_calls(tool_calls: &[AgentToolCall]) -> Option<String> {
    tool_calls.iter().find_map(|tool_call| {
        let output = tool_call.output.as_ref()?;
        if output.get("kind").and_then(Value::as_str) != Some("plan_approval_resolved") {
            return None;
        }
        if output.get("decision").and_then(Value::as_str) != Some("approve_and_implement") {
            return None;
        }
        output
            .get("proposedMarkdown")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

fn proposed_plan_from_content(content: &str) -> Option<String> {
    let captures = PROPOSED_PLAN_BLOCK_RE.captures(content)?;
    let body = captures.get(1)?.as_str().trim();
    if body.is_empty() {
        return None;
    }
    Some(body.to_string())
}

fn summarize_proposed_plan(plan_markdown: &str) -> String {
    plan_markdown
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Proposed plan")
        .to_string()
}

fn build_plan_mode_enforcement_prompt(previous_draft: &str) -> String {
    let trimmed = previous_draft.trim();
    if trimmed.is_empty() {
        return "[Lyra Plan Mode Enforcement] You are still in Plan Mode. Do not continue with plain text. End this turn by doing exactly one of the following:\n1. Call `request_user_input` with 1-4 structured blocking questions and 2-4 options each.\n2. Call `plan.submit_for_approval` with a complete decision-ready plan.\nDo not implement, do not narrate intended implementation, and do not answer in plain text.".to_string();
    }

    format!(
        "[Lyra Plan Mode Enforcement] Your previous draft reply did not satisfy Plan Mode because it ended in plain text.\n\nPrevious draft reply:\n{trimmed}\n\nNow correct this immediately. End this turn by doing exactly one of the following:\n1. Call `request_user_input` with 1-4 structured blocking questions and 2-4 options each.\n2. Call `plan.submit_for_approval` with a complete decision-ready plan.\nDo not implement, do not keep exploring, and do not answer in plain text."
    )
}

fn synthesize_plan_approval_from_assistant_message(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    assistant_message: &AgentMessage,
) -> Result<()> {
    let Some(proposed_markdown) = proposed_plan_from_content(&assistant_message.content) else {
        return Ok(());
    };

    let has_pending_plan_approval = list_pending_interactions(storage_root, session_id)?
        .into_iter()
        .any(|interaction| {
            interaction.turn_id == turn_id
                && interaction.kind == AgentPendingInteractionKind::PlanApproval
                && interaction.status == AgentPendingInteractionStatus::Pending
        });
    if has_pending_plan_approval {
        return Ok(());
    }

    let mut plan = ensure_plan_state(storage_root, session_id)?;
    if plan.version == 0 {
        plan.version = 1;
    }
    if plan.draft_markdown.trim().is_empty() {
        plan.draft_markdown = proposed_markdown.clone();
    }
    plan.status = AgentPlanStatus::Submitted;
    plan.proposed_markdown = Some(proposed_markdown.clone());
    plan.last_submitted_version = Some(plan.version);
    plan.updated_at = now_ms();
    let persisted_plan = registry_db::upsert_agent_plan(storage_root, session_id, &plan)?;
    let request_id = format!("{turn_id}-proposed-plan");
    let summary = summarize_proposed_plan(&proposed_markdown);
    let interaction = create_pending_interaction(
        storage_root,
        session_id,
        turn_id,
        &request_id,
        AgentPendingInteractionKind::PlanApproval,
        json!({
            "requestId": request_id.clone(),
            "source": "assistant_proposed_plan",
            "version": persisted_plan.version,
            "status": "submitted",
            "summary": summary.clone(),
            "proposedMarkdown": proposed_markdown.clone(),
            "draftMarkdown": persisted_plan.draft_markdown.clone(),
        }),
    )?;
    emit_interaction_pending_event(storage_root, &interaction)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "plan_approval_requested",
        json!({
            "requestId": request_id,
            "version": persisted_plan.version,
            "status": "submitted",
            "summary": summary,
            "proposedMarkdown": interaction.payload.get("proposedMarkdown").cloned().unwrap_or(Value::String(String::new())),
            "draftMarkdown": interaction.payload.get("draftMarkdown").cloned().unwrap_or(Value::String(String::new())),
            "source": "assistant_proposed_plan",
        }),
    )?;
    emit_interaction_queue_updated(storage_root, session_id, turn_id)
}

fn build_plan_reentry_guidance(plan: Option<&AgentPlanState>) -> String {
    let Some(plan) = plan else {
        return "No existing plan draft exists yet. Start by exploring and drafting a complete plan."
            .to_string();
    };
    if plan.version == 0 || plan.draft_markdown.trim().is_empty() {
        return "No existing plan draft exists yet. Start by exploring and drafting a complete plan."
            .to_string();
    }
    match plan.status {
        AgentPlanStatus::Submitted => {
            "An existing submitted plan is present. Re-open it, verify whether the latest user input changes scope, and replace the full draft if needed."
                .to_string()
        }
        AgentPlanStatus::Approved => {
            "A previously approved plan exists. Only revise it if the user is clearly changing the task; otherwise continue from the approved context."
                .to_string()
        }
        AgentPlanStatus::Rejected => {
            "A previously rejected plan exists. Use it as historical context only and replace it with a corrected full draft."
                .to_string()
        }
        AgentPlanStatus::Draft => {
            "An existing draft is available. Continue refining it if the task is still the same, otherwise replace the full draft."
                .to_string()
        }
    }
}

fn build_plan_scope_reset_guidance(project_root: Option<&str>) -> String {
    let project_root = project_root.unwrap_or("unknown");
    format!(
        "The bound project root for this turn is now `{project_root}`. Treat this as a fresh planning scope unless the user explicitly says to continue older work. Ignore stale file paths, older project-specific assumptions, and replace any previous draft that targeted another root."
    )
}

fn select_plan_handoff_input(
    storage_root: &str,
    session_id: &str,
    fallback: &str,
) -> Result<String> {
    let messages = registry_db::list_agent_messages(storage_root, session_id)?;
    let best = messages
        .iter()
        .rev()
        .find(|message| message.role == "user" && message.content.trim().chars().count() >= 24)
        .or_else(|| {
            messages
                .iter()
                .rev()
                .find(|message| message.role == "user" && !message.content.trim().is_empty())
        })
        .map(|message| message.content.trim().to_string());
    Ok(best.unwrap_or_else(|| fallback.trim().to_string()))
}

fn run_provider_loop(
    storage_root: &str,
    session_id: &str,
    running_turn: &AgentTurn,
    current_input: &str,
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: AgentInferenceMessage,
    mut provider_messages: Vec<AgentInferenceMessage>,
    tools: Vec<crate::provider::types::AgentToolDefinition>,
    effective_project_root: Option<String>,
    terminal_policy: &TerminalInteractionPolicy,
    enable_context_collapse: bool,
    plan_mode: bool,
    enable_reflection: bool,
    reflection_min_calls: usize,
) -> Result<(
    AgentTurn,
    Option<AgentMessage>,
    Vec<AgentToolCall>,
    Option<AgentUsage>,
    Option<String>,
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

    let turn_result = (|| -> Result<(
        AgentTurn,
        Option<AgentMessage>,
        Vec<AgentToolCall>,
        Option<AgentUsage>,
        Option<String>,
    )> {
        let mut step_index = 0_u32;
        loop {
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
                            "[Lyra Internal Reflection Module] Review the completed turn for correctness and completeness. If everything is sound, output LGTM. Otherwise provide concise corrective guidance.\n\nTools used: {}\n\nFinal answer:\n{}",
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
                        assistant_text =
                            format!("{assistant_text}\n\n---\n*Reflection*: {reflection_text}");
                    }
                    emit_event(
                        storage_root,
                        session_id,
                        &running_turn.id,
                        "reflection_completed",
                        json!({ "reflection": reflection_text }),
                    )?;
                }
            }

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

    match turn_result {
        Ok(value) => Ok(value),
        Err(error) => {
            let error_display = error.to_string();
            let (code, message) = parse_agent_error_message(&error_display);
            let failed_turn =
                finalize_failed_turn(storage_root, session_id, &running_turn.id, code, message)?;
            let failure_message = build_turn_failed_assistant_message(code, message);
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
            Ok((
                failed_turn,
                Some(assistant_message),
                tool_trace.clone(),
                usage,
                None,
            ))
        }
    }
}

fn run_plan_implementation_handoff(
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
    let tools =
        readonly_tool_definitions_for_input_with_context(&handoff_input, Some(&tool_ranking_context));
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
    let (turn, assistant_message, tool_calls, usage, _) = run_provider_loop(
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

fn send_plan_turn(request: AgentSendTurnRequest) -> Result<AgentSendTurnResult> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let input = normalize_required_text(&request.input, "input")?;
    let _turn_guard = acquire_turn_guard(&session_id)?;
    initialize_session_storage(&storage_root, &session_id)?;
    let mut session =
        registry_db::read_agent_session(&storage_root, &session_id)?.ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    let previous_project_root = session.project_root.clone();
    let requested_project_root = request
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut project_scope_changed = false;
    if let Some(project_root) = requested_project_root {
        let normalized_root = normalize_project_root(project_root)?;
        let project_name = project_name_from_root(&normalized_root);
        if session.project_root.as_deref() != Some(normalized_root.as_str())
            || session.project_name.as_deref() != project_name.as_deref()
        {
            project_scope_changed =
                previous_project_root.as_deref() != Some(normalized_root.as_str());
            session = registry_db::update_agent_session_project(
                &storage_root,
                &session_id,
                Some(normalized_root.clone()),
                project_name,
            )?;
        }
    }
    let effective_project_root = session.project_root.clone();
    let requested_profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let profile = resolve_profile_for_turn(&storage_root, &session, requested_profile_id)?;
    if session.profile_id.as_deref() != Some(profile.id.as_str()) {
        session = registry_db::update_agent_session_profile(
            &storage_root,
            &session_id,
            Some(profile.id.clone()),
        )?;
    }
    let running_turn = registry_db::create_agent_turn(&storage_root, &session_id, &profile.id)?;
    let user_message =
        registry_db::append_agent_message(&storage_root, &session_id, None, "user", &input)?;
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "accepted",
        json!({ "messageId": user_message.id, "profileId": profile.id, "collaborationMode": "plan" }),
    )?;
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "started",
        json!({
            "profileId": profile.id,
            "providerId": profile.provider_id,
            "protocolId": profile.protocol_id,
            "model": profile.model,
            "collaborationMode": "plan",
        }),
    )?;
    let user_memory_events = append_session_dialog_message(
        &storage_root,
        &session_id,
        &user_message.id,
        "user",
        &input,
        Some(&running_turn.id),
        effective_project_root.as_deref(),
    )?;
    emit_memory_events(
        &storage_root,
        &session_id,
        &running_turn.id,
        user_memory_events,
    )?;
    let secrets = resolve_secret_values(&profile.secret_refs, None, &KeyringSecretStore)?;
    let tool_ranking_context = build_tool_ranking_context(&storage_root, &session_id)?;
    let tools =
        plan_mode_tool_definitions_for_input_with_context(&input, Some(&tool_ranking_context));
    let terminal_policy = select_terminal_interaction_policy();
    let turn_context = build_turn_context(
        &storage_root,
        &session_id,
        &profile.to_public(),
        effective_project_root.as_deref(),
    )?;
    let turn_number = registry_db::list_agent_turns(&storage_root, &session_id)?.len();
    let activated_skill_prompts = render_activated_skill_prompts();
    let mcp_tools_json = render_mcp_tools_prompt_json();
    let plan_state = if project_scope_changed {
        registry_db::upsert_agent_plan(&storage_root, &session_id, &blank_plan_state())?
    } else {
        ensure_plan_state(&storage_root, &session_id)?
    };
    let reentry_guidance = if project_scope_changed {
        build_plan_scope_reset_guidance(effective_project_root.as_deref())
    } else {
        build_plan_reentry_guidance(Some(&plan_state))
    };
    let prompt_result = build_plan_mode_system_prompt(
        &PromptBuildInput {
            session_id: &session_id,
            turn_number,
            user_input: &input,
            project_root: effective_project_root.as_deref(),
            memory_snapshot: &turn_context.memory_snapshot,
            activated_skill_prompts: &activated_skill_prompts,
            mcp_tools_json: &mcp_tools_json,
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &select_turn_strategy(&input),
        },
        Some(&plan_state),
        &reentry_guidance,
    );
    let system_message = AgentInferenceMessage {
        role: AgentInferenceMessageRole::System,
        content: prompt_result.prompt.clone(),
        tool_call_id: None,
        tool_calls: Vec::new(),
    };
    let mut provider_messages = turn_context.messages;
    provider_messages.insert(0, system_message.clone());
    let repeated_main_input = build_live_repeated_user_input(
        &input,
        total_message_tokens(&provider_messages),
        profile.model.as_str(),
    );
    let _ = replace_latest_user_message(
        &mut provider_messages,
        &repeated_main_input.transformed_input,
    );
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "prompt_compiled",
        json!({
            "collaborationMode": "plan",
            "totalTokens": prompt_result.total_tokens,
            "sectionTokens": prompt_result.section_tokens,
            "truncatedSections": prompt_result.truncated_sections,
            "truncated": !prompt_result.truncated_sections.is_empty(),
        }),
    )?;
    emit_input_postprocessed(
        &storage_root,
        &session_id,
        &running_turn.id,
        "main",
        &repeated_main_input,
    )?;
    let (turn, assistant_message, tool_calls, usage, approved_plan) = run_provider_loop(
        &storage_root,
        &session_id,
        &running_turn,
        &input,
        &profile,
        &secrets,
        system_message,
        provider_messages,
        tools,
        effective_project_root.clone(),
        &terminal_policy,
        false,
        true,
        false,
        usize::MAX,
    )?;
    cleanup_transient_ai_sessions(&session_id, &running_turn.id);

    if let Some(approved_plan) = approved_plan {
        registry_db::set_agent_session_collaboration_mode(
            &storage_root,
            &session_id,
            AgentCollaborationMode::Default,
        )?;
        emit_event(
            &storage_root,
            &session_id,
            &running_turn.id,
            "plan_mode_exited",
            json!({
                "reason": "approved_and_implement",
            }),
        )?;
        return run_plan_implementation_handoff(
            &storage_root,
            &session_id,
            &input,
            &request,
            &profile,
            &session,
            &approved_plan,
        );
    }

    if let Some(message) = assistant_message.as_ref() {
        synthesize_plan_approval_from_assistant_message(
            &storage_root,
            &session_id,
            &running_turn.id,
            message,
        )?;
    }

    let next_session =
        registry_db::read_agent_session(&storage_root, &session_id)?.unwrap_or(session);
    Ok(AgentSendTurnResult {
        session: next_session,
        turn,
        assistant_message,
        tool_calls,
        usage,
    })
}

pub fn send_turn(request: AgentSendTurnRequest) -> Result<AgentSendTurnResult> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    initialize_session_storage(&storage_root, &session_id)?;
    let session =
        registry_db::read_agent_session(&storage_root, &session_id)?.ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    if session.collaboration_mode == AgentCollaborationMode::Plan {
        return send_plan_turn(request);
    }

    let input = normalize_required_text(&request.input, "input")?;
    let _turn_guard = acquire_turn_guard(&session_id)?;
    let mut session = session;
    let requested_project_root = request
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(project_root) = requested_project_root {
        let normalized_root = normalize_project_root(project_root)?;
        let project_name = project_name_from_root(&normalized_root);
        if session.project_root.as_deref() != Some(normalized_root.as_str())
            || session.project_name.as_deref() != project_name.as_deref()
        {
            session = registry_db::update_agent_session_project(
                &storage_root,
                &session_id,
                Some(normalized_root.clone()),
                project_name,
            )?;
        }
    }
    let effective_project_root = session.project_root.clone();

    let requested_profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let profile = resolve_profile_for_turn(&storage_root, &session, requested_profile_id)?;

    if !is_supported_protocol(&profile.protocol_id) {
        return Err(agent_error(
            AGENT_PROVIDER_UNSUPPORTED,
            format!("unsupported agent protocol: {}", profile.protocol_id),
        ));
    }

    if session.profile_id.as_deref() != Some(profile.id.as_str()) {
        session = registry_db::update_agent_session_profile(
            &storage_root,
            &session_id,
            Some(profile.id.clone()),
        )?;
    }

    let running_turn = registry_db::create_agent_turn(&storage_root, &session_id, &profile.id)?;
    let user_message =
        registry_db::append_agent_message(&storage_root, &session_id, None, "user", &input)?;
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "accepted",
        json!({
            "messageId": user_message.id,
            "profileId": profile.id,
        }),
    )?;

    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "started",
        json!({
            "profileId": profile.id,
            "providerId": profile.provider_id,
            "protocolId": profile.protocol_id,
            "model": profile.model,
        }),
    )?;

    let user_memory_events = append_session_dialog_message(
        &storage_root,
        &session_id,
        &user_message.id,
        "user",
        &input,
        Some(&running_turn.id),
        effective_project_root.as_deref(),
    )?;
    emit_memory_events(
        &storage_root,
        &session_id,
        &running_turn.id,
        user_memory_events,
    )?;

    let secrets = resolve_secret_values(&profile.secret_refs, None, &KeyringSecretStore)?;
    let tool_ranking_context = build_tool_ranking_context(&storage_root, &session_id)?;
    let tools = readonly_tool_definitions_for_input_with_context(&input, Some(&tool_ranking_context));
    let turn_strategy = select_turn_strategy(&input);
    let terminal_policy = select_terminal_interaction_policy();
    let explicit_max_steps = request.max_steps.filter(|value| *value > 0);
    let effective_max_steps = explicit_max_steps.or(turn_strategy.default_max_steps());
    let effective_planning = turn_strategy.planning_enabled(request.enable_planning);
    let effective_reflection = turn_strategy.reflection_enabled(request.enable_reflection);
    let turn_context = build_turn_context(
        &storage_root,
        &session_id,
        &profile.to_public(),
        effective_project_root.as_deref(),
    )?;
    let turn_number = registry_db::list_agent_turns(&storage_root, &session_id)?.len();
    let activated_skill_prompts = render_activated_skill_prompts();
    let mcp_tools_json = render_mcp_tools_prompt_json();
    let prompt_result = build_system_prompt(&PromptBuildInput {
        session_id: &session_id,
        turn_number,
        user_input: &input,
        project_root: effective_project_root.as_deref(),
        memory_snapshot: &turn_context.memory_snapshot,
        activated_skill_prompts: &activated_skill_prompts,
        mcp_tools_json: &mcp_tools_json,
        execution_profile: None,
        approval_profile: None,
        turn_strategy: &turn_strategy,
    });
    let system_message = AgentInferenceMessage {
        role: AgentInferenceMessageRole::System,
        content: prompt_result.prompt.clone(),
        tool_call_id: None,
        tool_calls: Vec::new(),
    };
    let mut provider_messages = turn_context.messages;
    provider_messages.insert(0, system_message.clone());
    let repeated_main_input = build_live_repeated_user_input(
        &input,
        total_message_tokens(&provider_messages),
        profile.model.as_str(),
    );
    let _ = replace_latest_user_message(
        &mut provider_messages,
        &repeated_main_input.transformed_input,
    );
    emit_turn_strategy_selected(
        &storage_root,
        &session_id,
        &running_turn.id,
        &turn_strategy,
        effective_planning,
        effective_reflection,
        effective_max_steps,
    )?;
    emit_terminal_interaction_policy_selected(
        &storage_root,
        &session_id,
        &running_turn.id,
        &terminal_policy,
    )?;
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "prompt_compiled",
        json!({
            "turnStrategy": turn_strategy.kind.as_str(),
            "totalTokens": prompt_result.total_tokens,
            "sectionTokens": prompt_result.section_tokens,
            "truncatedSections": prompt_result.truncated_sections,
            "truncated": !prompt_result.truncated_sections.is_empty(),
        }),
    )?;
    emit_input_postprocessed(
        &storage_root,
        &session_id,
        &running_turn.id,
        "main",
        &repeated_main_input,
    )?;

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

    // --- Planning step ---
    let planning_min_chars = request.planning_min_chars.unwrap_or(100);
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
            let plan_text = plan_inference.assistant_text.trim();
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

            let inference = provider::run_agent_inference(
                &profile.to_public(),
                &secrets,
                &inference_messages,
                &tools,
                Some(&mut |delta| {
                    if delta.is_empty() {
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
            let assistant_text = if assistant_text.is_empty() {
                "".to_string()
            } else {
                // --- Reflection step ---
                let reflection_min_calls = request.reflection_min_tool_calls.unwrap_or(3);
                if effective_reflection && tool_trace.len() >= reflection_min_calls {
                    let tool_summary: Vec<String> = tool_trace.iter().map(|tc| {
                        format!("{}({})", tc.tool_name, tc.input.to_string().chars().take(80).collect::<String>())
                    }).collect();
                    let reflection_messages = vec![
                        system_message.clone(),
                        AgentInferenceMessage {
                            role: AgentInferenceMessageRole::User,
                            content: format!(
                                "[Lyra Internal Reflection Module] Review the completed turn for correctness and completeness. If everything is sound, output LGTM. Otherwise provide concise corrective guidance.\n\nTools used: {}\n\nFinal answer:\n{}",
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
                            // Append reflection note to the answer
                            assistant_text = format!("{assistant_text}\n\n---\n*Reflection*: {reflection_text}");
                        }
                        emit_event(
                            &storage_root,
                            &session_id,
                            &running_turn.id,
                            "reflection_completed",
                            json!({ "reflection": reflection_text }),
                        )?;
                    }
                }
                assistant_text
            };
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
            let failed_turn =
                finalize_failed_turn(&storage_root, &session_id, &running_turn.id, code, message)?;
            let failure_message = build_turn_failed_assistant_message(code, message);
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

    Ok(AgentSendTurnResult {
        session: next_session,
        turn,
        assistant_message,
        tool_calls,
        usage,
    })
}

/// Submit a user approval decision for a pending command execution.
/// Called from the NAPI layer when the user responds to a command approval request.
pub fn submit_command_approval(request: CommandApprovalSubmitRequest) -> Result<()> {
    let tool_call_id = normalize_required_text(&request.tool_call_id, "toolCallId")?;
    let decision = normalize_required_text(&request.decision, "decision")?;

    crate::agent::tools::resolve_approval(&tool_call_id, &decision);

    Ok(())
}
