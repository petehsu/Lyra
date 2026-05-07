use super::turn_loop::run_tool_operation;
use super::*;
use crate::tool_runtime::catalog::{TOOL_FS_READ_FILE, TOOL_SHELL_RUN_COMMAND};
use crate::tool_runtime::{ToolExecutionContext, ToolFsOp, ToolOperationEnvelope};
use rusqlite::params;
use std::collections::HashSet;
use std::fs;

fn storage_request(storage_root: &str) -> StorageRequest {
    StorageRequest {
        storage_root: Some(storage_root.to_string()),
    }
}

fn turn_input(text: &str) -> RuntimeTurnInput {
    RuntimeTurnInput {
        text: text.to_string(),
        attachments: Vec::new(),
        parts: Vec::new(),
        ui_action: None,
    }
}

#[test]
fn runtime_turn_binds_policy_summary_and_malformed_manifest_warns() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let manifest_dir = temp.path().join(".lyra");
    fs::create_dir_all(&manifest_dir).expect("manifest dir");
    fs::write(
        manifest_dir.join("project.manifest.json"),
        r#"{ "schemaVersion": "v404" }"#,
    )
    .expect("manifest");

    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: turn_input("hello"),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");

    let policy = result.detail.policy_summary.expect("policy summary");
    assert_eq!(policy.source, "fallback_safe_default");
    assert!(policy
        .warnings
        .iter()
        .any(|warning| warning.contains("PROJECT_MANIFEST_INVALID")));
    assert_eq!(
        result
            .detail
            .security_summary
            .expect("security summary")
            .redaction_profile,
        "strict"
    );
}

#[test]
fn disabled_tool_is_blocked_by_policy_and_records_decision() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let manifest_dir = temp.path().join(".lyra");
    fs::create_dir_all(&manifest_dir).expect("manifest dir");
    fs::write(
        manifest_dir.join("project.manifest.json"),
        r#"{ "schemaVersion": "v1", "tools": { "disabled": ["/tools/filesystem/read_file"] } }"#,
    )
    .expect("manifest");
    fs::write(temp.path().join("README.md"), "hello").expect("file");
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: turn_input("inspect"),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-read".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_READ_FILE.to_string(),
        args: serde_json::json!({ "path": "README.md" }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_FS_READ_FILE.to_string()]);

    run_tool_operation(
        &store,
        &result.session_id,
        &result.turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::FullAccess,
        &mut messages,
        &mut inspected,
    )
    .expect("tool");

    let detail = store
        .read_session_detail(&result.session_id)
        .expect("detail")
        .expect("session");
    let security = detail.security_summary.expect("security");
    assert_eq!(security.status, "blocked");
    assert!(security
        .recent_decisions
        .iter()
        .any(|decision| decision.decision == "deny"
            && decision
                .reason_codes
                .contains(&"tool_disabled_by_policy".to_string())));
}

#[test]
fn sensitive_file_reference_is_blocked_before_resolution_projection() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let manifest_dir = temp.path().join(".lyra");
    fs::create_dir_all(&manifest_dir).expect("manifest dir");
    fs::write(
        manifest_dir.join("project.manifest.json"),
        r#"{ "schemaVersion": "v1", "security": { "sensitiveFileDefault": "deny" } }"#,
    )
    .expect("manifest");
    fs::write(temp.path().join(".env"), "API_KEY=sk-reference-secret").expect("env");

    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "read attached env".to_string(),
            attachments: vec![RuntimeTurnAttachment {
                name: ".env".to_string(),
                path: ".env".to_string(),
                kind: "file".to_string(),
                context_text: None,
            }],
            parts: Vec::new(),
            ui_action: None,
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");

    let reference_summary = result.detail.reference_summary.expect("reference summary");
    assert!(reference_summary
        .resolutions
        .iter()
        .any(|resolution| resolution.status == "permission_blocked"
            && resolution.reason.as_deref() == Some("security_resource_denied")));
    let security = result.detail.security_summary.expect("security");
    assert_eq!(security.status, "blocked");
    assert!(security.recent_decisions.iter().any(|decision| decision
        .reason_codes
        .contains(&"sensitive_file_policy_denied".to_string())));
}

#[test]
fn full_access_shell_output_is_redacted_and_records_security_decisions() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: turn_input("run command"),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-shell".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_SHELL_RUN_COMMAND.to_string(),
        args: serde_json::json!({
            "mode": "argv",
            "argv": ["printf", "api_key = sk-shell-secret\n"],
            "cwd": ".",
            "timeoutMs": 5_000,
            "outputLimitBytes": 8_192
        }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_SHELL_RUN_COMMAND.to_string()]);

    run_tool_operation(
        &store,
        &result.session_id,
        &result.turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::FullAccess,
        &mut messages,
        &mut inspected,
    )
    .expect("tool");

    let model_visible = messages
        .iter()
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(model_visible.contains("sk-shell-secret") == false);
    assert!(model_visible.contains("[REDACTED]"));
    let detail = store
        .read_session_detail(&result.session_id)
        .expect("detail")
        .expect("session");
    let security = detail.security_summary.expect("security");
    assert_eq!(security.status, "redacted");
    assert!(security
        .recent_decisions
        .iter()
        .any(|decision| decision.resource_kind == "tool" && decision.decision == "allow"));
    assert!(security
        .recent_decisions
        .iter()
        .any(|decision| decision.resource_kind == "tool_result"
            && decision.decision == "allow_redacted"
            && decision.redaction_applied));
}

#[test]
fn superseded_security_records_do_not_remain_active_blockers() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let manifest_dir = temp.path().join(".lyra");
    fs::create_dir_all(&manifest_dir).expect("manifest dir");
    fs::write(
        manifest_dir.join("project.manifest.json"),
        r#"{ "schemaVersion": "v1", "tools": { "disabled": ["/tools/filesystem/read_file"] } }"#,
    )
    .expect("manifest");
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: turn_input("inspect"),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    store
        .with_session_conn(&result.session_id, |conn| {
            conn.execute(
                "UPDATE effective_policy_snapshot
                 SET status = 'superseded_by_rollback'
                 WHERE session_id = ?1",
                params![&result.session_id],
            )?;
            conn.execute(
                "INSERT INTO security_decision_record (
                    decision_id, session_id, turn_id, operation_id, snapshot_id,
                    resource_kind, resource_ref, decision, reason_codes_json, risk_level,
                    redaction_applied, approval_ticket_id, evidence_refs_json, status,
                    created_at_ms, created_at_iso, superseded_by_rollback_id
                 ) VALUES (
                    'decision_old', ?1, ?2, NULL, NULL,
                    'tool', '/tools/filesystem/read_file', 'deny', '[\"tool_disabled_by_policy\"]', 'high',
                    0, NULL, '[]', 'superseded_by_rollback',
                    1, '1970-01-01T00:00:00.000Z', 'rollback_test'
                 )",
                params![&result.session_id, &result.turn_id],
            )?;
            Ok(())
        })
        .expect("supersede");

    let detail = store
        .read_session_detail(&result.session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.policy_summary.is_none());
    let security = detail.security_summary.expect("security");
    assert_eq!(security.status, "stale");
    assert!(security.recent_decisions.is_empty());
}
