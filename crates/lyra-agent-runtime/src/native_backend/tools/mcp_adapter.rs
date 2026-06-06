use super::*;

pub(crate) fn execute_mcp_tool_adapter(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "mcp",
            &tool_label("mcp", action),
            "running",
            arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let output = json!({
        "content": "No Lyra MCP servers are configured in this native runtime instance. Use mcp_server_list to verify server availability, then connect or configure a server before execution.",
        "error": {
            "code": "no_configured_mcp_servers",
            "message": "No Lyra MCP servers are configured in this native runtime instance.",
        },
        "raw": {
            "ok": false,
            "servers": [],
            "tools": [],
            "available": false,
            "reason": "no_configured_mcp_servers",
            "requestedTool": tool_name,
        }
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "mcp",
            &tool_label("mcp", action),
            "failed",
            arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}
