use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub type AiConfigMap = BTreeMap<String, String>;
pub type AiSecretRefMap = BTreeMap<String, String>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderFieldOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderFieldSchema {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub options: Vec<AiProviderFieldOption>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderModelEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_images: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_tools: Option<bool>,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCatalogItem {
    pub id: String,
    pub label: String,
    pub description: String,
    pub protocol_id: String,
    pub icon_key: String,
    pub recommended: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderPreset {
    pub id: String,
    pub provider_id: String,
    pub protocol_id: String,
    pub label: String,
    pub description: String,
    pub section: String,
    pub icon_key: String,
    pub default_model: String,
    pub discovery_mode: String,
    pub capability: String,
    pub model_discovery_supported: bool,
    pub custom_headers_supported: bool,
    pub custom_models_supported: bool,
    pub connection_fields: Vec<AiProviderFieldSchema>,
    pub auth_fields: Vec<AiProviderFieldSchema>,
    pub default_connection_config: AiConfigMap,
    pub default_auth_config: AiConfigMap,
    pub recommended_models: Vec<AiProviderModelEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDiscoveryState {
    pub status: String,
    pub last_checked_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub models: Vec<AiProviderModelEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    pub preset_id: Option<String>,
    pub connection_config: AiConfigMap,
    pub auth_config: AiConfigMap,
    pub configured_secret_fields: Vec<String>,
    pub headers: AiConfigMap,
    pub model: String,
    pub custom_models: Vec<AiProviderModelEntry>,
    pub discovery_state: AiModelDiscoveryState,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredAiProviderProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    pub preset_id: Option<String>,
    pub connection_config: AiConfigMap,
    pub auth_config: AiConfigMap,
    pub secret_refs: AiSecretRefMap,
    pub headers: AiConfigMap,
    pub model: String,
    pub custom_models: Vec<AiProviderModelEntry>,
    pub discovery_state: AiModelDiscoveryState,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl StoredAiProviderProfile {
    pub fn to_public(&self) -> AiProviderProfile {
        AiProviderProfile {
            id: self.id.clone(),
            name: self.name.clone(),
            provider_id: self.provider_id.clone(),
            protocol_id: self.protocol_id.clone(),
            preset_id: self.preset_id.clone(),
            connection_config: self.connection_config.clone(),
            auth_config: self.auth_config.clone(),
            configured_secret_fields: self.secret_refs.keys().cloned().collect(),
            headers: self.headers.clone(),
            model: self.model.clone(),
            custom_models: self.custom_models.clone(),
            discovery_state: self.discovery_state.clone(),
            is_default: self.is_default,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAiProfileRequest {
    pub storage_root: String,
    pub id: Option<String>,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    pub preset_id: Option<String>,
    pub connection_config: AiConfigMap,
    pub auth_config: AiConfigMap,
    pub secret_values: Option<BTreeMap<String, Option<String>>>,
    pub clear_secret_fields: Option<Vec<String>>,
    pub headers: Option<AiConfigMap>,
    pub model: String,
    pub custom_models: Option<Vec<AiProviderModelEntry>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAiProfileRequest {
    pub storage_root: String,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultAiProfileRequest {
    pub storage_root: String,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateAiProfileRequest {
    pub storage_root: String,
    pub id: Option<String>,
    pub name: Option<String>,
    pub provider_id: String,
    pub protocol_id: String,
    pub preset_id: Option<String>,
    pub connection_config: AiConfigMap,
    pub auth_config: AiConfigMap,
    pub secret_values: Option<BTreeMap<String, Option<String>>>,
    pub headers: Option<AiConfigMap>,
    pub model: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverAiModelsRequest {
    pub storage_root: String,
    pub id: Option<String>,
    pub provider_id: String,
    pub protocol_id: String,
    pub preset_id: Option<String>,
    pub connection_config: AiConfigMap,
    pub auth_config: AiConfigMap,
    pub secret_values: Option<BTreeMap<String, Option<String>>>,
    pub headers: Option<AiConfigMap>,
    pub force_refresh: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileValidationResult {
    pub ok: bool,
    pub message: String,
    pub checked_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDiscoveryResult {
    pub provider_id: String,
    pub protocol_id: String,
    pub status: String,
    pub message: String,
    pub checked_at: i64,
    pub models: Vec<AiProviderModelEntry>,
}
