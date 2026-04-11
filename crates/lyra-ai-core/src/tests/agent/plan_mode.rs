use crate::agent::service::{create_session, enter_plan_mode, get_plan};
use crate::agent::types::{
    AgentCollaborationMode, AgentCreateSessionRequest, AgentEnterPlanModeRequest,
    AgentGetPlanRequest,
};
use crate::storage::registry_db;
use crate::tests::support::TempStorageRoot;

#[test]
fn entering_plan_mode_initializes_session_state_and_plan() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan session".to_string()),
        profile_id: None,
    })
    .expect("create session");

    let detail = enter_plan_mode(AgentEnterPlanModeRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("enter plan mode");

    assert_eq!(
        detail.session.collaboration_mode,
        AgentCollaborationMode::Plan
    );
    let plan = detail.plan.expect("plan state");
    assert_eq!(plan.version, 0);
    assert_eq!(plan.status, crate::agent::types::AgentPlanStatus::Draft);

    let stored = get_plan(AgentGetPlanRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("get plan")
    .expect("stored plan");
    assert_eq!(stored.version, 0);

    let events = registry_db::list_agent_runtime_events(&storage_root, &session.id)
        .expect("list runtime events");
    assert!(
        events.is_empty(),
        "plan mode lifecycle signals should stay transient"
    );
}

#[test]
fn reentering_plan_mode_emits_reentered_event_without_resetting_draft() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let session = create_session(AgentCreateSessionRequest {
        storage_root: storage_root.clone(),
        title: Some("Plan session".to_string()),
        profile_id: None,
    })
    .expect("create session");

    enter_plan_mode(AgentEnterPlanModeRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("first enter");

    let mut plan = get_plan(AgentGetPlanRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("get blank plan")
    .expect("blank plan");
    plan.version = 3;
    plan.draft_markdown = "draft".to_string();
    registry_db::upsert_agent_plan(&storage_root, &session.id, &plan).expect("save draft");

    let detail = enter_plan_mode(AgentEnterPlanModeRequest {
        storage_root: storage_root.clone(),
        session_id: session.id.clone(),
    })
    .expect("reenter plan mode");

    assert_eq!(
        detail.session.collaboration_mode,
        AgentCollaborationMode::Plan
    );
    assert_eq!(
        detail.plan.as_ref().and_then(|value| Some(value.version)),
        Some(3)
    );
    assert_eq!(
        detail
            .plan
            .as_ref()
            .map(|value| value.draft_markdown.as_str()),
        Some("draft")
    );

    let events = registry_db::list_agent_runtime_events(&storage_root, &session.id)
        .expect("list runtime events");
    assert!(
        events.is_empty(),
        "reentry lifecycle signals should stay transient"
    );
}
