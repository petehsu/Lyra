use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "ollama";
pub(crate) const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";
pub(crate) const CLOUD_ROUTE_ID: &str = "ollama_cloud";
pub(crate) const CLOUD_DEFAULT_BASE_URL: &str = "https://ollama.com";
pub(crate) const CLOUD_OPENAI_ROUTE_ID: &str = "ollama_cloud_openai";
pub(crate) const CLOUD_OPENAI_DEFAULT_BASE_URL: &str = "https://ollama.com/v1";

pub(crate) fn route_descriptors() -> Vec<ProviderRouteDescriptor> {
    vec![descriptor(), cloud_descriptor(), cloud_openai_descriptor()]
}

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "ollama".to_string(),
        protocol_id: protocol::ollama_chat::PROTOCOL_ID.to_string(),
        protocol_family: protocol::ollama_chat::PROTOCOL_FAMILY.to_string(),
        label: "Ollama".to_string(),
        description: "Local Ollama native chat route.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "chat".to_string(),
        auth_kind: "none_or_header".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: Some("ollama".to_string()),
        catalog_section: "local".to_string(),
        quick_setup_supported: false,
        supports_stateful_prompt_contract: false,
    }
}

pub(crate) fn cloud_descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: CLOUD_ROUTE_ID.to_string(),
        provider_id: "ollama".to_string(),
        protocol_id: protocol::ollama_chat::PROTOCOL_ID.to_string(),
        protocol_family: protocol::ollama_chat::PROTOCOL_FAMILY.to_string(),
        label: "Ollama Cloud".to_string(),
        description: "Ollama Cloud hosted native chat route.".to_string(),
        default_base_url: Some(CLOUD_DEFAULT_BASE_URL.to_string()),
        api_method: "chat".to_string(),
        auth_kind: "bearer".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: false,
    }
}

/// Ollama Cloud via the OpenAI-compatible `/v1/chat/completions` endpoint.
///
/// The native `/api/chat` protocol emits `tool_calls[].function.arguments`
/// as a JSON object, which some hosted models (e.g. GLM) truncate or
/// malformed; the OpenAI-compatible path receives arguments as a JSON string
/// and routes through the shared OpenAI streaming parser, which is more
/// tolerant of partial output and benefits from the JSON-repair fallback.
pub(crate) fn cloud_openai_descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: CLOUD_OPENAI_ROUTE_ID.to_string(),
        provider_id: "ollama".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Ollama Cloud (OpenAI)".to_string(),
        description: "Ollama Cloud OpenAI-compatible chat completions route.".to_string(),
        default_base_url: Some(CLOUD_OPENAI_DEFAULT_BASE_URL.to_string()),
        api_method: "chatCompletions".to_string(),
        auth_kind: "bearer".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: false,
    }
}