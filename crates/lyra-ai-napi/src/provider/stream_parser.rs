use napi::Result;
use serde::Deserialize;

use crate::error::to_error;

#[derive(Debug, PartialEq, Eq)]
pub enum StreamEvent {
    Delta(String),
    Done,
}

#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

pub fn parse_stream_event(line: &str) -> Result<Option<StreamEvent>> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return Ok(None);
    }
    let Some(payload) = trimmed.strip_prefix("data:") else {
        return Ok(None);
    };
    let json_payload = payload.trim();
    if json_payload == "[DONE]" {
        return Ok(Some(StreamEvent::Done));
    }

    let parsed: StreamChunk = serde_json::from_str(json_payload)
        .map_err(|error| to_error(format!("failed to parse streaming response chunk: {error}")))?;
    let delta = parsed
        .choices
        .into_iter()
        .filter_map(|choice| choice.delta.content)
        .collect::<String>();
    if delta.is_empty() {
        return Ok(None);
    }
    Ok(Some(StreamEvent::Delta(delta)))
}
