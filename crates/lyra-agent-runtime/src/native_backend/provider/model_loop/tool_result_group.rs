use super::*;

/// Close every assistant `tool_calls` group before any other role is sent.
///
/// OpenAI-compatible providers reject a request when a user or assistant message
/// lands before each `tool_call_id` has a tool result. Images and other
/// attachments stay in the transcript, but they move to after the closed group.
/// A call that never received a result gets one tool message so the group is
/// still complete.
pub(crate) fn seal_tool_result_groups(messages: &mut Vec<Value>) {
    if messages.len() < 2 {
        return;
    }
    let original = std::mem::take(messages);
    let mut sealed = Vec::with_capacity(original.len());
    let mut index = 0;
    while index < original.len() {
        let message = original[index].clone();
        let required = tool_call_ids(&message);
        sealed.push(message);
        index += 1;
        if required.is_empty() {
            continue;
        }
        let mut answered = Vec::new();
        let mut region = Vec::new();
        let mut deferred = Vec::new();
        while index < original.len() && answered.len() < required.len() {
            if is_next_assistant(&original[index]) {
                break;
            }
            if let Some(id) = answered_tool_call_id(&original[index]) {
                if required.iter().any(|required_id| required_id == &id)
                    && !answered.iter().any(|seen| seen == &id)
                {
                    answered.push(id);
                }
                region.push(original[index].clone());
                index += 1;
                continue;
            }
            if is_tool_region_message(&original[index]) {
                region.push(original[index].clone());
                index += 1;
                continue;
            }
            deferred.push(original[index].clone());
            index += 1;
        }
        for id in &required {
            if answered.iter().any(|seen| seen == id) {
                continue;
            }
            region.push(json!({
                "role": "tool",
                "tool_call_id": id,
                "content": "Tool result was not attached.",
            }));
        }
        sealed.extend(region);
        sealed.extend(deferred);
    }
    *messages = sealed;
}

fn tool_call_ids(message: &Value) -> Vec<String> {
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|call| call.get("id").and_then(Value::as_str))
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_next_assistant(message: &Value) -> bool {
    message.get("role").and_then(Value::as_str) == Some("assistant")
}

fn is_tool_region_message(message: &Value) -> bool {
    message.get("role").and_then(Value::as_str) == Some("tool")
        || matches!(
            message.get("type").and_then(Value::as_str),
            Some("function_call" | "function_call_output")
        )
}

fn answered_tool_call_id(message: &Value) -> Option<String> {
    let id = if message.get("role").and_then(Value::as_str) == Some("tool") {
        message
            .get("tool_call_id")
            .or_else(|| message.get("toolCallId"))
            .and_then(Value::as_str)
    } else if message.get("type").and_then(Value::as_str) == Some("function_call_output") {
        message
            .get("call_id")
            .or_else(|| message.get("callId"))
            .and_then(Value::as_str)
    } else {
        None
    }?;
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roles(messages: &[Value]) -> Vec<String> {
        messages
            .iter()
            .map(|message| {
                message
                    .get("role")
                    .or_else(|| message.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("?")
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn image_between_parallel_tool_results_moves_after_the_group() {
        let mut messages = vec![
            json!({
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "call-see", "type": "function", "function": {"name": "browser_see", "arguments": "{}"}},
                    {"id": "call-fetch", "type": "function", "function": {"name": "web_fetch", "arguments": "{}"}}
                ]
            }),
            json!({"role": "tool", "tool_call_id": "call-see", "content": "captured"}),
            json!({"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,a"}}]}),
            json!({"role": "tool", "tool_call_id": "call-fetch", "content": "page"}),
        ];
        seal_tool_result_groups(&mut messages);
        assert_eq!(roles(&messages), vec!["assistant", "tool", "tool", "user"]);
        assert_eq!(messages[1]["tool_call_id"], "call-see");
        assert_eq!(messages[2]["tool_call_id"], "call-fetch");
        assert_eq!(messages[3]["role"], "user");
    }

    #[test]
    fn missing_tool_result_is_closed_before_the_next_message() {
        let mut messages = vec![
            json!({
                "role": "assistant",
                "tool_calls": [
                    {"id": "call-a", "type": "function"},
                    {"id": "call-b", "type": "function"}
                ]
            }),
            json!({"role": "tool", "tool_call_id": "call-a", "content": "ok"}),
            json!({"role": "user", "content": "next"}),
        ];
        seal_tool_result_groups(&mut messages);
        assert_eq!(roles(&messages), vec!["assistant", "tool", "tool", "user"]);
        assert_eq!(messages[2]["tool_call_id"], "call-b");
        assert_eq!(messages[2]["content"], "Tool result was not attached.");
        assert_eq!(messages[3]["content"], "next");
    }
}
