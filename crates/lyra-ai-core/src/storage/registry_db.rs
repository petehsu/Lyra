use napi::Result;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::agent::types::{
    AgentCollaborationMode, AgentExecutionCheckpoint, AgentExecutionCheckpointKind,
    AgentExecutionCheckpointSummary, AgentExecutionPhase, AgentExecutionState, AgentMessage,
    AgentPendingInteraction, AgentPendingInteractionKind, AgentPendingInteractionStatus,
    AgentPlanState, AgentPlanStatus, AgentRuntimeEvent, AgentSession, AgentThread,
    AgentThreadLifecycleState, AgentToolCall, AgentTurn, AgentUsage,
};
use crate::error::{normalize_required_text, now_ms, parse_json, to_error, to_json};
use crate::paths::{ensure_ai_dirs, resolve_ai_paths};
use crate::profile::types::{
    AiModelDiscoveryResult, AiProviderModelEntry, AiProviderProfile, StoredAiProviderProfile,
};
use crate::storage::schema::{ensure_registry_schema, open_sqlite};

fn open_registry(storage_root: &str) -> Result<rusqlite::Connection> {
    let paths = resolve_ai_paths(storage_root)?;
    ensure_ai_dirs(&paths)?;
    let connection = open_sqlite(&paths.registry_db_path)?;
    ensure_registry_schema(&connection)?;
    Ok(connection)
}

fn map_json<T: serde::de::DeserializeOwned>(value: String, label: &str) -> rusqlite::Result<T> {
    parse_json::<T>(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid {label}: {error}"),
            )),
        )
    })
}

fn map_stored_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAiProviderProfile> {
    Ok(StoredAiProviderProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        provider_id: row.get(2)?,
        protocol_id: row.get(3)?,
        preset_id: row.get(4)?,
        connection_config: map_json(row.get(5)?, "connection config")?,
        auth_config: map_json(row.get(6)?, "auth config")?,
        secret_refs: map_json(row.get(7)?, "secret refs")?,
        headers: map_json(row.get(8)?, "headers")?,
        model: row.get(9)?,
        custom_models: map_json(row.get(10)?, "custom models")?,
        discovery_state: map_json(row.get(11)?, "discovery state")?,
        is_default: row.get::<_, i64>(12)? != 0,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

pub fn list_profiles(storage_root: &str) -> Result<Vec<AiProviderProfile>> {
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, name, provider_id, protocol_id, preset_id,
                    connection_config_json, auth_config_json, secret_refs_json,
                    headers_json, model, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             from profiles
             order by is_default desc, updated_at desc",
        )
        .map_err(|error| to_error(format!("failed to prepare profile query: {error}")))?;
    let rows = statement
        .query_map([], map_stored_profile)
        .map_err(|error| to_error(format!("failed to query ai profiles: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect ai profiles: {error}")))
        .map(|profiles| {
            profiles
                .into_iter()
                .map(|profile| profile.to_public())
                .collect()
        })
}

pub fn read_profile_record(
    storage_root: &str,
    id: &str,
) -> Result<Option<StoredAiProviderProfile>> {
    let normalized_id = normalize_required_text(id, "profile id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, name, provider_id, protocol_id, preset_id,
                    connection_config_json, auth_config_json, secret_refs_json,
                    headers_json, model, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             from profiles where id = ?1",
            params![normalized_id],
            map_stored_profile,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read ai profile: {error}")))
}

pub fn read_profile(storage_root: &str, id: &str) -> Result<Option<AiProviderProfile>> {
    read_profile_record(storage_root, id).map(|profile| profile.map(|entry| entry.to_public()))
}

pub fn write_profile(storage_root: &str, profile: &StoredAiProviderProfile) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into profiles(
               id, name, provider_id, protocol_id, preset_id,
               connection_config_json, auth_config_json, secret_refs_json,
               headers_json, model, custom_models_json, discovery_state_json,
               is_default, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             on conflict(id) do update set
               name = excluded.name,
               provider_id = excluded.provider_id,
               protocol_id = excluded.protocol_id,
               preset_id = excluded.preset_id,
               connection_config_json = excluded.connection_config_json,
               auth_config_json = excluded.auth_config_json,
               secret_refs_json = excluded.secret_refs_json,
               headers_json = excluded.headers_json,
               model = excluded.model,
               custom_models_json = excluded.custom_models_json,
               discovery_state_json = excluded.discovery_state_json,
               is_default = excluded.is_default,
               updated_at = excluded.updated_at",
            params![
                profile.id,
                profile.name,
                profile.provider_id,
                profile.protocol_id,
                profile.preset_id,
                to_json(&profile.connection_config)?,
                to_json(&profile.auth_config)?,
                to_json(&profile.secret_refs)?,
                to_json(&profile.headers)?,
                profile.model,
                to_json(&profile.custom_models)?,
                to_json(&profile.discovery_state)?,
                if profile.is_default { 1 } else { 0 },
                profile.created_at,
                profile.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to write ai profile: {error}")))?;
    upsert_model_discovery_cache(
        storage_root,
        &profile.id,
        &AiModelDiscoveryResult {
            provider_id: profile.provider_id.clone(),
            protocol_id: profile.protocol_id.clone(),
            status: profile.discovery_state.status.clone(),
            message: profile
                .discovery_state
                .error_message
                .clone()
                .unwrap_or_else(|| "profile discovery state".to_string()),
            checked_at: profile
                .discovery_state
                .last_checked_at
                .unwrap_or(profile.updated_at),
            models: profile.discovery_state.models.clone(),
        },
    )?;
    Ok(())
}

pub fn delete_profile(storage_root: &str, id: &str) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "delete from model_discovery_cache where profile_id = ?1",
            params![id],
        )
        .map_err(|error| to_error(format!("failed to delete ai discovery cache: {error}")))?;
    connection
        .execute("delete from profiles where id = ?1", params![id])
        .map_err(|error| to_error(format!("failed to delete ai profile: {error}")))?;
    Ok(())
}

pub fn set_default_profile(storage_root: &str, id: &str) -> Result<AiProviderProfile> {
    let connection = open_registry(storage_root)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| to_error(format!("failed to open ai profile transaction: {error}")))?;
    transaction
        .execute("update profiles set is_default = 0", [])
        .map_err(|error| to_error(format!("failed to clear default ai profile: {error}")))?;
    let updated = transaction
        .execute(
            "update profiles set is_default = 1, updated_at = ?2 where id = ?1",
            params![id, now_ms()],
        )
        .map_err(|error| to_error(format!("failed to set default ai profile: {error}")))?;
    if updated == 0 {
        return Err(to_error("ai profile not found"));
    }
    transaction.commit().map_err(|error| {
        to_error(format!(
            "failed to commit ai profile default update: {error}"
        ))
    })?;
    read_profile(storage_root, id)?.ok_or_else(|| to_error("ai profile not found"))
}

pub fn upsert_model_discovery_cache(
    storage_root: &str,
    profile_id: &str,
    discovery: &AiModelDiscoveryResult,
) -> Result<()> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into model_discovery_cache(
               profile_id, provider_id, protocol_id, status, message, checked_at, models_json
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             on conflict(profile_id) do update set
               provider_id = excluded.provider_id,
               protocol_id = excluded.protocol_id,
               status = excluded.status,
               message = excluded.message,
               checked_at = excluded.checked_at,
               models_json = excluded.models_json",
            params![
                profile_id,
                discovery.provider_id,
                discovery.protocol_id,
                discovery.status,
                discovery.message,
                discovery.checked_at,
                to_json(&discovery.models)?,
            ],
        )
        .map_err(|error| to_error(format!("failed to write ai discovery cache: {error}")))?;
    Ok(())
}

pub fn read_model_discovery_cache(
    storage_root: &str,
    profile_id: &str,
) -> Result<Option<AiModelDiscoveryResult>> {
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select provider_id, protocol_id, status, message, checked_at, models_json
             from model_discovery_cache where profile_id = ?1",
            params![profile_id],
            |row| {
                Ok(AiModelDiscoveryResult {
                    provider_id: row.get(0)?,
                    protocol_id: row.get(1)?,
                    status: row.get(2)?,
                    message: row.get(3)?,
                    checked_at: row.get(4)?,
                    models: map_json::<Vec<AiProviderModelEntry>>(row.get(5)?, "cached models")?,
                })
            },
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read ai discovery cache: {error}")))
}

fn map_agent_usage(value: Option<String>) -> rusqlite::Result<Option<AgentUsage>> {
    value
        .map(|entry| map_json::<AgentUsage>(entry, "agent usage"))
        .transpose()
}

fn parse_collaboration_mode(value: String) -> AgentCollaborationMode {
    match value.as_str() {
        "plan" => AgentCollaborationMode::Plan,
        _ => AgentCollaborationMode::Default,
    }
}

fn parse_plan_status(value: String) -> AgentPlanStatus {
    match value.as_str() {
        "submitted" => AgentPlanStatus::Submitted,
        "approved" => AgentPlanStatus::Approved,
        "rejected" => AgentPlanStatus::Rejected,
        _ => AgentPlanStatus::Draft,
    }
}

fn collaboration_mode_as_str(mode: &AgentCollaborationMode) -> &'static str {
    match mode {
        AgentCollaborationMode::Default => "default",
        AgentCollaborationMode::Plan => "plan",
    }
}

fn parse_thread_lifecycle_state(value: String) -> AgentThreadLifecycleState {
    match value.as_str() {
        "archived" => AgentThreadLifecycleState::Archived,
        _ => AgentThreadLifecycleState::Active,
    }
}

fn thread_lifecycle_state_as_str(state: &AgentThreadLifecycleState) -> &'static str {
    match state {
        AgentThreadLifecycleState::Active => "active",
        AgentThreadLifecycleState::Archived => "archived",
    }
}

fn parse_pending_interaction_kind(value: String) -> AgentPendingInteractionKind {
    match value.as_str() {
        "command_approval" => AgentPendingInteractionKind::CommandApproval,
        "plan_approval" => AgentPendingInteractionKind::PlanApproval,
        _ => AgentPendingInteractionKind::UserQuestion,
    }
}

fn pending_interaction_kind_as_str(kind: &AgentPendingInteractionKind) -> &'static str {
    match kind {
        AgentPendingInteractionKind::CommandApproval => "command_approval",
        AgentPendingInteractionKind::UserQuestion => "user_question",
        AgentPendingInteractionKind::PlanApproval => "plan_approval",
    }
}

fn parse_pending_interaction_status(value: String) -> AgentPendingInteractionStatus {
    match value.as_str() {
        "resolved" => AgentPendingInteractionStatus::Resolved,
        "cancelled" => AgentPendingInteractionStatus::Cancelled,
        "expired" => AgentPendingInteractionStatus::Expired,
        _ => AgentPendingInteractionStatus::Pending,
    }
}

fn pending_interaction_status_as_str(status: &AgentPendingInteractionStatus) -> &'static str {
    match status {
        AgentPendingInteractionStatus::Pending => "pending",
        AgentPendingInteractionStatus::Resolved => "resolved",
        AgentPendingInteractionStatus::Cancelled => "cancelled",
        AgentPendingInteractionStatus::Expired => "expired",
    }
}

fn parse_execution_phase(value: String) -> AgentExecutionPhase {
    match value.as_str() {
        "running" => AgentExecutionPhase::Running,
        "waiting_interaction" => AgentExecutionPhase::WaitingInteraction,
        "resumable" => AgentExecutionPhase::Resumable,
        "completed" => AgentExecutionPhase::Completed,
        "failed" => AgentExecutionPhase::Failed,
        "abandoned" => AgentExecutionPhase::Abandoned,
        _ => AgentExecutionPhase::Idle,
    }
}

fn execution_phase_as_str(phase: &AgentExecutionPhase) -> &'static str {
    match phase {
        AgentExecutionPhase::Idle => "idle",
        AgentExecutionPhase::Running => "running",
        AgentExecutionPhase::WaitingInteraction => "waiting_interaction",
        AgentExecutionPhase::Resumable => "resumable",
        AgentExecutionPhase::Completed => "completed",
        AgentExecutionPhase::Failed => "failed",
        AgentExecutionPhase::Abandoned => "abandoned",
    }
}

fn parse_execution_checkpoint_kind(value: String) -> AgentExecutionCheckpointKind {
    match value.as_str() {
        "interaction_wait" => AgentExecutionCheckpointKind::InteractionWait,
        "interaction_resolved" => AgentExecutionCheckpointKind::InteractionResolved,
        "turn_completed" => AgentExecutionCheckpointKind::TurnCompleted,
        "turn_failed" => AgentExecutionCheckpointKind::TurnFailed,
        "manual_resume_anchor" => AgentExecutionCheckpointKind::ManualResumeAnchor,
        _ => AgentExecutionCheckpointKind::TurnStarted,
    }
}

fn execution_checkpoint_kind_as_str(kind: &AgentExecutionCheckpointKind) -> &'static str {
    match kind {
        AgentExecutionCheckpointKind::TurnStarted => "turn_started",
        AgentExecutionCheckpointKind::InteractionWait => "interaction_wait",
        AgentExecutionCheckpointKind::InteractionResolved => "interaction_resolved",
        AgentExecutionCheckpointKind::TurnCompleted => "turn_completed",
        AgentExecutionCheckpointKind::TurnFailed => "turn_failed",
        AgentExecutionCheckpointKind::ManualResumeAnchor => "manual_resume_anchor",
    }
}

fn plan_status_as_str(status: &AgentPlanStatus) -> &'static str {
    match status {
        AgentPlanStatus::Draft => "draft",
        AgentPlanStatus::Submitted => "submitted",
        AgentPlanStatus::Approved => "approved",
        AgentPlanStatus::Rejected => "rejected",
    }
}

fn map_agent_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSession> {
    Ok(AgentSession {
        id: row.get(0)?,
        title: row.get(1)?,
        profile_id: row.get(2)?,
        project_root: row.get(3)?,
        project_name: row.get(4)?,
        collaboration_mode: parse_collaboration_mode(row.get(5)?),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_agent_plan(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentPlanState> {
    Ok(AgentPlanState {
        status: parse_plan_status(row.get(1)?),
        draft_markdown: row.get(2)?,
        proposed_markdown: row.get(3)?,
        approved_markdown: row.get(4)?,
        version: row.get(5)?,
        last_submitted_version: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_agent_thread(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentThread> {
    Ok(AgentThread {
        id: row.get(0)?,
        session_id: row.get(1)?,
        parent_thread_id: row.get(2)?,
        forked_from_turn_id: row.get(3)?,
        rollback_from_thread_id: row.get(4)?,
        rollback_from_turn_id: row.get(5)?,
        lifecycle_state: parse_thread_lifecycle_state(row.get(6)?),
        elicitation_counter: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn map_agent_turn(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentTurn> {
    Ok(AgentTurn {
        id: row.get(0)?,
        session_id: row.get(1)?,
        profile_id: row.get(2)?,
        status: row.get(3)?,
        error_code: row.get(4)?,
        error_message: row.get(5)?,
        usage: map_agent_usage(row.get(6)?)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_agent_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentMessage> {
    Ok(AgentMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        display_content: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn map_agent_tool_call(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentToolCall> {
    Ok(AgentToolCall {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        tool_name: row.get(3)?,
        input: map_json::<Value>(row.get(4)?, "agent tool input")?,
        output: row
            .get::<_, Option<String>>(5)?
            .map(|entry| map_json::<Value>(entry, "agent tool output"))
            .transpose()?,
        status: row.get(6)?,
        error_code: row.get(7)?,
        error_message: row.get(8)?,
        started_at: row.get(9)?,
        finished_at: row.get(10)?,
    })
}

fn map_agent_runtime_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRuntimeEvent> {
    Ok(AgentRuntimeEvent {
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        phase: row.get(3)?,
        payload: map_json::<Value>(row.get(4)?, "agent runtime event payload")?,
        timestamp: row.get(5)?,
    })
}

fn map_agent_pending_interaction(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentPendingInteraction> {
    Ok(AgentPendingInteraction {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        kind: parse_pending_interaction_kind(row.get(3)?),
        status: parse_pending_interaction_status(row.get(4)?),
        payload: map_json::<Value>(row.get(5)?, "agent pending interaction payload")?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_agent_execution_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentExecutionState> {
    Ok(AgentExecutionState {
        id: row.get(0)?,
        run_id: row.get(1)?,
        thread_id: row.get(2)?,
        session_id: row.get(3)?,
        collaboration_mode: parse_collaboration_mode(row.get(4)?),
        phase: parse_execution_phase(row.get(5)?),
        active_turn_id: row.get(6)?,
        waiting_interaction_id: row.get(7)?,
        waiting_interaction_kind: row
            .get::<_, Option<String>>(8)?
            .map(parse_pending_interaction_kind),
        active_goal_node_id: row.get(9)?,
        goal_tree_json: map_json::<Value>(row.get(10)?, "agent execution goal tree")?,
        latest_checkpoint_id: row.get(11)?,
        version: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn map_agent_execution_checkpoint(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentExecutionCheckpoint> {
    Ok(AgentExecutionCheckpoint {
        id: row.get(0)?,
        execution_id: row.get(1)?,
        thread_id: row.get(2)?,
        session_id: row.get(3)?,
        turn_id: row.get(4)?,
        kind: parse_execution_checkpoint_kind(row.get(5)?),
        phase_before: parse_execution_phase(row.get(6)?),
        phase_after: parse_execution_phase(row.get(7)?),
        goal_snapshot_json: map_json::<Value>(row.get(8)?, "goal snapshot")?,
        continuation_payload_json: map_json::<Value>(row.get(9)?, "continuation payload")?,
        created_at: row.get(10)?,
    })
}

fn map_agent_execution_checkpoint_summary(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentExecutionCheckpointSummary> {
    Ok(AgentExecutionCheckpointSummary {
        id: row.get(0)?,
        execution_id: row.get(1)?,
        thread_id: row.get(2)?,
        session_id: row.get(3)?,
        turn_id: row.get(4)?,
        kind: parse_execution_checkpoint_kind(row.get(5)?),
        phase_before: parse_execution_phase(row.get(6)?),
        phase_after: parse_execution_phase(row.get(7)?),
        created_at: row.get(8)?,
    })
}

pub fn read_default_profile_record(storage_root: &str) -> Result<Option<StoredAiProviderProfile>> {
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, name, provider_id, protocol_id, preset_id,
                    connection_config_json, auth_config_json, secret_refs_json,
                    headers_json, model, custom_models_json, discovery_state_json,
                    is_default, created_at, updated_at
             from profiles
             order by is_default desc, updated_at desc
             limit 1",
            [],
            map_stored_profile,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read default ai profile: {error}")))
}

pub fn list_agent_sessions(storage_root: &str) -> Result<Vec<AgentSession>> {
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
             from agent_sessions
             order by updated_at desc",
        )
        .map_err(|error| to_error(format!("failed to prepare agent session query: {error}")))?;
    let rows = statement
        .query_map([], map_agent_session)
        .map_err(|error| to_error(format!("failed to query agent sessions: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect agent sessions: {error}")))
}

pub fn create_agent_session(storage_root: &str, session: &AgentSession) -> Result<AgentSession> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into agent_sessions(id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &session.id,
                &session.title,
                &session.profile_id,
                &session.project_root,
                &session.project_name,
                collaboration_mode_as_str(&session.collaboration_mode),
                session.created_at,
                session.updated_at
            ],
        )
        .map_err(|error| to_error(format!("failed to create agent session: {error}")))?;
    Ok(session.clone())
}

pub fn read_agent_session(storage_root: &str, session_id: &str) -> Result<Option<AgentSession>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at
             from agent_sessions
             where id = ?1",
            params![session_id],
            map_agent_session,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent session: {error}")))
}

pub fn update_agent_session_profile(
    storage_root: &str,
    session_id: &str,
    profile_id: Option<String>,
) -> Result<AgentSession> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let changed = connection
        .execute(
            "update agent_sessions
             set profile_id = ?2, updated_at = ?3
             where id = ?1",
            params![session_id, profile_id, updated_at],
        )
        .map_err(|error| to_error(format!("failed to update agent session profile: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent session not found"));
    }
    read_agent_session(storage_root, &session_id)?
        .ok_or_else(|| to_error("agent session not found after profile update"))
}

pub fn update_agent_session_project(
    storage_root: &str,
    session_id: &str,
    project_root: Option<String>,
    project_name: Option<String>,
) -> Result<AgentSession> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    // Upsert: if session exists, update it; otherwise insert a minimal record then update.
    let changed = connection
        .execute(
            "insert into agent_sessions (id, title, profile_id, project_root, project_name, collaboration_mode, created_at, updated_at)
             values (?1, 'New Session', NULL, ?2, ?3, 'default', ?4, ?4)
             on conflict(id) do update set
                 project_root = excluded.project_root,
                 project_name = excluded.project_name,
                 updated_at = excluded.updated_at",
            params![session_id, project_root, project_name, updated_at],
        )
        .map_err(|error| to_error(format!("failed to upsert agent session project: {error}")))?;
    if changed == 0 {
        return Err(to_error("failed to update agent session project"));
    }
    read_agent_session(storage_root, &session_id)?
        .ok_or_else(|| to_error("agent session not found after project update"))
}

pub fn set_agent_session_collaboration_mode(
    storage_root: &str,
    session_id: &str,
    collaboration_mode: AgentCollaborationMode,
) -> Result<AgentSession> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let changed = connection
        .execute(
            "update agent_sessions
             set collaboration_mode = ?2, updated_at = ?3
             where id = ?1",
            params![
                session_id,
                collaboration_mode_as_str(&collaboration_mode),
                updated_at
            ],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to update agent session collaboration mode: {error}"
            ))
        })?;
    if changed == 0 {
        return Err(to_error("agent session not found"));
    }
    read_agent_session(storage_root, &session_id)?
        .ok_or_else(|| to_error("agent session not found after collaboration mode update"))
}

pub fn upsert_agent_thread(storage_root: &str, thread: &AgentThread) -> Result<AgentThread> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into agent_threads(
               id, session_id, parent_thread_id, forked_from_turn_id, rollback_from_thread_id, rollback_from_turn_id,
               lifecycle_state, elicitation_counter, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             on conflict(id) do update set
               session_id = excluded.session_id,
               parent_thread_id = excluded.parent_thread_id,
               forked_from_turn_id = excluded.forked_from_turn_id,
               rollback_from_thread_id = excluded.rollback_from_thread_id,
               rollback_from_turn_id = excluded.rollback_from_turn_id,
               lifecycle_state = excluded.lifecycle_state,
               elicitation_counter = excluded.elicitation_counter,
               updated_at = excluded.updated_at",
            params![
                &thread.id,
                &thread.session_id,
                &thread.parent_thread_id,
                &thread.forked_from_turn_id,
                &thread.rollback_from_thread_id,
                &thread.rollback_from_turn_id,
                thread_lifecycle_state_as_str(&thread.lifecycle_state),
                thread.elicitation_counter,
                thread.created_at,
                thread.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to upsert agent thread: {error}")))?;
    read_agent_thread(storage_root, &thread.id)?
        .ok_or_else(|| to_error("agent thread not found after upsert"))
}

pub fn create_agent_thread_for_session(
    storage_root: &str,
    session_id: &str,
    parent_thread_id: Option<String>,
    forked_from_turn_id: Option<String>,
    rollback_from_thread_id: Option<String>,
    rollback_from_turn_id: Option<String>,
    lifecycle_state: AgentThreadLifecycleState,
) -> Result<AgentThread> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let now = now_ms();
    let thread = AgentThread {
        id: format!("agent-thread-{}", uuid::Uuid::new_v4()),
        session_id,
        parent_thread_id,
        forked_from_turn_id,
        rollback_from_thread_id,
        rollback_from_turn_id,
        lifecycle_state,
        elicitation_counter: 0,
        created_at: now,
        updated_at: now,
    };
    upsert_agent_thread(storage_root, &thread)
}

pub fn ensure_agent_thread_for_session(
    storage_root: &str,
    session_id: &str,
) -> Result<AgentThread> {
    if let Some(existing) = read_agent_thread_by_session(storage_root, session_id)? {
        return Ok(existing);
    }
    create_agent_thread_for_session(
        storage_root,
        session_id,
        None,
        None,
        None,
        None,
        AgentThreadLifecycleState::Active,
    )
}

pub fn read_agent_thread(storage_root: &str, thread_id: &str) -> Result<Option<AgentThread>> {
    let thread_id = normalize_required_text(thread_id, "thread id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, session_id, parent_thread_id, forked_from_turn_id, rollback_from_thread_id, rollback_from_turn_id,
                    lifecycle_state, elicitation_counter, created_at, updated_at
             from agent_threads
             where id = ?1",
            params![thread_id],
            map_agent_thread,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent thread: {error}")))
}

pub fn read_agent_thread_by_session(
    storage_root: &str,
    session_id: &str,
) -> Result<Option<AgentThread>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, session_id, parent_thread_id, forked_from_turn_id, rollback_from_thread_id, rollback_from_turn_id,
                    lifecycle_state, elicitation_counter, created_at, updated_at
             from agent_threads
             where session_id = ?1",
            params![session_id],
            map_agent_thread,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent thread by session: {error}")))
}

pub fn list_agent_threads(
    storage_root: &str,
    session_id: Option<&str>,
    include_archived: bool,
) -> Result<Vec<AgentThread>> {
    let connection = open_registry(storage_root)?;
    let mut statement = if session_id.is_some() {
        connection.prepare(
            "select id, session_id, parent_thread_id, forked_from_turn_id, rollback_from_thread_id, rollback_from_turn_id,
                    lifecycle_state, elicitation_counter, created_at, updated_at
             from agent_threads
             where session_id = ?1
             order by created_at asc",
        )
    } else if include_archived {
        connection.prepare(
            "select id, session_id, parent_thread_id, forked_from_turn_id, rollback_from_thread_id, rollback_from_turn_id,
                    lifecycle_state, elicitation_counter, created_at, updated_at
             from agent_threads
             order by created_at asc",
        )
    } else {
        connection.prepare(
            "select id, session_id, parent_thread_id, forked_from_turn_id, rollback_from_thread_id, rollback_from_turn_id,
                    lifecycle_state, elicitation_counter, created_at, updated_at
             from agent_threads
             where lifecycle_state != 'archived'
             order by created_at asc",
        )
    }
    .map_err(|error| to_error(format!("failed to prepare agent thread list query: {error}")))?;

    let rows = if let Some(session_id) = session_id {
        let normalized = normalize_required_text(session_id, "session id")?;
        statement.query_map(params![normalized], map_agent_thread)
    } else {
        statement.query_map([], map_agent_thread)
    }
    .map_err(|error| to_error(format!("failed to query agent threads: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect agent threads: {error}")))
}

pub fn set_agent_thread_lifecycle_state(
    storage_root: &str,
    thread_id: &str,
    lifecycle_state: AgentThreadLifecycleState,
) -> Result<AgentThread> {
    let thread_id = normalize_required_text(thread_id, "thread id")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let changed = connection
        .execute(
            "update agent_threads
             set lifecycle_state = ?2, updated_at = ?3
             where id = ?1",
            params![
                thread_id,
                thread_lifecycle_state_as_str(&lifecycle_state),
                updated_at
            ],
        )
        .map_err(|error| to_error(format!("failed to update agent thread state: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent thread not found"));
    }
    read_agent_thread(storage_root, &thread_id)?
        .ok_or_else(|| to_error("agent thread not found after state update"))
}

pub fn bump_agent_thread_elicitation_counter(
    storage_root: &str,
    thread_id: &str,
    delta: i64,
) -> Result<AgentThread> {
    let thread_id = normalize_required_text(thread_id, "thread id")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let changed = connection
        .execute(
            "update agent_threads
             set elicitation_counter = max(0, elicitation_counter + ?2),
                 updated_at = ?3
             where id = ?1",
            params![thread_id, delta, updated_at],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to update agent thread elicitation counter: {error}"
            ))
        })?;
    if changed == 0 {
        return Err(to_error("agent thread not found"));
    }
    read_agent_thread(storage_root, &thread_id)?
        .ok_or_else(|| to_error("agent thread not found after counter update"))
}

pub fn read_agent_plan(storage_root: &str, session_id: &str) -> Result<Option<AgentPlanState>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select session_id, status, draft_markdown, proposed_markdown, approved_markdown, version, last_submitted_version, updated_at
             from agent_plans
             where session_id = ?1",
            params![session_id],
            map_agent_plan,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent plan: {error}")))
}

pub fn upsert_agent_plan(
    storage_root: &str,
    session_id: &str,
    plan: &AgentPlanState,
) -> Result<AgentPlanState> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into agent_plans(
               session_id, status, draft_markdown, proposed_markdown, approved_markdown, version, last_submitted_version, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             on conflict(session_id) do update set
               status = excluded.status,
               draft_markdown = excluded.draft_markdown,
               proposed_markdown = excluded.proposed_markdown,
               approved_markdown = excluded.approved_markdown,
               version = excluded.version,
               last_submitted_version = excluded.last_submitted_version,
               updated_at = excluded.updated_at",
            params![
                session_id,
                plan_status_as_str(&plan.status),
                &plan.draft_markdown,
                &plan.proposed_markdown,
                &plan.approved_markdown,
                plan.version,
                plan.last_submitted_version,
                plan.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to upsert agent plan: {error}")))?;
    read_agent_plan(storage_root, &session_id)?
        .ok_or_else(|| to_error("agent plan not found after upsert"))
}

pub fn read_agent_pending_interaction(
    storage_root: &str,
    interaction_id: &str,
) -> Result<Option<AgentPendingInteraction>> {
    let interaction_id = normalize_required_text(interaction_id, "interaction id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, session_id, turn_id, kind, status, payload_json, created_at, updated_at
             from agent_pending_interactions
             where id = ?1",
            params![interaction_id],
            map_agent_pending_interaction,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent pending interaction: {error}")))
}

pub fn upsert_agent_pending_interaction(
    storage_root: &str,
    interaction: &AgentPendingInteraction,
) -> Result<AgentPendingInteraction> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into agent_pending_interactions(
               id, session_id, turn_id, kind, status, payload_json, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             on conflict(id) do update set
               session_id = excluded.session_id,
               turn_id = excluded.turn_id,
               kind = excluded.kind,
               status = excluded.status,
               payload_json = excluded.payload_json,
               updated_at = excluded.updated_at",
            params![
                interaction.id,
                interaction.session_id,
                interaction.turn_id,
                pending_interaction_kind_as_str(&interaction.kind),
                pending_interaction_status_as_str(&interaction.status),
                to_json(&interaction.payload)?,
                interaction.created_at,
                interaction.updated_at,
            ],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to upsert agent pending interaction: {error}"
            ))
        })?;
    read_agent_pending_interaction(storage_root, &interaction.id)?
        .ok_or_else(|| to_error("agent pending interaction not found after upsert"))
}

pub fn list_agent_pending_interactions(
    storage_root: &str,
    session_id: &str,
) -> Result<Vec<AgentPendingInteraction>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, session_id, turn_id, kind, status, payload_json, created_at, updated_at
             from agent_pending_interactions
             where session_id = ?1 and status = 'pending'
             order by created_at asc",
        )
        .map_err(|error| {
            to_error(format!(
                "failed to prepare agent pending interactions query: {error}"
            ))
        })?;
    let rows = statement
        .query_map(params![session_id], map_agent_pending_interaction)
        .map_err(|error| {
            to_error(format!(
                "failed to query agent pending interactions: {error}"
            ))
        })?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|error| {
        to_error(format!(
            "failed to collect agent pending interactions: {error}"
        ))
    })
}

pub fn read_agent_execution_state_by_thread(
    storage_root: &str,
    thread_id: &str,
) -> Result<Option<AgentExecutionState>> {
    let thread_id = normalize_required_text(thread_id, "thread id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, run_id, thread_id, session_id, collaboration_mode, phase,
                    active_turn_id, waiting_interaction_id, waiting_interaction_kind,
                    active_goal_node_id, goal_tree_json, latest_checkpoint_id, version,
                    created_at, updated_at
             from agent_execution_states
             where thread_id = ?1",
            params![thread_id],
            map_agent_execution_state,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read execution state by thread: {error}")))
}

pub fn read_agent_execution_state_by_session(
    storage_root: &str,
    session_id: &str,
) -> Result<Option<AgentExecutionState>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, run_id, thread_id, session_id, collaboration_mode, phase,
                    active_turn_id, waiting_interaction_id, waiting_interaction_kind,
                    active_goal_node_id, goal_tree_json, latest_checkpoint_id, version,
                    created_at, updated_at
             from agent_execution_states
             where session_id = ?1
             order by updated_at desc
             limit 1",
            params![session_id],
            map_agent_execution_state,
        )
        .optional()
        .map_err(|error| {
            to_error(format!(
                "failed to read execution state by session: {error}"
            ))
        })
}

pub fn read_agent_execution_state(
    storage_root: &str,
    execution_id: &str,
) -> Result<Option<AgentExecutionState>> {
    let execution_id = normalize_required_text(execution_id, "execution id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, run_id, thread_id, session_id, collaboration_mode, phase,
                    active_turn_id, waiting_interaction_id, waiting_interaction_kind,
                    active_goal_node_id, goal_tree_json, latest_checkpoint_id, version,
                    created_at, updated_at
             from agent_execution_states
             where id = ?1",
            params![execution_id],
            map_agent_execution_state,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read execution state: {error}")))
}

pub fn ensure_agent_execution_state(
    storage_root: &str,
    session_id: &str,
    thread_id: &str,
    collaboration_mode: &AgentCollaborationMode,
) -> Result<AgentExecutionState> {
    if let Some(existing) = read_agent_execution_state_by_thread(storage_root, thread_id)? {
        return Ok(existing);
    }
    let now = now_ms();
    let root_goal_id = format!("goal-root-{}", uuid::Uuid::new_v4());
    let state = AgentExecutionState {
        id: format!("agent-exec-{}", uuid::Uuid::new_v4()),
        run_id: format!("agent-run-{}", uuid::Uuid::new_v4()),
        thread_id: thread_id.to_string(),
        session_id: session_id.to_string(),
        collaboration_mode: collaboration_mode.clone(),
        phase: AgentExecutionPhase::Idle,
        active_turn_id: None,
        waiting_interaction_id: None,
        waiting_interaction_kind: None,
        active_goal_node_id: Some(root_goal_id.clone()),
        goal_tree_json: json!({
            "nodes": [{
                "id": root_goal_id,
                "parentId": Value::Null,
                "title": "Current execution",
                "status": "in_progress",
                "progressPercent": 0,
                "updatedAt": now
            }]
        }),
        latest_checkpoint_id: None,
        version: 0,
        created_at: now,
        updated_at: now,
    };
    upsert_agent_execution_state(storage_root, &state)
}

pub fn upsert_agent_execution_state(
    storage_root: &str,
    state: &AgentExecutionState,
) -> Result<AgentExecutionState> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into agent_execution_states(
               id, run_id, thread_id, session_id, collaboration_mode, phase,
               active_turn_id, waiting_interaction_id, waiting_interaction_kind,
               active_goal_node_id, goal_tree_json, latest_checkpoint_id, version,
               created_at, updated_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             on conflict(id) do update set
               run_id = excluded.run_id,
               thread_id = excluded.thread_id,
               session_id = excluded.session_id,
               collaboration_mode = excluded.collaboration_mode,
               phase = excluded.phase,
               active_turn_id = excluded.active_turn_id,
               waiting_interaction_id = excluded.waiting_interaction_id,
               waiting_interaction_kind = excluded.waiting_interaction_kind,
               active_goal_node_id = excluded.active_goal_node_id,
               goal_tree_json = excluded.goal_tree_json,
               latest_checkpoint_id = excluded.latest_checkpoint_id,
               version = excluded.version,
               updated_at = excluded.updated_at",
            params![
                state.id,
                state.run_id,
                state.thread_id,
                state.session_id,
                collaboration_mode_as_str(&state.collaboration_mode),
                execution_phase_as_str(&state.phase),
                state.active_turn_id,
                state.waiting_interaction_id,
                state
                    .waiting_interaction_kind
                    .as_ref()
                    .map(pending_interaction_kind_as_str),
                state.active_goal_node_id,
                to_json(&state.goal_tree_json)?,
                state.latest_checkpoint_id,
                state.version,
                state.created_at,
                state.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to upsert execution state: {error}")))?;
    read_agent_execution_state(storage_root, &state.id)?
        .ok_or_else(|| to_error("execution state not found after upsert"))
}

pub fn update_agent_execution_state_with_version(
    storage_root: &str,
    state: &AgentExecutionState,
    expected_version: i64,
) -> Result<Option<AgentExecutionState>> {
    let connection = open_registry(storage_root)?;
    let changed = connection
        .execute(
            "update agent_execution_states
             set run_id = ?2,
                 thread_id = ?3,
                 session_id = ?4,
                 collaboration_mode = ?5,
                 phase = ?6,
                 active_turn_id = ?7,
                 waiting_interaction_id = ?8,
                 waiting_interaction_kind = ?9,
                 active_goal_node_id = ?10,
                 goal_tree_json = ?11,
                 latest_checkpoint_id = ?12,
                 version = ?13,
                 updated_at = ?14
             where id = ?1 and version = ?15",
            params![
                state.id,
                state.run_id,
                state.thread_id,
                state.session_id,
                collaboration_mode_as_str(&state.collaboration_mode),
                execution_phase_as_str(&state.phase),
                state.active_turn_id,
                state.waiting_interaction_id,
                state
                    .waiting_interaction_kind
                    .as_ref()
                    .map(pending_interaction_kind_as_str),
                state.active_goal_node_id,
                to_json(&state.goal_tree_json)?,
                state.latest_checkpoint_id,
                state.version,
                state.updated_at,
                expected_version,
            ],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to update execution state by version: {error}"
            ))
        })?;
    if changed == 0 {
        return Ok(None);
    }
    read_agent_execution_state(storage_root, &state.id)
}

fn prune_execution_checkpoints(
    connection: &rusqlite::Connection,
    execution_id: &str,
    limit: usize,
) -> Result<()> {
    let mut statement = connection
        .prepare(
            "select id, kind, created_at
             from agent_execution_checkpoints
             where execution_id = ?1
             order by created_at desc, id desc",
        )
        .map_err(|error| {
            to_error(format!(
                "failed to prepare checkpoint pruning query: {error}"
            ))
        })?;
    let rows = statement
        .query_map(params![execution_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| to_error(format!("failed to query checkpoints for pruning: {error}")))?;
    let entries = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| {
            to_error(format!(
                "failed to collect checkpoints for pruning: {error}"
            ))
        })?;

    if entries.len() <= limit {
        return Ok(());
    }

    let keep_latest_interaction_wait = entries
        .iter()
        .find(|(_, kind, _)| kind == "interaction_wait")
        .map(|(id, _, _)| id.clone());
    let keep_latest_terminal = entries
        .iter()
        .find(|(_, kind, _)| kind == "turn_completed" || kind == "turn_failed")
        .map(|(id, _, _)| id.clone());

    let mut kept = std::collections::BTreeSet::new();
    if let Some(id) = keep_latest_interaction_wait {
        kept.insert(id);
    }
    if let Some(id) = keep_latest_terminal {
        kept.insert(id);
    }
    for (id, _, _) in entries.iter().take(limit) {
        kept.insert(id.clone());
    }

    let delete_ids = entries
        .into_iter()
        .filter(|(id, _, _)| !kept.contains(id))
        .map(|(id, _, _)| id)
        .collect::<Vec<_>>();
    for id in delete_ids {
        connection
            .execute(
                "delete from agent_execution_checkpoints where id = ?1",
                params![id],
            )
            .map_err(|error| to_error(format!("failed to prune execution checkpoint: {error}")))?;
    }
    Ok(())
}

pub fn append_agent_execution_checkpoint(
    storage_root: &str,
    checkpoint: &AgentExecutionCheckpoint,
) -> Result<AgentExecutionCheckpoint> {
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "insert into agent_execution_checkpoints(
               id, execution_id, thread_id, session_id, turn_id, kind, phase_before, phase_after,
               goal_snapshot_json, continuation_payload_json, created_at
             ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                checkpoint.id,
                checkpoint.execution_id,
                checkpoint.thread_id,
                checkpoint.session_id,
                checkpoint.turn_id,
                execution_checkpoint_kind_as_str(&checkpoint.kind),
                execution_phase_as_str(&checkpoint.phase_before),
                execution_phase_as_str(&checkpoint.phase_after),
                to_json(&checkpoint.goal_snapshot_json)?,
                to_json(&checkpoint.continuation_payload_json)?,
                checkpoint.created_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to append execution checkpoint: {error}")))?;
    prune_execution_checkpoints(&connection, &checkpoint.execution_id, 80)?;
    read_agent_execution_checkpoint(storage_root, &checkpoint.id)?
        .ok_or_else(|| to_error("execution checkpoint not found after append"))
}

pub fn read_agent_execution_checkpoint(
    storage_root: &str,
    checkpoint_id: &str,
) -> Result<Option<AgentExecutionCheckpoint>> {
    let checkpoint_id = normalize_required_text(checkpoint_id, "checkpoint id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, execution_id, thread_id, session_id, turn_id, kind, phase_before, phase_after,
                    goal_snapshot_json, continuation_payload_json, created_at
             from agent_execution_checkpoints
             where id = ?1",
            params![checkpoint_id],
            map_agent_execution_checkpoint,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read execution checkpoint: {error}")))
}

pub fn list_agent_execution_checkpoints(
    storage_root: &str,
    session_id: &str,
    limit: usize,
) -> Result<Vec<AgentExecutionCheckpointSummary>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let max_limit = limit.clamp(1, 200) as i64;
    let mut statement = connection
        .prepare(
            "select id, execution_id, thread_id, session_id, turn_id, kind, phase_before, phase_after, created_at
             from agent_execution_checkpoints
             where session_id = ?1
             order by created_at desc, id desc
             limit ?2",
        )
        .map_err(|error| {
            to_error(format!(
                "failed to prepare execution checkpoint list query: {error}"
            ))
        })?;
    let rows = statement
        .query_map(
            params![session_id, max_limit],
            map_agent_execution_checkpoint_summary,
        )
        .map_err(|error| to_error(format!("failed to query execution checkpoints: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect execution checkpoints: {error}")))
}

pub fn list_agent_execution_checkpoints_by_execution(
    storage_root: &str,
    execution_id: &str,
    limit: usize,
) -> Result<Vec<AgentExecutionCheckpoint>> {
    let execution_id = normalize_required_text(execution_id, "execution id")?;
    let connection = open_registry(storage_root)?;
    let max_limit = limit.clamp(1, 200) as i64;
    let mut statement = connection
        .prepare(
            "select id, execution_id, thread_id, session_id, turn_id, kind, phase_before, phase_after,
                    goal_snapshot_json, continuation_payload_json, created_at
             from agent_execution_checkpoints
             where execution_id = ?1
             order by created_at desc, id desc
             limit ?2",
        )
        .map_err(|error| to_error(format!("failed to prepare execution checkpoint query: {error}")))?;
    let rows = statement
        .query_map(
            params![execution_id, max_limit],
            map_agent_execution_checkpoint,
        )
        .map_err(|error| {
            to_error(format!(
                "failed to query execution checkpoints by execution: {error}"
            ))
        })?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|error| {
        to_error(format!(
            "failed to collect execution checkpoints by execution: {error}"
        ))
    })
}

pub fn delete_agent_session(storage_root: &str, session_id: &str) -> Result<()> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    connection
        .execute(
            "delete from agent_sessions where id = ?1",
            params![session_id],
        )
        .map_err(|error| to_error(format!("failed to delete agent session: {error}")))?;
    Ok(())
}

pub fn create_agent_turn(
    storage_root: &str,
    session_id: &str,
    profile_id: &str,
) -> Result<AgentTurn> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let profile_id = normalize_required_text(profile_id, "profile id")?;
    let connection = open_registry(storage_root)?;
    let now = now_ms();
    let turn = AgentTurn {
        id: format!("agent-turn-{}", uuid::Uuid::new_v4()),
        session_id: session_id.clone(),
        profile_id,
        status: "running".to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    connection
        .execute(
            "insert into agent_turns(
               id, session_id, profile_id, status, error_code, error_message, usage_json, created_at, updated_at
             ) values (?1, ?2, ?3, ?4, null, null, null, ?5, ?6)",
            params![
                &turn.id,
                &turn.session_id,
                &turn.profile_id,
                &turn.status,
                turn.created_at,
                turn.updated_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to create agent turn: {error}")))?;
    connection
        .execute(
            "update agent_sessions set updated_at = ?2 where id = ?1",
            params![session_id, now],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to touch agent session for turn create: {error}"
            ))
        })?;
    Ok(turn)
}

pub fn complete_agent_turn(
    storage_root: &str,
    turn_id: &str,
    usage: Option<&AgentUsage>,
) -> Result<AgentTurn> {
    let turn_id = normalize_required_text(turn_id, "turn id")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let usage_json = usage.map(to_json).transpose()?;
    let changed = connection
        .execute(
            "update agent_turns
             set status = 'completed',
                 error_code = null,
                 error_message = null,
                 usage_json = ?2,
                 updated_at = ?3
             where id = ?1",
            params![turn_id, usage_json, updated_at],
        )
        .map_err(|error| to_error(format!("failed to complete agent turn: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent turn not found"));
    }

    let session_id: String = connection
        .query_row(
            "select session_id from agent_turns where id = ?1",
            params![turn_id],
            |row| row.get(0),
        )
        .map_err(|error| to_error(format!("failed to resolve agent turn session: {error}")))?;
    connection
        .execute(
            "update agent_sessions set updated_at = ?2 where id = ?1",
            params![session_id, updated_at],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to touch agent session for turn complete: {error}"
            ))
        })?;

    read_agent_turn(storage_root, &turn_id)?
        .ok_or_else(|| to_error("agent turn not found after completion"))
}

pub fn fail_agent_turn(
    storage_root: &str,
    turn_id: &str,
    code: &str,
    message: &str,
) -> Result<AgentTurn> {
    let turn_id = normalize_required_text(turn_id, "turn id")?;
    let code = normalize_required_text(code, "error code")?;
    let message = normalize_required_text(message, "error message")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let changed = connection
        .execute(
            "update agent_turns
             set status = 'failed',
                 error_code = ?2,
                 error_message = ?3,
                 updated_at = ?4
             where id = ?1",
            params![turn_id, code, message, updated_at],
        )
        .map_err(|error| to_error(format!("failed to fail agent turn: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent turn not found"));
    }

    let session_id: String = connection
        .query_row(
            "select session_id from agent_turns where id = ?1",
            params![turn_id],
            |row| row.get(0),
        )
        .map_err(|error| to_error(format!("failed to resolve agent turn session: {error}")))?;
    connection
        .execute(
            "update agent_sessions set updated_at = ?2 where id = ?1",
            params![session_id, updated_at],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to touch agent session for turn failure: {error}"
            ))
        })?;

    read_agent_turn(storage_root, &turn_id)?
        .ok_or_else(|| to_error("agent turn not found after failure"))
}

pub fn pause_agent_turn(
    storage_root: &str,
    turn_id: &str,
    code: &str,
    message: &str,
    usage: Option<&AgentUsage>,
) -> Result<AgentTurn> {
    let turn_id = normalize_required_text(turn_id, "turn id")?;
    let code = normalize_required_text(code, "error code")?;
    let message = normalize_required_text(message, "error message")?;
    let connection = open_registry(storage_root)?;
    let updated_at = now_ms();
    let usage_json = usage.map(to_json).transpose()?;
    let changed = connection
        .execute(
            "update agent_turns
             set status = 'paused',
                 error_code = ?2,
                 error_message = ?3,
                 usage_json = ?4,
                 updated_at = ?5
             where id = ?1",
            params![turn_id, code, message, usage_json, updated_at],
        )
        .map_err(|error| to_error(format!("failed to pause agent turn: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent turn not found"));
    }

    let session_id: String = connection
        .query_row(
            "select session_id from agent_turns where id = ?1",
            params![turn_id],
            |row| row.get(0),
        )
        .map_err(|error| to_error(format!("failed to resolve agent turn session: {error}")))?;
    connection
        .execute(
            "update agent_sessions set updated_at = ?2 where id = ?1",
            params![session_id, updated_at],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to touch agent session for turn pause: {error}"
            ))
        })?;

    read_agent_turn(storage_root, &turn_id)?
        .ok_or_else(|| to_error("agent turn not found after pause"))
}

pub fn read_agent_turn(storage_root: &str, turn_id: &str) -> Result<Option<AgentTurn>> {
    let turn_id = normalize_required_text(turn_id, "turn id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, session_id, profile_id, status, error_code, error_message, usage_json, created_at, updated_at
             from agent_turns
             where id = ?1",
            params![turn_id],
            map_agent_turn,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent turn: {error}")))
}

pub fn list_agent_turns(storage_root: &str, session_id: &str) -> Result<Vec<AgentTurn>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, session_id, profile_id, status, error_code, error_message, usage_json, created_at, updated_at
             from agent_turns
             where session_id = ?1
             order by created_at asc",
        )
        .map_err(|error| to_error(format!("failed to prepare agent turn list query: {error}")))?;
    let rows = statement
        .query_map(params![session_id], map_agent_turn)
        .map_err(|error| to_error(format!("failed to query agent turns: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect agent turns: {error}")))
}

pub fn append_agent_message(
    storage_root: &str,
    session_id: &str,
    turn_id: Option<String>,
    role: &str,
    content: &str,
) -> Result<AgentMessage> {
    append_agent_message_with_display(storage_root, session_id, turn_id, role, content, None)
}

pub fn append_agent_message_with_display(
    storage_root: &str,
    session_id: &str,
    turn_id: Option<String>,
    role: &str,
    content: &str,
    display_content: Option<&str>,
) -> Result<AgentMessage> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let role = normalize_required_text(role, "message role")?;
    let content = content.to_string();
    let display_content = display_content
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string);
    let connection = open_registry(storage_root)?;
    let now = now_ms();
    let message = AgentMessage {
        id: format!("agent-message-{}", uuid::Uuid::new_v4()),
        session_id: session_id.clone(),
        turn_id,
        role,
        content,
        display_content,
        created_at: now,
    };
    connection
        .execute(
            "insert into agent_messages(id, session_id, turn_id, role, content, display_content, created_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &message.id,
                &message.session_id,
                &message.turn_id,
                &message.role,
                &message.content,
                &message.display_content,
                message.created_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to append agent message: {error}")))?;
    connection
        .execute(
            "update agent_sessions set updated_at = ?2 where id = ?1",
            params![session_id, now],
        )
        .map_err(|error| {
            to_error(format!(
                "failed to touch agent session for message append: {error}"
            ))
        })?;
    Ok(message)
}

pub fn list_agent_messages(storage_root: &str, session_id: &str) -> Result<Vec<AgentMessage>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, session_id, turn_id, role, content, display_content, created_at
             from agent_messages
             where session_id = ?1
             order by created_at asc",
        )
        .map_err(|error| {
            to_error(format!(
                "failed to prepare agent message list query: {error}"
            ))
        })?;
    let rows = statement
        .query_map(params![session_id], map_agent_message)
        .map_err(|error| to_error(format!("failed to query agent messages: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect agent messages: {error}")))
}

pub fn create_agent_tool_call(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    input: &Value,
) -> Result<AgentToolCall> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let turn_id = normalize_required_text(turn_id, "turn id")?;
    let tool_name = normalize_required_text(tool_name, "tool name")?;
    let connection = open_registry(storage_root)?;
    let now = now_ms();
    let call = AgentToolCall {
        id: format!("agent-tool-{}", uuid::Uuid::new_v4()),
        session_id,
        turn_id,
        tool_name,
        input: input.clone(),
        output: None,
        status: "running".to_string(),
        error_code: None,
        error_message: None,
        started_at: now,
        finished_at: None,
    };
    let input_json = to_json(&call.input)?;
    connection
        .execute(
            "insert into agent_tool_calls(
               id, session_id, turn_id, tool_name, input_json, output_json, status, error_code, error_message, started_at, finished_at
             ) values (?1, ?2, ?3, ?4, ?5, null, ?6, null, null, ?7, null)",
            params![
                &call.id,
                &call.session_id,
                &call.turn_id,
                &call.tool_name,
                &input_json,
                &call.status,
                call.started_at,
            ],
        )
        .map_err(|error| to_error(format!("failed to create agent tool call: {error}")))?;
    Ok(call)
}

pub fn complete_agent_tool_call(
    storage_root: &str,
    tool_call_id: &str,
    output: &Value,
) -> Result<AgentToolCall> {
    let tool_call_id = normalize_required_text(tool_call_id, "tool call id")?;
    let connection = open_registry(storage_root)?;
    let finished_at = now_ms();
    let changed = connection
        .execute(
            "update agent_tool_calls
             set status = 'completed',
                 output_json = ?2,
                 error_code = null,
                 error_message = null,
                 finished_at = ?3
             where id = ?1",
            params![tool_call_id, to_json(output)?, finished_at],
        )
        .map_err(|error| to_error(format!("failed to complete agent tool call: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent tool call not found"));
    }
    read_agent_tool_call(storage_root, &tool_call_id)?
        .ok_or_else(|| to_error("agent tool call not found after completion"))
}

pub fn fail_agent_tool_call(
    storage_root: &str,
    tool_call_id: &str,
    error_code: &str,
    error_message: &str,
) -> Result<AgentToolCall> {
    let tool_call_id = normalize_required_text(tool_call_id, "tool call id")?;
    let error_code = normalize_required_text(error_code, "error code")?;
    let error_message = normalize_required_text(error_message, "error message")?;
    let connection = open_registry(storage_root)?;
    let finished_at = now_ms();
    let changed = connection
        .execute(
            "update agent_tool_calls
             set status = 'failed',
                 error_code = ?2,
                 error_message = ?3,
                 finished_at = ?4
             where id = ?1",
            params![tool_call_id, error_code, error_message, finished_at],
        )
        .map_err(|error| to_error(format!("failed to fail agent tool call: {error}")))?;
    if changed == 0 {
        return Err(to_error("agent tool call not found"));
    }
    read_agent_tool_call(storage_root, &tool_call_id)?
        .ok_or_else(|| to_error("agent tool call not found after failure"))
}

pub fn read_agent_tool_call(
    storage_root: &str,
    tool_call_id: &str,
) -> Result<Option<AgentToolCall>> {
    let tool_call_id = normalize_required_text(tool_call_id, "tool call id")?;
    let connection = open_registry(storage_root)?;
    connection
        .query_row(
            "select id, session_id, turn_id, tool_name, input_json, output_json, status, error_code, error_message, started_at, finished_at
             from agent_tool_calls
             where id = ?1",
            params![tool_call_id],
            map_agent_tool_call,
        )
        .optional()
        .map_err(|error| to_error(format!("failed to read agent tool call: {error}")))
}

pub fn list_agent_tool_calls(storage_root: &str, session_id: &str) -> Result<Vec<AgentToolCall>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, session_id, turn_id, tool_name, input_json, output_json, status, error_code, error_message, started_at, finished_at
             from agent_tool_calls
             where session_id = ?1
             order by started_at asc",
        )
        .map_err(|error| to_error(format!("failed to prepare agent tool call list query: {error}")))?;
    let rows = statement
        .query_map(params![session_id], map_agent_tool_call)
        .map_err(|error| to_error(format!("failed to query agent tool calls: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect agent tool calls: {error}")))
}

pub fn append_agent_runtime_event(
    storage_root: &str,
    event: &AgentRuntimeEvent,
) -> Result<AgentRuntimeEvent> {
    let session_id = normalize_required_text(&event.session_id, "session id")?;
    let turn_id = normalize_required_text(&event.turn_id, "turn id")?;
    let phase = normalize_required_text(&event.phase, "phase")?;
    let connection = open_registry(storage_root)?;
    let stored = AgentRuntimeEvent {
        session_id,
        turn_id,
        phase,
        payload: event.payload.clone(),
        timestamp: event.timestamp,
    };
    connection
        .execute(
            "insert into agent_runtime_events(
               id, session_id, turn_id, phase, payload_json, timestamp
             ) values (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                format!("agent-runtime-event-{}", uuid::Uuid::new_v4()),
                &stored.session_id,
                &stored.turn_id,
                &stored.phase,
                to_json(&stored.payload)?,
                stored.timestamp
            ],
        )
        .map_err(|error| to_error(format!("failed to append agent runtime event: {error}")))?;
    Ok(stored)
}

pub fn list_agent_runtime_events(
    storage_root: &str,
    session_id: &str,
) -> Result<Vec<AgentRuntimeEvent>> {
    let session_id = normalize_required_text(session_id, "session id")?;
    let connection = open_registry(storage_root)?;
    let mut statement = connection
        .prepare(
            "select id, session_id, turn_id, phase, payload_json, timestamp
             from agent_runtime_events
             where session_id = ?1
             order by timestamp asc, id asc",
        )
        .map_err(|error| {
            to_error(format!(
                "failed to prepare agent runtime event list query: {error}"
            ))
        })?;
    let rows = statement
        .query_map(params![session_id], map_agent_runtime_event)
        .map_err(|error| to_error(format!("failed to query agent runtime events: {error}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| to_error(format!("failed to collect agent runtime events: {error}")))
}
