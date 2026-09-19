use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderModel, NativeProviderProfile, ReasoningReplayField,
        providers::protocol::openai_common::{self, ModelDiscoveryScope},
    },
};

use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    RouteModelDiscoveryHook,
};

pub(crate) const ROUTE_ID: &str = "poolside";
pub(crate) const DEFAULT_BASE_URL: &str = "https://inference.poolside.ai/v1";
pub(crate) const DEFAULT_MODEL: &str = "poolside/laguna-s-2.1";
const LAGUNA_S_CONTEXT_WINDOW: usize = 1_000_000;
const LAGUNA_CONTEXT_WINDOW: usize = 256_000;

static MODEL_DISCOVERY_HOOK: PoolsideModelDiscoveryHook = PoolsideModelDiscoveryHook;

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "poolside".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "Poolside".to_string(),
        description: "Poolside hosted OpenAI-compatible inference endpoint.".to_string(),
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

pub(crate) fn default_reasoning_replay_field(route_id: &str) -> Option<ReasoningReplayField> {
    (route_id == ROUTE_ID).then_some(ReasoningReplayField::ReasoningContent)
}

pub(crate) fn default_requires_reasoning_field_on_assistant_messages(
    route_id: &str,
) -> Option<bool> {
    (route_id == ROUTE_ID).then_some(true)
}

fn documented_context_window(model_id: &str) -> Option<usize> {
    let id = model_id.to_ascii_lowercase();
    if id.contains("laguna-xs") || id.contains("laguna-m") {
        Some(LAGUNA_CONTEXT_WINDOW)
    } else if id.contains("laguna-s") {
        Some(LAGUNA_S_CONTEXT_WINDOW)
    } else {
        None
    }
}

fn documented_model() -> NativeProviderModel {
    NativeProviderModel {
        id: DEFAULT_MODEL.to_string(),
        label: Some("Laguna S 2.1".to_string()),
        context_window: Some(LAGUNA_S_CONTEXT_WINDOW),
        supports_image_input: false,
        supports_tool_calling: true,
        supports_streaming: true,
        supports_reasoning_effort: None,
        reasoning_replay_field: ReasoningReplayField::ReasoningContent,
        requires_reasoning_field_on_assistant_messages: Some(true),
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
            model.label = Some("Laguna S 2.1".to_string());
        }
    }
    if let Some(window) = documented_context_window(&model.id) {
        model.context_window = Some(model.context_window.unwrap_or(window));
    }
    model.supports_image_input = false;
    model.supports_tool_calling = true;
    model.supports_streaming = true;
    if model.reasoning_replay_field == ReasoningReplayField::Auto {
        model.reasoning_replay_field = ReasoningReplayField::ReasoningContent;
    }
    if model
        .requires_reasoning_field_on_assistant_messages
        .is_none()
    {
        model.requires_reasoning_field_on_assistant_messages = Some(true);
    }
    model
}

fn merge_documented_catalog(models: Vec<NativeProviderModel>) -> Vec<NativeProviderModel> {
    let mut models = models
        .into_iter()
        .map(apply_documented_facts)
        .collect::<Vec<_>>();
    if !models
        .iter()
        .any(|model| model.id.eq_ignore_ascii_case(DEFAULT_MODEL))
    {
        models.push(documented_model());
    }
    models
}

struct PoolsideModelDiscoveryHook;

impl RouteModelDiscoveryHook for PoolsideModelDiscoveryHook {
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
    fn documented_model_uses_hosted_laguna_s_and_reasoning_content() {
        let model = documented_model();
        assert_eq!(model.id, "poolside/laguna-s-2.1");
        assert_eq!(model.context_window, Some(1_000_000));
        assert!(!model.supports_image_input);
        assert!(model.supports_tool_calling);
        assert_eq!(
            model.reasoning_replay_field,
            ReasoningReplayField::ReasoningContent
        );
        assert_eq!(
            model.requires_reasoning_field_on_assistant_messages,
            Some(true)
        );
        assert_eq!(
            default_reasoning_replay_field(ROUTE_ID),
            Some(ReasoningReplayField::ReasoningContent)
        );
        assert_eq!(
            default_requires_reasoning_field_on_assistant_messages(ROUTE_ID),
            Some(true)
        );
        assert_eq!(default_reasoning_replay_field("openai"), None);
        assert_eq!(
            default_requires_reasoning_field_on_assistant_messages("openai"),
            None
        );
    }

    #[test]
    fn empty_catalog_still_replays_reasoning_content() {
        let provider = NativeProviderProfile {
            id: "poolside".to_string(),
            label: "Poolside".to_string(),
            route_id: ROUTE_ID.to_string(),
            base_url: Some(DEFAULT_BASE_URL.to_string()),
            default_model: Some(DEFAULT_MODEL.to_string()),
            api_key: None,
            api_key_ref: None,
            api_key_env: Some("POOLSIDE_API_KEY".to_string()),
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        };
        let caps = crate::native_backend::providers::model_capabilities::resolve_openai_chat_model_capabilities(
            &provider,
            DEFAULT_MODEL,
        );
        assert_eq!(
            caps.reasoning_replay_field,
            ReasoningReplayField::ReasoningContent
        );
        assert!(caps.requires_reasoning_field_on_assistant_messages);
    }

    #[test]
    fn merge_documented_catalog_fills_empty_and_maps_windows() {
        let filled = merge_documented_catalog(Vec::new());
        assert_eq!(filled.len(), 1);
        assert_eq!(filled[0].id, DEFAULT_MODEL);

        let merged = merge_documented_catalog(vec![NativeProviderModel {
            id: "poolside/laguna-m.1".to_string(),
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
        assert_eq!(merged.len(), 2);
        let m1 = merged
            .iter()
            .find(|model| model.id == "poolside/laguna-m.1")
            .expect("laguna m.1");
        assert_eq!(m1.context_window, Some(256_000));
        assert!(!m1.supports_image_input);
        assert_eq!(
            m1.reasoning_replay_field,
            ReasoningReplayField::ReasoningContent
        );
        assert!(merged.iter().any(|model| model.id == DEFAULT_MODEL));
    }
}
