use std::collections::BTreeMap;

use napi::Result;
use reqwest::blocking::{Client, RequestBuilder};
use std::time::Duration;

use crate::catalog::service::find_preset;
use crate::error::{normalize_required_text, to_error};
use crate::profile::types::{AiProviderModelEntry, AiProviderProfile};

#[derive(Clone, Debug)]
pub struct ProviderChatMessage {
    pub role: String,
    pub content: String,
}

pub fn build_client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| to_error(format!("failed to build ai http client: {error}")))
}

pub fn required_connection_value(profile: &AiProviderProfile, key: &str) -> Result<String> {
    profile
        .connection_config
        .get(key)
        .cloned()
        .filter(|value| value.trim().is_empty() == false)
        .ok_or_else(|| to_error(format!("{key} is required for {}", profile.provider_id)))
}

pub fn optional_connection_value(profile: &AiProviderProfile, key: &str) -> Option<String> {
    profile
        .connection_config
        .get(key)
        .cloned()
        .filter(|value| value.trim().is_empty() == false)
}

pub fn secret_value<'a>(secrets: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    secrets
        .get(key)
        .map(String::as_str)
        .filter(|value| value.trim().is_empty() == false)
}

pub fn apply_custom_headers(
    builder: RequestBuilder,
    profile: &AiProviderProfile,
) -> RequestBuilder {
    profile
        .headers
        .iter()
        .fold(builder, |current, (key, value)| current.header(key, value))
}

pub fn fallback_models(profile: &AiProviderProfile) -> Vec<AiProviderModelEntry> {
    let mut models = Vec::new();
    if let Some(preset_id) = profile.preset_id.as_deref() {
        if let Some(preset) = find_preset(preset_id) {
            models.extend(preset.recommended_models);
        }
    }
    models.extend(profile.custom_models.clone());
    if models.is_empty() {
        let model_id = normalize_required_text(&profile.model, "model")
            .unwrap_or_else(|_| "default".to_string());
        models.push(AiProviderModelEntry {
            id: model_id.clone(),
            name: model_id,
            description: Some("Configured model".to_string()),
            context_window: None,
            supports_images: None,
            supports_tools: None,
            source: "preset".to_string(),
        });
    }
    models
}
