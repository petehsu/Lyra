use reqwest::blocking::Client;
use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        NativeProviderModel, NativeProviderProfile,
        providers::{model_capabilities, registry, transport, types::ProviderRouteDescriptor},
    },
};

use super::{TAGS_ENDPOINT_PATH, apply_headers};

pub(crate) fn discover_models(
    client: &Client,
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let url = transport::http::endpoint_url(provider, TAGS_ENDPOINT_PATH)?;
    let response = apply_headers(client.get(url), provider)?
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "Ollama model discovery failed with status {status}: {body}"
        )));
    }
    let route = registry::require_route(&provider.route_id).ok();
    let mut models = parse_tag_models(&body, route.as_ref());
    let show_url = transport::http::endpoint_url(provider, "api/show")?;
    for model in &mut models {
        let request = apply_headers(client.post(&show_url), provider)?;
        let Ok(response) = request
            .json(&serde_json::json!({ "model": model.id }))
            .send()
        else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(details) = response.json::<Value>() else {
            continue;
        };
        apply_show_capabilities(model, &details);
    }
    Ok(models)
}

fn apply_show_capabilities(model: &mut NativeProviderModel, body: &Value) {
    let capabilities = body
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    model.supports_image_input = capabilities
        .iter()
        .any(|value| matches!(value.as_str(), "vision" | "image"));
    model.supports_tool_calling = capabilities
        .iter()
        .any(|value| matches!(value.as_str(), "tools" | "tool_use" | "tool-use"));
    model.context_window = body
        .get("model_info")
        .and_then(Value::as_object)
        .and_then(|info| {
            info.iter()
                .find(|(key, value)| key.ends_with(".context_length") && value.as_u64().is_some())
                .and_then(|(_, value)| value.as_u64())
        })
        .map(|value| value as usize);
}

fn parse_tag_models(
    body: &Value,
    route: Option<&ProviderRouteDescriptor>,
) -> Vec<NativeProviderModel> {
    let mut models = body
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("name")
                .or_else(|| item.get("model"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| model_capabilities::discovered_model(id, Some(id.to_string()), None, route, None))
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_ollama_tags() {
        let models = parse_tag_models(
            &json!({
                "models": [
                    { "name": "llama3.2:latest" },
                    { "model": "qwen3:8b" }
                ]
            }),
            None,
        );

        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["llama3.2:latest", "qwen3:8b"]
        );
    }

    #[test]
    fn parses_ollama_show_capabilities_without_model_name_guessing() {
        let mut model =
            model_capabilities::discovered_model("custom-model", None, None, None, None);
        apply_show_capabilities(
            &mut model,
            &json!({
                "capabilities": ["completion", "vision", "tools"],
                "model_info": { "llama.context_length": 32768 }
            }),
        );
        assert!(model.supports_image_input);
        assert!(model.supports_tool_calling);
        assert_eq!(model.context_window, Some(32768));
    }
}
