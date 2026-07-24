use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use uuid::Uuid;

use crate::{AgentRuntimeError, AgentRuntimeResult, native_backend::provider::ModelToolCall};

#[derive(Clone, Debug, Default)]
pub(crate) struct StreamingToolCallAccumulator {
    pub(crate) id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) arguments: String,
}

pub(crate) fn tool_name_set(tools: &[Value]) -> HashSet<String> {
    tools
        .iter()
        .filter_map(|tool| tool.pointer("/function/name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

pub(crate) fn parse_tool_call(
    value: &Value,
    allowed_tool_names: &HashSet<String>,
) -> Option<ModelToolCall> {
    let function = value.get("function")?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .and_then(|name| repair_tool_name(name, allowed_tool_names))?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_tool_call_id(id))
        .map(|id| id.trim().to_string())
        .unwrap_or_else(|| format!("tool-{}", Uuid::new_v4()));
    let arguments = match function.get("arguments") {
        Some(Value::String(text)) => parse_tool_arguments(text),
        Some(value) => value.clone(),
        None => json!({}),
    };
    Some(ModelToolCall {
        id,
        name,
        arguments,
    })
}

pub(crate) fn finalize_streaming_tool_calls(
    tool_calls: HashMap<usize, StreamingToolCallAccumulator>,
    allowed_tool_names: &HashSet<String>,
) -> AgentRuntimeResult<Vec<(usize, ModelToolCall)>> {
    let mut finalized = Vec::new();
    for (index, accumulator) in tool_calls {
        let has_tool_payload = accumulator.id.is_some()
            || accumulator.name.is_some()
            || !accumulator.arguments.trim().is_empty();
        if !has_tool_payload {
            continue;
        }
        let Some(name) = accumulator
            .name
            .as_deref()
            .and_then(|name| repair_tool_name(name, allowed_tool_names))
        else {
            return Err(AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                detail: "provider returned incomplete tool call: missing function name".to_string(),
            });
        };
        finalized.push((
            index,
            ModelToolCall {
                id: accumulator
                    .id
                    .filter(|id| is_valid_tool_call_id(id))
                    .unwrap_or_else(|| format!("tool-{}", Uuid::new_v4())),
                name,
                arguments: parse_tool_arguments(&accumulator.arguments),
            },
        ));
    }
    Ok(finalized)
}

pub(crate) fn repair_tool_name(name: &str, allowed_tool_names: &HashSet<String>) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || allowed_tool_names.is_empty() {
        return None;
    }
    if allowed_tool_names.contains(trimmed) {
        return Some(trimmed.to_string());
    }
    let lowercase = trimmed.to_ascii_lowercase();
    if allowed_tool_names.contains(&lowercase) {
        return Some(lowercase);
    }
    None
}

pub(crate) fn is_valid_tool_call_id(id: &str) -> bool {
    let value = id.trim();
    !value.is_empty() && value != "null"
}

pub(crate) fn parse_tool_arguments(arguments: &str) -> Value {
    let text = arguments.trim();
    if text.is_empty() {
        return json!({});
    }
    serde_json::from_str(text).unwrap_or_else(
        |error| json!({ "rawArguments": arguments, "parseError": error.to_string() }),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn tool_parser_repairs_case_and_preserves_bad_arguments() {
        let allowed = HashSet::from(["tool_fs_run".to_string()]);
        let parsed = parse_tool_call(
            &json!({
                "id": "call-1",
                "function": {
                    "name": "TOOL_FS_RUN",
                    "arguments": "{bad"
                }
            }),
            &allowed,
        )
        .expect("tool call");

        assert_eq!(parsed.name, "tool_fs_run");
        assert_eq!(parsed.arguments["rawArguments"], "{bad");
    }
}
