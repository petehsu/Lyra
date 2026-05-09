use super::probe::{probe_route, MimoProbeSuccess};
use super::{MIMO_AUTH_API_KEY, MIMO_AUTH_BEARER, MIMO_PROTOCOL_ANTHROPIC, MIMO_PROTOCOL_OPENAI};
use crate::model_gateway::{MimoRouteCandidate, ProviderRuntimeConfig};
use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Result};
use reqwest::blocking::RequestBuilder;
use serde_json::{json, Value};
use std::thread;

const MIMO_ROUTE_API: &str = "api";
const MIMO_ROUTE_TOKEN_PLAN: &str = "token_plan";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct MimoRoute {
    pub(super) protocol_id: String,
    pub(super) base_url: String,
    pub(super) route_mode: String,
    pub(super) region: Option<String>,
    pub(super) auth_scheme: String,
    pub(super) latency_ms: Option<u64>,
}

pub(super) fn route_candidates(route_mode: &str) -> Vec<MimoRouteCandidate> {
    let rows: Vec<(&str, &str, Option<&str>)> = match route_mode {
        MIMO_ROUTE_TOKEN_PLAN => vec![
            (
                MIMO_PROTOCOL_OPENAI,
                "https://token-plan-cn.xiaomimimo.com/v1",
                Some("cn"),
            ),
            (
                MIMO_PROTOCOL_OPENAI,
                "https://token-plan-sgp.xiaomimimo.com/v1",
                Some("sgp"),
            ),
            (
                MIMO_PROTOCOL_OPENAI,
                "https://token-plan-ams.xiaomimimo.com/v1",
                Some("ams"),
            ),
            (
                MIMO_PROTOCOL_ANTHROPIC,
                "https://token-plan-cn.xiaomimimo.com/anthropic",
                Some("cn"),
            ),
            (
                MIMO_PROTOCOL_ANTHROPIC,
                "https://token-plan-sgp.xiaomimimo.com/anthropic",
                Some("sgp"),
            ),
            (
                MIMO_PROTOCOL_ANTHROPIC,
                "https://token-plan-ams.xiaomimimo.com/anthropic",
                Some("ams"),
            ),
        ],
        _ => vec![
            (MIMO_PROTOCOL_OPENAI, "https://api.xiaomimimo.com/v1", None),
            (
                MIMO_PROTOCOL_ANTHROPIC,
                "https://api.xiaomimimo.com/anthropic",
                None,
            ),
        ],
    };
    rows.into_iter()
        .map(|(protocol_id, base_url, region)| MimoRouteCandidate {
            protocol_id: protocol_id.to_string(),
            base_url: base_url.to_string(),
            route_mode: if region.is_some() {
                MIMO_ROUTE_TOKEN_PLAN
            } else {
                MIMO_ROUTE_API
            }
            .to_string(),
            region: region.map(ToString::to_string),
        })
        .collect()
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("MiMo API key is required"))?;
    let route_mode = route_mode(config);
    validate_key_for_route(&api_key, &route_mode)?;
    let handles = route_candidates(&route_mode)
        .into_iter()
        .map(|candidate| {
            let config = config.clone();
            let api_key = api_key.clone();
            thread::spawn(move || probe_route(&config, candidate, &api_key))
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
            .find(|entry| !entry.trim().is_empty())
            .unwrap_or_else(|| "MiMo model discovery failed".to_string());
        return Err(anyhow!("{message}"));
    }
    let models = merge_discovery(route_mode.as_str(), successes);
    if models.is_empty() {
        return Err(anyhow!("MiMo did not return any models"));
    }
    Ok(models)
}

pub(super) fn runtime_routes(config: &ProviderRuntimeConfig) -> Vec<MimoRoute> {
    let route_mode = config
        .model_runtime_metadata
        .as_ref()
        .and_then(|metadata| metadata.get("mimoRouteMode"))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| route_mode(config));
    let mut routes = Vec::new();
    if let Some(metadata) = &config.model_runtime_metadata {
        if let Some(fallbacks) = metadata.get("mimoFallbackRoutes").and_then(Value::as_array) {
            for fallback in fallbacks {
                if let Some(route) = route_from_json(fallback, &route_mode) {
                    push_with_auth_retry(&mut routes, route);
                }
            }
        }
        if routes.is_empty() {
            if let Some(route) = selected_route_from_metadata(metadata, &route_mode) {
                push_with_auth_retry(&mut routes, route);
            }
        }
    }
    for candidate in route_candidates(&route_mode) {
        push_with_auth_retry(
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
    routes
}

pub(super) fn route_mode(config: &ProviderRuntimeConfig) -> String {
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

pub(super) fn auth(request: RequestBuilder, api_key: &str, auth_scheme: &str) -> RequestBuilder {
    match auth_scheme {
        MIMO_AUTH_BEARER => request.bearer_auth(api_key),
        _ => request.header("api-key", api_key),
    }
}

pub(super) fn validate_key_for_route(api_key: &str, route_mode: &str) -> Result<()> {
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

pub(super) fn is_auth_error_message(message: &str) -> bool {
    message.contains("401 Unauthorized") || message.contains("403 Forbidden")
}

fn merge_discovery(
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
                runtime_metadata: Some(runtime_metadata(route_mode, selected, &routes)),
                source: "dynamic".to_string(),
            })
        })
        .collect()
}

fn push_with_auth_retry(routes: &mut Vec<MimoRoute>, route: MimoRoute) {
    let alternate_auth_scheme = match route.auth_scheme.as_str() {
        MIMO_AUTH_BEARER => MIMO_AUTH_API_KEY,
        _ => MIMO_AUTH_BEARER,
    };
    let alternate = MimoRoute {
        auth_scheme: alternate_auth_scheme.to_string(),
        ..route.clone()
    };
    push_unique(routes, route);
    push_unique(routes, alternate);
}

fn push_unique(routes: &mut Vec<MimoRoute>, route: MimoRoute) {
    if route.protocol_id.trim().is_empty()
        || route.base_url.trim().is_empty()
        || !matches!(
            route.auth_scheme.as_str(),
            MIMO_AUTH_API_KEY | MIMO_AUTH_BEARER
        )
        || routes.iter().any(|existing| {
            existing.protocol_id == route.protocol_id
                && existing.base_url == route.base_url
                && existing.auth_scheme == route.auth_scheme
        })
    {
        return;
    }
    routes.push(route);
}

fn route_from_json(value: &Value, route_mode: &str) -> Option<MimoRoute> {
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

fn selected_route_from_metadata(value: &Value, route_mode: &str) -> Option<MimoRoute> {
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

fn runtime_metadata(route_mode: &str, selected: &MimoRoute, routes: &[MimoRoute]) -> Value {
    json!({
        "mimoRouteMode": route_mode,
        "mimoProtocolId": selected.protocol_id.clone(),
        "mimoBaseUrl": selected.base_url.clone(),
        "mimoFallbackRoutes": routes.iter().map(route_json).collect::<Vec<_>>()
    })
}

fn route_json(route: &MimoRoute) -> Value {
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
