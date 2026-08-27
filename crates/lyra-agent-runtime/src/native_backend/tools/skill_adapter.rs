use super::*;

pub(crate) async fn execute_skill_tool_adapter(
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
    // execute_skill_state_change performs blocking I/O (blocking reqwest for
    // store fetch/install, git and process work in install paths). Run it on
    // a blocking thread — same rationale as mcp_adapter.
    let tool_name_owned = tool_name.to_string();
    let task_arguments = arguments.clone();
    let raw_result =
        match tokio::task::spawn_blocking(move || {
            execute_skill_state_change(&tool_name_owned, &task_arguments)
                .map_err(AgentRuntimeError::Core)
        })
        .await
        {
            Ok(result) => result,
            Err(join_error) => Err(AgentRuntimeError::Core(format!(
                "Skill tool worker panicked: {join_error}"
            ))),
        };
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
                "content": error.to_string(),
                "error": {
                    "code": "skillToolFailed",
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
