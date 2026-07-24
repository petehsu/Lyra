#[allow(dead_code)]
#[path = "../src/input_controller.rs"]
mod input_controller;
#[allow(dead_code)]
#[path = "../src/permissions.rs"]
mod permissions;
#[allow(dead_code)]
#[path = "../src/sensitive_input.rs"]
mod sensitive_input;

use input_controller::{
    expand_key_stroke, InputController, InputExecutionStatus, KeyStroke, PlannedTerminalOperation,
    SemanticInputAction, SemanticInputRequest,
};
use permissions::{
    PermissionResponse, TerminalPermissionDecision, TerminalPermissionRisk, TerminalPermissionScope,
};
use sensitive_input::{assert_no_secret_material_in_journal, SecretRef, SensitiveText};

fn approve_once(
    controller: &mut InputController,
    first: &input_controller::InputExecutionResult,
    request: &SemanticInputRequest,
) {
    controller.permissions_mut().respond(PermissionResponse {
        permission_id: first.permission_id.clone().expect("permission id"),
        session_id: request.session_id.clone(),
        input_id: first.input_id.clone(),
        action: request.action.as_contract_name().to_string(),
        decision: TerminalPermissionDecision::Allow,
        risk: first.risk,
        scope: TerminalPermissionScope::one_shot(request.session_id.clone()),
        reason: Some("approved".to_string()),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
        now_ms: request.now_ms,
    });
}

#[test]
fn run_command_asks_one_permission_then_expands_after_approval() {
    let mut controller = InputController::new();
    let mut request = SemanticInputRequest::run_command("terminal-session-1", "npm test", 1000);
    request.actor_json = Some(r#"{"kind":"agent","agentSessionId":"agent-1"}"#.to_string());
    request.correlation_json =
        Some(r#"{"agentSessionId":"agent-1","terminalToolName":"terminal_run"}"#.to_string());

    let first = controller.plan(request.clone());

    assert_eq!(first.status, InputExecutionStatus::NeedsApproval);
    assert_eq!(first.risk, TerminalPermissionRisk::Shell);
    assert_eq!(first.operations.len(), 0);
    assert_eq!(
        first
            .events
            .iter()
            .filter(|event| event.kind == "permission_requested")
            .count(),
        1
    );
    assert_eq!(first.events[0].kind, "input_intent");
    assert_eq!(first.events[0].actor_json, request.actor_json);
    assert_eq!(first.events[0].correlation_json, request.correlation_json);

    approve_once(&mut controller, &first, &request);
    request.input_id = Some(first.input_id.clone());
    let approved = controller.plan(request);

    assert_eq!(approved.status, InputExecutionStatus::Expanded);
    assert_eq!(approved.permission_id, first.permission_id);
    assert!(approved
        .events
        .iter()
        .any(|event| event.kind == "input_expanded"));
    assert_eq!(approved.operations.len(), 1);
    assert_eq!(
        approved.operations[0],
        PlannedTerminalOperation::WriteBytes {
            bytes: b"npm test\n".to_vec(),
            redacted_preview: "npm test".to_string()
        }
    );
}

#[test]
fn press_keys_asks_once_for_batch_and_expands_all_keys() {
    let mut controller = InputController::new();
    let mut request = SemanticInputRequest::press_keys(
        "terminal-session-1",
        vec![
            KeyStroke::new("1"),
            KeyStroke::new("2"),
            KeyStroke::new("3"),
            KeyStroke::new("enter"),
        ],
        1000,
    );

    let first = controller.plan(request.clone());

    assert_eq!(first.status, InputExecutionStatus::NeedsApproval);
    assert_eq!(
        first
            .events
            .iter()
            .filter(|event| event.kind == "permission_requested")
            .count(),
        1
    );
    approve_once(&mut controller, &first, &request);
    request.input_id = Some(first.input_id.clone());
    let approved = controller.plan(request);

    assert_eq!(approved.status, InputExecutionStatus::Expanded);
    assert_eq!(approved.operations.len(), 1);
    assert_eq!(
        approved.operations[0],
        PlannedTerminalOperation::WriteBytes {
            bytes: b"123\r".to_vec(),
            redacted_preview: "1 2 3 enter".to_string()
        }
    );
}

#[test]
fn denied_permission_does_not_expand_terminal_bytes() {
    let mut controller = InputController::new();
    let mut request =
        SemanticInputRequest::run_command("terminal-session-1", "rm -rf /tmp/x", 1000);
    let first = controller.plan(request.clone());
    controller.permissions_mut().respond(PermissionResponse {
        permission_id: first.permission_id.clone().expect("permission id"),
        session_id: request.session_id.clone(),
        input_id: first.input_id.clone(),
        action: request.action.as_contract_name().to_string(),
        decision: TerminalPermissionDecision::Deny,
        risk: first.risk,
        scope: TerminalPermissionScope::one_shot(request.session_id.clone()),
        reason: Some("dangerous command rejected".to_string()),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
        now_ms: request.now_ms,
    });
    request.input_id = Some(first.input_id);

    let denied = controller.plan(request);

    assert_eq!(denied.status, InputExecutionStatus::Denied);
    assert!(denied.operations.is_empty());
    assert!(denied
        .events
        .iter()
        .any(|event| event.kind == "input_rejected"));
}

#[test]
fn sensitive_refs_are_planned_without_plaintext_or_ref_ids_in_journal() {
    let mut controller = InputController::new();
    let secret_ref = SecretRef {
        ref_id: "secret-value-123".to_string(),
        label: Some("npm-token".to_string()),
        purpose: Some("registry auth".to_string()),
    };
    let mut request = SemanticInputRequest::run_command("terminal-session-1", "ignored", 1000);
    request.action = SemanticInputAction::PasteText;
    request.command = None;
    request.text = None;
    request.secret_refs = vec![secret_ref.clone()];
    request.bracketed_paste = true;

    let first = controller.plan(request.clone());
    approve_once(&mut controller, &first, &request);
    request.input_id = Some(first.input_id);
    let approved = controller.plan(request);

    assert_eq!(approved.status, InputExecutionStatus::Expanded);
    assert_eq!(
        approved.operations[0],
        PlannedTerminalOperation::PasteSecretRefs {
            secret_refs: vec![secret_ref],
            bracketed_paste: true,
            redacted_preview: "[secret:npm-token]".to_string()
        }
    );
    let preview = approved
        .events
        .iter()
        .find(|event| event.kind == "input_expanded")
        .and_then(|event| event.redacted_preview.as_deref())
        .expect("redacted preview");
    assert_eq!(preview, "[secret:npm-token]");
    assert_no_secret_material_in_journal(
        preview,
        &SensitiveText::refs(vec![SecretRef {
            ref_id: "secret-value-123".to_string(),
            label: Some("npm-token".to_string()),
            purpose: None,
        }]),
    )
    .expect("journal redaction");
}

#[test]
fn portable_keys_support_ctrl_alt_function_and_navigation() {
    assert_eq!(
        expand_key_stroke(&KeyStroke::new("ctrl_c")).expect("ctrl-c"),
        vec![3]
    );
    assert_eq!(
        expand_key_stroke(&KeyStroke::new("alt_x")).expect("alt-x"),
        vec![0x1b, b'x']
    );
    assert_eq!(
        expand_key_stroke(&KeyStroke::new("page_down")).expect("page down"),
        b"\x1b[6~".to_vec()
    );
    assert_eq!(
        expand_key_stroke(&KeyStroke {
            key: "f5".to_string(),
            repeat: 2,
            delay_ms: Some(10),
        })
        .expect("f5 repeat"),
        b"\x1b[15~\x1b[15~".to_vec()
    );
}
