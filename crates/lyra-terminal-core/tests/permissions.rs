#[allow(dead_code)]
#[path = "../src/permissions.rs"]
mod permissions;

use permissions::{
    PermissionEvaluationRequest, PermissionPolicyEngine, PermissionResponse,
    TerminalPermissionDecision, TerminalPermissionRisk, TerminalPermissionScope,
};

fn request(now_ms: i64) -> PermissionEvaluationRequest {
    PermissionEvaluationRequest {
        session_id: "terminal-session-1".to_string(),
        input_id: "input-1".to_string(),
        action: "runCommand".to_string(),
        risk: TerminalPermissionRisk::Shell,
        command_text: Some("npm test".to_string()),
        cwd: Some("/workspace".to_string()),
        project_root: Some("/workspace".to_string()),
        agent_session_id: Some("agent-1".to_string()),
        runtime_turn_id: Some("turn-1".to_string()),
        tool_call_id: Some("tool-1".to_string()),
        redacted_preview: Some("npm test".to_string()),
        actor_json: Some(r#"{"kind":"agent","agentSessionId":"agent-1"}"#.to_string()),
        correlation_json: Some(r#"{"agentSessionId":"agent-1"}"#.to_string()),
        now_ms,
    }
}

fn allow(
    engine: &mut PermissionPolicyEngine,
    evaluation: &permissions::PermissionEvaluation,
    request: &PermissionEvaluationRequest,
    scope: TerminalPermissionScope,
) {
    engine.respond(PermissionResponse {
        permission_id: evaluation.permission_id.clone().expect("permission id"),
        session_id: request.session_id.clone(),
        input_id: request.input_id.clone(),
        action: request.action.clone(),
        decision: TerminalPermissionDecision::Allow,
        risk: request.risk,
        scope,
        reason: Some("approved".to_string()),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
        now_ms: request.now_ms,
    });
}

#[test]
fn approved_ttl_scope_is_reused_until_it_expires() {
    let mut engine = PermissionPolicyEngine::new();
    let first_request = request(1000);
    let first = engine.evaluate(&first_request);
    assert_eq!(first.decision, TerminalPermissionDecision::NeedsApproval);
    allow(
        &mut engine,
        &first,
        &first_request,
        TerminalPermissionScope::time_limited("terminal-session-1", 2000),
    );

    let reused = engine.evaluate(&request(1500));
    assert_eq!(reused.decision, TerminalPermissionDecision::Allow);
    assert_eq!(reused.permission_id, first.permission_id);

    let expired = engine.evaluate(&request(2500));
    assert_eq!(expired.decision, TerminalPermissionDecision::Expired);
    assert!(expired.recoverable);
    assert_eq!(
        expired.event.expect("expired event").kind,
        permissions::PermissionEventKind::PermissionExpired
    );
}

#[test]
fn revoked_scope_blocks_matching_action_recoverably() {
    let mut engine = PermissionPolicyEngine::new();
    let base = request(1000);
    let first = engine.evaluate(&base);
    allow(
        &mut engine,
        &first,
        &base,
        TerminalPermissionScope::session("terminal-session-1"),
    );
    assert_eq!(
        engine.evaluate(&request(1100)).decision,
        TerminalPermissionDecision::Allow
    );

    engine.revoke(
        &request(1200),
        "permission-revoked-1",
        TerminalPermissionScope::session("terminal-session-1"),
    );
    let revoked = engine.evaluate(&request(1300));

    assert_eq!(revoked.decision, TerminalPermissionDecision::Revoked);
    assert!(revoked.recoverable);
    assert_eq!(
        revoked.event.expect("revoked event").kind,
        permissions::PermissionEventKind::PermissionRevoked
    );
}

#[test]
fn command_cwd_tool_call_and_agent_scopes_match_only_their_bound_context() {
    let mut command_engine = PermissionPolicyEngine::new();
    let base = request(1000);
    let first = command_engine.evaluate(&base);
    allow(
        &mut command_engine,
        &first,
        &base,
        TerminalPermissionScope::command_pattern("terminal-session-1", "npm *"),
    );
    assert_eq!(
        command_engine.evaluate(&request(1100)).decision,
        TerminalPermissionDecision::Allow
    );
    let mut different_command = request(1100);
    different_command.command_text = Some("git status".to_string());
    assert_eq!(
        command_engine.evaluate(&different_command).decision,
        TerminalPermissionDecision::NeedsApproval
    );

    let mut cwd_engine = PermissionPolicyEngine::new();
    let first = cwd_engine.evaluate(&base);
    allow(
        &mut cwd_engine,
        &first,
        &base,
        TerminalPermissionScope::cwd("terminal-session-1", "/workspace"),
    );
    assert_eq!(
        cwd_engine.evaluate(&request(1100)).decision,
        TerminalPermissionDecision::Allow
    );
    let mut outside_cwd = request(1100);
    outside_cwd.cwd = Some("/tmp".to_string());
    outside_cwd.project_root = Some("/tmp".to_string());
    assert_eq!(
        cwd_engine.evaluate(&outside_cwd).decision,
        TerminalPermissionDecision::NeedsApproval
    );

    let mut tool_engine = PermissionPolicyEngine::new();
    let first = tool_engine.evaluate(&base);
    allow(
        &mut tool_engine,
        &first,
        &base,
        TerminalPermissionScope::tool_call("terminal-session-1", "tool-1"),
    );
    assert_eq!(
        tool_engine.evaluate(&request(1100)).decision,
        TerminalPermissionDecision::Allow
    );
    let mut other_tool = request(1100);
    other_tool.tool_call_id = Some("tool-2".to_string());
    assert_eq!(
        tool_engine.evaluate(&other_tool).decision,
        TerminalPermissionDecision::NeedsApproval
    );

    let mut agent_engine = PermissionPolicyEngine::new();
    let first = agent_engine.evaluate(&base);
    allow(
        &mut agent_engine,
        &first,
        &base,
        TerminalPermissionScope::agent_session("terminal-session-1", "agent-1"),
    );
    assert_eq!(
        agent_engine.evaluate(&request(1100)).decision,
        TerminalPermissionDecision::Allow
    );
    let mut other_agent = request(1100);
    other_agent.agent_session_id = Some("agent-2".to_string());
    assert_eq!(
        agent_engine.evaluate(&other_agent).decision,
        TerminalPermissionDecision::NeedsApproval
    );
}

#[test]
fn deny_scope_returns_stable_recoverable_denial() {
    let mut engine = PermissionPolicyEngine::new();
    let base = request(1000);
    let first = engine.evaluate(&base);
    engine.deny(
        &first,
        &base,
        TerminalPermissionScope::session("terminal-session-1"),
    );

    let denied = engine.evaluate(&request(1100));

    assert_eq!(denied.decision, TerminalPermissionDecision::Deny);
    assert!(denied.recoverable);
    assert_eq!(
        denied.event.expect("denied event").kind,
        permissions::PermissionEventKind::PermissionDenied
    );
}

#[test]
fn no_risk_actions_are_allowed_without_permission_event() {
    let mut engine = PermissionPolicyEngine::new();
    let mut read_only = request(1000);
    read_only.risk = TerminalPermissionRisk::None;

    let evaluation = engine.evaluate(&read_only);

    assert_eq!(evaluation.decision, TerminalPermissionDecision::Allow);
    assert!(evaluation.permission_id.is_none());
    assert!(evaluation.event.is_none());
}
