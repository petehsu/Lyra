use super::*;
use crate::patch_apply::{resolve_agent_approval, AgentResolveApprovalRequest, ApprovalDecision};
use crate::storage::{AgentSession, AgentTurn, CreateLongWorkRunInput, CreatedTodoRefs};
use crate::tool_runtime::catalog::{TOOL_FS_APPLY_PATCH, TOOL_SHELL_RUN_COMMAND};
use std::fs;

fn storage_request(storage_root: &str) -> StorageRequest {
    StorageRequest {
        storage_root: Some(storage_root.to_string()),
    }
}

fn test_config() -> ProviderRuntimeConfig {
    ProviderRuntimeConfig {
        provider_id: "openai".to_string(),
        protocol_id: "openai_chat_completions".to_string(),
        base_url: "https://example.invalid/v1".to_string(),
        api_key: None,
        auth_scheme: None,
        headers: HashMap::new(),
        connection_config: HashMap::new(),
        model_runtime_metadata: None,
        model: "test-model".to_string(),
    }
}

fn seed_turn(store: &AiStore, workspace_root: &str) -> (String, String, String) {
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: "Test".to_string(),
        profile_id: Some("profile-test".to_string()),
        model_id: None,
        system_prompt: None,
        permission_mode: None,
        execution_target: None,
        project_root: Some(workspace_root.to_string()),
        project_name: Some("workspace".to_string()),
        collaboration_mode: "default".to_string(),
        created_at: now,
        updated_at: now,
    };
    store.upsert_session_index(&session).expect("session");
    let turn = AgentTurn {
        id: new_id("turn"),
        session_id: session.id.clone(),
        profile_id: "profile-test".to_string(),
        status: "running".to_string(),
        collaboration_mode: Some("default".to_string()),
        permission_mode: "sandbox".to_string(),
        execution_target: "host".to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    let user_message = AgentMessage {
        id: new_id("msg"),
        session_id: session.id.clone(),
        turn_id: Some(turn.id.clone()),
        role: "user".to_string(),
        content: "implement the requested change".to_string(),
        content_parts: None,
        display_content: Some("implement the requested change".to_string()),
        created_at: now,
    };
    store.append_message(&user_message).expect("message");
    store
        .insert_turn(&turn, &user_message.id, None)
        .expect("turn");
    let checkpoint_id = store
        .create_timeline_checkpoint(&session.id, &turn.id, &user_message.id)
        .expect("checkpoint");
    ensure_recovery_checkpoint_for_turn(
        store,
        &session,
        &turn.id,
        &user_message.id,
        &checkpoint_id,
    )
    .expect("recovery checkpoint");
    (session.id, turn.id, user_message.id)
}

fn seed_todo_for_tool(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    tool_path: &str,
) -> CreatedTodoRefs {
    store
        .create_execution_todo_list(
            session_id,
            Some(turn_id),
            "mini",
            "Execution checklist",
            json!({ "type": "test" }),
            &[CreateTodoItemInput {
                title: "Run tool".to_string(),
                actions: Vec::new(),
                expected_tools: vec![tool_path.to_string()],
                risk_level: "medium".to_string(),
                completion_criteria: vec!["Tool result is recorded".to_string()],
                source: json!({}),
            }],
        )
        .expect("todo")
}

fn seed_run_for_refs(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
    refs: &CreatedTodoRefs,
) -> String {
    store
        .create_long_work_run(CreateLongWorkRunInput {
            session_id: session_id.to_string(),
            runtime_turn_id: Some(turn_id.to_string()),
            user_message_id: Some(user_message_id.to_string()),
            plan_id: None,
            todo_list_id: refs.todo_list_id.clone(),
            execution_run_id: refs.execution_run_id.clone(),
            objective_summary: "Execute test work".to_string(),
            completion_contract: json!({ "type": "test" }),
            budget: json!({}),
            checkpoint_ids: Vec::new(),
        })
        .expect("work run")
        .summary
        .long_work_run_id
}

#[test]
fn long_work_plan_approve_with_valid_coverage_creates_run() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id, _message_id) =
        seed_turn(&store, workspace.to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Plan".to_string(),
        objective_summary: "Build the ledger".to_string(),
        source: None,
        version: json!({
            "sourceReferenceIds": ["plan-ref"],
            "steps": [{
                "id": "step-1",
                "title": "Add ledger",
                "expectedTools": [TOOL_FS_APPLY_PATCH],
                "completionCriteria": ["Ledger exists"],
                "riskLevel": "medium",
                "sourceReferenceIds": ["ref-1"]
            }]
        }),
    })
    .expect("plan");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        plan_id: created.plan_id.clone(),
        version_id: created.version_id.clone(),
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve");

    let summary = approved
        .detail
        .durable_work_summary
        .as_ref()
        .expect("work summary");
    assert_eq!(summary.status, "running");
    assert_eq!(summary.plan_id.as_deref(), Some(created.plan_id.as_str()));
    assert_eq!(summary.objective_summary, "Build the ledger");
    assert_eq!(summary.todo_progress.total, 1);
    assert!(approved.detail.runtime_events.iter().any(|event| {
        event.phase == "long_work.created"
            && event.payload["longWorkRunId"] == summary.long_work_run_id
            && event.payload["todoListId"] == summary.todo_list_id
            && event.payload["executionRunId"] == summary.execution_run_id
            && event.payload["status"] == "created"
    }));
    assert!(approved
        .detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "long_work.slice_started"));
}

#[test]
fn long_work_coverage_failed_does_not_create_run() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let (session_id, _turn_id, _message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Broken".to_string(),
        objective_summary: "Missing verification".to_string(),
        source: None,
        version: json!({
            "steps": [{ "id": "step-1", "title": "Do work", "riskLevel": "medium" }]
        }),
    })
    .expect("plan");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: created.plan_id,
        version_id: created.version_id,
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve");

    assert_eq!(
        approved
            .detail
            .plan_coverage_summary
            .as_ref()
            .expect("coverage")
            .status,
        "verification_missing"
    );
    assert!(approved.detail.durable_work_summary.is_none());
}

#[test]
fn long_work_mini_todo_creates_run_for_execution_request() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "实现一个小的 runtime ledger 改动".to_string(),
            attachments: Vec::new(),
            parts: Vec::new(),
            ui_action: None,
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send turn");

    let summary = result
        .detail
        .durable_work_summary
        .as_ref()
        .expect("work summary");
    assert_eq!(summary.status, "running");
    assert!(summary.plan_id.is_none());
    assert_eq!(summary.todo_progress.total, 4);
    assert_eq!(
        result.detail.active_todo.as_ref().expect("todo").kind,
        "mini"
    );
}

#[test]
fn long_work_pure_question_does_not_create_run() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "what is the current architecture?".to_string(),
            attachments: Vec::new(),
            parts: Vec::new(),
            ui_action: None,
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send turn");

    assert!(result.detail.active_todo.is_none());
    assert!(result.detail.durable_work_summary.is_none());
}

#[test]
fn long_work_approval_denied_keeps_run_blocked() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-shell".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_SHELL_RUN_COMMAND.to_string(),
        args: json!({ "mode": "argv", "argv": ["echo", "ok"], "cwd": "." }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_SHELL_RUN_COMMAND.to_string()]);

    run_tool_operation(
        &store,
        &session_id,
        &turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::Sandbox,
        &mut messages,
        &mut inspected,
    )
    .expect("approval required");
    let pending = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let approval_ticket_id = pending.pending_interactions[0]["payload"]["approvalTicketId"]
        .as_str()
        .expect("approval id")
        .to_string();

    resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id,
        decision: ApprovalDecision::Deny,
    })
    .expect("deny");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(
        detail.active_todo.as_ref().expect("todo").items[0].status,
        "failed"
    );
    let summary = detail.durable_work_summary.as_ref().expect("work summary");
    assert_eq!(summary.status, "blocked");
    assert_eq!(
        summary.blocker_summary.as_deref(),
        Some("Waiting for approval decision")
    );
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "long_work.blocked"
            && event.payload["sessionId"] == session_id
            && event.payload["turnId"] == turn_id
            && event.payload["longWorkRunId"] == summary.long_work_run_id
            && event.payload["todoListId"] == summary.todo_list_id
            && event.payload["executionRunId"] == summary.execution_run_id
            && event.payload["status"] == "blocked"
    }));
}

#[test]
fn long_work_unfinished_todo_cannot_complete() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);

    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");
    project_work_after_completion(&store, &session_id, Some(&turn_id)).expect("projection");
    let projection = project_work_after_model_candidate(
        &store,
        &session_id,
        Some(&turn_id),
        "Done. Everything is complete.",
    )
    .expect("candidate projection");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(projection.suppress_user_output);
    assert_eq!(
        detail.completion_audit.as_ref().expect("audit").status,
        "blocked"
    );
    assert_eq!(
        detail
            .durable_work_summary
            .as_ref()
            .expect("work summary")
            .status,
        "running"
    );
    let summary = detail.durable_work_summary.as_ref().expect("work summary");
    assert_eq!(
        summary.continuation.as_ref().expect("continuation").status,
        "queued"
    );
    assert_eq!(
        summary
            .premature_stop
            .as_ref()
            .expect("premature stop")
            .recommended_action,
        "auto_continue"
    );
    assert_eq!(
        summary
            .current_slice
            .as_ref()
            .expect("slice")
            .stop_cause
            .as_deref(),
        Some("completion_candidate")
    );
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "long_work.output_suppressed"
            && event.payload["longWorkRunId"] == summary.long_work_run_id
    }));
}

#[test]
fn long_work_completed_todo_and_audit_mark_run_completed() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-shell-pass".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_SHELL_RUN_COMMAND.to_string(),
        args: json!({ "mode": "argv", "argv": ["echo", "ok"], "cwd": "." }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_SHELL_RUN_COMMAND.to_string()]);

    run_tool_operation(
        &store,
        &session_id,
        &turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::FullAccess,
        &mut messages,
        &mut inspected,
    )
    .expect("tool operation");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let summary = detail.durable_work_summary.as_ref().expect("work summary");
    assert_eq!(summary.status, "completed");
    assert!(summary.continuation.is_none());
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "long_work.completed"
            && event.payload["sessionId"] == session_id
            && event.payload["turnId"] == turn_id
            && event.payload["longWorkRunId"] == summary.long_work_run_id
            && event.payload["todoListId"] == summary.todo_list_id
            && event.payload["executionRunId"] == summary.execution_run_id
            && event.payload["status"] == "completed"
    }));
}

#[test]
fn long_work_missing_verification_after_code_change_queues_continuation() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_FS_APPLY_PATCH);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    store
        .record_tool_execution_step(
            &session_id,
            &turn_id,
            TOOL_FS_APPLY_PATCH,
            "op-patch",
            "completed",
            "completed",
            vec!["evidence_patch".to_string()],
            vec!["artifact_patch".to_string()],
            Value::Null,
        )
        .expect("record step");
    store
        .create_verification_plan_for_changed_files(
            &session_id,
            &turn_id,
            "artifact_patch",
            json!([{ "path": "notes.unverified", "changeType": "modified" }]),
        )
        .expect("verification plan");
    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");

    let projection = project_work_after_model_candidate(
        &store,
        &session_id,
        Some(&turn_id),
        "Implemented and finished.",
    )
    .expect("candidate");
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let summary = detail.durable_work_summary.as_ref().expect("work summary");

    assert!(projection.suppress_user_output);
    assert_eq!(summary.status, "running");
    assert_eq!(
        summary.continuation.as_ref().expect("continuation").status,
        "queued"
    );
    assert!(summary
        .premature_stop
        .as_ref()
        .expect("premature stop")
        .missing_evidence
        .iter()
        .any(|item| item.starts_with("verification_run")));
}

#[test]
fn long_work_turn_loop_suppresses_premature_assistant_message() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);

    let mut invocations = 0;
    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::FullAccess,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            invocations += 1;
            Ok(ChatResponse::text(
                "Done. Everything is complete.".to_string(),
                None,
            ))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail
        .messages
        .iter()
        .all(|message| message.role != "assistant"));
    assert_eq!(invocations, 2);
    assert_eq!(
        detail
            .durable_work_summary
            .as_ref()
            .expect("work summary")
            .status,
        "stuck"
    );
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "long_work.auto_resuming"));
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "runtime_turn_completed"
            && event.payload["outputSuppressed"].as_bool() == Some(true)
    }));
}

#[test]
fn long_work_allows_many_tool_calls_before_completion_candidate() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(
        temp.path().join("Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    )
    .expect("cargo");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    let mut invocations = 0;

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::FullAccess,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            invocations += 1;
            if invocations <= 7 {
                return Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: format!("call-terminal-{invocations}"),
                        name: "terminal".to_string(),
                        arguments: json!({
                            "mode": "argv",
                            "argv": ["true"],
                            "cwd": ".",
                            "purpose": "Verify long work can keep using tools"
                        }),
                    }],
                });
            }
            Ok(ChatResponse::text("Done.".to_string(), None))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(invocations, 8);
    assert_eq!(
        detail
            .runtime_events
            .iter()
            .filter(|event| event.phase == "tool_operation_completed")
            .count(),
        7
    );
    assert!(detail
        .runtime_events
        .iter()
        .all(|event| event.phase != "long_work.continuation_queued"));
}

#[test]
fn long_work_pending_approval_blocks_without_auto_resume() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-shell-pending".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_SHELL_RUN_COMMAND.to_string(),
        args: json!({ "mode": "argv", "argv": ["echo", "ok"], "cwd": "." }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_SHELL_RUN_COMMAND.to_string()]);

    run_tool_operation(
        &store,
        &session_id,
        &turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::Sandbox,
        &mut messages,
        &mut inspected,
    )
    .expect("approval pending");
    let projection =
        project_work_after_model_candidate(&store, &session_id, Some(&turn_id), "I am done.")
            .expect("candidate");
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let summary = detail.durable_work_summary.as_ref().expect("work summary");

    assert!(projection.suppress_user_output == false);
    assert_eq!(summary.status, "blocked");
    assert!(summary.continuation.is_none());
    assert_eq!(
        summary.blocker_summary.as_deref(),
        Some("Waiting for approval decision")
    );
}

#[test]
fn long_work_no_progress_repeated_slices_enters_stuck() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");
    let first = project_work_after_model_candidate(&store, &session_id, Some(&turn_id), "Done.")
        .expect("first candidate");
    assert!(first.suppress_user_output);
    let continuation_id = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session")
        .durable_work_summary
        .as_ref()
        .expect("work summary")
        .continuation
        .as_ref()
        .expect("continuation")
        .continuation_id
        .clone();
    resume_work_continuation(&store, &session_id, &continuation_id).expect("resume");
    assert!(store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session")
        .runtime_events
        .iter()
        .any(|event| event.phase == "long_work.auto_resuming"));

    let second =
        project_work_after_model_candidate(&store, &session_id, Some(&turn_id), "Done again.")
            .expect("second candidate");
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let summary = detail.durable_work_summary.as_ref().expect("work summary");

    assert!(second.suppress_user_output);
    assert_eq!(summary.status, "stuck");
    assert_eq!(
        summary.stuck.as_ref().expect("stuck").suspected_cause,
        "model_looping"
    );
}

#[test]
fn long_work_repeated_same_tool_failure_enters_stuck() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    store
        .append_tool_result_blob(
            &session_id,
            &turn_id,
            "op-fail-1",
            TOOL_SHELL_RUN_COMMAND,
            "failed",
            "{}",
        )
        .expect("blob 1");
    store
        .append_tool_result_blob(
            &session_id,
            &turn_id,
            "op-fail-2",
            TOOL_SHELL_RUN_COMMAND,
            "failed",
            "{}",
        )
        .expect("blob 2");
    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");

    let projection =
        project_work_after_model_candidate(&store, &session_id, Some(&turn_id), "Done.")
            .expect("candidate");
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let summary = detail.durable_work_summary.as_ref().expect("work summary");

    assert!(projection.suppress_user_output);
    assert_eq!(summary.status, "stuck");
    assert_eq!(
        summary.stuck.as_ref().expect("stuck").suspected_cause,
        "same_tool_failure"
    );
}

#[test]
fn long_work_queued_continuation_survives_session_detail_reload() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");
    project_work_after_model_candidate(&store, &session_id, Some(&turn_id), "Done.")
        .expect("candidate");

    let reloaded = AiStore::open(Some(&storage_root)).expect("reopened");
    let detail = reloaded
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let continuation = detail
        .durable_work_summary
        .as_ref()
        .expect("work summary")
        .continuation
        .as_ref()
        .expect("continuation");

    assert_eq!(continuation.status, "queued");
    assert_eq!(continuation.next_slice_sequence, 2);
}

#[test]
fn long_work_recovery_does_not_replay_started_write_side_effect() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_FS_APPLY_PATCH);
    seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");
    let projection =
        project_work_after_model_candidate(&store, &session_id, Some(&turn_id), "Done.")
            .expect("candidate");
    assert!(projection.suppress_user_output);
    let continuation_id = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session")
        .durable_work_summary
        .as_ref()
        .expect("work summary")
        .continuation
        .as_ref()
        .expect("continuation")
        .continuation_id
        .clone();
    store
        .mark_long_work_continuation_started_side_effect_for_test(&session_id, &continuation_id)
        .expect("mark side effect");

    let detail = recover_work_continuation(&store, &session_id)
        .expect("recover")
        .expect("summary");

    assert_eq!(detail.status, "blocked");
    assert_eq!(
        detail.continuation.as_ref().expect("continuation").status,
        "blocked"
    );
    let events = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session")
        .runtime_events;
    assert!(events
        .iter()
        .any(|event| event.phase == "long_work.recovery_detected"));
    assert!(events
        .iter()
        .any(|event| event.phase == "long_work.blocked"));
}
