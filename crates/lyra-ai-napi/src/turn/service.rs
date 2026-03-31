use std::collections::BTreeMap;
use std::fs;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;

use napi::Result;
use uuid::Uuid;

use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::error::{normalize_required_text, now_ms, to_error, validate_chat_mode};
use crate::events::bus::publish_session_updated;
use crate::events::types::AiRuntimeEvent;
use crate::profile::types::AiProviderProfile;
use crate::provider::stream_chat_completion;
use crate::provider::types::ProviderChatMessage;
use crate::session::service::refresh_session_projection;
use crate::session::types::{AiChatMessage, AiChatToken};
use crate::storage::{registry_db, session_db};
use crate::turn::cancel::{cancel_turn, clear_turn, register_turn, session_has_active_turn};
use crate::turn::types::{CancelAiChatTurnRequest, SendAiChatTurnRequest, SendAiChatTurnResponse};

const ATTACHMENT_TEXT_LIMIT_BYTES: usize = 24_000;

fn create_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn publish_session(storage_root: &str, session_id: &str, fallback_title: Option<&str>, mode: &str) {
    let Ok(session) =
        refresh_session_projection(storage_root, session_id, fallback_title, Some(mode))
    else {
        return;
    };
    let summary = crate::session::types::AiChatSessionSummary {
        id: session.id.clone(),
        title: session.title.clone(),
        updated_at: session.updated_at,
        summary: session.summary.clone(),
        mode: session.mode.clone(),
    };
    publish_session_updated(&AiRuntimeEvent {
        kind: "session_updated".to_string(),
        session,
        summary,
    });
}

fn render_file_context(token: &AiChatToken) -> String {
    let AiChatToken::File {
        name,
        entry_kind,
        path,
        ..
    } = token
    else {
        return String::new();
    };
    if entry_kind != "file" {
        return format!("[Attached directory: {name}]");
    }
    let Some(path) = path.as_deref() else {
        return format!("[Attached file: {name}]");
    };
    let Ok(bytes) = fs::read(path) else {
        return format!("[Attached file unavailable: {name}]\nPath: {path}");
    };
    if bytes.len() > ATTACHMENT_TEXT_LIMIT_BYTES {
        let truncated = &bytes[..ATTACHMENT_TEXT_LIMIT_BYTES];
        return match String::from_utf8(truncated.to_vec()) {
            Ok(text) => format!("[Attached file: {name}]\n{text}\n[Truncated]"),
            Err(_) => format!("[Attached file too large or binary: {name}]"),
        };
    }
    match String::from_utf8(bytes) {
        Ok(text) => format!("[Attached file: {name}]\n{text}"),
        Err(_) => format!("[Attached file binary: {name}]"),
    }
}

fn materialize_user_content(message: &AiChatMessage) -> String {
    let contexts = message
        .tokens
        .as_ref()
        .map(|tokens| {
            tokens
                .iter()
                .filter_map(|token| match token {
                    AiChatToken::File { .. } => Some(render_file_context(token)),
                    AiChatToken::Text { .. } => None,
                })
                .filter(|entry| entry.is_empty() == false)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if contexts.is_empty() {
        return message.content.clone();
    }
    if message.content.trim().is_empty() {
        return contexts.join("\n\n");
    }
    format!(
        "{}\n\nAttached context:\n{}",
        message.content,
        contexts.join("\n\n")
    )
}

fn build_provider_messages(messages: &[AiChatMessage]) -> Vec<ProviderChatMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let content = if message.role == "user" {
                materialize_user_content(message)
            } else {
                message.content.clone()
            };
            if content.trim().is_empty() {
                return None;
            }
            Some(ProviderChatMessage {
                role: message.role.clone(),
                content,
            })
        })
        .collect()
}

fn update_assistant_message(
    storage_root: &str,
    session_id: &str,
    assistant_message_id: &str,
    content: String,
    status: &str,
) -> Result<()> {
    let mut message = session_db::read_message(storage_root, session_id, assistant_message_id)?
        .ok_or_else(|| to_error("assistant message not found"))?;
    message.content = content;
    message.status = status.to_string();
    message.updated_at = now_ms();
    session_db::write_message(storage_root, session_id, &message)
}

fn run_turn(
    storage_root: String,
    session_id: String,
    turn_id: String,
    assistant_message_id: String,
    fallback_title: Option<String>,
    mode: String,
    profile: AiProviderProfile,
    secrets: BTreeMap<String, String>,
    cancel_flag: Arc<AtomicBool>,
) {
    let result = (|| -> Result<()> {
        let session = refresh_session_projection(
            &storage_root,
            &session_id,
            fallback_title.as_deref(),
            Some(&mode),
        )?;
        let provider_messages = build_provider_messages(&session.messages);
        let mut full_response = session
            .messages
            .iter()
            .find(|message| message.id == assistant_message_id)
            .map(|message| message.content.clone())
            .unwrap_or_default();

        let stream_result = stream_chat_completion(
            &profile,
            &secrets,
            &provider_messages,
            &cancel_flag,
            |delta| {
                full_response.push_str(delta);
                update_assistant_message(
                    &storage_root,
                    &session_id,
                    &assistant_message_id,
                    full_response.clone(),
                    "streaming",
                )?;
                publish_session(&storage_root, &session_id, fallback_title.as_deref(), &mode);
                Ok(())
            },
        );

        match stream_result {
            Ok(final_text) => {
                update_assistant_message(
                    &storage_root,
                    &session_id,
                    &assistant_message_id,
                    final_text,
                    "completed",
                )?;
                registry_db::upsert_turn_state(
                    &storage_root,
                    &turn_id,
                    &session_id,
                    &mode,
                    "completed",
                    None,
                )?;
            }
            Err(error) => {
                let message = error.to_string();
                let final_status = if message.contains("cancelled") {
                    "completed"
                } else {
                    "error"
                };
                let next_content = if full_response.trim().is_empty() {
                    if final_status == "error" {
                        message.clone()
                    } else {
                        String::new()
                    }
                } else {
                    full_response.clone()
                };
                update_assistant_message(
                    &storage_root,
                    &session_id,
                    &assistant_message_id,
                    next_content,
                    final_status,
                )?;
                registry_db::upsert_turn_state(
                    &storage_root,
                    &turn_id,
                    &session_id,
                    &mode,
                    final_status,
                    if final_status == "error" {
                        Some(message.as_str())
                    } else {
                        None
                    },
                )?;
            }
        }
        Ok(())
    })();

    if let Err(error) = result {
        let _ = registry_db::upsert_turn_state(
            &storage_root,
            &turn_id,
            &session_id,
            &mode,
            "error",
            Some(error.to_string().as_str()),
        );
        let _ = update_assistant_message(
            &storage_root,
            &session_id,
            &assistant_message_id,
            error.to_string(),
            "error",
        );
    }

    clear_turn(&turn_id);
    publish_session(&storage_root, &session_id, fallback_title.as_deref(), &mode);
}

pub fn send_chat_turn(request: SendAiChatTurnRequest) -> Result<SendAiChatTurnResponse> {
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let mode = validate_chat_mode(&request.mode)?;
    if mode != "chat" {
        return Err(to_error("Only Chat mode is enabled in v1"));
    }
    let text = normalize_required_text(&request.text, "text")?;
    if session_has_active_turn(&session_id).is_some() {
        return Err(to_error("an ai turn is already running for this session"));
    }

    let profile_record = registry_db::read_default_profile_record(&request.storage_root)?
        .ok_or_else(|| to_error("No AI model profile configured yet"))?;
    let profile = profile_record.to_public();
    let secrets = resolve_secret_values(&profile_record.secret_refs, None, &KeyringSecretStore)?;

    let turn_id = create_id("ai-turn");
    let user_message_id = create_id("ai-message");
    let assistant_message_id = create_id("ai-message");
    let created_at = now_ms();

    let user_message = AiChatMessage {
        id: user_message_id,
        session_id: session_id.clone(),
        turn_id: Some(turn_id.clone()),
        role: "user".to_string(),
        mode: mode.clone(),
        content: text,
        status: "completed".to_string(),
        created_at,
        updated_at: created_at,
        tokens: if request.tokens.is_empty() {
            None
        } else {
            Some(request.tokens.clone())
        },
    };
    let assistant_message = AiChatMessage {
        id: assistant_message_id.clone(),
        session_id: session_id.clone(),
        turn_id: Some(turn_id.clone()),
        role: "assistant".to_string(),
        mode: mode.clone(),
        content: String::new(),
        status: "streaming".to_string(),
        created_at,
        updated_at: created_at,
        tokens: None,
    };

    session_db::write_message(&request.storage_root, &session_id, &user_message)?;
    session_db::write_message(&request.storage_root, &session_id, &assistant_message)?;
    registry_db::upsert_turn_state(
        &request.storage_root,
        &turn_id,
        &session_id,
        &mode,
        "streaming",
        None,
    )?;

    let session = refresh_session_projection(
        &request.storage_root,
        &session_id,
        request.fallback_title.as_deref(),
        Some(&mode),
    )?;
    publish_session(
        &request.storage_root,
        &session_id,
        request.fallback_title.as_deref(),
        &mode,
    );

    let cancel_flag = Arc::new(AtomicBool::new(false));
    register_turn(turn_id.clone(), session_id.clone(), cancel_flag.clone());
    let storage_root = request.storage_root.clone();
    let fallback_title = request.fallback_title.clone();

    thread::spawn(move || {
        run_turn(
            storage_root,
            session_id,
            turn_id,
            assistant_message_id,
            fallback_title,
            mode,
            profile,
            secrets,
            cancel_flag,
        );
    });

    Ok(SendAiChatTurnResponse {
        turn_id: session.active_turn_id.clone().unwrap_or_default(),
        session,
    })
}

pub fn cancel_chat_turn(
    request: CancelAiChatTurnRequest,
) -> Result<crate::session::types::AiChatSession> {
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let _ = cancel_turn(&session_id, &turn_id);
    refresh_session_projection(&request.storage_root, &session_id, None, Some("chat"))
}
