use super::*;

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
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"tool_fs_run\",\"arguments\":\"{\\\"path\\\":\\\"/tools/workbench/list_tabs\\\",\\\"args\\\":{\\\"scope\\\":\\\"all\\\"}}\"}}]}}]}\n\n",
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
    assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
    assert_eq!(
        reply.tool_calls[0].arguments["path"],
        "/tools/workbench/list_tabs"
    );
    assert_eq!(reply.tool_calls[0].arguments["args"]["scope"], "all");
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
fn textual_tool_call_is_rejected_before_assistant_text_commit() {
    let mut reply = ModelReply {
        content: Some(
            "好的，我来帮你在工作区打开。\n\n[Tool call: software_invoke_capability({\"softwareId\":\"browser-search\",\"capabilityId\":\"browser-search.openUrl\",\"input\":{\"url\":\"https://vimeo.com/1148303712\"}})]"
                .to_string(),
        ),
        tool_calls: Vec::new(),
        ui_message_id: None,
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect_err("textual tool calls must be rejected");
    assert!(error.to_string().contains("textual tool-call syntax"));
}

#[test]
fn streaming_textual_tool_call_is_rejected() {
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

    let error = parse_streaming_response(
        BufReader::new(stream.as_bytes()),
        &session_id,
        &turn_id,
        &cancellation,
        &model_tools(false),
    )
    .expect_err("streaming textual tool call must be rejected");

    assert!(error.to_string().contains("textual tool-call syntax"));
    let emitted_text = events
        .lock()
        .expect("events lock")
        .iter()
        .filter_map(|event| event.get("delta").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
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
    let tools = model_tools(false);
    let stream = concat!(
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":0}}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"null\",\"function\":{\"name\":\"TOOL_FS_RUN\",\"arguments\":\"{\\\"path\\\":\\\"/tools/workbench/list_tabs\\\",\\\"args\\\":{}}\"}}]}}]}\n\n",
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
    assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
    assert!(reply.tool_calls[0].id.starts_with("tool-"));
    assert_eq!(
        reply.tool_calls[0].arguments,
        json!({ "path": "/tools/workbench/list_tabs", "args": {} })
    );
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
    let allowed_tool_names = HashSet::from(["tool_fs_run".to_string()]);
    let parsed = parse_model_tool_call(
        &json!({
            "id": "",
            "function": {
                "name": "TOOL_FS_RUN",
                "arguments": "{\"scope\":"
            }
        }),
        &allowed_tool_names,
    )
    .expect("tool call");

    assert_eq!(parsed.name, "tool_fs_run");
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
                    "path": "/tools/memory/remember",
                    "args": {
                        "scope": "session",
                        "category": "test",
                        "fact": format!("tool evidence {index}")
                    }
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
                                    "name": "tool_fs_run",
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
                                "id": "finish-after-forty",
                                "type": "function",
                                "function": {
                                    "name": "lyra_turn_finish",
                                    "arguments": "{\"status\":\"completed\",\"finalText\":\"Completed after forty tool rounds.\"}"
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
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "keep working" })],
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
                                        "name": "tool_fs_run",
                                        "arguments": "{\"path\":\"/tools/memory/remember\",\"args\":{\"scope\":\"session\",\"category\":\"task\",\"fact\":\"GitHub page has a Google login option.\"}}"
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

    assert_eq!(result.final_text.as_deref(), Some("已完成结构化收口。"));
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 3);
    assert_eq!(
        model_tool_names(&requests[2]),
        expected_provider_tool_names()
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
                let arguments = json!({
                    "path": "/tools/runtime/artifact_read",
                    "args": { "path": lumen_path }
                })
                .to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": "read-artifact-1",
                                "type": "function",
                                "function": {
                                    "name": "tool_fs_run",
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
                    "path": "/tools/memory/remember",
                    "args": {
                        "scope": "session",
                        "category": "loop",
                        "fact": "same evidence"
                    }
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
                                    "name": "tool_fs_run",
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

#[test]
fn lumen_follow_audit_formats_compact_text_without_frames() {
    let formatted = format_lumen_output(
        "follow_audit",
        &json!({
            "kind": "lyraLumenFollowAudit",
            "compactText": "observe -> hover -> click",
            "frames": [
                { "id": "frame-1", "cursor": { "x": 12, "y": 34 } }
            ],
            "actions": [
                { "id": "action-1", "summary": "observe" }
            ]
        }),
    );

    assert_eq!(formatted, "observe -> hover -> click");
    assert!(!formatted.contains("frame-1"));
}

#[test]
fn lumen_activity_input_carries_target_and_follow_ids() {
    let input = resolved_tool_activity_input(
        json!({ "action": "act" }),
        &json!({
            "kind": "lyraLumenActionResult",
            "targetRef": "lumen:target-1",
            "sessionId": "follow-1",
            "actionId": "follow-action-1",
            "observationId": "obs-1",
            "ok": true
        }),
    );

    assert_eq!(input["lumenTargetRef"], "lumen:target-1");
    assert_eq!(input["followSessionId"], "follow-1");
    assert_eq!(input["followActionId"], "follow-action-1");
    assert_eq!(input["lumenObservationId"], "obs-1");
    assert_eq!(input["resultOk"], true);
}
