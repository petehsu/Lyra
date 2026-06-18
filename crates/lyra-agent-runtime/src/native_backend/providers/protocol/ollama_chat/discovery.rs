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
    Ok(parse_tag_models(&body, route.as_ref()))
}

fn parse_tag_models(body: &Value, route: Option<&ProviderRouteDescriptor>) -> Vec<NativeProviderModel> {
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
        .map(|id| model_capabilities::discovered_model(id, Some(id.to_string()), None, route))
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
}
