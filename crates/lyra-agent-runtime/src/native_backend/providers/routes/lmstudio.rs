use reqwest::blocking::Client;
use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{NativeProviderModel, NativeProviderProfile, providers::transport},
};

use super::{
    super::{protocol, types::ProviderRouteDescriptor},
    RouteModelDiscoveryHook,
};

pub(crate) const ROUTE_ID: &str = "lmstudio";
pub(crate) const DEFAULT_BASE_URL: &str = "http://127.0.0.1:1234/v1";

static MODEL_DISCOVERY_HOOK: LmStudioModelDiscoveryHook = LmStudioModelDiscoveryHook;

pub(crate) fn model_discovery_hook() -> &'static dyn RouteModelDiscoveryHook {
    &MODEL_DISCOVERY_HOOK
}

pub(crate) fn descriptor() -> ProviderRouteDescriptor {
    ProviderRouteDescriptor {
        id: ROUTE_ID.to_string(),
        provider_id: "lmstudio".to_string(),
        protocol_id: protocol::openai_chat_completions::PROTOCOL_ID.to_string(),
        protocol_family: protocol::openai_chat_completions::PROTOCOL_FAMILY.to_string(),
        label: "LM Studio".to_string(),
        description: "Local LM Studio HTTP server route.".to_string(),
        default_base_url: Some(DEFAULT_BASE_URL.to_string()),
        api_method: "chatCompletions".to_string(),
        auth_kind: "none_or_header".to_string(),
        runtime_supported: true,
        model_discovery_supported: true,
        custom_headers_supported: true,
        local_backend: Some("lmstudio".to_string()),
        catalog_section: "local".to_string(),
        quick_setup_supported: false,
    }
}

struct LmStudioModelDiscoveryHook;

impl RouteModelDiscoveryHook for LmStudioModelDiscoveryHook {
    fn descriptor(&self) -> ProviderRouteDescriptor {
        descriptor()
    }

    fn discover_models(
        &self,
        provider: &NativeProviderProfile,
    ) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let url = lmstudio_native_models_url(provider)?;
        let request = client.get(url);
        let request = if transport::auth::resolve_api_key(provider).is_some() {
            transport::auth::apply_model_auth(request, provider)?
        } else {
            request
        };
        let response = request
            .send()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let status = response.status();
        let body: Value = response
            .json()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if !status.is_success() {
            return Err(AgentRuntimeError::Core(format!(
                "LM Studio model discovery failed with status {status}: {body}"
            )));
        }
        Ok(parse_lmstudio_models(&body))
    }
}

fn lmstudio_native_models_url(provider: &NativeProviderProfile) -> AgentRuntimeResult<String> {
    let base_url = provider
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("provider base URL is not configured".to_string()))?
        .trim_end_matches('/');
    let api_base = if base_url.ends_with("/api/v1") {
        base_url.to_string()
    } else if let Some(root) = base_url.strip_suffix("/v1") {
        format!("{}/api/v1", root.trim_end_matches('/'))
    } else if base_url.ends_with("/api") {
        format!("{base_url}/v1")
    } else {
        format!("{base_url}/api/v1")
    };
    Ok(format!("{api_base}/models"))
}

fn parse_lmstudio_models(body: &Value) -> Vec<NativeProviderModel> {
    let items = body
        .get("data")
        .or_else(|| body.get("models"))
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| body.as_array().cloned())
        .unwrap_or_default();
    let mut models = items
        .iter()
        .filter_map(|item| {
            item.get("id")
                .or_else(|| item.get("model"))
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| NativeProviderModel {
            id: id.to_string(),
            label: Some(id.to_string()),
            context_window: None,
            supports_image_input: true,
            supports_tool_calling: true,
            supports_streaming: true,
            enabled: true,
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn provider(base_url: &str) -> NativeProviderProfile {
        NativeProviderProfile {
            id: "lmstudio".to_string(),
            label: "LM Studio".to_string(),
            route_id: ROUTE_ID.to_string(),
            base_url: Some(base_url.to_string()),
            default_model: None,
            api_key: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn derives_native_models_url_from_openai_compatible_base() {
        assert_eq!(
            lmstudio_native_models_url(&provider("http://127.0.0.1:1234/v1")).expect("url"),
            "http://127.0.0.1:1234/api/v1/models"
        );
    }

    #[test]
    fn parses_native_model_arrays() {
        let models = parse_lmstudio_models(&json!({
            "data": [
                { "id": "qwen3" },
                { "model": "gemma3" },
                { "name": "llama3" }
            ]
        }));

        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["gemma3", "llama3", "qwen3"]
        );
    }
}
