use super::*;

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
            i18n_key: None,
            options: Vec::new(),
            allow_custom_answer: true,
            detail: None,
            detail_i18n_key: None,
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
        suppressed_tool_usage_by_turn: HashMap::new(),
        inspected_tool_descriptors_by_session: HashMap::new(),
        active_compressions: HashSet::new(),
        legacy_plaintext_provider_keys: HashSet::new(),
        first_used_at: None,
        dirty: false,
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
    let cancellation = CancellationToken::new();
    let list = execute_model_tool_sync(
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
    assert_eq!(list["status"].as_str(), Some("completed"));
    assert_eq!(list["raw"]["path"].as_str(), Some("."));
    assert_ne!(
        list.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
    );

    let shell = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-shell-unbound",
            "/tools/shell/run",
            json!({ "command": "printf shell-ok" }),
        ),
    );
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
    let cancellation = CancellationToken::new();
    for (index, (path, args, expected_domain, expected_operation)) in
        [("/tools/memory/search", json!({}), "memory", "search")]
            .into_iter()
            .enumerate()
    {
        let turn_id = start_test_runtime_turn(&session_id);
        let output = execute_model_tool_sync(
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
fn tool_fs_filesystem_targets_validate_run_envelope() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "tool fs read file\n").expect("write README");
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title": "Tool-FS Filesystem Target Test",
                "workingDir": temp.path().display().to_string()
            }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = CancellationToken::new();

    let legacy = execute_model_tool_sync(
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

    let inspect = execute_model_tool_sync(
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
    assert_eq!(inspect["status"].as_str(), Some("completed"));
    assert_eq!(
        inspect["raw"]["path"].as_str(),
        Some("/tools/filesystem/read_file")
    );

    let read_file = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "run-read-file",
            "/tools/filesystem/read_file",
            json!({ "path": "README.md" }),
        ),
    );
    assert_eq!(read_file["status"].as_str(), Some("completed"));
    assert!(
        read_file["content"]
            .as_str()
            .is_some_and(|text| text.contains("tool fs read file"))
    );

    let invalid_args = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "invalid-tool-fs-args".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "path": "/tools/memory/search",
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

    let inactive_turn = execute_model_tool_sync(
        &session_id,
        "turn-not-active",
        &None,
        &cancellation,
        ModelToolCall {
            id: "inactive-turn-tool-fs-run".to_string(),
            name: "tool_fs_run".to_string(),
            arguments: json!({
                "path": "/tools/memory/search",
                "args": {}
            }),
        },
    );
    assert_eq!(
        inactive_turn.pointer("/error/code").and_then(Value::as_str),
        Some("runtime_turn_not_active")
    );
    assert_eq!(inactive_turn["status"].as_str(), Some("failed"));
    let inactive_list = execute_model_tool_sync(
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

    let traced = execute_model_tool_sync(
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
    let cancellation = CancellationToken::new();
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-command".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({
                "query": "打开网页 navigate browser",
                "scene": "browser",
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
            .any(|result| result["path"] == "/tools/browser/navigate")
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

    let invalid = execute_model_tool_sync(
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
fn tool_fs_search_does_not_guide_generated_file_writes_to_removed_code_tools() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Generated File Write Search Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = CancellationToken::new();
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-fs-search-generated-html".to_string(),
            name: "tool_fs_search".to_string(),
            arguments: json!({
                "query": "write file create html file",
                "scene": "project-code",
                "pageSize": 5
            }),
        },
    );

    assert_eq!(output["status"].as_str(), Some("completed"));
    let content = output["content"].as_str().expect("search content");
    assert!(!content.contains("lyra-write-file"));
    let results = output["raw"]["results"].as_array().expect("search results");
    assert!(results.is_empty());
    assert_eq!(output["raw"]["total"], 0);
    assert_eq!(output["raw"]["fallbackListPath"], "/tools");
    for tool_name in ["edit_file", "write_file"] {
        assert!(content.contains(tool_name));
        assert!(
            output["raw"]["recommendedNextAction"]
                .as_str()
                .is_some_and(|recommendation| recommendation.contains(tool_name))
        );
    }
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
    let cancellation = CancellationToken::new();
    let output = execute_model_tool_sync(
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
    let cancellation = CancellationToken::new();

    let success = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-cache-memory-success",
            "/tools/memory/search",
            json!({ "query": "cached tool note" }),
        ),
    );
    assert_eq!(success["ok"].as_bool(), Some(true));
    {
        let state = state().lock().expect("state lock");
        let entry = state
            .tool_usage_cache
            .get("/tools/memory/search")
            .expect("usage cache entry");
        assert_eq!(entry.successes, 1);
        assert_eq!(entry.failures, 0);
        assert_eq!(entry.consecutive_failures, 0);
        assert_eq!(entry.handle.as_deref(), Some("memory_search"));
    }

    let context = tool_filesystem_runtime_context("project-code", None, None);
    assert!(
        context["cachedHandles"]
            .as_array()
            .expect("cached handles")
            .iter()
            .any(|handle| handle["path"] == "/tools/memory/search"
                && handle["source"] == "toolUsageCache")
    );
    assert!(
        context["cachedHandles"]
            .as_array()
            .expect("cached handles")
            .iter()
            .all(|handle| handle["path"] != "/tools/filesystem/read_file")
    );

    let failed = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-cache-memory-failed",
            "/tools/memory/update",
            json!({}),
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
            .get("/tools/memory/update")
            .expect("usage cache entry");
        assert_eq!(entry.successes, 0);
        assert_eq!(entry.failures, 1);
        assert_eq!(entry.consecutive_failures, 1);
        assert!(
            state
                .suppressed_tool_usage_by_turn
                .get(&turn_id)
                .is_some_and(|paths| paths.contains("/tools/memory/update"))
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
            api_key_ref: None,
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
                supports_reasoning_effort: None,
                reasoning_replay_field: ReasoningReplayField::Auto,
                requires_reasoning_field_on_assistant_messages: None,
                supports_tool_choice: None,
                enabled: true,
                capability_probes: HashMap::new(),
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
fn config_json_projects_prompt_delivery_settings() {
    let config = NativeConfig {
        prompt_delivery_mode: Some("lean-experimental".to_string()),
        openai_responses_stateful_prompt_contract: true,
        ..NativeConfig::default()
    };
    let projection = config_json(&config);

    assert_eq!(
        projection
            .pointer("/promptDelivery/mode")
            .and_then(Value::as_str),
        Some("lean-experimental")
    );
    assert_eq!(
        projection
            .pointer("/promptDelivery/leanExperimental")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        projection
            .pointer("/promptDelivery/openaiResponsesStatefulPromptContract")
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn default_provider_install_only_seeds_current_opencode_anonymous_models() {
    let mut config = NativeConfig::default();
    install_default_providers(&mut config);

    assert!(
        config
            .providers
            .values()
            .filter(|provider| provider.id != "opencode-free")
            .all(|provider| provider.models.is_empty())
    );
    assert!(!config.providers.contains_key("mimo-free"));
    let opencode_models = config
        .providers
        .get("opencode-free")
        .expect("OpenCode anonymous provider")
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        opencode_models,
        vec![
            "big-pickle",
            "deepseek-v4-flash-free",
            "mimo-v2.5-free",
            "nemotron-3-ultra-free",
        ]
    );
    let catalog = model_catalog_for_config(&config, json!({})).expect("model catalog");
    assert_eq!(catalog["models"].as_array().map(Vec::len), Some(4));
    assert_eq!(catalog["routes"].as_array().map(Vec::len), Some(4));
}

#[test]
fn default_provider_install_removes_retired_anonymous_mimo_profile() {
    let mut config = NativeConfig {
        default_provider: Some("mimo-free".to_string()),
        default_model: Some("mimo-auto".to_string()),
        memory_agent_provider: Some("mimo-free".to_string()),
        memory_agent_model: Some("mimo-auto".to_string()),
        ..NativeConfig::default()
    };
    config.providers.insert(
        "mimo-free".to_string(),
        NativeProviderProfile {
            id: "mimo-free".to_string(),
            label: "MiMo Free".to_string(),
            route_id: providers::routes::custom_openai_compatible::ROUTE_ID.to_string(),
            base_url: Some("https://api.xiaomimimo.com/v1".to_string()),
            default_model: Some("mimo-auto".to_string()),
            api_key: Some("public".to_string()),
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        },
    );

    install_default_providers(&mut config);

    assert!(!config.providers.contains_key("mimo-free"));
    assert_eq!(config.default_provider.as_deref(), Some("opencode-free"));
    assert_eq!(config.default_model.as_deref(), Some("big-pickle"));
    assert!(config.memory_agent_provider.is_none());
    assert!(config.memory_agent_model.is_none());
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
                api_key_ref: None,
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
                    supports_reasoning_effort: None,
                    reasoning_replay_field: ReasoningReplayField::Auto,
                    requires_reasoning_field_on_assistant_messages: None,
                    supports_tool_choice: None,
                    enabled: true,
                    capability_probes: HashMap::new(),
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
            api_key_ref: None,
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
                    supports_reasoning_effort: None,
                    reasoning_replay_field: ReasoningReplayField::Auto,
                    requires_reasoning_field_on_assistant_messages: None,
                    supports_tool_choice: None,
                    enabled: true,
                    capability_probes: HashMap::new(),
                },
                NativeProviderModel {
                    id: "disabled-model".to_string(),
                    label: None,
                    context_window: None,
                    supports_image_input: true,
                    supports_tool_calling: true,
                    supports_streaming: true,
                    supports_reasoning_effort: None,
                    reasoning_replay_field: ReasoningReplayField::Auto,
                    requires_reasoning_field_on_assistant_messages: None,
                    supports_tool_choice: None,
                    enabled: false,
                    capability_probes: HashMap::new(),
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
    {
        let mut state = state().lock().expect("state lock");
        state.active_skills.clear();
        let session = state.sessions.get_mut(session_id).expect("session");
        session.snapshot["messages"]
            .as_array_mut()
            .expect("messages")
            .push(user_message(
                "Inspect Lyra's runtime contract.".to_string(),
                Vec::new(),
                now(),
            ));
    }
    let request = build_model_request(session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("Act on the user's real computer"));
    assert!(system_prompt.contains("Translate the request into observable success criteria"));
    assert!(system_prompt.contains("Fix bugs at the shared root cause"));
    assert!(system_prompt.contains("Ordinary text questions are final and non-blocking"));
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
    let turn_tail = request
        .messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|message| message.get("content").and_then(Value::as_str))
        .expect("user turn tail");
    for dynamic_field in [
        "toolFilesystem",
        "\"interactionContract\"",
        "\"clarificationTool\"",
        "pinnedHandles",
    ] {
        assert!(!system_prompt.contains(dynamic_field));
        assert!(turn_tail.contains(dynamic_field));
    }
    {
        let state = state().lock().expect("state lock");
        let session = state.sessions.get(session_id).expect("session");
        assert!(session.snapshot.get("promptRuntimeContract").is_some());
        assert_eq!(
            session
                .snapshot
                .pointer("/promptDelivery/promptMode")
                .and_then(Value::as_str),
            Some("full")
        );
        assert_eq!(
            session
                .snapshot
                .pointer("/promptDelivery/refreshReason")
                .and_then(Value::as_str),
            Some("fullModeDefault")
        );
        assert!(
            session
                .snapshot
                .pointer("/promptDelivery/sceneModules")
                .and_then(Value::as_array)
                .is_some()
        );
        assert!(
            session
                .snapshot
                .pointer("/promptDelivery/prefixCacheEligibleTokens")
                .and_then(Value::as_u64)
                .is_some_and(|tokens| tokens > 0)
        );
        assert!(
            session
                .snapshot
                .pointer("/promptDelivery/missedModuleRecovery")
                .is_some()
        );
    }
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
    let turn_tail = request
        .messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|message| message.get("content").and_then(Value::as_str))
        .expect("user turn tail");
    assert!(!system_prompt.contains("\"presearchHints\""));
    assert!(turn_tail.contains("\"presearchHints\""));
    assert!(turn_tail.contains("/tools/browser/navigate"));
    assert!(!turn_tail.contains("\"toolDiscoverySuppressed\": true"));
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
            reasoning_replay_field: ReasoningReplayField::None,
            requires_reasoning_field_on_assistant_messages: false,
            supports_tool_choice: true,
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
fn provider_visible_tool_schema_snapshot_is_curated_runtime_surface() {
    for tools in [model_tools()] {
        let names = tools
            .iter()
            .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(names, expected_provider_tool_names());
        assert_eq!(
            names.first().map(String::as_str),
            Some(LYRA_CLARIFICATION_ASK_TOOL)
        );
        let clarification = tools
            .iter()
            .find(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str)
                    == Some(LYRA_CLARIFICATION_ASK_TOOL)
            })
            .expect("clarification tool");
        let description = clarification
            .pointer("/function/description")
            .and_then(Value::as_str)
            .expect("clarification description");
        assert!(description.contains("decision panel"));
        assert!(description.contains("Plain assistant text questions are non-blocking"));
        assert!(
            clarification
                .pointer("/function/parameters/properties/question/description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.contains("blocking decision panel"))
        );
        assert!(tools.iter().all(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .is_some_and(|name| {
                    name.starts_with("tool_fs_")
                        || name == LYRA_CLARIFICATION_ASK_TOOL
                        || name == READ_FILE_MODEL_TOOL
                        || name == GLOB_MODEL_TOOL
                        || name == GREP_MODEL_TOOL
                        || name == EXEC_COMMAND_MODEL_TOOL
                        || name == WRITE_STDIN_MODEL_TOOL
                        || name == EDIT_FILE_MODEL_TOOL
                        || name == WRITE_FILE_MODEL_TOOL
                        || name == "apply_patch"
                        || name == LYRA_SESSION_READ_MESSAGE_TOOL
                        || name == PLAN_BEGIN_MODEL_TOOL
                        || name == PLAN_WRITE_MODEL_TOOL
                        || name == PLAN_FINALIZE_MODEL_TOOL
                        || name == PLAN_REVISE_MODEL_TOOL
                        || name == TODO_WRITE_MODEL_TOOL
                        || name == TODO_UPDATE_MODEL_TOOL
                        || name == TODO_FINISH_MODEL_TOOL
                })
        }));
        assert!(!names.iter().any(|name| name == UPDATE_PLAN_MODEL_TOOL));
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
                            | "software_invoke_capability"
                    )
                })
        }));
        let read_file = tools
            .iter()
            .find(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str) == Some(READ_FILE_MODEL_TOOL)
            })
            .expect("read_file schema");
        assert!(
            read_file
                .pointer("/function/description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.contains("rejects directories"))
        );
        assert!(
            read_file
                .pointer("/function/parameters/properties/endLine/description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.contains("startLine"))
        );
        let plan_begin = tools
            .iter()
            .find(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str)
                    == Some(PLAN_BEGIN_MODEL_TOOL)
            })
            .expect("plan_begin schema");
        assert!(
            plan_begin
                .pointer("/function/parameters/required")
                .and_then(Value::as_array)
                .is_some_and(|required| required.as_slice() == [json!("title")])
        );
        assert!(plan_begin.pointer("/function/parameters/allOf").is_none());
        let plan_finalize = tools
            .iter()
            .find(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str)
                    == Some(PLAN_FINALIZE_MODEL_TOOL)
            })
            .expect("plan_finalize schema");
        assert!(
            plan_finalize
                .pointer("/function/parameters/required")
                .is_none()
        );
        assert!(
            plan_finalize
                .pointer("/function/parameters/properties/investigationEvidenceIds")
                .is_none()
        );
        let todo_update = tools
            .iter()
            .find(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str)
                    == Some(TODO_UPDATE_MODEL_TOOL)
            })
            .expect("todo_update schema");
        assert!(
            todo_update
                .pointer("/function/parameters/required")
                .and_then(Value::as_array)
                .is_some_and(|required| { required.as_slice() == [json!("id"), json!("status")] })
        );
        assert!(todo_update.pointer("/function/parameters/allOf").is_none());
        assert!(
            todo_update
                .pointer("/function/parameters/properties/evidenceIds")
                .is_none()
        );
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
    let mut actual_provider_tools = context["policy"]["providerVisibleTools"]
        .as_array()
        .expect("provider-visible tools")
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    actual_provider_tools.sort();
    let mut expected_provider_tools = expected_provider_tool_names();
    expected_provider_tools.sort();
    assert_eq!(actual_provider_tools, expected_provider_tools);
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
        infer_tool_filesystem_scene(Some("project-code"), None, &HashSet::new(), &json!({})),
        "project-code"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "terminal" } }),
        ),
        "terminal"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "browser" } }),
        ),
        "browser"
    );
    assert_eq!(
        infer_tool_filesystem_scene(
            None,
            None,
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
            &HashSet::new(),
            &json!({ "activeTab": { "kind": "software" } }),
        ),
        "automation"
    );
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
fn terminal_activity_summary_includes_lifecycle_projection() {
    let summary = format_terminal_output(
        "wait",
        &json!({
            "target": { "type": "private", "sessionId": "terminal-session-1" },
            "sessionId": "terminal-session-1",
            "output": "",
            "running": true,
            "exitCode": null,
            "reason": "timeout",
            "lifecycle": {
                "sessionId": "terminal-session-1",
                "state": "waiting",
                "phase": "command_wait",
                "reason": "timeout",
                "terminalRunning": true,
                "commandId": "command-1",
                "commandStatus": "running",
                "exitCode": null,
                "waiting": true,
                "background": false
            }
        }),
    );

    assert!(summary.contains("lifecycle state=waiting phase=command_wait"));
    assert!(summary.contains("commandStatus=running"));
    assert!(summary.contains("commandId=command-1"));
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
    let artifact_read = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &None,
        &CancellationToken::new(),
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
    let output = execute_model_tool_sync(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &CancellationToken::new(),
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
