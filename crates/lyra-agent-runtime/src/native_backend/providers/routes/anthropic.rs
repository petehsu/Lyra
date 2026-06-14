use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "anthropic";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.anthropic.com/v1";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "anthropic".to_string(),
        protocol_id: protocol::anthropic_messages::PROTOCOL_ID.to_string(),
        protocol_family: protocol::anthropic_messages::PROTOCOL_FAMILY.to_string(),
        label: "Anthropic".to_string(),
        description: "Anthropic hosted Messages API route.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "messages".to_string(),
        auth_kind: "x-api-key".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
    }
}
