use crate::model_gateway::{
    default_base_url, discover_models as gateway_discover, protocol_uses_base_url,
    ProviderRuntimeConfig,
};
use crate::secrets;
use crate::storage::{
    new_id, now_ms, trim_to_string, AiModelDiscoveryState, AiProviderModelEntry, AiProviderProfile,
    AiStore, StorageRequest,
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadConfigRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProfileRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub connection_config: HashMap<String, String>,
    #[serde(default)]
    pub auth_config: HashMap<String, String>,
    #[serde(default)]
    pub secret_values: HashMap<String, Option<String>>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub model: String,
    #[serde(default)]
    pub model_runtime_metadata: Option<Value>,
    #[serde(default)]
    pub custom_models: Vec<AiProviderModelEntry>,
    #[serde(default)]
    pub discovery_state: Option<AiModelDiscoveryState>,
    #[serde(default)]
    pub is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProfileRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverModelsRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    #[serde(default)]
    pub id: Option<String>,
    pub provider_id: String,
    pub protocol_id: String,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub connection_config: HashMap<String, String>,
    #[serde(default)]
    pub auth_config: HashMap<String, String>,
    #[serde(default)]
    pub secret_values: HashMap<String, Option<String>>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub force_refresh: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeHealth {
    pub backend: String,
    pub transport: String,
    pub version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeConfigSnapshot {
    pub schema_version: String,
    pub profiles: Vec<AiProviderProfile>,
    pub default_profile_id: Option<String>,
    pub default_provider_id: Option<String>,
    pub default_model_names: Vec<String>,
    pub runtime_health: AiRuntimeHealth,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDiscoveryResult {
    pub provider_id: String,
    pub protocol_id: String,
    pub status: String,
    pub message: String,
    pub checked_at: i64,
    pub models: Vec<AiProviderModelEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

pub fn read_model_config(request: ReadConfigRequest) -> Result<AiRuntimeConfigSnapshot> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let profiles = store.read_profiles()?;
    let default_profile = profiles
        .iter()
        .find(|profile| profile.is_default)
        .or(profiles.first());
    Ok(AiRuntimeConfigSnapshot {
        schema_version: "v1".to_string(),
        default_profile_id: default_profile.map(|profile| profile.id.clone()),
        default_provider_id: default_profile.map(|profile| profile.runtime_provider_id.clone()),
        default_model_names: profiles
            .iter()
            .flat_map(|profile| {
                [
                    vec![profile.model.clone()],
                    profile
                        .custom_models
                        .iter()
                        .map(|model| model.id.clone())
                        .collect(),
                    profile
                        .discovery_state
                        .models
                        .iter()
                        .map(|model| model.id.clone())
                        .collect(),
                ]
                .concat()
            })
            .filter(|model| model.trim().is_empty() == false)
            .collect(),
        profiles,
        runtime_health: AiRuntimeHealth {
            backend: "lyrad-native".to_string(),
            transport: "runtime-socket".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        },
    })
}

pub fn upsert_model_profile(request: UpsertProfileRequest) -> Result<AiProviderProfile> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let id = request
        .id
        .as_deref()
        .and_then(trim_to_string)
        .unwrap_or_else(|| new_id("profile"));
    let existing = store.read_profile(&id)?;
    for (field_id, secret_value) in &request.secret_values {
        let Some(field_id) = trim_to_string(field_id) else {
            continue;
        };
        match secret_value.as_deref().and_then(trim_to_string) {
            Some(value) => {
                let secret_ref = store
                    .secret_ref(&id, &field_id)?
                    .unwrap_or_else(secrets::create_secret_ref);
                secrets::write_secret(&store.root, &secret_ref, &value)?;
                store.upsert_secret_ref(&id, &field_id, &secret_ref)?;
            }
            None => {
                if secret_value.is_none() {
                    if let Some(secret_ref) = store.delete_secret_ref(&id, &field_id)? {
                        let _ = secrets::delete_secret(&store.root, &secret_ref);
                    }
                }
            }
        }
    }

    let now = now_ms();
    let mut connection_config = request.connection_config;
    let provider_id = request.provider_id;
    let protocol_id = request.protocol_id;
    if provider_id == "mimo" {
        connection_config.remove("baseUrl");
        if !connection_config.contains_key("mimoRoute") {
            let route = if request.preset_id.as_deref() == Some("mimo_token_plan") {
                "token_plan"
            } else {
                "api"
            };
            connection_config.insert("mimoRoute".to_string(), route.to_string());
        }
    } else if protocol_uses_base_url(&protocol_id) && !connection_config.contains_key("baseUrl") {
        connection_config.insert(
            "baseUrl".to_string(),
            default_base_url(&provider_id, &protocol_id),
        );
    }
    let is_first_profile = store.read_profiles()?.is_empty();
    let profile = AiProviderProfile {
        id: id.clone(),
        name: trim_to_string(&request.name).unwrap_or_else(|| "AI Provider".to_string()),
        provider_id: provider_id.clone(),
        protocol_id,
        runtime_provider_id: connection_config
            .get("runtimeProviderId")
            .and_then(|value| trim_to_string(value))
            .unwrap_or_else(|| provider_id.clone()),
        runtime_supported: true,
        secret_status: "missing".to_string(),
        preset_id: request.preset_id,
        connection_config,
        auth_config: sanitized_auth_config(request.auth_config),
        configured_secret_fields: Vec::new(),
        headers: sanitized_headers(request.headers),
        model: request.model.trim().to_string(),
        model_runtime_metadata: request.model_runtime_metadata,
        custom_models: request.custom_models,
        discovery_state: request.discovery_state.unwrap_or_default(),
        is_default: request.is_default.unwrap_or(false)
            || existing
                .as_ref()
                .map(|profile| profile.is_default)
                .unwrap_or(false)
            || is_first_profile,
        created_at: existing
            .as_ref()
            .map(|profile| profile.created_at)
            .unwrap_or(now),
        updated_at: now,
    };
    store.upsert_profile(&profile)?;
    store
        .read_profile(&id)?
        .ok_or_else(|| anyhow!("saved AI profile could not be read"))
}

pub fn delete_model_profile(request: DeleteProfileRequest) -> Result<()> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    for secret_ref in store.delete_profile(&request.id)? {
        let _ = secrets::delete_secret(&store.root, &secret_ref);
    }
    Ok(())
}

pub fn discover_models(request: DiscoverModelsRequest) -> Result<AiModelDiscoveryResult> {
    let checked_at = now_ms();
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let _request_metadata = (
        &request.preset_id,
        &request.auth_config,
        request.force_refresh,
    );
    let api_key = match resolve_api_key(
        &store,
        request.id.as_deref(),
        &request.provider_id,
        &request.secret_values,
    ) {
        Ok(api_key) => api_key,
        Err(error) => {
            return Ok(AiModelDiscoveryResult {
                provider_id: request.provider_id,
                protocol_id: request.protocol_id,
                status: "error".to_string(),
                message: error.to_string(),
                checked_at,
                models: Vec::new(),
                code: Some("MODEL_DISCOVERY_FAILED".to_string()),
            });
        }
    };
    let config = ProviderRuntimeConfig {
        provider_id: request.provider_id.clone(),
        protocol_id: request.protocol_id.clone(),
        base_url: request
            .connection_config
            .get("baseUrl")
            .and_then(|value| trim_to_string(value))
            .unwrap_or_else(|| default_base_url(&request.provider_id, &request.protocol_id)),
        api_key,
        auth_scheme: None,
        headers: request.headers,
        connection_config: request.connection_config,
        model_runtime_metadata: None,
        model: String::new(),
    };
    match gateway_discover(&config) {
        Ok(models) => Ok(AiModelDiscoveryResult {
            provider_id: request.provider_id,
            protocol_id: request.protocol_id,
            status: "ready".to_string(),
            message: "Models discovered".to_string(),
            checked_at,
            models,
            code: None,
        }),
        Err(error) => Ok(AiModelDiscoveryResult {
            provider_id: request.provider_id,
            protocol_id: request.protocol_id,
            status: "error".to_string(),
            message: error.to_string(),
            checked_at,
            models: Vec::new(),
            code: Some("MODEL_DISCOVERY_FAILED".to_string()),
        }),
    }
}

pub fn runtime_config_for_profile(
    store: &AiStore,
    profile_id: &str,
    model_override: Option<&str>,
) -> Result<ProviderRuntimeConfig> {
    let profile = store
        .read_profile(profile_id)?
        .ok_or_else(|| anyhow!("AI profile not found: {profile_id}"))?;
    let api_key = resolve_api_key(
        store,
        Some(profile_id),
        &profile.provider_id,
        &HashMap::new(),
    )?;
    let model = model_override
        .and_then(trim_to_string)
        .unwrap_or_else(|| profile.model.clone());
    let model_runtime_metadata = runtime_metadata_for_model(&profile, &model);
    Ok(ProviderRuntimeConfig {
        provider_id: profile.provider_id.clone(),
        protocol_id: profile.protocol_id.clone(),
        base_url: profile
            .connection_config
            .get("baseUrl")
            .and_then(|value| trim_to_string(value))
            .unwrap_or_else(|| default_base_url(&profile.provider_id, &profile.protocol_id)),
        api_key,
        auth_scheme: None,
        headers: profile.headers.clone(),
        connection_config: profile.connection_config.clone(),
        model_runtime_metadata,
        model,
    })
}

fn runtime_metadata_for_model(profile: &AiProviderProfile, model_id: &str) -> Option<Value> {
    let entry = profile
        .discovery_state
        .models
        .iter()
        .chain(profile.custom_models.iter())
        .find(|entry| entry.id.trim() == model_id);
    if let Some(entry) = entry {
        let mut metadata = entry.runtime_metadata.clone().unwrap_or_else(|| json!({}));
        if metadata.is_object() == false {
            metadata = json!({});
        }
        if let Some(context_window) = entry.context_window {
            if let Some(object) = metadata.as_object_mut() {
                object
                    .entry("contextWindow".to_string())
                    .or_insert_with(|| json!(context_window));
            }
        }
        if metadata
            .as_object()
            .map(|object| object.is_empty())
            .unwrap_or(false)
        {
            None
        } else {
            Some(metadata)
        }
    } else if profile.model.trim() == model_id {
        profile.model_runtime_metadata.clone()
    } else {
        None
    }
}

pub fn resolve_profile_id(store: &AiStore, explicit_profile_id: Option<&str>) -> Result<String> {
    if let Some(profile_id) = explicit_profile_id.and_then(trim_to_string) {
        return Ok(profile_id);
    }
    store
        .default_profile()?
        .map(|profile| profile.id)
        .ok_or_else(|| anyhow!("No AI model profile is configured"))
}

fn resolve_api_key(
    store: &AiStore,
    profile_id: Option<&str>,
    provider_id: &str,
    secret_values: &HashMap<String, Option<String>>,
) -> Result<Option<String>> {
    if let Some(value) = secret_values
        .get("apiKey")
        .and_then(|value| value.as_deref())
        .and_then(trim_to_string)
    {
        return Ok(Some(value));
    }
    if let Some(profile_id) = profile_id.and_then(trim_to_string) {
        if let Ok(Some(secret_ref)) = store.secret_ref(&profile_id, "apiKey") {
            let value = secrets::read_secret(&store.root, &secret_ref).map_err(|error| {
                anyhow!(
                    "AI API key is configured but could not be read from secure storage: {error}. Re-enter the API key in Settings."
                )
            })?;
            return Ok(trim_to_string(&value));
        }
    }
    Ok(provider_env_keys(provider_id)
        .iter()
        .find_map(|key| env::var(key).ok().and_then(|value| trim_to_string(&value))))
}

fn provider_env_keys(provider_id: &str) -> &'static [&'static str] {
    match provider_id {
        "openai" => &["OPENAI_API_KEY"],
        "anthropic" => &["ANTHROPIC_API_KEY"],
        "google_ai" => &["GOOGLE_AI_API_KEY", "GEMINI_API_KEY"],
        "mimo" => &["MIMO_API_KEY"],
        "lmstudio" => &["LMSTUDIO_API_KEY"],
        "custom_openai_compatible" => &["OPENAI_API_KEY"],
        _ => &[],
    }
}

fn sanitized_auth_config(auth_config: HashMap<String, String>) -> HashMap<String, String> {
    auth_config
        .into_iter()
        .filter(|(key, _)| key != "apiKey" && key != "refreshToken")
        .collect()
}

fn sanitized_headers(headers: HashMap<String, String>) -> HashMap<String, String> {
    headers
        .into_iter()
        .filter(|(key, _)| {
            let normalized = key.trim().to_ascii_lowercase();
            normalized != "authorization"
                && normalized != "api-key"
                && normalized != "x-api-key"
                && normalized != "cookie"
                && normalized != "set-cookie"
                && !normalized.ends_with("-token")
        })
        .collect()
}
