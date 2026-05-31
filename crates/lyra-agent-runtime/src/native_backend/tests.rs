use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
};

fn read_http_json_body(stream: &mut std::net::TcpStream) -> Value {
    let mut headers = Vec::new();
    let mut byte = [0_u8; 1];
    while !headers.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("read header byte");
        headers.push(byte[0]);
    }
    let header_text = String::from_utf8_lossy(&headers);
    let content_length = header_text
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .expect("content length");
    let mut body = vec![0_u8; content_length];
    stream.read_exact(&mut body).expect("read request body");
    serde_json::from_slice(&body).expect("json request body")
}

fn model_tool_names(request: &Value) -> Vec<String> {
    request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

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

fn start_test_runtime_turn(session_id: &str) -> String {
    let turn_id = format!("turn-test-{}", Uuid::new_v4());
    let cancellation = Arc::new(AtomicBool::new(false));
    let mut state = state().lock().expect("state lock");
    let session = state.sessions.get_mut(session_id).expect("session");
    session.snapshot["turnStatus"] = Value::String("running".to_string());
    session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
    session.snapshot["follow"] = json!({ "running": true, "activity": "test" });
    session.runtime_turns.push(runtime_turn(
        &turn_id,
        session_id,
        "calling_model",
        None,
        None,
    ));
    state
        .active_cancellations
        .insert(turn_id.clone(), cancellation);
    turn_id
}

fn wait_for_pending_permission(session_id: &str) -> String {
    for _ in 0..200 {
        if let Some(id) = state().lock().ok().and_then(|state| {
            state
                .pending_permissions
                .values()
                .find(|request| request.session_id == session_id && request.allowed.is_none())
                .map(|request| request.id.clone())
        }) {
            return id;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("pending permission not observed")
}

fn wait_for_pending_clarification(session_id: &str) -> String {
    for _ in 0..200 {
        if let Some(id) = state().lock().ok().and_then(|state| {
            state
                .pending_clarifications
                .values()
                .find(|request| request.session_id == session_id && request.answer.is_none())
                .map(|request| request.id.clone())
        }) {
            return id;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("pending clarification not observed")
}

fn serve_http_once(status_line: &str, content_type: &str, body: &str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let address = listener.local_addr().expect("local address");
    let status_line = status_line.to_string();
    let content_type = content_type.to_string();
    let body = body.to_string();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local request");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        let response = format!(
            "{status_line}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("write local response");
    });
    format!("http://{address}/index.html")
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
        "project_search",
        "code_search_text",
        "code_search_symbol",
        "code_graph_expand",
        "lsp_query",
        "web_search",
        "web_fetch",
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
fn native_tool_surface_dispatches_file_search_shell_and_todo() {
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

#[test]
fn memory_tool_persists_shared_memory_for_future_turns() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Memory Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-memory".to_string(),
            name: "memory_remember".to_string(),
            arguments: json!({
                "scope": "global",
                "category": "user_profile",
                "fact": "The user prefers to be called Xu Yuanhao."
            }),
        },
    );

    assert!(output["content"].as_str().unwrap().contains("Xu Yuanhao"));
    let request = build_model_request(&session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("Xu Yuanhao"));
}

#[test]
fn long_term_memory_crud_list_link_forget_and_audit() {
    let backend = LyraAgentBackend;
    let marker = Uuid::new_v4().to_string();
    let first = backend
        .call_agent_method(
            "agent.memory.longterm.create",
            json!({
                "scope": "global",
                "category": "preference",
                "fact": format!("phase one memory preference {marker}"),
                "confidence": 1.0,
                "sourceType": "user_declaration",
                "tags": ["phase-one", marker.clone()]
            }),
        )
        .expect("create first memory");
    let first_id = first["record"]["id"]
        .as_str()
        .expect("first id")
        .to_string();
    let second = backend
        .call_agent_method(
            "agent.memory.longterm.create",
            json!({
                "scope": "project",
                "category": "project",
                "fact": format!("phase one project memory {marker}"),
                "confidence": 0.9,
                "sourceType": "project_fact"
            }),
        )
        .expect("create second memory");
    let second_id = second["record"]["id"]
        .as_str()
        .expect("second id")
        .to_string();

    let search = backend
        .call_agent_method(
            "agent.memory.longterm.search",
            json!({ "query": marker, "limit": 10 }),
        )
        .expect("search memories");
    assert!(search["records"].as_array().expect("records").len() >= 2);
    assert_eq!(search["records"][0]["accessCount"], 1);

    let updated = backend
        .call_agent_method(
            "agent.memory.longterm.update",
            json!({
                "id": first_id,
                "fact": format!("phase one updated preference {marker}"),
                "status": "superseded",
                "supersededBy": second_id,
            }),
        )
        .expect("update memory");
    assert_eq!(updated["record"]["status"], "superseded");

    let linked = backend
        .call_agent_method(
            "agent.memory.longterm.link",
            json!({
                "sourceId": updated["record"]["id"],
                "targetId": second["record"]["id"],
                "relation": "related_to",
                "confidence": 0.8,
            }),
        )
        .expect("link memories");
    assert_eq!(linked["relation"]["relation"], "related_to");

    let listed = backend
        .call_agent_method(
            "agent.memory.longterm.list",
            json!({ "includeArchived": true, "query": marker, "limit": 20 }),
        )
        .expect("list memories");
    assert!(listed["records"].as_array().expect("records").len() >= 2);

    let forgotten = backend
        .call_agent_method(
            "agent.memory.longterm.forget",
            json!({ "id": second_id, "mode": "archive", "reason": "test cleanup" }),
        )
        .expect("forget memory");
    assert_eq!(forgotten["result"]["mode"], "archive");

    let audit = backend
        .call_agent_method("agent.memory.audit", json!({}))
        .expect("memory audit");
    assert!(
        audit
            .pointer("/longTermMemory/counts/total")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            >= 2
    );
    assert!(
        audit
            .pointer("/longTermMemory/relations/byType/related_to")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            >= 1
    );

    let cleanup = backend
        .call_agent_method(
            "agent.memory.longterm.cleanupCandidates",
            json!({ "limit": 500 }),
        )
        .expect("cleanup candidates");
    assert!(cleanup["candidates"].as_array().is_some_and(|candidates| {
        candidates.iter().any(|candidate| {
            candidate.pointer("/record/id").and_then(Value::as_str)
                == updated.pointer("/record/id").and_then(Value::as_str)
        })
    }));

    let batch_forget = backend
        .call_agent_method(
            "agent.memory.longterm.forget",
            json!({
                "ids": [updated["record"]["id"].as_str().expect("updated id")],
                "mode": "archive",
                "reason": "batch cleanup test"
            }),
        )
        .expect("batch forget");
    assert_eq!(batch_forget.pointer("/result/count"), Some(&json!(1)));
}

#[test]
fn memory_tool_activity_does_not_commit_memory_events_as_chat_messages() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Memory Activity Isolation" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let marker = Uuid::new_v4().to_string();

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        ModelToolCall {
            id: "tool-memory-isolation".to_string(),
            name: "memory_remember".to_string(),
            arguments: json!({
                "scope": "global",
                "category": "other",
                "fact": format!("memory isolation fact {marker}")
            }),
        },
    );

    assert!(output["content"].as_str().unwrap().contains(&marker));
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert!(
        session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    );
    assert!(
        session
            .snapshot
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| tool["name"] == "memory"))
    );
}

#[test]
fn legacy_shared_memory_migration_is_idempotent_and_state_json_drops_array() {
    let temp = tempfile::tempdir().expect("tempdir");
    let timestamp = now();
    let legacy = SharedMemoryRecord {
        id: format!("legacy-memory-{}", Uuid::new_v4()),
        scope: "global".to_string(),
        content: json!({
            "fact": "legacy shared memory migrated",
            "category": "user_profile",
            "source": "user_declaration"
        }),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        status: "active".to_string(),
        priority: 82,
        injection_count: 7,
        last_injected_at: Some(now()),
        category: Some("user_profile".to_string()),
        confidence: Some(1.0),
        source: Some("user_declaration".to_string()),
    };

    let first =
        migrate_legacy_shared_memory(temp.path(), std::slice::from_ref(&legacy)).expect("migrate");
    let second = migrate_legacy_shared_memory(temp.path(), std::slice::from_ref(&legacy))
        .expect("migrate again");
    assert_eq!(first["inserted"], 1);
    assert_eq!(second["inserted"], 0);

    let records = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some("legacy shared memory migrated".to_string()),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("list migrated memory");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].access_count, 7);

    let state_file = NativeStateFile {
        active_session_id: None,
        config: NativeConfig::default(),
        legacy_shared_memory: vec![legacy],
        active_skills: HashSet::new(),
        overnight_runs: HashMap::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
        goals: HashMap::new(),
        focused_goal_id: None,
    };
    let serialized = serde_json::to_string(&state_file).expect("state json");
    assert!(!serialized.contains("sharedMemory"));
}

#[test]
fn memory_search_uses_hybrid_ranker_and_updates_access_stats() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-search-{}", Uuid::new_v4());
    let created = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("preference".to_string()),
            fact: Some(format!(
                "The user prefers concise Chinese summaries for Lyra architecture reviews {marker}"
            )),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            tags: Some(vec!["phase2".to_string(), marker.clone()]),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");

    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute("DELETE FROM memory_fts WHERE memory_id = ?1", [&created.id])
        .expect("delete fts");
    conn.execute(
        "DELETE FROM memory_embeddings WHERE memory_id = ?1",
        [&created.id],
    )
    .expect("delete embedding");
    let rebuilt = rebuild_long_term_memory_index(temp.path()).expect("rebuild index");
    assert_eq!(rebuilt["ftsRecords"], 1);

    let results = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(format!(
                "How should Lyra architecture review summaries be written for the user {marker}"
            )),
            explain: true,
            touch_access: true,
            access_type: "tool_search".to_string(),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search memory");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].record.id, created.id);
    assert_eq!(results[0].record.access_count, 1);
    assert!(results[0].breakdown.final_score > 0.0);
    assert!(
        results[0]
            .breakdown
            .matched_by
            .iter()
            .any(|source| source == "fts" || source == "vector" || source == "metadata")
    );

    let rendered = ranked_memory_json(&results[0], true);
    assert!(rendered["score"].as_f64().unwrap_or(0.0) > 0.0);
    assert!(rendered.pointer("/scoreBreakdown/finalScore").is_some());
    assert!(rendered.pointer("/scoreBreakdown/decayPenalty").is_some());
}

#[test]
fn memory_decay_ranks_frequent_user_declarations_above_stale_low_confidence_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-decay-{}", Uuid::new_v4());
    let stale = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("other".to_string()),
            fact: Some(format!("temporary inferred operation note {marker}")),
            confidence: Some(0.42),
            source_type: Some("agent_inference".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create stale memory");
    let durable = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("user_profile".to_string()),
            fact: Some(format!("durable user declaration operation note {marker}")),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create durable memory");
    let old_timestamp =
        (Utc::now() - chrono::Duration::days(180)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute(
        "UPDATE memories SET updated_at = ?2, access_count = 0, last_accessed_at = NULL WHERE id = ?1",
        rusqlite::params![stale.id, old_timestamp],
    )
    .expect("age stale memory");
    conn.execute(
        "UPDATE memories SET updated_at = ?2, access_count = 50, last_accessed_at = ?2 WHERE id = ?1",
        rusqlite::params![durable.id, old_timestamp],
    )
    .expect("age durable memory");

    let results = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker.clone()),
            explain: true,
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search memory");
    let durable_rank = results
        .iter()
        .position(|entry| entry.record.id == durable.id)
        .expect("durable result");
    let stale_rank = results
        .iter()
        .position(|entry| entry.record.id == stale.id)
        .expect("stale result");
    assert!(durable_rank < stale_rank);
    assert!(
        results[stale_rank].breakdown.decay_penalty > results[durable_rank].breakdown.decay_penalty
    );

    let candidates =
        cleanup_long_term_memory_candidates(temp.path(), 10).expect("cleanup candidates");
    assert!(candidates.iter().any(|candidate| {
        candidate.pointer("/record/id").and_then(Value::as_str) == Some(stale.id.as_str())
            && candidate["reasons"]
                .as_array()
                .is_some_and(|reasons| reasons.iter().any(|reason| reason == "low_confidence"))
    }));
}

#[test]
fn memory_graph_include_related_adds_one_hop_related_records_without_loops() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-graph-{}", Uuid::new_v4());
    let seed = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("project".to_string()),
            category: Some("project".to_string()),
            fact: Some(format!("Lyra browser capability decision seed {marker}")),
            confidence: Some(0.95),
            source_type: Some("project_fact".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create seed memory");
    let related = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("project".to_string()),
            category: Some("instruction".to_string()),
            fact: Some(
                "Use visible follow mode when browser automation is user-facing".to_string(),
            ),
            confidence: Some(0.9),
            source_type: Some("project_fact".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create related memory");
    link_long_term_memory(temp.path(), &seed.id, &related.id, "supports", 0.9)
        .expect("link seed to related");
    link_long_term_memory(temp.path(), &related.id, &seed.id, "related_to", 0.9)
        .expect("link related to seed");
    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute("DELETE FROM memory_embeddings", [])
        .expect("disable vector rows for graph assertion");

    let without_related = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker.clone()),
            include_related: false,
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search without related");
    assert!(
        without_related
            .iter()
            .any(|entry| entry.record.id == seed.id)
    );
    if let Some(related_hit) = without_related
        .iter()
        .find(|entry| entry.record.id == related.id)
    {
        assert_eq!(related_hit.breakdown.graph_boost, 0.0);
        assert!(
            !related_hit
                .breakdown
                .matched_by
                .iter()
                .any(|source| source == "graph")
        );
    }

    let with_related = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker),
            include_related: true,
            explain: true,
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search with related");
    let related_hit = with_related
        .iter()
        .find(|entry| entry.record.id == related.id)
        .expect("related memory returned");
    assert!(related_hit.breakdown.graph_boost > 0.0);
    assert!(
        related_hit
            .breakdown
            .matched_by
            .iter()
            .any(|source| source == "graph")
    );
    assert_eq!(
        with_related
            .iter()
            .filter(|entry| entry.record.id == seed.id)
            .count(),
        1
    );
}

#[test]
fn memory_search_uses_fts_and_lazily_repairs_missing_embedding_rows() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-fts-only-{}", Uuid::new_v4());
    let created = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("instruction".to_string()),
            fact: Some(format!("FTS fallback must retrieve this memory {marker}")),
            confidence: Some(0.9),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute("DELETE FROM memory_embeddings", [])
        .expect("remove embeddings");

    let results = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker),
            explain: true,
            limit: 5,
            ..MemoryQuery::default()
        },
    )
    .expect("fts-only search");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].record.id, created.id);
    assert!(results[0].breakdown.fts_score > 0.0);
    assert!(results[0].breakdown.vector_score >= 0.0);
    let repaired_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_embeddings", [], |row| {
            row.get(0)
        })
        .expect("embedding count");
    assert_eq!(repaired_count, 1);
}

#[test]
fn memory_extraction_creates_auto_applied_declarations_and_pending_inferences() {
    let temp = tempfile::tempdir().expect("tempdir");
    let session_id = format!("session-{}", Uuid::new_v4());
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let result = run_post_turn_memory_extraction(
        temp.path(),
        &session_id,
        &turn_id,
        "我的名字是徐远豪。以后用英文回复。",
        Some("I infer the user may be reviewing memory autonomy behavior."),
    )
    .expect("extract memories");
    assert!(
        result["candidates"]
            .as_array()
            .is_some_and(|items| items.len() >= 3)
    );

    let auto_applied =
        list_memory_candidates(temp.path(), Some("auto_applied"), 20).expect("auto candidates");
    assert!(
        auto_applied
            .iter()
            .any(|candidate| candidate.fact.contains("徐远豪"))
    );
    assert!(auto_applied.iter().any(|candidate| {
        candidate.content.get("kind").and_then(Value::as_str) == Some("language_preference")
    }));
    let pending =
        list_memory_candidates(temp.path(), Some("pending"), 20).expect("pending candidates");
    assert!(pending.iter().any(|candidate| {
        candidate.source_type == "agent_inference" && candidate.confidence < 0.7
    }));

    let memories = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some("徐远豪 英文".to_string()),
            include_archived: true,
            limit: 20,
            ..MemoryQuery::default()
        },
    )
    .expect("list memories");
    assert!(memories.iter().any(|record| record.fact.contains("徐远豪")));
    assert!(memories.iter().all(|record| {
        record.source_type != "agent_inference"
            || record.tags.iter().any(|tag| tag == "auto_extracted")
    }));
}

#[test]
fn memory_conflict_auto_supersedes_low_confidence_and_confirms_high_confidence() {
    let temp = tempfile::tempdir().expect("tempdir");
    let low = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("preference".to_string()),
            fact: Some("用户偏好使用中文回复".to_string()),
            content: Some(json!({ "kind": "language_preference", "language": "中文" })),
            confidence: Some(0.6),
            source_type: Some("agent_inference".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create low confidence memory");
    let session_id = format!("session-{}", Uuid::new_v4());
    let turn_id = format!("turn-{}", Uuid::new_v4());
    run_post_turn_memory_extraction(temp.path(), &session_id, &turn_id, "以后用英文回复。", None)
        .expect("extract conflict");
    let superseded = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            status: Some("superseded".to_string()),
            include_archived: true,
            limit: 20,
            ..MemoryQuery::default()
        },
    )
    .expect("list superseded");
    assert!(superseded.iter().any(|record| record.id == low.id));

    let temp = tempfile::tempdir().expect("tempdir");
    let high = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("preference".to_string()),
            fact: Some("用户偏好使用中文回复".to_string()),
            content: Some(json!({ "kind": "language_preference", "language": "中文" })),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create high confidence memory");
    {
        let mut state = state().lock().expect("state lock");
        state.config.proactive_enabled = true;
        state
            .config
            .proactive_disabled_triggers
            .remove("memory_conflict");
    }
    run_post_turn_memory_extraction(temp.path(), &session_id, &turn_id, "以后用英文回复。", None)
        .expect("extract high conflict");
    let candidates = list_memory_candidates(temp.path(), Some("needs_user_confirmation"), 20)
        .expect("review candidates");
    let candidate = candidates
        .iter()
        .find(|candidate| candidate.conflict_with.as_deref() == Some(high.id.as_str()))
        .expect("conflict candidate");
    let proactive =
        list_proactive_events(temp.path(), Some("pending"), 20).expect("proactive events");
    assert!(proactive.iter().any(|event| {
        event.trigger_type == "memory_conflict"
            && event.source.get("candidateId").and_then(Value::as_str)
                == Some(candidate.id.as_str())
    }));
    let applied = apply_memory_candidate(temp.path(), &candidate.id).expect("apply candidate");
    assert_eq!(applied.pointer("/result/action"), Some(&json!("supersede")));
}

#[test]
fn memory_explain_injection_records_ranked_long_term_memory_reasons() {
    let temp = tempfile::tempdir().expect("tempdir");
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("project".to_string()),
            fact: Some("Lyra memory injection should be explainable".to_string()),
            confidence: Some(0.9),
            source_type: Some("project_fact".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let ranked = select_ranked_long_term_memory_for_injection(
        temp.path(),
        "explain Lyra memory injection",
        None,
        8,
    )
    .expect("rank injection");
    record_memory_injection(
        temp.path(),
        "session-explain",
        Some("turn-explain"),
        Some("explain Lyra memory injection"),
        &ranked,
    )
    .expect("record injection");
    let explanation =
        explain_memory_injection(temp.path(), "session-explain", Some("turn-explain"))
            .expect("explain injection");
    assert!(
        explanation["selected"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    );
    assert!(
        explanation
            .pointer("/selected/0/scoreBreakdown/finalScore")
            .is_some()
    );
}

#[test]
fn proactive_events_are_structured_dismissible_and_open_sessions_without_chat_pollution() {
    let backend = LyraAgentBackend;
    let root = state().lock().expect("state lock").root.clone();
    let event = create_proactive_event(
        &root,
        "memory_conflict",
        "Review memory conflict",
        "A memory candidate needs confirmation.",
        json!({ "candidateId": "candidate-test" }),
        "draft_message",
        None,
    )
    .expect("create proactive event");
    let listed = backend
        .call_agent_method("agent.proactive.list", json!({ "status": "pending" }))
        .expect("list proactive");
    assert!(listed["events"].as_array().is_some_and(|events| {
        events
            .iter()
            .any(|item| item.get("id").and_then(Value::as_str) == Some(event.id.as_str()))
    }));
    let opened = backend
        .call_agent_method("agent.proactive.openSession", json!({ "id": event.id }))
        .expect("open proactive session");
    assert_eq!(
        opened.pointer("/snapshot/sessionKind"),
        Some(&json!("proactive"))
    );
    assert!(
        opened
            .pointer("/snapshot/messages")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    );
    assert_eq!(
        opened.pointer("/snapshot/proactiveMessages/0/role"),
        Some(&json!("proactive"))
    );

    let event = create_proactive_event(
        &root,
        "goal_due",
        "Goal due",
        "A goal is due.",
        json!({ "goalId": "goal-test" }),
        "notification_only",
        None,
    )
    .expect("create dismissible proactive event");
    let dismissed = backend
        .call_agent_method(
            "agent.proactive.dismiss",
            json!({ "id": event.id, "reason": "test complete" }),
        )
        .expect("dismiss proactive");
    assert_eq!(dismissed["status"], "dismissed");
}

#[test]
fn shared_memory_injection_rotates_records() {
    let now = now();
    let mut records = (0..6)
        .map(|index| LongTermMemoryRecord {
            id: format!("memory-{index}"),
            scope: "global".to_string(),
            category: "other".to_string(),
            fact: format!("rotation fact {index}"),
            content: json!({ "fact": format!("rotation fact {index}") }),
            confidence: 1.0,
            source_type: "agent_inference".to_string(),
            source_ref: Some("test".to_string()),
            created_at: now.clone(),
            updated_at: now.clone(),
            status: "active".to_string(),
            priority: 40,
            last_accessed_at: None,
            access_count: 0,
            tags: Vec::new(),
            related_to: Vec::new(),
            expires_at: None,
            supersedes: None,
            superseded_by: None,
        })
        .collect::<Vec<_>>();

    let first = select_shared_memory_for_injection(&mut records, "rotation", None, 3);
    let second = select_shared_memory_for_injection(&mut records, "rotation", None, 3);
    let first_ids = first
        .iter()
        .map(|record| record.id.as_str())
        .collect::<Vec<_>>();
    let second_ids = second
        .iter()
        .map(|record| record.id.as_str())
        .collect::<Vec<_>>();

    assert_ne!(first_ids, second_ids);
    assert!(
        records
            .iter()
            .take(3)
            .all(|record| record.access_count == 1)
    );
    assert!(
        records
            .iter()
            .skip(3)
            .all(|record| record.access_count == 1)
    );
}

#[test]
fn tool_retention_prunes_only_old_low_value_raw_payloads() {
    let mut session = new_session(Some("Retention Test".to_string()), None, "normal");
    let tools = (0..26)
        .map(|index| {
            let is_write = index == 0;
            json!({
                "id": format!("tool-{index}"),
                "name": if is_write { "file_write" } else { "file_read" },
                "label": if is_write { "Wrote file" } else { "Read file" },
                "status": "completed",
                "input": { "path": format!("file-{index}.txt") },
                "output": {
                    "content": "x".repeat(2_000),
                    "raw": {
                        "path": format!("file-{index}.txt"),
                        "data": "y".repeat(8_000)
                    }
                },
                "startedAt": "2026-05-30T00:00:00.000Z",
                "finishedAt": "2026-05-30T00:00:01.000Z"
            })
        })
        .collect::<Vec<_>>();
    session.snapshot["tools"] = Value::Array(tools);

    let metrics = prune_transient_tool_outputs(&mut session);
    let tools = session.snapshot["tools"].as_array().expect("tools");

    assert_eq!(metrics["pruned"], 1);
    assert!(tools[0].pointer("/output/raw/retention").is_none());
    assert_eq!(
        tools[1]
            .pointer("/output/raw/retention/policy")
            .and_then(Value::as_str),
        Some("old_transient_tool_raw_pruned")
    );
    assert!(tools[25].pointer("/output/raw/retention").is_none());
}

#[test]
fn streaming_parser_emits_delta_and_collects_tool_call() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Stream Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let cancellation = Arc::new(AtomicBool::new(false));
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let events_for_callback = events.clone();
    backend.register_event_callback(Arc::new(move |event| {
        events_for_callback
            .lock()
            .expect("events lock")
            .push(serde_json::from_str(&event).expect("event json"));
    }));
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "streaming_model",
            None,
            None,
        ));
        state
            .active_cancellations
            .insert(turn_id.clone(), cancellation.clone());
    }

    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"workbench_list_tabs\",\"arguments\":\"{\\\"scope\\\"\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\":\\\"all\\\"}\"}}]}}]}\n\n",
        "data: [DONE]\n\n",
    );
    let reply = parse_streaming_response(
        BufReader::new(stream.as_bytes()),
        &session_id,
        &turn_id,
        &cancellation,
        &model_tools(false),
    )
    .expect("streaming reply");

    assert_eq!(reply.content.as_deref(), Some("Hello"));
    assert_eq!(reply.tool_calls[0].id, "call-1");
    assert_eq!(reply.tool_calls[0].name, "workbench_list_tabs");
    assert_eq!(reply.tool_calls[0].arguments["scope"], "all");
    let event_kinds = events
        .lock()
        .expect("events lock")
        .iter()
        .filter(|event| event.get("sessionId").and_then(Value::as_str) == Some(&session_id))
        .map(|event| event["kind"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    assert_eq!(&event_kinds[..2], ["messageCommitted", "messageDelta"]);
    backend.clear_event_callback();
}

#[test]
fn textual_tool_call_is_normalized_before_assistant_text_commit() {
    let mut reply = ModelReply {
        content: Some(
            "好的，我来帮你在工作区打开。\n\n[Tool call: software_invoke_capability({\"softwareId\":\"browser-search\",\"capabilityId\":\"browser-search.openUrl\",\"input\":{\"url\":\"https://vimeo.com/1148303712\"}})]"
                .to_string(),
        ),
        tool_calls: Vec::new(),
        ui_message_id: None,
    };

    normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect("normalize provider reply");

    assert_eq!(
        reply.content.as_deref(),
        Some("好的，我来帮你在工作区打开。")
    );
    assert_eq!(reply.tool_calls.len(), 1);
    assert_eq!(reply.tool_calls[0].name, "software_invoke_capability");
    assert_eq!(
        reply.tool_calls[0]
            .arguments
            .pointer("/input/url")
            .and_then(Value::as_str),
        Some("https://vimeo.com/1148303712")
    );
}

#[test]
fn streaming_textual_tool_call_is_not_emitted_as_message_delta() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Stream Guard Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let events_for_callback = events.clone();
    backend.register_event_callback(Arc::new(move |event| {
        events_for_callback
            .lock()
            .expect("events lock")
            .push(serde_json::from_str(&event).expect("event json"));
    }));
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"好的，我来打开。\\n\\n\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"[Tool call: software_invoke_capability({\\\"softwareId\\\":\\\"browser-search\\\",\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"\\\"capabilityId\\\":\\\"browser-search.openUrl\\\",\\\"input\\\":{\\\"url\\\":\\\"https://vimeo.com/1148303712\\\"}})]\"}}]}\n\n",
        "data: [DONE]\n\n",
    );

    let reply = parse_streaming_response(
        BufReader::new(stream.as_bytes()),
        &session_id,
        &turn_id,
        &cancellation,
        &model_tools(false),
    )
    .expect("streaming reply");

    assert_eq!(reply.content.as_deref(), Some("好的，我来打开。"));
    assert_eq!(reply.tool_calls.len(), 1);
    assert_eq!(reply.tool_calls[0].name, "software_invoke_capability");
    let emitted_text = events
        .lock()
        .expect("events lock")
        .iter()
        .filter_map(|event| event.get("delta").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    assert_eq!(emitted_text, "好的，我来打开。");
    assert!(!emitted_text.contains("[Tool call:"));
    backend.clear_event_callback();
}

#[test]
fn streaming_parser_handles_usage_only_chunk_and_repairs_tool_call() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Provider Conformance Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let tools = vec![function_tool(
        "workbench_list_tabs",
        "List tabs",
        json!({ "type": "object", "properties": {} }),
    )];
    let stream = concat!(
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":0}}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"null\",\"function\":{\"name\":\"WORKBENCH_LIST_TABS\",\"arguments\":\"{}\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    let reply = parse_streaming_response(
        BufReader::new(stream.as_bytes()),
        &session_id,
        &turn_id,
        &cancellation,
        &tools,
    )
    .expect("streaming reply");

    assert_eq!(reply.content, None);
    assert_eq!(reply.tool_calls.len(), 1);
    assert_eq!(reply.tool_calls[0].name, "workbench_list_tabs");
    assert!(reply.tool_calls[0].id.starts_with("tool-"));
    assert_eq!(reply.tool_calls[0].arguments, json!({}));
}

#[test]
fn streaming_parser_rejects_reasoning_only_reply_for_retry() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Reasoning Only Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"I should answer.\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    let error = parse_streaming_response(
        BufReader::new(stream.as_bytes()),
        &session_id,
        &turn_id,
        &cancellation,
        &[],
    )
    .expect_err("reasoning-only reply should be retryable empty response");

    assert!(is_empty_model_reply_error(&error));
    assert!(
        error
            .to_string()
            .contains("reasoning without final assistant")
    );
}

#[test]
fn provider_transport_errors_are_retryable_without_api_key_misclassification() {
    let transport = AgentRuntimeError::Core("request or response body error".to_string());
    assert!(is_provider_transport_error(&transport));
    assert!(is_retryable_provider_error(&transport));
    assert!(!is_provider_configuration_error(&transport));

    let sending = AgentRuntimeError::Core(
        "error sending request for url (https://example.test/v1/chat/completions)".to_string(),
    );
    assert!(is_provider_transport_error(&sending));
    assert!(is_retryable_provider_error(&sending));

    let auth = AgentRuntimeError::Core("provider request failed with status 401".to_string());
    assert!(is_provider_configuration_error(&auth));
    assert!(!is_provider_transport_error(&auth));
}

#[test]
fn macos_proxy_parser_reports_system_proxy_without_secret_values() {
    let status = parse_macos_scutil_proxy(
        r#"<dictionary> {
  HTTPEnable : 1
  HTTPPort : 10808
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 10808
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
}"#,
    );
    assert_eq!(status["source"], "macos-scutil");
    assert_eq!(status["active"], true);
    assert_eq!(status["http"]["host"], "127.0.0.1");
    assert_eq!(status["https"]["port"], 10808);
}

#[test]
fn streaming_transport_error_falls_back_to_non_streaming() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Provider Transport Fallback Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("accept streaming provider request");
        let _ = read_http_json_body(&mut stream);
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n";
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len() + 4096,
            body
        )
        .expect("write truncated stream");
        drop(stream);

        let (mut stream, _) = listener.accept().expect("accept fallback provider request");
        let request_body = read_http_json_body(&mut stream);
        assert_eq!(request_body["stream"], false);
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"Recovered after transport error."}}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write fallback json");
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: true,
        }],
    };

    let reply = call_model_once(
        &session_id,
        &turn_id,
        &provider,
        "test-model",
        &[json!({ "role": "user", "content": "hello" })],
        &[],
        &model_capabilities(&provider, "test-model"),
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("provider reply");

    assert_eq!(
        reply.content.as_deref(),
        Some("Recovered after transport error.")
    );
    server.join().expect("server join");
}

#[test]
fn non_stream_tool_call_parser_preserves_invalid_arguments_as_evidence() {
    let allowed_tool_names = HashSet::from(["workbench_list_tabs".to_string()]);
    let parsed = parse_model_tool_call(
        &json!({
            "id": "",
            "function": {
                "name": "WorkBench_List_Tabs",
                "arguments": "{\"scope\":"
            }
        }),
        &allowed_tool_names,
    )
    .expect("tool call");

    assert_eq!(parsed.name, "workbench_list_tabs");
    assert!(parsed.id.starts_with("tool-"));
    assert_eq!(parsed.arguments["rawArguments"], "{\"scope\":");
    assert!(parsed.arguments["parseError"].as_str().is_some());
}

#[test]
fn empty_streaming_reply_retries_non_streaming_before_failing_turn() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Provider Retry Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer).expect("read request");
            if index == 0 {
                let body = "data: [DONE]\n\n";
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .expect("write empty stream");
            } else {
                let body = r#"{"choices":[{"message":{"role":"assistant","content":"Recovered without streaming."}}]}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .expect("write json");
            }
        }
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: true,
        }],
    };

    let reply = call_model_once(
        &session_id,
        &turn_id,
        &provider,
        "test-model",
        &[json!({ "role": "user", "content": "hello" })],
        &[],
        &model_capabilities(&provider, "test-model"),
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("provider reply");

    assert_eq!(
        reply.content.as_deref(),
        Some("Recovered without streaming.")
    );
    server.join().expect("server join");
}

#[test]
fn model_loop_has_no_fixed_tool_round_cap() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "No Fixed Tool Round Cap Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        for index in 0..41 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let _ = read_http_json_body(&mut stream);
            let body = if index < 40 {
                let arguments = json!({
                    "scope": "session",
                    "category": "test",
                    "fact": format!("tool evidence {index}")
                })
                .to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": format!("call-{index}"),
                                "type": "function",
                                "function": {
                                    "name": "memory_remember",
                                    "arguments": arguments
                                }
                            }]
                        }
                    }]
                })
                .to_string()
            } else {
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "Completed after forty tool rounds."
                        }
                    }]
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        }
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "keep working" })],
        tools: vec![function_tool(
            "memory_remember",
            "Remember a fact.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "category": { "type": "string" },
                    "fact": { "type": "string" }
                },
                "required": ["fact"]
            }),
        )],
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(
        &session_id,
        &turn_id,
        request,
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Completed after forty tool rounds.")
    );
    finish_turn(&session_id, &turn_id, "finished", result.final_text, None);
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    let messages = read["messages"].as_array().expect("messages");
    assert!(messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("assistant")
            && message
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| text.contains("Completed after forty tool rounds."))
    }));
    server.join().expect("server join");
}

#[test]
fn model_loop_requires_structured_finish_before_any_tool_result() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Structured Finish Guard Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send captured request");
            let body = match index {
                0 => {
                    json!({
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": "好的，我帮你打开QQ空间。"
                            }
                        }]
                    })
                    .to_string()
                }
                _ => {
                    json!({
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "id": "finish-1",
                                    "type": "function",
                                    "function": {
                                        "name": "lyra_turn_finish",
                                        "arguments": "{\"status\":\"blocked\",\"finalText\":\"我还没有调用浏览器工具，不能确认已经打开QQ空间。\"}"
                                    }
                                }]
                            }
                        }]
                    })
                    .to_string()
                }
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        }
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "帮我定位到QQ空间" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(
        &session_id,
        &turn_id,
        request,
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("我还没有调用浏览器工具，不能确认已经打开QQ空间。")
    );
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    assert!(requests[0]["tools"].as_array().is_some_and(|tools| {
        tools.iter().any(|tool| {
            tool.pointer("/function/name").and_then(Value::as_str) == Some("lyra_turn_finish")
        })
    }));
    assert_eq!(
        model_tool_names(&requests[1]),
        model_tool_names(&requests[0])
    );
    let retry_messages = requests[1]["messages"].as_array().expect("retry messages");
    assert!(retry_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("system")
            && message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| content.contains("lyra_turn_finish"))
    }));
    assert!(retry_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("assistant")
            && message.get("content").and_then(Value::as_str) == Some("好的，我帮你打开QQ空间。")
    }));
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert!(
        !serde_json::to_string(&read["messages"])
            .expect("messages json")
            .contains("好的，我帮你打开QQ空间。")
    );
}

#[test]
fn model_loop_requires_structured_finish_after_tool_result() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Post Tool Structured Finish Guard Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..3 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send captured request");
            let body = match index {
                0 => {
                    json!({
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "id": "remember-1",
                                    "type": "function",
                                    "function": {
                                        "name": "memory_remember",
                                        "arguments": "{\"scope\":\"session\",\"category\":\"task\",\"fact\":\"GitHub page has a Google login option.\"}"
                                    }
                                }]
                            }
                        }]
                    })
                    .to_string()
                }
                1 => {
                    json!({
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": "让我继续点击 Continue with Google。"
                            }
                        }]
                    })
                    .to_string()
                }
                _ => {
                    json!({
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "id": "finish-1",
                                    "type": "function",
                                    "function": {
                                        "name": "lyra_turn_finish",
                                        "arguments": "{\"status\":\"completed\",\"finalText\":\"已完成结构化收口。\"}"
                                    }
                                }]
                            }
                        }]
                    })
                    .to_string()
                }
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        }
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "点击 GitHub 的 Google 登录" })],
        tools: vec![
            function_tool(
                "memory_remember",
                "Remember a fact.",
                json!({
                    "type": "object",
                    "properties": {
                        "scope": { "type": "string" },
                        "category": { "type": "string" },
                        "fact": { "type": "string" }
                    },
                    "required": ["fact"]
                }),
            ),
            function_tool(
                LYRA_TURN_FINISH_TOOL,
                "Finish turn",
                json!({
                    "type": "object",
                    "properties": {
                        "status": { "type": "string" },
                        "finalText": { "type": "string" }
                    },
                    "required": ["status", "finalText"]
                }),
            ),
        ],
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(
        &session_id,
        &turn_id,
        request,
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("model loop");

    assert_eq!(result.final_text.as_deref(), Some("已完成结构化收口。"));
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 3);
    assert_eq!(
        model_tool_names(&requests[2]),
        vec![
            "memory_remember".to_string(),
            LYRA_TURN_FINISH_TOOL.to_string()
        ]
    );
    let retry_messages = requests[2]["messages"].as_array().expect("retry messages");
    assert!(retry_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("system")
            && message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| content.contains("plain text"))
    }));
    assert!(retry_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("assistant")
            && message.get("content").and_then(Value::as_str)
                == Some("让我继续点击 Continue with Google。")
    }));
}

#[test]
fn model_loop_attaches_lyra_artifact_images_as_vision_input() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Artifact Vision Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let agent_root = state()
        .lock()
        .expect("state lock")
        .root
        .parent()
        .expect("agent root")
        .to_path_buf();
    let lumen_dir = agent_root.join("lumen-evidence");
    fs::create_dir_all(&lumen_dir).expect("create lumen evidence dir");
    let lumen_path = lumen_dir.join("lumen-see-vision-browser-tab-1.png");
    fs::write(&lumen_path, b"\x89PNG\r\n\x1a\nlyra-vision-image").expect("write lumen image");
    let lumen_path = lumen_path
        .canonicalize()
        .expect("canonical lumen path")
        .display()
        .to_string();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send captured request");
            let body = if index == 0 {
                let arguments = json!({ "path": lumen_path }).to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": "read-artifact-1",
                                "type": "function",
                                "function": {
                                    "name": "artifact_read",
                                    "arguments": arguments
                                }
                            }]
                        }
                    }]
                })
                .to_string()
            } else {
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": "finish-vision",
                                "type": "function",
                                "function": {
                                    "name": "lyra_turn_finish",
                                    "arguments": "{\"status\":\"answered\",\"finalText\":\"我已经读取了截图。\"}"
                                }
                            }]
                        }
                    }]
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        }
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: false,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "读取这张截图" })],
        tools: vec![
            function_tool(
                "artifact_read",
                "Read Lyra artifact",
                json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
            ),
            function_tool(
                LYRA_TURN_FINISH_TOOL,
                "Finish turn",
                json!({
                    "type": "object",
                    "properties": {
                        "status": { "type": "string" },
                        "finalText": { "type": "string" }
                    }
                }),
            ),
        ],
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(
        &session_id,
        &turn_id,
        request,
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("model loop");

    assert_eq!(result.final_text.as_deref(), Some("我已经读取了截图。"));
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    let retry_messages = requests[1]["messages"].as_array().expect("retry messages");
    assert!(retry_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("user")
            && message
                .get("content")
                .and_then(Value::as_array)
                .is_some_and(|parts| {
                    parts.iter().any(|part| {
                        part.pointer("/image_url/url")
                            .and_then(Value::as_str)
                            .is_some_and(|url| url.starts_with("data:image/png;base64,"))
                    })
                })
    }));
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert!(
        !serde_json::to_string(&read["tools"])
            .expect("tools json")
            .contains("base64")
    );
}

#[test]
fn model_loop_progress_guard_synthesizes_repeated_identical_tool_rounds() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Progress Guard Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..6 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send captured request");
            let body = if index < 5 {
                let arguments = json!({
                    "scope": "session",
                    "category": "loop",
                    "fact": "same evidence"
                })
                .to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": format!("repeat-{index}"),
                                "type": "function",
                                "function": {
                                    "name": "memory_remember",
                                    "arguments": arguments
                                }
                            }]
                        }
                    }]
                })
                .to_string()
            } else {
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "Progress guard synthesized from repeated evidence."
                        }
                    }]
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        }
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        provider_type: "openai-compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "test-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "keep working" })],
        tools: vec![function_tool(
            "memory_remember",
            "Remember a fact.",
            json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string" },
                    "category": { "type": "string" },
                    "fact": { "type": "string" }
                },
                "required": ["fact"]
            }),
        )],
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(
        &session_id,
        &turn_id,
        request,
        &Arc::new(AtomicBool::new(false)),
    )
    .expect("model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Progress guard synthesized from repeated evidence.")
    );
    finish_turn(&session_id, &turn_id, "finished", result.final_text, None);
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 6);
    assert!(requests[0].get("tools").is_some());
    assert!(requests[5].get("tools").is_none());
    let final_messages = requests[5]["messages"].as_array().expect("messages");
    assert!(final_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("system")
            && message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| content.contains("dynamic progress guard"))
    }));
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    let messages = read["messages"].as_array().expect("messages");
    assert!(messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("assistant")
            && message
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| {
                    text.contains("Progress guard synthesized from repeated evidence.")
                })
    }));
}

#[test]
fn cancelled_turn_does_not_commit_late_assistant_message() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Cancel Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "calling_model",
            None,
            None,
        ));
        push_array(
            &mut session.snapshot,
            "tools",
            tool_activity(
                "tool-running",
                "lyra_lumen",
                "Read browser page",
                "running",
                json!({
                    "action": "read",
                    "runtimeCancellation": {
                        "kind": "lyra_runtime_turn",
                        "sessionId": session_id,
                        "turnId": turn_id
                    }
                }),
                None,
                &now(),
                None,
            ),
        );
    }

    let cancelled = backend
        .call_agent_method("agent.turn.cancel", json!({ "sessionId": session_id }))
        .expect("cancel turn");
    assert_eq!(cancelled["turnId"], turn_id);
    finish_turn(
        &session_id,
        &turn_id,
        "finished",
        Some("late text".to_string()),
        None,
    );

    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert!(
        !serde_json::to_string(&read["messages"])
            .expect("messages json")
            .contains("late text")
    );
    assert_eq!(read["tools"][0]["status"], "cancelled");
    assert!(read["tools"][0]["finishedAt"].as_str().is_some());
}

#[test]
fn soft_interrupt_marks_old_turn_and_keeps_new_user_intent() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Interrupt Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let old_turn_id = format!("turn-{}", Uuid::new_v4());
    {
        let mut state = state().lock().expect("state lock");
        let session = state.sessions.get_mut(&session_id).expect("session");
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(old_turn_id.clone());
        session.runtime_turns.push(runtime_turn(
            &old_turn_id,
            &session_id,
            "calling_model",
            None,
            None,
        ));
        state
            .active_cancellations
            .insert(old_turn_id.clone(), Arc::new(AtomicBool::new(false)));
    }

    let sent = backend
        .call_agent_method(
            "agent.turn.send",
            json!({ "sessionId": session_id, "text": "新的优先任务" }),
        )
        .expect("send interrupting turn");
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    let old_turn = state()
        .lock()
        .expect("state lock")
        .sessions
        .get(&session_id)
        .expect("session")
        .runtime_turns
        .iter()
        .find(|turn| turn["runtimeTurnId"] == old_turn_id)
        .cloned()
        .expect("old turn");

    assert_eq!(old_turn["state"], "interrupted");
    assert!(
        read["activeTurnId"].is_null() || read["activeTurnId"] == sent["turnId"],
        "new turn may still be running or may already have completed"
    );
    assert!(
        serde_json::to_string(&read["messages"])
            .expect("messages json")
            .contains("新的优先任务")
    );
}
