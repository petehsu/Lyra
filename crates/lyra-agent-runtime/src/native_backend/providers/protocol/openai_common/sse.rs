use serde_json::Value;

use crate::{AgentRuntimeError, AgentRuntimeResult};

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum SseEvent {
    Data(Value),
    Done,
}

pub(crate) fn parse_sse_line(line: &str) -> AgentRuntimeResult<Option<SseEvent>> {
    let Some(data) = line.trim().strip_prefix("data:") else {
        return Ok(None);
    };
    let data = data.trim();
    if data.is_empty() {
        return Ok(None);
    }
    if data == "[DONE]" {
        return Ok(Some(SseEvent::Done));
    }
    let value = serde_json::from_str(data)
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
    Ok(Some(SseEvent::Data(value)))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_openai_sse_data_lines() {
        assert_eq!(parse_sse_line(": ping").expect("comment"), None);
        assert_eq!(
            parse_sse_line("data: [DONE]").expect("done"),
            Some(SseEvent::Done)
        );
        assert_eq!(
            parse_sse_line(r#"data: {"type":"response.completed"}"#).expect("json"),
            Some(SseEvent::Data(json!({ "type": "response.completed" })))
        );
    }
}
