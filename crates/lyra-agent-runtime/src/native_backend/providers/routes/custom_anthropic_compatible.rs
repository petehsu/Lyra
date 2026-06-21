use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "custom_anthropic_compatible";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "custom_anthropic_compatible".to_string(),
        protocol_id: protocol::anthropic_messages::PROTOCOL_ID.to_string(),
        protocol_family: protocol::anthropic_messages::PROTOCOL_FAMILY.to_string(),
        label: "Custom Anthropic-Compatible".to_string(),
        description: "Manual Anthropic Messages-compatible HTTP endpoint.".to_string(),
        default_base_url: None,
        api_method: "messages".to_string(),
        auth_kind: "x-api-key_or_header".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: None,
        catalog_section: "custom".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: false,
    }
}
