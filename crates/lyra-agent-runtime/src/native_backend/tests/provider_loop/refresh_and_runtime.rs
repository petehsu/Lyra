use super::*;

#[test]
fn ollama_cloud_refresh_discovers_tags_with_bearer_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ollama cloud provider");
    let addr = listener.local_addr().expect("local addr");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept ollama cloud tags request");
        let headers = read_http_headers_only(&mut stream);
        assert!(headers.starts_with("get /api/tags "));
        assert!(headers.contains("authorization: bearer sk-ollama"));
        let body = json!({
            "models": [
                { "name": "gpt-oss:120b" }
            ]
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write ollama cloud tags response");
    });

    let backend = LyraAgentBackend;
    let profile_name = format!("ollama-cloud-{}", Uuid::new_v4());
    backend
        .call_agent_method(
            "agent.provider.profile.save",
            json!({
                "profileName": profile_name,
                "routeId": "ollama_cloud",
                "baseUrl": format!("http://{addr}"),
                "defaultModel": "gpt-oss:120b",
                "apiKey": "sk-ollama",
                "setDefault": false
            }),
        )
        .expect("save ollama cloud profile");

    let catalog = backend
        .call_agent_method("agent.models.refresh", json!({ "provider": profile_name }))
        .expect("refresh ollama cloud models");
    let model_ids = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .filter_map(|model| model["id"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"gpt-oss:120b"));
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
        api_key_ref: None,
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
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "llama3.2:latest".to_string(),
        messages: vec![json!({ "role": "user", "content": "what tabs are open?" })],
        tools: model_tools(),
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "llama3.2:latest"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(&session_id, &turn_id, request, &CancellationToken::new())
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
fn empty_streaming_reply_reaches_the_loop_without_non_streaming_resample() {
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
        let (mut stream, _) = listener.accept().expect("accept provider request");
        let mut buffer = [0_u8; 4096];
        let _ = stream.read(&mut buffer).expect("read request");
        let body = "data: [DONE]\n\n";
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write empty stream");
    });
    let provider = NativeProviderProfile {
        id: "local".to_string(),
        label: "Local Test".to_string(),
        route_id: "custom_openai_compatible".to_string(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("test-model".to_string()),
        api_key_ref: None,
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
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
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
        &CancellationToken::new(),
    )
    .expect("provider reply");

    assert!(reply.content.is_none());
    assert!(reply.tool_calls.is_empty());
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
        api_key_ref: None,
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
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "keep working" })],
        tools: model_tools(),
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(&session_id, &turn_id, request, &CancellationToken::new())
        .expect("model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Completed after forty tool rounds.")
    );
    finish_turn(&session_id, &turn_id, "finished", result.final_text, None);
    let read = backend
        .call_agent_method(
            "agent.session.read",
            json!({ "sessionId": session_id.clone() }),
        )
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
        api_key_ref: None,
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
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "读取这张截图" })],
        tools: model_tools(),
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(&session_id, &turn_id, request, &CancellationToken::new())
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
        for index in 0..7 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send captured request");
            let body = if index < 5 {
                let arguments = json!({ "messageId": "missing-message" }).to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": format!("repeat-{index}"),
                                "type": "function",
                                "function": {
                                    "name": LYRA_SESSION_READ_MESSAGE_TOOL,
                                    "arguments": arguments
                                }
                            }]
                        }
                    }]
                })
                .to_string()
            } else if index == 5 {
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": null,
                            "reasoning_content": "Still reasoning."
                        },
                        "finish_reason": "stop"
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
        api_key_ref: None,
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
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "keep working" })],
        tools: model_tools(),
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };

    let result = run_model_loop(&session_id, &turn_id, request, &CancellationToken::new())
        .expect("model loop");

    assert_eq!(
        result.final_text.as_deref(),
        Some("Progress guard synthesized from repeated evidence.")
    );
    finish_turn(&session_id, &turn_id, "finished", result.final_text, None);
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 7);
    assert!(requests[0].get("tools").is_some());
    assert!(
        requests[1]["messages"]
            .as_array()
            .expect("retry messages")
            .iter()
            .any(|message| {
                message.get("role").and_then(Value::as_str) == Some("tool")
                    && message
                        .get("content")
                        .and_then(Value::as_str)
                        .is_some_and(|content| {
                            content
                                .contains("Failed tool activity ID (not valid evidence): repeat-0")
                        })
            })
    );
    assert_eq!(
        model_tool_names(&requests[5]),
        vec![LYRA_CLARIFICATION_ASK_TOOL.to_string()]
    );
    assert_eq!(
        model_tool_names(&requests[6]),
        vec![LYRA_CLARIFICATION_ASK_TOOL.to_string()]
    );
    let synthesis_messages = requests[5]["messages"].as_array().expect("messages");
    assert!(synthesis_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("user")
            && message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| {
                    content.contains("dynamic progress guard")
                        && content.contains("lyra_clarification_ask")
                        && content.contains("Plain assistant questions r non-blocking")
                        && !content.contains("ask one precise clarification question")
                })
    }));
    let retry_messages = requests[6]["messages"].as_array().expect("retry messages");
    assert!(retry_messages.iter().any(|message| {
        message
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("reasoning-only-recovery"))
    }));
    assert!(
        !serde_json::to_string(&requests[6])
            .expect("retry request")
            .contains("Still reasoning.")
    );
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
fn model_loop_progress_guard_allows_structured_clarification_only() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Progress Guard Clarification Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local provider");
    let addr = listener.local_addr().expect("local addr");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..7 {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let request = read_http_json_body(&mut stream);
            request_tx.send(request).expect("send captured request");
            let body = if index < 5 {
                let arguments = json!({ "messageId": "missing-message" }).to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": format!("repeat-{index}"),
                                "type": "function",
                                "function": {
                                    "name": LYRA_SESSION_READ_MESSAGE_TOOL,
                                    "arguments": arguments
                                }
                            }]
                        }
                    }]
                })
                .to_string()
            } else if index == 5 {
                let arguments = json!({
                    "question": "Which path should Lyra take?",
                    "options": [{
                        "label": "Ship",
                        "description": "Use gathered evidence and finish."
                    }],
                    "allowCustomAnswer": true
                })
                .to_string();
                json!({
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{
                                "id": "clarify-progress-guard",
                                "type": "function",
                                "function": {
                                    "name": LYRA_CLARIFICATION_ASK_TOOL,
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
                            "content": "Used member decision: Ship."
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
        api_key_ref: None,
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
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            capability_probes: HashMap::new(),
        }],
    };
    let request = ModelRequest {
        provider: provider.clone(),
        model: "test-model".to_string(),
        messages: vec![json!({ "role": "user", "content": "keep working" })],
        tools: model_tools(),
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher: None,
        capabilities: model_capabilities(&provider, "test-model"),
        input_downgrades: Vec::new(),
        evidence_refs: Vec::new(),
        token_estimate: 0,
        context_trimmed: false,
    };
    let loop_session_id = session_id.clone();
    let loop_turn_id = turn_id.clone();
    let handle = thread::spawn(move || {
        run_model_loop(
            &loop_session_id,
            &loop_turn_id,
            request,
            &CancellationToken::new(),
        )
    });
    let clarification_id = wait_for_progress_guard_clarification(&session_id);
    backend
        .call_agent_method(
            "agent.clarification.respond",
            json!({
                "sessionId": session_id.clone(),
                "clarificationId": clarification_id,
                "answer": "Ship",
                "selectedOption": "Ship"
            }),
        )
        .expect("respond clarification");
    let result = handle.join().expect("join model loop").expect("model loop");
    assert_eq!(
        result.final_text.as_deref(),
        Some("Used member decision: Ship.")
    );
    assert!(
        result
            .final_message_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
    );
    let provider_protocol = result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("providerProtocol"))
        .expect("final provider protocol");
    assert_eq!(provider_protocol["version"], 2);
    assert_eq!(provider_protocol["status"], "complete");
    assert_eq!(
        provider_protocol.pointer("/assistant/content"),
        Some(&json!("Used member decision: Ship."))
    );
    finish_turn(&session_id, &turn_id, "finished", result.final_text, None);
    server.join().expect("server join");
    let requests = request_rx.try_iter().collect::<Vec<_>>();
    assert_eq!(requests.len(), 7);
    assert_eq!(
        model_tool_names(&requests[5]),
        vec![LYRA_CLARIFICATION_ASK_TOOL.to_string()]
    );
    assert!(requests[6].get("tools").is_none());
    let final_messages = requests[6]["messages"].as_array().expect("messages");
    assert!(final_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("tool")
            && message
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|content| content.contains("User answered clarification: Ship"))
    }));
    let clarification_assistant = final_messages
        .iter()
        .find(|message| {
            message
                .pointer("/tool_calls/0/function/name")
                .and_then(Value::as_str)
                == Some(LYRA_CLARIFICATION_ASK_TOOL)
        })
        .expect("clarification assistant");
    assert!(
        clarification_assistant
            .get("openaiResponsesShadow")
            .is_none()
    );
    assert!(clarification_assistant.get("lyraProviderReplay").is_none());
    assert!(final_messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("tool")
            && message.get("openaiResponsesShadow").is_none()
    }));
    let read = backend
        .call_agent_method("agent.session.read", json!({ "sessionId": session_id }))
        .expect("read session");
    assert!(read["tools"].as_array().expect("tools").iter().any(|tool| {
        tool.get("name").and_then(Value::as_str) == Some("clarification")
            && tool.get("status").and_then(Value::as_str) == Some("completed")
    }));
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    let clarification_message = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().find(|message| {
                message
                    .pointer("/metadata/providerProtocol/assistant/toolCalls/0/name")
                    .and_then(Value::as_str)
                    == Some(LYRA_CLARIFICATION_ASK_TOOL)
            })
        })
        .expect("persisted clarification protocol step");
    assert_eq!(
        clarification_message
            .pointer("/metadata/providerProtocol/status")
            .and_then(Value::as_str),
        Some("complete")
    );
    assert_eq!(
        clarification_message
            .pointer("/metadata/providerProtocol/toolResults")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(1)
    );
    let runtime_turn = session
        .runtime_turns
        .iter()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id.as_str()))
        .expect("runtime turn");
    assert_eq!(runtime_turn["state"], "completed");
    assert!(runtime_turn["failureKind"].is_null());
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
        state.pending_permissions.insert(
            "permission-cancelled-turn".to_string(),
            PermissionRequest {
                id: "permission-cancelled-turn".to_string(),
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                tool_call_id: "tool-running".to_string(),
                action: "read".to_string(),
                risk: "browser_interact".to_string(),
                summary: "Cancel pending permission".to_string(),
                why: "Test cancellation cleanup".to_string(),
                title: "Pending permission".to_string(),
                detail: "Pending permission".to_string(),
                status: "pending".to_string(),
                allowed: None,
                created_at: now(),
                responded_at: None,
            },
        );
        state.pending_clarifications.insert(
            "clarification-cancelled-turn".to_string(),
            ClarificationRequest {
                id: "clarification-cancelled-turn".to_string(),
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                tool_call_id: "tool-running".to_string(),
                question: "Continue?".to_string(),
                i18n_key: None,
                options: Vec::new(),
                allow_custom_answer: true,
                detail: None,
                detail_i18n_key: None,
                status: "pending".to_string(),
                answer: None,
                selected_option: None,
                created_at: now(),
                responded_at: None,
            },
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
    let state = state().lock().expect("state lock");
    assert!(
        !state
            .pending_permissions
            .values()
            .any(|request| request.turn_id == turn_id)
    );
    assert!(
        !state
            .pending_clarifications
            .values()
            .any(|request| request.turn_id == turn_id)
    );
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
        push_array(
            &mut session.snapshot,
            "tools",
            tool_activity(
                "tool-soft-interrupt",
                "clarification",
                "Wait for clarification",
                "running",
                json!({ "turnId": old_turn_id }),
                None,
                &now(),
                None,
            ),
        );
        state.pending_permissions.insert(
            "permission-soft-interrupt".to_string(),
            PermissionRequest {
                id: "permission-soft-interrupt".to_string(),
                session_id: session_id.clone(),
                turn_id: old_turn_id.clone(),
                tool_call_id: "tool-soft-interrupt".to_string(),
                action: "continue".to_string(),
                risk: "browser_interact".to_string(),
                summary: "Interrupt pending permission".to_string(),
                why: "Test soft-interrupt cleanup".to_string(),
                title: "Pending permission".to_string(),
                detail: "Pending permission".to_string(),
                status: "pending".to_string(),
                allowed: None,
                created_at: now(),
                responded_at: None,
            },
        );
        state.pending_clarifications.insert(
            "clarification-soft-interrupt".to_string(),
            ClarificationRequest {
                id: "clarification-soft-interrupt".to_string(),
                session_id: session_id.clone(),
                turn_id: old_turn_id.clone(),
                tool_call_id: "tool-soft-interrupt".to_string(),
                question: "Continue?".to_string(),
                i18n_key: None,
                options: Vec::new(),
                allow_custom_answer: true,
                detail: None,
                detail_i18n_key: None,
                status: "pending".to_string(),
                answer: None,
                selected_option: None,
                created_at: now(),
                responded_at: None,
            },
        );
    }
    session_runtime::register_active_turn(&session_id, &old_turn_id, CancellationToken::new());

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
        read["tools"]
            .as_array()
            .expect("tools")
            .iter()
            .any(|tool| tool["id"] == "tool-soft-interrupt" && tool["status"] == "cancelled")
    );
    let state = state().lock().expect("state lock");
    assert!(
        !state
            .pending_permissions
            .values()
            .any(|request| request.turn_id == old_turn_id)
    );
    assert!(
        !state
            .pending_clarifications
            .values()
            .any(|request| request.turn_id == old_turn_id)
    );
    drop(state);
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
