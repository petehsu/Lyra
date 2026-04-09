use crate::profile::normalize::{hydrate_validation_profile, normalize_profile_request};
use crate::profile::types::{UpsertAiProfileRequest, ValidateAiProfileRequest};
use crate::tests::support::sample_stored_profile;

#[test]
fn normalize_profile_request_merges_preset_defaults_and_headers() {
    let profile = normalize_profile_request(
        &UpsertAiProfileRequest {
            storage_root: "unused".to_string(),
            id: None,
            name: " Primary OpenAI ".to_string(),
            provider_id: "openai".to_string(),
            protocol_id: "openai_compatible".to_string(),
            preset_id: Some("openai".to_string()),
            connection_config: Default::default(),
            auth_config: Default::default(),
            secret_values: None,
            clear_secret_fields: None,
            headers: Some(
                [
                    (" X-Title ".to_string(), " Lyra ".to_string()),
                    ("".to_string(), "ignored".to_string()),
                ]
                .into_iter()
                .collect(),
            ),
            model: " gpt-5.4-mini ".to_string(),
            custom_models: None,
        },
        None,
    )
    .expect("normalize request");

    assert!(profile.id.starts_with("ai-profile-"));
    assert_eq!(profile.name, "Primary OpenAI");
    assert_eq!(
        profile.connection_config.get("baseUrl").map(String::as_str),
        Some("https://api.openai.com/v1")
    );
    assert_eq!(
        profile.headers.get("X-Title").map(String::as_str),
        Some("Lyra")
    );
    assert_eq!(profile.model, "gpt-5.4-mini");
}

#[test]
fn normalize_profile_request_rejects_preset_provider_mismatch() {
    let error = normalize_profile_request(
        &UpsertAiProfileRequest {
            storage_root: "unused".to_string(),
            id: None,
            name: "Mismatch".to_string(),
            provider_id: "anthropic".to_string(),
            protocol_id: "openai_compatible".to_string(),
            preset_id: Some("openai".to_string()),
            connection_config: Default::default(),
            auth_config: Default::default(),
            secret_values: None,
            clear_secret_fields: None,
            headers: None,
            model: "claude-sonnet-4-5".to_string(),
            custom_models: None,
        },
        None,
    )
    .expect_err("should reject mismatch");

    assert!(error
        .to_string()
        .contains("preset/provider/protocol mismatch"));
}

#[test]
fn hydrate_validation_profile_reuses_existing_name_and_secret_fields() {
    let mut existing = sample_stored_profile("openai", "openai_compatible", Some("openai"));
    existing.name = "Saved OpenAI".to_string();
    existing
        .secret_refs
        .insert("apiKey".to_string(), "secret-ref-1".to_string());

    let hydrated = hydrate_validation_profile(
        &ValidateAiProfileRequest {
            storage_root: "unused".to_string(),
            id: Some(existing.id.clone()),
            name: None,
            provider_id: "openai".to_string(),
            protocol_id: "openai_compatible".to_string(),
            preset_id: Some("openai".to_string()),
            connection_config: Default::default(),
            auth_config: Default::default(),
            secret_values: None,
            headers: None,
            model: "gpt-5.4".to_string(),
        },
        Some(&existing),
    )
    .expect("hydrate validation profile");

    assert_eq!(hydrated.name, "Saved OpenAI");
    assert_eq!(
        hydrated.configured_secret_fields,
        vec!["apiKey".to_string()]
    );
    assert_eq!(hydrated.model, "gpt-5.4");
}
