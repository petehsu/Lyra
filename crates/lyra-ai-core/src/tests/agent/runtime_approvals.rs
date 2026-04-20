use std::time::Duration;

use serde_json::json;
use uuid::Uuid;

use crate::agent::command_approval_runtime::submit_command_approval_decision;
use crate::agent::interaction_manager::create_pending_interaction;
use crate::agent::plan_approval_runtime::execute_plan_approval_resolution;
use crate::agent::types::{
    AgentCollaborationMode, AgentPendingInteractionKind, AgentPendingInteractionStatus,
    AgentResolvePlanApprovalRequest, AgentSession, CommandApprovalSubmitRequest,
};
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;

fn seed_session_and_turn(
    storage_root: &str,
    collaboration_mode: AgentCollaborationMode,
) -> (String, String) {
    let session_id = format!("runtime-approvals-session-{}", Uuid::new_v4());
    let session = AgentSession {
        id: session_id.clone(),
        title: "Runtime Approvals".to_string(),
        profile_id: None,
        project_root: None,
        project_name: None,
        collaboration_mode,
        created_at: 1,
        updated_at: 1,
    };
    registry_db::create_agent_session(storage_root, &session).expect("create session");
    let turn = registry_db::create_agent_turn(storage_root, &session_id, "profile-test")
        .expect("create running turn");
    (session_id, turn.id)
}

#[test]
fn command_approval_runtime_emits_interaction_submitted_event() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let (session_id, turn_id) =
        seed_session_and_turn(&storage_root, AgentCollaborationMode::Default);

    submit_command_approval_decision(CommandApprovalSubmitRequest {
        storage_root: storage_root.clone(),
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        tool_call_id: "tool-call-approval-1".to_string(),
        decision: "allow_once".to_string(),
    })
    .expect("submit command approval decision");

    let events = registry_db::list_agent_runtime_events(&storage_root, &session_id)
        .expect("list runtime events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, "interaction_submitted");
    assert_eq!(
        events[0]
            .payload
            .get("interactionKind")
            .and_then(|value| value.as_str()),
        Some("command_approval")
    );
    assert_eq!(
        events[0]
            .payload
            .get("toolCallId")
            .and_then(|value| value.as_str()),
        Some("tool-call-approval-1")
    );
    assert_eq!(
        events[0]
            .payload
            .get("decision")
            .and_then(|value| value.as_str()),
        Some("allow_once")
    );
}

#[test]
fn plan_approval_runtime_resolves_pending_interaction_for_keep_planning() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let (session_id, turn_id) = seed_session_and_turn(&storage_root, AgentCollaborationMode::Plan);
    let request_id = "plan-approval-request-keep-planning";

    create_pending_interaction(
        &storage_root,
        &session_id,
        &turn_id,
        request_id,
        AgentPendingInteractionKind::PlanApproval,
        json!({
            "proposedMarkdown": "1. Clarify scope\n2. Draft architecture"
        }),
    )
    .expect("create pending plan approval interaction");

    let result = execute_plan_approval_resolution(AgentResolvePlanApprovalRequest {
        storage_root: storage_root.clone(),
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        request_id: request_id.to_string(),
        decision: "keep_planning".to_string(),
        feedback: Some("need more details".to_string()),
    })
    .expect("resolve plan approval");
    assert!(result.is_none());

    let interaction = registry_db::read_agent_pending_interaction(&storage_root, request_id)
        .expect("read pending interaction")
        .expect("pending interaction exists");
    assert_eq!(interaction.status, AgentPendingInteractionStatus::Resolved);
    assert_eq!(
        interaction
            .payload
            .get("resolution")
            .and_then(|value| value.get("decision"))
            .and_then(|value| value.as_str()),
        Some("keep_planning")
    );
    assert_eq!(
        interaction
            .payload
            .get("resolution")
            .and_then(|value| value.get("feedback"))
            .and_then(|value| value.as_str()),
        Some("need more details")
    );

    let session = registry_db::read_agent_session(&storage_root, &session_id)
        .expect("read session")
        .expect("session exists");
    assert_eq!(session.collaboration_mode, AgentCollaborationMode::Plan);

    let events = registry_db::list_agent_runtime_events(&storage_root, &session_id)
        .expect("list runtime events");
    let phases = events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(phases.contains(&"interaction_resolved"));
    assert!(phases.contains(&"interaction_submitted"));
    assert!(phases.contains(&"plan_rejected"));
    assert!(phases.contains(&"interaction_queue_updated"));
    assert!(!phases.contains(&"plan_mode_exited"));
}

#[test]
fn plan_approval_runtime_approve_without_plan_does_not_exit_plan_mode() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let (session_id, turn_id) = seed_session_and_turn(&storage_root, AgentCollaborationMode::Plan);
    let request_id = "plan-approval-request-empty";

    create_pending_interaction(
        &storage_root,
        &session_id,
        &turn_id,
        request_id,
        AgentPendingInteractionKind::PlanApproval,
        json!({}),
    )
    .expect("create pending plan approval interaction");

    let result = execute_plan_approval_resolution(AgentResolvePlanApprovalRequest {
        storage_root: storage_root.clone(),
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        request_id: request_id.to_string(),
        decision: "approve_and_implement".to_string(),
        feedback: None,
    })
    .expect("resolve plan approval");
    assert!(result.is_none());

    let turns = registry_db::list_agent_turns(&storage_root, &session_id).expect("list turns");
    assert_eq!(
        turns.len(),
        1,
        "handoff should not run without an approved plan"
    );

    let session = registry_db::read_agent_session(&storage_root, &session_id)
        .expect("read session")
        .expect("session exists");
    assert_eq!(session.collaboration_mode, AgentCollaborationMode::Plan);

    let events = registry_db::list_agent_runtime_events(&storage_root, &session_id)
        .expect("list runtime events");
    let phases = events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(phases.contains(&"plan_approved"));
    assert!(!phases.contains(&"plan_mode_exited"));
}

#[test]
fn plan_approval_runtime_returns_early_when_live_waiter_is_registered() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let (session_id, turn_id) = seed_session_and_turn(&storage_root, AgentCollaborationMode::Plan);
    let request_id = "plan-approval-request-live-waiter";

    create_pending_interaction(
        &storage_root,
        &session_id,
        &turn_id,
        request_id,
        AgentPendingInteractionKind::PlanApproval,
        json!({
            "proposedMarkdown": "1. Run migration\n2. Verify rollout"
        }),
    )
    .expect("create pending plan approval interaction");

    let receiver = crate::agent::tools::register_plan_approval_waiter(request_id);
    let result = execute_plan_approval_resolution(AgentResolvePlanApprovalRequest {
        storage_root: storage_root.clone(),
        session_id: session_id.clone(),
        turn_id: turn_id.clone(),
        request_id: request_id.to_string(),
        decision: "approve_and_implement".to_string(),
        feedback: Some("ship it".to_string()),
    })
    .expect("resolve plan approval");
    assert!(result.is_none());

    let resolution = receiver
        .recv_timeout(Duration::from_millis(250))
        .expect("receive live plan approval resolution");
    assert_eq!(resolution.decision, "approve_and_implement");
    assert_eq!(resolution.feedback.as_deref(), Some("ship it"));

    let session = registry_db::read_agent_session(&storage_root, &session_id)
        .expect("read session")
        .expect("session exists");
    assert_eq!(session.collaboration_mode, AgentCollaborationMode::Plan);

    let events = registry_db::list_agent_runtime_events(&storage_root, &session_id)
        .expect("list runtime events");
    let phases = events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(phases.contains(&"plan_approved"));
    assert!(!phases.contains(&"plan_mode_exited"));
}
