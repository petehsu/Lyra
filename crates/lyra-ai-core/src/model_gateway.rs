use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Context, Result};
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const MIMO_ROUTE_API: &str = "api";
const MIMO_ROUTE_TOKEN_PLAN: &str = "token_plan";
const MIMO_PROTOCOL_OPENAI: &str = "mimo_openai_chat_completions";
const MIMO_PROTOCOL_ANTHROPIC: &str = "mimo_anthropic_messages";
const MIMO_AUTH_API_KEY: &str = "api_key";
const MIMO_AUTH_BEARER: &str = "bearer";

#[derive(Clone, Debug)]
pub struct ProviderRuntimeConfig {
    pub provider_id: String,
    pub protocol_id: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub auth_scheme: Option<String>,
    pub headers: HashMap<String, String>,
    pub connection_config: HashMap<String, String>,
    pub model_runtime_metadata: Option<Value>,
    pub model: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MimoRouteCandidate {
    pub protocol_id: String,
    pub base_url: String,
    pub route_mode: String,
    pub region: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MimoRoute {
    protocol_id: String,
    base_url: String,
    route_mode: String,
    region: Option<String>,
    auth_scheme: String,
    latency_ms: Option<u64>,
}

#[derive(Clone, Debug)]
struct MimoProbeSuccess {
    route: MimoRoute,
    models: Vec<String>,
}

#[derive(Debug)]
struct MimoProbeError {
    message: String,
    auth_failed: bool,
}

#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct ModelResponse {
    pub text: String,
    pub usage: Option<Usage>,
}

pub fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    if config.provider_id == "mimo" {
        return discover_mimo_models(config);
    }
    match config.protocol_id.as_str() {
        "ollama_chat" => discover_ollama_models(config),
        "anthropic_messages" => discover_anthropic_models(config),
        "gemini_generate_content" => discover_google_models(config),
        _ => discover_openai_compatible_models(config),
    }
}

pub fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    if config.provider_id == "mimo" {
        return generate_mimo_response(config, messages, cancel, on_delta);
    }
    match config.protocol_id.as_str() {
        "ollama_chat" => generate_ollama(config, messages, cancel, on_delta),
        "anthropic_messages" => generate_anthropic(config, messages, cancel, on_delta),
        "gemini_generate_content" => generate_google(config, messages, cancel, on_delta),
        _ => generate_openai_compatible(config, messages, cancel, on_delta),
    }
}

pub fn default_base_url(provider_id: &str, protocol_id: &str) -> String {
    match protocol_id {
        "ollama_chat" => "http://127.0.0.1:11434".to_string(),
        "lmstudio_chat_completions" => "http://127.0.0.1:1234/v1".to_string(),
        "anthropic_messages" => "https://api.anthropic.com".to_string(),
        "gemini_generate_content" => "https://generativelanguage.googleapis.com".to_string(),
        _ if provider_id == "mimo" => "https://api.xiaomimimo.com/v1".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

fn client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .context("failed to build AI HTTP client")
}

fn normalize_base_url(config: &ProviderRuntimeConfig) -> String {
    trim_to_string(&config.base_url)
        .unwrap_or_else(|| default_base_url(&config.provider_id, &config.protocol_id))
        .trim_end_matches('/')
        .to_string()
}

fn apply_headers(
    mut request: reqwest::blocking::RequestBuilder,
    config: &ProviderRuntimeConfig,
) -> reqwest::blocking::RequestBuilder {
    for (key, value) in &config.headers {
        if key.trim().is_empty() || value.trim().is_empty() {
            continue;
        }
        request = request.header(key.trim(), value.trim());
    }
    request
}

fn provider_auth(request: RequestBuilder, config: &ProviderRuntimeConfig) -> RequestBuilder {
    match config.api_key.as_deref().and_then(trim_to_string) {
        Some(key) if config.provider_id == "mimo" => match config.auth_scheme.as_deref() {
            Some(MIMO_AUTH_BEARER) => request.bearer_auth(key),
            _ => request.header("api-key", key),
        },
        Some(key) => request.bearer_auth(key),
        None => request,
    }
}

fn request_error(response: Response) -> anyhow::Error {
    let status = response.status();
    anyhow!("model provider request failed: status={status}")
}

fn system_prompt_from_messages(messages: &[ChatMessage]) -> Option<String> {
    let text = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.trim())
        .filter(|content| content.is_empty() == false)
        .collect::<Vec<_>>()
        .join("\n\n");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn openai_chat_body(config: &ProviderRuntimeConfig, messages: &[ChatMessage]) -> Value {
    let body_messages = messages
        .iter()
        .map(|message| json!({ "role": message.role, "content": message.content }))
        .collect::<Vec<_>>();
    json!({
        "model": config.model,
        "messages": body_messages,
        "stream": true
    })
}

fn anthropic_messages_body(config: &ProviderRuntimeConfig, messages: &[ChatMessage]) -> Value {
    let body_messages = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "assistant" } else { "user" },
                "content": message.content
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": config.model,
        "max_tokens": 4096,
        "messages": body_messages,
        "stream": true
    });
    if let Some(system) = system_prompt_from_messages(messages) {
        body["system"] = json!(system);
    }
    body
}

fn google_generate_content_body(messages: &[ChatMessage]) -> Value {
    let contents = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": message.content }]
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({ "contents": contents });
    if let Some(system) = system_prompt_from_messages(messages) {
        body["systemInstruction"] = json!({
            "parts": [{ "text": system }]
        });
    }
    body
}

fn entry(id: impl Into<String>, source: &str) -> AiProviderModelEntry {
    let id = id.into();
    AiProviderModelEntry {
        name: id.clone(),
        id,
        description: None,
        context_window: None,
        supports_images: None,
        supports_tools: None,
        runtime_metadata: None,
        source: source.to_string(),
    }
}

pub fn mimo_route_candidates(route_mode: &str) -> Vec<MimoRouteCandidate> {
    match route_mode {
        MIMO_ROUTE_TOKEN_PLAN => vec![
            mimo_candidate(
                MIMO_PROTOCOL_OPENAI,
                "https://token-plan-cn.xiaomimimo.com/v1",
                MIMO_ROUTE_TOKEN_PLAN,
                Some("cn"),
            ),
            mimo_candidate(
                MIMO_PROTOCOL_OPENAI,
                "https://token-plan-sgp.xiaomimimo.com/v1",
                MIMO_ROUTE_TOKEN_PLAN,
                Some("sgp"),
            ),
            mimo_candidate(
                MIMO_PROTOCOL_OPENAI,
                "https://token-plan-ams.xiaomimimo.com/v1",
                MIMO_ROUTE_TOKEN_PLAN,
                Some("ams"),
            ),
            mimo_candidate(
                MIMO_PROTOCOL_ANTHROPIC,
                "https://token-plan-cn.xiaomimimo.com/anthropic",
                MIMO_ROUTE_TOKEN_PLAN,
                Some("cn"),
            ),
            mimo_candidate(
                MIMO_PROTOCOL_ANTHROPIC,
                "https://token-plan-sgp.xiaomimimo.com/anthropic",
                MIMO_ROUTE_TOKEN_PLAN,
                Some("sgp"),
            ),
            mimo_candidate(
                MIMO_PROTOCOL_ANTHROPIC,
                "https://token-plan-ams.xiaomimimo.com/anthropic",
                MIMO_ROUTE_TOKEN_PLAN,
                Some("ams"),
            ),
        ],
        _ => vec![
            mimo_candidate(
                MIMO_PROTOCOL_OPENAI,
                "https://api.xiaomimimo.com/v1",
                MIMO_ROUTE_API,
                None,
            ),
            mimo_candidate(
                MIMO_PROTOCOL_ANTHROPIC,
                "https://api.xiaomimimo.com/anthropic",
                MIMO_ROUTE_API,
                None,
            ),
        ],
    }
}

fn mimo_candidate(
    protocol_id: &str,
    base_url: &str,
    route_mode: &str,
    region: Option<&str>,
) -> MimoRouteCandidate {
    MimoRouteCandidate {
        protocol_id: protocol_id.to_string(),
        base_url: base_url.to_string(),
        route_mode: route_mode.to_string(),
        region: region.map(ToString::to_string),
    }
}

fn mimo_route_mode(config: &ProviderRuntimeConfig) -> String {
    match config
        .connection_config
        .get("mimoRoute")
        .and_then(|value| trim_to_string(value))
        .as_deref()
    {
        Some(MIMO_ROUTE_TOKEN_PLAN) => MIMO_ROUTE_TOKEN_PLAN.to_string(),
        _ => MIMO_ROUTE_API.to_string(),
    }
}

fn mimo_auth(request: RequestBuilder, api_key: &str, auth_scheme: &str) -> RequestBuilder {
    match auth_scheme {
        MIMO_AUTH_BEARER => request.bearer_auth(api_key),
        _ => request.header("api-key", api_key),
    }
}

fn is_auth_status(status: StatusCode) -> bool {
    status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN
}

fn discover_mimo_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("MiMo API key is required"))?;
    let route_mode = mimo_route_mode(config);
    validate_mimo_key_for_route(&api_key, &route_mode)?;
    let handles = mimo_route_candidates(&route_mode)
        .into_iter()
        .map(|candidate| {
            let config = config.clone();
            let api_key = api_key.clone();
            thread::spawn(move || probe_mimo_route(&config, candidate, &api_key))
        })
        .collect::<Vec<_>>();

    let mut successes = Vec::new();
    let mut errors = Vec::new();
    for handle in handles {
        match handle.join() {
            Ok(Ok(success)) => successes.push(success),
            Ok(Err(error)) => errors.push(error.message),
            Err(_) => errors.push("MiMo route probe failed".to_string()),
        }
    }

    if successes.is_empty() {
        let message = errors
            .into_iter()
            .find(|entry| entry.trim().is_empty() == false)
            .unwrap_or_else(|| "MiMo model discovery failed".to_string());
        return Err(anyhow!("{message}"));
    }
    let models = merge_mimo_discovery(route_mode.as_str(), successes);
    if models.is_empty() {
        return Err(anyhow!("MiMo did not return any models"));
    }
    Ok(models)
}

fn probe_mimo_route(
    config: &ProviderRuntimeConfig,
    candidate: MimoRouteCandidate,
    api_key: &str,
) -> std::result::Result<MimoProbeSuccess, MimoProbeError> {
    match probe_mimo_route_with_auth(config, &candidate, api_key, MIMO_AUTH_API_KEY) {
        Ok(success) => Ok(success),
        Err(error) if error.auth_failed => {
            probe_mimo_route_with_auth(config, &candidate, api_key, MIMO_AUTH_BEARER)
        }
        Err(error) => Err(error),
    }
}

fn probe_mimo_route_with_auth(
    config: &ProviderRuntimeConfig,
    candidate: &MimoRouteCandidate,
    api_key: &str,
    auth_scheme: &str,
) -> std::result::Result<MimoProbeSuccess, MimoProbeError> {
    let url = if candidate.protocol_id == MIMO_PROTOCOL_ANTHROPIC {
        format!("{}/v1/models", candidate.base_url.trim_end_matches('/'))
    } else {
        format!("{}/models", candidate.base_url.trim_end_matches('/'))
    };
    let started_at = Instant::now();
    let response = apply_headers(
        mimo_auth(
            client()
                .map_err(|error| MimoProbeError {
                    message: error.to_string(),
                    auth_failed: false,
                })?
                .get(url),
            api_key,
            auth_scheme,
        ),
        config,
    )
    .send()
    .map_err(|error| MimoProbeError {
        message: error.to_string(),
        auth_failed: false,
    })?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(MimoProbeError {
            message: format!("MiMo route probe failed: status={status}"),
            auth_failed: is_auth_status(status),
        });
    }

    let value: Value = response.json().map_err(|error| MimoProbeError {
        message: error.to_string(),
        auth_failed: false,
    })?;
    let models = parse_data_model_ids(&value).map_err(|error| MimoProbeError {
        message: error.to_string(),
        auth_failed: false,
    })?;
    Ok(MimoProbeSuccess {
        route: MimoRoute {
            protocol_id: candidate.protocol_id.clone(),
            base_url: candidate.base_url.clone(),
            route_mode: candidate.route_mode.clone(),
            region: candidate.region.clone(),
            auth_scheme: auth_scheme.to_string(),
            latency_ms: Some(started_at.elapsed().as_millis().min(u64::MAX as u128) as u64),
        },
        models,
    })
}

fn parse_data_model_ids(value: &Value) -> Result<Vec<String>> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("provider did not return a data array"))?;
    Ok(data
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter_map(trim_to_string)
        .collect())
}

fn merge_mimo_discovery(
    route_mode: &str,
    mut successes: Vec<MimoProbeSuccess>,
) -> Vec<AiProviderModelEntry> {
    successes.sort_by_key(|success| success.route.latency_ms.unwrap_or(u64::MAX));
    let mut model_ids = Vec::new();
    for success in &successes {
        for model in &success.models {
            if !model_ids.contains(model) {
                model_ids.push(model.clone());
            }
        }
    }

    model_ids
        .into_iter()
        .filter_map(|model_id| {
            let routes = successes
                .iter()
                .filter(|success| success.models.contains(&model_id))
                .map(|success| success.route.clone())
                .collect::<Vec<_>>();
            let selected = routes.first()?;
            Some(AiProviderModelEntry {
                id: model_id.clone(),
                name: model_id,
                description: None,
                context_window: None,
                supports_images: None,
                supports_tools: None,
                runtime_metadata: Some(mimo_runtime_metadata(route_mode, selected, &routes)),
                source: "dynamic".to_string(),
            })
        })
        .collect()
}

fn mimo_runtime_metadata(route_mode: &str, selected: &MimoRoute, routes: &[MimoRoute]) -> Value {
    json!({
        "mimoRouteMode": route_mode,
        "mimoProtocolId": selected.protocol_id.clone(),
        "mimoBaseUrl": selected.base_url.clone(),
        "mimoFallbackRoutes": routes.iter().map(mimo_route_json).collect::<Vec<_>>()
    })
}

fn mimo_route_json(route: &MimoRoute) -> Value {
    let mut value = json!({
        "protocolId": route.protocol_id.clone(),
        "baseUrl": route.base_url.clone(),
        "authScheme": route.auth_scheme.clone()
    });
    if let Some(region) = &route.region {
        value["region"] = json!(region);
    }
    if let Some(latency_ms) = route.latency_ms {
        value["latencyMs"] = json!(latency_ms);
    }
    value
}

fn discover_openai_compatible_models(
    config: &ProviderRuntimeConfig,
) -> Result<Vec<AiProviderModelEntry>> {
    let url = format!("{}/models", normalize_base_url(config));
    let response = apply_headers(provider_auth(client()?.get(url), config), config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("provider did not return a data array"))?;
    Ok(data
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter_map(trim_to_string)
        .map(|id| entry(id, "dynamic"))
        .collect())
}

fn discover_ollama_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let url = format!("{}/api/tags", normalize_base_url(config));
    let response = client()?.get(url).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Ollama did not return models"))?;
    Ok(models
        .iter()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter_map(trim_to_string)
        .map(|id| entry(id, "dynamic"))
        .collect())
}

fn discover_anthropic_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Anthropic API key is required"))?;
    let url = format!("{}/v1/models", normalize_base_url(config));
    let response = apply_headers(
        client()?
            .get(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Anthropic did not return a data array"))?;
    Ok(data
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter_map(trim_to_string)
        .map(|id| entry(id, "dynamic"))
        .collect())
}

fn discover_google_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Google AI API key is required"))?;
    let url = format!(
        "{}/v1beta/models?key={}",
        normalize_base_url(config),
        api_key
    );
    let response = apply_headers(client()?.get(url), config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Google AI did not return models"))?;
    Ok(models
        .iter()
        .filter(|item| {
            item.get("supportedGenerationMethods")
                .and_then(Value::as_array)
                .map(|methods| {
                    methods
                        .iter()
                        .any(|method| method.as_str() == Some("generateContent"))
                })
                .unwrap_or(true)
        })
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter_map(|name| trim_to_string(name.trim_start_matches("models/")))
        .map(|id| entry(id, "dynamic"))
        .collect())
}

fn generate_mimo_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    if let Some(api_key) = config.api_key.as_deref().and_then(trim_to_string) {
        validate_mimo_key_for_route(&api_key, &mimo_route_mode(&config))?;
    }
    let routes = mimo_runtime_routes(&config);
    if routes.is_empty() {
        return Err(anyhow!("No MiMo route is available"));
    }
    let route_count = routes.len();
    let mut auth_error_count = 0_usize;
    let mut last_error = None;
    for route in routes {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        let mut route_config = config.clone();
        route_config.protocol_id = route.protocol_id.clone();
        route_config.base_url = route.base_url.clone();
        route_config.auth_scheme = Some(route.auth_scheme.clone());
        let result = if route.protocol_id == MIMO_PROTOCOL_ANTHROPIC {
            generate_mimo_anthropic(route_config, messages.clone(), cancel, |delta| {
                on_delta(delta)
            })
        } else {
            generate_openai_compatible(route_config, messages.clone(), cancel, |delta| {
                on_delta(delta)
            })
        };
        match result {
            Ok(response) => return Ok(response),
            Err(error) => {
                let message = error.to_string();
                if is_auth_error_message(&message) {
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

fn mimo_runtime_routes(config: &ProviderRuntimeConfig) -> Vec<MimoRoute> {
    let route_mode = config
        .model_runtime_metadata
        .as_ref()
        .and_then(|metadata| metadata.get("mimoRouteMode"))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| mimo_route_mode(config));
    let mut routes = Vec::new();
    if let Some(metadata) = &config.model_runtime_metadata {
        if let Some(fallbacks) = metadata.get("mimoFallbackRoutes").and_then(Value::as_array) {
            for fallback in fallbacks {
                if let Some(route) = mimo_route_from_json(fallback, &route_mode) {
                    push_mimo_route_with_auth_retry(&mut routes, route);
                }
            }
        }
        if routes.is_empty() {
            if let Some(route) = mimo_selected_route_from_metadata(metadata, &route_mode) {
                push_mimo_route_with_auth_retry(&mut routes, route);
            }
        }
    }
    for candidate in mimo_route_candidates(&route_mode) {
        push_mimo_route_with_auth_retry(
            &mut routes,
            MimoRoute {
                protocol_id: candidate.protocol_id,
                base_url: candidate.base_url,
                route_mode: candidate.route_mode,
                region: candidate.region,
                auth_scheme: MIMO_AUTH_API_KEY.to_string(),
                latency_ms: None,
            },
        );
    }
    if routes.is_empty() {
        for candidate in mimo_route_candidates(&route_mode) {
            push_mimo_route_with_auth_retry(
                &mut routes,
                MimoRoute {
                    protocol_id: candidate.protocol_id,
                    base_url: candidate.base_url,
                    route_mode: candidate.route_mode,
                    region: candidate.region,
                    auth_scheme: MIMO_AUTH_API_KEY.to_string(),
                    latency_ms: None,
                },
            );
        }
    }
    routes
}

fn validate_mimo_key_for_route(api_key: &str, route_mode: &str) -> Result<()> {
    let normalized = api_key.trim();
    if normalized.starts_with("tp-") && route_mode != MIMO_ROUTE_TOKEN_PLAN {
        return Err(anyhow!(
            "MiMo Token Plan keys start with tp-. Select Xiaomi MiMo Token Plan for this key."
        ));
    }
    if normalized.starts_with("sk-") && route_mode == MIMO_ROUTE_TOKEN_PLAN {
        return Err(anyhow!(
            "MiMo API keys start with sk-. Select Xiaomi MiMo API for this key."
        ));
    }
    Ok(())
}

fn is_auth_error_message(message: &str) -> bool {
    message.contains("401 Unauthorized") || message.contains("403 Forbidden")
}

fn push_mimo_route_with_auth_retry(routes: &mut Vec<MimoRoute>, route: MimoRoute) {
    let alternate_auth_scheme = match route.auth_scheme.as_str() {
        MIMO_AUTH_BEARER => MIMO_AUTH_API_KEY,
        _ => MIMO_AUTH_BEARER,
    };
    let alternate = MimoRoute {
        auth_scheme: alternate_auth_scheme.to_string(),
        ..route.clone()
    };
    push_unique_mimo_route(routes, route);
    push_unique_mimo_route(routes, alternate);
}

fn push_unique_mimo_route(routes: &mut Vec<MimoRoute>, route: MimoRoute) {
    if route.protocol_id.trim().is_empty()
        || route.base_url.trim().is_empty()
        || !matches!(
            route.auth_scheme.as_str(),
            MIMO_AUTH_API_KEY | MIMO_AUTH_BEARER
        )
    {
        return;
    }
    if routes.iter().any(|existing| {
        existing.protocol_id == route.protocol_id
            && existing.base_url == route.base_url
            && existing.auth_scheme == route.auth_scheme
    }) {
        return;
    }
    routes.push(route);
}

fn mimo_route_from_json(value: &Value, route_mode: &str) -> Option<MimoRoute> {
    Some(MimoRoute {
        protocol_id: value
            .get("protocolId")
            .and_then(Value::as_str)
            .and_then(trim_to_string)?,
        base_url: value
            .get("baseUrl")
            .and_then(Value::as_str)
            .and_then(trim_to_string)?,
        route_mode: route_mode.to_string(),
        region: value
            .get("region")
            .and_then(Value::as_str)
            .and_then(trim_to_string),
        auth_scheme: value
            .get("authScheme")
            .and_then(Value::as_str)
            .and_then(trim_to_string)
            .unwrap_or_else(|| MIMO_AUTH_API_KEY.to_string()),
        latency_ms: value.get("latencyMs").and_then(Value::as_u64),
    })
}

fn mimo_selected_route_from_metadata(value: &Value, route_mode: &str) -> Option<MimoRoute> {
    Some(MimoRoute {
        protocol_id: value
            .get("mimoProtocolId")
            .and_then(Value::as_str)
            .and_then(trim_to_string)?,
        base_url: value
            .get("mimoBaseUrl")
            .and_then(Value::as_str)
            .and_then(trim_to_string)?,
        route_mode: route_mode.to_string(),
        region: None,
        auth_scheme: MIMO_AUTH_API_KEY.to_string(),
        latency_ms: None,
    })
}

fn generate_mimo_anthropic(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("MiMo API key is required"))?;
    let body = anthropic_messages_body(&config, &messages);
    let auth_scheme = config.auth_scheme.as_deref().unwrap_or(MIMO_AUTH_API_KEY);
    let url = format!("{}/v1/messages", normalize_base_url(&config));
    let response = apply_headers(
        mimo_auth(client()?.post(url).json(&body), &api_key, auth_scheme),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_sse_stream(response, cancel, on_delta, |value| {
        value
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

fn generate_openai_compatible(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let body = openai_chat_body(&config, &messages);
    let url = format!("{}/chat/completions", normalize_base_url(&config));
    let response = apply_headers(
        provider_auth(client()?.post(url).json(&body), &config),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_sse_stream(response, cancel, on_delta, |value| {
        value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta").or_else(|| choice.get("message")))
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

fn generate_anthropic(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Anthropic API key is required"))?;
    let body = anthropic_messages_body(&config, &messages);
    let url = format!("{}/v1/messages", normalize_base_url(&config));
    let response = apply_headers(
        client()?
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_sse_stream(response, cancel, on_delta, |value| {
        value
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

fn generate_ollama(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let body = openai_chat_body(&config, &messages);
    let url = format!("{}/api/chat", normalize_base_url(&config));
    let response = client()?.post(url).json(&body).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_line_json_stream(response, cancel, |value| {
        let delta = value
            .get("message")
            .and_then(|message| message.get("content"))
            .or_else(|| value.get("response"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if !delta.is_empty() {
            on_delta(delta)?;
        }
        Ok(())
    })
}

fn generate_google(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow!("turn cancelled"));
    }
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Google AI API key is required"))?;
    let body = google_generate_content_body(&messages);
    let model = config.model.trim_start_matches("models/");
    let url = format!(
        "{}/v1beta/models/{}:generateContent?key={}",
        normalize_base_url(&config),
        model,
        api_key
    );
    let response = apply_headers(client()?.post(url).json(&body), &config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let text = value
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if !text.is_empty() {
        on_delta(&text)?;
    }
    Ok(ModelResponse { text, usage: None })
}

fn read_sse_stream(
    response: Response,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
    extract_delta: impl Fn(&Value) -> Option<String>,
) -> Result<ModelResponse> {
    let mut text = String::new();
    read_text_lines(response, cancel, |line| {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            return Ok(());
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" || data.is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        if let Some(delta) = extract_delta(&value) {
            if !delta.is_empty() {
                text.push_str(&delta);
                on_delta(&delta)?;
            }
        }
        Ok(())
    })?;
    Ok(ModelResponse { text, usage: None })
}

fn read_line_json_stream(
    response: Response,
    cancel: &AtomicBool,
    mut on_value: impl FnMut(&Value) -> Result<()>,
) -> Result<ModelResponse> {
    let mut text = String::new();
    read_text_lines(response, cancel, |line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(trimmed).unwrap_or(Value::Null);
        let before = text.len();
        on_value(&value)?;
        let delta = value
            .get("message")
            .and_then(|message| message.get("content"))
            .or_else(|| value.get("response"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if before == text.len() {
            text.push_str(delta);
        }
        Ok(())
    })?;
    Ok(ModelResponse { text, usage: None })
}

fn read_text_lines(
    mut response: Response,
    cancel: &AtomicBool,
    mut on_line: impl FnMut(&str) -> Result<()>,
) -> Result<()> {
    let mut pending = String::new();
    let mut buffer = [0_u8; 8192];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        let count = response.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        pending.push_str(&String::from_utf8_lossy(&buffer[..count]));
        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim_end_matches('\r').to_string();
            pending.drain(..=index);
            on_line(&line)?;
        }
    }
    if !pending.trim().is_empty() {
        on_line(&pending)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(route_mode: &str) -> ProviderRuntimeConfig {
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

    fn prompt_messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are Lyra.\nProtect secrets.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            },
            ChatMessage {
                role: "assistant".to_string(),
                content: "hi".to_string(),
            },
        ]
    }

    #[test]
    fn openai_body_preserves_system_role_message() {
        let body = openai_chat_body(&test_config(MIMO_ROUTE_API), &prompt_messages());
        let messages = body["messages"].as_array().expect("messages");

        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "You are Lyra.\nProtect secrets.");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn anthropic_body_moves_system_to_top_level_and_filters_messages() {
        let body = anthropic_messages_body(&test_config(MIMO_ROUTE_API), &prompt_messages());
        let messages = body["messages"].as_array().expect("messages");

        assert_eq!(body["system"], "You are Lyra.\nProtect secrets.");
        assert_eq!(messages.len(), 2);
        assert!(messages.iter().all(|message| message["role"] != "system"));
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn google_body_uses_system_instruction_and_filters_contents() {
        let body = google_generate_content_body(&prompt_messages());
        let contents = body["contents"].as_array().expect("contents");

        assert_eq!(
            body["systemInstruction"]["parts"][0]["text"],
            "You are Lyra.\nProtect secrets."
        );
        assert_eq!(contents.len(), 2);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[1]["role"], "model");
        assert!(contents.iter().all(|content| content["role"] != "system"));
    }

    #[test]
    fn mimo_api_route_registry_contains_openai_and_anthropic_candidates() {
        let routes = mimo_route_candidates(MIMO_ROUTE_API);

        assert_eq!(routes.len(), 2);
        assert_eq!(routes[0].protocol_id, MIMO_PROTOCOL_OPENAI);
        assert_eq!(routes[0].base_url, "https://api.xiaomimimo.com/v1");
        assert_eq!(routes[1].protocol_id, MIMO_PROTOCOL_ANTHROPIC);
        assert_eq!(routes[1].base_url, "https://api.xiaomimimo.com/anthropic");
    }

    #[test]
    fn mimo_token_plan_route_registry_contains_all_regions_and_protocols() {
        let routes = mimo_route_candidates(MIMO_ROUTE_TOKEN_PLAN);
        let endpoints = routes
            .iter()
            .map(|route| {
                (
                    route.protocol_id.as_str(),
                    route.base_url.as_str(),
                    route.region.as_deref(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(routes.len(), 6);
        assert!(endpoints.contains(&(
            MIMO_PROTOCOL_OPENAI,
            "https://token-plan-cn.xiaomimimo.com/v1",
            Some("cn")
        )));
        assert!(endpoints.contains(&(
            MIMO_PROTOCOL_OPENAI,
            "https://token-plan-sgp.xiaomimimo.com/v1",
            Some("sgp")
        )));
        assert!(endpoints.contains(&(
            MIMO_PROTOCOL_OPENAI,
            "https://token-plan-ams.xiaomimimo.com/v1",
            Some("ams")
        )));
        assert!(endpoints.contains(&(
            MIMO_PROTOCOL_ANTHROPIC,
            "https://token-plan-cn.xiaomimimo.com/anthropic",
            Some("cn")
        )));
        assert!(endpoints.contains(&(
            MIMO_PROTOCOL_ANTHROPIC,
            "https://token-plan-sgp.xiaomimimo.com/anthropic",
            Some("sgp")
        )));
        assert!(endpoints.contains(&(
            MIMO_PROTOCOL_ANTHROPIC,
            "https://token-plan-ams.xiaomimimo.com/anthropic",
            Some("ams")
        )));
    }

    #[test]
    fn mimo_discovery_merge_dedupes_models_and_sorts_routes_by_latency() {
        let models = merge_mimo_discovery(
            MIMO_ROUTE_TOKEN_PLAN,
            vec![
                MimoProbeSuccess {
                    route: MimoRoute {
                        protocol_id: MIMO_PROTOCOL_OPENAI.to_string(),
                        base_url: "https://token-plan-ams.xiaomimimo.com/v1".to_string(),
                        route_mode: MIMO_ROUTE_TOKEN_PLAN.to_string(),
                        region: Some("ams".to_string()),
                        auth_scheme: MIMO_AUTH_API_KEY.to_string(),
                        latency_ms: Some(90),
                    },
                    models: vec!["model-a".to_string(), "model-b".to_string()],
                },
                MimoProbeSuccess {
                    route: MimoRoute {
                        protocol_id: MIMO_PROTOCOL_ANTHROPIC.to_string(),
                        base_url: "https://token-plan-cn.xiaomimimo.com/anthropic".to_string(),
                        route_mode: MIMO_ROUTE_TOKEN_PLAN.to_string(),
                        region: Some("cn".to_string()),
                        auth_scheme: MIMO_AUTH_BEARER.to_string(),
                        latency_ms: Some(30),
                    },
                    models: vec!["model-a".to_string()],
                },
            ],
        );

        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["model-a", "model-b"]
        );
        let metadata = models[0].runtime_metadata.as_ref().expect("metadata");
        assert_eq!(
            metadata["mimoBaseUrl"],
            "https://token-plan-cn.xiaomimimo.com/anthropic"
        );
        assert_eq!(metadata["mimoProtocolId"], MIMO_PROTOCOL_ANTHROPIC);
        assert_eq!(
            metadata["mimoFallbackRoutes"]
                .as_array()
                .expect("fallback routes")
                .len(),
            2
        );
    }

    #[test]
    fn mimo_runtime_routes_use_metadata_before_registry_fallback() {
        let mut config = test_config(MIMO_ROUTE_API);
        config.model_runtime_metadata = Some(json!({
            "mimoRouteMode": "api",
            "mimoProtocolId": MIMO_PROTOCOL_OPENAI,
            "mimoBaseUrl": "https://api.xiaomimimo.com/v1",
            "mimoFallbackRoutes": [
                {
                    "protocolId": MIMO_PROTOCOL_OPENAI,
                    "baseUrl": "https://api.xiaomimimo.com/v1",
                    "authScheme": "bearer",
                    "latencyMs": 10
                },
                {
                    "protocolId": MIMO_PROTOCOL_ANTHROPIC,
                    "baseUrl": "https://api.xiaomimimo.com/anthropic",
                    "authScheme": "api_key",
                    "latencyMs": 30
                }
            ]
        }));

        let routes = mimo_runtime_routes(&config);

        assert_eq!(routes.len(), 4);
        assert_eq!(routes[0].auth_scheme, MIMO_AUTH_BEARER);
        assert_eq!(routes[1].auth_scheme, MIMO_AUTH_API_KEY);
        assert_eq!(routes[2].protocol_id, MIMO_PROTOCOL_ANTHROPIC);
        assert_eq!(routes[2].auth_scheme, MIMO_AUTH_API_KEY);
        assert_eq!(routes[3].auth_scheme, MIMO_AUTH_BEARER);
    }

    #[test]
    fn mimo_runtime_routes_try_both_auth_schemes_without_metadata() {
        let routes = mimo_runtime_routes(&test_config(MIMO_ROUTE_API));

        assert_eq!(routes.len(), 4);
        assert_eq!(routes[0].auth_scheme, MIMO_AUTH_API_KEY);
        assert_eq!(routes[1].auth_scheme, MIMO_AUTH_BEARER);
        assert_eq!(routes[2].protocol_id, MIMO_PROTOCOL_ANTHROPIC);
    }

    #[test]
    fn mimo_auth_error_detection_matches_sanitized_status_errors() {
        assert!(is_auth_error_message(
            "model provider request failed: status=401 Unauthorized"
        ));
        assert!(is_auth_error_message(
            "model provider request failed: status=403 Forbidden"
        ));
        assert!(!is_auth_error_message(
            "model provider request failed: status=500 Internal Server Error"
        ));
    }

    #[test]
    fn mimo_key_prefix_validation_matches_route_mode() {
        assert!(validate_mimo_key_for_route("tp-test", MIMO_ROUTE_TOKEN_PLAN).is_ok());
        assert!(validate_mimo_key_for_route("sk-test", MIMO_ROUTE_API).is_ok());
        assert!(validate_mimo_key_for_route("custom-format", MIMO_ROUTE_API).is_ok());
        assert!(validate_mimo_key_for_route("tp-test", MIMO_ROUTE_API).is_err());
        assert!(validate_mimo_key_for_route("sk-test", MIMO_ROUTE_TOKEN_PLAN).is_err());
    }
}
