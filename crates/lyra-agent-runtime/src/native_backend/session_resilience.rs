use super::{NativeSession, Value, now};
use serde_json::json;
use uuid::Uuid;

const MAX_TASK_MILESTONES: usize = 24;
const MAX_CONSECUTIVE_FAILED_BEFORE_RECOVERY: usize = 3;

pub(crate) fn init_session_resilience_fields(snapshot: &mut Value) {
    if !snapshot.get("sessionResilience").is_some_and(Value::is_object) {
        snapshot["sessionResilience"] = json!({
            "blockedBrowser": Value::Null,
            "lastInterruptReason": Value::Null,
            "consecutiveFailedRecoverable": 0,
            "updatedAt": Value::Null
        });
    }
    if !snapshot.get("taskMilestones").is_some_and(Value::is_array) {
        snapshot["taskMilestones"] = json!([]);
    }
}

pub(crate) fn consecutive_failed_recoverable_count(session: &NativeSession) -> usize {
    session
        .runtime_turns
        .iter()
        .rev()
        .take_while(|turn| turn.get("state").and_then(Value::as_str) == Some("failed_recoverable"))
        .count()
}

pub(crate) fn active_blocked_browser(session: &NativeSession) -> Option<Value> {
    session
        .snapshot
        .pointer("/sessionResilience/blockedBrowser")
        .filter(|value| value.get("active").and_then(Value::as_bool) == Some(true))
        .cloned()
}

pub(crate) fn blocked_browser_turn_failure_message(blocked: &Value) -> String {
    let regions = blocked
        .get("blockedRegions")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    if regions > 0 {
        format!(
            "lyra_turn_failure:browser_blocked ({regions} blocked region(s) still active)"
        )
    } else {
        super::tool_protocol::TURN_FAILURE_BROWSER_BLOCKED.to_string()
    }
}

pub(crate) fn gate_turn_on_blocked_browser(session: &NativeSession) -> Option<String> {
    active_blocked_browser(session).map(|blocked| blocked_browser_turn_failure_message(&blocked))
}

pub(crate) fn release_session_follow(session: &mut NativeSession) {
    session.snapshot["follow"] = json!({ "running": false, "activity": Value::Null });
}

pub(crate) fn finalize_interrupt_state(session: &mut NativeSession, reason: &str) {
    init_session_resilience_fields(&mut session.snapshot);
    release_session_follow(session);
    let blocked = latest_blocked_browser_from_tools(session);
    let failed_count = consecutive_failed_recoverable_count(session);
    session.snapshot["sessionResilience"] = json!({
        "blockedBrowser": blocked,
        "lastInterruptReason": reason,
        "consecutiveFailedRecoverable": failed_count,
        "updatedAt": now(),
    });
}

pub(crate) fn record_task_milestone(
    session: &mut NativeSession,
    kind: &str,
    detail: &str,
    evidence: Value,
) {
    init_session_resilience_fields(&mut session.snapshot);
    let milestones = session
        .snapshot
        .get_mut("taskMilestones")
        .and_then(Value::as_array_mut);
    let Some(milestones) = milestones else {
        return;
    };
    let milestone = json!({
        "id": format!("milestone-{}", Uuid::new_v4()),
        "kind": kind,
        "detail": detail,
        "evidence": evidence,
        "recordedAt": now(),
    });
    milestones.push(milestone);
    while milestones.len() > MAX_TASK_MILESTONES {
        milestones.remove(0);
    }
}

pub(crate) fn update_resilience_from_tool_finish(session: &mut NativeSession, tool: &Value) {
    init_session_resilience_fields(&mut session.snapshot);
    if let Some(blocked) = extract_blocked_browser_from_tool(tool) {
        if let Some(object) = session.snapshot["sessionResilience"].as_object_mut() {
            object.insert("blockedBrowser".to_string(), blocked);
            object.insert("updatedAt".to_string(), Value::String(now()));
        }
    } else if browser_block_cleared_by_tool(tool) {
        if let Some(object) = session.snapshot["sessionResilience"].as_object_mut() {
            object.insert("blockedBrowser".to_string(), Value::Null);
            object.insert("updatedAt".to_string(), Value::String(now()));
        }
    }
    if let Some((kind, detail, evidence)) = extract_verified_milestone_from_tool(tool) {
        record_task_milestone(session, &kind, &detail, evidence);
    }
}

pub(crate) fn should_apply_failure_recovery(session: &NativeSession) -> bool {
    consecutive_failed_recoverable_count(session) >= MAX_CONSECUTIVE_FAILED_BEFORE_RECOVERY
}

pub(crate) fn sync_failure_resilience_state(session: &mut NativeSession) {
    init_session_resilience_fields(&mut session.snapshot);
    let count = consecutive_failed_recoverable_count(session);
    if let Some(object) = session.snapshot["sessionResilience"].as_object_mut() {
        object.insert(
            "consecutiveFailedRecoverable".to_string(),
            json!(count),
        );
        object.insert("updatedAt".to_string(), Value::String(now()));
    }
}

pub(crate) fn resume_context_lines(session: &NativeSession) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(reason) = session
        .snapshot
        .pointer("/sessionResilience/lastInterruptReason")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Last interrupt reason: {reason}"));
    }
    if let Some(blocked) = active_blocked_browser(session) {
        let region_count = blocked
            .get("blockedRegions")
            .and_then(Value::as_array)
            .map(|items| items.len())
            .unwrap_or(0);
        lines.push(format!(
            "Browser automation is blocked by {region_count} active region(s). Ask the user to close upload/permission dialogs before more browser tools."
        ));
    }
    if let Some(milestones) = session.snapshot.get("taskMilestones").and_then(Value::as_array) {
        for milestone in milestones.iter().rev().take(6) {
            let kind = milestone.get("kind").and_then(Value::as_str).unwrap_or("milestone");
            let detail = milestone.get("detail").and_then(Value::as_str).unwrap_or("");
            if !detail.is_empty() {
                lines.push(format!("Completed milestone [{kind}]: {detail}"));
            }
        }
    }
    if let Some(todos) = session.snapshot.get("todos").and_then(Value::as_array) {
        let pending: Vec<_> = todos
            .iter()
            .filter(|todo| {
                !matches!(
                    todo.get("status").and_then(Value::as_str).unwrap_or("pending"),
                    "completed" | "done" | "cancelled"
                )
            })
            .filter_map(|todo| todo.get("content").and_then(Value::as_str))
            .take(4)
            .collect();
        if !pending.is_empty() {
            lines.push(format!("Pending todos: {}", pending.join(" | ")));
        }
    }
    let failed_count = consecutive_failed_recoverable_count(session);
    if failed_count >= MAX_CONSECUTIVE_FAILED_BEFORE_RECOVERY {
        lines.push(format!(
            "This session has {failed_count} consecutive recoverable turn failures. Prefer compact context, avoid repeating failed browser actions, and continue from the next pending todo."
        ));
    }
    lines
}

fn latest_blocked_browser_from_tools(session: &NativeSession) -> Value {
    session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .rev()
        .find_map(extract_blocked_browser_from_tool)
        .unwrap_or(Value::Null)
}

fn tool_payload(tool: &Value) -> Option<&Value> {
    tool.get("output").or_else(|| tool.get("raw"))
}

fn tool_payload_record<'a>(tool: &'a Value) -> Option<&'a serde_json::Map<String, Value>> {
    let payload = tool_payload(tool)?;
    if payload.as_object().is_some() {
        return payload.as_object();
    }
    payload.get("raw").and_then(Value::as_object)
}

fn extract_blocked_browser_from_tool(tool: &Value) -> Option<Value> {
    let record = tool_payload_record(tool)?;
    let browser_blocked = record.get("browserBlocked").and_then(Value::as_bool) == Some(true);
    let blocked_regions = record
        .get("blockedRegions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !browser_blocked && blocked_regions.is_empty() {
        return None;
    }
    Some(json!({
        "active": true,
        "browserBlocked": browser_blocked,
        "blockedRegions": blocked_regions,
        "recordedAt": now(),
        "sourceToolId": tool.get("id").cloned().unwrap_or(Value::Null),
    }))
}

fn browser_block_cleared_by_tool(tool: &Value) -> bool {
    let Some(record) = tool_payload_record(tool) else {
        return false;
    };
    let tool_path = record
        .get("kind")
        .or_else(|| record.get("requestedMethod"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !tool_path.contains("lyraLumen") && !tool_path.contains("lyra_lumen") {
        return false;
    }
    record.get("browserBlocked").and_then(Value::as_bool) != Some(true)
        && record
            .get("blockedRegions")
            .and_then(Value::as_array)
            .is_none_or(|items| items.is_empty())
}

fn extract_verified_milestone_from_tool(tool: &Value) -> Option<(String, String, Value)> {
    let record = tool_payload_record(tool)?;
    let action_verification = record.get("actionVerification");
    let verified = record.get("verified").and_then(Value::as_bool) == Some(true)
        || record.get("verifiedAfterTimeout").and_then(Value::as_bool) == Some(true)
        || action_verification
            .and_then(|value| value.get("verified"))
            .and_then(Value::as_bool)
            == Some(true)
        || record.get("outcome").and_then(Value::as_str) == Some("verified_after_timeout");
    if !verified {
        return None;
    }
    let detail = record
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| {
            action_verification
                .and_then(|value| value.get("signals"))
                .and_then(Value::as_array)
                .and_then(|signals| signals.first())
                .and_then(Value::as_str)
        })
        .unwrap_or("browser action structurally verified");
    Some((
        "browser_action_verified".to_string(),
        detail.to_string(),
        json!({
            "toolId": tool.get("id").cloned().unwrap_or(Value::Null),
            "signals": action_verification
                .and_then(|value| value.get("signals"))
                .cloned()
                .unwrap_or(Value::Null),
            "observationDiff": action_verification
                .and_then(|value| value.get("observationDiff"))
                .cloned()
                .unwrap_or(Value::Null),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_backend::projections::runtime_turn;

    fn test_session() -> NativeSession {
        let mut snapshot = json!({
            "tools": [],
            "todos": [],
            "follow": { "running": true, "activity": "act" }
        });
        init_session_resilience_fields(&mut snapshot);
        NativeSession {
            id: "session-test".to_string(),
            snapshot,
            created_at: now(),
            saved: false,
            save_label: None,
            archived: false,
            custom_title: None,
            short_name: None,
            runtime_turns: vec![
                runtime_turn("turn-1", "session-test", "completed", None, None),
                runtime_turn("turn-2", "session-test", "failed_recoverable", None, None),
                runtime_turn("turn-3", "session-test", "failed_recoverable", None, None),
            ],
            rollback_checkpoints: Vec::new(),
            file_read_state: std::collections::HashMap::new(),
            dirty: false,
        }
    }

    #[test]
    fn consecutive_failed_recoverable_counts_trailing_failures_only() {
        let session = test_session();
        assert_eq!(consecutive_failed_recoverable_count(&session), 2);
    }

    #[test]
    fn finalize_interrupt_state_releases_follow_and_records_reason() {
        let mut session = test_session();
        finalize_interrupt_state(&mut session, "soft_interrupt_new_user_message");
        assert_eq!(
            session.snapshot.pointer("/follow/running").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            session
                .snapshot
                .pointer("/sessionResilience/lastInterruptReason")
                .and_then(Value::as_str),
            Some("soft_interrupt_new_user_message")
        );
    }

    #[test]
    fn gate_turn_on_blocked_browser_returns_structured_failure() {
        let mut session = test_session();
        session.snapshot["sessionResilience"] = json!({
            "blockedBrowser": {
                "active": true,
                "blockedRegions": [{ "kind": "permission-prompt" }]
            }
        });
        let failure = gate_turn_on_blocked_browser(&session).expect("blocked");
        assert!(failure.contains("lyra_turn_failure:browser_blocked"));
    }
}