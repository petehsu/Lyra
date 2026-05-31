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
        ModelToolCall {
            id: "tool-list".to_string(),
            name: "file_list".to_string(),
            arguments: json!({ "path": "." }),
        },
    );
    assert_eq!(
        output.pointer("/error/code").and_then(Value::as_str),
        Some("workspace_unbound")
    );
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
    assert!(system_prompt.contains("not a plain text assistant"));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("workbench_list_tabs")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("artifact_read")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_lumen_map")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_lumen_see")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_lumen_submit")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str)
            == Some("software_inspect_capability")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("software_read_state")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("memory_remember")
    }));
    for name in [
        "memory_update",
        "memory_forget",
        "memory_list",
        "memory_link",
    ] {
        assert!(
            request.tools.iter().any(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str) == Some(name)
            })
        );
    }
    assert!(!request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_design_search_styles")
    }));
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
        tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_design_search_styles")
    }));
    assert!(request.tools.iter().any(|tool| {
        tool.pointer("/function/name").and_then(Value::as_str)
            == Some("lyra_design_get_style_details")
    }));
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
        ModelToolCall {
            id: "tool-test".to_string(),
            name: "workbench_list_tabs".to_string(),
            arguments: json!({ "scope": "all" }),
        },
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
        ModelToolCall {
            id: "tool-timeout".to_string(),
            name: "lyra_lumen_read".to_string(),
            arguments: json!({ "tabId": "browser-tab-1" }),
        },
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
        ModelToolCall {
            id: "tool-timeout-hard-boundary".to_string(),
            name: "workbench_list_tabs".to_string(),
            arguments: json!({ "timeoutMs": 250 }),
        },
    );

    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(
        output["content"]
            .as_str()
            .unwrap_or_default()
            .contains("timed out")
    );
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert_eq!(read["tools"][0]["name"], "workbench");
    assert_eq!(read["tools"][0]["status"], "failed");
    assert!(read["tools"][0]["finishedAt"].is_string());
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
        ModelToolCall {
            id: "tool-see".to_string(),
            name: "lyra_lumen_see".to_string(),
            arguments: json!({ "targetMode": "live" }),
        },
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
            ModelToolCall {
                id: "tool-submit".to_string(),
                name: "lyra_lumen_submit".to_string(),
                arguments: json!({ "elementId": 9, "targetMode": "live" }),
            },
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

    let inspect_output = execute_model_tool(
        &session_id,
        &turn_id,
        &Some(dispatcher),
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-inspect".to_string(),
            name: "software_inspect_capability".to_string(),
            arguments: json!({
                "softwareId": "image-viewer",
                "capabilityId": "image-viewer.readMetadata"
            }),
        },
    );
    assert!(
        inspect_output["content"]
            .as_str()
            .expect("content")
            .contains("Read Image Metadata")
    );
}

#[test]
fn registry_model_tools_have_dispatch_paths_and_unknown_tools_fail_structurally() {
    let service = ToolActivityService::default();
    let names = service.model_tool_names();
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
    }

    for name in names {
        let known_special = matches!(
            name.as_str(),
            "memory_search"
                | "memory_remember"
                | "memory_update"
                | "memory_forget"
                | "memory_list"
                | "memory_link"
                | "memory_review_candidates"
                | "memory_apply_candidate"
                | "memory_reject_candidate"
                | "memory_explain_injection"
                | "ask_user"
                | "skill_list"
                | "skill_inspect"
                | "skill_activate"
                | "skill_deactivate"
        ) || name.starts_with("mcp_");
        assert!(
            known_special
                || native_tool_mapping(&name).is_some()
                || host_tool_mapping(&name, json!({})).is_some(),
            "exposed model tool lacks native/host/registry dispatch path: {name}"
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
        ModelToolCall {
            id: "tool-read".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": "README.md", "startLine": 1, "endLine": 1 }),
        },
    );
    assert!(read["content"].as_str().unwrap().contains("needle in docs"));

    let glob = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-glob".to_string(),
            name: "file_glob".to_string(),
            arguments: json!({ "pattern": "**/*.rs" }),
        },
    );
    assert!(glob["content"].as_str().unwrap().contains("src/main.rs"));

    let search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-search".to_string(),
            name: "project_search".to_string(),
            arguments: json!({ "query": "needle" }),
        },
    );
    assert!(search["content"].as_str().unwrap().contains("README.md"));

    let symbol = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-symbol".to_string(),
            name: "code_search_symbol".to_string(),
            arguments: json!({ "query": "main" }),
        },
    );
    assert!(symbol["content"].as_str().unwrap().contains("src/main.rs"));

    let shell = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-shell".to_string(),
            name: "shell_run".to_string(),
            arguments: json!({ "command": "printf hello", "cwd": "." }),
        },
    );
    assert!(shell["content"].as_str().unwrap().contains("hello"));
    assert_eq!(shell["raw"]["exitCode"].as_i64(), Some(0));

    let rendered = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-render".to_string(),
            name: "render_surface".to_string(),
            arguments: json!({
                "surfaceId": "test-dashboard",
                "title": "Test Dashboard",
                "kind": "html",
                "content": "<section><h1>Inline dashboard</h1><button data-lyra-action=\"refresh\">Refresh</button></section>",
                "height": 260,
                "summary": "A render surface produced by the native tool dispatch path."
            }),
        },
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
        ModelToolCall {
            id: "tool-todo".to_string(),
            name: "todo_write".to_string(),
            arguments: json!({
                "todos": [{
                    "id": "todo-test",
                    "content": "verify native tool surface",
                    "status": "in_progress"
                }]
            }),
        },
    );
    assert!(
        todos["content"]
            .as_str()
            .unwrap()
            .contains("Updated 1 todos")
    );
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

    let outside = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-outside".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": "/etc/passwd" }),
        },
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
        ModelToolCall {
            id: "tool-lumen-artifact".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": lumen_path.display().to_string() }),
        },
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
        ModelToolCall {
            id: "tool-list".to_string(),
            name: "file_list".to_string(),
            arguments: json!({ "path": ".", "recursive": true }),
        },
    );
    assert!(listed["content"].as_str().unwrap().contains("src/main.rs"));

    let missing = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-missing-file".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": "missing.txt" }),
        },
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
        ModelToolCall {
            id: "tool-large-read".to_string(),
            name: "file_read".to_string(),
            arguments: json!({ "path": "large.txt", "maxBytes": 8 }),
        },
    );
    assert_eq!(large["raw"]["truncated"], true);
    assert!(large["raw"]["artifactRef"].is_object());

    let outside_write = tool_file_write(
        &session_id,
        &turn_id,
        "tool-outside-write",
        &json!({ "path": "../outside.txt", "content": "no", "overwrite": true }),
    )
    .expect_err("outside write should fail");
    assert_eq!(outside_write.code, "permission_denied");

    let edit = tool_file_edit(
        &session_id,
        &turn_id,
        "tool-edit",
        &json!({ "path": "src/main.rs", "oldString": "beta", "newString": "gamma" }),
    )
    .expect("edit file");
    assert!(edit.raw["diffArtifactRef"].is_object());
    assert!(
        fs::read_to_string(temp.path().join("src").join("main.rs"))
            .expect("read edited")
            .contains("gamma")
    );

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
        fs::read_to_string(temp.path().join("second.txt")).expect("read second"),
        "TWO"
    );

    let patch = tool_apply_patch(
        &session_id,
        &turn_id,
        "tool-patch",
        &json!({
            "operations": [
                { "op": "add", "path": "added.txt", "content": "added" },
                { "op": "update", "path": "first.txt", "oldString": "ONE", "newString": "uno" },
                { "op": "move", "path": "added.txt", "newPath": "moved.txt" },
                { "op": "delete", "path": "delete.txt" }
            ]
        }),
    )
    .expect("apply patch");
    assert!(patch.raw["diffArtifactRef"].is_object());
    assert!(temp.path().join("moved.txt").exists());
    assert!(!temp.path().join("delete.txt").exists());
}

#[test]
fn native_shell_code_lsp_and_budget_guards_are_structured() {
    let backend = LyraAgentBackend;
    let temp = tempfile::tempdir().expect("tempdir");
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

    let failed = tool_shell_run(&session_id, &json!({ "command": "false" }))
        .expect("failed command still returns structured output");
    assert_eq!(failed.raw["success"], false);
    assert_eq!(failed.raw["exitCode"].as_i64(), Some(1));

    let timed_out = tool_shell_run(
        &session_id,
        &json!({ "command": "sleep 1", "timeoutMs": 1 }),
    )
    .expect("timeout returns structured output");
    assert_eq!(timed_out.raw["timedOut"], true);

    let truncated = tool_shell_run(
        &session_id,
        &json!({ "command": "printf 1234567890", "maxOutputBytes": 4 }),
    )
    .expect("truncated output");
    assert_eq!(truncated.raw["stdout"], "1234");
    assert_eq!(truncated.raw["stdoutTruncated"], true);

    let dangerous =
        tool_shell_run(&session_id, &json!({ "command": "rm file.txt" })).expect_err("risk");
    assert_eq!(dangerous.code, "permission_required");

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
            ModelToolCall {
                id: "tool-denied".to_string(),
                name: "file_write".to_string(),
                arguments: json!({
                    "path": "denied.txt",
                    "content": "nope",
                    "overwrite": true
                }),
            },
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
    assert!(!denied_path.exists());

    let allowed_turn_id = start_test_runtime_turn(&session_id);
    let allowed_session_id = session_id.clone();
    let allowed_handle = thread::spawn(move || {
        execute_model_tool(
            &allowed_session_id,
            &allowed_turn_id,
            &None,
            &Arc::new(AtomicBool::new(false)),
            ModelToolCall {
                id: "tool-allowed".to_string(),
                name: "file_write".to_string(),
                arguments: json!({
                    "path": "allowed.txt",
                    "content": "yes",
                    "overwrite": true
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
        .expect("allow permission");
    let allowed_output = allowed_handle.join().expect("join allowed");
    assert!(
        allowed_output["content"]
            .as_str()
            .unwrap()
            .contains("allowed.txt")
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
            ModelToolCall {
                id: "tool-shell-denied".to_string(),
                name: "shell_run".to_string(),
                arguments: json!({
                    "command": "rm denied-shell.txt",
                    "cwd": "."
                }),
            },
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
            ModelToolCall {
                id: "tool-shell-allowed".to_string(),
                name: "shell_run".to_string(),
                arguments: json!({
                    "command": "rm allowed-shell.txt",
                    "cwd": "."
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
        .expect("allow shell permission");
    let allowed_shell_output = allowed_shell_handle.join().expect("join allowed shell");
    assert_eq!(allowed_shell_output["raw"]["success"].as_bool(), Some(true));
    assert!(!allowed_shell_path.exists());
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
}

#[test]
fn terminal_host_tools_apply_read_and_write_permission_policy() {
    assert_eq!(permission_risk("terminal", "list", &json!({})), None);
    assert_eq!(
        permission_risk("terminal", "read", &json!({ "sessionId": "terminal-1" })),
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
            ModelToolCall {
                id: "tool-clarify".to_string(),
                name: "ask_user".to_string(),
                arguments: json!({
                    "question": "Which target?",
                    "options": ["A", "B"],
                    "allowCustomAnswer": true
                }),
            },
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
            ModelToolCall {
                id: "tool-clarify-again".to_string(),
                name: "ask_user".to_string(),
                arguments: json!({
                    "question": "Which mode?",
                    "options": ["fast", "careful"],
                    "allowCustomAnswer": true
                }),
            },
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
            ModelToolCall {
                id: "tool-read-interrupted".to_string(),
                name: "lyra_lumen_read".to_string(),
                arguments: json!({ "tabId": "browser-tab-1", "targetMode": "live" }),
            },
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
            ModelToolCall {
                id: "tool-map-auth".to_string(),
                name: "lyra_lumen_map".to_string(),
                arguments: json!({ "tabId": "browser-tab-1", "targetMode": "isolated" }),
            },
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
