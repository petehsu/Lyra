use std::collections::HashSet;
use std::sync::Mutex;

use napi::Result;
use once_cell::sync::Lazy;

use crate::agent::types::{AgentSession, AGENT_PROFILE_NOT_FOUND, AGENT_TURN_FAILED};
use crate::error::{normalize_required_text, to_error};
use crate::profile::types::StoredAiProviderProfile;
use crate::storage::registry_db;

const AGENT_ERROR_PREFIX: &str = "AGENT_ERROR::";

static ACTIVE_SESSION_TURNS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

pub(crate) struct TurnExecutionGuard {
    session_id: String,
}

impl Drop for TurnExecutionGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_SESSION_TURNS.lock() {
            active.remove(&self.session_id);
        }
    }
}

pub(crate) fn acquire_turn_guard(session_id: &str) -> Result<TurnExecutionGuard> {
    let mut active = ACTIVE_SESSION_TURNS
        .lock()
        .map_err(|_| to_error("agent turn lock is poisoned"))?;
    if active.contains(session_id) {
        return Err(agent_error(
            AGENT_TURN_FAILED,
            "another turn is already running in this session",
        ));
    }
    active.insert(session_id.to_string());
    Ok(TurnExecutionGuard {
        session_id: session_id.to_string(),
    })
}

pub(crate) fn agent_error(code: &str, message: impl Into<String>) -> napi::Error {
    to_error(format!("{AGENT_ERROR_PREFIX}{code}::{}", message.into()))
}

pub(crate) fn resolve_profile_for_turn(
    storage_root: &str,
    session: &AgentSession,
    requested_profile_id: Option<&str>,
) -> Result<StoredAiProviderProfile> {
    let from_request = requested_profile_id
        .map(|value| normalize_required_text(value, "profileId"))
        .transpose()?;
    let selected_profile = if let Some(profile_id) = from_request {
        registry_db::read_profile_record(storage_root, &profile_id)?
    } else if let Some(profile_id) = session.profile_id.as_deref() {
        registry_db::read_profile_record(storage_root, profile_id)?
    } else {
        registry_db::read_default_profile_record(storage_root)?
    };

    selected_profile.ok_or_else(|| {
        agent_error(
            AGENT_PROFILE_NOT_FOUND,
            "no AI profile is available for the current agent turn",
        )
    })
}

pub(crate) fn resolve_profile_for_turn_with_model(
    storage_root: &str,
    session: &AgentSession,
    requested_profile_id: Option<&str>,
    requested_model: Option<&str>,
) -> Result<StoredAiProviderProfile> {
    let mut profile = resolve_profile_for_turn(storage_root, session, requested_profile_id)?;
    let normalized_model = requested_model
        .map(|value| normalize_required_text(value, "model"))
        .transpose()?;
    let Some(model) = normalized_model else {
        return Ok(profile);
    };
    let supports_model =
        profile.model == model || profile.custom_models.iter().any(|entry| entry.id == model);
    if !supports_model {
        return Err(agent_error(
            AGENT_TURN_FAILED,
            format!(
                "requested model `{model}` is not configured for profile `{}`",
                profile.id
            ),
        ));
    }
    profile.model = model;
    Ok(profile)
}

pub(crate) fn is_supported_protocol(protocol_id: &str) -> bool {
    matches!(
        protocol_id,
        "openai_compatible"
            | "lmstudio_openai"
            | "anthropic_messages"
            | "gemini_generate_content"
            | "ollama_chat"
            | "bedrock_converse"
    )
}
