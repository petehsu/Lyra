use napi::Result;

use crate::auth::service::{apply_secret_updates, delete_secret_refs, resolve_secret_values};
use crate::auth::store::KeyringSecretStore;
use crate::catalog::service::{read_preset_catalog, read_provider_catalog};
use crate::discovery::service::discover_models as discover_models_via_service;
use crate::error::to_error;
use crate::profile::normalize::{hydrate_validation_profile, normalize_profile_request};
use crate::profile::types::{
    AiModelDiscoveryResult, AiProfileValidationResult, AiProviderCatalogItem, AiProviderPreset,
    AiProviderProfile, DeleteAiProfileRequest, DiscoverAiModelsRequest, SetDefaultAiProfileRequest,
    UpsertAiProfileRequest, ValidateAiProfileRequest,
};
use crate::provider;
use crate::storage::registry_db;

pub fn read_profiles(storage_root: &str) -> Result<Vec<AiProviderProfile>> {
    registry_db::list_profiles(storage_root)
}

pub fn read_provider_catalog_items() -> Vec<AiProviderCatalogItem> {
    read_provider_catalog()
}

pub fn read_preset_catalog_items() -> Vec<AiProviderPreset> {
    read_preset_catalog()
}

pub fn upsert_profile(request: UpsertAiProfileRequest) -> Result<AiProviderProfile> {
    #[cfg(debug_assertions)]
    {
        let has_refresh = request
            .secret_values
            .as_ref()
            .and_then(|values| values.get("refreshToken"))
            .and_then(|value| value.as_ref())
            .map(|value| value.trim().is_empty() == false)
            .unwrap_or(false);
        eprintln!(
            "[lyra-ai][upsert] id={:?} provider={} has_refresh_secret={} clear_secret_fields={:?}",
            request.id, request.provider_id, has_refresh, request.clear_secret_fields
        );
    }

    let existing = request
        .id
        .as_deref()
        .map(|id| registry_db::read_profile_record(&request.storage_root, id))
        .transpose()?
        .flatten();

    let mut profile = normalize_profile_request(&request, existing.as_ref())?;
    let store = KeyringSecretStore;
    profile.secret_refs = apply_secret_updates(
        &existing
            .as_ref()
            .map(|profile| profile.secret_refs.clone())
            .unwrap_or_default(),
        request.secret_values.as_ref(),
        request.clear_secret_fields.as_deref(),
        &store,
    )?;

    #[cfg(debug_assertions)]
    {
        let has_refresh_ref = profile.secret_refs.contains_key("refreshToken");
        eprintln!(
            "[lyra-ai][upsert] profile_id={} has_refresh_ref={} secret_fields={:?}",
            profile.id,
            has_refresh_ref,
            profile.secret_refs.keys().collect::<Vec<_>>()
        );
    }

    if existing.is_none() && registry_db::list_profiles(&request.storage_root)?.is_empty() {
        profile.is_default = true;
    }

    registry_db::write_profile(&request.storage_root, &profile)?;
    if profile.is_default {
        return registry_db::set_default_profile(&request.storage_root, &profile.id);
    }
    registry_db::read_profile(&request.storage_root, &profile.id)?
        .ok_or_else(|| to_error("ai profile not found after write"))
}

pub fn delete_profile(request: DeleteAiProfileRequest) -> Result<()> {
    let existing = registry_db::read_profile_record(&request.storage_root, &request.id)?;
    if let Some(profile) = existing.as_ref() {
        delete_secret_refs(&profile.secret_refs, &KeyringSecretStore)?;
    }
    registry_db::delete_profile(&request.storage_root, &request.id)?;

    let remaining = registry_db::list_profiles(&request.storage_root)?;
    if remaining.iter().any(|profile| profile.is_default) == false {
        if let Some(next_default) = remaining.first() {
            let _ = registry_db::set_default_profile(&request.storage_root, &next_default.id)?;
        }
    }
    Ok(())
}

pub fn set_default_profile(request: SetDefaultAiProfileRequest) -> Result<AiProviderProfile> {
    registry_db::set_default_profile(&request.storage_root, &request.id)
}

pub fn validate_profile(request: ValidateAiProfileRequest) -> Result<AiProfileValidationResult> {
    let existing = request
        .id
        .as_deref()
        .map(|id| registry_db::read_profile_record(&request.storage_root, id))
        .transpose()?
        .flatten();

    let profile = hydrate_validation_profile(&request, existing.as_ref())?;
    let secrets = resolve_secret_values(
        &existing
            .as_ref()
            .map(|profile| profile.secret_refs.clone())
            .unwrap_or_default(),
        request.secret_values.as_ref(),
        &KeyringSecretStore,
    )?;
    provider::validate_profile_connection(&profile, &secrets)
}

pub fn discover_models(request: DiscoverAiModelsRequest) -> Result<AiModelDiscoveryResult> {
    discover_models_via_service(request)
}
