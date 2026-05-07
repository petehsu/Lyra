use super::*;
use crate::storage::{AgentResolveClarificationRequest, AgentSession};
use rusqlite::params;
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

fn send_with_root(storage_root: &str, workspace_root: &str, text: &str) -> SendTurnResult {
    send_turn(SendTurnRequest {
        storage: storage_request(storage_root),
        session_id: None,
        input: turn_input(text),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace_root.to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send turn")
}

#[test]
fn send_turn_writes_intent_for_chat_task_planning_and_continuation() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let cases = [
        ("hello there", "chat", None),
        ("实现一个小的 runtime ledger 改动", "task_execution", None),
        ("please make a plan first", "planning_request", Some("plan")),
        (
            "continue the previous work",
            "multi_turn_continuation",
            None,
        ),
    ];

    for (text, expected, mode) in cases {
        let mut options = RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace.clone()),
            ..RuntimeThreadOptions::default()
        };
        if let Some(mode) = mode {
            options.collaboration_mode = Some(mode.to_string());
        }
        let result = send_turn(SendTurnRequest {
            storage: storage_request(&storage_root),
            session_id: None,
            input: turn_input(text),
            options,
        })
        .expect("send turn");
        let store = AiStore::open(Some(&storage_root)).expect("store");
        let envelopes = store
            .read_user_intent_envelopes_for_test(&result.session_id)
            .expect("intents");
        assert_eq!(envelopes.last().expect("intent").kind, expected);
    }
}

#[test]
fn explicit_ui_action_beats_semantic_inference_and_stale_target_blocks() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: "Intent test".to_string(),
        profile_id: Some("profile-test".to_string()),
        project_root: Some(workspace.clone()),
        project_name: Some("workspace".to_string()),
        collaboration_mode: "default".to_string(),
        created_at: now,
        updated_at: now,
    };
    store.upsert_session_index(&session).expect("session");
    store
        .with_session_conn(&session.id, |_| Ok(()))
        .expect("db");
    let plan = store
        .create_planning_session(
            &session.id,
            None,
            "Plan",
            "Ship work",
            json!({ "type": "test" }),
            json!({ "steps": [] }),
        )
        .expect("plan");

    let mut input = turn_input("this is unrelated chat");
    input.ui_action = Some(RuntimeTurnUiAction {
        action_id: "ui-plan-approve".to_string(),
        kind: "plan_approval".to_string(),
        target_kind: "plan".to_string(),
        target_id: plan.plan_id.clone(),
    });
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: Some(session.id.clone()),
        input,
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace.clone()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    assert_eq!(
        result.detail.intent_summary.expect("intent").kind,
        "plan_approval"
    );
    let envelopes = store
        .read_user_intent_envelopes_for_test(&result.session_id)
        .expect("intents");
    assert!(envelopes
        .last()
        .expect("intent")
        .classification_evidence_refs
        .iter()
        .any(|evidence| evidence == "active_plan_panel_present"));

    let mut stale_input = turn_input("approve it");
    stale_input.ui_action = Some(RuntimeTurnUiAction {
        action_id: "ui-plan-approve-stale".to_string(),
        kind: "plan_approval".to_string(),
        target_kind: "plan".to_string(),
        target_id: "plan-missing".to_string(),
    });
    let stale = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: Some(session.id),
        input: stale_input,
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    assert_eq!(stale.detail.turns.last().expect("turn").status, "paused");
    assert!(stale
        .detail
        .pending_interactions
        .iter()
        .any(
            |interaction| interaction.get("kind").and_then(Value::as_str) == Some("clarification")
        ));
}

#[test]
fn normal_text_does_not_bind_pending_plan_without_explicit_resolution() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let first = send_with_root(&storage_root, &workspace, "hello");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    store
        .create_planning_session(
            &first.session_id,
            None,
            "Plan",
            "Ship work",
            json!({ "type": "test" }),
            json!({ "steps": [] }),
        )
        .expect("plan");
    let second = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: Some(first.session_id),
        input: turn_input("what is the current architecture?"),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    let summary = second.detail.intent_summary.expect("intent");
    assert_eq!(summary.kind, "chat");
    assert!(summary.target_bindings.is_empty());
}

#[test]
fn file_references_resolve_inside_workspace_and_reject_outside_or_symlink_escape() {
    let temp = tempfile::tempdir().expect("tempdir");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    fs::write(workspace.join("README.md"), "hello").expect("file");
    fs::write(temp.path().join("outside.txt"), "secret").expect("outside");
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        temp.path().join("outside.txt"),
        workspace.join("escape.txt"),
    )
    .expect("symlink");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let input = RuntimeTurnInput {
        text: "inspect refs".to_string(),
        attachments: Vec::new(),
        parts: vec![
            RuntimeTurnInputPart::Text {
                text: "inspect ".to_string(),
            },
            RuntimeTurnInputPart::Attachment {
                attachment: RuntimeTurnAttachment {
                    name: "README.md".to_string(),
                    path: workspace.join("README.md").to_string_lossy().to_string(),
                    kind: "file".to_string(),
                    context_text: None,
                },
            },
            RuntimeTurnInputPart::Attachment {
                attachment: RuntimeTurnAttachment {
                    name: "outside.txt".to_string(),
                    path: temp
                        .path()
                        .join("outside.txt")
                        .to_string_lossy()
                        .to_string(),
                    kind: "file".to_string(),
                    context_text: None,
                },
            },
            RuntimeTurnInputPart::Attachment {
                attachment: RuntimeTurnAttachment {
                    name: "escape.txt".to_string(),
                    path: workspace.join("escape.txt").to_string_lossy().to_string(),
                    kind: "file".to_string(),
                    context_text: None,
                },
            },
        ],
        ui_action: None,
    };
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input,
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace.to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let resolutions = store
        .read_reference_resolutions_for_test(&result.session_id)
        .expect("resolutions");
    assert!(resolutions
        .iter()
        .any(|entry| entry.status == "resolved" && entry.content_hash.is_some()));
    assert!(
        resolutions
            .iter()
            .filter(|entry| entry.status == "permission_blocked")
            .count()
            >= 1
    );
}

#[test]
fn message_references_resolve_and_artifact_tool_result_cross_session_refs_are_rejected() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let first = send_with_root(&storage_root, &workspace, "seed message");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let tool_blob = store
        .append_tool_result_blob(
            &first.session_id,
            &first.turn_id,
            "op-seed",
            "/tools/filesystem/read_file",
            "completed",
            "{\"content\":\"ok\"}",
        )
        .expect("tool result");
    let artifact_id = store
        .append_patch_artifact_and_evidence(
            &first.session_id,
            &first.turn_id,
            "op-seed",
            "Seed artifact",
            &tool_blob.result_ref,
            json!({}),
            json!([]),
        )
        .expect("artifact")
        .artifact_id;

    let message_input = RuntimeTurnInput {
        text: "use message".to_string(),
        attachments: Vec::new(),
        parts: vec![RuntimeTurnInputPart::Attachment {
            attachment: RuntimeTurnAttachment {
                name: "message".to_string(),
                path: format!("message:{}", first.detail.messages[0].id),
                kind: "message".to_string(),
                context_text: None,
            },
        }],
        ui_action: None,
    };
    let same_session = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: Some(first.session_id.clone()),
        input: message_input,
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace.clone()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("message ref send");
    let same_resolutions = store
        .read_reference_resolutions_for_test(&same_session.session_id)
        .expect("same resolutions");
    assert!(same_resolutions
        .iter()
        .any(|entry| entry.kind == "message" && entry.status == "resolved"));

    let cross_input = RuntimeTurnInput {
        text: "use cross session refs".to_string(),
        attachments: Vec::new(),
        parts: vec![
            RuntimeTurnInputPart::Attachment {
                attachment: RuntimeTurnAttachment {
                    name: "artifact".to_string(),
                    path: format!("artifact:{artifact_id}"),
                    kind: "artifact".to_string(),
                    context_text: None,
                },
            },
            RuntimeTurnInputPart::Attachment {
                attachment: RuntimeTurnAttachment {
                    name: "tool result".to_string(),
                    path: format!("tool_result:{}", tool_blob.result_ref),
                    kind: "tool_result".to_string(),
                    context_text: None,
                },
            },
        ],
        ui_action: None,
    };
    let cross_session = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: cross_input,
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("cross ref send");
    let cross_resolutions = store
        .read_reference_resolutions_for_test(&cross_session.session_id)
        .expect("cross resolutions");
    assert_eq!(
        cross_resolutions
            .iter()
            .filter(|entry| entry.status == "unresolved")
            .count(),
        2
    );
}

#[test]
fn ambiguous_risky_request_creates_question_and_low_risk_task_creates_assumption() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let blocked = send_with_root(&storage_root, &workspace, "delete it");
    assert_eq!(blocked.detail.turns.last().expect("turn").status, "paused");
    assert!(
        blocked
            .detail
            .clarification_summary
            .expect("clarification")
            .pending
            .len()
            == 1
    );
    assert_eq!(blocked.detail.messages.len(), 1);

    fs::write(temp.path().join("README.md"), "old").expect("readme");
    let input = RuntimeTurnInput {
        text: "update README using project style".to_string(),
        attachments: Vec::new(),
        parts: vec![RuntimeTurnInputPart::Attachment {
            attachment: RuntimeTurnAttachment {
                name: "README.md".to_string(),
                path: temp.path().join("README.md").to_string_lossy().to_string(),
                kind: "file".to_string(),
                context_text: None,
            },
        }],
        ui_action: None,
    };
    let assumed = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input,
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    assert!(
        assumed
            .detail
            .assumption_summary
            .expect("assumptions")
            .active
            .len()
            == 1
    );
}

#[test]
fn resolving_clarification_removes_pending_interaction_and_records_event() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let blocked = send_with_root(&storage_root, &workspace, "delete it");
    let ticket_id = blocked
        .detail
        .clarification_summary
        .as_ref()
        .expect("clarification")
        .pending[0]
        .question_ticket_id
        .clone();

    let resolved = resolve_clarification(AgentResolveClarificationRequest {
        storage: storage_request(&storage_root),
        session_id: blocked.session_id,
        question_ticket_id: ticket_id,
        selected_option_id: Some("D".to_string()),
        custom_answer: None,
        answer_text: None,
    })
    .expect("resolve");

    assert!(resolved.detail.pending_interactions.is_empty());
    assert!(resolved
        .detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "clarification_ticket_resolved"));
}

#[test]
fn message_rollback_supersedes_intake_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let workspace = temp.path().to_string_lossy().to_string();
    let first = send_with_root(&storage_root, &workspace, "hello");
    let target_message_id = first.detail.messages[0].id.clone();
    let second = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: Some(first.session_id.clone()),
        input: turn_input("delete it"),
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(workspace),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: first.session_id.clone(),
        target_user_message_id: target_message_id,
    })
    .expect("preview");
    execute_message_rollback(AgentExecuteMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: first.session_id.clone(),
        rollback_id: preview.rollback_id,
        confirmation_token: Some("restore".to_string()),
        strategy: Some("safe_only".to_string()),
    })
    .expect("execute");
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let statuses: Vec<String> = store
        .with_session_conn(&first.session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT status FROM user_intent_envelope WHERE runtime_turn_id = ?1
                 UNION ALL SELECT status FROM question_ticket WHERE runtime_turn_id = ?1",
            )?;
            let rows = stmt.query_map(params![second.turn_id], |row| row.get::<_, String>(0))?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
        .expect("statuses");
    assert!(statuses
        .iter()
        .all(|status| status == "superseded_by_rollback"));
}
