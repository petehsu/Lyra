use super::*;

pub(super) fn trim_tool_output(
    text: &str,
    max_chars: usize,
    message_id: Option<&Value>,
) -> (String, Option<Value>) {
    if max_chars == 0 || text.chars().count() <= max_chars {
        return (text.to_string(), None);
    }
    let trimmed = text.chars().take(max_chars).collect::<String>();
    let evidence_ref = json!({
        "kind": "truncated_tool_output",
        "messageId": message_id.cloned().unwrap_or(Value::Null),
        "originalChars": text.chars().count(),
        "keptChars": max_chars,
    });
    (
        format!(
            "{trimmed}\n\n[Tool output truncated; full output retained by Lyra as evidence ref.]"
        ),
        Some(evidence_ref),
    )
}

pub(super) fn should_compact_provider_context(
    output: &ProviderContext,
    retention: &RetentionPolicy,
    session_message_count: usize,
) -> bool {
    if output.token_estimate >= retention.trim_trigger_tokens {
        return true;
    }
    matches!(retention.complexity_band, ComplexityBand::Complex)
        && session_message_count >= 32
        && output.token_estimate * 2 > retention.protected_recent_tokens
}

fn apply_budget_fallback_keep(messages: &[Value], keep: &mut [bool], policy: &RetentionPolicy) {
    if keep.iter().any(|kept| !*kept) {
        return;
    }
    let token_counts: Vec<usize> = messages.iter().map(estimate_message_tokens).collect();
    let tail_start = crate::retention_policy::tail_keep_start(
        messages,
        &token_counts,
        policy.protected_recent_tokens,
    );
    let mut total = keep
        .iter()
        .enumerate()
        .filter_map(|(index, kept)| kept.then_some(token_counts[index]))
        .sum::<usize>();
    let budget_target = policy
        .trim_trigger_tokens
        .min(policy.target_tokens)
        .saturating_sub(CONTEXT_GUARD_TOKENS);
    for ordinal in 0..messages.len() {
        if ordinal >= tail_start || !keep[ordinal] {
            continue;
        }
        if total <= budget_target {
            break;
        }
        keep[ordinal] = false;
        total = total.saturating_sub(token_counts[ordinal]);
    }
    if keep.iter().all(|kept| *kept) && matches!(policy.complexity_band, ComplexityBand::Complex) {
        for ordinal in 0..tail_start {
            if ordinal % 2 == 0 && keep[ordinal] {
                keep[ordinal] = false;
            }
        }
    }
}

pub(super) fn effective_tool_output_budget(
    options: &ProviderContextOptions,
    message_id: Option<&Value>,
) -> usize {
    let base = options.max_tool_output_chars;
    if base == 0 {
        return 0;
    }
    let halve = message_id
        .and_then(Value::as_str)
        .is_some_and(|id| options.halve_tool_output_message_ids.contains(id));
    if halve { (base / 2).max(1) } else { base }
}

pub(super) fn compact_to_retention_policy(
    output: &mut ProviderContext,
    policy: RetentionPolicy,
    aggressiveness: TrimAggressiveness,
) {
    let Some(system) = output.messages.first().cloned() else {
        return;
    };
    let messages = output.messages.iter().skip(1).cloned().collect::<Vec<_>>();
    let mut keep = select_interleaved_provider_keep(&messages, &policy, aggressiveness);
    normalize_tool_round_retention(&messages, &mut keep);
    apply_budget_fallback_keep(&messages, &mut keep, &policy);
    normalize_openai_responses_replay_retention(&messages, &mut keep);

    let kept = messages
        .into_iter()
        .zip(keep)
        .filter_map(|(message, keep)| keep.then_some(message))
        .collect::<Vec<_>>();
    let dropped = output.messages.len().saturating_sub(1 + kept.len());
    if dropped > 0 {
        output.trimmed = true;
        output.messages = vec![
            system,
            json!({
                "role": "system",
                "content": format!(
                    "Earlier conversation context was compacted by Lyra before this provider request. Dropped message count: {dropped}. Retention policy: usable_context_tokens={}, trim_trigger_tokens={}, target_tokens={}, protected_recent_tokens={}, complexity_score={}, complexity_band={:?}. Latest user intent, protected recent context, tool evidence refs, and pinned memory remain preferred over older summaries.",
                    policy.usable_context_tokens,
                    policy.trim_trigger_tokens,
                    policy.target_tokens,
                    policy.protected_recent_tokens,
                    policy.complexity_score,
                    policy.complexity_band
                ),
            }),
        ];
        output.messages.extend(kept);
        output.token_estimate = estimate_messages_tokens(&output.messages);
    }

    if policy.has_explicit_context_window && output.token_estimate > policy.usable_context_tokens {
        output.overflow = Some(json!({
            "kind": "context_overflow",
            "contextWindow": policy.usable_context_tokens,
            "estimatedTokens": output.token_estimate,
            "recoverable": true,
        }));
    }
}

pub(super) fn normalize_openai_responses_replay_retention(messages: &[Value], keep: &mut [bool]) {
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::new();
    for (index, message) in messages.iter().enumerate() {
        if let Some(group) = message
            .get(OPENAI_RESPONSES_REPLAY_GROUP_KEY)
            .and_then(Value::as_u64)
        {
            groups.entry(group).or_default().push(index);
        }
    }
    for indices in groups.into_values() {
        if indices.iter().any(|index| keep[*index]) {
            for index in indices {
                keep[index] = true;
            }
        }
    }
}

pub(super) fn strip_openai_responses_replay_groups(messages: &mut [Value]) {
    for message in messages {
        if let Some(object) = message.as_object_mut() {
            object.remove(OPENAI_RESPONSES_REPLAY_GROUP_KEY);
        }
    }
}

fn assistant_message_has_tool_calls(message: &Value) -> bool {
    message.get("role").and_then(Value::as_str) == Some("assistant")
        && message
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|tool_calls| !tool_calls.is_empty())
}

fn assistant_message_has_reasoning(message: &Value) -> bool {
    message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
}

fn normalize_tool_round_retention(messages: &[Value], keep: &mut [bool]) {
    let mut index = 0;
    while index < messages.len() {
        if !assistant_message_has_tool_calls(&messages[index]) {
            index += 1;
            continue;
        }
        let round_start = index;
        let mut round_end = index + 1;
        while round_end < messages.len()
            && messages[round_end].get("role").and_then(Value::as_str) == Some("tool")
        {
            round_end += 1;
        }
        let round_kept = (round_start..round_end).any(|slot| keep[slot]);
        if round_kept && !assistant_message_has_reasoning(&messages[round_start]) {
            for slot in round_start..round_end {
                keep[slot] = false;
            }
        } else if !keep[round_start] {
            for slot in round_start + 1..round_end {
                keep[slot] = false;
            }
        }
        index = round_end;
    }
}

pub(super) fn prompt_accounting_json(accounting: &PromptAccounting) -> Value {
    json!({
        "systemBudget": accounting.system_budget,
        "toolsBudget": accounting.tools_budget,
        "memoryBudget": accounting.memory_budget,
        "historyBudget": accounting.history_budget,
        "artifactBudget": accounting.artifact_budget,
    })
}
