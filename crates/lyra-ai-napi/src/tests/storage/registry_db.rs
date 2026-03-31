use crate::profile::types::AiModelDiscoveryResult;
use crate::storage::registry_db;
use crate::tests::support::{sample_model, sample_stored_profile, TempStorageRoot};

#[test]
fn writes_profiles_and_switches_default_profile() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();

    let mut openai = sample_stored_profile("openai", "openai_compatible", Some("openai"));
    openai.id = "openai-profile".to_string();
    let mut anthropic = sample_stored_profile("anthropic", "anthropic_messages", Some("anthropic"));
    anthropic.id = "anthropic-profile".to_string();

    registry_db::write_profile(&storage_root, &openai).expect("write openai");
    registry_db::write_profile(&storage_root, &anthropic).expect("write anthropic");
    let selected = registry_db::set_default_profile(&storage_root, &anthropic.id)
        .expect("set default anthropic");

    assert_eq!(selected.id, anthropic.id);
    assert!(selected.is_default);

    let profiles = registry_db::list_profiles(&storage_root).expect("list profiles");
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].id, anthropic.id);
    assert!(profiles[0].is_default);
}

#[test]
fn round_trips_discovery_cache_records() {
    let temp = TempStorageRoot::new();
    let storage_root = temp.as_string();
    let profile = sample_stored_profile("openai", "openai_compatible", Some("openai"));
    registry_db::write_profile(&storage_root, &profile).expect("write profile");

    let cache = AiModelDiscoveryResult {
        provider_id: "openai".to_string(),
        protocol_id: "openai_compatible".to_string(),
        status: "ready".to_string(),
        message: "cached".to_string(),
        checked_at: 200,
        models: vec![sample_model("gpt-5.4-mini")],
    };
    registry_db::upsert_model_discovery_cache(&storage_root, &profile.id, &cache)
        .expect("write discovery cache");

    let cached = registry_db::read_model_discovery_cache(&storage_root, &profile.id)
        .expect("read discovery cache")
        .expect("cached discovery");
    assert_eq!(cached.message, "cached");
    assert_eq!(cached.models[0].id, "gpt-5.4-mini");
}
