mod auth;
mod catalog;
mod discovery;
mod error;
mod events;
mod paths;
mod profile;
mod provider;
mod secrets;
mod session;
mod storage;
#[cfg(test)]
mod tests;
mod turn;

use napi::{JsFunction, Result};
use napi_derive::napi;
use serde::Deserialize;

use crate::error::{parse_json, to_json};
use crate::events::bus::register_callback;
use crate::profile::service::{
    delete_profile, discover_models, read_preset_catalog_items, read_profiles,
    read_provider_catalog_items, set_default_profile, upsert_profile, validate_profile,
};
use crate::profile::types::{
    DeleteAiProfileRequest, DiscoverAiModelsRequest, SetDefaultAiProfileRequest,
    UpsertAiProfileRequest, ValidateAiProfileRequest,
};
use crate::session::service::{read_session_history, refresh_session_projection};
use crate::session::types::{ReadAiSessionHistoryRequest, ReadAiSessionRequest};
use crate::turn::cancel::shutdown_all;
use crate::turn::service::{cancel_chat_turn, send_chat_turn};
use crate::turn::types::{CancelAiChatTurnRequest, SendAiChatTurnRequest};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageRootRequest {
    storage_root: String,
}

#[napi(js_name = "registerAiEventCallback")]
pub fn register_ai_event_callback(callback: JsFunction) -> Result<()> {
    register_callback(callback)
}

#[napi(js_name = "readAiProfilesJson")]
pub fn read_ai_profiles_json(request_json: String) -> Result<String> {
    let request: StorageRootRequest = parse_json(&request_json)?;
    to_json(&read_profiles(&request.storage_root)?)
}

#[napi(js_name = "readAiProviderCatalogJson")]
pub fn read_ai_provider_catalog_json(_request_json: String) -> Result<String> {
    to_json(&read_provider_catalog_items())
}

#[napi(js_name = "readAiPresetCatalogJson")]
pub fn read_ai_preset_catalog_json(_request_json: String) -> Result<String> {
    to_json(&read_preset_catalog_items())
}

#[napi(js_name = "upsertAiProfileJson")]
pub fn upsert_ai_profile_json(request_json: String) -> Result<String> {
    let request: UpsertAiProfileRequest = parse_json(&request_json)?;
    to_json(&upsert_profile(request)?)
}

#[napi(js_name = "deleteAiProfileJson")]
pub fn delete_ai_profile_json(request_json: String) -> Result<()> {
    let request: DeleteAiProfileRequest = parse_json(&request_json)?;
    delete_profile(request)
}

#[napi(js_name = "setDefaultAiProfileJson")]
pub fn set_default_ai_profile_json(request_json: String) -> Result<String> {
    let request: SetDefaultAiProfileRequest = parse_json(&request_json)?;
    to_json(&set_default_profile(request)?)
}

#[napi(js_name = "validateAiProfileJson")]
pub fn validate_ai_profile_json(request_json: String) -> Result<String> {
    let request: ValidateAiProfileRequest = parse_json(&request_json)?;
    to_json(&validate_profile(request)?)
}

#[napi(js_name = "discoverAiModelsJson")]
pub fn discover_ai_models_json(request_json: String) -> Result<String> {
    let request: DiscoverAiModelsRequest = parse_json(&request_json)?;
    to_json(&discover_models(request)?)
}

#[napi(js_name = "refreshAiModelsJson")]
pub fn refresh_ai_models_json(request_json: String) -> Result<String> {
    let mut request: DiscoverAiModelsRequest = parse_json(&request_json)?;
    request.force_refresh = Some(true);
    to_json(&discover_models(request)?)
}

#[napi(js_name = "readAiSessionJson")]
pub fn read_ai_session_json(request_json: String) -> Result<String> {
    let request: ReadAiSessionRequest = parse_json(&request_json)?;
    to_json(&refresh_session_projection(
        &request.storage_root,
        &request.session_id,
        request.fallback_title.as_deref(),
        request.preferred_mode.as_deref(),
    )?)
}

#[napi(js_name = "readAiSessionHistoryJson")]
pub fn read_ai_session_history_json(request_json: String) -> Result<String> {
    let request: ReadAiSessionHistoryRequest = parse_json(&request_json)?;
    to_json(&read_session_history(
        &request.storage_root,
        request.limit.unwrap_or(64) as usize,
    )?)
}

#[napi(js_name = "sendAiChatTurnJson")]
pub fn send_ai_chat_turn_json(request_json: String) -> Result<String> {
    let request: SendAiChatTurnRequest = parse_json(&request_json)?;
    to_json(&send_chat_turn(request)?)
}

#[napi(js_name = "cancelAiChatTurnJson")]
pub fn cancel_ai_chat_turn_json(request_json: String) -> Result<String> {
    let request: CancelAiChatTurnRequest = parse_json(&request_json)?;
    to_json(&cancel_chat_turn(request)?)
}

#[napi(js_name = "shutdownAiRuntime")]
pub fn shutdown_ai_runtime() {
    shutdown_all();
}
