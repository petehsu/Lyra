use super::*;
use crate::patch_apply::{resolve_agent_approval, AgentResolveApprovalRequest, ApprovalDecision};
use crate::storage::{AgentResolveClarificationRequest, AgentSession, AgentTurn};
use crate::tool_runtime::operation::TOOL_APPROVAL_DENIED;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;

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

fn test_config_with_metadata(metadata: Value) -> ProviderRuntimeConfig {
    ProviderRuntimeConfig {
        model_runtime_metadata: Some(metadata),
        ..test_config()
    }
}

fn seed_turn(store: &AiStore, workspace_root: &str) -> (String, String) {
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
        content: "inspect the project".to_string(),
        content_parts: None,
        display_content: Some("inspect the project".to_string()),
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
    (session.id, turn.id)
}

static MCP_RUNTIME_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn mcp_runtime_test_guard() -> std::sync::MutexGuard<'static, ()> {
    MCP_RUNTIME_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("mcp runtime test lock")
}

fn start_mcp_validation_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let url = format!("http://{}", listener.local_addr().expect("addr"));
    thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        let body = "ok";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    });
    url
}

fn start_test_mcp_runtime(server_id: &str, tool_name: &str) {
    let _ = lyra_mcp_core::shutdown_mcp_runtime();
    let now = now_iso();
    let url = start_mcp_validation_server();
    lyra_mcp_core::start_mcp_runtime_json(
        json!({
            "server": {
                "id": server_id,
                "serverKey": server_id,
                "source": "custom",
                "title": "Test MCP",
                "summary": "Runtime MCP test server",
                "description": null,
                "iconKey": "mcp",
                "scope": "global",
                "projectRoot": null,
                "transport": "http",
                "installKind": "manual",
                "command": null,
                "args": [],
                "cwd": null,
                "url": url,
                "environment": [],
                "permissions": [],
                "enabled": true,
                "autoStart": false,
                "createdAt": now,
                "updatedAt": now,
                "lastError": null
            },
            "checkedAt": now,
            "secretStore": {
                "version": 1,
                "secrets": {}
            },
            "availableExternalKeys": [],
            "baseEnv": {},
            "introspectionSnapshot": {
                "serverId": server_id,
                "fetchedAt": now,
                "source": "test",
                "note": null,
                "tools": [{
                    "name": tool_name,
                    "description": "Lookup project docs",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string" }
                        },
                        "required": ["query"]
                    }
                }],
                "resources": [],
                "prompts": []
            }
        })
        .to_string(),
    )
    .expect("start mcp runtime");
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
    assert!(mini_todo_items_for_request("你详细看一下这些文档具体是什么").is_some());
    assert!(mini_todo_items_for_request("这是什么").is_none());
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            calls.push(messages);
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
fn session_detail_events_are_compacted_when_persisted() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

    for _ in 0..6 {
        let detail = store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("session");
        emit_store_event(
            &store,
            &session_id,
            Some(&turn_id),
            "session_updated",
            json!({
                "detail": detail,
                "reason": "test"
            }),
        )
        .expect("event");
    }

    let payloads = store
        .with_session_conn(&session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT payload_json FROM runtime_event
                 WHERE event_type = 'session_updated'
                 ORDER BY sequence ASC",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
        .expect("payloads");

    assert_eq!(payloads.len(), 6);
    for payload_json in payloads {
        assert!(
            payload_json.len() < 2048,
            "session detail payload was persisted inline: {} bytes",
            payload_json.len()
        );
        let payload: Value = serde_json::from_str(&payload_json).expect("payload json");
        assert_eq!(payload["detailCompacted"].as_bool(), Some(true));
        assert_eq!(payload["detail"]["compacted"].as_bool(), Some(true));
        assert!(payload["detail"]["runtimeEvents"].is_null());
        assert!(payload["detail"]["runtimeEventCount"].as_u64().is_some());
    }
}

#[test]
fn oversized_runtime_event_payloads_are_redacted_when_reading_detail() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    store
        .append_event(
            &session_id,
            Some(&turn_id),
            "oversized_test_event",
            json!({ "status": "seed" }),
        )
        .expect("event");
    let huge_payload = format!("{{\"blob\":\"{}\"}}", "x".repeat(300_000));
    store
        .with_session_conn(&session_id, |conn| {
            conn.execute(
                "UPDATE runtime_event
                 SET payload_json = ?1
                 WHERE event_type = 'oversized_test_event'",
                rusqlite::params![huge_payload],
            )?;
            Ok(())
        })
        .expect("inflate payload");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let event = detail
        .runtime_events
        .iter()
        .find(|event| event.phase == "oversized_test_event")
        .expect("oversized event");
    assert_eq!(event.payload["payloadCompacted"].as_bool(), Some(true));
    assert_eq!(
        event.payload["reason"].as_str(),
        Some("runtime_event_payload_too_large")
    );
    assert!(event.payload["originalBytes"].as_i64().unwrap_or_default() > 300_000);
}

#[test]
fn native_tool_call_triggers_registered_tool_dispatch_and_second_model_call() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(
        temp.path().join("Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    )
    .expect("cargo");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut step = 0;
    let mut calls: Vec<Vec<ChatMessage>> = Vec::new();
    let mut advertised_tools: Vec<Vec<String>> = Vec::new();

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, tools, _cancel, _on_delta, _on_retry| {
            calls.push(messages);
            advertised_tools.push(
                tools
                    .iter()
                    .map(|tool| tool.name.clone())
                    .collect::<Vec<_>>(),
            );
            step += 1;
            if step == 1 {
                Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: "call-list".to_string(),
                        name: "list_directory".to_string(),
                        arguments: json!({ "path": "." }),
                    }],
                })
            } else {
                Ok(ChatResponse::text(
                    "I found Cargo.toml in the workspace.".to_string(),
                    None,
                ))
            }
        },
    )
    .expect("worker");

    assert_eq!(calls.len(), 2);
    assert!(advertised_tools[0].contains(&"list_directory".to_string()));
    assert!(calls[1].iter().any(|message| {
        message.content.contains("Runtime ToolFS result") && message.content.contains("Cargo.toml")
    }));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let completed_tool_event = detail
        .runtime_events
        .iter()
        .find(|event| {
            event.phase == "tool_operation_completed"
                && event.payload["operation"]["path"] == "/tools/filesystem/list_files"
                && event.payload["operation"]["opId"] == "call-list"
        })
        .expect("completed tool event");
    assert!(completed_tool_event.payload["result"]["contentPreview"]
        .as_str()
        .unwrap_or_default()
        .contains("Cargo.toml"));
    assert_eq!(
        detail
            .messages
            .iter()
            .filter(|message| message.role == "assistant")
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>(),
        vec!["I found Cargo.toml in the workspace."]
    );
}

#[test]
fn turn_loop_has_no_tool_step_guard() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(
        temp.path().join("Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    )
    .expect("cargo");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut step = 0;

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            step += 1;
            if step <= 9 {
                return Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: format!("call-list-{step}"),
                        name: "list_directory".to_string(),
                        arguments: json!({ "path": "." }),
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
    assert_eq!(step, 10);
    assert_eq!(
        detail
            .runtime_events
            .iter()
            .filter(|event| event.phase == "tool_operation_completed")
            .count(),
        9
    );
    assert!(detail
        .messages
        .iter()
        .any(|message| message.role == "assistant" && message.content == "Done."));
}

#[test]
fn turn_loop_truncates_context_window_before_model_call() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let now = now_ms();
    for index in 0..14 {
        store
            .append_message(&AgentMessage {
                id: new_id("msg"),
                session_id: session_id.clone(),
                turn_id: Some(turn_id.clone()),
                role: if index % 2 == 0 { "assistant" } else { "user" }.to_string(),
                content: format!("history-{index}-{}", "x".repeat(180)),
                content_parts: None,
                display_content: None,
                created_at: now + i64::from(index),
            })
            .expect("history");
    }
    let mut observed_messages = Vec::<ChatMessage>::new();

    run_turn_worker_inner(
        &store,
        test_config_with_metadata(json!({ "contextWindow": 400 })),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            observed_messages = messages;
            Ok(ChatResponse::text("done".to_string(), None))
        },
    )
    .expect("worker");

    assert!(observed_messages.iter().any(|message| {
        message
            .content
            .starts_with("[Earlier conversation truncated:")
    }));
    assert!(observed_messages.len() < 16);
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let event = detail
        .runtime_events
        .iter()
        .find(|event| event.phase == "context_window_truncated")
        .expect("context event");
    assert!(
        event.payload["removedMessages"]
            .as_i64()
            .unwrap_or_default()
            > 0
    );
}

#[test]
fn turn_loop_emits_streaming_model_delta_events() {
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, on_delta, _on_retry| {
            on_delta("Hel")?;
            on_delta("lo")?;
            Ok(ChatResponse::text("Hello".to_string(), None))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let streamed = detail
        .runtime_events
        .iter()
        .filter(|event| event.phase == "model_stream_delta")
        .map(|event| event.payload["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(streamed, "Hello");
    assert!(detail
        .messages
        .iter()
        .any(|message| { message.role == "assistant" && message.content == "Hello" }));
}

#[test]
fn managed_turn_streams_raw_model_deltas_for_live_visibility() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_FS_LIST_FILES);
    let raw_stream = "Reading files, preparing the change, and checking the result.";

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, on_delta, _on_retry| {
            on_delta(raw_stream)?;
            Ok(ChatResponse::text(raw_stream.to_string(), None))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let streamed = detail
        .runtime_events
        .iter()
        .filter(|event| event.phase == "model_stream_delta")
        .map(|event| event.payload["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(streamed, raw_stream);
    assert!(detail
        .runtime_events
        .iter()
        .all(|event| event.phase != "agent_public_result_delta"));
}

#[test]
fn turn_loop_injects_running_mcp_tools_and_requires_user_approval() {
    let _guard = mcp_runtime_test_guard();
    start_test_mcp_runtime("server.one", "lookup_docs");
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut step = 0_usize;

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, tools, _cancel, _on_delta, _on_retry| {
            step += 1;
            if step == 1 {
                assert!(tools.iter().any(|tool| {
                    tool.name == "mcp__server_one__lookup_docs"
                        && tool.input_schema["properties"]["query"]["type"] == "string"
                }));
                return Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: "tool-mcp".to_string(),
                        name: "mcp__server_one__lookup_docs".to_string(),
                        arguments: json!({ "query": "runtime intake" }),
                    }],
                });
            }
            Ok(ChatResponse::text(
                "Waiting for MCP approval.".to_string(),
                None,
            ))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(step, 2);
    assert!(detail.pending_interactions.iter().any(|interaction| {
        interaction["kind"] == "tool_approval"
            && interaction["payload"]["toolPath"] == "/tools/mcp/server_one/lookup_docs"
            && interaction["payload"]["requestedAction"]["toolName"]
                == "mcp__server_one__lookup_docs"
    }));
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_failed"
            && event.payload["operation"]["path"] == "/tools/mcp/server_one/lookup_docs"
            && event.payload["result"]["errorCode"] == "TOOL_APPROVAL_REQUIRED"
    }));
    let _ = lyra_mcp_core::shutdown_mcp_runtime();
}

#[test]
fn mcp_tool_can_be_disabled_by_project_policy() {
    let _guard = mcp_runtime_test_guard();
    start_test_mcp_runtime("server.one", "lookup_docs");
    let temp = tempfile::tempdir().expect("tempdir");
    let manifest_dir = temp.path().join(".lyra");
    fs::create_dir_all(&manifest_dir).expect("manifest dir");
    fs::write(
        manifest_dir.join("project.manifest.json"),
        r#"{ "schemaVersion": "v1", "tools": { "disabled": ["/tools/mcp/server_one/lookup_docs"] } }"#,
    )
    .expect("manifest");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    crate::project_policy::load_for_turn(
        &store,
        &session_id,
        &turn_id,
        Some(temp.path().to_string_lossy().as_ref()),
    )
    .expect("policy");
    let mut step = 0_usize;

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            step += 1;
            if step == 1 {
                return Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: "tool-mcp".to_string(),
                        name: "mcp__server_one__lookup_docs".to_string(),
                        arguments: json!({ "query": "runtime intake" }),
                    }],
                });
            }
            Ok(ChatResponse::text("Blocked by policy.".to_string(), None))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.pending_interactions.is_empty());
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "security_resource_blocked"
            && event.payload["resourceRef"] == "/tools/mcp/server_one/lookup_docs"
    }));
    let security = detail.security_summary.expect("security");
    assert!(security.recent_decisions.iter().any(|decision| {
        decision.decision == "deny"
            && decision
                .reason_codes
                .contains(&"tool_disabled_by_policy".to_string())
    }));
    let _ = lyra_mcp_core::shutdown_mcp_runtime();
}

#[test]
fn turn_loop_emits_model_retry_events() {
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, on_retry| {
            on_retry(1, "model provider request failed: status=500")?;
            Ok(ChatResponse::text("Recovered".to_string(), None))
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let retry = detail
        .runtime_events
        .iter()
        .find(|event| event.phase == "model_call_retrying")
        .expect("retry event");
    assert_eq!(retry.payload["attempt"], 1);
    assert!(retry.payload["error"]
        .as_str()
        .unwrap_or_default()
        .contains("status=500"));
}

#[test]
fn session_update_persists_hot_runtime_config_and_prompt_is_reloaded_per_turn() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let detail = create_session(CreateSessionRequest {
        storage: StorageRequest {
            storage_root: Some(storage_root.clone()),
        },
        title: Some("Hot config".to_string()),
        profile_id: Some("profile-a".to_string()),
        model_id: Some("model-a".to_string()),
        system_prompt: Some("Initial prompt".to_string()),
        permission_mode: Some("sandbox".to_string()),
        execution_target: Some("host".to_string()),
        project_root: Some(temp.path().to_string_lossy().to_string()),
        cwd: None,
        collaboration_mode: Some("default".to_string()),
    })
    .expect("create");
    let session_id = detail.session.id.clone();
    let updated = update_session(UpdateSessionRequest {
        storage: StorageRequest {
            storage_root: Some(storage_root.clone()),
        },
        session_id: session_id.clone(),
        title: None,
        profile_id: Some("profile-b".to_string()),
        model_id: Some("model-b".to_string()),
        system_prompt: Some("Always answer tersely.".to_string()),
        permission_mode: Some("full_access".to_string()),
        execution_target: Some("agent_vm".to_string()),
        project_root: None,
        collaboration_mode: None,
    })
    .expect("update");
    assert_eq!(updated.session.profile_id.as_deref(), Some("profile-b"));
    assert_eq!(updated.session.model_id.as_deref(), Some("model-b"));
    assert_eq!(
        updated.session.system_prompt.as_deref(),
        Some("Always answer tersely.")
    );
    assert_eq!(
        updated.session.permission_mode.as_deref(),
        Some("full_access")
    );

    let now = now_ms();
    let turn_id = new_id("turn");
    let user_message = AgentMessage {
        id: new_id("msg"),
        session_id: session_id.clone(),
        turn_id: Some(turn_id.clone()),
        role: "user".to_string(),
        content: "Use the configured prompt".to_string(),
        content_parts: None,
        display_content: Some("Use the configured prompt".to_string()),
        created_at: now,
    };
    store.append_message(&user_message).expect("message");
    store
        .insert_turn(
            &AgentTurn {
                id: turn_id.clone(),
                session_id: session_id.clone(),
                profile_id: "profile-b".to_string(),
                status: "running".to_string(),
                collaboration_mode: Some("default".to_string()),
                permission_mode: "full_access".to_string(),
                execution_target: "host".to_string(),
                error_code: None,
                error_message: None,
                usage: None,
                created_at: now,
                updated_at: now,
            },
            &user_message.id,
            None,
        )
        .expect("turn");
    let mut observed_system = String::new();
    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            observed_system = messages
                .iter()
                .filter(|message| message.role == "system")
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            Ok(ChatResponse::text("done".to_string(), None))
        },
    )
    .expect("worker");

    assert!(observed_system.contains("Always answer tersely."));
}

#[test]
fn model_clarification_tool_call_pauses_turn_and_opens_pending_panel() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            Ok(ChatResponse {
                text: String::new(),
                usage: None,
                tool_calls: vec![ToolCall {
                    id: "call_clarify".to_string(),
                    name: "open_clarification_panel".to_string(),
                    arguments: json!({
                        "title": "Pick target file",
                        "description": "Multiple plausible targets exist.",
                        "blocksExecution": true,
                        "presentation": "modal",
                        "questions": [{
                            "title": "Pick target file",
                            "question": "Which file should I update?",
                            "whyItMatters": "The patch target changes the implementation.",
                            "questionType": "scope",
                            "reasonCode": "ambiguous_target",
                            "targetSummary": "No fresh target binding.",
                            "options": [
                                { "id": "A", "label": "README.md", "description": "Update the README.", "recommended": true },
                                { "id": "B", "label": "Cargo.toml", "description": "Update package metadata." },
                                { "id": "C", "label": "Open planning", "description": "Plan before editing." },
                                { "id": "D", "label": "Cancel request", "description": "Stop the request." }
                            ]
                        }]
                    }),
                }],
            })
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let turn = detail
        .turns
        .iter()
        .find(|turn| turn.id == turn_id)
        .expect("turn");
    assert_eq!(turn.status, "paused");
    assert_eq!(detail.pending_interactions.len(), 1);
    assert_eq!(detail.pending_interactions[0]["kind"], "clarification");
    assert_eq!(
        detail.pending_interactions[0]["payload"]["panelId"]
            .as_str()
            .is_some(),
        true
    );
    assert_eq!(
        detail.pending_interactions[0]["payload"]["questions"][0]["question"],
        "Which file should I update?"
    );
    assert!(detail
        .messages
        .iter()
        .all(|message| message.role != "assistant"));
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "clarification_panel_opened"));

    let ticket_id = detail.pending_interactions[0]["payload"]["questionTicketId"]
        .as_str()
        .expect("ticket id")
        .to_string();
    let resolved = submit_clarification_response(AgentResolveClarificationRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        question_ticket_id: ticket_id,
        selected_option_id: Some("B".to_string()),
        custom_answer: None,
        answer_text: None,
    })
    .expect("resolve clarification");
    assert!(resolved
        .detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "clarification_turn_resumed"));
}

#[test]
fn answered_clarification_is_reused_instead_of_reopened_for_same_turn() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let clarification_call = ToolCall {
        id: "call_clarify_initial".to_string(),
        name: "open_clarification_panel".to_string(),
        arguments: json!({
            "title": "Pick target file",
            "description": "Multiple plausible targets exist.",
            "blocksExecution": true,
            "presentation": "modal",
            "questions": [{
                "title": "Pick target file",
                "question": "Which file should I update?",
                "whyItMatters": "The patch target changes the implementation.",
                "questionType": "scope",
                "reasonCode": "ambiguous_target",
                "targetSummary": "No fresh target binding.",
                "options": [
                    { "id": "A", "label": "README.md", "description": "Update the README.", "recommended": true },
                    { "id": "B", "label": "Cargo.toml", "description": "Update package metadata." },
                    { "id": "C", "label": "Open planning", "description": "Plan before editing." },
                    { "id": "D", "label": "Cancel request", "description": "Stop the request." }
                ]
            }]
        }),
    };

    assert!(matches!(
        clarification_gate::open_model_clarification_panel(
            &store,
            &session_id,
            &turn_id,
            &clarification_call
        )
        .expect("open clarification"),
        clarification_gate::ModelClarificationPanelOutcome::Opened
    ));
    let ticket_id = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session")
        .pending_interactions[0]["payload"]["questionTicketId"]
        .as_str()
        .expect("ticket id")
        .to_string();
    store
        .resolve_question_ticket(&session_id, &ticket_id, Some("B"), None, Some("Cargo.toml"))
        .expect("resolve ticket");
    store
        .update_turn_status(&session_id, &turn_id, "running", "model_queued", None, None)
        .expect("turn running");

    let mut invocation = 0_usize;
    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            invocation += 1;
            if invocation == 1 {
                assert!(messages.iter().any(|message| {
                    message
                        .content
                        .contains("Runtime clarification answers for this resumed turn")
                }));
                Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: "call_clarify_again".to_string(),
                        ..clarification_call.clone()
                    }],
                })
            } else {
                let joined = messages
                    .iter()
                    .map(|message| message.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(joined.contains("Runtime clarification result"));
                assert!(joined.contains("Cargo.toml"));
                Ok(ChatResponse::text(
                    "Continuing with Cargo.toml.".to_string(),
                    None,
                ))
            }
        },
    )
    .expect("worker");

    assert_eq!(invocation, 2);
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.pending_interactions.is_empty());
    assert_eq!(
        detail
            .runtime_events
            .iter()
            .filter(|event| event.phase == "clarification_panel_opened")
            .count(),
        1
    );
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "clarification_panel_reopen_suppressed"));
}

#[test]
fn sandbox_agent_write_file_tool_creates_pending_approval_and_approval_executes() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let target = temp.path().join("nested").join("approved.txt");
    let mut step = 0;

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            step += 1;
            if step == 1 {
                Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: "call-write".to_string(),
                        name: "write_file".to_string(),
                        arguments: json!({
                            "path": "nested/approved.txt",
                            "content": "approved\n",
                        }),
                    }],
                })
            } else {
                Ok(ChatResponse::text(
                    "Waiting for file write approval.".to_string(),
                    None,
                ))
            }
        },
    )
    .expect("worker");

    assert!(!target.exists());
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(detail.pending_interactions.len(), 1);
    assert_eq!(
        detail.pending_interactions[0]["payload"]["toolPath"],
        "/tools/agent/write_file"
    );
    assert!(detail
        .messages
        .iter()
        .all(|message| message.role != "assistant"));
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "model_output_suppressed"
            && event.payload["reason"] == "pending_runtime_interaction"));
    let approval_ticket_id = detail.pending_interactions[0]["payload"]["approvalTicketId"]
        .as_str()
        .expect("approval id")
        .to_string();

    let approved = resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id,
        decision: ApprovalDecision::Approve,
    })
    .expect("approve");

    assert_eq!(approved.status, "approved");
    assert_eq!(approved.tool_path, "/tools/agent/write_file");
    assert_eq!(fs::read_to_string(&target).expect("target"), "approved\n");
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "recovery_backup")
            .expect("recovery backup"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "side_effect_record")
            .expect("side effects"),
        1
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.pending_interactions.is_empty());
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_completed"
            && event.payload["operation"]["path"] == "/tools/agent/write_file"
            && event.payload["result"]["approvalTicketId"]
                .as_str()
                .unwrap_or_default()
                .starts_with("approval_")
    }));
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "follow_live_edit_delta"
            && event.payload["filePath"] == "nested/approved.txt"));
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "follow_live_edit_finalized"
            && event.payload["filePath"] == "nested/approved.txt"));
    assert!(detail.runtime_events.iter().any(|event| {
        if event.phase != "follow_projection_updated" {
            return false;
        }
        event
            .payload
            .get("operations")
            .and_then(Value::as_array)
            .map(|operations| {
                operations.iter().any(|operation| {
                    operation["filePath"] == "nested/approved.txt"
                        && operation["status"] == "completed"
                })
            })
            .unwrap_or(false)
    }));

    let user_message_id = detail
        .messages
        .iter()
        .find(|message| message.role == "user")
        .expect("user message")
        .id
        .clone();
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("rollback preview");
    assert_eq!(preview.impact_level, "safe");
    assert_eq!(preview.workspace_changes[0].path, "nested/approved.txt");

    let executed = execute_message_rollback(AgentExecuteMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        rollback_id: preview.rollback_id,
        confirmation_token: Some("restore".to_string()),
        strategy: None,
    })
    .expect("rollback execute");
    assert_eq!(executed.status, "completed");
    assert!(!target.exists());
}

#[test]
fn update_plan_tool_call_creates_plan_and_todo_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut step = 0;

    run_turn_worker_inner(
        &store,
        test_config(),
        &session_id,
        &turn_id,
        None,
        PermissionMode::Sandbox,
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            step += 1;
            if step == 1 {
                Ok(ChatResponse {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolCall {
                        id: "call-plan".to_string(),
                        name: "update_plan".to_string(),
                        arguments: json!({
                            "title": "Runtime plan",
                            "objectiveSummary": "Track execution steps",
                            "steps": [{
                                "id": "step-1",
                                "title": "Inspect code",
                                "expectedTools": ["/tools/filesystem/read_file"],
                                "completionCriteria": ["Tool result recorded"],
                                "riskLevel": "low"
                            }]
                        }),
                    }],
                })
            } else {
                Ok(ChatResponse::text("Plan recorded.".to_string(), None))
            }
        },
    )
    .expect("worker");

    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(
        detail.planning_summary.as_ref().expect("planning").version["steps"][0]["title"],
        "Inspect code"
    );
    let todo = detail.active_todo.as_ref().expect("todo");
    assert_eq!(todo.kind, "plan_bound");
    assert_eq!(todo.items[0].source["planStepId"], "step-1");
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "plan_updated"));
}

#[test]
fn invalid_tool_envelope_is_rejected_internally_and_not_persisted_as_chat() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut responses = vec![
        r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op-approve","op":"run","path":"/tools/approval/approve","args":{"approvalTicketId":"approval_1","decision":"approve"}}"#.to_string(),
        "I need a user approval result before continuing.".to_string(),
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            calls.push(messages);
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
        },
    )
    .expect("worker");

    assert_eq!(calls.len(), 2);
    assert!(calls[1].iter().any(|message| {
        message.role == "user"
            && message
                .content
                .contains("\"errorCode\":\"TOOL_INVALID_ARGUMENT\"")
            && message.content.contains("/tools/approval/approve")
    }));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_failed"
            && event.payload["operation"]["path"] == "/tools/approval/approve"
            && event.payload["result"]["errorCode"] == "TOOL_INVALID_ARGUMENT"
    }));
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "model_stream_reset"
            && event.payload["reason"] == "invalid_tool_operation"));
    assert!(detail.messages.iter().all(|message| {
        message
            .content
            .contains(r#""path":"/tools/approval/approve""#)
            == false
    }));
    assert!(detail.messages.iter().any(|message| {
        message.role == "assistant"
            && message.content == "I need a user approval result before continuing."
    }));
}

#[test]
fn completion_audit_fails_unresolved_workspace_write_failure() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

    emit_store_event(
        &store,
        &session_id,
        Some(&turn_id),
        "tool_operation_failed",
        json!({
            "operation": {
                "schemaVersion": "v1",
                "opId": "op-write",
                "op": "run",
                "path": "/tools/agent/write_file",
                "toolPath": "/tools/agent/write_file",
                "args": { "path": "css/style.css" },
            },
            "result": {
                "status": "failed",
                "errorCode": "TOOL_PATH_NOT_FOUND",
                "errorMessage": "parent path is unavailable: css/style.css",
            },
        }),
    )
    .expect("failed write event");

    let audit = store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit")
        .expect("audit created");

    assert_eq!(audit.status, "failed");
    assert!(audit.summary.contains("failed workspace write operation"));
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(
        detail.delivery_proof.as_ref().expect("delivery").status,
        "failed"
    );
    assert!(detail
        .delivery_proof
        .as_ref()
        .expect("delivery")
        .unresolved_risks["failedToolOperationRefs"]
        .as_array()
        .expect("failed refs")
        .iter()
        .any(|value| value.as_str().unwrap_or_default().contains("css/style.css")));
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            calls.push(messages);
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, messages, _tools, _cancel, _on_delta, _on_retry| {
            calls.push(messages);
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
        ExecutionTarget::Host,
        Arc::new(AtomicBool::new(false)),
        |_config, _messages, _tools, _cancel, _on_delta, _on_retry| {
            Ok(ChatResponse::text(
                responses.next().expect("response"),
                None,
            ))
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
