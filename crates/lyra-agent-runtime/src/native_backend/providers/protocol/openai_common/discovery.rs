use reqwest::blocking::Client;
use serde_json::Value;

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
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?;
            if !is_supported_text_model_id(id, scope) {
                return None;
            }
            let route = registry::require_route(&provider.route_id).ok();
            let modalities = extract_api_input_modalities(item);
            Some(model_capabilities::discovered_model(
                id,
                Some(id.to_string()),
                None,
                route.as_ref(),
                modalities.as_deref(),
            ))
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

/// 从 API /models 响应的单个 model item 中提取输入模态。
/// 检查多种字段格式（不同 provider 返回不同结构）：
/// - `input_modalities`: `["text", "image"]`           (OpenRouter)
/// - `architecture.input_modalities`: `["text","image"]`  (Vercel AI Gateway, llama.cpp)
/// - `capabilities.images`: `true`                       (部分 OpenAI-compatible)
/// - `supported_input_modalities`: `["text","image"]`    (部分 provider)
fn extract_api_input_modalities(item: &Value) -> Option<Vec<String>> {
    // input_modalities (top-level)
    if let Some(arr) = item.get("input_modalities").and_then(Value::as_array) {
        let modalities: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        if !modalities.is_empty() {
            return Some(modalities);
        }
    }
    // architecture.input_modalities (llama.cpp, Vercel AI Gateway)
    if let Some(arr) = item
        .get("architecture")
        .and_then(|arch| arch.get("input_modalities"))
        .and_then(Value::as_array)
    {
        let modalities: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        if !modalities.is_empty() {
            return Some(modalities);
        }
    }
    // supported_input_modalities (alternate field name)
    if let Some(arr) = item
        .get("supported_input_modalities")
        .and_then(Value::as_array)
    {
        let modalities: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        if !modalities.is_empty() {
            return Some(modalities);
        }
    }
    // capabilities.images: true (boolean shorthand)
    if let Some(true) = item
        .get("capabilities")
        .and_then(|cap| cap.get("images"))
        .and_then(Value::as_bool)
    {
        return Some(vec!["text".to_string(), "image".to_string()]);
    }
    None
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

    use serde_json::json;

    #[test]
    fn extract_modalities_from_top_level_field() {
        let item = json!({
            "id": "test-model",
            "input_modalities": ["text", "image"]
        });
        let result = extract_api_input_modalities(&item);
        assert_eq!(result, Some(vec!["text".to_string(), "image".to_string()]));
    }

    #[test]
    fn extract_modalities_from_architecture_field() {
        let item = json!({
            "id": "test-model",
            "architecture": {
                "input_modalities": ["text", "image", "audio"]
            }
        });
        let result = extract_api_input_modalities(&item);
        assert_eq!(
            result,
            Some(vec![
                "text".to_string(),
                "image".to_string(),
                "audio".to_string()
            ])
        );
    }

    #[test]
    fn extract_modalities_from_capabilities_images_boolean() {
        let item = json!({
            "id": "test-model",
            "capabilities": {
                "images": true
            }
        });
        let result = extract_api_input_modalities(&item);
        assert!(result.is_some());
        assert!(result.unwrap().contains(&"image".to_string()));
    }

    #[test]
    fn extract_modalities_from_supported_input_modalities() {
        let item = json!({
            "id": "test-model",
            "supported_input_modalities": ["text", "image"]
        });
        let result = extract_api_input_modalities(&item);
        assert_eq!(result, Some(vec!["text".to_string(), "image".to_string()]));
    }

    #[test]
    fn extract_modalities_none_when_no_modality_fields() {
        let item = json!({
            "id": "test-model",
            "owned_by": "test-org"
        });
        assert_eq!(extract_api_input_modalities(&item), None);
    }

    #[test]
    fn extract_modalities_none_when_capabilities_images_false() {
        let item = json!({
            "id": "test-model",
            "capabilities": {
                "images": false
            }
        });
        assert_eq!(extract_api_input_modalities(&item), None);
    }
}
