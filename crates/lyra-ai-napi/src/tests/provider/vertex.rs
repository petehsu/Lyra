use std::collections::BTreeMap;

use crate::profile::types::{AiModelDiscoveryState, AiProviderProfile};
use crate::provider::vertex::validate_profile_connection;

fn sample_vertex_profile() -> AiProviderProfile {
    AiProviderProfile {
        id: "vertex-profile".to_string(),
        name: "Vertex".to_string(),
        provider_id: "vertex_ai".to_string(),
        protocol_id: "gemini_generate_content".to_string(),
        preset_id: Some("vertex_ai".to_string()),
        connection_config: [
            ("projectId".to_string(), "demo-project".to_string()),
            ("region".to_string(), "us-central1".to_string()),
        ]
        .into_iter()
        .collect(),
        auth_config: BTreeMap::new(),
        configured_secret_fields: Vec::new(),
        headers: BTreeMap::new(),
        model: "gemini-2.5-pro".to_string(),
        custom_models: Vec::new(),
        discovery_state: AiModelDiscoveryState {
            status: "idle".to_string(),
            last_checked_at: None,
            error_message: None,
            models: Vec::new(),
        },
        is_default: false,
        created_at: 0,
        updated_at: 0,
    }
}

#[test]
fn vertex_validation_requires_service_account_credentials() {
    let error = validate_profile_connection(&sample_vertex_profile(), &BTreeMap::new())
        .expect_err("vertex should require credentials");

    assert!(error
        .to_string()
        .contains("serviceAccountJson or serviceAccountFile"));
}
