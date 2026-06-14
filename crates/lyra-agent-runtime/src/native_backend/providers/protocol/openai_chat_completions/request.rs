use serde_json::{Value, json};

pub(crate) fn build_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = Value::String("auto".to_string());
    }
    body
}
