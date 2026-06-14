use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "google_gemini";
pub(crate) const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "google_gemini".to_string(),
        protocol_id: protocol::gemini_generate_content::PROTOCOL_ID.to_string(),
        protocol_family: protocol::gemini_generate_content::PROTOCOL_FAMILY.to_string(),
        label: "Google Gemini".to_string(),
        description: "Google hosted Gemini GenerateContent API route.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "generateContent".to_string(),
        auth_kind: "x-goog-api-key".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
    }
}
