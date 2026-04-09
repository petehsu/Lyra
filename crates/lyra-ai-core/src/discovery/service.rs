use napi::Result;

use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::catalog::service::find_preset;
use crate::error::{now_ms, to_error};
use crate::profile::types::{
    AiModelDiscoveryResult, AiModelDiscoveryState, AiProviderProfile, DiscoverAiModelsRequest,
};
use crate::provider;
use crate::provider::types::fallback_models;
use crate::storage::registry_db;

fn build_profile_for_discovery(request: &DiscoverAiModelsRequest) -> Result<AiProviderProfile> {
    let existing = request
        .id
        .as_deref()
        .map(|id| registry_db::read_profile_record(&request.storage_root, id))
        .transpose()?
        .flatten();
    let preset = request.preset_id.as_deref().and_then(find_preset);

    let mut connection_config = preset
        .as_ref()
        .map(|entry| entry.default_connection_config.clone())
        .unwrap_or_default();
    if let Some(existing) = existing.as_ref() {
        connection_config.extend(existing.connection_config.clone());
    }
    connection_config.extend(request.connection_config.clone());

    let mut auth_config = preset
        .as_ref()
        .map(|entry| entry.default_auth_config.clone())
        .unwrap_or_default();
    if let Some(existing) = existing.as_ref() {
        auth_config.extend(existing.auth_config.clone());
    }
    auth_config.extend(request.auth_config.clone());

    Ok(AiProviderProfile {
        id: existing
            .as_ref()
            .map(|profile| profile.id.clone())
            .unwrap_or_else(|| "discovery-only".to_string()),
        name: existing
            .as_ref()
            .map(|profile| profile.name.clone())
            .unwrap_or_else(|| "Discovery".to_string()),
        provider_id: request.provider_id.clone(),
        protocol_id: request.protocol_id.clone(),
        preset_id: request.preset_id.clone(),
        connection_config,
        auth_config,
        configured_secret_fields: existing
            .as_ref()
            .map(|profile| profile.secret_refs.keys().cloned().collect())
            .unwrap_or_default(),
        headers: request
            .headers
            .clone()
            .or_else(|| existing.as_ref().map(|profile| profile.headers.clone()))
            .unwrap_or_default(),
        model: existing
            .as_ref()
            .map(|profile| profile.model.clone())
            .or_else(|| preset.as_ref().map(|entry| entry.default_model.clone()))
            .unwrap_or_else(|| "discovery".to_string()),
        custom_models: existing
            .as_ref()
            .map(|profile| profile.custom_models.clone())
            .unwrap_or_default(),
        discovery_state: existing
            .as_ref()
            .map(|profile| profile.discovery_state.clone())
            .unwrap_or(AiModelDiscoveryState {
                status: "idle".to_string(),
                last_checked_at: None,
                error_message: None,
                models: Vec::new(),
            }),
        is_default: existing
            .as_ref()
            .map(|profile| profile.is_default)
            .unwrap_or(false),
        created_at: existing
            .as_ref()
            .map(|profile| profile.created_at)
            .unwrap_or_else(now_ms),
        updated_at: now_ms(),
    })
}

pub fn discover_models(request: DiscoverAiModelsRequest) -> Result<AiModelDiscoveryResult> {
    if request.force_refresh.unwrap_or(false) == false {
        if let Some(profile_id) = request.id.as_deref() {
            if let Some(cached) =
                registry_db::read_model_discovery_cache(&request.storage_root, profile_id)?
            {
                return Ok(cached);
            }
        }
    }

    let existing = request
        .id
        .as_deref()
        .map(|id| registry_db::read_profile_record(&request.storage_root, id))
        .transpose()?
        .flatten();
    let profile = build_profile_for_discovery(&request)?;
    let store = KeyringSecretStore;
    let secrets = resolve_secret_values(
        &existing
            .as_ref()
            .map(|profile| profile.secret_refs.clone())
            .unwrap_or_default(),
        request.secret_values.as_ref(),
        &store,
    )?;

    let fallback = fallback_models(&profile);
    let (status, message, models) = match provider::discover_models(&profile, &secrets) {
        Ok(models) => (
            "ready".to_string(),
            format!("Discovered {} models", models.len()),
            models,
        ),
        Err(error) if fallback.is_empty() == false => (
            "ready".to_string(),
            format!("{} Falling back to recommended models.", error),
            fallback,
        ),
        Err(error) => ("error".to_string(), error.to_string(), Vec::new()),
    };

    let result = AiModelDiscoveryResult {
        provider_id: profile.provider_id.clone(),
        protocol_id: profile.protocol_id.clone(),
        status: status.clone(),
        message: message.clone(),
        checked_at: now_ms(),
        models: models.clone(),
    };

    if let Some(mut stored) = existing {
        stored.discovery_state = AiModelDiscoveryState {
            status,
            last_checked_at: Some(result.checked_at),
            error_message: if result.status == "error" {
                Some(message.clone())
            } else {
                None
            },
            models,
        };
        stored.updated_at = result.checked_at;
        registry_db::write_profile(&request.storage_root, &stored)?;
        registry_db::upsert_model_discovery_cache(&request.storage_root, &stored.id, &result)?;
    }

    if result.status == "error" {
        return Err(to_error(result.message));
    }

    Ok(result)
}
