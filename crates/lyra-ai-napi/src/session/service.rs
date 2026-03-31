use napi::Result;

use crate::error::{normalize_required_text, now_ms, validate_chat_mode};
use crate::session::history::{
    resolve_fallback_title, resolve_session_summary, resolve_session_title,
};
use crate::session::types::{AiChatSession, AiChatSessionSummary};
use crate::storage::{registry_db, session_db};

pub fn refresh_session_projection(
    storage_root: &str,
    session_id: &str,
    fallback_title: Option<&str>,
    preferred_mode: Option<&str>,
) -> Result<AiChatSession> {
    let normalized_session_id = normalize_required_text(session_id, "sessionId")?;
    let fallback = resolve_fallback_title(fallback_title);
    let preferred_mode = preferred_mode
        .map(validate_chat_mode)
        .transpose()?
        .unwrap_or_else(|| "chat".to_string());

    let existing_summary = registry_db::read_session_summary(storage_root, &normalized_session_id)?;
    let seed_summary = existing_summary.unwrap_or_else(|| AiChatSessionSummary {
        id: normalized_session_id.clone(),
        title: fallback.clone(),
        updated_at: now_ms(),
        summary: String::new(),
        mode: preferred_mode.clone(),
    });

    let messages = session_db::read_messages(storage_root, &normalized_session_id)?;
    let title = resolve_session_title(&seed_summary.title, &fallback, &messages);
    let summary = resolve_session_summary(&messages);
    let updated_at = messages
        .iter()
        .map(|message| message.updated_at)
        .max()
        .unwrap_or(seed_summary.updated_at);
    let mode = messages
        .iter()
        .rev()
        .find_map(|message| validate_chat_mode(&message.mode).ok())
        .unwrap_or_else(|| seed_summary.mode.clone());

    let next_summary = AiChatSessionSummary {
        id: normalized_session_id.clone(),
        title,
        updated_at,
        summary,
        mode,
    };
    registry_db::write_session_summary(storage_root, &next_summary, seed_summary.updated_at)?;

    Ok(AiChatSession {
        id: next_summary.id,
        title: next_summary.title,
        updated_at: next_summary.updated_at,
        summary: next_summary.summary,
        mode: next_summary.mode,
        active_turn_id: registry_db::read_active_turn_id(storage_root, &normalized_session_id)?,
        messages,
    })
}

pub fn read_session_history(storage_root: &str, limit: usize) -> Result<Vec<AiChatSessionSummary>> {
    registry_db::list_session_summaries(storage_root, limit)
}
