use super::*;
use crate::native_backend::providers::protocol::openai_chat_completions;

fn read_http_headers_only(stream: &mut std::net::TcpStream) -> String {
    let mut headers = Vec::new();
    let mut byte = [0_u8; 1];
    while !headers.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("read header byte");
        headers.push(byte[0]);
    }
    String::from_utf8_lossy(&headers).to_ascii_lowercase()
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
    assert!(reply.ui_message_id.is_some());
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
fn streaming_parser_commits_final_answer_once_without_tool_calls() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Stream Final Test" }),
        )
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
    assert!(reply.tool_calls.is_empty());
    assert!(reply.ui_message_id.is_some());
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
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect_err("textual tool calls must be rejected");
    assert!(error.to_string().contains("textual tool"));
}

#[test]
fn textual_tool_result_ref_is_rejected_before_assistant_text_commit() {
    let mut reply = ModelReply {
        content: Some(
            "让我搜索一下黑盒安全测试相关的开源项目。 [Tool result ref: call_2eddf41e08cf48b88bb7bc80]"
                .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect_err("tool result ref placeholders must be rejected");
    assert!(error.to_string().contains("textual tool protocol leak"));
}

#[test]
fn missing_tool_preamble_is_rejected_for_retry() {
    let mut reply = ModelReply {
        content: Some("让我搜索一下黑盒安全测试相关的开源项目。".to_string()),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect_err("tool preambles without tool calls must be rejected");
    assert!(
        error
            .to_string()
            .contains("assistant promised tool use without structured tool_call")
    );
}

#[test]
fn markdown_json_tool_call_snippet_is_rejected_as_protocol_error() {
    let mut reply = ModelReply {
        content: Some(
            r#"I will run this:

```json
{"path":"/tools/shell/run_command","args":{"command":"pwd"}}
```
"#
            .to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect_err("markdown JSON tool snippets must be rejected");
    assert!(error.to_string().contains("textual tool-call syntax"));
    assert!(reply.content.is_none());
}

#[test]
fn textual_provider_visible_function_call_is_rejected_as_protocol_error() {
    let mut reply = ModelReply {
        content: Some(
            "tool_fs_run({\"path\":\"/tools/workbench/list_tabs\",\"args\":{}})".to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &model_tools(false))
        .expect_err("function-like textual tool calls must be rejected");
    assert!(error.to_string().contains("textual tool-call syntax"));
    assert!(reply.content.is_none());
}

#[test]
fn textual_provider_visible_function_call_is_rejected_even_without_advertised_tools() {
    let mut reply = ModelReply {
        content: Some(
            "tool_fs_run({\"path\":\"/tools/workbench/list_tabs\",\"args\":{}})".to_string(),
        ),
        reasoning_content: None,
        tool_calls: Vec::new(),
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    };

    let error = normalize_model_reply_protocol(&mut reply, &[])
        .expect_err("textual Tool-FS calls must be rejected without advertised tools");
    assert!(error.to_string().contains("textual tool-call syntax"));
    assert!(reply.content.is_none());
}

#[test]
fn structured_tool_call_is_ignored_when_no_tools_are_advertised() {
    let parsed = openai_chat_completions::parse_tool_call(
        &json!({
            "id": "call-1",
            "function": {
                "name": "tool_fs_run",
                "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"
            }
        }),
        &HashSet::new(),
    );

    assert!(parsed.is_none());
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

    assert!(error.to_string().contains("textual tool"));
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
        route_id: "custom_openai_compatible".to_string(),
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
            enabled: true,
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
fn openai_responses_route_executes_non_streaming_request() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind hosted provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept hosted provider request");
        let request = read_http_json_body(&mut stream);
        assert_eq!(request["model"], "gpt-test");
        assert_eq!(request["stream"], false);
        assert_eq!(request["store"], false);
        assert_eq!(request["include"][0], "reasoning.encrypted_content");
        assert_eq!(request["input"][0]["role"], "user");
        let body = r#"{"id":"resp-test","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hosted route reply."}]}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write hosted route reply");
    });
    let provider = NativeProviderProfile {
        id: "openai".to_string(),
        label: "OpenAI".to_string(),
        route_id: "openai".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("gpt-test".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "gpt-test".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: true,
            enabled: true,
        }],
    };

    let reply = call_model_once_non_streaming(
        &provider,
        "gpt-test",
        &[json!({ "role": "user", "content": "hello" })],
        &[],
    )
    .expect("responses request should succeed");

    assert_eq!(reply.content.as_deref(), Some("Hosted route reply."));
    assert_eq!(reply.provider_replay_items[0]["type"], "message");
    server.join().expect("server join");
}

#[test]
fn mimo_hosted_route_applies_specialized_body_and_api_key_header() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mimo provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept mimo provider request");
        let (headers, request) = read_http_request(&mut stream);
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("\r\napi-key: test-key\r\n")
        );
        assert_eq!(request["model"], "mimo-v2.5-pro");
        assert_eq!(request["stream"], false);
        assert_eq!(request["thinking"]["type"], "enabled");
        assert_eq!(request["temperature"], 1.0);
        assert_eq!(request["top_p"], 0.95);
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"MiMo hosted route reply."}}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write mimo hosted route reply");
    });
    let provider = NativeProviderProfile {
        id: "mimo".to_string(),
        label: "MiMo".to_string(),
        route_id: "mimo".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("mimo-v2.5-pro".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "mimo-v2.5-pro".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: true,
            enabled: true,
        }],
    };

    let reply = call_model_once_non_streaming(
        &provider,
        "mimo-v2.5-pro",
        &[json!({ "role": "user", "content": "hello" })],
        &model_tools(false),
    )
    .expect("mimo hooked request should succeed");

    assert_eq!(reply.content.as_deref(), Some("MiMo hosted route reply."));
    server.join().expect("server join");
}

#[test]
fn mimo_tool_loop_replays_reasoning_content_with_assistant_tool_calls() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "MiMo Reasoning Tool Transcript Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mimo provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept mimo provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send request");
            let body = if index == 0 {
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "reasoning_content": "I should inspect the current tabs before answering.",
                            "tool_calls": [{
                                "id": "call-tabs",
                                "type": "function",
                                "function": {
                                    "name": "tool_fs_run",
                                    "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{\"scope\":\"all\"}}"
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
                            "content": "Checked the current tabs.",
                            "reasoning_content": "The tab evidence is enough to finish."
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
            .expect("write mimo response");
        }
    });
    let provider = NativeProviderProfile {
        id: "mimo".to_string(),
        label: "MiMo".to_string(),
        route_id: "mimo".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("mimo-v2.5-pro".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "mimo-v2.5-pro".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "mimo-v2.5-pro".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "mimo-v2.5-pro"),
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
    .expect("mimo model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    assert_eq!(
        result.provider_transcript[0]["reasoning_content"],
        "I should inspect the current tabs before answering."
    );
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["thinking"]["type"], "enabled");
    let replayed_assistant = requests[1]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .find(|message| {
            message.get("role").and_then(Value::as_str) == Some("assistant")
                && message.get("tool_calls").is_some()
        })
        .expect("assistant tool-call replay");
    assert_eq!(
        replayed_assistant["reasoning_content"],
        "I should inspect the current tabs before answering."
    );
    server.join().expect("server join");
}

#[test]
fn mimo_streaming_tool_loop_replays_reasoning_content_with_assistant_tool_calls() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "MiMo Streaming Reasoning Tool Transcript Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mimo provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept mimo provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send request");
            let body = if index == 0 {
                concat!(
                    "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"I should inspect the current tabs before answering.\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-tabs\",\"type\":\"function\",\"function\":{\"name\":\"tool_fs_run\",\"arguments\":\"{\\\"path\\\":\\\"/tools/workbench/list_tabs\\\",\\\"args\\\":{\\\"scope\\\":\\\"all\\\"}}\"}}]}}]}\n\n",
                    "data: [DONE]\n\n",
                )
                .to_string()
            } else {
                concat!(
                    "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"The tab evidence is enough to finish.\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"Checked the current tabs.\"}}]}\n\n",
                    "data: [DONE]\n\n",
                )
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write mimo streaming response");
        }
    });
    let provider = NativeProviderProfile {
        id: "mimo".to_string(),
        label: "MiMo".to_string(),
        route_id: "mimo".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("mimo-v2.5-pro".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "mimo-v2.5-pro".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: true,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "mimo-v2.5-pro".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "mimo-v2.5-pro"),
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
    .expect("mimo streaming model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["stream"], true);
    let replayed_assistant = requests[1]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .find(|message| {
            message.get("role").and_then(Value::as_str) == Some("assistant")
                && message.get("tool_calls").is_some()
        })
        .expect("assistant tool-call replay");
    assert_eq!(
        replayed_assistant["reasoning_content"],
        "I should inspect the current tabs before answering."
    );
    server.join().expect("server join");
}

#[test]
fn mimo_anthropic_tool_loop_replays_thinking_blocks_with_assistant_tool_calls() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "MiMo Anthropic Reasoning Tool Transcript Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mimo anthropic provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept mimo anthropic request");
            let (headers, request) = read_http_request(&mut stream);
            request_tx.send(request.clone()).expect("send request");
            assert!(headers.to_ascii_lowercase().contains("api-key: test-key"));
            if index == 0 {
                assert_eq!(request["thinking"]["type"], "enabled");
            } else {
                let replayed_assistant = request["messages"]
                    .as_array()
                    .expect("messages")
                    .iter()
                    .find(|message| {
                        message.get("role").and_then(Value::as_str) == Some("assistant")
                            && message.pointer("/content/0/type").and_then(Value::as_str)
                                == Some("thinking")
                    })
                    .expect("assistant thinking replay");
                assert_eq!(
                    replayed_assistant
                        .pointer("/content/0/thinking")
                        .and_then(Value::as_str),
                    Some("I should inspect the current tabs before answering.")
                );
            }
            let body = if index == 0 {
                json!({
                    "id": "msg-tool-1",
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "thinking",
                            "thinking": "I should inspect the current tabs before answering."
                        },
                        {
                            "type": "tool_use",
                            "id": "call-tabs",
                            "name": "tool_fs_run",
                            "input": {
                                "path": "/tools/workbench/list_tabs",
                                "args": { "scope": "all" }
                            }
                        }
                    ],
                    "stop_reason": "tool_use"
                })
                .to_string()
            } else {
                json!({
                    "id": "msg-tool-2",
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "thinking",
                            "thinking": "The tab evidence is enough to finish."
                        },
                        {
                            "type": "text",
                            "text": "Checked the current tabs."
                        }
                    ],
                    "stop_reason": "end_turn"
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write mimo anthropic response");
        }
    });
    let provider = NativeProviderProfile {
        id: "mimo-anthropic".to_string(),
        label: "MiMo Anthropic".to_string(),
        route_id: "mimo_anthropic".to_string(),
        base_url: Some(format!("http://{addr}/anthropic/v1")),
        default_model: Some("mimo-v2.5-pro".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: Some("api-key".to_string()),
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "mimo-v2.5-pro".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "mimo-v2.5-pro".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "mimo-v2.5-pro"),
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
    .expect("mimo anthropic model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    assert_eq!(
        result.provider_transcript[0]["reasoning_content"],
        "I should inspect the current tabs before answering."
    );
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    server.join().expect("server join");
}

#[test]
fn openai_responses_tool_loop_replays_native_items_and_function_outputs() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "OpenAI Responses Replay Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind openai provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept openai request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request.clone()).expect("send request");
            if index == 0 {
                assert_eq!(request["store"], false);
                assert_eq!(request["include"][0], "reasoning.encrypted_content");
            } else {
                let input = request["input"].as_array().expect("responses input");
                assert!(input.iter().any(|item| {
                    item.get("type").and_then(Value::as_str) == Some("function_call")
                        && item.get("call_id").and_then(Value::as_str) == Some("call-tabs")
                }));
                assert!(input.iter().any(|item| {
                    item.get("type").and_then(Value::as_str) == Some("function_call_output")
                        && item.get("call_id").and_then(Value::as_str) == Some("call-tabs")
                }));
            }
            let body = if index == 0 {
                json!({
                    "id": "resp-tool-1",
                    "status": "completed",
                    "output": [
                        {
                            "type": "reasoning",
                            "id": "rs-1",
                            "encrypted_content": "encrypted-reasoning"
                        },
                        {
                            "type": "function_call",
                            "id": "fc-1",
                            "call_id": "call-tabs",
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{\"scope\":\"all\"}}"
                        }
                    ]
                })
                .to_string()
            } else {
                json!({
                    "id": "resp-tool-2",
                    "status": "completed",
                    "output": [{
                        "type": "message",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": "Checked the current tabs."
                        }]
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
            .expect("write openai response");
        }
    });
    let provider = NativeProviderProfile {
        id: "openai".to_string(),
        label: "OpenAI".to_string(),
        route_id: "openai".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("gpt-5-mini".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "gpt-5-mini".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "gpt-5-mini".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "gpt-5-mini"),
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
    .expect("openai responses model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    assert!(result.provider_replay_items.iter().any(|item| {
        item.get("type").and_then(Value::as_str) == Some("reasoning")
            && item.get("encrypted_content").and_then(Value::as_str) == Some("encrypted-reasoning")
    }));
    assert!(result.provider_replay_items.iter().any(|item| {
        item.get("type").and_then(Value::as_str) == Some("function_call_output")
            && item.get("call_id").and_then(Value::as_str) == Some("call-tabs")
    }));
    assert!(result.provider_replay_items.iter().any(|item| {
        item.get("type").and_then(Value::as_str) == Some("message")
            && item.pointer("/content/0/text").and_then(Value::as_str)
                == Some("Checked the current tabs.")
    }));
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    server.join().expect("server join");
}

#[test]
fn anthropic_messages_tool_loop_converts_tool_use_and_results() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Anthropic Messages Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind anthropic provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept anthropic request");
            let (headers, request) = read_http_request(&mut stream);
            let lower_headers = headers.to_ascii_lowercase();
            assert!(lower_headers.contains("x-api-key: test-key"));
            assert!(lower_headers.contains("anthropic-version: 2023-06-01"));
            request_tx.send(request.clone()).expect("send request");
            if index == 0 {
                assert_eq!(request["model"], "claude-sonnet-4-6");
                assert_eq!(request["stream"], false);
                assert_eq!(request["tools"][0]["name"], "tool_fs_search");
            } else {
                let messages = request["messages"].as_array().expect("messages");
                assert!(messages.iter().any(|message| {
                    message.get("role").and_then(Value::as_str) == Some("assistant")
                        && message.pointer("/content/0/type").and_then(Value::as_str)
                            == Some("tool_use")
                }));
                assert!(messages.iter().any(|message| {
                    message.get("role").and_then(Value::as_str) == Some("user")
                        && message.pointer("/content/0/type").and_then(Value::as_str)
                            == Some("tool_result")
                }));
            }
            let body = if index == 0 {
                json!({
                    "id": "msg-tool-1",
                    "type": "message",
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": "call-tabs",
                        "name": "tool_fs_run",
                        "input": {
                            "path": "/tools/workbench/list_tabs",
                            "args": { "scope": "all" }
                        }
                    }],
                    "stop_reason": "tool_use"
                })
                .to_string()
            } else {
                json!({
                    "id": "msg-tool-2",
                    "type": "message",
                    "role": "assistant",
                    "content": [{
                        "type": "text",
                        "text": "Checked the current tabs."
                    }],
                    "stop_reason": "end_turn"
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write anthropic response");
        }
    });
    let provider = NativeProviderProfile {
        id: "anthropic".to_string(),
        label: "Anthropic".to_string(),
        route_id: "anthropic".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("claude-sonnet-4-6".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "claude-sonnet-4-6".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "claude-sonnet-4-6".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "claude-sonnet-4-6"),
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
    .expect("anthropic messages loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    server.join().expect("server join");
}

#[test]
fn custom_anthropic_compatible_route_executes_messages_request() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind custom anthropic provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("accept custom anthropic provider request");
        let (headers, request) = read_http_request(&mut stream);
        let lower_headers = headers.to_ascii_lowercase();
        assert!(lower_headers.starts_with("post /v1/messages "));
        assert!(lower_headers.contains("api-key: test-key"));
        assert!(!lower_headers.contains("x-api-key: test-key"));
        assert!(lower_headers.contains("anthropic-version: 2023-06-01"));
        assert_eq!(request["model"], "claude-compatible");
        assert_eq!(request["messages"][0]["role"], "user");
        let body = json!({
            "id": "msg-custom-1",
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "text", "text": "Custom Anthropic reply." }],
            "stop_reason": "end_turn"
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write custom anthropic response");
    });
    let provider = NativeProviderProfile {
        id: "custom-anthropic".to_string(),
        label: "Custom Anthropic".to_string(),
        route_id: "custom_anthropic_compatible".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("claude-compatible".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: Some("api-key".to_string()),
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "claude-compatible".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: true,
            enabled: true,
        }],
    };

    let reply = call_model_once_non_streaming(
        &provider,
        "claude-compatible",
        &[json!({ "role": "user", "content": "hello" })],
        &[],
    )
    .expect("custom anthropic request should succeed");

    assert_eq!(reply.content.as_deref(), Some("Custom Anthropic reply."));
    server.join().expect("server join");
}

#[test]
fn gemini_generate_content_tool_loop_converts_function_calls_and_responses() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Gemini GenerateContent Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind gemini provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept gemini request");
            let (headers, request) = read_http_request(&mut stream);
            let lower_headers = headers.to_ascii_lowercase();
            assert!(
                lower_headers.starts_with("post /v1beta/models/gemini-2.5-flash:generatecontent ")
            );
            assert!(lower_headers.contains("x-goog-api-key: test-key"));
            request_tx.send(request.clone()).expect("send request");
            if index == 0 {
                assert_eq!(request["contents"][0]["role"], "user");
                assert_eq!(
                    request["tools"][0]["functionDeclarations"][0]["name"],
                    "tool_fs_search"
                );
                assert_eq!(
                    request["toolConfig"]["functionCallingConfig"]["mode"],
                    "AUTO"
                );
            } else {
                let contents = request["contents"].as_array().expect("contents");
                assert!(contents.iter().any(|content| {
                    content.get("role").and_then(Value::as_str) == Some("model")
                        && content
                            .pointer("/parts/0/functionCall/name")
                            .and_then(Value::as_str)
                            == Some("tool_fs_run")
                }));
                assert!(contents.iter().any(|content| {
                    content.get("role").and_then(Value::as_str) == Some("user")
                        && content
                            .pointer("/parts/0/functionResponse/name")
                            .and_then(Value::as_str)
                            == Some("tool_fs_run")
                }));
            }
            let body = if index == 0 {
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "functionCall": {
                                    "name": "tool_fs_run",
                                    "args": {
                                        "path": "/tools/workbench/list_tabs",
                                        "args": { "scope": "all" }
                                    }
                                }
                            }]
                        },
                        "finishReason": "STOP"
                    }]
                })
                .to_string()
            } else {
                json!({
                    "candidates": [{
                        "content": {
                            "role": "model",
                            "parts": [{
                                "text": "Checked the current tabs."
                            }]
                        },
                        "finishReason": "STOP"
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
            .expect("write gemini response");
        }
    });
    let provider = NativeProviderProfile {
        id: "google_gemini".to_string(),
        label: "Google Gemini".to_string(),
        route_id: "google_gemini".to_string(),
        base_url: Some(format!("http://{addr}/v1beta")),
        default_model: Some("gemini-2.5-flash".to_string()),
        api_key: Some("test-key".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "gemini-2.5-flash".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "gemini-2.5-flash".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "gemini-2.5-flash"),
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
    .expect("gemini generate content loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    server.join().expect("server join");
}

#[test]
fn aws_bedrock_converse_tool_loop_signs_and_converts_tool_use_and_results() {
    unsafe {
        std::env::set_var("AWS_SECRET_ACCESS_KEY", "test-secret");
        std::env::set_var("AWS_REGION", "us-west-2");
    }
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "AWS Bedrock Converse Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind bedrock provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept bedrock request");
            let (headers, request) = read_http_request(&mut stream);
            let lower_headers = headers.to_ascii_lowercase();
            assert!(
                lower_headers.starts_with(
                    "post /model/anthropic.claude-3-5-sonnet-20241022-v2%3a0/converse "
                )
            );
            assert!(lower_headers.contains("authorization: aws4-hmac-sha256 credential=akiatest/"));
            assert!(lower_headers.contains("/us-west-2/bedrock/aws4_request"));
            assert!(lower_headers.contains("x-amz-date: "));
            assert!(lower_headers.contains("x-amz-content-sha256: "));
            request_tx.send(request.clone()).expect("send request");
            if index == 0 {
                assert_eq!(request["messages"][0]["role"], "user");
                assert_eq!(
                    request["toolConfig"]["tools"][0]["toolSpec"]["name"],
                    "tool_fs_search"
                );
                assert_eq!(request["toolConfig"]["toolChoice"]["auto"], json!({}));
            } else {
                let messages = request["messages"].as_array().expect("messages");
                assert!(messages.iter().any(|message| {
                    message.get("role").and_then(Value::as_str) == Some("assistant")
                        && message
                            .pointer("/content/0/toolUse/name")
                            .and_then(Value::as_str)
                            == Some("tool_fs_run")
                }));
                assert!(messages.iter().any(|message| {
                    message.get("role").and_then(Value::as_str) == Some("user")
                        && message
                            .pointer("/content/0/toolResult/toolUseId")
                            .and_then(Value::as_str)
                            == Some("call-tabs")
                }));
            }
            let body = if index == 0 {
                json!({
                    "output": {
                        "message": {
                            "role": "assistant",
                            "content": [{
                                "toolUse": {
                                    "toolUseId": "call-tabs",
                                    "name": "tool_fs_run",
                                    "input": {
                                        "path": "/tools/workbench/list_tabs",
                                        "args": { "scope": "all" }
                                    }
                                }
                            }]
                        }
                    },
                    "stopReason": "tool_use"
                })
                .to_string()
            } else {
                json!({
                    "output": {
                        "message": {
                            "role": "assistant",
                            "content": [{
                                "text": "Checked the current tabs."
                            }]
                        }
                    },
                    "stopReason": "end_turn"
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write bedrock response");
        }
    });
    let provider = NativeProviderProfile {
        id: "aws_bedrock".to_string(),
        label: "AWS Bedrock".to_string(),
        route_id: "aws_bedrock".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("anthropic.claude-3-5-sonnet-20241022-v2:0".to_string()),
        api_key: Some("AKIATEST".to_string()),
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "anthropic.claude-3-5-sonnet-20241022-v2:0".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "anthropic.claude-3-5-sonnet-20241022-v2:0"),
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
    .expect("aws bedrock converse loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    server.join().expect("server join");
}

#[test]
fn local_descriptor_route_keeps_generic_fallback_execution() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local provider request");
        let request = read_http_json_body(&mut stream);
        assert_eq!(request["model"], "local-model");
        assert_eq!(request["stream"], false);
        let body =
            r#"{"choices":[{"message":{"role":"assistant","content":"Local fallback reply."}}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write local fallback reply");
    });
    let provider = NativeProviderProfile {
        id: "lmstudio".to_string(),
        label: "LM Studio".to_string(),
        route_id: "lmstudio".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        default_model: Some("local-model".to_string()),
        api_key: None,
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "local-model".to_string(),
            label: None,
            context_window: None,
            supports_image_input: false,
            supports_tool_calling: false,
            supports_streaming: true,
            enabled: true,
        }],
    };

    let reply = call_model_once_non_streaming(
        &provider,
        "local-model",
        &[json!({ "role": "user", "content": "hello" })],
        &[],
    )
    .expect("local fallback request should succeed");

    assert_eq!(reply.content.as_deref(), Some("Local fallback reply."));
    server.join().expect("server join");
}

#[test]
fn custom_openai_compatible_refresh_discovers_broad_model_ids() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind model discovery provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept model discovery request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /v1/models "));
        assert!(headers.contains("authorization: bearer sk-test"));
        let body = json!({
            "data": [
                { "id": "anthropic/claude-sonnet-4" },
                { "id": "deepseek/deepseek-chat" },
                { "id": "text-embedding-3-large" }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write model discovery response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("custom-openai-compatible-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "custom_openai_compatible",
                "baseUrl": format!("http://{addr}/v1"),
                "apiKey": "sk-test",
                "defaultModel": "anthropic/claude-sonnet-4",
                "setDefault": false
            }),
        )
        .expect("save custom provider profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh custom provider models");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"anthropic/claude-sonnet-4"));
    assert!(model_ids.contains(&"deepseek/deepseek-chat"));
    assert!(!model_ids.contains(&"text-embedding-3-large"));
    server.join().expect("server join");
}

#[test]
fn local_openai_compatible_refresh_discovers_models_without_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local discovery provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept model discovery request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /v1/models "));
        assert!(!headers.contains("authorization:"));
        let body = json!({
            "data": [
                { "id": "local-qwen" },
                { "id": "text-embedding-local" }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write model discovery response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("local-openai-compatible-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "local_openai_compatible",
                "baseUrl": format!("http://{addr}/v1"),
                "defaultModel": "local-qwen",
                "setDefault": false
            }),
        )
        .expect("save local provider profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh local provider models");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();
    let local_model = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .find(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .expect("local model entry");

    assert!(model_ids.contains(&"local-qwen"));
    assert!(!model_ids.contains(&"text-embedding-local"));
    assert_eq!(local_model["available"], true);
    server.join().expect("server join");
}

#[test]
fn lmstudio_refresh_uses_native_model_discovery_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind lmstudio provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept lmstudio request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /api/v1/models "));
        assert!(!headers.contains("authorization:"));
        let body = json!({
            "data": [
                { "id": "lmstudio-qwen" },
                { "model": "lmstudio-gemma" }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write lmstudio discovery response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("lmstudio-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "lmstudio",
                "baseUrl": format!("http://{addr}/v1"),
                "defaultModel": "lmstudio-qwen",
                "setDefault": false
            }),
        )
        .expect("save lmstudio profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh lmstudio models");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"lmstudio-qwen"));
    assert!(model_ids.contains(&"lmstudio-gemma"));
    server.join().expect("server join");
}

#[test]
fn ollama_refresh_discovers_tags() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ollama provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept ollama tags request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /api/tags "));
        assert!(!headers.contains("authorization:"));
        let body = json!({
            "models": [
                { "name": "llama3.2:latest" },
                { "model": "qwen3:8b" }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write ollama tags response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("ollama-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "ollama",
                "baseUrl": format!("http://{addr}"),
                "defaultModel": "llama3.2:latest",
                "setDefault": false
            }),
        )
        .expect("save ollama profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh ollama models");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"llama3.2:latest"));
    assert!(model_ids.contains(&"qwen3:8b"));
    server.join().expect("server join");
}

#[test]
fn ollama_chat_tool_loop_round_trips_tool_results() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Ollama Tool Loop Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ollama provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept ollama request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request.clone()).expect("send request");
            assert_eq!(request["model"], "llama3.2:latest");
            assert_eq!(request["stream"], false);
            assert!(
                request["tools"]
                    .as_array()
                    .is_some_and(|tools| !tools.is_empty())
            );
            if index == 1 {
                assert!(
                    request["messages"]
                        .as_array()
                        .expect("messages")
                        .iter()
                        .any(|message| {
                            message.get("role").and_then(Value::as_str) == Some("tool")
                                && message.get("content").and_then(Value::as_str).is_some()
                        })
                );
            }
            let body = if index == 0 {
                json!({
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "call-tabs",
                            "function": {
                                "name": "tool_fs_run",
                                "arguments": {
                                    "path": "/tools/workbench/list_tabs",
                                    "args": { "scope": "all" }
                                }
                            }
                        }]
                    },
                    "done": true
                })
                .to_string()
            } else {
                json!({
                    "message": {
                        "role": "assistant",
                        "content": "Checked the current tabs."
                    },
                    "done": true
                })
                .to_string()
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write ollama response");
        }
    });
    let provider = NativeProviderProfile {
        id: "ollama".to_string(),
        label: "Ollama".to_string(),
        route_id: "ollama".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("llama3.2:latest".to_string()),
        api_key: None,
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "llama3.2:latest".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: false,
            enabled: true,
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "llama3.2:latest".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(false),
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "llama3.2:latest"),
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
    .expect("ollama loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Checked the current tabs.")
    );
    assert_eq!(request_rx.try_iter().count(), 2);
    server.join().expect("server join");
}

#[test]
fn anthropic_refresh_discovers_claude_models() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind anthropic discovery provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("accept anthropic discovery request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /v1/models "));
        assert!(headers.contains("x-api-key: test-key"));
        assert!(headers.contains("anthropic-version: 2023-06-01"));
        let body = json!({
            "data": [
                { "id": "claude-sonnet-4-6" },
                { "id": "claude-opus-4-6" },
                { "id": "not-claude-text" }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write anthropic model discovery response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("anthropic-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "anthropic",
                "baseUrl": format!("http://{addr}/v1"),
                "apiKey": "test-key",
                "defaultModel": "claude-sonnet-4-6",
                "setDefault": false
            }),
        )
        .expect("save anthropic provider profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh anthropic provider models");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"claude-sonnet-4-6"));
    assert!(model_ids.contains(&"claude-opus-4-6"));
    assert!(!model_ids.contains(&"not-claude-text"));
    server.join().expect("server join");
}

#[test]
fn gemini_refresh_discovers_generate_content_models() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind gemini discovery provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept gemini discovery request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /v1beta/models "));
        assert!(headers.contains("x-goog-api-key: test-key"));
        let body = json!({
            "models": [
                {
                    "name": "models/gemini-2.5-flash",
                    "displayName": "Gemini 2.5 Flash",
                    "inputTokenLimit": 1048576,
                    "supportedGenerationMethods": ["generateContent", "streamGenerateContent"]
                },
                {
                    "name": "models/gemini-embedding-001",
                    "displayName": "Gemini Embedding",
                    "supportedGenerationMethods": ["embedContent"]
                }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write gemini model discovery response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("google-gemini-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "google_gemini",
                "baseUrl": format!("http://{addr}/v1beta"),
                "apiKey": "test-key",
                "defaultModel": "gemini-2.5-flash",
                "setDefault": false
            }),
        )
        .expect("save gemini provider profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh gemini provider models");
    let models = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .collect::<Vec<_>>();
    let model_ids = models
        .iter()
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"gemini-2.5-flash"));
    assert!(!model_ids.contains(&"gemini-embedding-001"));
    let flash = models
        .iter()
        .find(|model| model["id"].as_str() == Some("gemini-2.5-flash"))
        .expect("flash model");
    assert_eq!(flash["contextWindow"], 1048576);
    server.join().expect("server join");
}

#[test]
fn non_stream_tool_call_parser_preserves_invalid_arguments_as_evidence() {
    let allowed_tool_names = HashSet::from(["tool_fs_run".to_string()]);
    let parsed = openai_chat_completions::parse_tool_call(
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
        route_id: "custom_openai_compatible".to_string(),
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
            enabled: true,
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
        route_id: "custom_openai_compatible".to_string(),
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
            enabled: true,
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
                            "content": "我已经读取了截图。"
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
        route_id: "custom_openai_compatible".to_string(),
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
            enabled: true,
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
        route_id: "custom_openai_compatible".to_string(),
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
            enabled: true,
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
