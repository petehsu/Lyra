use super::*;

pub(crate) async fn execute_mcp_tool_adapter(
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
    let project_root = projects::session_root(session_id);
    let scoped_arguments = arguments.clone();
    // execute_mcp_state_change runs blocking I/O (reqwest::blocking for HTTP
    // transports, std process I/O for stdio, sync SQLite for the registry).
    // Calling it directly on the async worker thread either panics (blocking
    // reqwest drops a nested tokio runtime inside the runtime context —
    // "Cannot drop a runtime in a context where blocking is not allowed") or
    // stalls the executor. Run it on a blocking thread, mirroring the
    // elevated-helper pattern in shell.rs.
    let tool_name_owned = tool_name.to_string();
    let raw_result = match tokio::task::spawn_blocking(move || {
        mcp_catalog::execute_for_project(
            &tool_name_owned,
            &scoped_arguments,
            project_root?.as_deref(),
        )
    })
    .await
    {
        Ok(result) => result,
        Err(join_error) => Err(AgentRuntimeError::Core(format!(
            "MCP tool worker panicked: {join_error}"
        ))),
    };
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_mcp_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": error.to_string(),
                "error": {
                    "code": "mcpToolFailed",
                    "message": error.to_string(),
                }
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "mcp",
            &tool_label("mcp", action),
            status,
            arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

/// Execute a dynamic MCP capability manifest
/// (`/tools/mcp/capability/<serverId>/<toolName>`). serverId and toolName
/// come from the manifest path; `arguments` carries the tool arguments under
/// `arguments` (the manifest schema's only field). Routes to
/// `mcp_tool_execute` on a blocking thread — same I/O constraints as
/// `execute_mcp_tool_adapter`.
pub(crate) async fn execute_mcp_capability_tool_adapter(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    server_id: String,
    tool_name: String,
    arguments: Value,
    started_at: &str,
) -> Value {
    let action = "invoke_capability";
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
    // Merge the manifest-resolved identity into the payload. Callers may
    // already have supplied serverId/toolName — the manifest wins.
    let mut payload = arguments;
    if let Some(object) = payload.as_object_mut() {
        object.insert("serverId".to_string(), json!(server_id));
        object.insert("toolName".to_string(), json!(tool_name));
    }
    let project_root = projects::session_root(session_id);
    let raw_result = match tokio::task::spawn_blocking(move || {
        mcp_catalog::execute_for_project("mcp_tool_execute", &payload, project_root?.as_deref())
    })
    .await
    {
        Ok(result) => result,
        Err(join_error) => Err(AgentRuntimeError::Core(format!(
            "MCP capability worker panicked: {join_error}"
        ))),
    };
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_mcp_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": error.to_string(),
                "error": {
                    "code": "mcpToolFailed",
                    "message": error.to_string(),
                }
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "mcp",
            &tool_label("mcp", action),
            status,
            json!({}),
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}
