use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "mistral";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.mistral.ai/v1";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "mistral".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Mistral AI".to_string(),
        description: "Mistral AI OpenAI-compatible endpoint.".to_string(),
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