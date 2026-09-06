use std::collections::HashMap;

use reqwest::blocking::Client;
use serde_json::Value;

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::{
    model_capabilities, protocol, registry, transport, types::ProviderRouteDescriptor,
};
use crate::native_backend::{
    CapabilitySupport, NativeCapabilityEvidence, NativeModelCapabilityRecord, NativeProviderModel,
    NativeProviderProfile,
};

pub(crate) const ROUTE_ID: &str = "xai";
pub(crate) const DEFAULT_BASE_URL: &str = "https://api.x.ai/v1";

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "xai".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "xAI".to_string(),
        description: "xAI Grok OpenAI-compatible endpoint.".to_string(),
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

pub(crate) fn discover_video_models(
    client: &Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let url = transport::http::endpoint_url(provider, "video-generation-models")?;
    let response = transport::auth::apply_model_auth(client.get(url), provider)?
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !response.status().is_success() {
        return Ok(Vec::new());
    }
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let route = registry::require_route(&provider.route_id).ok();
    Ok(body
        .get("models")
        .or_else(|| body.get("data"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }
            let input_modalities = item
                .get("input_modalities")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>();
            Some(model_capabilities::discovered_model(
                id,
                Some(id.to_string()),
                None,
                route.as_ref(),
                Some(&input_modalities),
            ))
        })
        .collect())
}

pub(crate) fn video_capability_records(
    models: &[NativeProviderModel],
) -> HashMap<String, NativeModelCapabilityRecord> {
    let observed_at = chrono::Utc::now().to_rfc3339();
    models
        .iter()
        .map(|model| {
            let mut record = NativeModelCapabilityRecord::default();
            for (key, support) in [
                (model_capabilities::INPUT_TEXT, CapabilitySupport::Supported),
                (
                    model_capabilities::OUTPUT_VIDEO,
                    CapabilitySupport::Supported,
                ),
                (
                    model_capabilities::OPERATION_VIDEO_GENERATION,
                    CapabilitySupport::Supported,
                ),
                (
                    model_capabilities::OUTPUT_TEXT,
                    CapabilitySupport::Unsupported,
                ),
                (
                    model_capabilities::OPERATION_LANGUAGE,
                    CapabilitySupport::Unsupported,
                ),
                (
                    model_capabilities::FEATURE_TOOL_CALLING,
                    CapabilitySupport::Unsupported,
                ),
            ] {
                record.detected.insert(key.to_string(), support);
                record.evidence.insert(
                    key.to_string(),
                    NativeCapabilityEvidence {
                        source: "provider_api".to_string(),
                        conflict: false,
                        source_url: Some(
                            "https://docs.x.ai/developers/rest-api-reference/inference/models"
                                .to_string(),
                        ),
                        observed_at: Some(observed_at.clone()),
                        detail: Some("xAI video-generation model catalog".to_string()),
                    },
                );
            }
            (model.id.clone(), record)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_uses_official_video_model_endpoint_shape() {
        assert_eq!(ROUTE_ID, "xai");
        assert!(DEFAULT_BASE_URL.ends_with("/v1"));
    }

    #[test]
    fn video_models_are_not_language_agent_models() {
        let model = model_capabilities::discovered_model(
            "grok-imagine-video",
            None,
            None,
            None,
            Some(&["text".to_string()]),
        );
        let records = video_capability_records(&[model]);
        let record = records.get("grok-imagine-video").expect("record");
        assert_eq!(
            record.detected.get(model_capabilities::OPERATION_LANGUAGE),
            Some(&CapabilitySupport::Unsupported)
        );
        assert_eq!(
            record
                .detected
                .get(model_capabilities::OPERATION_VIDEO_GENERATION),
            Some(&CapabilitySupport::Supported)
        );
    }
}
