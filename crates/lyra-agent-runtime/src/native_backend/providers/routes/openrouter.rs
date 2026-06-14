use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    HostedOpenAiRouteHook,
};

pub(crate) const ROUTE_ID: &str = "openrouter";
pub(crate) const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";

static HOOK: OpenRouterRouteHook = OpenRouterRouteHook;

pub(crate) fn hook() -> &'static dyn HostedOpenAiRouteHook {
    &HOOK
}

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "openrouter".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "OpenRouter".to_string(),
        description: "OpenRouter hosted route on the shared OpenAI chat-completions adapter."
            .to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "chatCompletions".to_string(),
        auth_kind: "bearer".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
    }
}

struct OpenRouterRouteHook;

impl HostedOpenAiRouteHook for OpenRouterRouteHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor()
    }
}
