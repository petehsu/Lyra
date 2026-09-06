use super::*;

#[test]
fn parses_mcp_servers_json_shape() {
    let value = json!({
        "mcpServers": {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                "env": { "TOKEN": "secret" }
            }
        }
    });
    let drafts = parse_server_drafts(&value).expect("parse");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id.as_deref(), Some("filesystem"));
    match &drafts[0].transport {
        McpTransportConfig::Stdio {
            command, args, env, ..
        } => {
            assert_eq!(command, "npx");
            assert_eq!(args[1], "@modelcontextprotocol/server-filesystem");
            assert_eq!(env.get("TOKEN").map(String::as_str), Some("secret"));
        }
        _ => panic!("expected stdio"),
    }
}

#[test]
fn parses_plain_command_line() {
    let drafts = parse_text_server("uvx mcp-server-git --repository /repo").expect("parse");
    match &drafts[0].transport {
        McpTransportConfig::Stdio { command, args, .. } => {
            assert_eq!(command, "uvx");
            assert_eq!(args, &vec!["mcp-server-git", "--repository", "/repo"]);
        }
        _ => panic!("expected stdio"),
    }
}

#[test]
fn upsert_writes_registry_and_redacts_env() {
    let temp = tempfile::tempdir().expect("tempdir");
    let result = upsert_mcp_servers_at(
        temp.path(),
        json!({
            "id": "test",
            "name": "Test MCP",
            "command": "node",
            "args": ["server.js"],
            "env": { "API_KEY": "secret" }
        }),
    )
    .expect("upsert");
    assert_eq!(
        result.pointer("/server/id").and_then(Value::as_str),
        Some("test")
    );
    assert_eq!(
        result
            .pointer("/server/transport/env/API_KEY")
            .and_then(Value::as_str),
        Some("<configured>")
    );
    let registry = read_registry_from(temp.path());
    assert_eq!(registry.servers.len(), 1);
    match &registry.servers[0].transport {
        McpTransportConfig::Stdio { env, .. } => {
            assert_eq!(env.get("API_KEY").map(String::as_str), Some("secret"));
        }
        _ => panic!("expected stdio"),
    }
}

#[test]
fn upsert_preserves_redacted_env_placeholders() {
    let temp = tempfile::tempdir().expect("tempdir");
    let _ = upsert_mcp_servers_at(
        temp.path(),
        json!({
            "id": "git",
            "name": "Git",
            "command": "uvx",
            "args": ["mcp-server-git"],
            "env": { "TOKEN": "secret" }
        }),
    )
    .expect("initial upsert");
    let _ = upsert_mcp_servers_at(
        temp.path(),
        json!({
            "serverId": "git",
            "name": "Git Tools",
            "command": "uvx",
            "args": "mcp-server-git --repository /repo",
            "env": "TOKEN=<configured>\nDEBUG=1"
        }),
    )
    .expect("edit upsert");
    let registry = read_registry_from(temp.path());
    match &registry.servers[0].transport {
        McpTransportConfig::Stdio { env, .. } => {
            assert_eq!(env.get("TOKEN").map(String::as_str), Some("secret"));
            assert_eq!(env.get("DEBUG").map(String::as_str), Some("1"));
        }
        _ => panic!("expected stdio"),
    }
}

#[test]
fn resolves_remote_headers_for_the_sdk_transport() {
    let server = McpServerConfig {
        id: "remote".to_string(),
        name: "Remote".to_string(),
        transport: McpTransportConfig::Http {
            url: "https://example.test/mcp".to_string(),
            headers: BTreeMap::from([("x-lyra-test".to_string(), "yes".to_string())]),
            secret_headers: BTreeMap::new(),
            env_http_headers: BTreeMap::new(),
            bearer_token_env_var: None,
        },
        enabled: true,
        startup_timeout_ms: None,
        tool_timeout_ms: None,
        state: "disconnected".to_string(),
        tools: Vec::new(),
        last_error: None,
        created_at: now(),
        updated_at: now(),
    };

    let headers = resolved_remote_headers(&server).expect("headers");
    assert_eq!(
        headers
            .get(&HeaderName::from_static("x-lyra-test"))
            .and_then(|value| value.to_str().ok()),
        Some("yes")
    );
}

#[test]
fn recognizes_protocol_authentication_failures_without_treating_other_errors_as_auth() {
    assert!(is_mcp_authentication_error("HTTP 401 Unauthorized"));
    assert!(is_mcp_authentication_error("authentication required"));
    assert!(!is_mcp_authentication_error("HTTP 500 server failure"));
}
