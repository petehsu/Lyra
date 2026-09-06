use super::*;

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
        .filter_map(|model| model["model"].as_str())
        .collect::<Vec<_>>();

    assert!(model_ids.contains(&"anthropic/claude-sonnet-4"));
    assert!(model_ids.contains(&"deepseek/deepseek-chat"));
    let opaque_model = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .find(|model| model["model"].as_str() == Some("text-embedding-3-large"))
        .expect("opaque model ids are discovered under the broad scope");
    // A bare OpenAI-compatible /models response declares existence, not model type.
    // Do not infer capabilities from a name substring; the protocol's conservative
    // text fallback remains in force until metadata, catalog evidence, or a user
    // override says otherwise.
    assert_eq!(opaque_model["agentUsable"], true);
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
        .filter_map(|model| model["model"].as_str())
        .collect::<Vec<_>>();
    let local_model = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .find(|model| model["providerId"].as_str() == Some(profile_name.as_str()))
        .expect("local model entry");

    assert!(model_ids.contains(&"local-qwen"));
    let opaque_model = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .find(|model| model["model"].as_str() == Some("text-embedding-local"))
        .expect("opaque model ids are discovered without auth");
    assert_eq!(opaque_model["agentUsable"], true);
    assert_eq!(local_model["available"], true);
    server.join().expect("server join");
}
