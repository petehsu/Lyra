use super::{
    NativeSession, Value, estimate_message_tokens,
    pinned_context::{PinnedItem, collect_pinned_items, pinned_message_ids},
};
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub(crate) struct TrimControllerConfig {
    pub trim_trigger_tokens: usize,
    pub target_tokens: usize,
    pub protected_recent_tokens: usize,
}

impl Default for TrimControllerConfig {
    fn default() -> Self {
        Self {
            trim_trigger_tokens: 100_000,
            target_tokens: 100_000,
            protected_recent_tokens: 50_000,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ContextWindowPlan {
    pub head_end: usize,
    pub tail_start: usize,
    pub pinned_message_ids: HashSet<String>,
    pub pinned_items: Vec<PinnedItem>,
    pub trim_ordinals: Vec<usize>,
    pub token_before: usize,
    pub token_after: usize,
}

pub(crate) fn build_context_window_plan(
    session: &NativeSession,
    config: &TrimControllerConfig,
    active_clarification: Option<&Value>,
) -> Option<ContextWindowPlan> {
    let messages = session.snapshot.get("messages")?.as_array()?;
    if messages.len() < 4 {
        return None;
    }

    let pinned_items = collect_pinned_items(session, active_clarification);
    let pinned_ids = pinned_message_ids(&pinned_items);

    let token_counts: Vec<usize> = messages.iter().map(estimate_message_tokens).collect();
    let token_before: usize = token_counts.iter().sum();
    if token_before <= config.trim_trigger_tokens {
        return None;
    }

    let head_end = head_keep_count(messages);
    let tail_start = tail_keep_start(messages, &token_counts, config.protected_recent_tokens);
    let mut trim_ordinals = Vec::new();

    for (ordinal, _) in messages.iter().enumerate() {
        if ordinal < head_end || ordinal >= tail_start {
            continue;
        }
        let msg_id = messages[ordinal]
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("");
        if pinned_ids.contains(msg_id) {
            continue;
        }
        trim_ordinals.push(ordinal);
    }

    if trim_ordinals.is_empty() {
        return None;
    }

    let mut token_after = token_before;
    if token_after > config.target_tokens {
        let mut running = token_before;
        trim_ordinals.retain(|_| false);
        for (ordinal, tokens) in token_counts.iter().enumerate() {
            if ordinal < head_end || ordinal >= tail_start {
                continue;
            }
            let msg_id = messages[ordinal]
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("");
            if pinned_ids.contains(msg_id) {
                continue;
            }
            if running <= config.target_tokens {
                break;
            }
            trim_ordinals.push(ordinal);
            running = running.saturating_sub(*tokens);
        }
        token_after = running;
    } else {
        token_after = token_before.saturating_sub(
            trim_ordinals
                .iter()
                .map(|ordinal| token_counts[*ordinal])
                .sum::<usize>(),
        );
    }

    if trim_ordinals.is_empty() {
        return None;
    }

    Some(ContextWindowPlan {
        head_end,
        tail_start,
        pinned_message_ids: pinned_ids,
        pinned_items,
        trim_ordinals,
        token_before,
        token_after,
    })
}

fn head_keep_count(messages: &[Value]) -> usize {
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

fn tail_keep_start(
    messages: &[Value],
    token_counts: &[usize],
    protected_recent_tokens: usize,
) -> usize {
    let mut protected = 0_usize;
    let mut latest_user_kept = false;
    let mut tail_start = messages.len();

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
        tail_start = ordinal;
        protected = protected.saturating_add(estimate);
        if role == "user" {
            latest_user_kept = true;
        }
    }
    tail_start
}

pub(crate) fn filter_messages_by_window_plan(
    messages: &[Value],
    plan: &ContextWindowPlan,
) -> (Vec<Value>, usize) {
    let before = messages.len();
    let filtered = messages
        .iter()
        .enumerate()
        .filter_map(|(ordinal, message)| {
            let message_id = message.get("id").and_then(Value::as_str).unwrap_or("");
            if ordinal < plan.head_end
                || ordinal >= plan.tail_start
                || plan.pinned_message_ids.contains(message_id)
            {
                Some(message.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let dropped = before.saturating_sub(filtered.len());
    (filtered, dropped)
}
