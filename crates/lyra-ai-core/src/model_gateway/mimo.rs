mod probe;
mod routes;

use super::{anthropic, apply_headers, client, openai};
use super::{normalize_base_url, ChatMessage, ChatResponse, ModelResponse};
use super::{ProviderRuntimeConfig, ToolDefinition};
use anyhow::{anyhow, Result};
use reqwest::blocking::RequestBuilder;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) const MIMO_AUTH_BEARER: &str = "bearer";
const MIMO_AUTH_API_KEY: &str = "api_key";
const MIMO_PROTOCOL_OPENAI: &str = "mimo_openai_chat_completions";
const MIMO_PROTOCOL_ANTHROPIC: &str = "mimo_anthropic_messages";

pub(super) fn discover_models(
    config: &ProviderRuntimeConfig,
) -> Result<Vec<crate::storage::AiProviderModelEntry>> {
    routes::discover_models(config)
}

pub(super) fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    route_request(config, cancel, |route_config| {
        if route_config.protocol_id == MIMO_PROTOCOL_ANTHROPIC {
            mimo_anthropic(route_config, messages.clone(), cancel, |delta| {
                on_delta(delta)
            })
        } else {
            openai::generate_response(route_config, messages.clone(), cancel, |delta| {
                on_delta(delta)
            })
        }
    })
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    route_request(config, cancel, |route_config| {
        if route_config.protocol_id == MIMO_PROTOCOL_ANTHROPIC {
            mimo_anthropic_with_tools(
                route_config,
                messages.clone(),
                tools.clone(),
                cancel,
                |delta| on_delta(delta),
            )
        } else {
            openai::stream_completion_with_tools(
                route_config,
                messages.clone(),
                tools.clone(),
                cancel,
                |delta| on_delta(delta),
            )
        }
    })
}

fn route_request<T>(
    config: ProviderRuntimeConfig,
    cancel: &AtomicBool,
    mut request: impl FnMut(ProviderRuntimeConfig) -> Result<T>,
) -> Result<T> {
    if let Some(api_key) = config
        .api_key
        .as_deref()
        .and_then(crate::storage::trim_to_string)
    {
        routes::validate_key_for_route(&api_key, &routes::route_mode(&config))?;
    }
    let runtime_routes = routes::runtime_routes(&config);
    if runtime_routes.is_empty() {
        return Err(anyhow!("No MiMo route is available"));
    }
    let route_count = runtime_routes.len();
    let mut auth_error_count = 0_usize;
    let mut last_error = None;
    for route in runtime_routes {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        let mut route_config = config.clone();
        route_config.protocol_id = route.protocol_id.clone();
        route_config.base_url = route.base_url.clone();
        route_config.auth_scheme = Some(route.auth_scheme.clone());
        match request(route_config) {
            Ok(response) => return Ok(response),
            Err(error) => {
                let message = error.to_string();
                if routes::is_auth_error_message(&message) {
                    auth_error_count += 1;
                }
                last_error = Some(message);
            }
        }
    }
    if auth_error_count == route_count {
        return Err(anyhow!(
            "MiMo authentication failed after retrying api-key and Bearer auth. Check that the selected MiMo profile matches the key type (API sk-... or Token Plan tp-...) and that the key is valid."
        ));
    }
    Err(anyhow!(
        "MiMo request failed on all routes: {}",
        last_error.unwrap_or_else(|| "unknown provider error".to_string())
    ))
}

fn mimo_anthropic(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let body = anthropic::messages_body(&config, &messages);
    anthropic::send_anthropic_request(
        config.clone(),
        mimo_request(&config, body)?,
        cancel,
        on_delta,
    )
}

fn mimo_anthropic_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let body = anthropic::messages_body_with_tools(&config, &messages, &tools);
    anthropic::send_anthropic_request_with_tools(
        config.clone(),
        mimo_request(&config, body)?,
        cancel,
        on_delta,
    )
}

fn mimo_request(config: &ProviderRuntimeConfig, body: Value) -> Result<RequestBuilder> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(crate::storage::trim_to_string)
        .ok_or_else(|| anyhow!("MiMo API key is required"))?;
    let auth_scheme = config.auth_scheme.as_deref().unwrap_or(MIMO_AUTH_API_KEY);
    let url = format!("{}/v1/messages", normalize_base_url(config));
    Ok(apply_headers(
        routes::auth(client()?.post(url).json(&body), &api_key, auth_scheme),
        config,
    ))
}

#[cfg(test)]
mod tests {
    use super::routes;
    use super::{ProviderRuntimeConfig, MIMO_PROTOCOL_OPENAI};
    use super::{MIMO_AUTH_API_KEY, MIMO_AUTH_BEARER, MIMO_PROTOCOL_ANTHROPIC};
    use std::collections::HashMap;

    fn config(route_mode: &str) -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "mimo".to_string(),
            protocol_id: MIMO_PROTOCOL_OPENAI.to_string(),
            base_url: String::new(),
            api_key: Some("secret-key".to_string()),
            auth_scheme: None,
            headers: HashMap::new(),
            connection_config: [("mimoRoute".to_string(), route_mode.to_string())]
                .into_iter()
                .collect(),
            model_runtime_metadata: None,
            model: "model-a".to_string(),
        }
    }

    #[test]
    fn api_routes_include_openai_and_anthropic() {
        let route_candidates = routes::route_candidates("api");

        assert_eq!(route_candidates.len(), 2);
        assert_eq!(route_candidates[0].protocol_id, MIMO_PROTOCOL_OPENAI);
        assert_eq!(route_candidates[1].protocol_id, MIMO_PROTOCOL_ANTHROPIC);
    }

    #[test]
    fn runtime_routes_try_both_auth_schemes() {
        let runtime_routes = routes::runtime_routes(&config("api"));

        assert_eq!(runtime_routes.len(), 4);
        assert_eq!(runtime_routes[0].auth_scheme, MIMO_AUTH_API_KEY);
        assert_eq!(runtime_routes[1].auth_scheme, MIMO_AUTH_BEARER);
    }

    #[test]
    fn key_prefix_validation_matches_route_mode() {
        assert!(routes::validate_key_for_route("tp-test", "token_plan").is_ok());
        assert!(routes::validate_key_for_route("sk-test", "api").is_ok());
        assert!(routes::validate_key_for_route("tp-test", "api").is_err());
        assert!(routes::validate_key_for_route("sk-test", "token_plan").is_err());
    }
}
