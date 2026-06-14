use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{NativeProviderProfile, state},
};

use super::{
    capabilities, registry,
    types::{ProviderCatalogProfile, ProviderCatalogSnapshot},
};

const PROVIDER_CATALOG_SCHEMA_VERSION: &str = "2026-06-14";

pub(crate) fn read_provider_catalog() -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let mut profiles = state
        .config
        .providers
        .values()
        .map(profile_snapshot)
        .collect::<AgentRuntimeResult<Vec<_>>>()?;
    profiles.sort_by(|left, right| left.id.cmp(&right.id));

    serde_json::to_value(ProviderCatalogSnapshot {
        schema_version: PROVIDER_CATALOG_SCHEMA_VERSION.to_string(),
        default_provider: state.config.default_provider.clone(),
        default_model: state.config.default_model.clone(),
        protocols: registry::protocol_catalog(),
        routes: registry::route_catalog(),
        profiles,
    })
    .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))
}

fn profile_snapshot(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<ProviderCatalogProfile> {
    let route = registry::require_route(&provider.route_id)?;
    let configured = capabilities::provider_profile_available(provider, &route);
    Ok(ProviderCatalogProfile {
        id: provider.id.clone(),
        label: provider.label.clone(),
        route_id: provider.route_id.clone(),
        protocol_id: route.protocol_id,
        protocol_family: route.protocol_family,
        base_url: provider.base_url.clone(),
        default_model: provider.default_model.clone(),
        configured,
        auth_header: provider.auth_header.clone(),
        model_count: provider.models.len(),
        capabilities: capabilities::summarize_model_capabilities(provider),
    })
}
