use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaRuntimeState {
    pub persona_name: Option<String>,
    pub company_name: Option<String>,
    pub company_description: Option<String>,
    pub coworker_label: Option<String>,
    pub local_time: Option<String>,
    pub timezone: Option<String>,
    pub locale: Option<String>,
    pub location_display: Option<String>,
    pub location_source: Option<String>,
    pub location_confidence: Option<String>,
    pub location_detail: Option<String>,
    pub physical_location_display: Option<String>,
    pub ip_location_display: Option<String>,
    pub ip_address: Option<String>,
    pub device_name: Option<String>,
    pub device_profile: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub architecture: Option<String>,
    pub cpu_model: Option<String>,
    pub cpu_cores: Option<String>,
    pub memory_gb: Option<String>,
}

static PERSONA_RUNTIME_STATE: Lazy<RwLock<PersonaRuntimeState>> =
    Lazy::new(|| RwLock::new(PersonaRuntimeState::default()));

pub fn set_persona_runtime_state(state: PersonaRuntimeState) {
    if let Ok(mut guard) = PERSONA_RUNTIME_STATE.write() {
        *guard = sanitize_state(state);
    }
}

pub fn get_persona_runtime_state() -> PersonaRuntimeState {
    PERSONA_RUNTIME_STATE
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn sanitize_state(mut state: PersonaRuntimeState) -> PersonaRuntimeState {
    state.persona_name = normalize_optional(state.persona_name);
    state.company_name = normalize_optional(state.company_name);
    state.company_description = normalize_optional(state.company_description);
    state.coworker_label = normalize_optional(state.coworker_label);
    state.local_time = normalize_optional(state.local_time);
    state.timezone = normalize_optional(state.timezone);
    state.locale = normalize_optional(state.locale);
    state.location_display = normalize_optional(state.location_display);
    state.location_source = normalize_optional(state.location_source);
    state.location_confidence = normalize_optional(state.location_confidence);
    state.location_detail = normalize_optional(state.location_detail);
    state.physical_location_display = normalize_optional(state.physical_location_display);
    state.ip_location_display = normalize_optional(state.ip_location_display);
    state.ip_address = normalize_optional(state.ip_address);
    state.device_name = normalize_optional(state.device_name);
    state.device_profile = normalize_optional(state.device_profile);
    state.os_name = normalize_optional(state.os_name);
    state.os_version = normalize_optional(state.os_version);
    state.architecture = normalize_optional(state.architecture);
    state.cpu_model = normalize_optional(state.cpu_model);
    state.cpu_cores = normalize_optional(state.cpu_cores);
    state.memory_gb = normalize_optional(state.memory_gb);
    state
}
