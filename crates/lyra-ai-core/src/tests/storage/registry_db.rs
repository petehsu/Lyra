use serde_json::json;

use crate::agent::types::{
    AgentCollaborationMode, AgentPendingInteraction, AgentPendingInteractionKind,
    AgentPendingInteractionStatus, AgentPlanState, AgentPlanStatus, AgentRuntimeEvent,
    AgentSession, AgentUsage,
};
use crate::profile::types::AiModelDiscoveryResult;
use crate::storage::registry_db;
use crate::tests::support::{sample_model, sample_stored_profile, TempStorageRoot};

#[test]
fn writes_profiles_and_switches_default_profile() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let mut openai = sample_stored_profile("openai", "openai_compatible", Some("openai"));
    openai.id = "openai-profile".to_string();
    let mut anthropic = sample_stored_profile("anthropic", "anthropic_messages", Some("anthropic"));
    anthropic.id = "anthropic-profile".to_string();

    registry_db::write_profile(&storage_root, &openai).expect("write openai");
    registry_db::write_profile(&storage_root, &anthropic).expect("write anthropic");
    let selected = registry_db::set_default_profile(&storage_root, &anthropic.id)
        .expect("set default anthropic");

    assert_eq!(selected.id, anthropic.id);
    assert!(selected.is_default);

    let profiles = registry_db::list_profiles(&storage_root).expect("list profiles");
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].id, anthropic.id);
    assert!(profiles[0].is_default);
}

#[test]
fn round_trips_discovery_cache_records() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let profile = sample_stored_profile("openai", "openai_compatible", Some("openai"));
    registry_db::write_profile(&storage_root, &profile).expect("write profile");

    let cache = AiModelDiscoveryResult {
        provider_id: "openai".to_string(),
        protocol_id: "openai_compatible".to_string(),
        status: "ready".to_string(),
        message: "cached".to_string(),
        checked_at: 200,
        models: vec![sample_model("gpt-5.4-mini")],
    };
    registry_db::upsert_model_discovery_cache(&storage_root, &profile.id, &cache)
        .expect("write discovery cache");

    let cached = registry_db::read_model_discovery_cache(&storage_root, &profile.id)
        .expect("read discovery cache")
        .expect("cached discovery");
    assert_eq!(cached.message, "cached");
    assert_eq!(cached.models[0].id, "gpt-5.4-mini");
}

#[test]
fn round_trips_agent_session_turn_messages_and_tool_calls() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let session = AgentSession {
        id: "agent-session-1".to_string(),
        title: "Agent Session".to_string(),
        profile_id: Some("profile-openai".to_string()),
        project_root: None,
        project_name: None,
        collaboration_mode: AgentCollaborationMode::Default,
        created_at: 1,
        updated_at: 1,
    };
    registry_db::create_agent_session(&storage_root, &session).expect("create agent session");

    let created_turn = registry_db::create_agent_turn(&storage_root, &session.id, "profile-openai")
        .expect("create agent turn");
    assert_eq!(created_turn.status, "running");

    let user_message = registry_db::append_agent_message(
        &storage_root,
        &session.id,
        Some(created_turn.id.clone()),
        "user",
        "hello",
    )
    .expect("append user message");
    assert_eq!(user_message.role, "user");

    let tool_call = registry_db::create_agent_tool_call(
        &storage_root,
        &session.id,
        &created_turn.id,
        "filesystem.list",
        &json!({ "path": "." }),
    )
    .expect("create tool call");
    assert_eq!(tool_call.status, "running");

    let completed_tool_call = registry_db::complete_agent_tool_call(
        &storage_root,
        &tool_call.id,
        &json!({ "entries": [] }),
    )
    .expect("complete tool call");
    assert_eq!(completed_tool_call.status, "completed");

    let runtime_event = registry_db::append_agent_runtime_event(
        &storage_root,
        &AgentRuntimeEvent {
            session_id: session.id.clone(),
            turn_id: created_turn.id.clone(),
            phase: "tool_finished".to_string(),
            payload: json!({
                "toolCallId": completed_tool_call.id,
                "toolName": "filesystem.list",
                "status": "completed"
            }),
            timestamp: 2,
        },
    )
    .expect("append runtime event");
    assert_eq!(runtime_event.phase, "tool_finished");

    let usage = AgentUsage {
        input_tokens: Some(10),
        output_tokens: Some(5),
        total_tokens: Some(15),
    };
    let completed_turn =
        registry_db::complete_agent_turn(&storage_root, &created_turn.id, Some(&usage))
            .expect("complete turn");
    assert_eq!(completed_turn.status, "completed");
    assert_eq!(completed_turn.usage, Some(usage));

    let assistant_message = registry_db::append_agent_message(
        &storage_root,
        &session.id,
        Some(created_turn.id.clone()),
        "assistant",
        "done",
    )
    .expect("append assistant message");
    assert_eq!(assistant_message.role, "assistant");

    let turns = registry_db::list_agent_turns(&storage_root, &session.id).expect("list turns");
    assert_eq!(turns.len(), 1);
    let messages =
        registry_db::list_agent_messages(&storage_root, &session.id).expect("list messages");
    assert_eq!(messages.len(), 2);
    let tool_calls =
        registry_db::list_agent_tool_calls(&storage_root, &session.id).expect("list tool calls");
    assert_eq!(tool_calls.len(), 1);
    let runtime_events = registry_db::list_agent_runtime_events(&storage_root, &session.id)
        .expect("list runtime events");
    assert_eq!(runtime_events.len(), 1);

    registry_db::delete_agent_session(&storage_root, &session.id).expect("delete session");
    assert!(registry_db::read_agent_session(&storage_root, &session.id)
        .expect("read deleted session")
        .is_none());
}

#[test]
fn stores_collaboration_mode_and_plan_state() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let session = AgentSession {
        id: "agent-session-plan".to_string(),
        title: "Plan Session".to_string(),
        profile_id: None,
        project_root: None,
        project_name: None,
        collaboration_mode: AgentCollaborationMode::Default,
        created_at: 10,
        updated_at: 10,
    };
    registry_db::create_agent_session(&storage_root, &session).expect("create session");

    let updated = registry_db::set_agent_session_collaboration_mode(
        &storage_root,
        &session.id,
        AgentCollaborationMode::Plan,
    )
    .expect("set collaboration mode");
    assert_eq!(updated.collaboration_mode, AgentCollaborationMode::Plan);

    let plan = AgentPlanState {
        status: AgentPlanStatus::Submitted,
        draft_markdown: "draft".to_string(),
        proposed_markdown: Some("proposal".to_string()),
        approved_markdown: None,
        version: 2,
        last_submitted_version: Some(2),
        updated_at: 42,
    };
    registry_db::upsert_agent_plan(&storage_root, &session.id, &plan).expect("save plan");

    let reloaded = registry_db::read_agent_plan(&storage_root, &session.id)
        .expect("read plan")
        .expect("plan exists");
    assert_eq!(reloaded.status, AgentPlanStatus::Submitted);
    assert_eq!(reloaded.version, 2);
    assert_eq!(reloaded.last_submitted_version, Some(2));
    assert_eq!(reloaded.proposed_markdown.as_deref(), Some("proposal"));
}

#[test]
fn round_trips_pending_interactions() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let session = AgentSession {
        id: "agent-session-pending".to_string(),
        title: "Pending Session".to_string(),
        profile_id: None,
        project_root: None,
        project_name: None,
        collaboration_mode: AgentCollaborationMode::Default,
        created_at: 11,
        updated_at: 11,
    };
    registry_db::create_agent_session(&storage_root, &session).expect("create session");
    let turn = registry_db::create_agent_turn(&storage_root, &session.id, "profile-openai")
        .expect("create turn");

    let interaction = AgentPendingInteraction {
        id: "pending-question-1".to_string(),
        session_id: session.id.clone(),
        turn_id: turn.id,
        kind: AgentPendingInteractionKind::UserQuestion,
        status: AgentPendingInteractionStatus::Pending,
        payload: json!({
            "requestId": "pending-question-1",
            "questions": [
                {
                    "id": "theme",
                    "header": "Theme",
                    "question": "Which theme should Lyra use?",
                    "options": [
                        { "label": "A", "description": "Option A" },
                        { "label": "B", "description": "Option B" }
                    ]
                }
            ]
        }),
        created_at: 100,
        updated_at: 100,
    };

    registry_db::upsert_agent_pending_interaction(&storage_root, &interaction)
        .expect("upsert pending interaction");

    let listed = registry_db::list_agent_pending_interactions(&storage_root, &session.id)
        .expect("list pending interactions");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, interaction.id);
    assert_eq!(listed[0].kind, AgentPendingInteractionKind::UserQuestion);
    assert_eq!(listed[0].status, AgentPendingInteractionStatus::Pending);

    let mut resolved = listed[0].clone();
    resolved.status = AgentPendingInteractionStatus::Resolved;
    resolved.updated_at = 120;
    resolved.payload = json!({
        "requestId": "pending-question-1",
        "answers": {
            "theme": { "label": "A", "description": "Option A" }
        }
    });
    registry_db::upsert_agent_pending_interaction(&storage_root, &resolved)
        .expect("resolve pending interaction");

    let filtered = registry_db::list_agent_pending_interactions(&storage_root, &session.id)
        .expect("list pending interactions after resolve");
    assert!(filtered.is_empty(), "resolved interactions should not stay in pending list");

    let reloaded = registry_db::read_agent_pending_interaction(&storage_root, &resolved.id)
        .expect("read resolved interaction")
        .expect("resolved interaction exists");
    assert_eq!(reloaded.status, AgentPendingInteractionStatus::Resolved);
}
