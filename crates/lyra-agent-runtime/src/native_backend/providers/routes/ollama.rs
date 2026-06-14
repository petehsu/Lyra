use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "ollama";
pub(crate) const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";

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
    }
}
