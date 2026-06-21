use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    HostedOpenAiRouteHook,
};

pub(crate) const ROUTE_ID: &str = "custom_openai_compatible";

static HOOK: CustomOpenAiCompatibleRouteHook = CustomOpenAiCompatibleRouteHook;

pub(crate) fn hook() -> &'static dyn HostedOpenAiRouteHook {
    &HOOK
}

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "custom_openai_compatible".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Custom OpenAI-Compatible".to_string(),
        description: "Manual OpenAI-compatible HTTP endpoint.".to_string(),
        default_base_url: None,
        api_method: "chatCompletions".to_string(),
        auth_kind: "bearer_or_header".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: None,
        catalog_section: "custom".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: false,
    }
}

struct CustomOpenAiCompatibleRouteHook;

impl HostedOpenAiRouteHook for CustomOpenAiCompatibleRouteHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor()
    }
}
