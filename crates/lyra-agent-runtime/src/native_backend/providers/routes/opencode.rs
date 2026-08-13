use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    RouteModelDiscoveryHook,
};
use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderModel, NativeProviderProfile,
        providers::{model_capabilities, transport},
    },
};
use serde_json::Value;
use std::time::Duration;

pub(crate) const ZEN_ROUTE_ID: &str = "opencode_zen";
pub(crate) const GO_ROUTE_ID: &str = "opencode_go";
pub(crate) const ZEN_BASE_URL: &str = "https://opencode.ai/zen/v1";
pub(crate) const GO_BASE_URL: &str = "https://opencode.ai/zen/go/v1";

static MODEL_DISCOVERY_HOOK: OpenCodeModelDiscoveryHook = OpenCodeModelDiscoveryHook;

pub(crate) fn route_descriptors() -> Vec<ProviderRouteDescriptor> {
    vec![descriptor_for(ZEN_ROUTE_ID), descriptor_for(GO_ROUTE_ID)]
}

pub(crate) fn model_discovery_hook() -> &'static dyn RouteModelDiscoveryHook {
    &MODEL_DISCOVERY_HOOK
}

pub(crate) fn effective_protocol_id(route_id: &str, model: &str) -> Option<&'static str> {
    let model = model.trim().to_ascii_lowercase();
    match route_id {
        ZEN_ROUTE_ID if model.starts_with("gpt-") || model.starts_with("grok-") => {
            Some(protocol::openai_responses::PROTOCOL_ID)
        }
        ZEN_ROUTE_ID if model.starts_with("claude-") || model.starts_with("qwen") => {
            Some(protocol::anthropic_messages::PROTOCOL_ID)
        }
        ZEN_ROUTE_ID if model.starts_with("gemini-") => {
            Some(protocol::gemini_generate_content::PROTOCOL_ID)
        }
        ZEN_ROUTE_ID => Some(protocol::openai_chat_completions::PROTOCOL_ID),
        GO_ROUTE_ID if model.starts_with("gpt-") => Some(protocol::openai_responses::PROTOCOL_ID),
        GO_ROUTE_ID if model.starts_with("minimax-") || model.starts_with("qwen") => {
            Some(protocol::anthropic_messages::PROTOCOL_ID)
        }
        GO_ROUTE_ID => Some(protocol::openai_chat_completions::PROTOCOL_ID),
        _ => None,
    }
}

pub(crate) fn effective_api_method(route_id: &str, model: &str) -> Option<&'static str> {
    match effective_protocol_id(route_id, model)? {
        protocol::openai_responses::PROTOCOL_ID => Some("responses"),
        protocol::anthropic_messages::PROTOCOL_ID => Some("messages"),
        protocol::gemini_generate_content::PROTOCOL_ID => Some("generateContent"),
        _ => Some("chatCompletions"),
    }
}

fn descriptor_for(route_id: &str) -> ProviderRouteDescriptor {
    let (label, description, default_base_url) = match route_id {
        ZEN_ROUTE_ID => (
            "OpenCode Zen",
            "OpenCode pay-as-you-go API with automatic per-model protocol routing.",
            ZEN_BASE_URL,
        ),
        GO_ROUTE_ID => (
            "OpenCode Go",
            "OpenCode subscription API with automatic per-model protocol routing.",
            GO_BASE_URL,
        ),
        _ => unreachable!("unsupported OpenCode route id"),
    };
    ProviderRouteDescriptor {
        id: route_id.to_string(),
        provider_id: route_id.to_string(),
        // OpenCode exposes one catalog backed by multiple wire protocols. Chat
        // Completions is the safe route-level default; requests and model catalog
        // entries use `effective_protocol_id` for their concrete model.
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        default_base_url: Some(default_base_url.to_string()),
        api_method: "modelDependent".to_string(),
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

struct OpenCodeModelDiscoveryHook;

impl RouteModelDiscoveryHook for OpenCodeModelDiscoveryHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor_for(ZEN_ROUTE_ID)
    }

    fn discover_models(
        &self,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let url = transport::http::endpoint_url(provider, "models")?;
        let response = transport::auth::apply_model_auth(client.get(url), provider)?
            .send()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let status = response.status();
        let body: Value = response
            .json()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if !status.is_success() {
            return Err(AgentRuntimeError::Core(format!(
                "OpenCode model discovery failed with status {status}: {body}"
            )));
        }
        let mut models = body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .filter(|id| !id.trim().is_empty())
            .map(|id| {
                let mut route = descriptor_for(&provider.route_id);
                let protocol_id = effective_protocol_id(&provider.route_id, id)
                    .unwrap_or(protocol::openai_chat_completions::PROTOCOL_ID);
                route.protocol_id = protocol_id.to_string();
                route.protocol_family = protocol_id.to_string();
                model_capabilities::discovered_model(
                    id,
                    Some(id.to_string()),
                    None,
                    Some(&route),
                    None,
                )
            })
            .collect::<Vec<_>>();
        models.sort_by(|left, right| left.id.cmp(&right.id));
        models.dedup_by(|left, right| left.id == right.id);
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zen_routes_each_documented_model_family_to_its_wire_protocol() {
        assert_eq!(
            effective_protocol_id(ZEN_ROUTE_ID, "gpt-5.6-sol"),
            Some(protocol::openai_responses::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(ZEN_ROUTE_ID, "grok-4.6"),
            Some(protocol::openai_responses::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(ZEN_ROUTE_ID, "claude-sonnet-5"),
            Some(protocol::anthropic_messages::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(ZEN_ROUTE_ID, "qwen3.6-plus"),
            Some(protocol::anthropic_messages::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(ZEN_ROUTE_ID, "gemini-3.6-flash"),
            Some(protocol::gemini_generate_content::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(ZEN_ROUTE_ID, "deepseek-v4-pro"),
            Some(protocol::openai_chat_completions::PROTOCOL_ID)
        );
    }

    #[test]
    fn go_routes_responses_messages_and_chat_models_separately() {
        assert_eq!(
            effective_protocol_id(GO_ROUTE_ID, "gpt-5.6-luna"),
            Some(protocol::openai_responses::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(GO_ROUTE_ID, "minimax-m3"),
            Some(protocol::anthropic_messages::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(GO_ROUTE_ID, "qwen3.8-max"),
            Some(protocol::anthropic_messages::PROTOCOL_ID)
        );
        assert_eq!(
            effective_protocol_id(GO_ROUTE_ID, "grok-4.5"),
            Some(protocol::openai_chat_completions::PROTOCOL_ID)
        );
    }
}
