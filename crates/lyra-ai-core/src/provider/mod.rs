pub mod anthropic;
pub mod bedrock;
pub mod gemini;
pub mod google_auth;
pub mod ollama;
pub mod openai_compatible;
pub mod types;
pub mod vertex;

use napi::Result;
use std::collections::BTreeMap;

use crate::error::to_error;
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::{
    AgentInferenceDeltaCallback, AgentInferenceMessage, AgentInferenceResponse,
    AgentReasoningDeltaCallback, AgentToolDefinition,
};

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

pub fn run_agent_inference(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    match profile.protocol_id.as_str() {
        "openai_compatible" | "lmstudio_openai" => openai_compatible::run_agent_inference(
            profile,
            secrets,
            messages,
            tools,
            on_assistant_delta,
            on_reasoning_delta,
        ),
        "anthropic_messages" => anthropic::run_agent_inference(
            profile,
            secrets,
            messages,
            tools,
            on_assistant_delta,
            on_reasoning_delta,
        ),
        "gemini_generate_content" => {
            if profile.provider_id == "vertex_ai" {
                vertex::run_agent_inference(
                    profile,
                    secrets,
                    messages,
                    tools,
                    on_assistant_delta,
                    on_reasoning_delta,
                )
            } else {
                gemini::run_agent_inference(
                    profile,
                    secrets,
                    messages,
                    tools,
                    on_assistant_delta,
                    on_reasoning_delta,
                )
            }
        }
        "ollama_chat" => ollama::run_agent_inference(
            profile,
            secrets,
            messages,
            tools,
            on_assistant_delta,
            on_reasoning_delta,
        ),
        "bedrock_converse" => bedrock::run_agent_inference(
            profile,
            secrets,
            messages,
            tools,
            on_assistant_delta,
            on_reasoning_delta,
        ),
        _ => Err(to_error("unsupported ai protocol")),
    }
}
