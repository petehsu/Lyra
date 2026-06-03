use lyra_terminal_core::{
    attach_agent, authorize_attachment_write, detach_agent, launch_terminal_agent,
    list_attachments, TerminalAgentLaunchRequest, TerminalAttachmentAttachRequest,
    TerminalAttachmentDetachRequest, TerminalAttachmentListRequest, TerminalAttachmentWriteRequest,
};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

fn test_root() -> String {
    let root = std::env::temp_dir().join(format!("lyra-attachments-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create test root");
    root.to_string_lossy().to_string()
}

fn agent_actor(agent_session_id: &str) -> String {
    json!({ "kind": "agent", "agentSessionId": agent_session_id }).to_string()
}

fn correlation(agent_session_id: &str, tool_name: &str) -> String {
    json!({
        "agentSessionId": agent_session_id,
        "terminalToolName": tool_name
    })
    .to_string()
}

fn attach_request(
    root: &str,
    session_id: &str,
    agent_session_id: &str,
    mode: &str,
) -> TerminalAttachmentAttachRequest {
    TerminalAttachmentAttachRequest {
        session_id: session_id.to_string(),
        agent_session_id: agent_session_id.to_string(),
        runtime_turn_id: Some("turn-1".to_string()),
        tool_call_id: Some("tool-1".to_string()),
        mode: mode.to_string(),
        reason: Some("test".to_string()),
        ttl_ms: None,
        permission_id: None,
        permission_scope: None,
        approved: None,
        storage_root: Some(root.to_string()),
        actor_json: Some(agent_actor(agent_session_id)),
        correlation_json: Some(correlation(agent_session_id, "terminal_attach_agent")),
    }
}

fn attachments_journal(root: &str, session_id: &str) -> PathBuf {
    PathBuf::from(root)
        .join("terminal-memory")
        .join("sessions")
        .join(session_id)
        .join("attachments.jsonl")
}

#[test]
fn attach_read_only_requires_no_permission() {
    let root = test_root();
    let session_id = "terminal-session-observe";
    let response = attach_agent(attach_request(
        &root,
        session_id,
        "agent-observe",
        "observe",
    ))
    .expect("attach observe");

    assert_eq!(response.status.as_deref(), Some("active"));
    assert_eq!(response.needs_approval, Some(false));
    assert_eq!(response.attachment.status, "active");
    assert_eq!(response.attachment.permission_id, None);
    assert_eq!(response.attachment.mode, "observe");
}

#[test]
fn attach_control_requires_permission_before_it_becomes_controller() {
    let root = test_root();
    let session_id = "terminal-session-permission";
    let pending = attach_agent(attach_request(
        &root,
        session_id,
        "agent-control",
        "control",
    ))
    .expect("attach control pending");

    assert_eq!(pending.status.as_deref(), Some("needsApproval"));
    assert_eq!(pending.needs_approval, Some(true));
    assert_eq!(pending.attachment.status, "paused");
    assert!(pending.permission_id.is_some());

    let list = list_attachments(TerminalAttachmentListRequest {
        session_id: Some(session_id.to_string()),
        agent_session_id: None,
        include_detached: Some(true),
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("list attachments");
    assert_eq!(
        list.items
            .iter()
            .filter(|item| item.status == "active" && item.mode != "observe")
            .count(),
        0
    );

    let mut approved = attach_request(&root, session_id, "agent-control", "control");
    approved.permission_id = Some("permission-control".to_string());
    let active = attach_agent(approved).expect("attach control approved");
    assert_eq!(active.status.as_deref(), Some("active"));
    assert_eq!(active.attachment.status, "active");
    assert_eq!(
        active.attachment.permission_id.as_deref(),
        Some("permission-control")
    );
}

#[test]
fn detach_revokes_write_capability() {
    let root = test_root();
    let session_id = "terminal-session-detach";
    let mut request = attach_request(&root, session_id, "agent-detach", "control");
    request.permission_id = Some("permission-detach".to_string());
    let attached = attach_agent(request).expect("attach control");

    let allowed = authorize_attachment_write(TerminalAttachmentWriteRequest {
        session_id: session_id.to_string(),
        attachment_id: Some(attached.attachment.attachment_id.clone()),
        agent_session_id: Some("agent-detach".to_string()),
        source: Some("agent".to_string()),
        reason: Some("before detach".to_string()),
        storage_root: Some(root.clone()),
        actor_json: Some(agent_actor("agent-detach")),
        correlation_json: Some(correlation("agent-detach", "terminal.write")),
    })
    .expect("authorize before detach");
    assert!(allowed.allowed);

    detach_agent(TerminalAttachmentDetachRequest {
        session_id: session_id.to_string(),
        attachment_id: attached.attachment.attachment_id.clone(),
        reason: Some("done".to_string()),
        storage_root: Some(root.clone()),
        actor_json: Some(agent_actor("agent-detach")),
        correlation_json: Some(correlation("agent-detach", "terminal_detach_agent")),
    })
    .expect("detach");

    let denied = authorize_attachment_write(TerminalAttachmentWriteRequest {
        session_id: session_id.to_string(),
        attachment_id: Some(attached.attachment.attachment_id),
        agent_session_id: Some("agent-detach".to_string()),
        source: Some("agent".to_string()),
        reason: Some("after detach".to_string()),
        storage_root: Some(root),
        actor_json: Some(agent_actor("agent-detach")),
        correlation_json: Some(correlation("agent-detach", "terminal.write")),
    })
    .expect("authorize after detach");
    assert!(!denied.allowed);
    assert_eq!(denied.status, "detached");
}

#[test]
fn concurrent_agent_control_is_rejected_without_takeover() {
    let root = test_root();
    let session_id = "terminal-session-concurrent";
    let mut first = attach_request(&root, session_id, "agent-one", "control");
    first.permission_id = Some("permission-one".to_string());
    attach_agent(first).expect("first controller");

    let mut second = attach_request(&root, session_id, "agent-two", "control");
    second.permission_id = Some("permission-two".to_string());
    let response = attach_agent(second).expect("second conflict");

    assert_eq!(response.status.as_deref(), Some("conflict"));
    assert!(response.conflict_with_attachment_id.is_some());
    assert_eq!(response.attachment.status, "revoked");
}

#[test]
fn human_input_during_agent_control_pauses_controller_and_records_conflict() {
    let root = test_root();
    let session_id = "terminal-session-human-conflict";
    let mut request = attach_request(&root, session_id, "agent-human", "control");
    request.permission_id = Some("permission-human".to_string());
    let attached = attach_agent(request).expect("attach control");

    let response = authorize_attachment_write(TerminalAttachmentWriteRequest {
        session_id: session_id.to_string(),
        attachment_id: None,
        agent_session_id: None,
        source: Some("user".to_string()),
        reason: Some("typed in terminal".to_string()),
        storage_root: Some(root.clone()),
        actor_json: Some(json!({ "kind": "human_user" }).to_string()),
        correlation_json: Some(json!({ "terminalTabId": "tab-1" }).to_string()),
    })
    .expect("human write");

    assert!(response.allowed);
    assert_eq!(response.status, "humanInterrupted");
    assert_eq!(
        response.attachment_id.as_deref(),
        Some(attached.attachment.attachment_id.as_str())
    );

    let listed = list_attachments(TerminalAttachmentListRequest {
        session_id: Some(session_id.to_string()),
        agent_session_id: None,
        include_detached: Some(true),
        storage_root: Some(root.clone()),
        actor_json: None,
        correlation_json: None,
    })
    .expect("list");
    let paused = listed
        .items
        .iter()
        .find(|item| item.attachment_id == attached.attachment.attachment_id)
        .expect("paused attachment");
    assert_eq!(paused.status, "paused");

    let journal = fs::read_to_string(attachments_journal(&root, session_id)).expect("journal");
    assert!(journal.contains("human_input_conflict"));
}

#[test]
fn child_agent_launch_creates_delegated_attachment_and_audit_record() {
    let root = test_root();
    let session_id = "terminal-session-child-agent";
    let response = launch_terminal_agent(TerminalAgentLaunchRequest {
        session_id: session_id.to_string(),
        parent_agent_session_id: "agent-parent".to_string(),
        child_agent_session_id: Some("agent-child".to_string()),
        runtime_turn_id: Some("turn-child".to_string()),
        tool_call_id: Some("tool-child".to_string()),
        permission_id: Some("permission-child".to_string()),
        permission_scope: Some(json!({ "kind": "toolCall" }).to_string()),
        approved: None,
        command: Some("npm test".to_string()),
        cwd: Some("/workspace".to_string()),
        reason: Some("delegate tests".to_string()),
        ttl_ms: Some(60_000.0),
        storage_root: Some(root.clone()),
        actor_json: Some(agent_actor("agent-parent")),
        correlation_json: Some(correlation("agent-parent", "terminal_child_agent")),
    })
    .expect("launch child");

    assert_eq!(response.status, "active");
    assert_eq!(response.attachment.mode, "delegated");
    assert_eq!(
        response.attachment.parent_agent_session_id.as_deref(),
        Some("agent-parent")
    );
    assert_eq!(
        response.attachment.child_agent_session_id.as_deref(),
        Some("agent-child")
    );
    assert_eq!(response.relation.child_agent_session_id, "agent-child");

    let journal = fs::read_to_string(attachments_journal(&root, session_id)).expect("journal");
    assert!(journal.contains("terminal_child_agent_launched"));
    assert!(journal.contains("agent-child"));
}

#[test]
fn revoked_scope_blocks_further_agent_input() {
    let root = test_root();
    let session_id = "terminal-session-revoked";
    let mut first = attach_request(&root, session_id, "agent-revoked", "control");
    first.permission_id = Some("permission-revoked".to_string());
    let first = attach_agent(first).expect("first controller");

    let mut takeover = attach_request(&root, session_id, "agent-takeover", "takeover");
    takeover.permission_id = Some("permission-takeover".to_string());
    let takeover = attach_agent(takeover).expect("takeover");
    assert_eq!(takeover.status.as_deref(), Some("active"));

    let denied = authorize_attachment_write(TerminalAttachmentWriteRequest {
        session_id: session_id.to_string(),
        attachment_id: Some(first.attachment.attachment_id),
        agent_session_id: Some("agent-revoked".to_string()),
        source: Some("agent".to_string()),
        reason: Some("after takeover".to_string()),
        storage_root: Some(root),
        actor_json: Some(agent_actor("agent-revoked")),
        correlation_json: Some(correlation("agent-revoked", "terminal.write")),
    })
    .expect("authorize revoked");

    assert!(!denied.allowed);
    assert_eq!(denied.status, "revoked");
}
