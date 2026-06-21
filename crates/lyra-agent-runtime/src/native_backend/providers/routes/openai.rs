use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "openai";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "openai".to_string(),
        protocol_id: protocol::openai_responses::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_responses::PROTOCOL_FAMILY.to_string(),
        label: "OpenAI".to_string(),
        description: "OpenAI hosted Responses API route.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "responses".to_string(),
        auth_kind: "bearer".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: true,
    }
}
