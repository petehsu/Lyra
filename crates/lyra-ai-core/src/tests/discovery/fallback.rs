use crate::discovery::service::discover_models;
use crate::profile::types::{AiModelDiscoveryResult, DiscoverAiModelsRequest};
use crate::storage::registry_db;
use crate::tests::support::{sample_model, sample_stored_profile, TempStorageRoot};

#[test]
fn discovery_returns_cached_models_before_refresh() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let mut stored = sample_stored_profile("openai", "openai_compatible", Some("openai"));
    stored.id = "cached-openai".to_string();
    registry_db::write_profile(&storage_root, &stored).expect("write profile");
    registry_db::upsert_model_discovery_cache(
        &storage_root,
        &stored.id,
        &AiModelDiscoveryResult {
            provider_id: "openai".to_string(),
            protocol_id: "openai_compatible".to_string(),
            status: "ready".to_string(),
            message: "cached result".to_string(),
            checked_at: 123,
            models: vec![sample_model("cached-model")],
        },
    )
    .expect("write discovery cache");

    let result = discover_models(DiscoverAiModelsRequest {
        storage_root,
        id: Some(stored.id),
        provider_id: "openai".to_string(),
        protocol_id: "openai_compatible".to_string(),
        preset_id: Some("openai".to_string()),
        connection_config: Default::default(),
        auth_config: Default::default(),
        secret_values: None,
        headers: None,
        force_refresh: None,
    })
    .expect("read cached discovery");

    assert_eq!(result.message, "cached result");
    assert_eq!(result.models[0].id, "cached-model");
}

#[test]
fn discovery_falls_back_to_bedrock_recommended_models() {
    let temp = TempStorageRoot::new();
    let result = discover_models(DiscoverAiModelsRequest {
        storage_root: temp.as_string(),
        id: None,
        provider_id: "amazon_bedrock".to_string(),
        protocol_id: "bedrock_converse".to_string(),
        preset_id: Some("amazon_bedrock".to_string()),
        connection_config: [
            ("region".to_string(), "us-east-1".to_string()),
            ("endpointOverride".to_string(), "".to_string()),
        ]
        .into_iter()
        .collect(),
        auth_config: [
            ("authMethod".to_string(), "named_profile".to_string()),
            ("profile".to_string(), "default".to_string()),
        ]
        .into_iter()
        .collect(),
        secret_values: None,
        headers: None,
        force_refresh: Some(true),
    })
    .expect("fallback models");

    assert_eq!(result.status, "ready");
    assert!(!result.models.is_empty());
}
