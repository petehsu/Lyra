use std::collections::BTreeSet;

use crate::catalog::service::{find_preset, read_preset_catalog, read_provider_catalog};

#[test]
fn preset_catalog_contains_core_provider_presets() {
    let presets = read_preset_catalog();
    let preset_ids = presets
        .iter()
        .map(|preset| preset.id.as_str())
        .collect::<BTreeSet<_>>();

    for required in [
        "openai",
        "openrouter",
        "anthropic",
        "google_ai",
        "vertex_ai",
        "amazon_bedrock",
        "ollama",
        "lmstudio",
        "custom_openai_compatible",
    ] {
        assert!(preset_ids.contains(required), "missing preset {required}");
    }

    let custom = find_preset("custom_openai_compatible").expect("custom preset");
    assert!(custom.custom_models_supported);
    assert!(custom.custom_headers_supported);
    assert_eq!(
        find_preset("openai").expect("openai preset").capability,
        "full"
    );
    assert_eq!(
        find_preset("vertex_ai").expect("vertex preset").capability,
        "static"
    );
    assert_eq!(
        find_preset("amazon_bedrock")
            .expect("bedrock preset")
            .capability,
        "static"
    );
}

#[test]
fn provider_catalog_deduplicates_by_provider_id() {
    let providers = read_provider_catalog();
    let unique_ids = providers
        .iter()
        .map(|provider| provider.id.as_str())
        .collect::<BTreeSet<_>>();

    assert_eq!(providers.len(), unique_ids.len());
    assert!(unique_ids.contains("openai"));
    assert!(unique_ids.contains("anthropic"));
    assert!(unique_ids.contains("custom_openai_compatible"));
}

#[test]
fn openai_preset_matches_chatgpt_oauth_model_allowlist() {
    let openai = find_preset("openai").expect("openai preset");
    let models = openai
        .recommended_models
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        models,
        vec![
            "gpt-5.1-codex",
            "gpt-5.1-codex-max",
            "gpt-5.1-codex-mini",
            "gpt-5.2",
            "gpt-5.2-codex",
            "gpt-5.3-codex",
            "gpt-5.4",
            "gpt-5.4-mini",
        ]
    );
}
