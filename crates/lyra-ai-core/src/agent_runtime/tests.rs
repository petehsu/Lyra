use super::*;
use crate::patch_apply::{resolve_agent_approval, AgentResolveApprovalRequest, ApprovalDecision};
use crate::storage::{AgentSession, AgentTurn};
use crate::tool_runtime::operation::TOOL_APPROVAL_DENIED;
use std::fs;

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

fn seed_turn(store: &AiStore, workspace_root: &str) -> (String, String) {
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: "Test".to_string(),
        profile_id: Some("profile-test".to_string()),
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
        content: "inspect the project".to_string(),
        content_parts: None,
        display_content: Some("inspect the project".to_string()),
        created_at: now,
    };
    store.append_message(&user_message).expect("message");
    store
        .insert_turn(&turn, &user_message.id, None)
        .expect("turn");
    store
        .create_timeline_checkpoint(&session.id, &turn.id, &user_message.id)
        .expect("checkpoint");
    (session.id, turn.id)
}

fn seed_patch_artifact(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    patch: &str,
    changed_files: Value,
) -> String {
    let blob = store
        .append_tool_result_blob(
            session_id,
            turn_id,
            "op-seed-propose",
            "/tools/filesystem/propose_patch",
            "completed",
            patch,
        )
        .expect("patch blob");
    let refs = store
        .append_patch_artifact_and_evidence(
            session_id,
            turn_id,
            "op-seed-propose",
            "Seed patch",
            &blob.result_ref,
            json!({
                "changedFiles": changed_files.clone(),
                "approvalPreview": {
                    "risk": { "level": "medium" }
                }
            }),
            changed_files,
        )
        .expect("patch artifact");
    refs.artifact_id
}

fn storage_request(storage_root: &str) -> StorageRequest {
    StorageRequest {
        storage_root: Some(storage_root.to_string()),
    }
}

fn seed_todo_for_tool(store: &AiStore, session_id: &str, turn_id: &str, tool_path: &str) {
    store
        .create_execution_todo_list(
            session_id,
            Some(turn_id),
            "mini",
            "Execution checklist",
            json!({ "type": "test" }),
            &[CreateTodoItemInput {
                title: "Run verification".to_string(),
                actions: Vec::new(),
                expected_tools: vec![tool_path.to_string()],
                risk_level: "medium".to_string(),
                completion_criteria: Vec::new(),
                source: json!({}),
            }],
        )
        .expect("todo");
}

#[test]
fn create_plan_records_planning_summary() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());

    let result = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Refactor runtime".to_string(),
        objective_summary: "Split planning state into Rust-owned storage".to_string(),
        source: Some(json!({ "type": "test" })),
        version: json!({
            "summary": "Add planning tables and review API",
            "steps": [
                { "id": "step-1", "title": "Add storage" },
                { "id": "step-2", "title": "Render review" }
            ]
        }),
    })
    .expect("create plan");

    let summary = result
        .detail
        .planning_summary
        .as_ref()
        .expect("planning summary");
    assert_eq!(summary.plan_id, result.plan_id);
    assert_eq!(summary.active_version_id, result.version_id);
    assert_eq!(summary.panel_id, result.panel_id);
    assert_eq!(summary.status, "pending_review");
    assert_eq!(summary.panel_status, "pending_review");
    assert_eq!(summary.version_number, 1);
    assert_eq!(summary.version["steps"][0]["title"], "Add storage");
}

#[test]
fn resolve_plan_review_updates_status_and_annotations() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Plan".to_string(),
        objective_summary: "Objective".to_string(),
        source: None,
        version: json!({
            "sourceReferenceIds": ["plan-ref-1"],
            "steps": [{
                "id": "plan-step-1",
                "title": "Do work",
                "expectedTools": ["/tools/filesystem/apply_patch"],
                "completionCriteria": ["Patch applied"],
                "riskLevel": "medium",
                "sourceReferenceIds": ["ref-1"]
            }]
        }),
    })
    .expect("create plan");

    let annotated = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        plan_id: created.plan_id.clone(),
        version_id: created.version_id.clone(),
        decision: "annotate".to_string(),
        annotation_text: Some("Tighten scope first".to_string()),
    })
    .expect("annotate plan");
    let annotations = annotated
        .detail
        .planning_summary
        .as_ref()
        .expect("planning summary")
        .annotations
        .clone();
    assert_eq!(annotations.len(), 1);
    assert_eq!(annotations[0].note, "Tighten scope first");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: created.plan_id.clone(),
        version_id: created.version_id.clone(),
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve plan");
    let summary = approved.detail.planning_summary.expect("planning summary");
    assert_eq!(approved.status, "approved");
    assert_eq!(summary.status, "approved");
    assert_eq!(summary.panel_status, "approved");
    let coverage = approved
        .detail
        .plan_coverage_summary
        .as_ref()
        .expect("coverage");
    assert_eq!(coverage.status, "valid");
    assert_eq!(coverage.plan_id, created.plan_id);
    assert_eq!(coverage.approved_version_id, created.version_id);
    assert_eq!(coverage.covered_plan_step_ids, vec!["plan-step-1"]);
    assert!(coverage.todo_list_id.is_some());
    assert!(coverage.execution_run_id.is_some());
    let todo = approved.detail.active_todo.as_ref().expect("plan todo");
    assert_eq!(todo.kind, "plan_bound");
    assert_eq!(todo.source["sourceReferenceIds"][0], "plan-ref-1");
    assert_eq!(todo.items.len(), 1);
    assert_eq!(todo.items[0].source["planStepId"], "plan-step-1");
    assert_eq!(todo.items[0].source["sourceReferenceIds"][0], "ref-1");
    assert_eq!(
        todo.items[0].expected_tools,
        vec!["/tools/filesystem/apply_patch"]
    );
    assert!(approved.detail.runtime_events.iter().any(|event| {
        event.phase == "todo.plan_coverage_validated"
            && event.payload["coverageId"] == coverage.coverage_id
    }));
    assert!(approved.detail.runtime_events.iter().any(|event| {
        event.phase == "todo.reference_coverage_validated"
            && event.payload["coverageId"] == coverage.coverage_id
    }));
}

#[test]
fn approving_plan_with_invalid_steps_records_failed_coverage_without_todo() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Broken plan".to_string(),
        objective_summary: "Missing executable steps".to_string(),
        source: None,
        version: json!({ "steps": [{ "id": "step-without-title" }] }),
    })
    .expect("create plan");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: created.plan_id.clone(),
        version_id: created.version_id.clone(),
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve invalid plan");

    assert_eq!(approved.status, "approved");
    assert!(approved.detail.active_todo.is_none());
    assert!(approved.detail.execution_summary.is_none());
    let coverage = approved
        .detail
        .plan_coverage_summary
        .as_ref()
        .expect("coverage");
    assert_eq!(coverage.status, "missing_plan_step");
    assert_eq!(coverage.missing_plan_step_ids, vec!["step-without-title"]);
    assert!(coverage.todo_list_id.is_none());
    assert!(approved.detail.runtime_events.iter().any(|event| {
        event.phase == "todo.plan_coverage_failed"
            && event.payload["coverageId"] == coverage.coverage_id
    }));
}

#[test]
fn approving_plan_missing_verification_records_failed_coverage_without_todo() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Missing verification".to_string(),
        objective_summary: "No validation attached to step".to_string(),
        source: None,
        version: json!({
            "steps": [{
                "id": "step-no-verification",
                "title": "Modify code",
                "riskLevel": "medium"
            }]
        }),
    })
    .expect("create plan");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: created.plan_id,
        version_id: created.version_id,
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve plan");

    assert!(approved.detail.active_todo.is_none());
    let coverage = approved
        .detail
        .plan_coverage_summary
        .as_ref()
        .expect("coverage");
    assert_eq!(coverage.status, "verification_missing");
    assert_eq!(coverage.verification_gaps, vec!["step-no-verification"]);
    assert!(coverage.todo_list_id.is_none());
}

#[test]
fn approving_plan_with_invalid_risk_records_failed_coverage_without_todo() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Invalid risk".to_string(),
        objective_summary: "Risk must stay in supported levels".to_string(),
        source: None,
        version: json!({
            "steps": [{
                "id": "step-risk",
                "title": "Modify code",
                "riskLevel": "medium-high",
                "verification": ["Run tests"]
            }]
        }),
    })
    .expect("create plan");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: created.plan_id,
        version_id: created.version_id,
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve plan");

    assert!(approved.detail.active_todo.is_none());
    let coverage = approved
        .detail
        .plan_coverage_summary
        .as_ref()
        .expect("coverage");
    assert_eq!(coverage.status, "risk_mismatch");
    assert_eq!(coverage.risk_mismatches.len(), 1);
    assert_eq!(coverage.risk_mismatches[0]["planStepId"], "step-risk");
}

#[test]
fn approving_plan_with_malformed_references_records_reference_failure() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());
    let created = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Missing refs".to_string(),
        objective_summary: "References are declared but empty".to_string(),
        source: None,
        version: json!({
            "sourceReferenceIds": [],
            "steps": [{
                "id": "step-ref",
                "title": "Modify code",
                "riskLevel": "medium",
                "verification": ["Run tests"],
                "sourceReferenceIds": []
            }]
        }),
    })
    .expect("create plan");

    let approved = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: created.plan_id,
        version_id: created.version_id,
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect("approve plan");

    assert!(approved.detail.active_todo.is_none());
    let coverage = approved
        .detail
        .plan_coverage_summary
        .as_ref()
        .expect("coverage");
    assert_eq!(coverage.status, "reference_missing");
    assert_eq!(
        coverage.missing_reference_ids,
        vec!["__plan_source_reference__", "step-ref"]
    );
    assert!(approved.detail.runtime_events.iter().any(|event| {
        event.phase == "todo.reference_coverage_failed"
            && event.payload["coverageId"] == coverage.coverage_id
    }));
}

#[test]
fn resolving_superseded_plan_is_rejected() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let workspace = temp.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    let (session_id, _turn_id) = seed_turn(&store, workspace.to_string_lossy().as_ref());
    let first = create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "First".to_string(),
        objective_summary: "First objective".to_string(),
        source: None,
        version: json!({ "steps": [] }),
    })
    .expect("first plan");
    create_plan(AgentCreatePlanRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        title: "Second".to_string(),
        objective_summary: "Second objective".to_string(),
        source: None,
        version: json!({ "steps": [] }),
    })
    .expect("second plan");

    let error = resolve_plan_review(AgentResolvePlanReviewRequest {
        storage: storage_request(&storage_root),
        session_id,
        plan_id: first.plan_id,
        version_id: first.version_id,
        decision: "approve".to_string(),
        annotation_text: None,
    })
    .expect_err("superseded plan should be rejected");
    assert!(error.to_string().contains("plan is superseded"));
}

#[test]
fn mini_todo_heuristic_detects_execution_requests_only() {
    let execution_items =
        mini_todo_items_for_request("请先做 M5A，修复并实现 todo 账本").expect("execution todo");
    assert_eq!(execution_items.len(), 4);
    assert!(execution_items.iter().any(|item| item
        .expected_tools
        .iter()
        .any(|tool| tool == TOOL_FS_APPLY_PATCH)));
    assert!(mini_todo_items_for_request("你好").is_none());
    assert!(mini_todo_items_for_request("what is the current architecture?").is_none());
}

#[test]
fn create_todo_api_creates_plan_bound_list_and_execution_run() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session_id, _turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

    let result = create_todo(AgentCreateTodoRequest {
        storage: StorageRequest {
            storage_root: Some(storage_root),
        },
        session_id: session_id.clone(),
        kind: "plan_bound".to_string(),
        title: "Plan execution".to_string(),
        source: Some(json!({ "type": "test_plan" })),
        items: vec![CreateTodoItemInput {
            title: "Apply patch".to_string(),
            actions: vec!["Apply approved patch".to_string()],
            expected_tools: vec![TOOL_FS_APPLY_PATCH.to_string()],
            risk_level: "medium".to_string(),
            completion_criteria: vec!["Patch applied".to_string()],
            source: json!({}),
        }],
    })
    .expect("create todo");

    assert_eq!(result.session_id, session_id);
    assert_eq!(
        result.detail.active_todo.as_ref().expect("todo").kind,
        "plan_bound"
    );
    assert_eq!(
        result
            .detail
            .execution_summary
            .as_ref()
            .expect("summary")
            .execution_run_id,
        result.execution_run_id
    );
    assert!(result
        .detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "todo_list_created"));
}

#[test]
fn sandbox_apply_tool_result_blocks_matching_todo_item() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_patch_artifact(
        &store,
        &session_id,
        &turn_id,
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    );
    store
        .create_execution_todo_list(
            &session_id,
            Some(&turn_id),
            "mini",
            "Execution checklist",
            json!({ "type": "test" }),
            &[CreateTodoItemInput {
                title: "Apply approved workspace changes".to_string(),
                actions: Vec::new(),
                expected_tools: vec![TOOL_FS_APPLY_PATCH.to_string()],
                risk_level: "medium".to_string(),
                completion_criteria: Vec::new(),
                source: json!({}),
            }],
        )
        .expect("todo");
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-apply".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_APPLY_PATCH.to_string(),
        args: json!({ "artifactId": artifact_id }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_FS_APPLY_PATCH.to_string()]);

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
    .expect("tool operation");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let item = &detail.active_todo.as_ref().expect("todo").items[0];
    assert_eq!(item.status, "blocked");
    assert!(item
        .blockers
        .as_array()
        .expect("blockers")
        .iter()
        .any(|blocker| blocker["kind"] == "approval_required"));
    assert_eq!(
        detail
            .execution_summary
            .as_ref()
            .expect("summary")
            .blocked_step_count,
        1
    );
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "todo_item_updated"));
}

#[test]
fn sandbox_run_command_requires_approval_and_denied_retry_is_visible() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
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
    .expect("tool operation");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(detail.pending_interactions.len(), 1);
    assert_eq!(
        detail.pending_interactions[0]["payload"]["toolPath"],
        TOOL_SHELL_RUN_COMMAND
    );
    let approval_ticket_id = detail.pending_interactions[0]["payload"]["approvalTicketId"]
        .as_str()
        .unwrap()
        .to_string();

    resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id,
        decision: ApprovalDecision::Deny,
    })
    .expect("deny");

    let retry = crate::tool_runtime::shell::run_command_tool_result(
        &store,
        &session_id,
        &turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::Sandbox,
    );
    assert_eq!(retry.error_code.as_deref(), Some(TOOL_APPROVAL_DENIED));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.pending_interactions.is_empty());
    assert_eq!(
        detail.active_todo.as_ref().expect("todo").items[0].status,
        "failed"
    );
}

#[test]
fn full_access_run_command_records_verification_artifact_and_evidence() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-shell-pass".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_SHELL_RUN_COMMAND.to_string(),
        args: json!({ "mode": "shell", "command": "printf ok", "cwd": "." }),
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
    let verification = detail
        .verification_summary
        .as_ref()
        .expect("verification summary");
    assert_eq!(verification.passed_run_count, 1);
    assert_eq!(verification.runs[0].command.as_deref(), Some("printf ok"));
    assert!(verification.runs[0].artifact_id.is_some());
    assert_eq!(
        detail.active_todo.as_ref().expect("todo").items[0].status,
        "completed"
    );
    assert_eq!(
        detail
            .delivery_proof
            .as_ref()
            .expect("delivery proof")
            .status,
        "ready"
    );
    assert_eq!(
        detail
            .completion_audit
            .as_ref()
            .expect("completion audit")
            .status,
        "passed"
    );
}

#[test]
fn failed_verification_blocks_model_success_final_text() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-shell-fail","op":"run","path":"/tools/shell/run_command","args":{"mode":"argv","argv":["sh","-c","exit 7"],"cwd":"."}}"#.to_string(),
            "Done. Everything passed.".to_string(),
        ]
        .into_iter();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::FullAccess,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _cancel| {
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let assistant_messages = detail
        .messages
        .iter()
        .filter(|message| message.role == "assistant")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>();
    assert_eq!(assistant_messages.len(), 1);
    assert!(assistant_messages[0].contains("Delivery failed"));
    assert!(assistant_messages[0].contains("cannot be reported as complete"));
    assert_eq!(
        detail
            .completion_audit
            .as_ref()
            .expect("completion audit")
            .status,
        "failed"
    );
    assert_eq!(
        detail
            .delivery_proof
            .as_ref()
            .expect("delivery proof")
            .status,
        "failed"
    );
}

#[test]
fn tool_envelope_triggers_execution_second_model_call_and_persisted_events() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(
        temp.path().join("Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    )
    .expect("cargo");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-list","op":"list","path":"/tools"}"#.to_string(),
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-inspect","op":"inspect","path":"/tools/filesystem/list_files"}"#.to_string(),
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-run","op":"run","path":"/tools/filesystem/list_files","args":{"path":"."}}"#.to_string(),
            "I found Cargo.toml in the workspace.".to_string(),
        ]
        .into_iter();
    let mut calls: Vec<Vec<ChatMessage>> = Vec::new();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _cancel| {
            calls.push(messages);
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    assert_eq!(calls.len(), 4);
    assert!(calls[3]
        .iter()
        .any(|message| message.content.contains("Runtime ToolFS result")
            && message.content.contains("Cargo.toml")));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(
        detail
            .messages
            .iter()
            .filter(|message| message.role == "assistant")
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>(),
        vec!["I found Cargo.toml in the workspace."]
    );
    let phases = detail
        .runtime_events
        .iter()
        .map(|event| event.phase.as_str())
        .collect::<Vec<_>>();
    assert!(phases.contains(&"tool_operation_started"));
    assert!(phases.contains(&"tool_operation_completed"));
    let completed_tool_event = detail
        .runtime_events
        .iter()
        .find(|event| {
            event.phase == "tool_operation_completed"
                && event.payload["operation"]["path"] == "/tools/filesystem/list_files"
                && event.payload["operation"]["op"] == "run"
        })
        .expect("completed tool event");
    let result_ref = completed_tool_event.payload["result"]["resultRef"]
        .as_str()
        .expect("result ref");
    assert!(completed_tool_event.payload["result"]["content"].is_null());
    assert!(completed_tool_event.payload["result"]["contentPreview"]
        .as_str()
        .unwrap_or_default()
        .contains("Cargo.toml"));
    let blob = store
        .read_tool_result_blob(&session_id, result_ref)
        .expect("blob")
        .expect("blob exists");
    assert_eq!(blob.runtime_turn_id, turn_id);
    assert_eq!(blob.tool_path, "/tools/filesystem/list_files");
    assert!(blob.content_json.contains("Cargo.toml"));
    assert!(blob.content_bytes > 0);
    assert_eq!(blob.content_sha256.len(), 64);
    let sequences = store
        .with_session_conn(&session_id, |conn| {
            let mut stmt =
                conn.prepare("SELECT sequence FROM runtime_event ORDER BY sequence ASC")?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
        .expect("sequences");
    assert!(sequences.windows(2).all(|pair| pair[0] < pair[1]));
}

#[test]
fn invalid_tool_envelope_is_final_text_and_not_executed() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

    run_turn_worker_inner(
            &store,
            test_config(),
            &session_id,
            &turn_id,
            None,
            PermissionMode::Sandbox,
            Arc::new(AtomicBool::new(false)),
            |_config, _messages, _cancel| {
                Ok(ModelResponse {
                    text: r#"{"schemaVersion":"v1","kind":"tool_operation","operationId":"op-read","toolName":"filesystem.read_file","arguments":{"path":"Cargo.toml"}}"#.to_string(),
                    usage: None,
                })
            },
        )
        .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail
        .runtime_events
        .iter()
        .all(|event| event.phase.starts_with("tool_operation_") == false));
    assert!(detail.messages.iter().any(|message| {
        message.role == "assistant"
            && message
                .content
                .contains(r#""toolName":"filesystem.read_file""#)
    }));
}

#[test]
fn tool_failure_is_returned_to_model_as_tool_result() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-inspect","op":"inspect","path":"/tools/filesystem/read_file"}"#.to_string(),
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-read","op":"run","path":"/tools/filesystem/read_file","args":{"path":"../secret.txt"}}"#.to_string(),
            "I cannot read outside the workspace.".to_string(),
        ]
        .into_iter();
    let mut calls: Vec<Vec<ChatMessage>> = Vec::new();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _cancel| {
            calls.push(messages);
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    assert_eq!(calls.len(), 3);
    assert!(calls[2]
        .iter()
        .any(|message| message.content.contains("\"status\":\"failed\"")
            && message
                .content
                .contains("parent path segments are not allowed")));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "tool_operation_failed"));
}

#[test]
fn run_without_inspect_returns_inspect_required_without_executing_tool() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("Cargo.toml"), "[package]\n").expect("cargo");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut responses = vec![
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-run","op":"run","path":"/tools/filesystem/list_files","args":{"path":"."}}"#.to_string(),
            "I need to inspect the tool first.".to_string(),
        ]
        .into_iter();
    let mut calls: Vec<Vec<ChatMessage>> = Vec::new();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _cancel| {
            calls.push(messages);
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    assert_eq!(calls.len(), 2);
    assert!(calls[1].iter().any(|message| {
        message
            .content
            .contains("\"errorCode\":\"TOOL_INSPECT_REQUIRED\"")
            && message.content.contains("Cargo.toml") == false
    }));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_failed"
            && event.payload["result"]["errorCode"] == "TOOL_INSPECT_REQUIRED"
    }));
}

#[test]
fn propose_patch_creates_preview_artifact_refs_without_modifying_workspace() {
    let temp = tempfile::tempdir().expect("tempdir");
    let readme_path = temp.path().join("README.md");
    fs::write(&readme_path, "# Demo\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let patch = "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Demo\n+Preview line\n";
    let mut responses = vec![
        serde_json::json!({
            "schemaVersion": "v1",
            "kind": "tool_operation",
            "opId": "op-inspect-patch",
            "op": "inspect",
            "path": "/tools/filesystem/propose_patch"
        })
        .to_string(),
        serde_json::json!({
            "schemaVersion": "v1",
            "kind": "tool_operation",
            "opId": "op-propose",
            "op": "run",
            "path": "/tools/filesystem/propose_patch",
            "args": {
                "title": "Update README",
                "rationale": "Clarify the demo README.",
                "patch": patch,
                "expectedFiles": ["README.md"]
            }
        })
        .to_string(),
        "I prepared a patch preview artifact. It has not been applied or tested.".to_string(),
    ]
    .into_iter();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _cancel| {
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    assert_eq!(
        fs::read_to_string(&readme_path).expect("readme"),
        "# Demo\n"
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "timeline_checkpoint")
            .expect("checkpoint count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "artifact_record")
            .expect("artifact count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "evidence_record")
            .expect("evidence count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        0
    );

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let completed_tool_event = detail
        .runtime_events
        .iter()
        .find(|event| {
            event.phase == "tool_operation_completed"
                && event.payload["operation"]["path"] == "/tools/filesystem/propose_patch"
                && event.payload["operation"]["op"] == "run"
        })
        .expect("completed patch event");
    let result = completed_tool_event.payload["result"]
        .as_object()
        .expect("result");
    assert!(result.get("content").is_none());
    let artifact_id = result
        .get("artifactId")
        .and_then(Value::as_str)
        .expect("artifact id");
    let evidence_id = result
        .get("evidenceId")
        .and_then(Value::as_str)
        .expect("evidence id");
    let patch_ref = result
        .get("patchRef")
        .and_then(Value::as_str)
        .expect("patch ref");
    assert!(artifact_id.starts_with("artifact_"));
    assert!(evidence_id.starts_with("evidence_"));
    assert_eq!(
        result.get("resultRef").and_then(Value::as_str),
        Some(patch_ref)
    );
    assert_eq!(result["changedFiles"][0]["path"], "README.md");
    assert_eq!(result["changedFiles"][0]["changeType"], "modified");
    assert!(result["contentPreview"]
        .as_str()
        .unwrap_or_default()
        .contains("Preview line"));

    let blob = store
        .read_tool_result_blob(&session_id, patch_ref)
        .expect("blob")
        .expect("blob exists");
    assert_eq!(blob.tool_path, "/tools/filesystem/propose_patch");
    assert!(blob.content_json.contains("+Preview line"));
}

#[test]
fn apply_patch_in_sandbox_creates_pending_ticket_without_writing() {
    let temp = tempfile::tempdir().expect("tempdir");
    let readme_path = temp.path().join("README.md");
    fs::write(&readme_path, "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_patch_artifact(
        &store,
        &session_id,
        &turn_id,
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    );
    let mut responses = vec![
        serde_json::json!({
            "schemaVersion": "v1",
            "kind": "tool_operation",
            "opId": "op-inspect-apply",
            "op": "inspect",
            "path": "/tools/filesystem/apply_patch"
        })
        .to_string(),
        serde_json::json!({
            "schemaVersion": "v1",
            "kind": "tool_operation",
            "opId": "op-apply",
            "op": "run",
            "path": "/tools/filesystem/apply_patch",
            "args": { "artifactId": artifact_id }
        })
        .to_string(),
        "The patch needs approval before it can be applied.".to_string(),
    ]
    .into_iter();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _cancel| {
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    assert_eq!(fs::read_to_string(&readme_path).expect("readme"), "old\n");
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "file_backup_record")
            .expect("backup count"),
        0
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_failed"
            && event.payload["operation"]["path"] == "/tools/filesystem/apply_patch"
            && event.payload["result"]["errorCode"] == "TOOL_APPROVAL_REQUIRED"
    }));
}

#[test]
fn apply_patch_in_full_access_auto_approves_and_writes_auditable_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    let readme_path = temp.path().join("README.md");
    fs::write(&readme_path, "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_patch_artifact(
        &store,
        &session_id,
        &turn_id,
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    );
    let mut responses = vec![
        serde_json::json!({
            "schemaVersion": "v1",
            "kind": "tool_operation",
            "opId": "op-inspect-apply",
            "op": "inspect",
            "path": "/tools/filesystem/apply_patch"
        })
        .to_string(),
        serde_json::json!({
            "schemaVersion": "v1",
            "kind": "tool_operation",
            "opId": "op-apply",
            "op": "run",
            "path": "/tools/filesystem/apply_patch",
            "args": { "artifactId": artifact_id }
        })
        .to_string(),
        "Applied the patch.".to_string(),
    ]
    .into_iter();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::FullAccess,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _cancel| {
            Ok(ModelResponse {
                text: responses.next().expect("response"),
                usage: None,
            })
        },
    )
    .expect("worker");

    assert_eq!(fs::read_to_string(&readme_path).expect("readme"), "new\n");
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "file_backup_record")
            .expect("backup count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "artifact_record")
            .expect("artifact count"),
        2
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "evidence_record")
            .expect("evidence count"),
        2
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_completed"
            && event.payload["operation"]["path"] == "/tools/filesystem/apply_patch"
            && event.payload["result"]["approvalTicketId"]
                .as_str()
                .unwrap_or_default()
                .starts_with("approval_")
    }));
}
