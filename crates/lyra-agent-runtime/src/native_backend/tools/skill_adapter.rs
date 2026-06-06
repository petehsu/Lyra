use super::*;

pub(crate) fn execute_skill_tool_adapter(
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
            "skills",
            &tool_label("skills", action),
            "running",
            arguments.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw_result = execute_skill_state_change(tool_name, &arguments);
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_skill_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": error.clone(),
                "error": {
                    "code": "skillToolFailed",
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
            "skills",
            &tool_label("skills", action),
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
