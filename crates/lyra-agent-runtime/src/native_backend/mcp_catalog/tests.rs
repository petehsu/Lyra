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
fn parses_streamable_http_sse_response() {
    let values = parse_http_mcp_body(
        "text/event-stream",
        "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n\n",
    )
    .expect("parse");
    assert_eq!(values[0].get("id").and_then(Value::as_i64), Some(1));
}
