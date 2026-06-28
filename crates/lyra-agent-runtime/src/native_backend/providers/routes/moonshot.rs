use super::super::{protocol, types::ProviderRouteDescriptor};

pub(crate) const ROUTE_ID: &str = "moonshot";
pub(crate) const CN_ROUTE_ID: &str = "moonshot_cn";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.moonshot.ai/v1";
pub(crate) const CN_BASE_URL: &str = "https://api.moonshot.cn/v1";

pub(crate) fn route_descriptors() -> Vec<ProviderRouteDescriptor> {
    [ROUTE_ID, CN_ROUTE_ID]
        .into_iter()
        .map(descriptor_for)
        .collect()
}

fn descriptor_for(route_id: &str) -> ProviderRouteDescriptor {
    let (label, description, default_base_url) = match route_id {
        ROUTE_ID => (
            "Kimi",
            "Moonshot Kimi OpenAI-compatible endpoint.",
            DEFAULT_BASE_URL,
        ),
        CN_ROUTE_ID => (
            "Kimi China",
            "Moonshot Kimi China OpenAI-compatible endpoint.",
            CN_BASE_URL,
        ),
        _ => unreachable!("unsupported Moonshot route id"),
    };

    ProviderRouteDescriptor {
        id: route_id.to_string(),
        provider_id: "moonshot".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        default_base_url: Some(default_base_url.to_string()),
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
