use super::*;

#[test]
fn tool_fs_design_skills_and_mcp_are_discoverable_inspectable_and_runnable() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Runtime Domain Tool-FS Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let cancellation = Arc::new(AtomicBool::new(false));

    let design_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-design-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/design" }),
        },
    );
    assert_eq!(design_directory["status"].as_str(), Some("completed"));
    assert!(
        design_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/design/search_styles")
            }))
    );
    let design_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-design-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/design/search_styles" }),
        },
    );
    assert_eq!(
        design_manifest
            .pointer("/raw/title")
            .and_then(Value::as_str),
        Some("Search design styles")
    );

    let skill_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-skill-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/skills" }),
        },
    );
    assert!(
        skill_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/skills/activate")
            }))
    );
    let skill_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-skill-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/skills/inspect" }),
        },
    );
    assert_eq!(
        skill_manifest.pointer("/raw/title").and_then(Value::as_str),
        Some("Inspect skill")
    );
    assert!(
        skill_manifest
            .pointer("/raw/inputSchema/$id")
            .and_then(Value::as_str)
            .is_some_and(|schema_id| schema_id.contains("/tools/skills/inspect/input"))
    );

    let design_search = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-design-search",
            "/tools/design/search_styles",
            json!({ "query": "dashboard", "limit": 1 }),
        ),
    );
    assert_eq!(design_search["status"].as_str(), Some("completed"));
    assert_eq!(
        design_search["toolPath"].as_str(),
        Some("/tools/design/search_styles")
    );
    assert!(
        design_search["content"]
            .as_str()
            .expect("design content")
            .contains("Lyra design references")
    );

    let skill_activate = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call(
            "tool-skill-activate",
            "/tools/skills/activate",
            json!({ "skillId": "lyra-design-research" }),
        ),
    );
    assert_eq!(skill_activate["status"].as_str(), Some("completed"));
    assert_eq!(
        skill_activate["raw"]["skill"]["active"].as_bool(),
        Some(true)
    );
    assert!(
        skill_activate["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "runtime"
                    && change["operation"] == "activate"
                    && change["path"] == "/tools/skills/activate"
            }))
    );
    assert!(
        state()
            .lock()
            .expect("state lock")
            .active_skills
            .contains("lyra-design-research")
    );

    let mcp_directory = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-mcp-list".to_string(),
            name: "tool_fs_list".to_string(),
            arguments: json!({ "path": "/tools/mcp" }),
        },
    );
    assert!(
        mcp_directory
            .pointer("/raw/tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| {
                tool.get("path").and_then(Value::as_str) == Some("/tools/mcp/server_list")
            }))
    );
    let mcp_manifest = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        ModelToolCall {
            id: "tool-mcp-inspect".to_string(),
            name: "tool_fs_inspect".to_string(),
            arguments: json!({ "path": "/tools/mcp/server_list" }),
        },
    );
    assert_eq!(
        mcp_manifest.pointer("/raw/title").and_then(Value::as_str),
        Some("List MCP servers")
    );
    let mcp_list = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &cancellation,
        tool_fs_run_call("tool-mcp-server-list", "/tools/mcp/server_list", json!({})),
    );
    assert_eq!(mcp_list["status"].as_str(), Some("failed"));
    assert_eq!(
        mcp_list.pointer("/error/code").and_then(Value::as_str),
        Some("no_configured_mcp_servers")
    );
    assert_eq!(
        mcp_list["notRunReason"].as_str(),
        Some("no_configured_mcp_servers")
    );
    assert_eq!(mcp_list["raw"]["available"].as_bool(), Some(false));
}
