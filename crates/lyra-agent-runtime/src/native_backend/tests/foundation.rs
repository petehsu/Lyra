use super::*;
#[test]
fn native_backend_creates_and_reads_session() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Test" }))
        .expect("create session");
    assert_eq!(created["workingDir"], "");
    assert_eq!(created["projectBound"], false);
    let session_id = created["id"].as_str().expect("session id").to_string();
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["title"], "Test");
    assert_eq!(read["workingDir"], "");
    assert_eq!(read["projectBound"], false);
}

#[test]
fn tool_activity_projects_trace_records_for_rebuild() {
    let activity = tool_activity(
        "tool-1",
        "git",
        "Git status",
        "completed",
        json!({
            "toolPath": "/tools/git/status",
            "operation": "status"
        }),
        Some(json!({
            "content": "clean",
            "toolPath": "/tools/git/status",
            "traceId": "trace-1",
            "trace": [{
                "schemaVersion": 1,
                "traceId": "trace-1",
                "phase": "completed",
                "status": "ok"
            }]
        })),
        "2026-06-05T00:00:00.000Z",
        Some("2026-06-05T00:00:00.010Z".to_string()),
    );
    assert_eq!(activity["traceId"], "trace-1");
    assert_eq!(
        activity.pointer("/trace/0/phase").and_then(Value::as_str),
        Some("completed")
    );
}

#[test]
fn native_backend_titles_default_sessions_from_first_user_message() {
    let mut session = new_session(None, None, "normal");
    assert_eq!(session.snapshot["title"], DEFAULT_SESSION_TITLE);
    maybe_title_session_from_first_user_message(&mut session, "  帮我检查会话标题生成  ");
    assert_eq!(session.snapshot["title"], "帮我检查会话标题生成");
    push_array(
        &mut session.snapshot,
        "messages",
        user_message("帮我检查会话标题生成".to_string(), Vec::new(), now()),
    );
    maybe_title_session_from_first_user_message(&mut session, "第二条消息不覆盖标题");
    assert_eq!(session.snapshot["title"], "帮我检查会话标题生成");
}
#[test]
fn native_backend_keeps_explicit_or_manual_session_titles() {
    let mut explicit = new_session(Some("Pinned".to_string()), None, "normal");
    maybe_title_session_from_first_user_message(&mut explicit, "用户首条消息");
    assert_eq!(explicit.snapshot["title"], "Pinned");
    let mut manual = new_session(None, None, "normal");
    manual.custom_title = Some("Manual".to_string());
    manual.snapshot["title"] = Value::String("Manual".to_string());
    maybe_title_session_from_first_user_message(&mut manual, "用户首条消息");
    assert_eq!(manual.snapshot["title"], "Manual");
}
#[test]
fn native_state_save_only_rewrites_dirty_sessions() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("sessions")).expect("sessions dir");
    let mut dirty_session = new_session(Some("Dirty".to_string()), None, "normal");
    let mut clean_session = new_session(Some("Clean".to_string()), None, "normal");
    let clean_id = clean_session.id.clone();
    let clean_path = temp
        .path()
        .join("sessions")
        .join(format!("{clean_id}.json"));
    fs::write(&clean_path, "clean sentinel").expect("write clean sentinel");
    dirty_session.dirty = true;
    clean_session.dirty = false;
    let mut state = NativeRuntimeState {
        root: temp.path().to_path_buf(),
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        sessions: HashMap::from([
            (dirty_session.id.clone(), dirty_session),
            (clean_id.clone(), clean_session),
        ]),
        active_session_id: None,
        config: NativeConfig::default(),
        active_skills: HashSet::new(),
        overnight_runs: HashMap::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
        goals: HashMap::new(),
        focused_goal_id: None,
        cancelled_turns: HashSet::new(),
        active_cancellations: HashMap::new(),
        suppressed_tool_usage_by_turn: HashMap::new(),
        inspected_tool_descriptors_by_session: HashMap::new(),
        event_callback: None,
        host_dispatcher: None,
    };
    state.save_state().expect("save state");
    assert_eq!(
        fs::read_to_string(clean_path).expect("clean session untouched"),
        "clean sentinel"
    );
    assert!(state.sessions.values().all(|session| !session.dirty));
}

#[test]
fn native_state_schema_upgrade_clears_legacy_tool_sessions() {
    let temp = tempfile::tempdir().expect("tempdir");
    let sessions_dir = temp.path().join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    let legacy_session = new_session(Some("Legacy".to_string()), None, "normal");
    let legacy_session_id = legacy_session.id.clone();
    write_json(
        &sessions_dir.join(format!("{legacy_session_id}.json")),
        &legacy_session,
    )
    .expect("write legacy session");
    let custom_provider = NativeProviderProfile {
        id: "custom-provider".to_string(),
        label: "Custom Provider".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some("http://localhost:8787/v1".to_string()),
        default_model: Some("custom-model".to_string()),
        api_key: Some("secret".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: Some("custom-embedding".to_string()),
        models: vec![NativeProviderModel {
            id: "custom-model".to_string(),
            label: Some("Custom Model".to_string()),
            context_window: Some(128_000),
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: true,
        }],
    };
    let mut config = NativeConfig {
        default_provider: Some(custom_provider.id.clone()),
        default_model: Some("custom-model".to_string()),
        ..NativeConfig::default()
    };
    config
        .providers
        .insert(custom_provider.id.clone(), custom_provider);
    let memory_marker = format!("schema upgrade memory {}", Uuid::new_v4());
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("project_context".to_string()),
            fact: Some(memory_marker.clone()),
            content: Some(json!({ "fact": memory_marker })),
            confidence: Some(0.91),
            source_type: Some("test".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let goal_id = format!("goal-{}", Uuid::new_v4());
    let goal = LyraGoal {
        id: goal_id.clone(),
        title: "Preserved goal".to_string(),
        status: "active".to_string(),
        scope: Some(temp.path().display().to_string()),
        session_id: Some(legacy_session_id.clone()),
        description: Some("Goal must survive Tool-FS session reset.".to_string()),
        created_at: now(),
        updated_at: now(),
        checkpoints: vec![json!({ "summary": "before migration" })],
    };
    let state_file = NativeStateFile {
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION - 1,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        active_session_id: Some(legacy_session_id.clone()),
        config,
        legacy_shared_memory: Vec::new(),
        active_skills: HashSet::from(["lyra-design-research".to_string()]),
        overnight_runs: HashMap::new(),
        pending_permissions: HashMap::from([(
            "permission-legacy".to_string(),
            PermissionRequest {
                id: "permission-legacy".to_string(),
                session_id: legacy_session_id.clone(),
                turn_id: "turn-legacy".to_string(),
                tool_call_id: "tool-legacy".to_string(),
                action: "write_file".to_string(),
                risk: "dangerous".to_string(),
                summary: "legacy permission".to_string(),
                why: "legacy".to_string(),
                title: "Legacy permission".to_string(),
                detail: "legacy".to_string(),
                status: "pending".to_string(),
                allowed: None,
                created_at: now(),
                responded_at: None,
            },
        )]),
        pending_clarifications: HashMap::from([(
            "clarification-legacy".to_string(),
            ClarificationRequest {
                id: "clarification-legacy".to_string(),
                session_id: legacy_session_id.clone(),
                turn_id: "turn-legacy".to_string(),
                tool_call_id: "tool-legacy".to_string(),
                question: "legacy clarification?".to_string(),
                options: Vec::new(),
                allow_custom_answer: true,
                detail: None,
                status: "pending".to_string(),
                answer: None,
                selected_option: None,
                created_at: now(),
                responded_at: None,
            },
        )]),
        goals: HashMap::from([(goal_id.clone(), goal)]),
        focused_goal_id: Some(goal_id.clone()),
    };
    write_json(&temp.path().join("state.json"), &state_file).expect("write state");

    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());

    assert!(loaded.sessions.is_empty());
    assert_eq!(
        loaded.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION
    );
    assert!(loaded.tool_runtime_migration_diagnostics.is_empty());
    assert_eq!(loaded.active_session_id, None);
    assert!(loaded.pending_permissions.is_empty());
    assert!(loaded.pending_clarifications.is_empty());
    assert_eq!(
        loaded.config.default_provider.as_deref(),
        Some("custom-provider")
    );
    assert!(loaded.config.providers.contains_key("custom-provider"));
    assert!(loaded.active_skills.contains("lyra-design-research"));
    assert_eq!(loaded.focused_goal_id.as_deref(), Some(goal_id.as_str()));
    assert_eq!(
        loaded.goals.get(&goal_id).map(|goal| goal.title.as_str()),
        Some("Preserved goal")
    );
    let memory_records = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(memory_marker.clone()),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("read memory after schema upgrade");
    assert_eq!(memory_records.len(), 1);
    assert!(
        !sessions_dir
            .join(format!("{legacy_session_id}.json"))
            .exists()
    );
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION
    );
    assert!(persisted.tool_runtime_migration_diagnostics.is_empty());
    assert_eq!(
        persisted.config.default_provider.as_deref(),
        Some("custom-provider")
    );
    assert!(persisted.active_skills.contains("lyra-design-research"));
    assert_eq!(persisted.focused_goal_id.as_deref(), Some(goal_id.as_str()));
    assert!(persisted.goals.contains_key(&goal_id));
}

#[test]
fn native_state_schema_upgrade_keeps_old_version_when_session_delete_fails() {
    let temp = tempfile::tempdir().expect("tempdir");
    let sessions_dir = temp.path().join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    let blocked_path = sessions_dir.join("blocked.json");
    fs::create_dir_all(&blocked_path).expect("blocked dir");
    let state_file = NativeStateFile {
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION - 1,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        active_session_id: Some("blocked".to_string()),
        config: NativeConfig::default(),
        legacy_shared_memory: Vec::new(),
        active_skills: HashSet::new(),
        overnight_runs: HashMap::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
        goals: HashMap::new(),
        focused_goal_id: None,
    };
    write_json(&temp.path().join("state.json"), &state_file).expect("write state");

    let loaded = NativeRuntimeState::load_from_root(temp.path().to_path_buf());

    assert!(loaded.sessions.is_empty());
    assert_eq!(
        loaded.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION - 1
    );
    assert_eq!(loaded.tool_runtime_migration_diagnostics.len(), 1);
    assert_eq!(
        loaded.tool_runtime_migration_diagnostics[0]["code"],
        "tool_runtime_session_delete_failed"
    );
    assert!(blocked_path.exists());
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted.tool_runtime_schema_version,
        TOOL_RUNTIME_SCHEMA_VERSION - 1
    );
    assert_eq!(persisted.tool_runtime_migration_diagnostics.len(), 1);
    assert_eq!(persisted.active_session_id, None);
    assert!(persisted.pending_permissions.is_empty());
    assert!(persisted.pending_clarifications.is_empty());
}

#[test]
fn native_state_persists_only_live_pending_requests() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut session = new_session(Some("Pending".to_string()), None, "normal");
    let session_id = session.id.clone();
    let live_turn_id = "turn-live".to_string();
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(live_turn_id.clone());
    let stale_turn_id = "turn-stale".to_string();
    let now = now();
    let permission =
        |id: &str, turn_id: &str, status: &str, allowed: Option<bool>| PermissionRequest {
            id: id.to_string(),
            session_id: session_id.clone(),
            turn_id: turn_id.to_string(),
            tool_call_id: "tool".to_string(),
            action: "act".to_string(),
            risk: "dangerous".to_string(),
            summary: "summary".to_string(),
            why: "why".to_string(),
            title: "title".to_string(),
            detail: "detail".to_string(),
            status: status.to_string(),
            allowed,
            created_at: now.clone(),
            responded_at: allowed.map(|_| now.clone()),
        };
    let clarification =
        |id: &str, turn_id: &str, status: &str, answer: Option<String>| ClarificationRequest {
            id: id.to_string(),
            session_id: session_id.clone(),
            turn_id: turn_id.to_string(),
            tool_call_id: "tool".to_string(),
            question: "question".to_string(),
            options: Vec::new(),
            allow_custom_answer: true,
            detail: None,
            status: status.to_string(),
            answer: answer.clone(),
            selected_option: answer.clone(),
            created_at: now.clone(),
            responded_at: answer.map(|_| now.clone()),
        };
    let mut state = NativeRuntimeState {
        root: temp.path().to_path_buf(),
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        sessions: HashMap::from([(session_id.clone(), session)]),
        active_session_id: Some(session_id.clone()),
        config: NativeConfig::default(),
        active_skills: HashSet::new(),
        overnight_runs: HashMap::new(),
        pending_permissions: HashMap::from([
            (
                "permission-live".to_string(),
                permission("permission-live", &live_turn_id, "pending", None),
            ),
            (
                "permission-complete".to_string(),
                permission("permission-complete", &live_turn_id, "allowed", Some(true)),
            ),
            (
                "permission-stale".to_string(),
                permission("permission-stale", &stale_turn_id, "pending", None),
            ),
        ]),
        pending_clarifications: HashMap::from([
            (
                "clarification-live".to_string(),
                clarification("clarification-live", &live_turn_id, "pending", None),
            ),
            (
                "clarification-complete".to_string(),
                clarification(
                    "clarification-complete",
                    &live_turn_id,
                    "answered",
                    Some("A".to_string()),
                ),
            ),
            (
                "clarification-stale".to_string(),
                clarification("clarification-stale", &stale_turn_id, "pending", None),
            ),
        ]),
        goals: HashMap::new(),
        focused_goal_id: None,
        cancelled_turns: HashSet::new(),
        active_cancellations: HashMap::new(),
        suppressed_tool_usage_by_turn: HashMap::new(),
        inspected_tool_descriptors_by_session: HashMap::new(),
        event_callback: None,
        host_dispatcher: None,
    };
    assert!(state.prune_non_live_pending());
    state.save_state().expect("save state");
    let persisted =
        read_json::<NativeStateFile>(&temp.path().join("state.json")).expect("persisted state");
    assert_eq!(
        persisted
            .pending_permissions
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["permission-live".to_string()]
    );
    assert_eq!(
        persisted
            .pending_clarifications
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec!["clarification-live".to_string()]
    );
}
#[test]
fn native_backend_requires_explicit_project_binding_for_workspace_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Unbound Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-list",
            "/tools/filesystem/list_files",
            json!({ "path": "." }),
        ),
    );
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
    );
    assert_eq!(output["notRunReason"].as_str(), Some("workspace_unbound"));
    assert_eq!(
        output
            .pointer("/error/detail/toolPath")
            .and_then(Value::as_str),
        Some("/tools/filesystem/list_files")
    );
    assert!(
        output["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .all(|record| {
                !matches!(
                    record.get("phase").and_then(Value::as_str),
                    Some("validated" | "permission_checked" | "executing")
                )
            })
    );

    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-shell-unbound",
            "/tools/shell/run_command",
            json!({ "command": "printf shell-ok" }),
        ),
    );
    assert_eq!(shell["status"].as_str(), Some("completed"));
    assert_eq!(shell["raw"]["success"].as_bool(), Some(true));
    assert_eq!(shell["raw"]["stdout"].as_str(), Some("shell-ok"));
    assert_ne!(
        shell.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
    );
}

#[test]
fn tool_fs_run_always_returns_tool_result_envelope_for_adapter_outputs() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("note.txt"), "adapter envelope").expect("write note");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Adapter Envelope Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let cancellation = Arc::new(AtomicBool::new(false));
    for (index, (path, args, expected_domain, expected_operation)) in [
        (
            "/tools/filesystem/read_file",
            json!({ "path": "note.txt" }),
            "filesystem",
            "read",
        ),
        (
            "/tools/shell/run_command",
            json!({ "command": "printf adapter-envelope", "cwd": "." }),
            "shell",
            "run",
        ),
        ("/tools/memory/search", json!({}), "memory", "search"),
    ]
    .into_iter()
    .enumerate()
    {
        let turn_id = start_test_runtime_turn(&session_id);
        let output = execute_model_tool(
            &session_id,
            &turn_id,
            &None,
            &cancellation,
            tool_fs_run_call(&format!("tool-envelope-{index}"), path, args),
        );
        assert_eq!(output["schemaVersion"].as_u64(), Some(1), "{path}");
        assert_eq!(output["status"].as_str(), Some("completed"), "{path}");
        assert_eq!(output["ok"].as_bool(), Some(true), "{path}");
        assert_eq!(
            output["runtimeTurnId"].as_str(),
            Some(turn_id.as_str()),
            "{path}"
        );
        assert_eq!(output["toolPath"].as_str(), Some(path), "{path}");
        assert_eq!(output["domain"].as_str(), Some(expected_domain), "{path}");
        assert_eq!(
            output["operation"].as_str(),
            Some(expected_operation),
            "{path}"
        );
        assert!(output["traceId"].as_str().is_some(), "{path}");
        assert!(
            output["trace"].as_array().is_some_and(|trace| {
                trace.iter().any(|record| record["phase"] == "executing")
                    && trace.iter().any(|record| record["phase"] == "completed")
            }),
            "{path}"
        );
        assert!(output["toolOperation"].is_object(), "{path}");
        assert!(output["manifestTitle"].as_str().is_some(), "{path}");
        assert!(output["raw"].is_object(), "{path}");
    }
}

#[test]
fn tool_fs_hard_cut_hides_legacy_names_and_validates_run_envelope() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Hard Cut Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let legacy = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "legacy-file-read".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": "README.md" }),
        },
    );
    assert_eq!(
        legacy.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );

    let inspect = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "inspect-read-file".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/filesystem/read_file" }),
        },
    );
    assert_eq!(inspect["raw"]["path"], "/tools/filesystem/read_file");
    assert_eq!(inspect["raw"]["handle"], "read_file");
    assert!(inspect["raw"]["inputSchema"].is_object());
    let legacy_field = ["legacy", "Name"].join("");
    assert!(inspect["raw"].get(&legacy_field).is_none());

    let invalid_args = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "invalid-tool-fs-args".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "path": "/tools/filesystem/read_file",
                "args": []
            }),
        },
    );
    assert_eq!(
        invalid_args.pointer("/error/code").and_then(Value::as_str),
        Some("invalid_tool_args")
    );
    assert_eq!(invalid_args["schemaVersion"].as_u64(), Some(1));
    assert_eq!(invalid_args["status"].as_str(), Some("failed"));
    assert_eq!(
        invalid_args["runtimeTurnId"].as_str(),
        Some(turn_id.as_str())
    );
    assert!(invalid_args["traceId"].as_str().is_some());

    let inactive_turn = execute_model_tool(
        &session_id,
        "turn-not-active",
        &None,
        &cancellation,
        ModelToolCall {
            id: "inactive-turn-tool-fs-run".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "path": "/tools/filesystem/read_file",
                "args": { "path": "README.md" }
            }),
        },
    );
    assert_eq!(
        inactive_turn.pointer("/error/code").and_then(Value::as_str),
        Some("runtime_turn_not_active")
    );
    assert_eq!(inactive_turn["status"].as_str(), Some("failed"));
    let inactive_list = execute_model_tool(
        &session_id,
        "turn-not-active",
        &None,
        &cancellation,
        ModelToolCall {
            id: "inactive-turn-tool-fs-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools" }),
        },
    );
    assert_eq!(
        inactive_list.pointer("/error/code").and_then(Value::as_str),
        Some("runtime_turn_not_active")
    );
    assert_eq!(inactive_list["status"].as_str(), Some("failed"));
    assert!(
        inactive_list["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .all(|record| {
                !matches!(
                    record.get("phase").and_then(Value::as_str),
                    Some("executing" | "completed")
                )
            })
    );

    let traced = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("traced-memory-search", "/tools/memory/search", json!({})),
    );
    assert_eq!(traced["status"].as_str(), Some("completed"));
    let policy_snapshot_id = traced
        .pointer("/toolOperation/policySnapshotId")
        .and_then(Value::as_str)
        .expect("policy snapshot id");
    assert!(policy_snapshot_id.contains(&session_id));
    assert!(policy_snapshot_id.contains(&turn_id));
    let trace = traced["trace"].as_array().expect("trace");
    let phases = trace
        .iter()
        .filter_map(|entry| entry["phase"].as_str())
        .collect::<Vec<_>>();
    let validated_index = phases
        .iter()
        .position(|phase| *phase == "validated")
        .expect("validated trace");
    let permission_index = phases
        .iter()
        .position(|phase| *phase == "permission_checked")
        .expect("permission trace");
    let executing_index = phases
        .iter()
        .position(|phase| *phase == "executing")
        .expect("executing trace");
    assert!(validated_index < permission_index);
    assert!(permission_index < executing_index);
    let permission_trace = &trace[permission_index];
    assert_eq!(
        permission_trace.pointer("/detail/policySnapshotId"),
        traced.pointer("/toolOperation/policySnapshotId")
    );
    assert_eq!(
        permission_trace
            .pointer("/detail/permissionMode")
            .and_then(Value::as_str),
        Some("runtime_policy")
    );
    assert_eq!(
        permission_trace
            .pointer("/detail/permissionPolicy")
            .and_then(Value::as_str),
        Some("runtime_policy")
    );
    assert_eq!(
        permission_trace
            .pointer("/detail/toolPath")
            .and_then(Value::as_str),
        Some("/tools/memory/search")
    );
}

#[test]
fn tool_fs_search_is_provider_visible_and_returns_ranked_results() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool Search Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-command".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({
                "query": "执行测试命令 run shell command",
                "scene": "project-code",
                "pageSize": 8
            }),
        },
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output["toolPath"].as_str(),
        Some("/tools/runtime/tool_fs_search")
    );
    assert_eq!(output["raw"]["kind"].as_str(), Some("tool_fs_search"));
    assert!(
        output["raw"]["results"]
            .as_array()
            .expect("search results")
            .iter()
            .any(|result| result["path"] == "/tools/shell/run_command")
    );
    let top_result = output["raw"]["results"]
        .as_array()
        .expect("search results")
        .first()
        .expect("top search result");
    assert!(
        top_result
            .get("runHint")
            .and_then(Value::as_str)
            .is_some_and(|hint| hint.contains("tool_fs_run"))
    );
    assert!(
        top_result
            .pointer("/miniSchema/parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| !parameters.is_empty())
    );
    assert!(
        output["content"]
            .as_str()
            .is_some_and(|content| content.contains("miniSchema/runHint"))
    );
    assert!(
        output["trace"]
            .as_array()
            .is_some_and(|trace| trace.iter().any(|record| record["phase"] == "completed"))
    );

    let invalid = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-empty".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({ "query": "" }),
        },
    );
    assert_eq!(
        invalid.pointer("/error/code").and_then(Value::as_str),
        Some("invalid_tool_search_query")
    );
}

#[test]
fn tool_fs_inspect_populates_session_descriptor_cache_context() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool Descriptor Cache Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        state.inspected_tool_descriptors_by_session.clear();
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "inspect-browser-map".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/browser/map" }),
        },
    );
    assert_eq!(output["status"].as_str(), Some("completed"));

    let context = tool_filesystem_runtime_context("browser", Some(&session_id), None);
    let descriptors = context["inspectedDescriptors"]
        .as_array()
        .expect("inspected descriptors");
    let browser_map = descriptors
        .iter()
        .find(|entry| entry["path"] == "/tools/browser/map")
        .expect("browser map descriptor cache entry");
    assert!(
        browser_map["runHint"]
            .as_str()
            .is_some_and(|hint| hint.contains("tool_fs_run"))
    );
    assert!(
        browser_map
            .pointer("/miniSchema/parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| !parameters.is_empty())
    );
}

#[test]
fn tool_fs_presearch_hints_use_latest_user_message() {
    let hints = tools::tool_fs::presearch_hints_for_message(
        "打开网页 https://www.google.com",
        "browser",
        None,
        None,
    );
    let hints = hints.as_array().expect("presearch hints");
    let navigate = hints
        .iter()
        .find(|hint| hint["path"] == "/tools/browser/navigate")
        .expect("navigate hint");
    assert!(
        navigate["runHint"]
            .as_str()
            .is_some_and(|hint| hint.contains("tool_fs_run"))
    );
    assert!(
        navigate
            .pointer("/miniSchema/parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| !parameters.is_empty())
    );
    assert_eq!(
        navigate["source"].as_str(),
        Some("latestUserMessagePresearch")
    );
}

#[test]
fn tool_usage_cache_records_success_failure_and_context_handles() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("note.txt"), "cached tool note").expect("write note");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Tool Usage Cache Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        state.tool_usage_cache.clear();
        state.suppressed_tool_usage_by_turn.clear();
    }
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let success = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-cache-read-success",
            "/tools/filesystem/read_file",
            json!({ "path": "note.txt" }),
        ),
    );
    assert_eq!(success["ok"].as_bool(), Some(true));
    {
        let state = state().lock().expect("state lock");
        let entry = state
            .tool_usage_cache
            .get("/tools/filesystem/read_file")
            .expect("usage cache entry");
        assert_eq!(entry.successes, 1);
        assert_eq!(entry.failures, 0);
        assert_eq!(entry.consecutive_failures, 0);
        assert_eq!(entry.handle.as_deref(), Some("read_file"));
    }

    let context = tool_filesystem_runtime_context("project-code", None, None);
    assert!(
        context["cachedHandles"]
            .as_array()
            .expect("cached handles")
            .iter()
            .any(|handle| handle["path"] == "/tools/filesystem/read_file"
                && handle["source"] == "toolUsageCache")
    );

    let failed = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-cache-read-failed",
            "/tools/filesystem/read_file",
            json!({ "path": "missing.txt" }),
        ),
    );
    assert_eq!(failed["ok"].as_bool(), Some(false));
    assert_eq!(failed["cacheSuppressedForTurn"].as_bool(), Some(true));
    assert!(
        failed["recommendedNextAction"]
            .as_str()
            .is_some_and(|action| action.contains("tool_fs_search"))
    );
    {
        let state = state().lock().expect("state lock");
        let entry = state
            .tool_usage_cache
            .get("/tools/filesystem/read_file")
            .expect("usage cache entry");
        assert_eq!(entry.successes, 1);
        assert_eq!(entry.failures, 1);
        assert_eq!(entry.consecutive_failures, 1);
        assert!(
            state
                .suppressed_tool_usage_by_turn
                .get(&turn_id)
                .is_some_and(|paths| paths.contains("/tools/filesystem/read_file"))
        );
    }
}

#[test]
fn model_catalog_uses_structured_provider_capabilities() {
    let catalog = list_models(json!({})).expect("model catalog");
    assert!(catalog["models"].as_array().is_some());
    assert!(catalog["routes"].as_array().is_some());
    assert!(catalog["models"].as_array().is_some_and(|models| {
        models.iter().any(|model| {
            model
                .get("embeddingModel")
                .and_then(Value::as_str)
                .is_some()
        })
    }));
}
#[test]
fn model_request_injects_lyra_identity_and_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Prompt Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id");
    state().lock().expect("state lock").active_skills.clear();
    let request = build_model_request(session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("You are Lyra Agent"));
    assert!(system_prompt.contains("answer directly when no external Lyra capability is needed"));
    let names = request
        .tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        expected_provider_tool_names()
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    assert!(system_prompt.contains("toolFilesystem"));
    assert!(system_prompt.contains("pinnedHandles"));
    assert!(!request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_design_search_styles")
    }));
}

#[test]
fn model_request_keeps_tool_fs_visible_while_presearch_adds_hints() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool Presearch Prompt Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    state().lock().expect("state lock").active_skills.clear();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["messages"]
            .as_array_mut()
            .expect("messages")
            .push(user_message(
                "打开网页 https://www.google.com".to_string(),
                Vec::new(),
                now(),
            ));
    }

    let request = build_model_request(&session_id).expect("model request");
    let names = request
        .tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    assert_eq!(names, expected_provider_tool_names());
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("/tools/browser/navigate"));
    assert!(!system_prompt.contains("\"toolDiscoverySuppressed\": true"));
}

#[test]
fn runtime_context_does_not_expose_tools_to_non_tool_calling_models() {
    let context = build_runtime_context(
        None,
        &[],
        &ModelCapabilityProfile {
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: false,
            context_window: Some(8_192),
        },
    );
    assert_eq!(context["tools"], json!([]));
    assert_eq!(
        context
            .pointer("/capabilities/supportsToolCalling")
            .and_then(Value::as_bool),
        Some(false)
    );
}

#[test]
fn provider_visible_tool_schema_snapshot_is_tool_fs_only() {
    for tools in [model_tools(false), model_tools(true)] {
        let names = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(names, expected_provider_tool_names());
        assert!(tools.iter().all(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|name| name.starts_with("tool_fs_") || name == LYRA_TURN_FINISH_TOOL)
        }));
        assert!(!tools.iter().any(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|name| {
                    matches!(
                        name,
                        "file_read"
                            | "shell_run"
                            | "terminal_read"
                            | "lyra_lumen_read"
                            | "lyra_design_search_styles"
                            | "software_invoke_capability"
                    )
                })
        }));
    }
}

#[test]
fn tool_filesystem_runtime_context_uses_dynamic_registry_without_expanding_provider_tools() {
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "software.listCapabilities");
        Ok(serde_json::to_string(&json!({
            "software": [{
                "id": "notes",
                "title": "Notes",
                "actions": [{
                    "id": "open",
                    "title": "Open note",
                    "summary": "Open a note in the Notes adapter.",
                    "risk": "read",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "noteId": { "type": "string" }
                        },
                        "required": ["noteId"],
                        "additionalProperties": false
                    }
                }]
            }]
        }))
        .expect("json"))
    });
    let static_count = tools::tool_fs::runtime_registry()
        .root_summary_for_scene(lyra_tool_fs_core::ToolScene::Automation)["toolCount"]
        .as_u64()
        .expect("static tool count");
    let context = tool_filesystem_runtime_context("automation", None, Some(&dispatcher));
    assert_eq!(
        context["policy"]["providerVisibleTools"],
        json!(expected_provider_tool_names())
    );
    assert!(
        context["rootSummary"]["toolCount"]
            .as_u64()
            .expect("dynamic tool count")
            > static_count
    );
    let sources = context["manifestSources"]
        .as_array()
        .expect("manifest source summary");
    for expected in [
        "core_builtin",
        "terminal_action_specs",
        "design_tools",
        "skill_registry",
        "mcp_current_state",
        "software_host_capabilities",
    ] {
        assert!(
            sources
                .iter()
                .any(|source| source["name"].as_str() == Some(expected)),
            "missing manifest source {expected}"
        );
    }
    assert!(sources.iter().any(|source| {
        source["name"].as_str() == Some("software_host_capabilities")
            && source["kind"].as_str() == Some("dynamic")
            && source["manifestCount"].as_u64().unwrap_or(0) == 1
    }));
}

#[test]
fn tool_filesystem_scene_uses_runtime_state_signals() {
    assert_eq!(
        infer_tool_filesystem_scene(Some("selfdev"), None, false, &HashSet::new(), &json!({})),
        "project-code"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            false,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "terminal" } }),
        ),
        "terminal"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            false,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "browser" } }),
        ),
        "browser"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            false,
            &HashSet::new(),
            &json!({
                "activeTabId": "term-1",
                "tabs": [{
                    "tabId": "term-1",
                    "pageKind": "terminal",
                    "focusedPane": true
                }]
            }),
        ),
        "terminal"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            false,
            &HashSet::new(),
            &json!({
                "focusedTabId": "page-1",
                "tabs": [{
                    "id": "page-1",
                    "pageKind": "page",
                    "observationKind": "page",
                    "displayAddress": "https://example.com"
                }]
            }),
        ),
        "browser"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            false,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "software" } }),
        ),
        "automation"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            false,
            &HashSet::from(["lyra-design-research".to_string()]),
            &json!({}),
        ),
        "design"
    );
}

#[test]
fn design_prompt_gets_design_tools_and_dynamic_policy() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Design Prompt Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["messages"]
            .as_array_mut()
            .expect("messages")
            .push(user_message(
                "重新设计这个设置页面".to_string(),
                Vec::new(),
                now(),
            ));
    }
    let request = build_model_request(&session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("Design Research Summary"));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("tool_fs_run")
    }));
    assert!(system_prompt.contains("/tools/design/search_styles"));
    assert!(system_prompt.contains("/tools/design/get_style_details"));
}
#[test]
fn model_tool_execution_records_workbench_activity() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Tool Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "workbench.listTabs");
        Ok(serde_json::to_string(&json!({
            "activeTabId": "browser-tab-1",
            "tabs": [
                {
                    "tabId": "browser-tab-1",
                    "title": "Example",
                    "pageKind": "page",
                    "observationKind": "page",
                    "active": true,
                    "visible": true,
                    "focusedPane": true,
                    "observable": true,
                    "url": "https://example.com"
                }
            ]
        }))
        .expect("json"))
    });
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-test",
            "/tools/workbench/list_tabs",
            json!({ "scope": "all" }),
        ),
    );
    assert!(
        output["content"]
            .as_str()
            .unwrap()
            .contains("browser-tab-1")
    );
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "workbench");
    assert_eq!(read["tools"][0]["status"], "completed");
}
#[test]
fn terminal_host_tool_runtime_cancellation_includes_tool_call_id() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Terminal Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let captured_payload = Arc::new(Mutex::new(None::<Value>));
    let captured_for_dispatch = captured_payload.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        assert_eq!(method, "terminal.read");
        let payload_value: Value = serde_json::from_str(&payload).expect("host payload json");
        *captured_for_dispatch.lock().expect("captured payload lock") = Some(payload_value);
        Ok(serde_json::to_string(&json!({
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "cursor": "1",
            "output": "hello from terminal",
            "running": true,
            "exitCode": null,
            "truncated": false
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-terminal-read",
            "/tools/terminal/read",
            json!({ "sessionId": "terminal-session-1" }),
        ),
    );
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .contains("terminal-session-1")
    );
    assert_eq!(
        output
            .pointer("/raw/logArtifactRef/kind")
            .and_then(Value::as_str),
        Some("log")
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|artifact| artifact["kind"] == "log"))
    );
    let captured = captured_payload
        .lock()
        .expect("captured payload lock")
        .clone()
        .expect("captured payload");
    assert_eq!(
        captured
            .pointer("/runtimeCancellation/sessionId")
            .and_then(Value::as_str),
        Some(session_id.as_str())
    );
    assert_eq!(
        captured
            .pointer("/runtimeCancellation/turnId")
            .and_then(Value::as_str),
        Some(turn_id.as_str())
    );
    assert_eq!(
        captured
            .pointer("/runtimeCancellation/toolCallId")
            .and_then(Value::as_str),
        Some("tool-terminal-read")
    );
}
#[test]
fn terminal_activity_summary_includes_full_output_path_for_projected_memory() {
    let summary = format_terminal_output(
        "read",
        &json!({
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "cursor": "20000",
            "output": "projected output",
            "running": true,
            "exitCode": null,
            "truncated": true,
            "memory": {
                "outputTextPath": "/tmp/lyra/terminal-memory/sessions/terminal-session-1/outputs/session-output.txt",
                "truncatedByProjection": true
            }
        }),
    );
    assert!(summary.contains("private terminal terminal-session-1"));
    assert!(summary.contains(
        "fullOutputPath=/tmp/lyra/terminal-memory/sessions/terminal-session-1/outputs/session-output.txt"
    ));
    assert!(summary.contains("projected output"));
}
#[test]
fn host_tool_ok_false_records_failed_activity() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Failed Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "lyraLumen.read");
        Ok(serde_json::to_string(&json!({
            "ok": false,
            "kind": "lyraLumenResult",
            "error": {
                "kind": "lyraLumenRuntimeError",
                "message": "frame script timed out after 8000ms"
            }
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-timeout",
            "/tools/browser/read",
            json!({ "tabId": "browser-tab-1" }),
        ),
    );
    assert_eq!(output["raw"]["ok"], false);
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "lyra_lumen");
    assert_eq!(read["tools"][0]["status"], "failed");
}
#[test]
fn host_tool_timeout_finishes_activity() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Host Timeout Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|_method, _payload| {
        std::thread::sleep(Duration::from_millis(2_000));
        Ok(serde_json::to_string(&json!({ "ok": true })).expect("json"))
    });
    let started = Instant::now();
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-timeout-hard-boundary",
            "/tools/workbench/list_tabs",
            json!({ "timeoutMs": 250 }),
        ),
    );
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(
        output["content"]
            .as_str()
            .unwrap_or_default()
            .contains("timed out")
    );
    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(output["notRunReason"].as_str(), Some("timeout"));
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("timeout")
    );
    assert!(
        output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "workbench");
    assert_eq!(read["tools"][0]["status"], "failed");
    assert!(read["tools"][0]["finishedAt"].is_string());
}

#[test]
fn tool_fs_large_raw_output_is_compacted_into_artifact_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Large Raw Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let large_blob = "x".repeat(40_000);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.readTab");
        Ok(serde_json::to_string(&json!({
            "tab": {
                "tabId": "tab-1",
                "title": "Large Raw",
                "pageKind": "editor",
                "observationKind": "file"
            },
            "text": "Small model projection.",
            "largeBlob": large_blob
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-raw",
            "/tools/workbench/read_tab",
            json!({ "tabId": "tab-1" }),
        ),
    );
    assert_eq!(output["status"], "completed");
    assert_eq!(output["raw"]["kind"], "tool_fs_raw_ref");
    assert_eq!(output["raw"]["truncated"], true);
    assert_eq!(
        output.pointer("/dataRef/id").and_then(Value::as_str),
        output
            .pointer("/raw/artifactRef/id")
            .and_then(Value::as_str)
    );
    assert!(output["artifactRefs"].as_array().is_some_and(|refs| {
        refs.iter()
            .any(|artifact| artifact.get("id") == output.pointer("/dataRef/id"))
    }));
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .contains("Small model projection")
    );
    let data_ref_path = output
        .pointer("/dataRef/path")
        .and_then(Value::as_str)
        .expect("data ref path")
        .to_string();
    let data_ref_id = output
        .pointer("/dataRef/id")
        .and_then(Value::as_str)
        .expect("data ref id")
        .to_string();
    let artifact_read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-raw-artifact-read",
            "/tools/runtime/artifact_read",
            json!({ "path": data_ref_path, "maxBytes": 128_000 }),
        ),
    );
    assert_eq!(artifact_read["status"], "completed");
    assert_eq!(
        artifact_read["toolPath"].as_str(),
        Some("/tools/runtime/artifact_read")
    );
    assert_eq!(
        artifact_read
            .pointer("/raw/artifactId")
            .and_then(Value::as_str),
        Some(data_ref_id.as_str())
    );
    assert!(
        artifact_read["content"]
            .as_str()
            .expect("artifact content")
            .contains("largeBlob")
    );
    assert!(
        artifact_read
            .pointer("/raw/bytesReturned")
            .and_then(Value::as_u64)
            .is_some_and(|bytes| bytes > 32_000)
    );
}

#[test]
fn tool_fs_large_content_projection_is_compacted_into_projection_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Large Projection Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let large_text = "projection ".repeat(4_000);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _payload| {
        assert_eq!(method, "workbench.readTab");
        Ok(serde_json::to_string(&json!({
            "tab": {
                "tabId": "tab-1",
                "title": "Large Projection",
                "pageKind": "editor",
                "observationKind": "file"
            },
            "text": large_text
        }))
        .expect("json"))
    });
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-projection",
            "/tools/workbench/read_tab",
            json!({ "tabId": "tab-1" }),
        ),
    );
    assert_eq!(output["status"], "completed");
    assert!(
        output["content"]
            .as_str()
            .expect("content")
            .ends_with("[truncated]")
    );
    assert!(
        output
            .pointer("/projectionRef/id")
            .and_then(Value::as_str)
            .is_some()
    );
    assert!(output["artifactRefs"].as_array().is_some_and(|refs| {
        refs.iter()
            .any(|artifact| artifact.get("id") == output.pointer("/projectionRef/id"))
    }));
}

#[test]
fn host_unavailable_failure_has_not_run_reason() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Host Unavailable Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-host-unavailable",
            "/tools/workbench/list_tabs",
            json!({}),
        ),
    );
    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("host_unavailable")
    );
    assert_eq!(output["notRunReason"].as_str(), Some("host_unavailable"));
    assert!(
        output["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .all(|record| {
                !matches!(
                    record.get("phase").and_then(Value::as_str),
                    Some("permission_checked" | "executing")
                )
            })
    );
    assert!(
        output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
}

#[test]
fn host_permission_denied_failure_has_not_run_reason_and_no_changes() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Host Permission Denied Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        panic!("host dispatcher should not be called after permission denial: {method}")
    });
    let run_session_id = session_id.clone();
    let run_dispatcher = dispatcher.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &turn_id,
            &Some(run_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-host-permission-denied",
                "/tools/browser/submit",
                json!({ "elementId": 9, "targetMode": "live" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny host permission");
    let output = handle.join().expect("join host permission denied");
    assert_eq!(output["status"].as_str(), Some("failed"));
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("permissionDenied")
    );
    assert_eq!(output["notRunReason"].as_str(), Some("permissionDenied"));
    assert!(
        output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
}

#[test]
fn permission_wait_cancellation_returns_cancelled_envelope_and_clears_pending_request() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Cancellation Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        panic!("host dispatcher should not be called after permission wait cancellation: {method}")
    });
    let run_session_id = session_id.clone();
    let run_turn_id = turn_id.clone();
    let run_cancellation = cancellation.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &run_turn_id,
            &Some(dispatcher),
            &run_cancellation,
            tool_fs_run_call(
                "tool-permission-cancelled",
                "/tools/browser/submit",
                json!({ "elementId": 9, "targetMode": "live" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    cancellation.store(true, Ordering::SeqCst);
    let output = handle.join().expect("join cancelled permission wait");
    assert_eq!(output["status"].as_str(), Some("cancelled"));
    assert_eq!(output["notRunReason"].as_str(), Some("cancelled"));
    assert!(
        output["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .any(|record| record.get("phase").and_then(Value::as_str) == Some("cancelled"))
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .pending_permissions
            .get(&permission_id)
            .is_none()
    );
}

#[test]
fn model_tool_execution_bridges_lumen_and_software_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "lyraLumen.see" => {
                assert_eq!(input["action"], "see");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenSee",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "width": 800,
                    "height": 600,
                    "imageBase64": "large-inline-image",
                    "screenshot": {
                        "mediaType": "image/png",
                        "data": "large-inline-image"
                    },
                    "imageArtifact": {
                        "id": "artifact-1",
                        "path": "/tmp/artifact-1.png",
                        "width": 800,
                        "height": 600
                    }
                }))
                .expect("json"))
            }
            "lyraLumen.submit" => {
                assert_eq!(input["action"], "submit");
                assert_eq!(input["elementId"], 9);
                assert_eq!(input["targetMode"], "live");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenActionResult",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "elementId": 9,
                    "submitted": true,
                    "message": "Submitted element 9 with Chromium virtual keyboard."
                }))
                .expect("json"))
            }
            "software.inspectCapability" => {
                assert_eq!(input["softwareId"], "image-viewer");
                assert_eq!(input["capabilityId"], "image-viewer.readMetadata");
                Ok(serde_json::to_string(&json!({
                    "software": {
                        "id": "image-viewer",
                        "title": "Image Viewer",
                        "actions": []
                    },
                    "action": {
                        "id": "image-viewer.readMetadata",
                        "title": "Read Image Metadata",
                        "risk": "read",
                        "inputSchema": { "type": "object" }
                    },
                    "handlerRegistered": true,
                    "readableState": { "available": true }
                }))
                .expect("json"))
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let see_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-see",
            "/tools/browser/see",
            json!({ "targetMode": "live" }),
        ),
    );
    assert!(
        see_output["content"]
            .as_str()
            .expect("content")
            .contains("/tmp/artifact-1.png")
    );
    assert!(see_output["raw"].get("imageBase64").is_none());
    assert!(see_output["raw"]["screenshot"].get("data").is_none());
    let submit_turn_id = start_test_runtime_turn(&session_id);
    let submit_session_id = session_id.clone();
    let submit_dispatcher = dispatcher.clone();
    let submit_handle = thread::spawn(move || {
        execute_model_tool(
            &submit_session_id,
            &submit_turn_id,
            &Some(submit_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-submit",
                "/tools/browser/submit",
                json!({ "elementId": 9, "targetMode": "live" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow submit permission");
    let submit_output = submit_handle.join().expect("join submit");
    assert!(
        submit_output["content"]
            .as_str()
            .expect("content")
            .contains("Submitted element 9")
    );
    assert_eq!(
        submit_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(
        submit_output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "browser"
                    && change["operation"] == "submit"
                    && change["reversible"] == false
            }))
    );
    let inspect_turn_id = start_test_runtime_turn(&session_id);
    let inspect_output = execute_model_tool(
        &session_id,
        &inspect_turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-inspect",
            "/tools/software/inspect_capability",
            json!({
                "softwareId": "image-viewer",
                "capabilityId": "image-viewer.readMetadata"
            }),
        ),
    );
    assert!(
        inspect_output["content"]
            .as_str()
            .expect("content")
            .contains("Read Image Metadata")
    );
}

#[test]
fn browser_inline_screenshot_is_materialized_as_artifact_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Inline Browser Screenshot Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.see");
        assert_eq!(input["action"], "see");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenSee",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "width": 1,
            "height": 1,
            "imageBase64": "iVBORw0KGgo=",
            "screenshot": {
                "mediaType": "image/png",
                "data": "iVBORw0KGgo="
            }
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-inline-see",
            "/tools/browser/see",
            json!({ "targetMode": "live" }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert!(output["raw"].get("imageBase64").is_none());
    assert!(output["raw"]["screenshot"].get("data").is_none());
    assert_eq!(
        output
            .pointer("/raw/screenshotArtifactRef/kind")
            .and_then(Value::as_str),
        Some("browser_screenshot")
    );
    assert_eq!(
        output.pointer("/raw/providerImage/path"),
        output.pointer("/raw/imageArtifact/path")
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|artifact| {
                artifact["kind"] == "browser_screenshot"
                    && artifact["mimeType"] == "image/png"
                    && artifact["path"]
                        .as_str()
                        .is_some_and(|path| path.ends_with(".png"))
            }))
    );
}

#[test]
fn browser_large_page_text_is_materialized_as_web_page_artifact_ref() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Large Browser Page Artifact Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let large_text = "Large browser page line.\n".repeat(1_000);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        assert_eq!(method, "lyraLumen.read");
        assert_eq!(input["action"], "read");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "kind": "lyraLumenRead",
            "tabId": "browser-tab-1",
            "targetMode": "live",
            "title": "Large Page",
            "url": "https://example.test/large",
            "content": large_text
        }))
        .expect("json"))
    });

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-large-browser-read",
            "/tools/browser/read",
            json!({ "targetMode": "live" }),
        ),
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(
        output
            .pointer("/raw/pageArtifactRef/kind")
            .and_then(Value::as_str),
        Some("web_page")
    );
    assert_eq!(
        output
            .pointer("/raw/pageTextTruncated")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert!(
        output
            .pointer("/raw/content")
            .and_then(Value::as_str)
            .is_some_and(
                |content| content.contains("pageArtifactRef") && content.chars().count() < 13_000
            )
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|refs| refs.iter().any(|artifact| {
                artifact["kind"] == "web_page"
                    && artifact["mimeType"] == "text/plain; charset=utf-8"
                    && artifact["path"]
                        .as_str()
                        .is_some_and(|path| path.ends_with(".txt"))
            }))
    );
}

#[test]
fn browser_tool_fs_task_chain_maps_types_submits_waits_and_reads() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Browser Chain Tool-FS Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let calls_for_dispatch = calls.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        calls_for_dispatch
            .lock()
            .expect("calls lock")
            .push(method.clone());
        match method.as_str() {
            "lyraLumen.map" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenMap",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "observationId": "obs-1",
                "title": "Login",
                "url": "https://example.test/login",
                "elements": [{
                    "id": 1,
                    "role": "textbox",
                    "label": "Email",
                    "targetRef": "target-email"
                }, {
                    "id": 2,
                    "role": "button",
                    "label": "Continue",
                    "targetRef": "target-continue"
                }]
            }))
            .expect("json")),
            "lyraLumen.type" => {
                assert_eq!(input["targetRef"], "target-email");
                assert_eq!(input["text"], "lyra@example.test");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenActionResult",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-email",
                    "typed": true,
                    "message": "typed email"
                }))
                .expect("json"))
            }
            "lyraLumen.submit" => {
                assert_eq!(input["targetRef"], "target-continue");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenActionResult",
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-continue",
                    "submitted": true,
                    "message": "submitted form"
                }))
                .expect("json"))
            }
            "lyraLumen.wait" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenWait",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "content": "Dashboard loaded"
            }))
            .expect("json")),
            "lyraLumen.read" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenRead",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "title": "Dashboard",
                "url": "https://example.test/app",
                "content": "Welcome to the dashboard"
            }))
            .expect("json")),
            other => panic!("unexpected browser host method {other}"),
        }
    });
    let cancellation = Arc::new(AtomicBool::new(false));

    let map = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &cancellation,
        tool_fs_run_call(
            "tool-browser-chain-map",
            "/tools/browser/map",
            json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
        ),
    );
    assert_eq!(map["status"].as_str(), Some("completed"));
    assert_eq!(map["toolPath"].as_str(), Some("/tools/browser/map"));
    assert!(
        map["content"]
            .as_str()
            .is_some_and(|text| text.contains("target-email"))
    );

    let type_session_id = session_id.clone();
    let type_turn_id = turn_id.clone();
    let type_dispatcher = dispatcher.clone();
    let type_cancellation = cancellation.clone();
    let type_handle = thread::spawn(move || {
        execute_model_tool(
            &type_session_id,
            &type_turn_id,
            &Some(type_dispatcher),
            &type_cancellation,
            tool_fs_run_call(
                "tool-browser-chain-type",
                "/tools/browser/type",
                json!({
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-email",
                    "text": "lyra@example.test"
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow type permission");
    let typed = type_handle.join().expect("join type");
    assert_eq!(typed["status"].as_str(), Some("completed"));
    assert!(typed["changes"].as_array().is_some_and(|changes| {
        changes
            .iter()
            .any(|change| change["kind"] == "browser" && change["operation"] == "type")
    }));

    let submit_session_id = session_id.clone();
    let submit_turn_id = turn_id.clone();
    let submit_dispatcher = dispatcher.clone();
    let submit_cancellation = cancellation.clone();
    let submit_handle = thread::spawn(move || {
        execute_model_tool(
            &submit_session_id,
            &submit_turn_id,
            &Some(submit_dispatcher),
            &submit_cancellation,
            tool_fs_run_call(
                "tool-browser-chain-submit",
                "/tools/browser/submit",
                json!({
                    "tabId": "browser-tab-1",
                    "targetMode": "live",
                    "targetRef": "target-continue"
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow submit permission");
    let submitted = submit_handle.join().expect("join submit");
    assert_eq!(submitted["status"].as_str(), Some("completed"));
    assert!(submitted["changes"].as_array().is_some_and(|changes| {
        changes
            .iter()
            .any(|change| change["kind"] == "browser" && change["operation"] == "submit")
    }));

    let waited = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &cancellation,
        tool_fs_run_call(
            "tool-browser-chain-wait",
            "/tools/browser/wait",
            json!({ "tabId": "browser-tab-1", "targetMode": "live", "timeoutMs": 1000 }),
        ),
    );
    assert_eq!(waited["status"].as_str(), Some("completed"));
    assert!(
        waited["content"]
            .as_str()
            .is_some_and(|text| text.contains("Dashboard loaded"))
    );

    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &cancellation,
        tool_fs_run_call(
            "tool-browser-chain-read",
            "/tools/browser/read",
            json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
        ),
    );
    assert_eq!(read["status"].as_str(), Some("completed"));
    assert!(
        read["content"]
            .as_str()
            .is_some_and(|text| text.contains("Welcome to the dashboard"))
    );
    assert_eq!(
        calls.lock().expect("calls lock").as_slice(),
        [
            "lyraLumen.map",
            "lyraLumen.type",
            "lyraLumen.submit",
            "lyraLumen.wait",
            "lyraLumen.read"
        ]
    );
}

#[test]
fn tool_fs_dynamic_software_capabilities_are_discoverable_and_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Dynamic Software Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let captured_invocation = Arc::new(Mutex::new(None::<Value>));
    let captured_for_dispatch = captured_invocation.clone();
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(move |method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "software.listCapabilities" => {
                assert_eq!(input["includeSchemas"], true);
                Ok(serde_json::to_string(&json!({
                    "software": [{
                        "id": "image-viewer",
                        "title": "Image Viewer",
                        "description": "Inspect local image files.",
                        "source": "builtin",
                        "actions": [{
                            "id": "image-viewer.readMetadata",
                            "title": "Read Image Metadata",
                            "description": "Read metadata for one image file.",
                            "risk": "read",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string" }
                                },
                                "required": ["path"]
                            }
                        }, {
                            "id": "image-viewer.applyFilter",
                            "title": "Apply Image Filter",
                            "description": "Apply a filter to the active image.",
                            "risk": "write",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string" },
                                    "filter": { "type": "string" }
                                },
                                "required": ["path", "filter"]
                            }
                        }]
                    }]
                }))
                .expect("json"))
            }
            "software.invokeCapability" => {
                *captured_for_dispatch
                    .lock()
                    .expect("captured invocation lock") = Some(input.clone());
                if input["actionId"] == "image-viewer.applyFilter" {
                    Ok(serde_json::to_string(&json!({
                        "softwareId": "image-viewer",
                        "actionId": "image-viewer.applyFilter",
                        "ok": true,
                        "output": {
                            "applied": true,
                            "filter": input["input"]["filter"].clone()
                        }
                    }))
                    .expect("json"))
                } else {
                    Ok(serde_json::to_string(&json!({
                        "softwareId": "image-viewer",
                        "actionId": "image-viewer.readMetadata",
                        "output": {
                            "width": 640,
                            "height": 480
                        }
                    }))
                    .expect("json"))
                }
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let dynamic_path = "/tools/software/capability/image-viewer/image-viewer.readMetadata";
    let mutation_path = "/tools/software/capability/image-viewer/image-viewer.applyFilter";
    let list_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({
                "path": "/tools/software/capability"
            }),
        },
    );
    assert!(
        list_output
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools
                .iter()
                .any(|tool| tool.get("path").and_then(Value::as_str) == Some(dynamic_path)))
    );
    let inspect_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher.clone()),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({
                "path": dynamic_path
            }),
        },
    );
    assert_eq!(
        inspect_output.pointer("/raw/title").and_then(Value::as_str),
        Some("Read Image Metadata")
    );
    assert_eq!(
        inspect_output
            .pointer("/raw/inputSchema/$id")
            .and_then(Value::as_str),
        Some(
            "lyra-tool-fs://schema/tools/software/capability/image-viewer/image-viewer.readMetadata/input"
        )
    );
    let run_session_id = session_id.clone();
    let run_turn_id = turn_id.clone();
    let run_dispatcher = dispatcher.clone();
    let run_handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &run_turn_id,
            &Some(run_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-software-run",
                dynamic_path,
                json!({ "path": "photo.png" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow software invocation permission");
    let run_output = run_handle.join().expect("join software run");
    assert_eq!(run_output["status"], "completed");
    assert_eq!(run_output["toolPath"], dynamic_path);
    assert_eq!(run_output["manifestTitle"], "Read Image Metadata");
    assert!(
        run_output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
    let invocation = captured_invocation
        .lock()
        .expect("captured invocation lock")
        .clone()
        .expect("captured invocation");
    assert_eq!(invocation["softwareId"], "image-viewer");
    assert_eq!(invocation["actionId"], "image-viewer.readMetadata");
    assert_eq!(invocation["input"]["path"], "photo.png");
    assert!(invocation["input"].get("toolPath").is_none());

    let mutation_session_id = session_id.clone();
    let mutation_turn_id = start_test_runtime_turn(&session_id);
    let mutation_dispatcher = dispatcher.clone();
    let mutation_handle = thread::spawn(move || {
        execute_model_tool(
            &mutation_session_id,
            &mutation_turn_id,
            &Some(mutation_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-software-mutation",
                mutation_path,
                json!({ "path": "photo.png", "filter": "sharpen" }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow software mutation permission");
    let mutation_output = mutation_handle.join().expect("join software mutation");
    assert_eq!(mutation_output["status"], "completed");
    assert_eq!(mutation_output["toolPath"], mutation_path);
    assert_eq!(
        mutation_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(
        mutation_output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "external"
                    && change["operation"] == "invoke_capability"
                    && change["path"] == mutation_path
                    && change["reversible"] == false
            }))
    );
}

#[test]
fn tool_fs_dynamic_software_provider_failures_are_diagnostic_not_fatal() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Dynamic Software Provider Diagnostics Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let no_host = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-no-host".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/software/capability" }),
        },
    );
    assert_eq!(no_host["status"].as_str(), Some("completed"));
    assert_eq!(no_host["raw"]["path"], "/tools/software/capability");
    assert_eq!(no_host["raw"]["tools"].as_array().map(Vec::len), Some(0));
    assert_eq!(
        no_host
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("host_unavailable")
    );

    let failing_dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, _payload| {
        assert_eq!(method, "software.listCapabilities");
        Err("software registry offline".to_string())
    });
    let provider_failed = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(failing_dispatcher),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-software-provider-failed".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/software/capability" }),
        },
    );
    assert_eq!(provider_failed["status"].as_str(), Some("completed"));
    assert_eq!(
        provider_failed
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("dynamic_provider_failed")
    );
    assert!(
        provider_failed
            .pointer("/raw/diagnostics/0/message")
            .and_then(Value::as_str)
            .is_some_and(|message| message.contains("software registry offline"))
    );

    let browser_no_host = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-browser-no-host".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/browser" }),
        },
    );
    assert_eq!(browser_no_host["status"].as_str(), Some("completed"));
    assert!(
        browser_no_host
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty())
    );
    assert_eq!(
        browser_no_host
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("host_unavailable")
    );
    assert_eq!(
        browser_no_host
            .pointer("/raw/diagnostics/0/domain")
            .and_then(Value::as_str),
        Some("browser")
    );

    let workbench_no_host = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-workbench-no-host".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/workbench" }),
        },
    );
    assert_eq!(workbench_no_host["status"].as_str(), Some("completed"));
    assert!(
        workbench_no_host
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty())
    );
    assert_eq!(
        workbench_no_host
            .pointer("/raw/diagnostics/0/code")
            .and_then(Value::as_str),
        Some("host_unavailable")
    );
    assert_eq!(
        workbench_no_host
            .pointer("/raw/diagnostics/0/domain")
            .and_then(Value::as_str),
        Some("workbench")
    );
}

#[test]
fn registry_model_tools_have_dispatch_paths_and_unknown_tools_fail_structurally() {
    let service = ToolActivityService::default();
    assert_eq!(
        service.model_tool_names(),
        vec![
            "tool_fs_search".to_string(),
            "tool_fs_list".to_string(),
            "tool_fs_read_doc".to_string(),
            "tool_fs_inspect".to_string(),
            "tool_fs_run".to_string()
        ]
    );
    let names = service
        .model_tool_descriptors()
        .into_iter()
        .map(|descriptor| descriptor.name)
        .collect::<Vec<_>>();
    let provider_tool_names = expected_provider_tool_names();
    for required in [
        "file_read",
        "file_list",
        "file_glob",
        "file_write",
        "file_edit",
        "file_multiedit",
        "apply_patch",
        "shell_run",
        "terminal_list",
        "terminal_create",
        "terminal_read",
        "terminal_screen",
        "terminal_wait",
        "terminal_write",
        "terminal_close",
        "project_search",
        "code_search_text",
        "code_search_symbol",
        "code_graph_expand",
        "lsp_query",
        "web_search",
        "web_fetch",
        "render_surface",
        "todo_read",
        "todo_write",
    ] {
        assert!(names.contains(&required.to_string()), "{required} exposed");
        assert!(
            service.can_dispatch_model_tool(required),
            "{required} dispatchable"
        );
        assert!(
            !provider_tool_names.iter().any(|name| name == required),
            "{required} must stay out of provider-visible schema"
        );
    }
    let registry = tool_fs::runtime_registry();
    let root_summary = registry.root_summary();
    let registry_domains = root_summary["domains"]
        .as_array()
        .expect("registry domains")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    for domain in [
        "filesystem",
        "code",
        "shell",
        "terminal",
        "git",
        "workbench",
        "browser",
        "software",
        "web",
        "render",
        "todo",
        "memory",
        "design",
        "skills",
        "mcp",
    ] {
        assert!(
            registry_domains.contains(&domain),
            "/tools must expose {domain} as a public discovery domain"
        );
    }
    for manifest in registry.manifests() {
        assert!(
            manifest.path.starts_with("/tools/"),
            "{} path must stay under /tools",
            manifest.path
        );
        assert!(
            !manifest.title.trim().is_empty(),
            "{} title must be present",
            manifest.path
        );
        assert!(
            !manifest.summary.trim().is_empty(),
            "{} summary must be present",
            manifest.path
        );
        assert_eq!(
            manifest.input_schema.get("type").and_then(Value::as_str),
            Some("object"),
            "{} input schema must be an object",
            manifest.path
        );
        assert_eq!(
            manifest.input_schema.get("$id").and_then(Value::as_str),
            Some(lyra_tool_fs_core::schema_id_for_path(&manifest.path).as_str()),
            "{} input schema must expose stable Tool-FS schema id",
            manifest.path
        );
        assert!(
            tool_fs::runtime_target_for_manifest(manifest).is_some(),
            "Tool-FS manifest lacks runtime target: {}",
            manifest.path
        );
        assert!(
            !manifest.permission_policy.trim().is_empty(),
            "{} permission policy must be explicit",
            manifest.path
        );
        assert!(
            !manifest.risk_level.trim().is_empty(),
            "{} risk level must be explicit",
            manifest.path
        );
        assert!(
            !manifest.activity_kind.trim().is_empty() && !manifest.renderer_hint.trim().is_empty(),
            "{} activity projection hints must be explicit",
            manifest.path
        );
    }
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Unknown Tool Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-missing".to_string(),
            name: "missing_tool".to_string(),
            arguments: json!({}),
        },
    );
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("tool_not_found")
    );
    assert_eq!(output["truncated"], false);
}
#[test]
fn native_tool_surface_dispatches_file_search_shell_render_and_todo() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("create src");
    fs::write(temp.path().join("README.md"), "needle in docs\nsecond line").expect("write readme");
    fs::write(
        temp.path().join("src").join("main.rs"),
        "pub fn main() {\n    println!(\"needle\");\n}\n",
    )
    .expect("write main");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Native Tool Surface Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-read",
            "/tools/filesystem/read_file",
            json!({ "path": "README.md", "startLine": 1, "endLine": 1 }),
        ),
    );
    assert!(read["content"].as_str().unwrap().contains("needle in docs"));
    assert_eq!(read["schemaVersion"].as_u64(), Some(1));
    assert_eq!(read["status"].as_str(), Some("completed"));
    assert_eq!(read["runtimeTurnId"].as_str(), Some(turn_id.as_str()));
    assert_eq!(
        read["toolPath"].as_str(),
        Some("/tools/filesystem/read_file")
    );
    assert_eq!(read["manifestTitle"].as_str(), Some("Read file"));
    assert!(read["traceId"].as_str().is_some());
    assert!(
        read["trace"]
            .as_array()
            .is_some_and(|trace| trace.iter().any(|record| record["phase"] == "validated"))
    );
    let glob = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-glob",
            "/tools/filesystem/glob",
            json!({ "pattern": "**/*.rs" }),
        ),
    );
    assert!(glob["content"].as_str().unwrap().contains("src/main.rs"));
    let search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-search",
            "/tools/code/search_project",
            json!({ "query": "needle" }),
        ),
    );
    assert!(search["content"].as_str().unwrap().contains("README.md"));
    let symbol = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-symbol",
            "/tools/code/search_symbol",
            json!({ "query": "main" }),
        ),
    );
    assert!(symbol["content"].as_str().unwrap().contains("src/main.rs"));
    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-shell",
            "/tools/shell/run_command",
            json!({ "command": "printf hello", "cwd": "." }),
        ),
    );
    assert!(shell["content"].as_str().unwrap().contains("hello"));
    assert_eq!(shell["raw"]["exitCode"].as_i64(), Some(0));
    assert_eq!(shell["status"].as_str(), Some("completed"));
    assert_eq!(shell["activityKind"].as_str(), Some("shell"));
    assert!(shell["stdoutRef"].is_object());
    assert_eq!(
        shell.pointer("/stdoutRef/kind").and_then(Value::as_str),
        Some("stdout")
    );
    assert_eq!(
        shell
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("auto_approved")
    );
    assert!(
        shell["artifactRefs"]
            .as_array()
            .is_some_and(|artifacts| artifacts.iter().any(|artifact| artifact["id"].is_string()))
    );
    assert!(
        shell["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "process" && change["detail"]["stdoutRef"].is_object()
            }))
    );
    let rendered = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-render",
            "/tools/render/surface",
            json!({
                "surfaceId": "test-dashboard",
                "title": "Test Dashboard",
                "kind": "html",
                "content": "<section><h1>Inline dashboard</h1><button data-lyra-action=\"refresh\">Refresh</button></section>",
                "height": 260,
                "summary": "A render surface produced by the native tool dispatch path."
            }),
        ),
    );
    assert!(
        rendered["content"]
            .as_str()
            .unwrap()
            .contains("Test Dashboard")
    );
    assert_eq!(rendered["raw"]["kind"].as_str(), Some("render_surface"));
    assert_eq!(
        rendered["raw"]["surfaceId"].as_str(),
        Some("test-dashboard")
    );
    assert_eq!(rendered["raw"]["format"].as_str(), Some("html"));
    assert_eq!(rendered["raw"]["height"].as_u64(), Some(260));
    assert_eq!(
        rendered
            .pointer("/raw/security/node")
            .and_then(Value::as_bool),
        Some(false)
    );
    let todos = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-todo",
            "/tools/todo/write",
            json!({
                "todos": [{
                    "id": "todo-test",
                    "content": "verify native tool surface",
                    "status": "in_progress"
                }]
            }),
        ),
    );
    assert!(
        todos["content"]
            .as_str()
            .unwrap()
            .contains("Updated 1 todos")
    );
    assert!(todos["changes"].as_array().is_some_and(|changes| {
        changes
            .iter()
            .any(|change| change["kind"] == "todo" && change["operation"] == "write")
    }));
    let read_session = backend
        .call_agent_method(
            "agent.session.read",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("read session");
    assert_eq!(
        read_session["todos"][0]["content"].as_str(),
        Some("verify native tool surface")
    );
    let todo_read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-todo-read", "/tools/todo/read", json!({})),
    );
    assert_eq!(todo_read["status"].as_str(), Some("completed"));
    assert_eq!(todo_read["toolPath"].as_str(), Some("/tools/todo/read"));
    assert!(
        todo_read["content"]
            .as_str()
            .expect("todo read content")
            .contains("verify native tool surface")
    );
    let outside = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-outside",
            "/tools/filesystem/read_file",
            json!({ "path": "/etc/passwd" }),
        ),
    );
    assert_eq!(
        outside.pointer("/error/code").and_then(Value::as_str),
        Some("permission_denied")
    );
    let agent_root = state()
        .lock()
        .expect("state lock")
        .root
        .parent()
        .expect("agent root")
        .to_path_buf();
    let lumen_dir = agent_root.join("lumen-evidence");
    fs::create_dir_all(&lumen_dir).expect("create lumen evidence dir");
    let lumen_path = lumen_dir.join("lumen-see-test-browser-tab-1.png");
    fs::write(&lumen_path, b"\x89PNG\r\n\x1a\nlyra-test-image").expect("write lumen image");
    let artifact = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-lumen-artifact",
            "/tools/filesystem/read_file",
            json!({ "path": lumen_path.display().to_string() }),
        ),
    );
    assert_eq!(artifact["raw"]["kind"], "lyra_artifact_read");
    assert_eq!(artifact["raw"]["mediaType"], "image/png");
    let lumen_path_text = lumen_path
        .canonicalize()
        .expect("canonical lumen path")
        .display()
        .to_string();
    assert_eq!(
        artifact
            .pointer("/raw/providerImage/path")
            .and_then(Value::as_str),
        Some(lumen_path_text.as_str())
    );
    assert!(
        artifact["content"]
            .as_str()
            .unwrap()
            .contains("will be attached to the next provider request")
    );
    let modules_root = agent_root.parent().expect("modules root");
    let terminal_memory_dir = modules_root
        .join("terminal")
        .join("terminal-memory")
        .join("sessions")
        .join("terminal-session-1")
        .join("outputs");
    fs::create_dir_all(&terminal_memory_dir).expect("create terminal memory dir");
    let terminal_output_path = terminal_memory_dir.join("session-output.txt");
    fs::write(&terminal_output_path, "terminal artifact output").expect("write terminal output");
    let terminal_artifact = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-terminal-artifact",
            "/tools/filesystem/read_file",
            json!({ "path": terminal_output_path.display().to_string() }),
        ),
    );
    assert_eq!(terminal_artifact["raw"]["kind"], "lyra_artifact_read");
    assert_eq!(terminal_artifact["raw"]["artifactKind"], "terminal_memory");
    assert!(
        terminal_artifact["content"]
            .as_str()
            .unwrap()
            .contains("terminal artifact output")
    );
}

#[test]
fn tool_fs_design_skills_and_mcp_are_discoverable_inspectable_and_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Runtime Domain Tool-FS Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let design_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-design-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/design" }),
        },
    );
    assert_eq!(design_directory["status"].as_str(), Some("completed"));
    assert!(
        design_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/design/search_styles")
            }))
    );
    let design_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-design-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/design/search_styles" }),
        },
    );
    assert_eq!(
        design_manifest
            .pointer("/raw/title")
            .and_then(Value::as_str),
        Some("Search design styles")
    );

    let skill_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-skill-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/skills" }),
        },
    );
    assert!(
        skill_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/skills/activate")
            }))
    );
    let skill_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-skill-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/skills/inspect" }),
        },
    );
    assert_eq!(
        skill_manifest.pointer("/raw/title").and_then(Value::as_str),
        Some("Inspect skill")
    );
    assert!(
        skill_manifest
            .pointer("/raw/inputSchema/$id")
            .and_then(Value::as_str)
            .is_some_and(|schema_id| schema_id.contains("/tools/skills/inspect/input"))
    );

    let design_search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-design-search",
            "/tools/design/search_styles",
            json!({ "query": "dashboard", "limit": 1 }),
        ),
    );
    assert_eq!(design_search["status"].as_str(), Some("completed"));
    assert_eq!(
        design_search["toolPath"].as_str(),
        Some("/tools/design/search_styles")
    );
    assert!(
        design_search["content"]
            .as_str()
            .expect("design content")
            .contains("Lyra design references")
    );

    let skill_activate = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-skill-activate",
            "/tools/skills/activate",
            json!({ "skillId": "lyra-design-research" }),
        ),
    );
    assert_eq!(skill_activate["status"].as_str(), Some("completed"));
    assert_eq!(
        skill_activate["raw"]["skill"]["active"].as_bool(),
        Some(true)
    );
    assert!(
        skill_activate["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "runtime"
                    && change["operation"] == "activate"
                    && change["path"] == "/tools/skills/activate"
            }))
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .active_skills
            .contains("lyra-design-research")
    );

    let mcp_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-mcp-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/mcp" }),
        },
    );
    assert!(
        mcp_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/mcp/server_list")
            }))
    );
    let mcp_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-mcp-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/mcp/server_list" }),
        },
    );
    assert_eq!(
        mcp_manifest.pointer("/raw/title").and_then(Value::as_str),
        Some("List MCP servers")
    );
    let mcp_list = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-mcp-server-list", "/tools/mcp/server_list", json!({})),
    );
    assert_eq!(mcp_list["status"].as_str(), Some("failed"));
    assert_eq!(
        mcp_list.pointer("/error/code").and_then(Value::as_str),
        Some("no_configured_mcp_servers")
    );
    assert_eq!(
        mcp_list["notRunReason"].as_str(),
        Some("no_configured_mcp_servers")
    );
    assert_eq!(mcp_list["raw"]["available"].as_bool(), Some(false));
}

#[test]
fn native_file_tools_enforce_policy_budgets_edits_and_patch_artifacts() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("create src");
    fs::write(temp.path().join("src").join("main.rs"), "alpha\nbeta\n").expect("write main");
    fs::write(temp.path().join("dupes.txt"), "same\nsame\n").expect("write dupes");
    fs::write(temp.path().join("first.txt"), "one").expect("write first");
    fs::write(temp.path().join("second.txt"), "two").expect("write second");
    fs::write(temp.path().join("delete.txt"), "remove me").expect("write delete");
    fs::write(temp.path().join("large.txt"), "x".repeat(128)).expect("write large");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "File Tool Coverage", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let listed = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-list",
            "/tools/filesystem/list_files",
            json!({ "path": ".", "recursive": true }),
        ),
    );
    assert!(listed["content"].as_str().unwrap().contains("src/main.rs"));
    let missing = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-missing-file",
            "/tools/filesystem/read_file",
            json!({ "path": "missing.txt" }),
        ),
    );
    assert_eq!(
        missing.pointer("/error/code").and_then(Value::as_str),
        Some("path_not_found")
    );
    let large = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-large-read",
            "/tools/filesystem/read_file",
            json!({ "path": "large.txt", "maxBytes": 8 }),
        ),
    );
    assert_eq!(large["raw"]["truncated"], true);
    assert!(large["raw"]["artifactRef"].is_object());
    assert_eq!(
        large
            .pointer("/raw/artifactRef/kind")
            .and_then(Value::as_str),
        Some("raw_data")
    );
    let outside_write = tool_file_write(
        &session_id,
        &turn_id,
        "tool-outside-write",
        &json!({ "path": "../outside.txt", "content": "no", "overwrite": true }),
    )
    .expect_err("outside write should fail");
    assert_eq!(outside_write.code, "permission_denied");
    let unread_edit = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-unread-edit",
        &json!({ "path": "src/main.rs", "oldString": "beta", "newString": "gamma" }),
    )
    .expect_err("strict edit requires read first");
    assert_eq!(unread_edit.code, "must_read_first");
    tool_file_read(
        &session_id,
        &turn_id,
        "tool-read-before-edit",
        &json!({ "path": "src/main.rs" }),
    )
    .expect("read before edit");
    let edit = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-edit",
        &json!({ "path": "src/main.rs", "oldString": "beta", "newString": "gamma" }),
    )
    .expect("edit file");
    assert!(edit.raw["diffArtifactRef"].is_object());
    assert_eq!(
        edit.raw
            .pointer("/diffArtifactRef/kind")
            .and_then(Value::as_str),
        Some("diff")
    );
    assert!(edit.raw["changedFiles"][0]["beforeRef"].is_object());
    assert_eq!(
        edit.raw
            .pointer("/changedFiles/0/beforeRef/kind")
            .and_then(Value::as_str),
        Some("snapshot")
    );
    assert!(edit.raw["changedFiles"][0]["afterRef"].is_object());
    assert!(edit.raw["changedFiles"][0]["diffRef"].is_object());
    assert!(
        fs::read_to_string(temp.path().join("src").join("main.rs"))
            .expect("read edited")
            .contains("gamma")
    );
    tool_file_read(
        &session_id,
        &turn_id,
        "tool-read-before-duplicate-edit",
        &json!({ "path": "dupes.txt" }),
    )
    .expect("read dupes before duplicate edit");
    let duplicate = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-duplicate-edit",
        &json!({ "path": "dupes.txt", "oldString": "same", "newString": "once" }),
    )
    .expect_err("duplicate oldString should fail");
    assert_eq!(duplicate.code, "edit_not_unique");
    let failed_multiedit = tool_file_multiedit(
        &session_id,
        &turn_id,
        "tool-multiedit-fail",
        &json!({
            "edits": [
                { "path": "first.txt", "oldString": "one", "newString": "ONE" },
                { "path": "second.txt", "oldString": "missing", "newString": "TWO" }
            ]
        }),
    )
    .expect_err("failed staged edit");
    assert_eq!(failed_multiedit.code, "edit_not_found");
    assert_eq!(
        fs::read_to_string(temp.path().join("first.txt")).expect("first unchanged"),
        "one"
    );
    let multiedit = tool_file_multiedit(
        &session_id,
        &turn_id,
        "tool-multiedit",
        &json!({
            "edits": [
                { "path": "first.txt", "oldString": "one", "newString": "ONE" },
                { "path": "second.txt", "oldString": "two", "newString": "TWO" }
            ]
        }),
    )
    .expect("successful multiedit");
    assert_eq!(
        multiedit.raw["changedFiles"].as_array().map(Vec::len),
        Some(2)
    );
    assert!(multiedit.raw["diffArtifactRef"].is_object());
    assert_eq!(
        multiedit
            .raw
            .pointer("/diffArtifactRef/kind")
            .and_then(Value::as_str),
        Some("diff")
    );
    assert!(
        multiedit.raw["changedFiles"]
            .as_array()
            .is_some_and(|files| files.iter().all(|file| {
                file["beforeRef"].is_object()
                    && file["afterRef"].is_object()
                    && file["diffRef"].is_object()
            }))
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("second.txt")).expect("read second"),
        "TWO"
    );
    tool_file_read(
        &session_id,
        &turn_id,
        "tool-read-before-patch",
        &json!({ "path": "first.txt" }),
    )
    .expect("read before patch update");
    let patch = tool_apply_patch(
        &session_id,
        &turn_id,
        "tool-patch",
        &json!({
            "operations": [
                { "op": "add", "path": "added.txt", "content": "added" },
                { "op": "update", "path": "first.txt", "oldString": "ONE", "newString": "uno" },
                { "op": "move", "path": "second.txt", "newPath": "moved.txt" },
                { "op": "delete", "path": "delete.txt" }
            ]
        }),
    )
    .expect("apply patch");
    assert!(patch.raw["diffArtifactRef"].is_object());
    assert_eq!(
        patch
            .raw
            .pointer("/diffArtifactRef/kind")
            .and_then(Value::as_str),
        Some("diff")
    );
    assert!(
        patch.raw["changedFiles"]
            .as_array()
            .is_some_and(|files| files.iter().all(|file| {
                file["beforeRef"].is_object()
                    && file["afterRef"].is_object()
                    && file["diffRef"].is_object()
            }))
    );
    assert!(temp.path().join("moved.txt").exists());
    assert!(!temp.path().join("delete.txt").exists());
}

#[test]
fn git_tool_fs_mutations_emit_change_records_and_artifacts() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.email", "lyra@example.test"]);
    git(&["config", "user.name", "Lyra Test"]);
    fs::write(root.join("tracked.txt"), "one\n").expect("write tracked");
    git(&["add", "tracked.txt"]);
    git(&["commit", "-m", "initial"]);
    fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked");

    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Git Tool-FS Coverage",
                "workingDir": root.display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let status = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-git-status", "/tools/git/status", json!({})),
    );
    assert_eq!(status["status"].as_str(), Some("completed"));
    assert_eq!(status["toolPath"].as_str(), Some("/tools/git/status"));
    assert!(
        status
            .pointer("/raw/summary/changed")
            .and_then(Value::as_u64)
            .is_some_and(|changed| changed >= 1)
    );
    let diff = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-diff",
            "/tools/git/diff",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_eq!(diff["status"].as_str(), Some("completed"));
    assert_eq!(diff["toolPath"].as_str(), Some("/tools/git/diff"));
    assert!(
        diff.pointer("/raw/diff")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("two"))
    );
    let log = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-git-log", "/tools/git/log", json!({ "limit": 3 })),
    );
    assert_eq!(log["status"].as_str(), Some("completed"));
    assert_eq!(log["toolPath"].as_str(), Some("/tools/git/log"));
    assert!(
        log.pointer("/raw/commits")
            .and_then(Value::as_array)
            .is_some_and(|commits| !commits.is_empty())
    );
    let assert_git_change = |output: &Value, operation: &str, reversible: bool| {
        assert_eq!(output["status"].as_str(), Some("completed"));
        let expected_tool_path = format!("/tools/git/{operation}");
        assert_eq!(output["toolPath"], expected_tool_path);
        assert_eq!(
            output
                .pointer("/raw/toolOperation/path")
                .and_then(Value::as_str),
            Some(expected_tool_path.as_str())
        );
        assert_eq!(
            output
                .pointer("/raw/policyDecision/mode")
                .and_then(Value::as_str),
            Some("auto_approved")
        );
        assert!(output["raw"]["diffArtifactRef"].is_object());
        assert_eq!(
            output
                .pointer("/raw/diffArtifactRef/kind")
                .and_then(Value::as_str),
            Some("diff")
        );
        assert!(
            output["artifactRefs"]
                .as_array()
                .is_some_and(|refs| refs.len() >= 3 && refs.iter().all(Value::is_object))
        );
        let raw_change = &output["raw"]["changedFiles"][0];
        assert_eq!(raw_change["operation"].as_str(), Some(operation));
        assert_eq!(raw_change["path"].as_str(), Some("tracked.txt"));
        assert_eq!(raw_change["reversible"].as_bool(), Some(reversible));
        assert!(raw_change["beforeRef"].is_object());
        assert!(raw_change["afterRef"].is_object());
        assert!(raw_change["diffRef"].is_object());
        let change = &output["changes"][0];
        assert_eq!(change["kind"].as_str(), Some("git"));
        assert_eq!(change["operation"].as_str(), Some(operation));
        assert_eq!(change["path"].as_str(), Some("tracked.txt"));
        assert_eq!(change["reversible"].as_bool(), Some(reversible));
        assert!(change["beforeRef"].is_object());
        assert!(change["afterRef"].is_object());
        assert!(change["diffRef"].is_object());
    };

    let stage = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-stage",
            "/tools/git/stage",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_git_change(&stage, "stage", true);

    let unstage = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-unstage",
            "/tools/git/unstage",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_git_change(&unstage, "unstage", true);

    let discard = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-git-discard",
            "/tools/git/discard",
            json!({ "path": "tracked.txt" }),
        ),
    );
    assert_git_change(&discard, "discard", false);
    assert_eq!(
        fs::read_to_string(root.join("tracked.txt")).expect("read tracked"),
        "one\n"
    );
}

#[test]
fn pinned_handle_code_task_chain_runs_core_code_tools() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();
    fs::create_dir_all(root.join("src")).expect("create src");
    fs::write(
        root.join("src").join("lib.rs"),
        "pub fn greeting() -> &'static str { \"hello\" }\n",
    )
    .expect("write source");
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.email", "lyra@example.test"]);
    git(&["config", "user.name", "Lyra Test"]);
    git(&["add", "."]);
    git(&["commit", "-m", "initial"]);

    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Pinned Handle Code Task",
                "workingDir": root.display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let handle_call = |id: &str, tool_handle: &str, args: Value| ModelToolCall {
        id: id.to_string(),
        name: "tool_fs_run".to_string(),
        arguments: json!({
            "toolHandle": tool_handle,
            "args": args,
        }),
    };

    let read = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-read",
            "read_file",
            json!({ "path": "src/lib.rs" }),
        ),
    );
    assert_eq!(
        read["toolPath"].as_str(),
        Some("/tools/filesystem/read_file")
    );
    assert!(
        read["content"]
            .as_str()
            .is_some_and(|text| text.contains("hello"))
    );

    let search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-search",
            "search_code",
            json!({ "query": "greeting", "path": "src", "limit": 10 }),
        ),
    );
    assert_eq!(search["toolPath"].as_str(), Some("/tools/code/search_code"));
    assert!(
        search["content"]
            .as_str()
            .is_some_and(|text| text.contains("src/lib.rs"))
    );

    let patch_session_id = session_id.clone();
    let patch_turn_id = turn_id.clone();
    let patch_cancellation = cancellation.clone();
    let patch_handle = thread::spawn(move || {
        execute_model_tool(
            &patch_session_id,
            &patch_turn_id,
            &None,
            &patch_cancellation,
            ModelToolCall {
                id: "tool-handle-patch".to_string(),
                name: "tool_fs_run".to_string(),
                arguments: json!({
                    "toolHandle": "apply_patch",
                    "args": {
                        "operations": [{
                            "op": "update",
                            "path": "src/lib.rs",
                            "oldString": "\"hello\"",
                            "newString": "\"hello lyra\""
                        }]
                    }
                }),
            },
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow patch permission");
    let patch = patch_handle.join().expect("join patch");
    assert_eq!(
        patch["toolPath"].as_str(),
        Some("/tools/filesystem/apply_patch")
    );
    assert!(
        patch["changes"]
            .as_array()
            .is_some_and(|changes| !changes.is_empty())
    );
    assert!(
        fs::read_to_string(root.join("src").join("lib.rs"))
            .expect("read patched")
            .contains("hello lyra")
    );

    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-shell",
            "run_command",
            json!({ "command": "printf pinned", "workingDir": "." }),
        ),
    );
    assert_eq!(shell["toolPath"].as_str(), Some("/tools/shell/run_command"));
    assert!(
        shell["content"]
            .as_str()
            .is_some_and(|text| text.contains("pinned"))
    );

    let status = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call("tool-handle-git-status", "git_status", json!({})),
    );
    assert_eq!(status["toolPath"].as_str(), Some("/tools/git/status"));
    assert!(
        status
            .pointer("/raw/summary/changed")
            .and_then(Value::as_u64)
            .is_some_and(|changed| changed >= 1)
    );

    let diff = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        handle_call(
            "tool-handle-git-diff",
            "git_diff",
            json!({ "path": "src/lib.rs" }),
        ),
    );
    assert_eq!(diff["toolPath"].as_str(), Some("/tools/git/diff"));
    assert!(
        diff.pointer("/raw/diff")
            .and_then(Value::as_str)
            .is_some_and(|text| text.contains("hello lyra"))
    );
}

#[test]
fn native_shell_code_lsp_and_budget_guards_are_structured() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("outside tempdir");
    fs::create_dir_all(temp.path().join("src")).expect("create src");
    fs::write(
        temp.path().join("src").join("lib.rs"),
        "pub struct Widget;\npub fn build_widget() {}\n",
    )
    .expect("write source");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Shell Code Coverage", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let project_root = temp.path().canonicalize().expect("canonical project root");
    let outside_root = outside
        .path()
        .canonicalize()
        .expect("canonical outside root");
    let failed = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-failed",
        &json!({ "command": "false" }),
    )
    .expect("failed command still returns structured output");
    assert_eq!(failed.raw["success"], false);
    assert_eq!(failed.raw["exitCode"].as_i64(), Some(1));
    let timed_out = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-timeout",
        &json!({ "command": "sleep 1", "timeoutMs": 1 }),
    )
    .expect("timeout returns structured output");
    assert_eq!(timed_out.raw["timedOut"], true);
    let truncated = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-truncated",
        &json!({ "command": "printf 1234567890", "maxOutputBytes": 4 }),
    )
    .expect("truncated output");
    assert_eq!(truncated.raw["stdout"], "1234");
    assert_eq!(truncated.raw["stdoutTruncated"], true);
    let composite = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-composite",
        &json!({
            "command": "printf 'alpha\\nbeta\\n' | grep beta && printf done",
            "description": "Search piped output and print marker"
        }),
    )
    .expect("composite shell command");
    assert_eq!(composite.raw["success"], true);
    assert_eq!(composite.raw["commandKind"], "search");
    assert!(
        composite
            .raw
            .get("stdout")
            .and_then(Value::as_str)
            .is_some_and(|stdout| stdout.contains("beta") && stdout.contains("done"))
    );
    let dangerous = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-dangerous",
        &json!({ "command": "rm file.txt" }),
    )
    .expect_err("risk");
    assert_eq!(dangerous.code, "permission_required");
    let default_bound = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-default-bound",
        &json!({ "command": "pwd" }),
    )
    .expect("bound shell default cwd");
    assert_eq!(
        default_bound.raw["cwd"].as_str(),
        Some(project_root.to_str().expect("project root utf-8"))
    );
    let outside_bound = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-outside-bound",
        &json!({ "command": "pwd", "cwd": outside_root.display().to_string() }),
    )
    .expect("bound shell can run outside project");
    assert_eq!(
        outside_bound.raw["cwd"].as_str(),
        Some(outside_root.to_str().expect("outside root utf-8"))
    );
    let bad_cwd = tool_shell_run(
        &session_id,
        "turn-shell-direct",
        "tool-shell-bad-cwd",
        &json!({ "command": "pwd", "cwd": outside_root.join("missing").display().to_string() }),
    )
    .expect_err("missing cwd fails");
    assert_eq!(bad_cwd.code, "bad_cwd");
    let unbound = backend
        .call_agent_method("agent.session.create", json!({ "title": "Unbound Shell" }))
        .expect("create unbound session");
    let unbound_session_id = unbound["id"]
        .as_str()
        .expect("unbound session id")
        .to_string();
    let home = dirs::home_dir()
        .expect("home directory")
        .canonicalize()
        .expect("canonical home");
    let default_unbound = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-default-unbound",
        &json!({ "command": "pwd" }),
    )
    .expect("unbound shell default cwd");
    assert_eq!(
        default_unbound.raw["cwd"].as_str(),
        Some(home.to_str().expect("home utf-8"))
    );
    let outside_unbound = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-outside-unbound",
        &json!({ "command": "pwd", "cwd": outside_root.display().to_string() }),
    )
    .expect("unbound shell can use absolute cwd");
    assert_eq!(
        outside_unbound.raw["cwd"].as_str(),
        Some(outside_root.to_str().expect("outside root utf-8"))
    );
    let unbound_git_global = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-git-global-unbound",
        &json!({ "command": "git config --global --list >/dev/null 2>&1 || true" }),
    )
    .expect("unbound shell can run global git config check");
    assert_eq!(unbound_git_global.raw["success"].as_bool(), Some(true));
    let unbound_dangerous = tool_shell_run(
        &unbound_session_id,
        "turn-shell-direct",
        "tool-shell-dangerous-unbound",
        &json!({ "command": "rm file.txt", "cwd": outside_root.display().to_string() }),
    )
    .expect_err("unbound high-risk shell still needs permission");
    assert_eq!(unbound_dangerous.code, "permission_required");
    let text = tool_code_search_text(&session_id, &json!({ "query": "build_widget" }))
        .expect("text search");
    assert!(text.content.contains("src/lib.rs:2"));
    let graph = tool_code_graph_expand(&session_id, &json!({ "symbol": "Widget" }))
        .expect("graph fallback");
    assert_eq!(graph.raw["degraded"], true);
    let lsp =
        tool_lsp_query(&session_id, &json!({ "queryType": "diagnostics" })).expect("lsp fallback");
    assert_eq!(lsp.raw["available"], false);
    let budgeted = budgeted_tool_output(
        &session_id,
        "turn-budget",
        "tool-budget",
        "x".repeat(DEFAULT_TOOL_CONTENT_CHARS + 1),
        json!({ "ok": true }),
        Some("inspect artifact".to_string()),
    );
    assert_eq!(budgeted["truncated"], true);
    assert!(budgeted["artifactRef"].is_object());
    assert_eq!(budgeted["recommendedNextAction"], "inspect artifact");
    let (provider_content, evidence_ref) = guarded_tool_result_content(&budgeted, 8);
    assert!(provider_content.contains("Tool output truncated"));
    assert!(evidence_ref.is_some());
}
#[test]
fn native_web_tools_parse_fetch_and_return_structured_failures() {
    let html = r#"
        <html>
          <head><title>Example Page</title></head>
          <body>
            <a rel="nofollow" href="https://example.com/result" class="result__a">Example Result</a>
            <a class="result__snippet">Snippet &amp; detail</a>
            <a href="/next">Next</a>
            alpha beta gamma delta epsilon zeta eta theta iota kappa lambda
          </body>
        </html>
    "#;
    let parsed = parse_duckduckgo_results(html, 5);
    assert_eq!(parsed[0]["title"], "Example Result");
    assert_eq!(parsed[0]["url"], "https://example.com/result");
    assert!(parsed[0]["snippet"].as_str().unwrap().contains("Snippet"));
    let url = serve_http_once("HTTP/1.1 200 OK", "text/html; charset=utf-8", html);
    let fetched = tool_web_fetch(
        "turn-web",
        "tool-web-fetch",
        &json!({ "url": url, "maxChars": 24, "extractText": true, "includeLinks": true }),
    )
    .expect("fetch local html");
    assert_eq!(fetched.raw["status"], 200);
    assert_eq!(fetched.raw["title"], "Example Page");
    assert_eq!(fetched.raw["truncated"], true);
    assert!(fetched.raw["artifactRef"].is_object());
    assert!(
        fetched.raw["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["url"].as_str().unwrap().ends_with("/next"))
    );
    let forbidden_url = serve_http_once(
        "HTTP/1.1 403 Forbidden",
        "text/html; charset=utf-8",
        "blocked",
    );
    let forbidden = tool_web_fetch(
        "turn-web",
        "tool-web-forbidden",
        &json!({ "url": forbidden_url }),
    )
    .expect_err("forbidden response");
    assert_eq!(forbidden.code, "permission_denied");
    assert_eq!(forbidden.detail.unwrap()["status"], 403);
    let binary_url = serve_http_once("HTTP/1.1 200 OK", "application/octet-stream", "not text");
    let binary = tool_web_fetch("turn-web", "tool-web-binary", &json!({ "url": binary_url }))
        .expect_err("binary response");
    assert_eq!(binary.code, "unsupported_content_type");
    assert_eq!(
        binary.detail.unwrap()["contentType"],
        "application/octet-stream"
    );
}

#[test]
fn tool_fs_web_and_network_read_tools_are_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Tool-FS Web Network Coverage" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let url = serve_http_once(
        "HTTP/1.1 200 OK",
        "text/html; charset=utf-8",
        "<html><head><title>Tool FS Web</title></head><body>local web evidence</body></html>",
    );
    let fetched = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-fs-web-fetch",
            "/tools/web/fetch",
            json!({ "url": url, "maxChars": 128, "extractText": true }),
        ),
    );
    assert_eq!(fetched["status"].as_str(), Some("completed"));
    assert_eq!(fetched["toolPath"].as_str(), Some("/tools/web/fetch"));
    assert_eq!(fetched["raw"]["title"].as_str(), Some("Tool FS Web"));
    assert!(
        fetched["content"]
            .as_str()
            .expect("web fetch content")
            .contains("Tool FS Web")
    );

    let network = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-fs-network", "/tools/network/status", json!({})),
    );
    assert_eq!(network["status"].as_str(), Some("completed"));
    assert_eq!(network["toolPath"].as_str(), Some("/tools/network/status"));
    assert_eq!(
        network
            .pointer("/raw/nativeHttpClient/implementation")
            .and_then(Value::as_str),
        Some("reqwest")
    );
}

#[test]
fn rollback_preview_and_restore_recover_messages_and_files() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let file_path = temp.path().join("note.txt");
    fs::write(&file_path, "before").expect("write before");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Rollback Test", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = "turn-rollback-test".to_string();
    let mut message = user_message("change note".to_string(), Vec::new(), now());
    let message_id = message["id"].as_str().expect("message id").to_string();
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        let checkpoint = rollback_checkpoint(&session_id, &turn_id, &message_id, session);
        message["rollback"] = json!({
            "available": true,
            "anchorId": checkpoint.id,
            "checkpointAt": checkpoint.created_at,
        });
        session.rollback_checkpoints.push(checkpoint);
        push_array(&mut session.snapshot, "messages", message);
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "waiting_for_tool",
            Some(message_id.clone()),
            None,
        ));
    }
    record_tool_activity(
        &session_id,
        &turn_id,
        tool_activity(
            "tool-write",
            "file",
            "Write file",
            "running",
            json!({ "action": "write", "path": "note.txt" }),
            None,
            &now(),
            None,
        ),
        "toolStarted",
    );
    fs::write(&file_path, "after").expect("write after");
    let preview = backend
        .call_agent_method(
            "agent.rollback.preview",
            json!({ "sessionId": session_id.clone(), "messageId": message_id.clone() }),
        )
        .expect("preview");
    assert_eq!(preview["available"], true);
    assert_eq!(preview["changedFiles"].as_array().expect("files").len(), 1);
    let restored = backend
        .call_agent_method(
            "agent.rollback.restore",
            json!({ "sessionId": session_id.clone(), "messageId": message_id.clone() }),
        )
        .expect("restore");
    assert_eq!(restored["restoredFileCount"], 1);
    assert_eq!(
        fs::read_to_string(file_path).expect("read restored"),
        "before"
    );
    assert_eq!(
        restored["snapshot"]["messages"]
            .as_array()
            .expect("messages")
            .len(),
        0
    );
}
#[test]
fn permission_request_denies_and_allows_native_file_write() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    let denied_path = temp.path().join("denied.txt");
    let allowed_path = temp.path().join("allowed.txt");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Test", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let denied_turn_id = start_test_runtime_turn(&session_id);
    let denied_session_id = session_id.clone();
    let denied_handle = thread::spawn(move || {
        execute_model_tool(
            &denied_session_id,
            &denied_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-denied",
                "/tools/filesystem/write_file",
                json!({
                    "path": "denied.txt",
                    "content": "nope",
                    "overwrite": true
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny permission");
    let denied_output = denied_handle.join().expect("join denied");
    assert_eq!(
        denied_output.pointer("/error/code").and_then(Value::as_str),
        Some("permission_denied")
    );
    assert_eq!(denied_output["schemaVersion"].as_u64(), Some(1));
    assert_eq!(denied_output["status"].as_str(), Some("failed"));
    assert_eq!(
        denied_output["notRunReason"].as_str(),
        Some("permission_denied")
    );
    assert_eq!(
        denied_output["toolPath"].as_str(),
        Some("/tools/filesystem/write_file")
    );
    assert_eq!(
        denied_output
            .pointer("/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("denied")
    );
    assert!(
        denied_output["changes"]
            .as_array()
            .is_none_or(|changes| changes.is_empty())
    );
    assert!(!denied_path.exists());
    let allowed_turn_id = start_test_runtime_turn(&session_id);
    let allowed_session_id = session_id.clone();
    let allowed_handle = thread::spawn(move || {
        execute_model_tool(
            &allowed_session_id,
            &allowed_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-allowed",
                "/tools/filesystem/write_file",
                json!({
                    "path": "allowed.txt",
                    "content": "yes",
                    "overwrite": true
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow permission");
    let allowed_output = allowed_handle.join().expect("join allowed");
    assert!(
        allowed_output["content"]
            .as_str()
            .unwrap()
            .contains("allowed.txt")
    );
    assert_eq!(allowed_output["schemaVersion"].as_u64(), Some(1));
    assert_eq!(allowed_output["status"].as_str(), Some("completed"));
    assert_eq!(
        allowed_output["toolPath"].as_str(),
        Some("/tools/filesystem/write_file")
    );
    assert_eq!(
        allowed_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert_eq!(
        allowed_output
            .pointer("/raw/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("approved")
    );
    assert!(
        allowed_output["artifactRefs"]
            .as_array()
            .is_some_and(|artifacts| artifacts.iter().any(|artifact| artifact["id"].is_string()))
    );
    assert!(
        allowed_output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "file"
                    && change["path"] == "allowed.txt"
                    && change["beforeRef"]["id"].is_string()
                    && change["afterRef"]["id"].is_string()
                    && change["diffRef"]["id"].is_string()
            }))
    );
    assert_eq!(
        fs::read_to_string(allowed_path).expect("read allowed"),
        "yes"
    );
    let denied_shell_path = temp.path().join("denied-shell.txt");
    fs::write(&denied_shell_path, "keep").expect("write denied shell file");
    let denied_shell_turn_id = start_test_runtime_turn(&session_id);
    let denied_shell_session_id = session_id.clone();
    let denied_shell_handle = thread::spawn(move || {
        execute_model_tool(
            &denied_shell_session_id,
            &denied_shell_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-shell-denied",
                "/tools/shell/run_command",
                json!({
                    "command": "rm denied-shell.txt",
                    "cwd": "."
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny shell permission");
    let denied_shell_output = denied_shell_handle.join().expect("join denied shell");
    assert_eq!(
        denied_shell_output
            .pointer("/error/code")
            .and_then(Value::as_str),
        Some("permission_denied")
    );
    assert!(denied_shell_path.exists());
    let allowed_shell_path = temp.path().join("allowed-shell.txt");
    fs::write(&allowed_shell_path, "remove").expect("write allowed shell file");
    let allowed_shell_turn_id = start_test_runtime_turn(&session_id);
    let allowed_shell_session_id = session_id.clone();
    let allowed_shell_handle = thread::spawn(move || {
        execute_model_tool(
            &allowed_shell_session_id,
            &allowed_shell_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-shell-allowed",
                "/tools/shell/run_command",
                json!({
                    "command": "rm allowed-shell.txt",
                    "cwd": "."
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow shell permission");
    let allowed_shell_output = allowed_shell_handle.join().expect("join allowed shell");
    assert_eq!(allowed_shell_output["raw"]["success"].as_bool(), Some(true));
    assert_eq!(
        allowed_shell_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(!allowed_shell_path.exists());
    let unbound_shell_path = temp.path().join("unbound-shell.txt");
    fs::write(&unbound_shell_path, "keep").expect("write unbound shell file");
    let unbound = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Unbound Shell Permission" }),
        )
        .expect("create unbound shell session");
    let unbound_session_id = unbound["id"]
        .as_str()
        .expect("unbound session id")
        .to_string();
    let unbound_turn_id = start_test_runtime_turn(&unbound_session_id);
    let unbound_shell_session_id = unbound_session_id.clone();
    let unbound_cwd = temp.path().display().to_string();
    let unbound_shell_handle = thread::spawn(move || {
        execute_model_tool(
            &unbound_shell_session_id,
            &unbound_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-shell-unbound-denied",
                "/tools/shell/run_command",
                json!({
                    "command": "rm unbound-shell.txt",
                    "cwd": unbound_cwd
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&unbound_session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": unbound_session_id, "permissionId": permission_id, "allowed": false }),
        )
        .expect("deny unbound shell permission");
    let unbound_shell_output = unbound_shell_handle
        .join()
        .expect("join unbound denied shell");
    assert_eq!(
        unbound_shell_output
            .pointer("/error/code")
            .and_then(Value::as_str),
        Some("permission_denied")
    );
    assert!(unbound_shell_path.exists());
}

#[test]
fn tool_fs_permission_modes_gate_before_adapter_execution() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("readable.txt"), "hello").expect("write readable");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Permission Mode Test", "workingDir": temp.path().display().to_string() }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    let read_turn_id = start_test_runtime_turn(&session_id);
    let read_output = execute_model_tool(
        &session_id,
        &read_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-read-only-read",
            "/tools/filesystem/read_file",
            json!({ "path": "readable.txt" }),
            "read_only",
        ),
    );
    assert_eq!(read_output["status"].as_str(), Some("completed"));
    assert_eq!(
        read_output
            .pointer("/toolOperation/permissionMode")
            .and_then(Value::as_str),
        Some("read_only")
    );

    let denied_path = temp.path().join("read-only-denied.txt");
    let read_only_turn_id = start_test_runtime_turn(&session_id);
    let read_only_output = execute_model_tool(
        &session_id,
        &read_only_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-read-only-write",
            "/tools/filesystem/write_file",
            json!({ "path": "read-only-denied.txt", "content": "no", "overwrite": true }),
            "read_only",
        ),
    );
    assert_eq!(read_only_output["status"].as_str(), Some("failed"));
    assert_eq!(
        read_only_output["notRunReason"].as_str(),
        Some("permission_denied")
    );
    assert!(!denied_path.exists());

    let deny_turn_id = start_test_runtime_turn(&session_id);
    let deny_output = execute_model_tool(
        &session_id,
        &deny_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-deny-read",
            "/tools/filesystem/read_file",
            json!({ "path": "readable.txt" }),
            "deny",
        ),
    );
    assert_eq!(deny_output["status"].as_str(), Some("failed"));
    assert_eq!(
        deny_output["notRunReason"].as_str(),
        Some("permission_denied")
    );

    let full_access_path = temp.path().join("full-access.txt");
    let full_access_turn_id = start_test_runtime_turn(&session_id);
    let full_access_output = execute_model_tool(
        &session_id,
        &full_access_turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call_with_permission_mode(
            "tool-full-access-write",
            "/tools/filesystem/write_file",
            json!({ "path": "full-access.txt", "content": "yes", "overwrite": true }),
            "full_access",
        ),
    );
    assert_eq!(full_access_output["status"].as_str(), Some("completed"));
    assert_eq!(
        full_access_output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("full_access")
    );
    assert_eq!(
        fs::read_to_string(full_access_path).expect("read full access file"),
        "yes"
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .pending_permissions
            .is_empty()
    );
}

#[test]
fn lumen_live_login_state_requires_permission_even_for_read_tools() {
    assert_eq!(
        permission_risk(
            "lyra_lumen",
            "map",
            &json!({
                "targetMode": "isolated",
                "authState": "borrowLiveLogin"
            })
        ),
        Some("sensitive".to_string())
    );
    assert_eq!(
        permission_risk(
            "lyra_lumen",
            "read",
            &json!({
                "targetMode": "isolated",
                "useLiveLoginState": true
            })
        ),
        Some("sensitive".to_string())
    );
    assert_eq!(
        permission_risk("lyra_lumen", "map", &json!({ "targetMode": "isolated" })),
        None
    );
    assert_eq!(
        permission_risk("lyra_lumen", "locate", &json!({ "targetMode": "isolated" })),
        None
    );
    assert_eq!(
        permission_risk(
            "lyra_lumen",
            "find",
            &json!({
                "targetMode": "isolated",
                "useLiveLoginState": true
            })
        ),
        Some("sensitive".to_string())
    );
}
#[test]
fn terminal_host_tools_apply_read_and_write_permission_policy() {
    assert_eq!(permission_risk("terminal", "list", &json!({})), None);
    assert_eq!(
        permission_risk("terminal", "read", &json!({ "sessionId": "terminal-1" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "screen", &json!({ "sessionId": "terminal-1" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "wait", &json!({ "sessionId": "terminal-1" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "create", &json!({ "mode": "shell" })),
        None
    );
    assert_eq!(
        permission_risk("terminal", "create", &json!({ "command": "npm test" })),
        Some("shell".to_string())
    );
    assert_eq!(
        permission_risk("terminal", "write", &json!({ "text": "npm test" })),
        Some("shell".to_string())
    );
    assert_eq!(
        permission_risk("terminal", "close", &json!({ "sessionId": "terminal-1" })),
        Some("shell".to_string())
    );
}

#[test]
fn terminal_tool_fs_mutation_emits_change_record_and_log_artifact() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Terminal Mutation Change Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        assert_eq!(method, "terminal.write");
        let input: Value = serde_json::from_str(&payload).expect("terminal payload json");
        assert_eq!(input["action"], "write");
        assert_eq!(input["sessionId"], "terminal-session-1");
        assert_eq!(input["text"], "npm test\n");
        Ok(serde_json::to_string(&json!({
            "ok": true,
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "output": "wrote 9 bytes to terminal-session-1",
            "running": true,
            "exitCode": null,
            "truncated": false
        }))
        .expect("json"))
    });
    let run_session_id = session_id.clone();
    let run_dispatcher = dispatcher.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &run_session_id,
            &turn_id,
            &Some(run_dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-terminal-write",
                "/tools/terminal/write",
                json!({
                    "sessionId": "terminal-session-1",
                    "text": "npm test\n"
                }),
            ),
        )
    });
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow terminal write permission");
    let output = handle.join().expect("join terminal write");
    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_eq!(output["toolPath"].as_str(), Some("/tools/terminal/write"));
    assert_eq!(
        output
            .pointer("/raw/logArtifactRef/kind")
            .and_then(Value::as_str),
        Some("log")
    );
    assert_eq!(
        output
            .pointer("/raw/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert!(
        output["artifactRefs"]
            .as_array()
            .is_some_and(|artifacts| artifacts.iter().any(|artifact| artifact["kind"] == "log"))
    );
    assert!(
        output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "terminal"
                    && change["operation"] == "write"
                    && change["diffRef"]["kind"] == "log"
                    && change["reversible"] == false
            }))
    );
}

#[test]
fn permission_policy_does_not_infer_risk_from_free_text_keywords() {
    assert_eq!(
        permission_risk(
            "unknown",
            "noop",
            &json!({
                "note": "please delete file and exec shell command",
                "description": "write patch terminal"
            })
        ),
        None
    );
    assert_eq!(
        permission_risk(
            "workbench",
            "read_tab",
            &json!({ "title": "delete file shell exec" })
        ),
        None
    );
    assert_eq!(
        permission_risk("lyra_lumen", "submit", &json!({ "label": "plain submit" })),
        Some("dangerous".to_string())
    );
}
#[test]
fn clarification_tool_resumes_same_turn_without_assistant_bubble() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Clarification Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let thread_session_id = session_id.clone();
    let first_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &first_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-clarify",
                "/tools/clarification/ask",
                json!({
                    "question": "Which target?",
                    "options": ["A", "B"],
                    "allowCustomAnswer": true
                }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "A",
                "selectedOption": "A"
            }),
        )
        .expect("respond clarification");
    let output = handle.join().expect("join clarification");
    assert_eq!(output["answer"], "A");
    let thread_session_id = session_id.clone();
    let second_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &second_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-clarify-again",
                "/tools/clarification/ask",
                json!({
                    "question": "Which mode?",
                    "options": ["fast", "careful"],
                    "allowCustomAnswer": true
                }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "careful",
                "selectedOption": "careful"
            }),
        )
        .expect("respond second clarification");
    let output = handle.join().expect("join second clarification");
    assert_eq!(output["answer"], "careful");
    let read = backend
        .call_agent_method(
            "agent.session.read",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("read");
    assert_eq!(read["messages"].as_array().expect("messages").len(), 0);
}
#[test]
fn browser_shared_control_interruption_requests_clarification_and_resolves_decision() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Shared Control Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "lyraLumen.read" => Ok(serde_json::to_string(&json!({
                "ok": false,
                "kind": "lyraLumenControlHandoff",
                "tabId": "browser-tab-1",
                "targetMode": "live",
                "needsUserAction": {
                    "kind": "shared_control_interrupted",
                    "tabId": "browser-tab-1",
                    "targetMode": "live"
                }
            }))
            .expect("json")),
            "lyraLumen.resolveControlHandoff" => {
                assert_eq!(input["decision"], "continue_agent");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenControlDecision",
                    "tabId": "browser-tab-1",
                    "decision": "continue_agent"
                }))
                .expect("json"))
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &thread_turn_id,
            &Some(dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-read-interrupted",
                "/tools/browser/read",
                json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id,
                "clarificationId": clarification_id,
                "answer": "Continue Agent",
                "selectedOption": "Continue Agent"
            }),
        )
        .expect("respond clarification");
    let output = handle.join().expect("join interrupted read");
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/decision")
            .and_then(Value::as_str),
        Some("continue_agent")
    );
    assert!(
        output["content"]
            .as_str()
            .unwrap_or_default()
            .contains("shared_control_decision")
    );
}
#[test]
fn auth_challenge_signal_triggers_elevation_clarification_and_verification() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Auth Elevation Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let dispatcher: Arc<HostCapabilityDispatcher> = Arc::new(|method, payload| {
        let input: Value = serde_json::from_str(&payload).expect("payload json");
        match method.as_str() {
            "lyraLumen.map" => Ok(serde_json::to_string(&json!({
                "ok": true,
                "kind": "lyraLumenMap",
                "tabId": "browser-tab-1",
                "targetMode": "isolated",
                "observationId": "obs-auth",
                "title": "Login",
                "url": "https://example.com/login",
                "elements": [],
                "authChallengeSignals": [{
                    "kind": "captcha",
                    "confidence": "high",
                    "source": "frame",
                    "label": "recaptcha"
                }],
                "needsUserAction": {
                    "kind": "auth_challenge",
                    "reason": "captcha",
                    "tabId": "browser-tab-1",
                    "targetMode": "isolated",
                    "suggestedAction": "lyra_lumen_elevate"
                }
            }))
            .expect("json")),
            "lyraLumen.elevate" => {
                assert_eq!(input["reason"], "captcha");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenElevation",
                    "tabId": "browser-tab-1",
                    "targetMode": "isolated",
                    "liveTabId": "browser-elevated-1",
                    "address": "https://example.com/login",
                    "title": "Login",
                    "userActionRequired": true,
                    "elevationSession": {
                        "sessionId": "elevation-1"
                    }
                }))
                .expect("json"))
            }
            "lyraLumen.completeElevation" => {
                assert_eq!(input["liveTabId"], "browser-elevated-1");
                Ok(serde_json::to_string(&json!({
                    "ok": true,
                    "kind": "lyraLumenElevationCompletion",
                    "tabId": "browser-tab-1",
                    "targetMode": "isolated",
                    "liveTabId": "browser-elevated-1",
                    "address": "https://example.com/app",
                    "title": "App",
                    "verified": true,
                    "message": "verified"
                }))
                .expect("json"))
            }
            other => panic!("unexpected method {other}"),
        }
    });
    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        execute_model_tool(
            &thread_session_id,
            &thread_turn_id,
            &Some(dispatcher),
            &Arc::new(AtomicBool::new(false)),
            tool_fs_run_call(
                "tool-map-auth",
                "/tools/browser/map",
                json!({ "tabId": "browser-tab-1", "targetMode": "isolated" }),
            ),
        )
    });
    let clarification_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "Open Visible Tab",
                "selectedOption": "Open Visible Tab"
            }),
        )
        .expect("respond elevation clarification");
    let permission_id = wait_for_pending_permission(&session_id);
    backend
        .call_agent_method(
            "agent.permission.respond",
            json!({ "sessionId": session_id.clone(), "permissionId": permission_id, "allowed": true }),
        )
        .expect("allow elevation");
    let completion_id = wait_for_pending_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id,
                "clarificationId": completion_id,
                "answer": "Done",
                "selectedOption": "Done"
            }),
        )
        .expect("respond completion clarification");
    let output = handle.join().expect("join auth map");
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/decision")
            .and_then(Value::as_str),
        Some("elevate_and_verify")
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/verification/verified")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/policyDecision/mode")
            .and_then(Value::as_str),
        Some("user_prompt")
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/policyDecision/outcome")
            .and_then(Value::as_str),
        Some("approved")
    );
    assert_eq!(
        output
            .pointer("/raw/userActionResolution/policyDecision/action")
            .and_then(Value::as_str),
        Some("elevate")
    );
}
#[test]
fn goals_btw_and_overnight_return_real_state() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Workflow Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let goals = backend
        .call_agent_method(
            "agent.goals.list",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("list goals");
    assert!(!goals["goals"].as_array().expect("goals").is_empty());
    let opened = backend
        .call_agent_method(
            "agent.goals.open",
            json!({ "sessionId": session_id.clone() }),
        )
        .expect("open goal");
    assert_eq!(
        opened["sidePanel"]["pages"]
            .as_array()
            .expect("pages")
            .len(),
        1
    );
    let btw = backend
        .call_agent_method(
            "agent.btw.run",
            json!({ "sessionId": session_id.clone(), "question": "What is the context?" }),
        )
        .expect("btw");
    assert!(
        btw["sidePanel"]["pages"][0]["content"]
            .as_str()
            .expect("btw content")
            .contains("**Answer:**")
    );
    let selfdev = backend
        .call_agent_method(
            "agent.selfdev.start",
            json!({
                "target": "validation",
                "inheritContext": false
            }),
        )
        .expect("selfdev start");
    let selfdev_session_id = selfdev["sessionId"]
        .as_str()
        .expect("selfdev session id")
        .to_string();
    assert_eq!(selfdev["snapshot"]["sessionKind"], "selfdev");
    assert_eq!(selfdev["selfdev"]["target"], "validation");
    let selfdev_turn = backend
        .call_agent_method(
            "agent.selfdev.sendTurn",
            json!({ "sessionId": selfdev_session_id.clone(), "text": "Check selfdev task state." }),
        )
        .expect("selfdev send turn");
    assert_eq!(selfdev_turn["sessionId"], selfdev_session_id);
    let selfdev_status = backend
        .call_agent_method(
            "agent.selfdev.status",
            json!({ "sessionId": selfdev_session_id }),
        )
        .expect("selfdev status");
    assert_eq!(selfdev_status["metadata"]["mode"], "selfdev");
    assert!(
        selfdev_status["metadata"]["capabilities"]
            .as_array()
            .expect("capabilities")
            .iter()
            .any(|capability| capability["id"] == "runtime_reload")
    );
    let overnight = backend
        .call_agent_method(
            "agent.overnight.start",
            json!({
                "sessionId": session_id.clone(),
                "durationMinutes": 1,
                "mission": "short test",
                "inheritContext": true
            }),
        )
        .expect("overnight start");
    let run_id = overnight["run"]["runId"]
        .as_str()
        .expect("run id")
        .to_string();
    let mut status = Value::Null;
    for _ in 0..100 {
        status = backend
            .call_agent_method("agent.overnight.status", json!({ "runId": run_id.clone() }))
            .expect("overnight status");
        if status["run"]["status"] == "completed" {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(status["run"]["status"], "completed");
    assert!(
        status["run"]["reviewHtml"]
            .as_str()
            .expect("review")
            .contains("Overnight Review")
    );
    assert!(
        !status["run"]["events"]
            .as_array()
            .expect("events")
            .is_empty()
    );
    let cancellable = backend
        .call_agent_method(
            "agent.overnight.start",
            json!({
                "sessionId": session_id.clone(),
                "durationMinutes": 1,
                "mission": "cancel test"
            }),
        )
        .expect("overnight start for cancel");
    let cancel_run_id = cancellable["run"]["runId"]
        .as_str()
        .expect("cancel run id")
        .to_string();
    let cancelled = backend
        .call_agent_method(
            "agent.overnight.cancel",
            json!({ "runId": cancel_run_id.clone() }),
        )
        .expect("overnight cancel");
    assert_eq!(cancelled["run"]["status"], "cancelled");
    thread::sleep(Duration::from_millis(80));
    let cancelled_status = backend
        .call_agent_method("agent.overnight.status", json!({ "runId": cancel_run_id }))
        .expect("cancelled overnight status");
    assert_eq!(cancelled_status["run"]["status"], "cancelled");
}
