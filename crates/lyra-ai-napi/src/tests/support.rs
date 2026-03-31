use std::fs::{create_dir_all, remove_dir_all};
use std::path::PathBuf;

use uuid::Uuid;

use crate::profile::types::{AiModelDiscoveryState, AiProviderModelEntry, StoredAiProviderProfile};
use crate::session::types::AiChatMessage;

pub struct TempStorageRoot {
    path: PathBuf,
}

impl TempStorageRoot {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("lyra-ai-napi-test-{}", Uuid::new_v4()));
        create_dir_all(&path).expect("create temp ai storage root");
        Self { path }
    }
    pub fn as_string(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

impl Drop for TempStorageRoot {
    fn drop(&mut self) {
        let _ = remove_dir_all(&self.path);
    }
}

pub fn sample_model(id: &str) -> AiProviderModelEntry {
    AiProviderModelEntry {
        id: id.to_string(),
        name: id.to_string(),
        description: Some(format!("Model {id}")),
        context_window: Some(128_000),
        supports_images: Some(false),
        supports_tools: Some(true),
        source: "preset".to_string(),
    }
}

pub fn sample_stored_profile(
    provider_id: &str,
    protocol_id: &str,
    preset_id: Option<&str>,
) -> StoredAiProviderProfile {
    let base_url = match protocol_id {
        "ollama_chat" => "http://localhost:11434".to_string(),
        "lmstudio_openai" => "http://localhost:1234/v1".to_string(),
        _ => "https://api.example.com/v1".to_string(),
    };

    StoredAiProviderProfile {
        id: format!("profile-{provider_id}"),
        name: format!("{provider_id} profile"),
        provider_id: provider_id.to_string(),
        protocol_id: protocol_id.to_string(),
        preset_id: preset_id.map(str::to_string),
        connection_config: [("baseUrl".to_string(), base_url)].into_iter().collect(),
        auth_config: Default::default(),
        secret_refs: Default::default(),
        headers: Default::default(),
        model: "demo-model".to_string(),
        custom_models: vec![sample_model("demo-model")],
        discovery_state: AiModelDiscoveryState {
            status: "idle".to_string(),
            last_checked_at: None,
            error_message: None,
            models: Vec::new(),
        },
        is_default: false,
        created_at: 100,
        updated_at: 100,
    }
}

pub fn sample_message(id: &str, role: &str, content: &str, created_at: i64) -> AiChatMessage {
    AiChatMessage {
        id: id.to_string(),
        session_id: "session-1".to_string(),
        turn_id: None,
        role: role.to_string(),
        mode: "chat".to_string(),
        content: content.to_string(),
        status: "completed".to_string(),
        created_at,
        updated_at: created_at,
        tokens: None,
    }
}
