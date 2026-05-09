use super::routes::{auth, MimoRoute};
use super::{MIMO_AUTH_API_KEY, MIMO_AUTH_BEARER, MIMO_PROTOCOL_ANTHROPIC};
use crate::model_gateway::ProviderRuntimeConfig;
use crate::model_gateway::{apply_headers, client, is_auth_status, MimoRouteCandidate};
use crate::storage::trim_to_string;
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::time::Instant;

#[derive(Clone, Debug)]
pub(super) struct MimoProbeSuccess {
    pub(super) route: MimoRoute,
    pub(super) models: Vec<String>,
}

#[derive(Debug)]
pub(super) struct MimoProbeError {
    pub(super) message: String,
    pub(super) auth_failed: bool,
}

pub(super) fn probe_route(
    config: &ProviderRuntimeConfig,
    candidate: MimoRouteCandidate,
    api_key: &str,
) -> std::result::Result<MimoProbeSuccess, MimoProbeError> {
    match probe_route_with_auth(config, &candidate, api_key, MIMO_AUTH_API_KEY) {
        Ok(success) => Ok(success),
        Err(error) if error.auth_failed => {
            probe_route_with_auth(config, &candidate, api_key, MIMO_AUTH_BEARER)
        }
        Err(error) => Err(error),
    }
}

fn probe_route_with_auth(
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
        auth(
            client()
                .map_err(|error| probe_error(error.to_string(), false))?
                .get(url),
            api_key,
            auth_scheme,
        ),
        config,
    )
    .send()
    .map_err(|error| probe_error(error.to_string(), false))?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(probe_error(
            format!("MiMo route probe failed: status={status}"),
            is_auth_status(status),
        ));
    }
    let value: Value = response
        .json()
        .map_err(|error| probe_error(error.to_string(), false))?;
    let models =
        parse_data_model_ids(&value).map_err(|error| probe_error(error.to_string(), false))?;
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

fn probe_error(message: String, auth_failed: bool) -> MimoProbeError {
    MimoProbeError {
        message,
        auth_failed,
    }
}
