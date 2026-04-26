use crate::Feature;
use crate::FeatureConfigSource;
use crate::FeatureOverrides;
use crate::FeatureToml;
use crate::Features;
use crate::FeaturesToml;
use crate::Stage;
use crate::feature_for_key;
use pretty_assertions::assert_eq;
use std::collections::BTreeMap;

#[test]
fn internal_features_are_disabled_by_default() {
    for spec in crate::FEATURES {
        if matches!(spec.stage, Stage::Internal) {
            assert_eq!(
                spec.default_enabled, false,
                "feature `{}` is internal and must be disabled by default",
                spec.key
            );
        }
    }
}

#[test]
fn default_enabled_features_are_stable() {
    for spec in crate::FEATURES {
        if spec.default_enabled {
            assert!(
                matches!(spec.stage, Stage::Stable | Stage::Removed),
                "feature `{}` is enabled by default but is not stable/removed ({:?})",
                spec.key,
                spec.stage
            );
        }
    }
}

#[test]
fn use_classic_landlock_is_deprecated_and_disabled_by_default() {
    assert_eq!(Feature::UseClassicLandlock.stage(), Stage::Deprecated);
    assert_eq!(Feature::UseClassicLandlock.default_enabled(), false);
}

#[test]
fn use_linux_sandbox_bwrap_is_removed_and_disabled_by_default() {
    assert_eq!(Feature::UseLinuxSandboxBwrap.stage(), Stage::Removed);
    assert_eq!(Feature::UseLinuxSandboxBwrap.default_enabled(), false);
}

#[test]
fn image_detail_original_is_removed_and_disabled_by_default() {
    assert_eq!(Feature::ImageDetailOriginal.stage(), Stage::Removed);
    assert_eq!(Feature::ImageDetailOriginal.default_enabled(), false);
}

#[test]
fn js_repl_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::JsRepl.stage(), Stage::Stable);
    assert_eq!(Feature::JsRepl.default_enabled(), true);
}

#[test]
fn code_mode_only_requires_code_mode() {
    let mut features = Features::with_defaults();
    features.enable(Feature::CodeModeOnly);
    features.normalize_dependencies();

    assert_eq!(features.enabled(Feature::CodeModeOnly), true);
    assert_eq!(features.enabled(Feature::CodeMode), true);
}

#[test]
fn auto_review_approval_is_stable_and_mode_controlled() {
    assert_eq!(Feature::AutoReviewApproval.stage(), Stage::Stable);
    assert_eq!(Feature::AutoReviewApproval.default_enabled(), false);
}

#[test]
fn request_permissions_is_internal() {
    assert_eq!(Feature::ExecPermissionApprovals.stage(), Stage::Internal);
    assert_eq!(Feature::ExecPermissionApprovals.default_enabled(), false);
}

#[test]
fn request_permissions_tool_is_internal() {
    assert_eq!(Feature::RequestPermissionsTool.stage(), Stage::Internal);
    assert_eq!(Feature::RequestPermissionsTool.default_enabled(), false);
}

#[test]
fn tool_suggest_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::ToolSuggest.stage(), Stage::Stable);
    assert_eq!(Feature::ToolSuggest.default_enabled(), true);
}

#[test]
fn tool_search_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::ToolSearch.stage(), Stage::Stable);
    assert_eq!(Feature::ToolSearch.default_enabled(), true);
}

#[test]
fn unavailable_dummy_tools_is_internal_and_disabled_by_default() {
    assert_eq!(Feature::UnavailableDummyTools.stage(), Stage::Internal);
    assert_eq!(Feature::UnavailableDummyTools.default_enabled(), false);
}

#[test]
fn general_analytics_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::GeneralAnalytics.stage(), Stage::Stable);
    assert_eq!(Feature::GeneralAnalytics.default_enabled(), true);
}

#[test]
fn use_linux_sandbox_bwrap_is_a_removed_feature_key() {
    assert_eq!(
        feature_for_key("use_classic_landlock"),
        Some(Feature::UseClassicLandlock)
    );
    assert_eq!(
        feature_for_key("use_linux_sandbox_bwrap"),
        Some(Feature::UseLinuxSandboxBwrap)
    );
}

#[test]
fn image_generation_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::ImageGeneration.stage(), Stage::Stable);
    assert_eq!(Feature::ImageGeneration.default_enabled(), true);
}

#[test]
fn image_detail_original_is_a_removed_feature_key() {
    assert_eq!(
        feature_for_key("image_detail_original"),
        Some(Feature::ImageDetailOriginal)
    );
}

#[test]
fn tool_call_mcp_elicitation_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::ToolCallMcpElicitation.stage(), Stage::Stable);
    assert_eq!(Feature::ToolCallMcpElicitation.default_enabled(), true);
}

#[test]
fn workspace_dependencies_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::WorkspaceDependencies.stage(), Stage::Stable);
    assert_eq!(Feature::WorkspaceDependencies.default_enabled(), true);
    assert_eq!(
        feature_for_key("workspace_dependencies"),
        Some(Feature::WorkspaceDependencies)
    );
}

#[test]
fn multi_agent_is_the_only_collab_feature_key() {
    assert_eq!(feature_for_key("multi_agent"), Some(Feature::Collab));
    assert_eq!(feature_for_key("collab"), None);
}

#[test]
fn multi_agent_is_stable_and_enabled_by_default() {
    assert_eq!(Feature::Collab.stage(), Stage::Stable);
    assert_eq!(Feature::Collab.default_enabled(), true);
}

#[test]
fn enable_fanout_is_internal() {
    assert_eq!(Feature::SpawnCsv.stage(), Stage::Internal);
    assert_eq!(Feature::SpawnCsv.default_enabled(), false);
}

#[test]
fn enable_fanout_normalization_enables_multi_agent_one_way() {
    let mut enable_fanout_features = Features::with_defaults();
    enable_fanout_features.enable(Feature::SpawnCsv);
    enable_fanout_features.normalize_dependencies();
    assert_eq!(enable_fanout_features.enabled(Feature::SpawnCsv), true);
    assert_eq!(enable_fanout_features.enabled(Feature::Collab), true);

    let mut collab_features = Features::with_defaults();
    collab_features.enable(Feature::Collab);
    collab_features.normalize_dependencies();
    assert_eq!(collab_features.enabled(Feature::Collab), true);
    assert_eq!(collab_features.enabled(Feature::SpawnCsv), false);
}

#[test]
fn apps_require_feature_flag() {
    let mut features = Features::with_defaults();
    features.disable(Feature::Apps);
    assert!(!features.apps_enabled_for_auth(/*has_managed_auth*/ false));

    features.enable(Feature::Apps);
    assert!(features.apps_enabled_for_auth(/*has_managed_auth*/ false));
    assert!(features.apps_enabled_for_auth(/*has_managed_auth*/ true));
}

#[test]
fn from_sources_applies_base_profile_and_overrides() {
    let mut base_entries = BTreeMap::new();
    base_entries.insert("plugins".to_string(), true);
    let base_features = FeaturesToml {
        entries: base_entries,
        ..Default::default()
    };

    let mut profile_entries = BTreeMap::new();
    profile_entries.insert("code_mode_only".to_string(), true);
    profile_entries.insert("apply_patch_freeform".to_string(), true);
    let profile_features = FeaturesToml {
        entries: profile_entries,
        ..Default::default()
    };

    let features = Features::from_sources(
        FeatureConfigSource {
            features: Some(&base_features),
            ..Default::default()
        },
        FeatureConfigSource {
            features: Some(&profile_features),
        },
        FeatureOverrides {
            web_search_request: Some(false),
            ..Default::default()
        },
    );

    assert_eq!(features.enabled(Feature::Plugins), true);
    assert_eq!(features.enabled(Feature::CodeModeOnly), true);
    assert_eq!(features.enabled(Feature::CodeMode), true);
    assert_eq!(features.enabled(Feature::ApplyPatchFreeform), true);
    assert_eq!(features.enabled(Feature::WebSearchRequest), false);
}

#[test]
fn from_sources_ignores_removed_image_detail_original_feature_key() {
    let features_toml = FeaturesToml::from(BTreeMap::from([(
        "image_detail_original".to_string(),
        true,
    )]));

    let features = Features::from_sources(
        FeatureConfigSource {
            features: Some(&features_toml),
            ..Default::default()
        },
        FeatureConfigSource::default(),
        FeatureOverrides::default(),
    );

    assert_eq!(features, Features::with_defaults());
}

#[test]
fn multi_agent_v2_feature_config_deserializes_boolean_toggle() {
    let features: FeaturesToml = toml::from_str(
        r#"
multi_agent_v2 = true
"#,
    )
    .expect("features table should deserialize");

    assert_eq!(
        features.entries(),
        BTreeMap::from([("multi_agent_v2".to_string(), true)])
    );
    assert_eq!(features.multi_agent_v2, Some(FeatureToml::Enabled(true)));
}

#[test]
fn multi_agent_v2_feature_config_deserializes_table() {
    let features: FeaturesToml = toml::from_str(
        r#"
[multi_agent_v2]
enabled = true
usage_hint_enabled = false
usage_hint_text = "Custom delegation guidance."
hide_spawn_agent_metadata = true
"#,
    )
    .expect("features table should deserialize");

    assert_eq!(
        features.entries(),
        BTreeMap::from([("multi_agent_v2".to_string(), true)])
    );
    assert_eq!(
        features.multi_agent_v2,
        Some(crate::FeatureToml::Config(crate::MultiAgentV2ConfigToml {
            enabled: Some(true),
            usage_hint_enabled: Some(false),
            usage_hint_text: Some("Custom delegation guidance.".to_string()),
            hide_spawn_agent_metadata: Some(true),
        }))
    );
}

#[test]
fn multi_agent_v2_feature_config_usage_hint_enabled_does_not_enable_feature() {
    let features_toml: FeaturesToml = toml::from_str(
        r#"
[multi_agent_v2]
usage_hint_enabled = false
"#,
    )
    .expect("features table should deserialize");
    let features = Features::from_sources(
        FeatureConfigSource {
            features: Some(&features_toml),
            ..Default::default()
        },
        FeatureConfigSource::default(),
        FeatureOverrides::default(),
    );

    assert_eq!(features.enabled(Feature::MultiAgentV2), false);
    assert_eq!(features_toml.entries(), BTreeMap::new());
    assert_eq!(
        features_toml.multi_agent_v2,
        Some(crate::FeatureToml::Config(crate::MultiAgentV2ConfigToml {
            enabled: None,
            usage_hint_enabled: Some(false),
            usage_hint_text: None,
            hide_spawn_agent_metadata: None,
        }))
    );
}
