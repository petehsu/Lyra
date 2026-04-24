use super::*;
use crate::plugins::PluginInstallRequest;
use crate::plugins::PluginsManager;
use crate::plugins::test_support::load_plugins_config;
use crate::plugins::test_support::write_file;
use crate::plugins::test_support::write_marketplace;
use lyra_utils_absolute_path::AbsolutePathBuf;
use tempfile::tempdir;

#[tokio::test]
async fn verified_plugin_suggestion_completed_requires_installed_plugin() {
    let lyra_home = tempdir().expect("tempdir should succeed");
    let marketplace_root = lyra_home.path().join(".tmp/marketplaces/debug");
    write_marketplace(&marketplace_root, "debug", &["sample"]);
    write_file(
        &lyra_home.path().join(crate::config::CONFIG_TOML_FILE),
        r#"[features]
plugins = true

[marketplaces.debug]
source_type = "git"
source = "/tmp/debug"
"#,
    );

    let config = load_plugins_config(lyra_home.path()).await;
    let plugins_manager = PluginsManager::new(lyra_home.path().to_path_buf());

    assert!(!verified_plugin_suggestion_completed(
        "sample@debug",
        &config,
        &plugins_manager,
    ));

    plugins_manager
        .install_plugin(PluginInstallRequest {
            plugin_name: "sample".to_string(),
            marketplace_path: AbsolutePathBuf::try_from(
                marketplace_root.join(".agents/plugins/marketplace.json"),
            )
            .expect("marketplace path"),
        })
        .await
        .expect("plugin should install");

    let refreshed_config = load_plugins_config(lyra_home.path()).await;
    assert!(verified_plugin_suggestion_completed(
        "sample@debug",
        &refreshed_config,
        &plugins_manager,
    ));
}
