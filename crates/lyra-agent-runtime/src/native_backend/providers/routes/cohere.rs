use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "cohere";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.cohere.ai/v2";

/// ponytail: Cohere v2 API is OpenAI-compatible at the chat/completions level.
/// If tool-call streaming semantics diverge, add a dedicated cohere protocol family.
pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "cohere".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Cohere".to_string(),
        description: "Cohere Command models via OpenAI-compatible v2 endpoint.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
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
