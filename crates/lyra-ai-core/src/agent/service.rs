use napi::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::agent::command_approval_runtime::submit_command_approval_decision;
use crate::agent::default_turn_runtime::{execute_default_turn_runtime, DefaultTurnRuntimeParams};
use crate::agent::execution_state::{
    ensure_execution_state, transition_execution_state, ExecutionTransitionRequest,
};
use crate::agent::interaction_manager::create_pending_interaction;
use crate::agent::plan_approval_runtime::execute_plan_approval_resolution;
use crate::agent::plan_turn_runtime::execute_plan_turn;
use crate::agent::project_scope::project_name_from_root;
use crate::agent::prompt_pipeline::{build_system_prompt, PromptBuildInput};
use crate::agent::prompt_repetition::build_live_repeated_user_input;
use crate::agent::runtime_events::{emit_event, emit_transient_event};
use crate::agent::runtime_events::{
    emit_interaction_pending_event, emit_interaction_queue_updated,
};
use crate::agent::session_management::normalize_project_root;
use crate::agent::terminal_policy::select_terminal_interaction_policy;
use crate::agent::tools::{
    get_browser_strategy_runtime_state, readonly_tool_definitions_for_input_with_context,
    render_activated_skill_prompts, render_mcp_tools_prompt_json,
};
use crate::agent::turn_entry::{
    acquire_turn_guard, agent_error, is_supported_protocol, resolve_profile_for_turn_with_model,
};
use crate::agent::turn_runner::{browser_tool_families_prompt, build_tool_ranking_context};
use crate::agent::turn_runtime_helpers::{
    emit_input_postprocessed, emit_memory_events, emit_terminal_interaction_policy_selected,
    emit_turn_strategy_selected, replace_latest_user_message, total_message_tokens,
};
use crate::agent::turn_strategy::{
    select_turn_strategy_with_options, TurnStrategySelectionOptions,
};
use crate::agent::types::{
    AgentAnswerPlanQuestionRequest, AgentAnswerQuestionRequest, AgentArchiveThreadRequest,
    AgentCollaborationMode, AgentEnsureThreadRequest, AgentExecutionCheckpointKind,
    AgentExecutionPhase, AgentForkThreadRequest, AgentGetThreadRequest, AgentListThreadsRequest,
    AgentPendingInteractionKind, AgentPendingInteractionStatus, AgentResolvePlanApprovalRequest,
    AgentResumeExecutionRequest, AgentResumeThreadRequest, AgentRollbackThreadRequest,
    AgentSendThreadTurnRequest, AgentSendTurnRequest, AgentSendTurnResult, AgentThread,
    AgentThreadForkResult, AgentThreadLifecycleState, AgentUnarchiveThreadRequest,
    CommandApprovalSubmitRequest, AGENT_PROVIDER_UNSUPPORTED, AGENT_TURN_FAILED,
};
use crate::agent::ui_prompt_context::{derive_ui_prompt_context_with_layers, UiStyleContextLayers};
use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::error::{normalize_required_text, now_ms};
use crate::memory::{
    append_session_dialog_message, build_turn_context, initialize_session_storage,
};
use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};
use crate::storage::registry_db;

pub use crate::agent::session_management::{
    bind_session_project, create_session, delete_session, enter_plan_mode,
    get_pending_interactions, get_plan, get_session, list_sessions,
};

#[cfg(test)]
#[path = "service_interaction_guard_tests.rs"]
mod interaction_guard_tests;

#[cfg(test)]
#[path = "thread_lifecycle_tests.rs"]
mod thread_lifecycle_tests;

pub fn resolve_plan_approval(
    request: AgentResolvePlanApprovalRequest,
) -> Result<Option<AgentSendTurnResult>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let request_id = normalize_required_text(&request.request_id, "requestId")?;
    let result = execute_plan_approval_resolution(request)?;
    if result.is_some() {
        return Ok(result);
    }
    mark_execution_resumable_after_interaction(
        &storage_root,
        &session_id,
        &request_id,
        AgentPendingInteractionKind::PlanApproval,
        &turn_id,
    )?;
    resume_execution(AgentResumeExecutionRequest {
        storage_root,
        session_id,
        checkpoint_id: None,
    })
}

fn collaboration_mode_label(mode: &AgentCollaborationMode) -> &'static str {
    match mode {
        AgentCollaborationMode::Default => "default",
        AgentCollaborationMode::Plan => "plan",
    }
}

fn normalize_optional_label(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
}

fn emit_thread_transient_event(
    session_id: &str,
    phase: &str,
    payload: serde_json::Value,
) -> Result<()> {
    emit_transient_event(
        session_id,
        &format!("thread-event-{}", Uuid::new_v4()),
        phase,
        payload,
    )
}

pub fn ensure_thread(request: AgentEnsureThreadRequest) -> Result<AgentThread> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let session =
        registry_db::read_agent_session(&storage_root, &session_id)?.ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    let thread = registry_db::ensure_agent_thread_for_session(&storage_root, &session_id)?;
    emit_thread_transient_event(
        &session_id,
        "thread_ensured",
        json!({
            "threadId": thread.id,
            "sessionId": session_id,
            "lifecycleState": thread.lifecycle_state,
            "collaborationMode": collaboration_mode_label(&session.collaboration_mode),
        }),
    )?;
    Ok(thread)
}

pub fn get_thread(request: AgentGetThreadRequest) -> Result<Option<AgentThread>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let thread_id = normalize_required_text(&request.thread_id, "threadId")?;
    registry_db::read_agent_thread(&storage_root, &thread_id)
}

pub fn list_threads(request: AgentListThreadsRequest) -> Result<Vec<AgentThread>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = request
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    registry_db::list_agent_threads(
        &storage_root,
        session_id,
        request.include_archived.unwrap_or(false),
    )
}

pub fn archive_thread(request: AgentArchiveThreadRequest) -> Result<AgentThread> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let thread_id = normalize_required_text(&request.thread_id, "threadId")?;
    let thread = registry_db::set_agent_thread_lifecycle_state(
        &storage_root,
        &thread_id,
        AgentThreadLifecycleState::Archived,
    )?;
    emit_thread_transient_event(
        &thread.session_id,
        "thread_archived",
        json!({
            "threadId": thread.id,
            "sessionId": thread.session_id,
            "lifecycleState": thread.lifecycle_state,
        }),
    )?;
    Ok(thread)
}

pub fn unarchive_thread(request: AgentUnarchiveThreadRequest) -> Result<AgentThread> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let thread_id = normalize_required_text(&request.thread_id, "threadId")?;
    let thread = registry_db::set_agent_thread_lifecycle_state(
        &storage_root,
        &thread_id,
        AgentThreadLifecycleState::Active,
    )?;
    emit_thread_transient_event(
        &thread.session_id,
        "thread_unarchived",
        json!({
            "threadId": thread.id,
            "sessionId": thread.session_id,
            "lifecycleState": thread.lifecycle_state,
        }),
    )?;
    Ok(thread)
}

pub fn resume_thread(request: AgentResumeThreadRequest) -> Result<AgentThread> {
    let thread = unarchive_thread(AgentUnarchiveThreadRequest {
        storage_root: request.storage_root,
        thread_id: request.thread_id,
    })?;
    emit_thread_transient_event(
        &thread.session_id,
        "thread_resumed",
        json!({
            "threadId": thread.id,
            "sessionId": thread.session_id,
            "lifecycleState": thread.lifecycle_state,
            "elicitationCounter": thread.elicitation_counter,
        }),
    )?;
    Ok(thread)
}

fn create_forked_session_from_thread(
    storage_root: &str,
    thread: &AgentThread,
    title: Option<String>,
) -> Result<crate::agent::types::AgentSession> {
    let source_session = registry_db::read_agent_session(storage_root, &thread.session_id)?
        .ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("source session not found: {}", thread.session_id),
            )
        })?;
    let now = now_ms();
    let forked_title = title.unwrap_or_else(|| format!("{} (fork)", source_session.title));
    let session = crate::agent::types::AgentSession {
        id: format!("agent-session-{}", Uuid::new_v4()),
        title: forked_title,
        profile_id: source_session.profile_id.clone(),
        project_root: source_session.project_root.clone(),
        project_name: source_session.project_name.clone(),
        collaboration_mode: source_session.collaboration_mode.clone(),
        created_at: now,
        updated_at: now,
    };
    initialize_session_storage(storage_root, &session.id)?;
    registry_db::create_agent_session(storage_root, &session)
}

pub fn fork_thread(request: AgentForkThreadRequest) -> Result<AgentThreadForkResult> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let thread_id = normalize_required_text(&request.thread_id, "threadId")?;
    let source_thread = registry_db::read_agent_thread(&storage_root, &thread_id)?
        .ok_or_else(|| agent_error(AGENT_TURN_FAILED, format!("thread not found: {thread_id}")))?;
    let source_turn_id = normalize_optional_label(request.source_turn_id);
    let session = create_forked_session_from_thread(
        &storage_root,
        &source_thread,
        normalize_optional_label(request.title),
    )?;
    let forked_thread = registry_db::create_agent_thread_for_session(
        &storage_root,
        &session.id,
        Some(source_thread.id.clone()),
        source_turn_id.clone(),
        None,
        None,
        AgentThreadLifecycleState::Active,
    )?;
    emit_thread_transient_event(
        &source_thread.session_id,
        "thread_forked",
        json!({
            "sourceThreadId": source_thread.id,
            "sourceSessionId": source_thread.session_id,
            "forkedThreadId": forked_thread.id,
            "forkedSessionId": session.id,
            "sourceTurnId": source_turn_id,
        }),
    )?;
    Ok(AgentThreadForkResult {
        thread: forked_thread,
        session,
    })
}

pub fn rollback_thread(request: AgentRollbackThreadRequest) -> Result<AgentThreadForkResult> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let thread_id = normalize_required_text(&request.thread_id, "threadId")?;
    let rollback_turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let source_thread = registry_db::read_agent_thread(&storage_root, &thread_id)?
        .ok_or_else(|| agent_error(AGENT_TURN_FAILED, format!("thread not found: {thread_id}")))?;
    let session = create_forked_session_from_thread(
        &storage_root,
        &source_thread,
        normalize_optional_label(request.title),
    )?;
    let rollback_branch = registry_db::create_agent_thread_for_session(
        &storage_root,
        &session.id,
        Some(source_thread.id.clone()),
        Some(rollback_turn_id.clone()),
        Some(source_thread.id.clone()),
        Some(rollback_turn_id.clone()),
        AgentThreadLifecycleState::Active,
    )?;
    emit_thread_transient_event(
        &source_thread.session_id,
        "thread_rolled_back",
        json!({
            "sourceThreadId": source_thread.id,
            "sourceSessionId": source_thread.session_id,
            "rollbackThreadId": rollback_branch.id,
            "rollbackSessionId": session.id,
            "rollbackTurnId": rollback_turn_id,
        }),
    )?;
    Ok(AgentThreadForkResult {
        thread: rollback_branch,
        session,
    })
}

pub fn send_thread_turn(request: AgentSendThreadTurnRequest) -> Result<AgentSendTurnResult> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let thread_id = normalize_required_text(&request.thread_id, "threadId")?;
    let thread = registry_db::read_agent_thread(&storage_root, &thread_id)?
        .ok_or_else(|| agent_error(AGENT_TURN_FAILED, format!("thread not found: {thread_id}")))?;
    if thread.lifecycle_state == AgentThreadLifecycleState::Archived {
        return Err(agent_error(
            AGENT_TURN_FAILED,
            format!("thread is archived: {thread_id}"),
        ));
    }
    send_turn(AgentSendTurnRequest {
        storage_root,
        session_id: thread.session_id,
        input: request.input,
        profile_id: request.profile_id,
        model: request.model,
        project_root: request.project_root,
        max_steps: request.max_steps,
        enable_planning: request.enable_planning,
        planning_min_chars: request.planning_min_chars,
        enable_reflection: request.enable_reflection,
        reflection_min_tool_calls: request.reflection_min_tool_calls,
        enable_context_collapse: request.enable_context_collapse,
        strategy_preset: request.strategy_preset,
        request_user_input_enabled: request.request_user_input_enabled,
        ui_style_profile: request.ui_style_profile,
        ui_style_plugin: request.ui_style_plugin,
        ui_style_user: request.ui_style_user,
        ui_style_project: request.ui_style_project,
    })
}

fn build_execution_conflict_pause_result(
    storage_root: &str,
    session: &crate::agent::types::AgentSession,
    thread_id: &str,
    pending_execution_id: &str,
    pending_turn_id: Option<&str>,
    pending_interaction_id: Option<&str>,
    input: &str,
) -> Result<AgentSendTurnResult> {
    let profile_id = session
        .profile_id
        .clone()
        .unwrap_or_else(|| "system".to_string());
    let running_turn = registry_db::create_agent_turn(storage_root, &session.id, &profile_id)?;
    let request_id = format!("execution-conflict-{}", Uuid::new_v4());
    let interaction = create_pending_interaction(
        storage_root,
        &session.id,
        &running_turn.id,
        &request_id,
        AgentPendingInteractionKind::UserQuestion,
        json!({
            "requestId": request_id,
            "toolCallId": request_id,
            "toolName": "execution_conflict",
            "questions": [{
                "id": "execution_conflict_resolution",
                "header": "执行冲突",
                "question": "当前线程有未完成执行。请选择继续恢复旧执行，或放弃旧执行并开始新的请求。",
                "options": [
                    {
                        "label": "继续恢复旧执行",
                        "description": "先恢复并完成当前挂起执行。",
                        "preview": "continue_previous_execution"
                    },
                    {
                        "label": "放弃旧执行并开始新执行",
                        "description": "中止当前挂起执行，直接处理新输入。",
                        "preview": "abandon_and_start_new"
                    }
                ]
            }],
            "allowNote": false,
            "conflict": {
                "executionId": pending_execution_id,
                "threadId": thread_id,
                "pendingTurnId": pending_turn_id,
                "pendingInteractionId": pending_interaction_id,
                "pendingInput": input,
            }
        }),
    )?;
    emit_interaction_pending_event(storage_root, &interaction)?;
    emit_interaction_queue_updated(storage_root, &session.id, &running_turn.id)?;
    emit_event(
        storage_root,
        &session.id,
        &running_turn.id,
        "execution_conflict_prompted",
        json!({
            "executionId": pending_execution_id,
            "threadId": thread_id,
            "requestId": interaction.id,
            "pendingTurnId": pending_turn_id,
            "pendingInteractionId": pending_interaction_id,
        }),
    )?;
    let assistant_text = "当前有一个挂起执行等待交互确认。我已暂停这次新请求，请先选择处理冲突。";
    let assistant_message = registry_db::append_agent_message(
        storage_root,
        &session.id,
        Some(running_turn.id.clone()),
        "assistant",
        assistant_text,
    )?;
    let paused_turn = registry_db::pause_agent_turn(
        storage_root,
        &running_turn.id,
        "AGENT_EXECUTION_CONFLICT",
        "existing execution is waiting for interaction",
        None,
    )?;
    Ok(AgentSendTurnResult {
        session: session.clone(),
        turn: paused_turn,
        assistant_message: Some(assistant_message),
        tool_calls: Vec::new(),
        usage: None,
    })
}

fn extract_runtime_optimization_state_from_payload(payload: &Value) -> Option<Value> {
    payload
        .get("runtimeOptimizationState")
        .cloned()
        .filter(|value| value.is_object())
}

fn with_runtime_optimization_state(
    mut payload: Value,
    runtime_optimization_state: Option<Value>,
) -> Value {
    if let Some(runtime_optimization_state) = runtime_optimization_state {
        if let Some(object) = payload.as_object_mut() {
            object.insert(
                "runtimeOptimizationState".to_string(),
                runtime_optimization_state,
            );
        }
    }
    payload
}

fn resolve_resume_optimization_state_payload(
    storage_root: &str,
    latest_checkpoint_id: Option<&str>,
) -> Result<Option<Value>> {
    let Some(latest_checkpoint_id) = latest_checkpoint_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let Some(checkpoint) =
        registry_db::read_agent_execution_checkpoint(storage_root, latest_checkpoint_id)?
    else {
        return Ok(None);
    };
    if checkpoint.kind != AgentExecutionCheckpointKind::ManualResumeAnchor {
        return Ok(None);
    }
    if let Some(payload) =
        extract_runtime_optimization_state_from_payload(&checkpoint.continuation_payload_json)
    {
        return Ok(Some(payload));
    }
    let origin_checkpoint_id = checkpoint
        .continuation_payload_json
        .get("resumeFromCheckpointId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(origin_checkpoint_id) = origin_checkpoint_id else {
        return Ok(None);
    };
    let Some(origin_checkpoint) =
        registry_db::read_agent_execution_checkpoint(storage_root, origin_checkpoint_id)?
    else {
        return Ok(None);
    };
    Ok(extract_runtime_optimization_state_from_payload(
        &origin_checkpoint.continuation_payload_json,
    ))
}

pub fn send_turn(request: AgentSendTurnRequest) -> Result<AgentSendTurnResult> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let input = normalize_required_text(&request.input, "input")?;
    initialize_session_storage(&storage_root, &session_id)?;
    let session =
        registry_db::read_agent_session(&storage_root, &session_id)?.ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    let session_thread = registry_db::ensure_agent_thread_for_session(&storage_root, &session_id)?;
    if session_thread.lifecycle_state == AgentThreadLifecycleState::Archived {
        return Err(agent_error(
            AGENT_TURN_FAILED,
            format!("thread is archived: {}", session_thread.id),
        ));
    }
    let execution_state = ensure_execution_state(
        &storage_root,
        &session_id,
        &session_thread.id,
        &session.collaboration_mode,
    )?;
    let resume_optimization_state_payload = resolve_resume_optimization_state_payload(
        &storage_root,
        execution_state.latest_checkpoint_id.as_deref(),
    )?;
    if matches!(
        execution_state.phase,
        AgentExecutionPhase::WaitingInteraction | AgentExecutionPhase::Resumable
    ) {
        return build_execution_conflict_pause_result(
            &storage_root,
            &session,
            &session_thread.id,
            &execution_state.id,
            execution_state.active_turn_id.as_deref(),
            execution_state.waiting_interaction_id.as_deref(),
            &input,
        );
    }
    if session.collaboration_mode == AgentCollaborationMode::Plan {
        let plan_outcome = execute_plan_turn(request, resume_optimization_state_payload.clone())?;
        let plan_runtime_optimization_state = plan_outcome.optimization_state.clone();
        let plan_result = plan_outcome.result;
        transition_execution_state(ExecutionTransitionRequest {
            storage_root: storage_root.clone(),
            session_id: session_id.clone(),
            thread_id: session_thread.id.clone(),
            collaboration_mode: AgentCollaborationMode::Plan,
            event_turn_id: plan_result.turn.id.clone(),
            to_phase: AgentExecutionPhase::Running,
            active_turn_id: Some(plan_result.turn.id.clone()),
            waiting_interaction_id: None,
            waiting_interaction_kind: None,
            checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnStarted),
            continuation_payload: json!({
                "continuationInput": input.clone(),
                "source": "plan_turn_started",
                "threadId": session_thread.id.clone(),
                "turnId": plan_result.turn.id.clone(),
            }),
            goal_tree_json: None,
            active_goal_node_id: None,
        })?;
        let pending_after_plan =
            registry_db::list_agent_pending_interactions(&storage_root, &session_id)?;
        if plan_result.turn.status == "paused" && !pending_after_plan.is_empty() {
            let waiting = pending_after_plan
                .iter()
                .find(|interaction| interaction.status == AgentPendingInteractionStatus::Pending)
                .cloned();
            transition_execution_state(ExecutionTransitionRequest {
                storage_root: storage_root.clone(),
                session_id: session_id.clone(),
                thread_id: session_thread.id.clone(),
                collaboration_mode: AgentCollaborationMode::Plan,
                event_turn_id: plan_result.turn.id.clone(),
                to_phase: AgentExecutionPhase::WaitingInteraction,
                active_turn_id: Some(plan_result.turn.id.clone()),
                waiting_interaction_id: waiting.as_ref().map(|entry| entry.id.clone()),
                waiting_interaction_kind: waiting.as_ref().map(|entry| entry.kind.clone()),
                checkpoint_kind: Some(AgentExecutionCheckpointKind::InteractionWait),
                continuation_payload: with_runtime_optimization_state(
                    json!({
                        "continuationInput": input.clone(),
                        "pausedTurnId": plan_result.turn.id.clone(),
                    }),
                    plan_runtime_optimization_state,
                ),
                goal_tree_json: None,
                active_goal_node_id: None,
            })?;
        } else if plan_result.turn.status == "completed" {
            transition_execution_state(ExecutionTransitionRequest {
                storage_root: storage_root.clone(),
                session_id: session_id.clone(),
                thread_id: session_thread.id.clone(),
                collaboration_mode: AgentCollaborationMode::Plan,
                event_turn_id: plan_result.turn.id.clone(),
                to_phase: AgentExecutionPhase::Completed,
                active_turn_id: Some(plan_result.turn.id.clone()),
                waiting_interaction_id: None,
                waiting_interaction_kind: None,
                checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnCompleted),
                continuation_payload: json!({
                    "completedTurnId": plan_result.turn.id.clone(),
                }),
                goal_tree_json: None,
                active_goal_node_id: None,
            })?;
        } else if plan_result.turn.status == "failed" {
            transition_execution_state(ExecutionTransitionRequest {
                storage_root: storage_root.clone(),
                session_id: session_id.clone(),
                thread_id: session_thread.id.clone(),
                collaboration_mode: AgentCollaborationMode::Plan,
                event_turn_id: plan_result.turn.id.clone(),
                to_phase: AgentExecutionPhase::Failed,
                active_turn_id: Some(plan_result.turn.id.clone()),
                waiting_interaction_id: None,
                waiting_interaction_kind: None,
                checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnFailed),
                continuation_payload: json!({
                    "failedTurnId": plan_result.turn.id.clone(),
                    "errorCode": plan_result.turn.error_code.clone(),
                    "errorMessage": plan_result.turn.error_message.clone(),
                }),
                goal_tree_json: None,
                active_goal_node_id: None,
            })?;
        }
        return Ok(plan_result);
    }

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
    let requested_model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let profile = resolve_profile_for_turn_with_model(
        &storage_root,
        &session,
        requested_profile_id,
        requested_model,
    )?;

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
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "thread_bound",
        json!({
            "threadId": session_thread.id,
            "lifecycleState": session_thread.lifecycle_state,
            "elicitationCounter": session_thread.elicitation_counter,
        }),
    )?;
    if let Some(mut execution_state) =
        registry_db::read_agent_execution_state_by_session(&storage_root, &session_id)?
    {
        if matches!(
            execution_state.phase,
            AgentExecutionPhase::Completed
                | AgentExecutionPhase::Failed
                | AgentExecutionPhase::Abandoned
        ) {
            execution_state.phase = AgentExecutionPhase::Idle;
            execution_state.run_id = format!("agent-run-{}", Uuid::new_v4());
            execution_state.active_turn_id = None;
            execution_state.waiting_interaction_id = None;
            execution_state.waiting_interaction_kind = None;
            execution_state.latest_checkpoint_id = None;
            execution_state.version += 1;
            execution_state.updated_at = now_ms();
            execution_state =
                registry_db::upsert_agent_execution_state(&storage_root, &execution_state)?;
            emit_event(
                &storage_root,
                &session_id,
                &running_turn.id,
                "execution_state_transition",
                json!({
                    "executionId": execution_state.id,
                    "threadId": execution_state.thread_id,
                    "from": "terminal",
                    "to": "idle",
                    "version": execution_state.version,
                }),
            )?;
        }
    }
    transition_execution_state(ExecutionTransitionRequest {
        storage_root: storage_root.clone(),
        session_id: session_id.clone(),
        thread_id: session_thread.id.clone(),
        collaboration_mode: session.collaboration_mode.clone(),
        event_turn_id: running_turn.id.clone(),
        to_phase: AgentExecutionPhase::Running,
        active_turn_id: Some(running_turn.id.clone()),
        waiting_interaction_id: None,
        waiting_interaction_kind: None,
        checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnStarted),
        continuation_payload: json!({
            "continuationInput": input.clone(),
            "source": "turn_started",
            "threadId": session_thread.id.clone(),
            "turnId": running_turn.id.clone(),
        }),
        goal_tree_json: None,
        active_goal_node_id: None,
    })?;

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
        readonly_tool_definitions_for_input_with_context(&input, Some(&tool_ranking_context));
    let turn_strategy = select_turn_strategy_with_options(
        &input,
        TurnStrategySelectionOptions {
            strategy_preset: request.strategy_preset.as_deref(),
            collaboration_mode: Some(collaboration_mode_label(&session.collaboration_mode)),
            request_user_input_enabled: request.request_user_input_enabled,
        },
    );
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
    let ui_prompt_context = derive_ui_prompt_context_with_layers(
        &input,
        effective_project_root.as_deref(),
        UiStyleContextLayers {
            plugin_style: request.ui_style_plugin.as_deref(),
            user_style: request.ui_style_user.as_deref(),
            project_style: request.ui_style_project.as_deref(),
            requested_profile: request.ui_style_profile.as_deref(),
        },
    );
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "ui_style_context_selected",
        json!({
            "styleProfile": ui_prompt_context.style_profile.prompt_label(),
            "styleSource": ui_prompt_context.style_profile_source,
            "styleLayerPrecedence": ui_prompt_context.style_layer_precedence,
            "styleLayerTrace": ui_prompt_context.style_layer_trace,
            "styleConflictResolution": ui_prompt_context.style_conflict_resolution,
            "targetSurface": ui_prompt_context.target_surface,
            "stackPolicy": ui_prompt_context.stack_policy.prompt_label(),
        }),
    )?;
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
        ui_style_profile: request.ui_style_profile.as_deref(),
        ui_style_plugin: request.ui_style_plugin.as_deref(),
        ui_style_user: request.ui_style_user.as_deref(),
        ui_style_project: request.ui_style_project.as_deref(),
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
    if let Some(execution_state) =
        registry_db::read_agent_execution_state_by_session(&storage_root, &session_id)?
    {
        let latest_checkpoint_summary =
            registry_db::list_agent_execution_checkpoints(&storage_root, &session_id, 1)?
                .into_iter()
                .next();
        let execution_context = json!({
            "phase": execution_state.phase,
            "activeGoalNodeId": execution_state.active_goal_node_id,
            "waitingInteractionId": execution_state.waiting_interaction_id,
            "latestCheckpoint": latest_checkpoint_summary,
            "goalTree": execution_state.goal_tree_json,
        });
        provider_messages.push(AgentInferenceMessage {
            role: AgentInferenceMessageRole::User,
            content: format!(
                "[Execution State Summary]\n{}",
                serde_json::to_string_pretty(&execution_context)
                    .unwrap_or_else(|_| "{}".to_string())
            ),
            tool_call_id: None,
            tool_calls: Vec::new(),
        });
    }
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
    let running_turn_id = running_turn.id.clone();
    let input_for_resume = input.clone();
    let storage_root_for_thread = storage_root.clone();
    let session_id_for_thread = session_id.clone();
    let thread_id_for_execution = session_thread.id.clone();
    let runtime_outcome = execute_default_turn_runtime(DefaultTurnRuntimeParams {
        storage_root,
        session_id,
        request,
        running_turn,
        session,
        input,
        profile,
        secrets,
        system_message,
        provider_messages,
        effective_project_root,
        turn_strategy,
        explicit_max_steps,
        effective_max_steps,
        effective_planning,
        effective_reflection,
        terminal_policy,
        tools,
        resume_optimization_state_payload,
    })?;
    let runtime_optimization_state = runtime_outcome.optimization_state.clone();
    let result = runtime_outcome.result;
    bump_thread_elicitation_counter_if_waiting(
        &storage_root_for_thread,
        &result.session.id,
        &running_turn_id,
    )?;
    let pending_interactions =
        registry_db::list_agent_pending_interactions(&storage_root_for_thread, &result.session.id)?;
    if result.turn.status == "paused" && !pending_interactions.is_empty() {
        let waiting = pending_interactions
            .iter()
            .find(|interaction| interaction.status == AgentPendingInteractionStatus::Pending)
            .cloned();
        let waiting_id = waiting.as_ref().map(|interaction| interaction.id.clone());
        let waiting_kind = waiting.as_ref().map(|interaction| interaction.kind.clone());
        transition_execution_state(ExecutionTransitionRequest {
            storage_root: storage_root_for_thread.clone(),
            session_id: session_id_for_thread.clone(),
            thread_id: thread_id_for_execution.clone(),
            collaboration_mode: result.session.collaboration_mode.clone(),
            event_turn_id: result.turn.id.clone(),
            to_phase: AgentExecutionPhase::WaitingInteraction,
            active_turn_id: Some(result.turn.id.clone()),
            waiting_interaction_id: waiting_id,
            waiting_interaction_kind: waiting_kind,
            checkpoint_kind: Some(AgentExecutionCheckpointKind::InteractionWait),
            continuation_payload: with_runtime_optimization_state(
                json!({
                    "continuationInput": input_for_resume,
                    "pausedTurnId": result.turn.id.clone(),
                }),
                runtime_optimization_state,
            ),
            goal_tree_json: None,
            active_goal_node_id: None,
        })?;
    } else if result.turn.status == "completed" {
        transition_execution_state(ExecutionTransitionRequest {
            storage_root: storage_root_for_thread.clone(),
            session_id: session_id_for_thread.clone(),
            thread_id: thread_id_for_execution.clone(),
            collaboration_mode: result.session.collaboration_mode.clone(),
            event_turn_id: result.turn.id.clone(),
            to_phase: AgentExecutionPhase::Completed,
            active_turn_id: Some(result.turn.id.clone()),
            waiting_interaction_id: None,
            waiting_interaction_kind: None,
            checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnCompleted),
            continuation_payload: json!({
                "completedTurnId": result.turn.id.clone(),
            }),
            goal_tree_json: None,
            active_goal_node_id: None,
        })?;
    } else if result.turn.status == "failed" {
        transition_execution_state(ExecutionTransitionRequest {
            storage_root: storage_root_for_thread.clone(),
            session_id: session_id_for_thread.clone(),
            thread_id: thread_id_for_execution.clone(),
            collaboration_mode: result.session.collaboration_mode.clone(),
            event_turn_id: result.turn.id.clone(),
            to_phase: AgentExecutionPhase::Failed,
            active_turn_id: Some(result.turn.id.clone()),
            waiting_interaction_id: None,
            waiting_interaction_kind: None,
            checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnFailed),
            continuation_payload: json!({
                "failedTurnId": result.turn.id.clone(),
                "errorCode": result.turn.error_code.clone(),
                "errorMessage": result.turn.error_message.clone(),
            }),
            goal_tree_json: None,
            active_goal_node_id: None,
        })?;
    }
    Ok(result)
}

fn bump_thread_elicitation_counter_if_waiting(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<()> {
    let pending = registry_db::list_agent_pending_interactions(storage_root, session_id)?;
    let waiting_count = pending
        .iter()
        .filter(|interaction| interaction.status == AgentPendingInteractionStatus::Pending)
        .count();
    if waiting_count == 0 {
        return Ok(());
    }
    let Some(thread) = registry_db::read_agent_thread_by_session(storage_root, session_id)? else {
        return Ok(());
    };
    let updated = registry_db::bump_agent_thread_elicitation_counter(storage_root, &thread.id, 1)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "thread_elicitation_counter_updated",
        json!({
            "threadId": updated.id,
            "elicitationCounter": updated.elicitation_counter,
            "pendingInteractions": waiting_count,
        }),
    )
}

fn detect_conflict_resolution(answers: &Value) -> Option<&'static str> {
    let object = answers.as_object()?;
    let choice_value = object.get("execution_conflict_resolution")?;
    let preview = choice_value
        .as_object()
        .and_then(|entry| entry.get("preview"))
        .and_then(Value::as_str)?;
    match preview {
        "continue_previous_execution" => Some("continue_previous_execution"),
        "abandon_and_start_new" => Some("abandon_and_start_new"),
        _ => None,
    }
}

fn mark_execution_resumable_after_interaction(
    storage_root: &str,
    session_id: &str,
    interaction_id: &str,
    interaction_kind: AgentPendingInteractionKind,
    turn_id: &str,
) -> Result<()> {
    let Some(session) = registry_db::read_agent_session(storage_root, session_id)? else {
        return Ok(());
    };
    let Some(thread) = registry_db::read_agent_thread_by_session(storage_root, session_id)? else {
        return Ok(());
    };
    let Some(execution) =
        registry_db::read_agent_execution_state_by_session(storage_root, session_id)?
    else {
        return Ok(());
    };
    if execution.phase != AgentExecutionPhase::WaitingInteraction {
        return Ok(());
    }
    let latest_checkpoint = if let Some(checkpoint_id) = execution
        .latest_checkpoint_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        registry_db::read_agent_execution_checkpoint(storage_root, checkpoint_id)?
    } else {
        None
    };
    let continuation_input = latest_checkpoint
        .as_ref()
        .and_then(|checkpoint| {
            checkpoint
                .continuation_payload_json
                .get("continuationInput")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "请继续上一个被暂停的执行。".to_string());
    let runtime_optimization_state = latest_checkpoint.as_ref().and_then(|checkpoint| {
        extract_runtime_optimization_state_from_payload(&checkpoint.continuation_payload_json)
    });
    transition_execution_state(ExecutionTransitionRequest {
        storage_root: storage_root.to_string(),
        session_id: session_id.to_string(),
        thread_id: thread.id,
        collaboration_mode: session.collaboration_mode,
        event_turn_id: turn_id.to_string(),
        to_phase: AgentExecutionPhase::Resumable,
        active_turn_id: execution.active_turn_id.clone(),
        waiting_interaction_id: None,
        waiting_interaction_kind: None,
        checkpoint_kind: Some(AgentExecutionCheckpointKind::InteractionResolved),
        continuation_payload: with_runtime_optimization_state(
            json!({
                "interactionId": interaction_id,
                "interactionKind": interaction_kind,
                "continuationInput": continuation_input,
            }),
            runtime_optimization_state,
        ),
        goal_tree_json: None,
        active_goal_node_id: None,
    })?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "execution_resume_triggered",
        json!({
            "interactionId": interaction_id,
            "interactionKind": interaction_kind,
            "mode": "auto",
        }),
    )?;
    Ok(())
}

pub fn resume_execution(
    request: AgentResumeExecutionRequest,
) -> Result<Option<AgentSendTurnResult>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let Some(session) = registry_db::read_agent_session(&storage_root, &session_id)? else {
        return Ok(None);
    };
    let Some(thread) = registry_db::read_agent_thread_by_session(&storage_root, &session_id)?
    else {
        return Ok(None);
    };
    let Some(execution) =
        registry_db::read_agent_execution_state_by_session(&storage_root, &session_id)?
    else {
        return Ok(None);
    };
    let checkpoint = if let Some(checkpoint_id) = request
        .checkpoint_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        registry_db::read_agent_execution_checkpoint(&storage_root, checkpoint_id)?
    } else {
        registry_db::list_agent_execution_checkpoints_by_execution(
            &storage_root,
            &execution.id,
            40,
        )?
        .into_iter()
        .find(|entry| {
            entry.phase_after == AgentExecutionPhase::Resumable
                || entry.kind == AgentExecutionCheckpointKind::InteractionResolved
                || entry.kind == AgentExecutionCheckpointKind::InteractionWait
        })
    };
    let Some(checkpoint) = checkpoint else {
        return Ok(None);
    };
    let continuation_input = checkpoint
        .continuation_payload_json
        .get("continuationInput")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "请继续上一个被暂停的执行。".to_string());
    let runtime_optimization_state =
        extract_runtime_optimization_state_from_payload(&checkpoint.continuation_payload_json);

    transition_execution_state(ExecutionTransitionRequest {
        storage_root: storage_root.clone(),
        session_id: session_id.clone(),
        thread_id: thread.id.clone(),
        collaboration_mode: session.collaboration_mode.clone(),
        event_turn_id: checkpoint.turn_id.clone(),
        to_phase: AgentExecutionPhase::Running,
        active_turn_id: execution.active_turn_id.clone(),
        waiting_interaction_id: None,
        waiting_interaction_kind: None,
        checkpoint_kind: Some(AgentExecutionCheckpointKind::ManualResumeAnchor),
        continuation_payload: with_runtime_optimization_state(
            json!({
                "resumeFromCheckpointId": checkpoint.id,
                "continuationInput": continuation_input,
            }),
            runtime_optimization_state,
        ),
        goal_tree_json: Some(checkpoint.goal_snapshot_json.clone()),
        active_goal_node_id: execution.active_goal_node_id.clone(),
    })?;

    emit_event(
        &storage_root,
        &session_id,
        &checkpoint.turn_id,
        "execution_resume_triggered",
        json!({
            "executionId": execution.id,
            "checkpointId": checkpoint.id,
            "mode": if request.checkpoint_id.is_some() { "manual" } else { "auto" },
        }),
    )?;

    send_turn(AgentSendTurnRequest {
        storage_root,
        session_id,
        input: continuation_input,
        profile_id: session.profile_id.clone(),
        model: None,
        project_root: session.project_root.clone(),
        max_steps: None,
        enable_planning: true,
        planning_min_chars: None,
        enable_reflection: true,
        reflection_min_tool_calls: None,
        enable_context_collapse: Some(true),
        strategy_preset: None,
        request_user_input_enabled: None,
        ui_style_profile: None,
        ui_style_plugin: None,
        ui_style_user: None,
        ui_style_project: None,
    })
    .map(Some)
}

pub fn answer_question(request: AgentAnswerQuestionRequest) -> Result<Option<AgentSendTurnResult>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let request_id = normalize_required_text(&request.request_id, "requestId")?;
    let interaction = registry_db::read_agent_pending_interaction(&storage_root, &request_id)?;
    let answers = request.answers.clone();
    crate::agent::session_management::answer_question(request)?;

    let Some(interaction) = interaction else {
        return Ok(None);
    };

    if interaction.kind == AgentPendingInteractionKind::UserQuestion {
        let is_execution_conflict = interaction
            .payload
            .get("conflict")
            .and_then(Value::as_object)
            .is_some();
        if is_execution_conflict {
            match detect_conflict_resolution(&answers) {
                Some("abandon_and_start_new") => {
                    let pending_input = interaction
                        .payload
                        .get("conflict")
                        .and_then(Value::as_object)
                        .and_then(|entry| entry.get("pendingInput"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_default();
                    if let (Some(session), Some(thread), Some(execution)) = (
                        registry_db::read_agent_session(&storage_root, &session_id)?,
                        registry_db::read_agent_thread_by_session(&storage_root, &session_id)?,
                        registry_db::read_agent_execution_state_by_session(
                            &storage_root,
                            &session_id,
                        )?,
                    ) {
                        transition_execution_state(ExecutionTransitionRequest {
                            storage_root: storage_root.clone(),
                            session_id: session_id.clone(),
                            thread_id: thread.id,
                            collaboration_mode: session.collaboration_mode,
                            event_turn_id: turn_id.clone(),
                            to_phase: AgentExecutionPhase::Abandoned,
                            active_turn_id: execution.active_turn_id,
                            waiting_interaction_id: None,
                            waiting_interaction_kind: None,
                            checkpoint_kind: Some(AgentExecutionCheckpointKind::TurnFailed),
                            continuation_payload: json!({
                                "abandonReason": "user_selected_abandon_and_start_new",
                                "interactionId": interaction.id,
                            }),
                            goal_tree_json: None,
                            active_goal_node_id: execution.active_goal_node_id,
                        })?;
                    }
                    emit_event(
                        &storage_root,
                        &session_id,
                        &turn_id,
                        "execution_abandoned",
                        json!({
                            "interactionId": interaction.id,
                            "reason": "user_selected_abandon_and_start_new",
                        }),
                    )?;
                    if pending_input.trim().is_empty() {
                        return Ok(None);
                    }
                    return send_turn(AgentSendTurnRequest {
                        storage_root: storage_root.clone(),
                        session_id: session_id.clone(),
                        input: pending_input,
                        profile_id: None,
                        model: None,
                        project_root: None,
                        max_steps: None,
                        enable_planning: true,
                        planning_min_chars: None,
                        enable_reflection: true,
                        reflection_min_tool_calls: None,
                        enable_context_collapse: Some(true),
                        strategy_preset: None,
                        request_user_input_enabled: None,
                        ui_style_profile: None,
                        ui_style_plugin: None,
                        ui_style_user: None,
                        ui_style_project: None,
                    })
                    .map(Some);
                }
                _ => {
                    mark_execution_resumable_after_interaction(
                        &storage_root,
                        &session_id,
                        &interaction.id,
                        interaction.kind,
                        &turn_id,
                    )?;
                    return resume_execution(AgentResumeExecutionRequest {
                        storage_root,
                        session_id,
                        checkpoint_id: None,
                    });
                }
            }
        }
    }

    mark_execution_resumable_after_interaction(
        &storage_root,
        &session_id,
        &interaction.id,
        interaction.kind,
        &turn_id,
    )?;
    resume_execution(AgentResumeExecutionRequest {
        storage_root,
        session_id,
        checkpoint_id: None,
    })
}

pub fn answer_plan_question(
    request: AgentAnswerPlanQuestionRequest,
) -> Result<Option<AgentSendTurnResult>> {
    answer_question(request)
}

/// Submit a user approval decision for a pending command execution.
/// Called from the NAPI layer when the user responds to a command approval request.
pub fn submit_command_approval(
    request: CommandApprovalSubmitRequest,
) -> Result<Option<AgentSendTurnResult>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let tool_call_id = normalize_required_text(&request.tool_call_id, "toolCallId")?;
    submit_command_approval_decision(request)?;
    mark_execution_resumable_after_interaction(
        &storage_root,
        &session_id,
        &tool_call_id,
        AgentPendingInteractionKind::CommandApproval,
        &turn_id,
    )?;
    resume_execution(AgentResumeExecutionRequest {
        storage_root,
        session_id,
        checkpoint_id: None,
    })
}
