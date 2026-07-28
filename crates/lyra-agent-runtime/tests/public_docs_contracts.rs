use lyra_agent_runtime::{AgentRuntimeBackend, LyraAgentBackend};
use serde_json::{Value, json};
use std::{env, fs, path::PathBuf};

fn public_fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/docs/public/examples/v1")
}

#[test]
fn public_mcp_and_skill_fixtures_work_through_the_production_paths() {
    let fixture_root = public_fixture_root();
    let temporary = tempfile::tempdir().expect("create isolated contract storage");
    let mcp_home = temporary.path().join("mcp");
    let skills_home = temporary.path().join("skills");

    // This integration-test process contains a single test. Set the storage
    // roots before the production backend initializes any global state.
    unsafe {
        env::set_var("LYRA_MCP_HOME", &mcp_home);
        env::set_var("LYRA_SKILLS_HOME", &skills_home);
        env::set_var("LYRA_AGENT_HOME", temporary.path().join("agent"));
    }

    let mut mcp_payload: Value = serde_json::from_str(
        &fs::read_to_string(fixture_root.join("mcp-config.json"))
            .expect("read documented MCP fixture"),
    )
    .expect("documented MCP fixture is JSON");
    let mock_server = fixture_root
        .join("mcp/mock-server.mjs")
        .canonicalize()
        .expect("resolve documented MCP mock server");
    *mcp_payload
        .pointer_mut("/mcpServers/fixture-stdio/args/0")
        .expect("documented stdio fixture has a command argument") =
        json!(mock_server.to_string_lossy());

    let mcp_result = LyraAgentBackend
        .call_agent_method("agent.mcp.upsert", mcp_payload)
        .expect("production MCP parser accepts documented fixture");
    let servers = mcp_result["servers"]
        .as_array()
        .expect("MCP upsert returns servers");
    assert!(
        !servers.is_empty(),
        "fixture must configure at least one server"
    );
    assert!(
        servers.iter().all(|server| server["transport"].is_object()),
        "every documented MCP server must produce a transport"
    );
    let stdio_server_id = servers
        .iter()
        .find(|server| server["enabled"] == true && server["transport"]["kind"] == "stdio")
        .and_then(|server| server["id"].as_str())
        .expect("documented fixture produces one enabled stdio server")
        .to_string();

    let connect_result = LyraAgentBackend
        .call_agent_method(
            "agent.mcp.connect",
            json!({ "serverId": stdio_server_id, "timeoutMs": 5_000 }),
        )
        .expect("production MCP client connects to documented stdio fixture");
    let connected_server = connect_result["servers"]
        .as_array()
        .and_then(|items| items.first())
        .expect("MCP connect returns the documented server");
    assert_eq!(
        connected_server["state"], "connected",
        "documented stdio fixture must complete the production initialize handshake"
    );
    assert!(
        connected_server["tools"]
            .as_array()
            .is_some_and(|tools| tools.iter().any(|tool| tool["name"] == "fixture.echo")),
        "production tools/list must discover the documented fixture tool"
    );

    let discovered = LyraAgentBackend
        .call_agent_method(
            "agent.mcp.discoverTools",
            json!({
                "serverId": stdio_server_id,
                "query": "echo",
                "timeoutMs": 5_000
            }),
        )
        .expect("production MCP discovery reads documented fixture tools");
    assert!(
        discovered["tools"]
            .as_array()
            .is_some_and(|tools| tools.iter().any(|tool| tool["name"] == "fixture.echo")),
        "production discovery must return the documented fixture tool"
    );

    let execute_result = LyraAgentBackend
        .call_agent_method(
            "agent.mcp.executeTool",
            json!({
                "serverId": stdio_server_id,
                "toolName": "fixture.echo",
                "arguments": { "text": "Lyra MCP production smoke" },
                "timeoutMs": 5_000
            }),
        )
        .expect("production MCP client executes the documented fixture tool");
    assert_eq!(
        execute_result["result"]["content"][0]["text"], "Lyra MCP production smoke",
        "production tools/call must return the documented fixture result"
    );
    assert!(
        execute_result["result"]["fixtureMethods"]
            .as_array()
            .is_some_and(|methods| {
                methods.iter().any(|method| method == "initialize")
                    && methods
                        .iter()
                        .any(|method| method == "notifications/initialized")
                    && methods.iter().any(|method| method == "tools/call")
            }),
        "production execution must initialize the MCP session before tools/call"
    );

    let skill_result = LyraAgentBackend
        .call_agent_method(
            "agent.skills.installFromLocal",
            json!({ "sourcePath": fixture_root.join("SKILL.md") }),
        )
        .expect("production Skill parser accepts documented fixture");
    let skill = skill_result["skill"]
        .as_object()
        .expect("Skill installation returns a skill");
    assert!(
        skill.get("id").and_then(Value::as_str).is_some(),
        "documented Skill fixture must resolve an id"
    );
    assert!(
        skill
            .get("prompt")
            .and_then(Value::as_str)
            .is_some_and(|prompt| !prompt.trim().is_empty()),
        "documented Skill fixture must contain instructions"
    );
    assert!(
        skill.get("permissions").is_some_and(Value::is_array),
        "documented declarative permissions must parse as an array"
    );
}
