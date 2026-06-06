use super::*;

pub(crate) fn execute_design_tool_adapter(
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
            "lyra_design",
            &tool_label("lyra_design", action),
            "running",
            arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw = design_tools::execute_design_tool(tool_name, &arguments);
    let output = json!({
        "content": format_design_output(action, &raw),
        "raw": raw,
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "lyra_design",
            &tool_label("lyra_design", action),
            "completed",
            arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}
