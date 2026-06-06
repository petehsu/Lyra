use super::*;

pub(crate) fn execute_memory_tool_adapter(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    let input = memory_tool_input(tool_name, arguments);
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "memory",
            &tool_label("memory", action),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let raw_result = match tool_name {
        "memory_remember" => long_term_memory_create(input.clone()),
        "memory_search" => long_term_memory_search(input.clone()),
        "memory_update" => long_term_memory_update(input.clone()),
        "memory_forget" => long_term_memory_forget(input.clone()),
        "memory_list" => long_term_memory_list(input.clone()),
        "memory_link" => long_term_memory_link(input.clone()),
        "memory_review_candidates" => memory_review_candidates(input.clone()),
        "memory_apply_candidate" => memory_apply_candidate(input.clone()),
        "memory_reject_candidate" => memory_reject_candidate(input.clone()),
        "memory_explain_injection" => memory_explain_injection(input.clone()),
        _ => Err(AgentRuntimeError::Core(format!(
            "unknown memory tool: {tool_name}"
        ))),
    };
    let (status, output) = match raw_result {
        Ok(value) => (
            "completed",
            json!({
                "content": format_memory_output(action, &value),
                "raw": value,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": format!("Lyra memory tool failed: {error}"),
                "error": error.to_string(),
            }),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "memory",
            &tool_label("memory", action),
            status,
            input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

pub(crate) fn memory_tool_input(name: &str, arguments: Value) -> Value {
    let mut input = arguments.as_object().cloned().unwrap_or_default();
    if name == "memory_remember" {
        input
            .entry("scope".to_string())
            .or_insert_with(|| Value::String("global".to_string()));
        input
            .entry("category".to_string())
            .or_insert_with(|| Value::String("other".to_string()));
        input
            .entry("sourceType".to_string())
            .or_insert_with(|| Value::String("agent_inference".to_string()));
    }
    input.insert(
        "action".to_string(),
        Value::String(memory_action_name(name).to_string()),
    );
    Value::Object(input)
}

fn memory_action_name(name: &str) -> &'static str {
    match name {
        "memory_remember" => "remember",
        "memory_update" => "update",
        "memory_forget" => "forget",
        "memory_list" => "list",
        "memory_link" => "link",
        "memory_review_candidates" => "review_candidates",
        "memory_apply_candidate" => "apply_candidate",
        "memory_reject_candidate" => "reject_candidate",
        "memory_explain_injection" => "explain_injection",
        _ => "search",
    }
}
