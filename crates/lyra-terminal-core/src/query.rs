//! Stateless query & value-extraction helpers.

use serde_json::Value;

use crate::{to_error, Result};
use crate::{write_session, TerminalContractEventRef, TerminalNumberRange, TerminalWriteRequest};

pub(crate) fn correlation_permission_id(correlation_json: Option<&str>) -> Option<String> {
    correlation_json
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| {
            value
                .get("permissionId")
                .or_else(|| value.get("permission_id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

pub(crate) fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn value_i32(value: &Value, key: &str) -> Option<i32> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
}

pub(crate) fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

pub(crate) fn value_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).or_else(|| {
        value
            .get(key)
            .and_then(Value::as_u64)
            .map(|value| value as f64)
    })
}

pub(crate) fn range_from_value(value: Option<&Value>) -> Option<TerminalNumberRange> {
    let value = value?;
    Some(TerminalNumberRange {
        start: value_f64(value, "start")?,
        end: value_f64(value, "end")?,
    })
}

pub(crate) fn status_is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

pub(crate) fn status_matches(actual: &str, desired: Option<&str>) -> bool {
    match desired.unwrap_or("any") {
        "any" => status_is_terminal(actual),
        "notRunning" => status_is_terminal(actual) || actual == "unknown",
        desired => actual == desired,
    }
}

pub(crate) fn text_projection_matches(
    text: &str,
    needle: Option<&str>,
    regex: Option<&str>,
) -> bool {
    if let Some(needle) = needle.map(str::trim).filter(|value| !value.is_empty()) {
        if text.contains(needle) {
            return true;
        }
    }
    if let Some(pattern) = regex.map(str::trim).filter(|value| !value.is_empty()) {
        if regex::Regex::new(pattern)
            .ok()
            .is_some_and(|compiled| compiled.is_match(text))
        {
            return true;
        }
    }
    needle.is_none_or(str::is_empty) && regex.is_none_or(str::is_empty) && !text.is_empty()
}

pub(crate) fn event_ref(kind: &str) -> TerminalContractEventRef {
    TerminalContractEventRef {
        event_id: None,
        kind: kind.to_string(),
        seq: None,
    }
}

pub(crate) fn write_semantic_payload(
    session_id: &str,
    storage_root: Option<String>,
    actor_json: Option<String>,
    correlation_json: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: bool,
) -> Result<()> {
    write_session(TerminalWriteRequest {
        session_id: session_id.to_string(),
        data: None,
        text,
        keys,
        append_newline: Some(append_newline),
        source: Some("agent".to_string()),
        storage_root,
        actor_json,
        correlation_json,
    })
}