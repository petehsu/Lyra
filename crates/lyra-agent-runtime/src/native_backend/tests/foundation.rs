use super::*;
#[test]
fn native_backend_creates_and_reads_session() {
    // A session created without an explicit working directory defaults to the
    // user's home directory and is bound (projectBound=true, workingDirIsHome=true)
    // — there are no unbound sessions.
    let home = dirs::home_dir()
        .map(|path| path.display().to_string())
        .expect("home directory");
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Test" }))
        .expect("create session");
    assert_eq!(created["workingDir"], home);
    assert_eq!(created["projectBound"], true);
    assert_eq!(created["workingDirIsHome"], true);
    let session_id = created["id"].as_str().expect("session id").to_string();
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["title"], "Test");
    assert_eq!(read["workingDir"], home);
    assert_eq!(read["projectBound"], true);
    assert_eq!(read["workingDirIsHome"], true);
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
fn provider_catalog_reports_rust_owned_routes_and_protocols() {
    let backend = LyraAgentBackend;
    let catalog = backend
        .call_agent_method("agent.provider.catalog.read", json!({}))
        .expect("provider catalog");

    assert_eq!(catalog["schemaVersion"], "2026-06-14");
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| entry["id"] == "openai_chat_completions")
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "openai_responses"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == true
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "aws_bedrock_converse"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == false
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "gemini_generate_content"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == true
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["protocols"]
            .as_array()
            .expect("protocol list")
            .iter()
            .any(|entry| {
                entry["id"] == "anthropic_messages"
                    && entry["runtimeSupported"] == true
                    && entry["streamingSupported"] == true
                    && entry["toolCallingSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "openai"
                    && entry["protocolId"] == "openai_responses"
                    && entry["apiMethod"] == "responses"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "aws_bedrock"
                    && entry["protocolId"] == "aws_bedrock_converse"
                    && entry["apiMethod"] == "converse"
                    && entry["authKind"] == "aws_sigv4_env"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == false
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "google_gemini"
                    && entry["protocolId"] == "gemini_generate_content"
                    && entry["apiMethod"] == "generateContent"
                    && entry["authKind"] == "x-goog-api-key"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "anthropic"
                    && entry["protocolId"] == "anthropic_messages"
                    && entry["apiMethod"] == "messages"
                    && entry["catalogSection"] == "hosted"
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "custom_anthropic_compatible"
                    && entry["protocolId"] == "anthropic_messages"
                    && entry["apiMethod"] == "messages"
                    && entry["catalogSection"] == "custom"
                    && entry["customHeadersSupported"] == true
                    && entry["quickSetupSupported"] == true
            })
    );
    assert!(
        catalog["profiles"]
            .as_array()
            .expect("profile list")
            .iter()
            .any(|entry| entry["id"] == "openai" && entry["routeId"] == "openai")
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .all(|entry| entry.get("catalogSection").is_some())
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .any(|entry| {
                entry["id"] == "mimo"
                    && entry["defaultBaseUrl"] == "https://api.xiaomimimo.com/v1"
                    && entry["authKind"] == "bearer_or_header"
            })
    );
    assert!(
        catalog["routes"]
            .as_array()
            .expect("route list")
            .iter()
            .all(|entry| entry["id"] != "mimo_token_plan")
    );
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
        route_id: "custom_openai_compatible".to_string(),
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
            enabled: true,
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
fn native_backend_defaults_unbound_workspace_tools_to_home_directory() {
    // An unbound session (the user sent a message without choosing a project)
    // defaults both shell and filesystem tools to the user's home directory
    // instead of rejecting filesystem work. This keeps the two tool families
    // operating in the same place and lets users start chatting without first
    // binding a project.
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
    assert_eq!(output["status"].as_str(), Some("completed"));
    assert_ne!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
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
fn native_backend_rejects_rebinding_a_session_already_bound_to_a_project() {
    // Once a session is bound to a real project the binding is permanent:
    // re-binding to a different root would desynchronize the session's tool
    // history, file-read state, and rollback checkpoints from the new root.
    let backend = LyraAgentBackend;
    let first = tempfile::tempdir().expect("first tempdir");
    let second = tempfile::tempdir().expect("second tempdir");
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Rebind Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();

    // First bind succeeds (session starts home-bound, which may be rebound once).
    let bound = backend
        .call_agent_method(
            "agent.session.bindProject",
            json!({
                "sessionId": session_id,
                "workingDir": first.path().display().to_string()
            }),
        )
        .expect("first bind");
    assert_eq!(bound["projectBound"], true);

    // Second bind to a different root is rejected.
    let rebind = backend.call_agent_method(
        "agent.session.bindProject",
        json!({
            "sessionId": session_id,
            "workingDir": second.path().display().to_string()
        }),
    );
    assert!(rebind.is_err(), "rebinding a bound session must fail");

    // The original binding is preserved.
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(
        read["workingDir"].as_str(),
        Some(first.path().display().to_string().as_str())
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
    let mut config = NativeConfig {
        default_provider: Some("custom".to_string()),
        default_model: Some("custom-model".to_string()),
        ..NativeConfig::default()
    };
    config.providers.insert(
        "custom".to_string(),
        NativeProviderProfile {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            route_id: "custom_openai_compatible".to_string(),
            base_url: Some("http://localhost:8787/v1".to_string()),
            default_model: Some("custom-model".to_string()),
            api_key: Some("sk-test".to_string()),
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
                enabled: true,
            }],
        },
    );
    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");

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
fn model_catalog_does_not_synthesize_models_without_configured_providers() {
    let catalog =
        model_catalog_for_config(&NativeConfig::default(), json!({})).expect("model catalog");

    assert_eq!(catalog["currentProvider"], "");
    assert_eq!(catalog["currentModel"], "");
    assert!(catalog["models"].as_array().is_some_and(Vec::is_empty));
    assert!(catalog["routes"].as_array().is_some_and(Vec::is_empty));
}

#[test]
fn default_provider_install_does_not_seed_hardcoded_models() {
    let mut config = NativeConfig::default();
    install_default_providers(&mut config);

    assert!(
        config
            .providers
            .values()
            .all(|provider| provider.models.is_empty())
    );
    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");
    assert!(catalog["models"].as_array().is_some_and(Vec::is_empty));
    assert!(catalog["routes"].as_array().is_some_and(Vec::is_empty));
}

#[test]
fn save_provider_profile_preserves_omitted_secret_and_models() {
    let backend = LyraAgentBackend;
    let profile_name = format!("preserve-profile-{}", Uuid::new_v4());
    let original_model = format!("preserve-model-{}", Uuid::new_v4());
    {
        let mut state = state().lock().expect("state lock");
        state.config.providers.insert(
            profile_name.clone(),
            NativeProviderProfile {
                id: profile_name.clone(),
                label: "Preserve Profile".to_string(),
                route_id: "custom_openai_compatible".to_string(),
                base_url: Some("https://old.example.com/v1".to_string()),
                default_model: Some(original_model.clone()),
                api_key: Some("sk-preserve".to_string()),
                api_key_env: Some("LYRA_PRESERVE_API_KEY".to_string()),
                auth_header: Some("api-key".to_string()),
                embedding_model: Some("embedding-preserve".to_string()),
                models: vec![NativeProviderModel {
                    id: original_model.clone(),
                    label: Some("Preserve Model".to_string()),
                    context_window: Some(42_000),
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    enabled: true,
                }],
            },
        );
    }

    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "custom_openai_compatible",
                "baseUrl": "https://new.example.com/v1",
            }),
        )
        .expect("save provider profile");

    let state = state().lock().expect("state lock");
    let profile = state
        .config
        .providers
        .get(&profile_name)
        .expect("profile preserved");
    assert_eq!(
        profile.base_url.as_deref(),
        Some("https://new.example.com/v1")
    );
    assert_eq!(
        profile.default_model.as_deref(),
        Some(original_model.as_str())
    );
    assert_eq!(profile.api_key.as_deref(), Some("sk-preserve"));
    assert_eq!(
        profile.api_key_env.as_deref(),
        Some("LYRA_PRESERVE_API_KEY")
    );
    assert_eq!(profile.auth_header.as_deref(), Some("api-key"));
    assert_eq!(
        profile.embedding_model.as_deref(),
        Some("embedding-preserve")
    );
    assert_eq!(profile.models.len(), 1);
    assert_eq!(profile.models[0].id, original_model);
}

#[test]
fn save_mimo_anthropic_profile_uses_api_key_header_by_default() {
    let backend = LyraAgentBackend;
    let profile_name = format!("mimo-anthropic-profile-{}", Uuid::new_v4());

    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": providers::routes::mimo::ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID,
                "apiKey": "tp-secret",
                "authHeader": null,
            }),
        )
        .expect("save mimo anthropic provider profile");

    let state = state().lock().expect("state lock");
    let profile = state
        .config
        .providers
        .get(&profile_name)
        .expect("profile saved");
    assert_eq!(
        profile.route_id,
        providers::routes::mimo::ANTHROPIC_TOKEN_PLAN_SGP_ROUTE_ID
    );
    assert_eq!(
        profile.base_url.as_deref(),
        Some(providers::routes::mimo::ANTHROPIC_TOKEN_PLAN_SGP_BASE_URL)
    );
    assert_eq!(profile.api_key.as_deref(), Some("tp-secret"));
    assert_eq!(profile.auth_header.as_deref(), Some("api-key"));
}

#[test]
fn model_catalog_keeps_disabled_models_out_of_routes() {
    let mut config = NativeConfig {
        default_provider: Some("custom".to_string()),
        default_model: Some("enabled-model".to_string()),
        ..NativeConfig::default()
    };
    config.providers.insert(
        "custom".to_string(),
        NativeProviderProfile {
            id: "custom".to_string(),
            label: "Custom".to_string(),
            route_id: "custom_openai_compatible".to_string(),
            base_url: Some("http://localhost:8787/v1".to_string()),
            default_model: Some("enabled-model".to_string()),
            api_key: Some("sk-test".to_string()),
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: vec![
                NativeProviderModel {
                    id: "enabled-model".to_string(),
                    label: None,
                    context_window: None,
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    enabled: true,
                },
                NativeProviderModel {
                    id: "disabled-model".to_string(),
                    label: None,
                    context_window: None,
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    enabled: false,
                },
            ],
        },
    );

    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter_map(|model| model["model"].as_str())
        .collect::<Vec<_>>();
    let route_models = catalog["routes"]
        .as_array()
        .expect("routes")
        .iter()
        .filter_map(|route| route["model"].as_str())
        .collect::<Vec<_>>();
    let disabled = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .find(|model| model["model"].as_str() == Some("disabled-model"))
        .expect("disabled model");

    assert!(model_ids.contains(&"enabled-model"));
    assert!(model_ids.contains(&"disabled-model"));
    assert!(route_models.contains(&"enabled-model"));
    assert!(!route_models.contains(&"disabled-model"));
    assert_eq!(disabled["enabled"], false);
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
    assert!(system_prompt.contains("You are Lyra."));
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

mod host_and_browser;
mod native_and_git;
mod permissions_and_flows;
