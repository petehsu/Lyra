use napi::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::agent::runtime_events::emit_event;
use crate::agent::types::{
    AgentCollaborationMode, AgentExecutionCheckpoint, AgentExecutionCheckpointKind,
    AgentExecutionPhase, AgentExecutionState, AgentPendingInteractionKind,
};
use crate::error::{now_ms, to_error};
use crate::storage::registry_db;

#[derive(Clone, Debug)]
pub(crate) struct ExecutionTransitionRequest {
    pub storage_root: String,
    pub session_id: String,
    pub thread_id: String,
    pub collaboration_mode: AgentCollaborationMode,
    pub event_turn_id: String,
    pub to_phase: AgentExecutionPhase,
    pub active_turn_id: Option<String>,
    pub waiting_interaction_id: Option<String>,
    pub waiting_interaction_kind: Option<AgentPendingInteractionKind>,
    pub checkpoint_kind: Option<AgentExecutionCheckpointKind>,
    pub continuation_payload: Value,
    pub goal_tree_json: Option<Value>,
    pub active_goal_node_id: Option<String>,
}

fn is_valid_transition(from: &AgentExecutionPhase, to: &AgentExecutionPhase) -> bool {
    if from == to {
        return true;
    }
    matches!(
        (from, to),
        (AgentExecutionPhase::Idle, AgentExecutionPhase::Running)
            | (
                AgentExecutionPhase::Running,
                AgentExecutionPhase::WaitingInteraction
            )
            | (
                AgentExecutionPhase::WaitingInteraction,
                AgentExecutionPhase::Resumable
            )
            | (AgentExecutionPhase::Resumable, AgentExecutionPhase::Running)
            | (AgentExecutionPhase::Running, AgentExecutionPhase::Completed)
            | (AgentExecutionPhase::Running, AgentExecutionPhase::Failed)
            | (AgentExecutionPhase::Running, AgentExecutionPhase::Abandoned)
            | (
                AgentExecutionPhase::WaitingInteraction,
                AgentExecutionPhase::Abandoned
            )
            | (
                AgentExecutionPhase::Resumable,
                AgentExecutionPhase::Abandoned
            )
    )
}

fn new_default_goal_tree() -> Value {
    let now = now_ms();
    let root_goal_id = format!("goal-root-{}", Uuid::new_v4());
    json!({
        "nodes": [{
            "id": root_goal_id,
            "parentId": Value::Null,
            "title": "Current execution",
            "status": "in_progress",
            "progressPercent": 0,
            "updatedAt": now
        }]
    })
}

pub(crate) fn ensure_execution_state(
    storage_root: &str,
    session_id: &str,
    thread_id: &str,
    collaboration_mode: &AgentCollaborationMode,
) -> Result<AgentExecutionState> {
    let mut state = registry_db::ensure_agent_execution_state(
        storage_root,
        session_id,
        thread_id,
        collaboration_mode,
    )?;
    if state.goal_tree_json.is_null() {
        state.goal_tree_json = new_default_goal_tree();
        state.updated_at = now_ms();
        state = registry_db::upsert_agent_execution_state(storage_root, &state)?;
    }
    Ok(state)
}

pub(crate) fn transition_execution_state(
    request: ExecutionTransitionRequest,
) -> Result<AgentExecutionState> {
    let mut attempts = 0;
    let checkpoint_id = request
        .checkpoint_kind
        .as_ref()
        .map(|_| format!("agent-exec-checkpoint-{}", Uuid::new_v4()));

    loop {
        let current = ensure_execution_state(
            &request.storage_root,
            &request.session_id,
            &request.thread_id,
            &request.collaboration_mode,
        )?;
        if !is_valid_transition(&current.phase, &request.to_phase) {
            return Err(to_error(format!(
                "invalid execution phase transition: {:?} -> {:?}",
                current.phase, request.to_phase
            )));
        }

        let mut next = current.clone();
        next.phase = request.to_phase.clone();
        next.active_turn_id = request
            .active_turn_id
            .clone()
            .or_else(|| current.active_turn_id.clone());
        next.waiting_interaction_id = request.waiting_interaction_id.clone();
        next.waiting_interaction_kind = request.waiting_interaction_kind.clone();
        if let Some(goal_tree_json) = request.goal_tree_json.clone() {
            next.goal_tree_json = goal_tree_json;
        }
        if let Some(active_goal_node_id) = request.active_goal_node_id.clone() {
            next.active_goal_node_id = Some(active_goal_node_id);
        }
        next.latest_checkpoint_id = checkpoint_id
            .clone()
            .or(current.latest_checkpoint_id.clone());
        next.version = current.version + 1;
        next.updated_at = now_ms();

        let updated_opt = registry_db::update_agent_execution_state_with_version(
            &request.storage_root,
            &next,
            current.version,
        )?;
        let Some(updated) = updated_opt else {
            attempts += 1;
            if attempts > 1 {
                return Err(to_error("execution state version conflict"));
            }
            continue;
        };

        emit_event(
            &request.storage_root,
            &request.session_id,
            &request.event_turn_id,
            "execution_state_transition",
            json!({
                "executionId": updated.id,
                "threadId": updated.thread_id,
                "from": current.phase,
                "to": updated.phase,
                "version": updated.version,
            }),
        )?;

        if let (Some(kind), Some(checkpoint_id)) =
            (request.checkpoint_kind.clone(), checkpoint_id.clone())
        {
            let checkpoint = AgentExecutionCheckpoint {
                id: checkpoint_id.clone(),
                execution_id: updated.id.clone(),
                thread_id: updated.thread_id.clone(),
                session_id: updated.session_id.clone(),
                turn_id: request.event_turn_id.clone(),
                kind,
                phase_before: current.phase.clone(),
                phase_after: updated.phase.clone(),
                goal_snapshot_json: updated.goal_tree_json.clone(),
                continuation_payload_json: request.continuation_payload.clone(),
                created_at: now_ms(),
            };
            let persisted =
                registry_db::append_agent_execution_checkpoint(&request.storage_root, &checkpoint)?;
            emit_event(
                &request.storage_root,
                &request.session_id,
                &request.event_turn_id,
                "execution_checkpoint_saved",
                json!({
                    "executionId": updated.id,
                    "checkpointId": persisted.id,
                    "kind": persisted.kind,
                    "phaseBefore": persisted.phase_before,
                    "phaseAfter": persisted.phase_after,
                }),
            )?;
        }

        if request.goal_tree_json.is_some() {
            emit_event(
                &request.storage_root,
                &request.session_id,
                &request.event_turn_id,
                "goal_tree_updated",
                json!({
                    "executionId": updated.id,
                    "activeGoalNodeId": updated.active_goal_node_id,
                    "goalTree": updated.goal_tree_json,
                }),
            )?;
        }

        return Ok(updated);
    }
}
