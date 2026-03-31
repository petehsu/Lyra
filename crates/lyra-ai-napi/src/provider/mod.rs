pub mod anthropic;
pub mod bedrock;
pub mod gemini;
pub mod google_auth;
pub mod ollama;
pub mod openai_compatible;
pub mod stream_parser;
pub mod types;
pub mod vertex;

use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use napi::Result;

use crate::error::to_error;
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::ProviderChatMessage;

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    match profile.protocol_id.as_str() {
        "openai_compatible" | "lmstudio_openai" => {
            openai_compatible::validate_profile_connection(profile, secrets)
        }
        "anthropic_messages" => anthropic::validate_profile_connection(profile, secrets),
        "gemini_generate_content" => {
            if profile.provider_id == "vertex_ai" {
                vertex::validate_profile_connection(profile, secrets)
            } else {
                gemini::validate_profile_connection(profile, secrets)
            }
        }
        "ollama_chat" => ollama::validate_profile_connection(profile, secrets),
        "bedrock_converse" => bedrock::validate_profile_connection(profile, secrets),
        _ => Err(to_error("unsupported ai protocol")),
    }
}

pub fn discover_models(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<AiProviderModelEntry>> {
    match profile.protocol_id.as_str() {
        "openai_compatible" | "lmstudio_openai" => {
            openai_compatible::discover_models(profile, secrets)
        }
        "anthropic_messages" => anthropic::discover_models(profile, secrets),
        "gemini_generate_content" => {
            if profile.provider_id == "vertex_ai" {
                vertex::discover_models(profile, secrets)
            } else {
                gemini::discover_models(profile, secrets)
            }
        }
        "ollama_chat" => ollama::discover_models(profile, secrets),
        "bedrock_converse" => bedrock::discover_models(profile, secrets),
        _ => Err(to_error("unsupported ai protocol")),
    }
}

pub fn stream_chat_completion(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[ProviderChatMessage],
    cancel_flag: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<String> {
    match profile.protocol_id.as_str() {
        "openai_compatible" | "lmstudio_openai" => openai_compatible::stream_chat_completion(
            profile,
            secrets,
            messages,
            cancel_flag,
            on_delta,
        ),
        "anthropic_messages" => {
            anthropic::stream_chat_completion(profile, secrets, messages, cancel_flag, on_delta)
        }
        "gemini_generate_content" => {
            if profile.provider_id == "vertex_ai" {
                vertex::stream_chat_completion(profile, secrets, messages, cancel_flag, on_delta)
            } else {
                gemini::stream_chat_completion(profile, secrets, messages, cancel_flag, on_delta)
            }
        }
        "ollama_chat" => {
            ollama::stream_chat_completion(profile, secrets, messages, cancel_flag, on_delta)
        }
        "bedrock_converse" => {
            bedrock::stream_chat_completion(profile, secrets, messages, cancel_flag, on_delta)
        }
        _ => Err(to_error("unsupported ai protocol")),
    }
}
