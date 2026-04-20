use std::path::PathBuf;

use napi::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::agent::interaction_manager::{
    create_pending_interaction, list_pending_interactions, resolve_pending_interaction,
};
use crate::agent::project_scope::project_name_from_root;
use crate::agent::runtime_events::{
    emit_event, emit_interaction_pending_event, emit_interaction_queue_updated,
    emit_interaction_resolved_event, emit_transient_event,
};
use crate::agent::types::{
    AgentAnswerPlanQuestionRequest, AgentAnswerQuestionRequest, AgentBindSessionProjectRequest,
    AgentCollaborationMode, AgentCreateSessionRequest, AgentDeleteSessionRequest,
    AgentEnterPlanModeRequest, AgentGetPendingInteractionsRequest, AgentGetPlanRequest,
    AgentGetSessionRequest, AgentListSessionsRequest, AgentPendingInteraction,
    AgentPendingInteractionKind, AgentPendingInteractionStatus, AgentPlanState, AgentPlanStatus,
    AgentSession, AgentSessionDetail, AGENT_TURN_FAILED,
};
use crate::error::{normalize_optional_text, normalize_required_text, now_ms, to_error};
use crate::memory::{delete_session_storage, initialize_session_storage};
use crate::storage::registry_db;

const AGENT_ERROR_PREFIX: &str = "AGENT_ERROR::";

fn agent_error(code: &str, message: impl Into<String>) -> napi::Error {
    to_error(format!("{AGENT_ERROR_PREFIX}{code}::{}", message.into()))
}

pub(crate) fn normalize_project_root(value: &str) -> Result<String> {
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
    let execution_state =
        registry_db::read_agent_execution_state_by_session(&storage_root, &session_id)?;
    let execution_checkpoints =
        registry_db::list_agent_execution_checkpoints(&storage_root, &session_id, 20)?;
    let pending_interactions = list_pending_interactions(&storage_root, &session_id)?;
    let turns = registry_db::list_agent_turns(&storage_root, &session_id)?;
    let messages = registry_db::list_agent_messages(&storage_root, &session_id)?;
    let tool_calls = registry_db::list_agent_tool_calls(&storage_root, &session_id)?;
    let runtime_events = registry_db::list_agent_runtime_events(&storage_root, &session_id)?;
    Ok(AgentSessionDetail {
        session,
        plan,
        execution_state,
        execution_checkpoints,
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

pub(crate) fn blank_plan_state() -> AgentPlanState {
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

pub(crate) fn ensure_plan_state(storage_root: &str, session_id: &str) -> Result<AgentPlanState> {
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
        "interaction_submitted",
        json!({
            "requestId": request_id,
            "interactionKind": "user_question",
        }),
    )?;
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

pub fn delete_session(request: AgentDeleteSessionRequest) -> Result<()> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    registry_db::delete_agent_session(&storage_root, &session_id)?;
    delete_session_storage(&storage_root, &session_id)
}

pub(crate) fn synthesize_plan_approval_from_assistant_message(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    assistant_message_content: &str,
    summary_fn: impl Fn(&str) -> String,
) -> Result<()> {
    let Some(proposed_markdown) =
        crate::agent::plan_helpers::proposed_plan_from_content(assistant_message_content)
    else {
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
    let summary = summary_fn(&proposed_markdown);
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
            "proposedMarkdown": interaction
                .payload
                .get("proposedMarkdown")
                .cloned()
                .unwrap_or(Value::String(String::new())),
            "draftMarkdown": interaction
                .payload
                .get("draftMarkdown")
                .cloned()
                .unwrap_or(Value::String(String::new())),
            "source": "assistant_proposed_plan",
        }),
    )?;
    emit_interaction_queue_updated(storage_root, session_id, turn_id)
}
