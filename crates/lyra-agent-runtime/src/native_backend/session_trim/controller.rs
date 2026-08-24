use super::super::context_window::{TrimControllerConfig, build_context_window_plan};
use super::{NativeSession, Value, now};
use serde_json::json;
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub(crate) struct TrimPlan {
    pub trim_ordinals: Vec<usize>,
    pub msg_ids: Vec<String>,
    pub token_before: usize,
    pub token_after: usize,
}

pub(crate) fn evaluate(
    session: &NativeSession,
    config: &TrimControllerConfig,
    active_clarification: Option<&Value>,
) -> Option<TrimPlan> {
    if trim_cooldown_active(session) {
        return None;
    }

    let window = build_context_window_plan(session, config, active_clarification)?;
    let messages = session.snapshot.get("messages")?.as_array()?;
    let msg_ids = window
        .trim_ordinals
        .iter()
        .filter_map(|ordinal| {
            messages
                .get(*ordinal)?
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect();

    Some(TrimPlan {
        trim_ordinals: window.trim_ordinals,
        msg_ids,
        token_before: window.token_before,
        token_after: window.token_after,
    })
}

fn trim_cooldown_active(session: &NativeSession) -> bool {
    let current_turns = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .map(|messages| {
            messages
                .iter()
                .filter(|message| message.get("role").and_then(Value::as_str) == Some("user"))
                .count()
        })
        .unwrap_or(0);
    let last_trim_turn = session
        .snapshot
        .pointer("/memoryTrim/lastTrimUserTurnCount")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    current_turns > 0 && current_turns == last_trim_turn
}

pub(crate) fn mark_trim_cooldown(session: &mut NativeSession) {
    let user_turns = session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .map(|messages| {
            messages
                .iter()
                .filter(|message| message.get("role").and_then(Value::as_str) == Some("user"))
                .count()
        })
        .unwrap_or(0);
    if let Some(object) = session.snapshot.as_object_mut() {
        let memory_trim = object.entry("memoryTrim").or_insert_with(|| json!({}));
        if let Some(trim_object) = memory_trim.as_object_mut() {
            trim_object.insert(
                "lastTrimUserTurnCount".to_string(),
                Value::Number(user_turns.into()),
            );
            trim_object.insert("lastTrimAtIso".to_string(), Value::String(now()));
        }
    }
}

#[allow(dead_code)]
pub(crate) fn head_keep_count(messages: &[Value]) -> usize {
    let mut keep = 0_usize;
    for message in messages {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "system" {
            keep += 1;
            continue;
        }
        if role == "user" {
            keep += 1;
            break;
        }
        keep += 1;
    }
    keep.max(1)
}

#[allow(dead_code)]
pub(crate) fn tail_keep_ordinals(
    messages: &[Value],
    token_counts: &[usize],
    protected_recent_tokens: usize,
) -> HashSet<usize> {
    let mut keep = HashSet::new();
    let mut protected = 0_usize;
    let mut latest_user_kept = false;

    for ordinal in (0..messages.len()).rev() {
        let role = messages[ordinal]
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("");
        if protected >= protected_recent_tokens && latest_user_kept {
            break;
        }
        let estimate = token_counts.get(ordinal).copied().unwrap_or(0);
        if protected > 0
            && protected.saturating_add(estimate) > protected_recent_tokens
            && latest_user_kept
        {
            break;
        }
        keep.insert(ordinal);
        protected = protected.saturating_add(estimate);
        if role == "user" {
            latest_user_kept = true;
        }
    }
    keep
}
