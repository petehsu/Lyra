use serde_json::{Value, json};
use std::collections::HashSet;

use crate::native_backend::token_estimate::estimate_message_tokens;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComplexityBand {
    Simple,
    Normal,
    Complex,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrimAggressiveness {
    Normal,
    Elevated,
    Emergency,
}

#[derive(Clone, Debug)]
pub struct RetentionSignals {
    pub context_window: Option<usize>,
    pub session_tool_count: usize,
    pub last_turn_tool_count: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct RetentionPolicy {
    pub usable_context_tokens: usize,
    pub trim_trigger_tokens: usize,
    pub target_tokens: usize,
    pub protected_recent_tokens: usize,
    pub complexity_score: usize,
    pub complexity_band: ComplexityBand,
    pub has_explicit_context_window: bool,
}

#[derive(Clone, Debug)]
pub struct UserTurnSegment {
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub struct InterleavedTrimPlan {
    pub head_end: usize,
    pub tail_start: usize,
    pub trim_ordinals: Vec<usize>,
    pub halve_tool_ordinals: HashSet<usize>,
    pub token_before: usize,
    pub token_after: usize,
}

pub const DEFAULT_RETENTION_CONTEXT_TOKENS: usize = 100_000;
pub const RETENTION_TRIM_TRIGGER_CAP_TOKENS: usize = 100_000;
pub const TARGET_MIN_RETAINED_TOKENS: usize = 100_000;
pub const RECENT_PROTECTED_TOKENS: usize = 50_000;
pub const CONTEXT_GUARD_TOKENS: usize = 128;
pub const HEAVY_TOOL_SESSION_COUNT: usize = 30;

pub fn retention_policy_from_messages(
    messages: &[Value],
    signals: &RetentionSignals,
) -> RetentionPolicy {
    let usable_context_tokens = signals
        .context_window
        .filter(|window| *window > 0)
        .unwrap_or(DEFAULT_RETENTION_CONTEXT_TOKENS);
    let complexity_score = complexity_score(messages, signals);
    let complexity_band = complexity_band_from_score(complexity_score);
    let trim_ratio = trim_trigger_ratio(complexity_band, signals.session_tool_count);
    let trim_trigger_tokens = trim_trigger_tokens_for_usable(usable_context_tokens, trim_ratio);
    let base_target = if usable_context_tokens >= TARGET_MIN_RETAINED_TOKENS {
        match complexity_band {
            ComplexityBand::Complex => {
                ((usable_context_tokens as f64 * 0.92) as usize).max(TARGET_MIN_RETAINED_TOKENS)
            }
            ComplexityBand::Normal => {
                ((usable_context_tokens as f64 * 0.84) as usize).max(TARGET_MIN_RETAINED_TOKENS)
            }
            ComplexityBand::Simple => TARGET_MIN_RETAINED_TOKENS,
        }
    } else {
        match complexity_band {
            ComplexityBand::Complex => (usable_context_tokens as f64 * 0.88) as usize,
            ComplexityBand::Normal => (usable_context_tokens as f64 * 0.78) as usize,
            ComplexityBand::Simple => (usable_context_tokens as f64 * 0.68) as usize,
        }
    };
    let target_tokens = base_target
        .min(usable_context_tokens.saturating_sub(CONTEXT_GUARD_TOKENS))
        .max((usable_context_tokens / 2).max(1));
    let protected_recent_tokens = if usable_context_tokens >= RECENT_PROTECTED_TOKENS {
        RECENT_PROTECTED_TOKENS.min(target_tokens.saturating_sub(CONTEXT_GUARD_TOKENS))
    } else {
        (usable_context_tokens as f64 * 0.45) as usize
    }
    .max(1);

    RetentionPolicy {
        usable_context_tokens,
        trim_trigger_tokens,
        target_tokens,
        protected_recent_tokens,
        complexity_score,
        complexity_band,
        has_explicit_context_window: signals.context_window.is_some(),
    }
}

pub fn trim_controller_config_from_policy(
    policy: RetentionPolicy,
) -> crate::native_backend::context_window::TrimControllerConfig {
    crate::native_backend::context_window::TrimControllerConfig {
        trim_trigger_tokens: policy.trim_trigger_tokens,
        target_tokens: policy.target_tokens,
        protected_recent_tokens: policy.protected_recent_tokens,
    }
}

pub fn build_interleaved_trim_plan(
    messages: &[Value],
    policy: &RetentionPolicy,
    pinned_message_ids: &HashSet<String>,
    aggressiveness: TrimAggressiveness,
) -> Option<InterleavedTrimPlan> {
    if messages.len() < 4 {
        return None;
    }

    let token_counts: Vec<usize> = messages.iter().map(estimate_message_tokens).collect();
    let token_before: usize = token_counts.iter().sum();
    if token_before <= policy.trim_trigger_tokens {
        return None;
    }

    let head_end = head_keep_count(messages);
    let tail_start = tail_keep_start(messages, &token_counts, policy.protected_recent_tokens);
    if head_end >= tail_start {
        if token_before <= policy.trim_trigger_tokens {
            return None;
        }
        let mut trim_ordinals = HashSet::new();
        for ordinal in 0..messages.len() {
            if ordinal + 1 >= messages.len() {
                break;
            }
            if is_pinned(messages, ordinal, pinned_message_ids) {
                continue;
            }
            trim_ordinals.insert(ordinal);
        }
        if trim_ordinals.is_empty() {
            return None;
        }
        let token_after =
            estimate_tokens_after_plan(&token_counts, &trim_ordinals, &HashSet::new());
        return Some(InterleavedTrimPlan {
            head_end,
            tail_start: messages.len().saturating_sub(1),
            trim_ordinals: trim_ordinals.into_iter().collect(),
            halve_tool_ordinals: HashSet::new(),
            token_before,
            token_after,
        });
    }

    let segments = user_turn_segments_in_range(messages, head_end, tail_start);
    if segments.is_empty() {
        return None;
    }

    let mut trim_ordinals = HashSet::new();
    let mut halve_tool_ordinals = HashSet::new();

    for (segment_index, segment) in segments.iter().enumerate() {
        if segment_index % 2 != 1 {
            continue;
        }
        for ordinal in segment.start..segment.end {
            if is_pinned(messages, ordinal, pinned_message_ids) {
                continue;
            }
            if message_has_tool_payload(&messages[ordinal]) {
                halve_tool_ordinals.insert(ordinal);
            }
        }
    }

    let mut token_after =
        estimate_tokens_after_plan(&token_counts, &trim_ordinals, &halve_tool_ordinals);

    if token_after > policy.target_tokens {
        for (segment_index, segment) in segments.iter().enumerate() {
            if segment_index % 2 != 1 {
                continue;
            }
            for ordinal in segment.start..segment.end {
                if is_pinned(messages, ordinal, pinned_message_ids) {
                    continue;
                }
                trim_ordinals.insert(ordinal);
                halve_tool_ordinals.remove(&ordinal);
            }
        }
        token_after =
            estimate_tokens_after_plan(&token_counts, &trim_ordinals, &halve_tool_ordinals);
    }

    if token_after > policy.target_tokens {
        for (segment_index, segment) in segments.iter().enumerate() {
            if segment_index % 2 == 1 {
                continue;
            }
            for (offset, ordinal) in (segment.start..segment.end).enumerate() {
                if offset % 2 != 1 {
                    continue;
                }
                if is_pinned(messages, ordinal, pinned_message_ids) {
                    continue;
                }
                trim_ordinals.insert(ordinal);
            }
        }
        token_after =
            estimate_tokens_after_plan(&token_counts, &trim_ordinals, &halve_tool_ordinals);
    }

    if token_after > policy.target_tokens
        && matches!(
            aggressiveness,
            TrimAggressiveness::Elevated | TrimAggressiveness::Emergency
        )
    {
        for segment in &segments {
            for ordinal in segment.start..segment.end {
                if is_pinned(messages, ordinal, pinned_message_ids) {
                    continue;
                }
                trim_ordinals.insert(ordinal);
            }
        }
        token_after =
            estimate_tokens_after_plan(&token_counts, &trim_ordinals, &halve_tool_ordinals);
    }

    if token_after > policy.target_tokens {
        let mut running = token_after;
        for ordinal in head_end..tail_start {
            if running <= policy.target_tokens {
                break;
            }
            if is_pinned(messages, ordinal, pinned_message_ids) || trim_ordinals.contains(&ordinal)
            {
                continue;
            }
            trim_ordinals.insert(ordinal);
            halve_tool_ordinals.remove(&ordinal);
            running = running.saturating_sub(token_counts[ordinal]);
        }
        token_after = running;
    }

    let trim_ordinals = trim_ordinals.into_iter().collect::<Vec<_>>();
    if trim_ordinals.is_empty() && halve_tool_ordinals.is_empty() {
        return None;
    }

    Some(InterleavedTrimPlan {
        head_end,
        tail_start,
        trim_ordinals,
        halve_tool_ordinals,
        token_before,
        token_after,
    })
}

pub fn halve_tool_message_ids(
    messages: &[Value],
    policy: &RetentionPolicy,
    pinned_message_ids: &HashSet<String>,
) -> HashSet<String> {
    build_interleaved_trim_plan(
        messages,
        policy,
        pinned_message_ids,
        TrimAggressiveness::Normal,
    )
    .map(|plan| {
        plan.halve_tool_ordinals
            .into_iter()
            .filter_map(|ordinal| {
                messages
                    .get(ordinal)?
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect()
    })
    .unwrap_or_default()
}

pub fn head_keep_count(messages: &[Value]) -> usize {
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

pub fn tail_keep_start(
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

pub fn user_turn_segments_in_range(
    messages: &[Value],
    range_start: usize,
    range_end: usize,
) -> Vec<UserTurnSegment> {
    let mut segments = Vec::new();
    let mut index = range_start;
    while index < range_end {
        if messages[index].get("role").and_then(Value::as_str) != Some("user") {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < range_end
            && messages[index].get("role").and_then(Value::as_str) != Some("user")
        {
            index += 1;
        }
        segments.push(UserTurnSegment { start, end: index });
    }
    segments
}

pub fn compact_provider_messages_for_retry(
    messages: Vec<Value>,
    signals: &RetentionSignals,
    aggressiveness: TrimAggressiveness,
) -> Vec<Value> {
    if messages.len() <= 8 {
        return messages;
    }
    let (system, body) = if messages
        .first()
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        == Some("system")
    {
        (Some(messages[0].clone()), messages[1..].to_vec())
    } else {
        (None, messages)
    };
    let policy = retention_policy_from_messages(&body, signals);
    let keep = select_interleaved_provider_keep(&body, &policy, aggressiveness);
    let before = body.len();
    let kept = body
        .into_iter()
        .zip(keep)
        .filter_map(|(message, keep)| keep.then_some(message))
        .collect::<Vec<_>>();
    let dropped = before.saturating_sub(kept.len());
    if dropped == 0 {
        return if let Some(system) = system {
            let mut restored = vec![system];
            restored.extend(kept);
            restored
        } else {
            kept
        };
    }
    let mut compacted = Vec::new();
    if let Some(system) = system {
        compacted.push(system);
    }
    compacted.push(json!({
        "role": "system",
        "content": format!(
            "Lyra compacted earlier provider context before retrying the provider. Dropped message count: {dropped}. Retention policy: trim_trigger_tokens={}, target_tokens={}, protected_recent_tokens={}, complexity_score={}, complexity_band={:?}. Latest user intent and protected recent context remain preferred.",
            policy.trim_trigger_tokens,
            policy.target_tokens,
            policy.protected_recent_tokens,
            policy.complexity_score,
            policy.complexity_band
        ),
    }));
    compacted.extend(kept);
    compacted
}

pub fn retention_signals_from_session_messages(
    messages: &[Value],
    session_tool_count: usize,
    context_window: Option<usize>,
) -> RetentionSignals {
    RetentionSignals {
        context_window,
        session_tool_count,
        last_turn_tool_count: estimate_last_turn_tool_count(messages),
    }
}

fn estimate_last_turn_tool_count(messages: &[Value]) -> usize {
    let mut last_user = None;
    for (index, message) in messages.iter().enumerate() {
        if message.get("role").and_then(Value::as_str) == Some("user") {
            last_user = Some(index);
        }
    }
    let Some(last_user) = last_user else {
        return 0;
    };
    messages
        .iter()
        .skip(last_user + 1)
        .filter(|message| message_has_tool_payload(message))
        .count()
}

pub fn retention_signals_from_provider_messages(
    messages: &[Value],
    context_window: Option<usize>,
) -> RetentionSignals {
    let session_tool_count = messages
        .iter()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some("tool"))
        .count();
    RetentionSignals {
        context_window,
        session_tool_count,
        last_turn_tool_count: session_tool_count.min(24),
    }
}

pub fn select_interleaved_provider_keep(
    messages: &[Value],
    policy: &RetentionPolicy,
    aggressiveness: TrimAggressiveness,
) -> Vec<bool> {
    let token_counts: Vec<usize> = messages.iter().map(estimate_message_tokens).collect();
    let head_end = head_keep_count(messages);
    let tail_start = tail_keep_start(messages, &token_counts, policy.protected_recent_tokens);
    let mut keep = vec![true; messages.len()];

    if head_end >= tail_start {
        return keep;
    }

    let pinned = HashSet::new();
    let Some(plan) = build_interleaved_trim_plan(messages, policy, &pinned, aggressiveness) else {
        return keep;
    };

    for ordinal in plan.trim_ordinals {
        if ordinal < keep.len() {
            keep[ordinal] = false;
        }
    }
    keep
}

fn complexity_band_from_score(score: usize) -> ComplexityBand {
    if score >= 120 {
        ComplexityBand::Complex
    } else if score >= 48 {
        ComplexityBand::Normal
    } else {
        ComplexityBand::Simple
    }
}

fn trim_trigger_ratio(band: ComplexityBand, session_tool_count: usize) -> f64 {
    let base: f64 = match band {
        ComplexityBand::Simple => 0.82,
        ComplexityBand::Normal => 0.65,
        ComplexityBand::Complex => 0.50,
    };
    if session_tool_count >= HEAVY_TOOL_SESSION_COUNT {
        base.min(0.45)
    } else {
        base
    }
}

fn trim_trigger_tokens_for_usable(usable_context_tokens: usize, ratio: f64) -> usize {
    let triggered = ((usable_context_tokens as f64) * ratio) as usize;
    if usable_context_tokens >= RETENTION_TRIM_TRIGGER_CAP_TOKENS {
        triggered.min(RETENTION_TRIM_TRIGGER_CAP_TOKENS).max(1)
    } else {
        triggered.max(1)
    }
}

fn complexity_score(messages: &[Value], signals: &RetentionSignals) -> usize {
    let mut total_user_chars = 0;
    let mut total_assistant_chars = 0;
    let mut latest_user_chars = 0;
    let mut latest_assistant_chars = 0;

    for message in messages {
        let chars = message_text_chars(message);
        match message.get("role").and_then(Value::as_str) {
            Some("user") => {
                total_user_chars += chars;
                latest_user_chars = chars;
            }
            Some("assistant") => {
                total_assistant_chars += chars;
                latest_assistant_chars = chars;
            }
            _ => {}
        }
    }

    signals.session_tool_count.saturating_mul(8)
        + signals.last_turn_tool_count.saturating_mul(18)
        + total_user_chars / 900
        + total_assistant_chars / 1_200
        + latest_user_chars / 350
        + latest_assistant_chars / 700
}

fn message_text_chars(message: &Value) -> usize {
    match message.get("content") {
        Some(Value::String(text)) => text.chars().count(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(|text| text.chars().count())
            .sum(),
        _ => message
            .get("text")
            .and_then(Value::as_str)
            .map(|text| text.chars().count())
            .unwrap_or(0),
    }
}

fn is_pinned(messages: &[Value], ordinal: usize, pinned_message_ids: &HashSet<String>) -> bool {
    messages
        .get(ordinal)
        .and_then(|message| message.get("id").and_then(Value::as_str))
        .is_some_and(|id| pinned_message_ids.contains(id))
}

fn message_has_tool_payload(message: &Value) -> bool {
    if message
        .get("blocks")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks
                .iter()
                .any(|block| block.get("type") == Some(&Value::String("tool".to_string())))
        })
    {
        return true;
    }
    message.get("role").and_then(Value::as_str) == Some("tool")
        || message
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|calls| !calls.is_empty())
}

fn estimate_tokens_after_plan(
    token_counts: &[usize],
    trim_ordinals: &HashSet<usize>,
    halve_tool_ordinals: &HashSet<usize>,
) -> usize {
    token_counts
        .iter()
        .enumerate()
        .map(|(ordinal, tokens)| {
            if trim_ordinals.contains(&ordinal) {
                0
            } else if halve_tool_ordinals.contains(&ordinal) {
                tokens / 2
            } else {
                *tokens
            }
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(id: &str, role: &str, text: &str) -> Value {
        json!({
            "id": id,
            "role": role,
            "text": text,
        })
    }

    #[test]
    fn complex_band_lowers_trim_trigger_below_cap() {
        let policy = retention_policy_from_messages(
            &[],
            &RetentionSignals {
                context_window: Some(200_000),
                session_tool_count: 49,
                last_turn_tool_count: 12,
            },
        );
        assert_eq!(policy.complexity_band, ComplexityBand::Complex);
        assert_eq!(policy.trim_trigger_tokens, 90_000);
    }

    #[test]
    fn interleaved_plan_keeps_alternating_segments_before_whole_delete() {
        let mut messages = vec![
            message("m0", "system", "system"),
            message("m1", "user", "first intent"),
        ];
        for index in 0..6 {
            messages.push(message(
                &format!("u{index}"),
                "user",
                &format!("turn {index}"),
            ));
            messages.push(message(
                &format!("a{index}"),
                "assistant",
                &"y".repeat(4_000),
            ));
            messages.push(message(
                &format!("t{index}"),
                "assistant",
                &"z".repeat(8_000),
            ));
        }
        messages.push(message("latest-user", "user", "latest intent"));
        messages.push(message("latest-assistant", "assistant", "ok"));

        let policy = RetentionPolicy {
            usable_context_tokens: 200_000,
            trim_trigger_tokens: 2_000,
            target_tokens: 1_000,
            protected_recent_tokens: 500,
            complexity_score: 200,
            complexity_band: ComplexityBand::Complex,
            has_explicit_context_window: true,
        };

        let plan = build_interleaved_trim_plan(
            &messages,
            &policy,
            &HashSet::new(),
            TrimAggressiveness::Normal,
        )
        .expect("plan");
        assert!(!plan.trim_ordinals.is_empty() || !plan.halve_tool_ordinals.is_empty());
        assert!(plan.token_after <= plan.token_before);
        assert!(!plan.trim_ordinals.contains(&0));
        assert!(!plan.trim_ordinals.contains(&1));
    }

    #[test]
    fn small_context_window_uses_ratio_trigger() {
        let policy = retention_policy_from_messages(
            &[],
            &RetentionSignals {
                context_window: Some(4_000),
                session_tool_count: 0,
                last_turn_tool_count: 0,
            },
        );
        assert_eq!(policy.trim_trigger_tokens, 3_280);
    }
}
