use super::*;

const DEFAULT_CONTEXT_TOKENS: usize = 128_000;
const CHARS_PER_TOKEN_ESTIMATE: usize = 4;
const CONTEXT_WINDOW_THRESHOLD_PERCENT: usize = 85;
const TOOL_RESULT_CONTENT_LIMIT_CHARS: usize = 8_000;
const TOOL_RESULT_TRUNCATION_MARKER: &str = "[Output truncated, showing first 8000 chars]";
const EARLIER_CONVERSATION_PREFIX: &str = "[Earlier conversation truncated:";
const TOOL_RESULT_PREFIX: &str = "Runtime ToolFS result. Use this as the only evidence for claims about workspace files, code, git state, or tools.\n";

#[derive(Clone, Debug, Default)]
pub(super) struct ContextWindowStats {
    pub original_messages: usize,
    pub final_messages: usize,
    pub removed_messages: usize,
    pub original_chars: usize,
    pub final_chars: usize,
    pub max_context_tokens: usize,
    pub estimated_limit_chars: usize,
    pub threshold_chars: usize,
    pub truncated_tool_results: usize,
    pub truncated_tool_result_chars: usize,
    pub trim_journal_id: Option<String>,
    pub archived_items: usize,
    pub duplicate_archive_items: usize,
}

#[cfg(test)]
pub(super) fn enforce_context_window(
    config: &ProviderRuntimeConfig,
    messages: &mut Vec<ChatMessage>,
) -> Option<ContextWindowStats> {
    enforce_context_window_inner(config, messages, None, "", "", Value::Null).ok()?
}

pub(super) fn enforce_context_window_for_turn(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    config: &ProviderRuntimeConfig,
    messages: &mut Vec<ChatMessage>,
    pinned: Value,
) -> Result<Option<ContextWindowStats>> {
    enforce_context_window_inner(config, messages, Some(store), session_id, turn_id, pinned)
}

fn enforce_context_window_inner(
    config: &ProviderRuntimeConfig,
    messages: &mut Vec<ChatMessage>,
    archive_store: Option<&AiStore>,
    session_id: &str,
    turn_id: &str,
    pinned: Value,
) -> Result<Option<ContextWindowStats>> {
    let original_messages = messages.len();
    let original_chars = total_chars(messages);
    let mut stats = ContextWindowStats {
        original_messages,
        original_chars,
        max_context_tokens: context_window_tokens(config),
        ..ContextWindowStats::default()
    };
    stats.estimated_limit_chars = stats
        .max_context_tokens
        .saturating_mul(CHARS_PER_TOKEN_ESTIMATE);
    stats.threshold_chars = stats
        .estimated_limit_chars
        .saturating_mul(CONTEXT_WINDOW_THRESHOLD_PERCENT)
        / 100;

    let mut archive_items = Vec::<MemoryArchiveItem>::new();
    let mut tool_replacements = Vec::<(usize, String, usize)>::new();
    for (index, message) in messages.iter().enumerate() {
        if let Some((replacement, removed_chars, raw_value)) =
            truncated_tool_result_message(message)
        {
            archive_items.push(MemoryArchiveItem {
                source_kind: "tool_result_truncated".to_string(),
                source_ref: json!({ "messageIndex": index, "role": message.role }),
                raw: json!({
                    "role": message.role,
                    "content": raw_value,
                }),
                normalized: raw_value.to_string(),
            });
            tool_replacements.push((index, replacement, removed_chars));
        }
    }
    archive_before_mutation(
        archive_store,
        session_id,
        turn_id,
        "tool_result_truncation",
        archive_items,
        assembly_metadata(&stats, &pinned, "tool_result_truncation"),
        &mut stats,
    )?;
    for (index, replacement, removed_chars) in tool_replacements {
        if let Some(message) = messages.get_mut(index) {
            message.content = replacement;
            stats.truncated_tool_results += 1;
            stats.truncated_tool_result_chars = stats
                .truncated_tool_result_chars
                .saturating_add(removed_chars);
        }
    }

    let after_tool_truncation_chars = total_chars(messages);
    if after_tool_truncation_chars <= stats.threshold_chars {
        if stats.truncated_tool_results == 0 {
            return Ok(None);
        }
        stats.final_messages = messages.len();
        stats.final_chars = after_tool_truncation_chars;
        return Ok(Some(stats));
    }

    let mut system_messages = Vec::new();
    let mut non_system = Vec::<(usize, ChatMessage)>::new();
    for (global_index, message) in messages.iter().enumerate() {
        if message.role == "system" {
            system_messages.push(message.clone());
        } else {
            non_system.push((global_index, message.clone()));
        }
    }

    let pinned_user = non_system
        .iter()
        .enumerate()
        .rev()
        .find(|(_, (_, message))| {
            message.role == "user" && !message.content.starts_with(TOOL_RESULT_PREFIX)
        })
        .map(|(index, (_, message))| (index, message.clone()));
    let mut kept_reversed = Vec::<(usize, usize, ChatMessage)>::new();
    let mut used_chars = total_chars(&system_messages);
    let summary_reserve = 96;
    let target_chars = stats.threshold_chars.saturating_sub(summary_reserve);
    for (index, (global_index, message)) in non_system.iter().enumerate().rev() {
        if pinned_user
            .as_ref()
            .map(|(pinned, _)| *pinned == index)
            .unwrap_or(false)
        {
            continue;
        }
        let message_chars = message.content.chars().count();
        if kept_reversed.is_empty() || used_chars.saturating_add(message_chars) <= target_chars {
            used_chars = used_chars.saturating_add(message_chars);
            kept_reversed.push((index, *global_index, message.clone()));
        } else {
            break;
        }
    }
    if let Some((index, message)) = pinned_user {
        if !kept_reversed.iter().any(|(kept, _, _)| *kept == index) {
            let global_index = non_system
                .get(index)
                .map(|(global_index, _)| *global_index)
                .unwrap_or(index);
            kept_reversed.push((index, global_index, message));
        }
    }
    kept_reversed.sort_by_key(|(index, _, _)| *index);
    let kept_global_indexes = kept_reversed
        .iter()
        .map(|(_, global_index, _)| *global_index)
        .collect::<HashSet<_>>();
    let removed_archive_items = messages
        .iter()
        .enumerate()
        .filter(|(index, message)| {
            message.role != "system" && kept_global_indexes.contains(index) == false
        })
        .map(|(index, message)| MemoryArchiveItem {
            source_kind: "context_gap_message".to_string(),
            source_ref: json!({ "messageIndex": index, "role": message.role }),
            raw: json!({
                "role": message.role,
                "content": message.content,
            }),
            normalized: format!("{}: {}", message.role, message.content),
        })
        .collect::<Vec<_>>();
    archive_before_mutation(
        archive_store,
        session_id,
        turn_id,
        "context_window_trim",
        removed_archive_items,
        assembly_metadata(&stats, &pinned, "context_window_trim"),
        &mut stats,
    )?;

    let kept_non_system = kept_reversed
        .into_iter()
        .map(|(_, _, message)| message)
        .collect::<Vec<_>>();
    stats.removed_messages = non_system.len().saturating_sub(kept_non_system.len());

    let mut next = system_messages;
    if stats.removed_messages > 0 {
        next.push(ChatMessage {
            role: "system".to_string(),
            content: format!(
                "{EARLIER_CONVERSATION_PREFIX} {} messages removed; archived in Agent Memory V2]",
                stats.removed_messages
            ),
        });
    }
    next.extend(kept_non_system);
    stats.final_messages = next.len();
    stats.final_chars = total_chars(&next);
    *messages = next;
    Ok(Some(stats))
}

pub(super) fn context_window_event_payload(stats: &ContextWindowStats) -> Value {
    json!({
        "originalMessages": stats.original_messages,
        "finalMessages": stats.final_messages,
        "removedMessages": stats.removed_messages,
        "originalChars": stats.original_chars,
        "finalChars": stats.final_chars,
        "maxContextTokens": stats.max_context_tokens,
        "estimatedLimitChars": stats.estimated_limit_chars,
        "thresholdChars": stats.threshold_chars,
        "truncatedToolResults": stats.truncated_tool_results,
        "truncatedToolResultChars": stats.truncated_tool_result_chars,
        "trimJournalId": stats.trim_journal_id,
        "archivedItems": stats.archived_items,
        "duplicateArchiveItems": stats.duplicate_archive_items,
    })
}

fn context_window_tokens(config: &ProviderRuntimeConfig) -> usize {
    let Some(metadata) = config.model_runtime_metadata.as_ref() else {
        return DEFAULT_CONTEXT_TOKENS;
    };
    for key in [
        "context_window",
        "contextWindow",
        "contextWindowTokens",
        "max_context_tokens",
        "maxContextTokens",
        "input_token_limit",
        "inputTokenLimit",
    ] {
        if let Some(value) = metadata.get(key).and_then(Value::as_u64) {
            return usize::try_from(value)
                .unwrap_or(DEFAULT_CONTEXT_TOKENS)
                .max(1);
        }
    }
    DEFAULT_CONTEXT_TOKENS
}

fn truncated_tool_result_message(message: &ChatMessage) -> Option<(String, usize, Value)> {
    let raw_json = message.content.strip_prefix(TOOL_RESULT_PREFIX)?;
    let mut value = serde_json::from_str::<Value>(raw_json).ok()?;
    let content = value.get_mut("content")?.as_str()?.to_string();
    let original_chars = content.chars().count();
    if original_chars <= TOOL_RESULT_CONTENT_LIMIT_CHARS {
        return None;
    }
    let truncated = content
        .chars()
        .take(TOOL_RESULT_CONTENT_LIMIT_CHARS)
        .collect::<String>();
    value["content"] = Value::String(format!("{truncated}\n{TOOL_RESULT_TRUNCATION_MARKER}"));
    value["truncated"] = Value::Bool(true);
    let replacement = format!(
        "{TOOL_RESULT_PREFIX}{}",
        serde_json::to_string(&value).ok()?
    );
    Some((
        replacement,
        original_chars.saturating_sub(TOOL_RESULT_CONTENT_LIMIT_CHARS),
        serde_json::from_str::<Value>(raw_json)
            .unwrap_or_else(|_| Value::String(raw_json.to_string())),
    ))
}

fn total_chars(messages: &[ChatMessage]) -> usize {
    messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum()
}

fn archive_before_mutation(
    archive_store: Option<&AiStore>,
    session_id: &str,
    turn_id: &str,
    reason: &str,
    items: Vec<MemoryArchiveItem>,
    assembly: Value,
    stats: &mut ContextWindowStats,
) -> Result<()> {
    let Some(store) = archive_store else {
        return Ok(());
    };
    if items.is_empty() {
        return Ok(());
    }
    if let Some(summary) =
        store.archive_context_trim(session_id, turn_id, reason, items, assembly)?
    {
        stats.trim_journal_id = Some(summary.trim_journal_id);
        stats.archived_items = stats.archived_items.saturating_add(summary.archived_count);
        stats.duplicate_archive_items = stats
            .duplicate_archive_items
            .saturating_add(summary.duplicate_count);
    }
    Ok(())
}

fn assembly_metadata(stats: &ContextWindowStats, pinned: &Value, reason: &str) -> Value {
    json!({
        "schemaVersion": "v2",
        "reason": reason,
        "budget": {
            "maxContextTokens": stats.max_context_tokens,
            "estimatedLimitChars": stats.estimated_limit_chars,
            "thresholdChars": stats.threshold_chars,
        },
        "formulaInputs": {
            "B": stats.estimated_limit_chars,
            "U": stats.original_chars,
            "G": stats.original_chars.saturating_sub(stats.threshold_chars),
            "D": stats.truncated_tool_result_chars,
            "R": stats.removed_messages,
        },
        "layers": {
            "head": "system_and_early_context_budget",
            "pinned": pinned,
            "middle": "salience_budget",
            "tail": "recent_messages_budget",
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(tokens: usize) -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "test".to_string(),
            protocol_id: "test".to_string(),
            base_url: String::new(),
            api_key: None,
            auth_scheme: None,
            headers: Default::default(),
            connection_config: Default::default(),
            model_runtime_metadata: Some(json!({ "contextWindow": tokens })),
            model: "test-model".to_string(),
        }
    }

    #[test]
    fn context_window_truncates_middle_history_and_keeps_current_user() {
        let mut messages = vec![ChatMessage {
            role: "system".to_string(),
            content: "system".to_string(),
        }];
        for index in 0..12 {
            messages.push(ChatMessage {
                role: if index % 2 == 0 { "user" } else { "assistant" }.to_string(),
                content: format!("message-{index}-{}", "x".repeat(180)),
            });
        }

        let stats = enforce_context_window(&config(400), &mut messages).expect("truncated");

        assert!(stats.removed_messages > 0);
        assert!(messages
            .iter()
            .any(|message| message.content.starts_with(EARLIER_CONVERSATION_PREFIX)));
        assert!(messages
            .iter()
            .any(|message| message.content.starts_with("message-10-")));
    }

    #[test]
    fn context_window_truncates_large_tool_result_content() {
        let content = "x".repeat(9_500);
        let tool_result = json!({
            "schemaVersion": "v1",
            "content": content,
            "truncated": false
        });
        let mut messages = vec![ChatMessage {
            role: "user".to_string(),
            content: format!("{TOOL_RESULT_PREFIX}{tool_result}"),
        }];

        let stats =
            enforce_context_window(&config(128_000), &mut messages).expect("tool truncation");

        assert_eq!(stats.truncated_tool_results, 1);
        assert!(messages[0].content.contains(TOOL_RESULT_TRUNCATION_MARKER));
        assert!(messages[0].content.contains("\"truncated\":true"));
    }
}
