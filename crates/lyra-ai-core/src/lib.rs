mod agent_runtime;
mod artifact;
mod config;
mod events;
mod model_gateway;
mod patch_apply;
mod project_manifest;
mod prompt;
mod secrets;
mod storage;
mod tool_runtime;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use serde::Serialize;

pub use events::{clear_rust_event_callback, register_rust_event_callback};

fn parse_json<T: DeserializeOwned>(request_json: String) -> Result<T> {
    serde_json::from_str(&request_json).context("failed to parse AI runtime request")
}

fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).context("failed to serialize AI runtime response")
}

pub fn read_model_config_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&config::read_model_config(request)?)
}

pub fn upsert_model_profile_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&config::upsert_model_profile(request)?)
}

pub fn delete_model_profile_json(request_json: String) -> Result<()> {
    let request = parse_json(request_json)?;
    config::delete_model_profile(request)
}

pub fn discover_models_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&config::discover_models(request)?)
}

pub fn list_agent_sessions_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::list_sessions(request)?)
}

pub fn create_agent_session_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::create_session(request)?)
}

pub fn read_agent_session_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::read_session(request)?)
}

pub fn update_agent_session_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::update_session(request)?)
}

pub fn send_agent_turn_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::send_turn(request)?)
}

pub fn cancel_agent_turn_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::cancel_turn(request)?)
}

pub fn create_agent_todo_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::create_todo(request)?)
}

pub fn create_agent_plan_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::create_plan(request)?)
}

pub fn resolve_agent_plan_review_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&agent_runtime::resolve_plan_review(request)?)
}

pub fn read_agent_artifact_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&artifact::read_artifact(request)?)
}

pub fn apply_agent_patch_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&patch_apply::apply_agent_patch(request)?)
}

pub fn resolve_agent_approval_json(request_json: String) -> Result<String> {
    let request = parse_json(request_json)?;
    to_json(&patch_apply::resolve_agent_approval(request)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{AgentMessage, AgentSession, AgentTurn, AiStore};

    #[test]
    fn profile_crud_uses_index_database() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().to_string_lossy().to_string();
        let request = serde_json::json!({
            "storageRoot": storage_root,
            "name": "Local",
            "providerId": "lmstudio",
            "protocolId": "lmstudio_chat_completions",
            "presetId": "lmstudio",
            "connectionConfig": { "baseUrl": "http://127.0.0.1:1234/v1" },
            "authConfig": { "apiKey": "must-not-persist", "modelSelectionMode": "custom" },
            "secretValues": {},
            "headers": { "Authorization": "Bearer must-not-persist", "X-Lyra-Test": "ok" },
            "model": "local-model",
            "customModels": [],
            "discoveryState": { "status": "idle", "lastCheckedAt": null, "models": [] }
        });
        let saved = upsert_model_profile_json(request.to_string()).expect("upsert profile");
        let profile: serde_json::Value = serde_json::from_str(&saved).expect("profile json");
        assert_eq!(profile["model"], "local-model");
        assert!(profile["authConfig"].get("apiKey").is_none());
        assert_eq!(profile["authConfig"]["modelSelectionMode"], "custom");
        assert!(profile["headers"].get("Authorization").is_none());
        assert_eq!(profile["headers"]["X-Lyra-Test"], "ok");

        let snapshot =
            read_model_config_json(serde_json::json!({ "storageRoot": storage_root }).to_string())
                .expect("read config");
        let snapshot: serde_json::Value = serde_json::from_str(&snapshot).expect("snapshot json");
        assert_eq!(snapshot["profiles"].as_array().expect("profiles").len(), 1);
        assert!(temp.path().join("index.sqlite").exists());
    }

    #[test]
    fn profile_secret_refs_project_configured_state_without_reading_secret() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        let now = storage::now_ms();
        let profile = storage::AiProviderProfile {
            id: "profile-secret".to_string(),
            name: "Secret profile".to_string(),
            provider_id: "openai".to_string(),
            protocol_id: "openai_chat_completions".to_string(),
            runtime_provider_id: "openai".to_string(),
            runtime_supported: true,
            secret_status: "missing".to_string(),
            preset_id: Some("openai".to_string()),
            connection_config: [(
                "baseUrl".to_string(),
                "https://api.openai.com/v1".to_string(),
            )]
            .into_iter()
            .collect(),
            auth_config: Default::default(),
            configured_secret_fields: Vec::new(),
            headers: Default::default(),
            model: "gpt-test".to_string(),
            model_runtime_metadata: None,
            custom_models: Vec::new(),
            discovery_state: Default::default(),
            is_default: true,
            created_at: now,
            updated_at: now,
        };
        store.upsert_profile(&profile).expect("profile");
        store
            .upsert_secret_ref(&profile.id, "apiKey", "ai-secret-test")
            .expect("secret ref");

        let saved = store
            .read_profile(&profile.id)
            .expect("read profile")
            .expect("saved profile");
        assert_eq!(saved.configured_secret_fields, vec!["apiKey"]);
        assert_eq!(saved.secret_status, "configured");
    }

    #[test]
    fn profile_secret_values_are_stored_as_local_secret_files() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().to_string_lossy().to_string();
        let request = serde_json::json!({
            "storageRoot": storage_root,
            "name": "MiMo",
            "providerId": "mimo",
            "protocolId": "mimo_openai_chat_completions",
            "presetId": "mimo_token_plan",
            "connectionConfig": { "mimoRoute": "token_plan" },
            "authConfig": { "modelSelectionMode": "custom" },
            "secretValues": { "apiKey": "tp-test-secret" },
            "headers": {},
            "model": "user-model",
            "customModels": [],
            "discoveryState": { "status": "idle", "lastCheckedAt": null, "models": [] }
        });
        let saved = upsert_model_profile_json(request.to_string()).expect("upsert profile");
        let profile: serde_json::Value = serde_json::from_str(&saved).expect("profile json");
        let secret_ref = {
            let store = AiStore::open(Some(storage_root.as_str())).expect("store");
            store
                .secret_ref(profile["id"].as_str().expect("profile id"), "apiKey")
                .expect("secret ref")
                .expect("secret configured")
        };
        let secret_path = temp.path().join("secrets").join(&secret_ref);

        assert_eq!(profile["secretStatus"], "configured");
        assert!(saved.contains("tp-test-secret") == false);
        assert_eq!(
            std::fs::read_to_string(&secret_path).expect("secret file"),
            "tp-test-secret"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&secret_path)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn mimo_profile_keeps_endpoint_routing_internal() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().to_string_lossy().to_string();
        let request = serde_json::json!({
            "storageRoot": storage_root,
            "name": "MiMo Token Plan",
            "providerId": "mimo",
            "protocolId": "mimo_openai_chat_completions",
            "presetId": "mimo_token_plan",
            "connectionConfig": {
                "mimoRoute": "token_plan",
                "baseUrl": "https://legacy.invalid/v1"
            },
            "authConfig": { "modelSelectionMode": "custom" },
            "secretValues": {},
            "headers": {},
            "model": "user-model",
            "customModels": [],
            "discoveryState": { "status": "idle", "lastCheckedAt": null, "models": [] }
        });

        let saved = upsert_model_profile_json(request.to_string()).expect("upsert profile");
        let profile: serde_json::Value = serde_json::from_str(&saved).expect("profile json");

        assert_eq!(profile["connectionConfig"]["mimoRoute"], "token_plan");
        assert!(profile["connectionConfig"].get("baseUrl").is_none());
    }

    #[test]
    fn discovery_reports_orphaned_secret_ref_as_settings_fix() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage_root = temp.path().to_string_lossy().to_string();
        let store = AiStore::open(Some(storage_root.as_str())).expect("store");
        let now = storage::now_ms();
        let profile = storage::AiProviderProfile {
            id: "profile-orphan-secret".to_string(),
            name: "OpenAI".to_string(),
            provider_id: "openai".to_string(),
            protocol_id: "openai_chat_completions".to_string(),
            runtime_provider_id: "openai".to_string(),
            runtime_supported: true,
            secret_status: "missing".to_string(),
            preset_id: Some("openai".to_string()),
            connection_config: [(
                "baseUrl".to_string(),
                "https://api.openai.com/v1".to_string(),
            )]
            .into_iter()
            .collect(),
            auth_config: Default::default(),
            configured_secret_fields: Vec::new(),
            headers: Default::default(),
            model: "model-a".to_string(),
            model_runtime_metadata: None,
            custom_models: Vec::new(),
            discovery_state: Default::default(),
            is_default: true,
            created_at: now,
            updated_at: now,
        };
        store.upsert_profile(&profile).expect("profile");
        store
            .upsert_secret_ref(&profile.id, "apiKey", "ai-secret-missing-test")
            .expect("secret ref");

        let result = discover_models_json(
            serde_json::json!({
                "storageRoot": storage_root,
                "id": profile.id,
                "providerId": "openai",
                "protocolId": "openai_chat_completions",
                "connectionConfig": { "baseUrl": "https://api.openai.com/v1" },
                "authConfig": {},
                "secretValues": {},
                "headers": {},
                "forceRefresh": true
            })
            .to_string(),
        )
        .expect("discover result");
        let value: serde_json::Value = serde_json::from_str(&result).expect("json");
        assert_eq!(value["status"], "error");
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("Re-enter the API key"));
    }

    #[test]
    fn session_detail_reads_per_session_database() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        let now = storage::now_ms();
        let session = AgentSession {
            id: "session-test".to_string(),
            title: "Test".to_string(),
            profile_id: Some("profile-test".to_string()),
            project_root: None,
            project_name: None,
            collaboration_mode: "default".to_string(),
            created_at: now,
            updated_at: now,
        };
        store.upsert_session_index(&session).expect("session index");
        let turn = AgentTurn {
            id: "turn-test".to_string(),
            session_id: session.id.clone(),
            profile_id: "profile-test".to_string(),
            status: "running".to_string(),
            collaboration_mode: Some("default".to_string()),
            permission_mode: "sandbox".to_string(),
            error_code: None,
            error_message: None,
            usage: None,
            created_at: now,
            updated_at: now,
        };
        store
            .insert_turn(&turn, "msg-user", None)
            .expect("insert turn");
        store
            .append_message(&AgentMessage {
                id: "msg-user".to_string(),
                session_id: session.id.clone(),
                turn_id: Some(turn.id.clone()),
                role: "user".to_string(),
                content: "hello".to_string(),
                content_parts: None,
                display_content: Some("hello".to_string()),
                created_at: now,
            })
            .expect("append message");

        let detail = store
            .read_session_detail(&session.id)
            .expect("detail")
            .expect("session exists");
        assert_eq!(detail.messages[0].content, "hello");
        assert!(temp
            .path()
            .join("sessions")
            .join(&session.id)
            .join("session.sqlite")
            .exists());
    }
}
