use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderModel, NativeProviderProfile,
        providers::protocol::openai_common::{self, ModelDiscoveryScope},
    },
};

use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    RouteModelDiscoveryHook,
};

pub(crate) const OPENAI_ROUTE_ID: &str = "deepseek";
pub(crate) const ANTHROPIC_ROUTE_ID: &str = "deepseek_anthropic";
pub(crate) const OPENAI_BASE_URL: &str = "https://api.deepseek.com";
pub(crate) const ANTHROPIC_BASE_URL: &str = "https://api.deepseek.com/anthropic";

static MODEL_DISCOVERY_HOOK: DeepSeekModelDiscoveryHook = DeepSeekModelDiscoveryHook;

pub(crate) fn route_descriptors() -> Vec<ProviderRouteDescriptor> {
    [OPENAI_ROUTE_ID, ANTHROPIC_ROUTE_ID]
        .into_iter()
        .map(descriptor_for)
        .collect()
}

pub(crate) fn model_discovery_hook() -> &'static dyn RouteModelDiscoveryHook {
    &MODEL_DISCOVERY_HOOK
}

fn descriptor_for(route_id: &str) -> ProviderRouteDescriptor {
    let (label, description, default_base_url, protocol_id, protocol_family, api_method, auth_kind) =
        match route_id {
            OPENAI_ROUTE_ID => (
                "DeepSeek",
                "DeepSeek OpenAI-compatible endpoint.",
                OPENAI_BASE_URL,
                protocol::openai_chat_completions::PROTOCOL_ID,
                protocol::openai_chat_completions::PROTOCOL_FAMILY,
                "chatCompletions",
                "bearer",
            ),
            ANTHROPIC_ROUTE_ID => (
                "DeepSeek Anthropic",
                "DeepSeek Anthropic-compatible endpoint.",
                ANTHROPIC_BASE_URL,
                protocol::anthropic_messages::PROTOCOL_ID,
                protocol::anthropic_messages::PROTOCOL_FAMILY,
                "messages",
                "x-api-key",
            ),
            _ => unreachable!("unsupported DeepSeek route id"),
        };

    ProviderRouteDescriptor {
        id: route_id.to_string(),
        provider_id: "deepseek".to_string(),
        protocol_id: protocol_id.to_string(),
        protocol_family: protocol_family.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        default_base_url: Some(default_base_url.to_string()),
        api_method: api_method.to_string(),
        auth_kind: auth_kind.to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: false,
        local_backend: None,
        catalog_section: "hosted".to_string(),
        quick_setup_supported: true,
        supports_stateful_prompt_contract: false,
    }
}

struct DeepSeekModelDiscoveryHook;

impl RouteModelDiscoveryHook for DeepSeekModelDiscoveryHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor_for(OPENAI_ROUTE_ID)
    }

    fn discover_models(
        &self,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let provider = openai_discovery_profile(provider);
        openai_common::discover_models(
            &client,
            &provider,
            true,
            ModelDiscoveryScope::CompatibleText,
        )
    }
}

fn openai_discovery_profile(provider: &NativeProviderProfile) -> NativeProviderProfile {
    let base_url = if provider.route_id == ANTHROPIC_ROUTE_ID {
        OPENAI_BASE_URL
    } else {
        provider.base_url.as_deref().unwrap_or(OPENAI_BASE_URL)
    };
    NativeProviderProfile {
        route_id: OPENAI_ROUTE_ID.to_string(),
        base_url: Some(base_url.to_string()),
        auth_header: None,
        ..provider.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_discovery_uses_openai_models_endpoint() {
        let profile = NativeProviderProfile {
            id: "deepseek-anthropic".to_string(),
            label: "DeepSeek Anthropic".to_string(),
            route_id: ANTHROPIC_ROUTE_ID.to_string(),
            base_url: Some(ANTHROPIC_BASE_URL.to_string()),
            default_model: None,
            api_key: Some("sk-test".to_string()),
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        };
        let discovery = openai_discovery_profile(&profile);

        assert_eq!(discovery.route_id, OPENAI_ROUTE_ID);
        assert_eq!(discovery.base_url.as_deref(), Some(OPENAI_BASE_URL));
        assert_eq!(discovery.auth_header, None);
    }
}
