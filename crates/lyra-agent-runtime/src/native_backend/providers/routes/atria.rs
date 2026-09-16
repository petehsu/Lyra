use crate::{
    native_backend::{
        providers::protocol::openai_common::{self, ModelDiscoveryScope},
        NativeProviderModel, NativeProviderProfile, ReasoningReplayField,
    },
    AgentRuntimeError, AgentRuntimeResult,
};

use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    RouteModelDiscoveryHook,
};

pub(crate) const ROUTE_ID: &str = "atria";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.atria-asi.ai/v1";
pub(crate) const DEFAULT_MODEL: &str = "Atria-Dawn-Preview";
const CONTEXT_WINDOW: usize = 256_000;

static MODEL_DISCOVERY_HOOK: AtriaModelDiscoveryHook = AtriaModelDiscoveryHook;

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "atria".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Atria ASI".to_string(),
        description: "Atria Dawn Preview OpenAI-compatible endpoint.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
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

pub(crate) fn model_discovery_hook() -> &'static dyn RouteModelDiscoveryHook {
    &MODEL_DISCOVERY_HOOK
}

fn documented_model() -> NativeProviderModel {
    NativeProviderModel {
        id: DEFAULT_MODEL.to_string(),
        label: Some("Atria Dawn Preview".to_string()),
        context_window: Some(CONTEXT_WINDOW),
        supports_image_input: false,
        supports_tool_calling: true,
        supports_streaming: true,
        supports_reasoning_effort: None,
        reasoning_replay_field: ReasoningReplayField::Auto,
        requires_reasoning_field_on_assistant_messages: None,
        supports_tool_choice: None,
        enabled: true,
        api_npm: None,
    }
}

fn apply_documented_facts(mut model: NativeProviderModel) -> NativeProviderModel {
    if model.id.eq_ignore_ascii_case(DEFAULT_MODEL) {
        model.id = DEFAULT_MODEL.to_string();
        if model
            .label
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            model.label = Some("Atria Dawn Preview".to_string());
        }
        model.context_window = Some(model.context_window.unwrap_or(CONTEXT_WINDOW));
        model.supports_image_input = false;
        model.supports_tool_calling = true;
        model.supports_streaming = true;
    }
    model
}

fn merge_documented_catalog(models: Vec<NativeProviderModel>) -> Vec<NativeProviderModel> {
    let mut models = models
        .into_iter()
        .map(apply_documented_facts)
        .collect::<Vec<_>>();
    if !models.iter().any(|model| model.id == DEFAULT_MODEL) {
        models.push(documented_model());
    }
    models
}

struct AtriaModelDiscoveryHook;

impl RouteModelDiscoveryHook for AtriaModelDiscoveryHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor()
    }

    fn discover_models(
        &self,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let discovered = openai_common::discover_models(
            &client,
            provider,
            true,
            ModelDiscoveryScope::CompatibleText,
        )?;
        Ok(merge_documented_catalog(discovered))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_model_keeps_api_id_and_text_only_window() {
        let model = documented_model();
        assert_eq!(model.id, "Atria-Dawn-Preview");
        assert_eq!(model.context_window, Some(256_000));
        assert!(!model.supports_image_input);
        assert!(model.supports_tool_calling);
        assert!(model.supports_streaming);
    }

    #[test]
    fn merge_documented_catalog_restores_missing_and_canonical_id() {
        let merged = merge_documented_catalog(vec![NativeProviderModel {
            id: "atria-dawn-preview".to_string(),
            label: None,
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: false,
            supports_streaming: false,
            supports_reasoning_effort: None,
            reasoning_replay_field: ReasoningReplayField::Auto,
            requires_reasoning_field_on_assistant_messages: None,
            supports_tool_choice: None,
            enabled: true,
            api_npm: None,
        }]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, DEFAULT_MODEL);
        assert!(!merged[0].supports_image_input);
        assert!(merged[0].supports_tool_calling);
        assert_eq!(merged[0].context_window, Some(CONTEXT_WINDOW));

        let filled = merge_documented_catalog(Vec::new());
        assert_eq!(filled.len(), 1);
        assert_eq!(filled[0].id, DEFAULT_MODEL);
    }
}
