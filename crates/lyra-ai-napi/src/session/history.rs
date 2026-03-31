use crate::session::types::AiChatMessage;

const DEFAULT_TITLE: &str = "New Chat";

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn resolve_preview(value: &str, max_length: usize) -> String {
    let normalized = normalize_whitespace(value);
    if normalized.chars().count() <= max_length {
        return normalized;
    }
    normalized.chars().take(max_length).collect::<String>() + "..."
}

pub fn resolve_fallback_title(value: Option<&str>) -> String {
    let candidate = value.unwrap_or(DEFAULT_TITLE).trim();
    if candidate.is_empty() {
        DEFAULT_TITLE.to_string()
    } else {
        candidate.to_string()
    }
}

pub fn resolve_session_title(
    current_title: &str,
    fallback_title: &str,
    messages: &[AiChatMessage],
) -> String {
    let normalized_current = current_title.trim();
    if normalized_current.is_empty() == false && normalized_current != fallback_title {
        return normalized_current.to_string();
    }

    if let Some(user_message) = messages.iter().find(|message| message.role == "user") {
        let preview = resolve_preview(&user_message.content, 24);
        if preview.is_empty() == false {
            return preview;
        }
    }

    fallback_title.to_string()
}

pub fn resolve_session_summary(messages: &[AiChatMessage]) -> String {
    for message in messages.iter().rev() {
        let preview = resolve_preview(&message.content, 72);
        if preview.is_empty() == false {
            return preview;
        }
    }
    String::new()
}
