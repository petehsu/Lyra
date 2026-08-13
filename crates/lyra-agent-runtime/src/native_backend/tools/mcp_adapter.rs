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
    let mut scoped_arguments = arguments.clone();
    if let Ok(project_root) = session_workspace_root(session_id) {
        scoped_arguments["projectRoot"] = Value::String(project_root.to_string_lossy().to_string());
    }
    let raw_result = execute_mcp_state_change(tool_name, &scoped_arguments);
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
                "content": error.clone(),
                "error": {
                    "code": "mcpToolFailed",
                    "message": error,
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
