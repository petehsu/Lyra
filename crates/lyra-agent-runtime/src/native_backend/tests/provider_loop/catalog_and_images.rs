use super::*;

#[test]
fn catalog_outage_unknown_call_and_local_image_recover_in_one_turn() {
    run_catalog_and_image_turn(false);
}

#[test]
fn streaming_catalog_outage_unknown_call_and_image_recover_with_fragmented_names() {
    run_catalog_and_image_turn(true);
}

fn run_catalog_and_image_turn(streaming: bool) {
    let dir = tempfile::tempdir().unwrap();
    let image_path = dir.path().join("downloaded-image");
    image::RgbImage::from_pixel(16, 8, image::Rgb([180, 20, 30]))
        .save_with_format(&image_path, image::ImageFormat::Png)
        .unwrap();
    let created = LyraAgentBackend
        .call_agent_method(
            "agent.session.create",
            json!({
                "title":"Catalog and native image regression", "workingDir":dir.path()
            }),
        )
        .unwrap();
    let session = created["id"].as_str().unwrap();
    let turn = start_test_runtime_turn(session);
    let catalog_reads = Arc::new(AtomicUsize::new(0));
    let invocations = Arc::new(AtomicUsize::new(0));
    let (reads, calls) = (catalog_reads.clone(), invocations.clone());
    let host: Arc<HostCapabilityDispatcher> = Arc::new(move |method, _| match method.as_str() {
        "software.listCapabilities" => {
            if reads.fetch_add(1, Ordering::SeqCst) > 0 {
                return Err("renderer temporarily unavailable".into());
            }
            Ok(json!({"software":[{"id":"fixture", "actions":[{
                    "id":"inspect","title":"Inspect","risk":"read","inputSchema":{"type":"object","properties":{}}
                }]}]}).to_string())
        }
        "software.invokeCapability" => {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"ok":true,"text":"Inspected"}).to_string())
        }
        other => panic!("Unexpected UI/host request: {other}"),
    });
    let steps = [
        (
            "ToolSearch",
            json!({"query":"select:software__fixture__inspect"}),
        ),
        ("software__fixture__inspect", json!({})),
        (
            "ToolSearch",
            json!({"query":"select:software__fixture__inspect","refresh":true}),
        ),
        ("unavailable_tool", json!({})),
        ("software__fixture__inspect", json!({})),
        ("read_file", json!({"path":image_path})),
    ];
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for index in 0..=steps.len() {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(20)))
                .unwrap();
            tx.send(read_http_json_body(&mut stream)).unwrap();
            let message = if let Some((name, arguments)) = steps.get(index) {
                json!({"role":"assistant","reasoning_content":format!("reasoning-{index}"),"tool_calls":[{
                    "id":format!("call-{index}"),"type":"function","function":{"name":name,"arguments":arguments.to_string()}
                }]})
            } else {
                json!({"role":"assistant","content":"Image received; task complete."})
            };
            let (content_type, body) = if streaming {
                let mut events = Vec::new();
                if let Some((name, args)) = steps.get(index) {
                    let split = name.len() / 2;
                    events.push(json!({"choices":[{"delta":{"reasoning_content":format!("reasoning-{index}"),"tool_calls":[{
                        "index":0,"id":format!("call-{index}"),"type":"function","function":{"name":&name[..split],"arguments":""}
                    }]}}]}));
                    events.push(json!({"choices":[{"delta":{"tool_calls":[{
                        "index":0,"function":{"name":&name[split..],"arguments":args.to_string()}
                    }]}}]}));
                } else {
                    events.push(
                        json!({"choices":[{"delta":{"content":"Image received; task complete."}}]}),
                    );
                }
                events.push(json!({"choices":[{"delta":{},"finish_reason":if index < steps.len() {"tool_calls"} else {"stop"}}]}));
                (
                    "text/event-stream",
                    format!(
                        "{}data: [DONE]\n\n",
                        events
                            .iter()
                            .map(|event| format!("data: {event}\n\n"))
                            .collect::<String>()
                    ),
                )
            } else {
                ("application/json", json!({"choices":[{"message":message,"finish_reason":if index < steps.len() {"tool_calls"} else {"stop"}}]}).to_string())
            };
            write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}", body.len(), body).unwrap();
        }
    });
    let provider = NativeProviderProfile {
        id: "local-catalog-image-test".into(),
        label: "Local".into(),
        route_id: "custom_openai_compatible".into(),
        base_url: Some(format!("http://{addr}")),
        default_model: Some("vision-test".into()),
        api_key: Some("test-key".into()),
        api_key_ref: None,
        api_key_env: None,
        auth_header: None,
        embedding_model: None,
        models: vec![NativeProviderModel {
            id: "vision-test".into(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: streaming,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::ReasoningContent,
            requires_reasoning_field_on_assistant_messages: Some(true),
            supports_tool_choice: None,
            enabled: true,
            api_npm: None,
        }],
    };
    let request = ModelRequest {
        capabilities: model_capabilities(&provider, "vision-test"),
        provider,
        model: "vision-test".into(),
        messages: vec![json!({"role":"user","content":"Inspect then read the local image."})],
        tools: assemble_provider_tools(&json!({}), Some(&host), Some(128_000)),
        tool_choice: ModelToolChoice::Auto,
        host_dispatcher: Some(host),
        input_downgrades: vec![],
        evidence_refs: vec![],
        token_estimate: 0,
        context_trimmed: false,
    };
    let cancellation = CancellationToken::new();
    let timeout_token = cancellation.clone();
    let (done_tx, done_rx) = mpsc::channel();
    let approval_session = session.to_string();
    let watchdog = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while done_rx.recv_timeout(Duration::from_millis(10)).is_err() {
            if Instant::now() >= deadline {
                timeout_token.cancel();
                break;
            }
            let ids: Vec<_> = state()
                .lock()
                .unwrap()
                .pending_permissions
                .values()
                .filter(|permission| {
                    permission.session_id == approval_session && permission.allowed.is_none()
                })
                .map(|permission| permission.id.clone())
                .collect();
            for id in ids {
                LyraAgentBackend
                    .call_agent_method(
                        "agent.permission.respond",
                        json!({
                            "sessionId":approval_session,"permissionId":id,"allowed":true
                        }),
                    )
                    .unwrap();
            }
        }
    });
    let result = run_model_loop(session, &turn, request, &cancellation);
    let _ = done_tx.send(());
    watchdog.join().unwrap();
    let result = result.unwrap();
    assert_eq!(
        result.final_text.as_deref(),
        Some("Image received; task complete.")
    );
    server.join().unwrap();
    let requests: Vec<_> = rx.try_iter().collect();
    assert_eq!(
        requests.len(),
        7,
        "No protocol retry or extra discovery round"
    );
    assert_eq!(
        catalog_reads.load(Ordering::SeqCst),
        2,
        "Initial snapshot plus explicit failed refresh only"
    );
    assert_eq!(
        invocations.load(Ordering::SeqCst),
        2,
        "Unknown names never reach host execution"
    );
    for request in &requests[1..] {
        assert!(
            request["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["function"]["name"] == "software__fixture__inspect")
        );
    }
    let messages = requests[6]["messages"].as_array().unwrap();
    assert!(messages.iter().any(|m| m["role"] == "tool"
        && m["tool_call_id"] == "call-3"
        && m["content"].as_str().unwrap().contains("unavailable_tool")));
    assert!(
        messages.iter().any(|m| m["content"]
            .as_array()
            .is_some_and(|parts| parts.iter().any(|part| part
                .pointer("/image_url/url")
                .and_then(Value::as_str)
                .is_some_and(|url| url.starts_with("data:image/png;base64,")))))
    );
    for message in messages.iter().filter(|m| m["tool_calls"].is_array()) {
        assert!(
            message["reasoning_content"].is_string(),
            "Reasoning replay must survive rejected calls"
        );
    }
}
