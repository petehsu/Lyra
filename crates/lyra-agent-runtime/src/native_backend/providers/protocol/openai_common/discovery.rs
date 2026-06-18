use reqwest::blocking::Client;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderModel, NativeProviderProfile,
        providers::{model_capabilities, registry, transport},
    },
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModelDiscoveryScope {
    OfficialOpenAiText,
    CompatibleText,
}

pub(crate) fn discover_models(
    client: &Client,
    provider: &NativeProviderProfile,
    require_auth: bool,
    scope: ModelDiscoveryScope,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let url = transport::http::endpoint_url(provider, "models")?;
    let request = client.get(url);
    let request = if require_auth || transport::auth::resolve_api_key(provider).is_some() {
        transport::auth::apply_model_auth(request, provider)?
    } else {
        request
    };
    let response = request
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "provider model discovery failed with status {status}: {body}"
        )));
    }
    let mut models = body
        .get("data")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
        .filter(|id| is_supported_text_model_id(id, scope))
        .map(|id| {
            let route = registry::require_route(&provider.route_id).ok();
            model_capabilities::discovered_model(id, Some(id.to_string()), None, route.as_ref())
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

pub(crate) fn is_supported_text_model_id(id: &str, scope: ModelDiscoveryScope) -> bool {
    let normalized = id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if is_known_non_text_model_id(&normalized) {
        return false;
    }
    match scope {
        ModelDiscoveryScope::OfficialOpenAiText => {
            normalized.starts_with("gpt-")
                || normalized.starts_with("o1")
                || normalized.starts_with("o3")
                || normalized.starts_with("o4")
                || normalized.starts_with("codex")
        }
        ModelDiscoveryScope::CompatibleText => true,
    }
}

fn is_known_non_text_model_id(normalized: &str) -> bool {
    normalized.starts_with("gpt-image")
        || normalized.starts_with("dall-e")
        || normalized.starts_with("tts")
        || normalized.starts_with("whisper")
        || normalized.starts_with("text-embedding")
        || normalized.starts_with("omni-moderation")
        || normalized.contains("embedding")
        || normalized.contains("moderation")
        || normalized.contains("rerank")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatible_discovery_keeps_non_openai_text_models() {
        assert!(is_supported_text_model_id(
            "anthropic/claude-sonnet-4",
            ModelDiscoveryScope::CompatibleText
        ));
        assert!(is_supported_text_model_id(
            "deepseek/deepseek-chat",
            ModelDiscoveryScope::CompatibleText
        ));
        assert!(!is_supported_text_model_id(
            "text-embedding-3-large",
            ModelDiscoveryScope::CompatibleText
        ));
    }

    #[test]
    fn official_openai_discovery_stays_conservative() {
        assert!(is_supported_text_model_id(
            "gpt-5-mini",
            ModelDiscoveryScope::OfficialOpenAiText
        ));
        assert!(!is_supported_text_model_id(
            "anthropic/claude-sonnet-4",
            ModelDiscoveryScope::OfficialOpenAiText
        ));
    }
}
