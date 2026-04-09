use url::Url;
use uuid::Uuid;

use napi::Result;

use crate::catalog::service::find_preset;
use crate::error::{
    normalize_required_text, normalize_string_map, now_ms, to_error, validate_protocol_id,
    validate_provider_id,
};
use crate::profile::types::{
    AiConfigMap, AiModelDiscoveryState, AiProviderPreset, AiProviderProfile,
    StoredAiProviderProfile, UpsertAiProfileRequest,
};

fn merge_config(
    defaults: &AiConfigMap,
    existing: &AiConfigMap,
    request: &AiConfigMap,
) -> AiConfigMap {
    let mut merged = defaults.clone();
    merged.extend(existing.clone());
    merged.extend(normalize_string_map(request));
    merged
}

fn validate_url_if_present(config: &AiConfigMap, key: &str) -> Result<()> {
    let Some(value) = config.get(key) else {
        return Ok(());
    };
    if value.trim().is_empty() {
        return Ok(());
    }
    Url::parse(value.trim()).map_err(|error| to_error(format!("invalid {key}: {error}")))?;
    Ok(())
}

fn resolve_preset(preset_id: Option<&str>) -> Result<Option<AiProviderPreset>> {
    match preset_id {
        None => Ok(None),
        Some(id) => find_preset(id)
            .ok_or_else(|| to_error("unknown ai provider preset"))
            .map(Some),
    }
}

pub fn normalize_profile_request(
    request: &UpsertAiProfileRequest,
    existing: Option<&StoredAiProviderProfile>,
) -> Result<StoredAiProviderProfile> {
    let preset = resolve_preset(request.preset_id.as_deref())?;
    let provider_id = validate_provider_id(&request.provider_id)?;
    let protocol_id = validate_protocol_id(&request.protocol_id)?;

    if let Some(entry) = preset.as_ref() {
        if entry.provider_id != provider_id || entry.protocol_id != protocol_id {
            return Err(to_error("preset/provider/protocol mismatch"));
        }
    }

    let id = existing
        .map(|profile| profile.id.clone())
        .or_else(|| request.id.clone())
        .unwrap_or_else(|| format!("ai-profile-{}", Uuid::new_v4()));
    let name = normalize_required_text(&request.name, "profile name")?;
    let model = normalize_required_text(&request.model, "model")?;
    let default_connection = preset
        .as_ref()
        .map(|entry| entry.default_connection_config.clone())
        .unwrap_or_default();
    let default_auth = preset
        .as_ref()
        .map(|entry| entry.default_auth_config.clone())
        .unwrap_or_default();
    let connection_config = merge_config(
        &default_connection,
        &existing
            .map(|profile| profile.connection_config.clone())
            .unwrap_or_default(),
        &request.connection_config,
    );
    let auth_config = merge_config(
        &default_auth,
        &existing
            .map(|profile| profile.auth_config.clone())
            .unwrap_or_default(),
        &request.auth_config,
    );
    let headers = normalize_string_map(&request.headers.clone().unwrap_or_else(|| {
        existing
            .map(|profile| profile.headers.clone())
            .unwrap_or_default()
    }));
    validate_url_if_present(&connection_config, "baseUrl")?;
    validate_url_if_present(&connection_config, "endpointOverride")?;

    let created_at = existing
        .map(|profile| profile.created_at)
        .unwrap_or_else(now_ms);
    let updated_at = now_ms();

    Ok(StoredAiProviderProfile {
        id,
        name,
        provider_id,
        protocol_id,
        preset_id: request
            .preset_id
            .clone()
            .or_else(|| existing.and_then(|profile| profile.preset_id.clone())),
        connection_config,
        auth_config,
        secret_refs: existing
            .map(|profile| profile.secret_refs.clone())
            .unwrap_or_default(),
        headers,
        model,
        custom_models: request.custom_models.clone().unwrap_or_else(|| {
            existing
                .map(|profile| profile.custom_models.clone())
                .unwrap_or_default()
        }),
        discovery_state: existing
            .map(|profile| profile.discovery_state.clone())
            .unwrap_or(AiModelDiscoveryState {
                status: "idle".to_string(),
                last_checked_at: None,
                error_message: None,
                models: Vec::new(),
            }),
        is_default: existing.map(|profile| profile.is_default).unwrap_or(false),
        created_at,
        updated_at,
    })
}

pub fn hydrate_validation_profile(
    request: &crate::profile::types::ValidateAiProfileRequest,
    existing: Option<&StoredAiProviderProfile>,
) -> Result<AiProviderProfile> {
    let preset = resolve_preset(request.preset_id.as_deref())?;
    let provider_id = validate_provider_id(&request.provider_id)?;
    let protocol_id = validate_protocol_id(&request.protocol_id)?;
    if let Some(entry) = preset.as_ref() {
        if entry.provider_id != provider_id || entry.protocol_id != protocol_id {
            return Err(to_error("preset/provider/protocol mismatch"));
        }
    }

    let default_connection = preset
        .as_ref()
        .map(|entry| entry.default_connection_config.clone())
        .unwrap_or_default();
    let default_auth = preset
        .as_ref()
        .map(|entry| entry.default_auth_config.clone())
        .unwrap_or_default();
    let connection_config = merge_config(
        &default_connection,
        &existing
            .map(|profile| profile.connection_config.clone())
            .unwrap_or_default(),
        &request.connection_config,
    );
    let auth_config = merge_config(
        &default_auth,
        &existing
            .map(|profile| profile.auth_config.clone())
            .unwrap_or_default(),
        &request.auth_config,
    );
    let headers = normalize_string_map(&request.headers.clone().unwrap_or_else(|| {
        existing
            .map(|profile| profile.headers.clone())
            .unwrap_or_default()
    }));
    validate_url_if_present(&connection_config, "baseUrl")?;
    validate_url_if_present(&connection_config, "endpointOverride")?;

    Ok(AiProviderProfile {
        id: existing
            .map(|profile| profile.id.clone())
            .unwrap_or_else(|| "validation-only".to_string()),
        name: request.name.clone().unwrap_or_else(|| {
            existing
                .map(|profile| profile.name.clone())
                .unwrap_or_else(|| "Validation".to_string())
        }),
        provider_id,
        protocol_id,
        preset_id: request
            .preset_id
            .clone()
            .or_else(|| existing.and_then(|profile| profile.preset_id.clone())),
        connection_config,
        auth_config,
        configured_secret_fields: existing
            .map(|profile| profile.secret_refs.keys().cloned().collect())
            .unwrap_or_default(),
        headers,
        model: normalize_required_text(&request.model, "model")?,
        custom_models: existing
            .map(|profile| profile.custom_models.clone())
            .unwrap_or_default(),
        discovery_state: existing
            .map(|profile| profile.discovery_state.clone())
            .unwrap_or(AiModelDiscoveryState {
                status: "idle".to_string(),
                last_checked_at: None,
                error_message: None,
                models: Vec::new(),
            }),
        is_default: existing.map(|profile| profile.is_default).unwrap_or(false),
        created_at: existing
            .map(|profile| profile.created_at)
            .unwrap_or_else(now_ms),
        updated_at: now_ms(),
    })
}
