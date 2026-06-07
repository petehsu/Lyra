//! Stateless query & value-extraction helpers.
//!
//! Pure helpers over `serde_json::Value` and the `memory` module used by the
//! session API to read command records, extract typed fields, match status /
//! text projections, and build event references. No session-runtime state.

use serde_json::Value;

use crate::memory;
use crate::tui_act::TuiActPlan;
use crate::{to_error, Result};
use crate::{
    write_session, TerminalCommandSnapshot, TerminalContractEventRef, TerminalNumberRange,
    TerminalWriteRequest,
};

pub(crate) fn memory_json(storage_root: &str, session_id: &str, truncated: bool) -> Option<String> {
    memory::metadata_for_session(storage_root, session_id, truncated).ok()
}

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

pub(crate) fn command_records(storage_root: &str, session_id: &str) -> Result<Vec<Value>> {
    let raw = memory::read_commands(memory::CommandsReadInput {
        storage_root: storage_root.to_string(),
        session_id: session_id.to_string(),
        cursor: None,
        limit: Some(500),
        status: None,
        audit: None,
        actor_json: None,
        correlation_json: None,
    })
    .map_err(to_error)?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| to_error(error.to_string()))?;
    Ok(value
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

pub(crate) fn latest_command_record(
    storage_root: &str,
    session_id: &str,
    command_id: Option<&str>,
) -> Result<Option<Value>> {
    let mut records = command_records(storage_root, session_id)?;
    records.sort_by_key(|record| value_u64(record, "commandSeq").unwrap_or(0));
    Ok(records.into_iter().rev().find(|record| {
        command_id
            .map(|command_id| value_string(record, "commandId").as_deref() == Some(command_id))
            .unwrap_or(true)
    }))
}

pub(crate) fn command_snapshot_from_record(
    record: &Value,
    fallback_session_id: &str,
) -> Option<TerminalCommandSnapshot> {
    Some(TerminalCommandSnapshot {
        command_id: value_string(record, "commandId")?,
        session_id: value_string(record, "terminalSessionId")
            .unwrap_or_else(|| fallback_session_id.to_string()),
        command_text: value_string(record, "commandText"),
        normalized_command_text: value_string(record, "normalizedCommandText"),
        status: value_string(record, "status").unwrap_or_else(|| "unknown".to_string()),
        exit_code: value_i32(record, "exitCode"),
        signal: value_string(record, "signal"),
        submitted_at: value_string(record, "submittedAt"),
        started_at: value_string(record, "startedAt"),
        completed_at: value_string(record, "completedAt"),
        duration_ms: value_f64(record, "durationMs"),
        cwd_before: value_string(record, "cwdBefore"),
        cwd_after: value_string(record, "cwdAfter"),
        output_range: range_from_value(record.get("outputTextRange")),
        raw_output_range: range_from_value(record.get("rawOutputRange")),
        screen_version_range: range_from_value(record.get("screenVersionRange")),
        artifact_root_path: value_string(record, "artifactRootPath"),
        command_meta_path: value_string(record, "commandMetaPath"),
        command_output_text_path: value_string(record, "commandOutputTextPath"),
        command_raw_output_path: value_string(record, "commandRawOutputPath"),
        command_events_path: value_string(record, "commandEventsPath"),
        command_summary_path: value_string(record, "commandSummaryPath"),
        confidence: record.get("confidence").and_then(Value::as_f64),
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

pub(crate) fn tui_plan_correlation(
    correlation_json: Option<String>,
    plan: &TuiActPlan,
) -> Option<String> {
    let mut correlation = correlation_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(region_id) = plan.region_id.as_deref() {
        correlation
            .entry("regionId".to_string())
            .or_insert_with(|| Value::String(region_id.to_string()));
    }
    correlation
        .entry("screenCursor".to_string())
        .or_insert_with(|| Value::String(plan.screen_cursor.clone()));
    correlation.insert(
        "terminalAct".to_string(),
        serde_json::json!({
            "regionId": plan.region_id.clone(),
            "screenCursor": plan.screen_cursor,
            "risk": plan.risk,
            "target": plan.target.clone(),
            "reason": plan.reason.clone()
        }),
    );
    Some(Value::Object(correlation).to_string())
}
