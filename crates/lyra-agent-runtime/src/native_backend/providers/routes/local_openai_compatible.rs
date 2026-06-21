use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "local_openai_compatible";
pub(crate) const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8000/v1";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "local_openai_compatible".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Local OpenAI-Compatible".to_string(),
        description: "Generic local OpenAI-compatible HTTP server route.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "chatCompletions".to_string(),
        auth_kind: "none_or_header".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: Some("openai_compatible".to_string()),
        catalog_section: "local".to_string(),
        quick_setup_supported: false,
        supports_stateful_prompt_contract: false,
    }
}
