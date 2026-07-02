use super::*;

pub(crate) const LYRA_CLARIFICATION_ASK_TOOL: &str = "lyra_clarification_ask";

pub(crate) fn execute_clarification_tool_adapter(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    let question = arguments
        .get("question")
        .and_then(Value::as_str)
        .unwrap_or("What should Lyra Agent do next?")
        .trim()
        .to_string();
    let options = arguments
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let allow_custom_answer = arguments
        .get("allowCustomAnswer")
        .or_else(|| arguments.get("allow_custom_answer"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let detail = string_opt(&arguments, "detail");
    let input = json!({
        "question": question,
        "options": options,
        "allowCustomAnswer": allow_custom_answer,
        "detail": detail,
    });
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "clarification",
            &tool_label("clarification", "ask"),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let request = ClarificationRequest {
        id: format!("clarification-{}", Uuid::new_v4()),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        question,
        i18n_key: None,
        options,
        allow_custom_answer,
        detail,
        detail_i18n_key: None,
        status: "pending".to_string(),
        answer: None,
        selected_option: None,
        created_at: now(),
        responded_at: None,
    };
    let wait_result = wait_for_clarification(request);
    let (status, output) = match wait_result {
        Ok(request) => (
            "completed",
            json!({
                "content": format!(
                    "User answered clarification: {}",
                    request.answer.clone().unwrap_or_default()
                ),
                "answer": request.answer,
                "selectedOption": request.selected_option,
                "clarificationId": request.id,
            }),
        ),
        Err(error) => (
            "failed",
            json!({
                "content": format!("Clarification failed: {error}"),
                "error": {
                    "code": "clarificationFailed",
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
            "clarification",
            &tool_label("clarification", "ask"),
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
