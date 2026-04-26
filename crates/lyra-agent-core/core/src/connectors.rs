use std::collections::HashMap;
use std::collections::HashSet;

pub use lyra_app_server_protocol::AppBranding;
pub use lyra_app_server_protocol::AppInfo;
pub use lyra_app_server_protocol::AppMetadata;
use lyra_config::types::AppsConfigToml;
use lyra_config::types::ToolSuggestDiscoverableType;
use lyra_login::LyraAuth;
use lyra_tools::DiscoverableTool;

use crate::config::Config;
use crate::plugins::list_tool_suggest_discoverable_plugins;
use lyra_mcp::McpConnectionManager;
use lyra_mcp::ToolInfo;
use serde::Deserialize;

pub(crate) async fn list_accessible_and_enabled_connectors_from_manager(
    mcp_connection_manager: &McpConnectionManager,
    config: &Config,
) -> Vec<AppInfo> {
    with_app_enabled_state(
        accessible_connectors_from_mcp_tools(&mcp_connection_manager.list_all_tools().await),
        config,
    )
    .into_iter()
    .filter(|connector| connector.is_accessible && connector.is_enabled)
    .collect()
}

pub(crate) async fn list_tool_suggest_discoverable_tools_with_auth(
    config: &Config,
    _auth: Option<&LyraAuth>,
    accessible_connectors: &[AppInfo],
) -> anyhow::Result<Vec<DiscoverableTool>> {
    let connector_ids = tool_suggest_connector_ids(config).await;
    let discoverable_connectors = accessible_connectors
        .iter()
        .filter(|connector| {
            connector_ids.is_empty() || connector_ids.contains(connector.id.as_str())
        })
        .cloned()
        .map(DiscoverableTool::from);
    Ok(list_tool_suggest_discoverable_plugins(config)
        .await?
        .into_iter()
        .map(DiscoverableTool::from)
        .chain(discoverable_connectors)
        .collect())
}

pub(crate) fn accessible_connectors_from_mcp_tools(
    mcp_tools: &HashMap<String, ToolInfo>,
) -> Vec<AppInfo> {
    let tools = mcp_tools.values().filter_map(|tool| {
        let connector_id = tool.connector_id.as_deref()?;
        Some(lyra_connectors::accessible::AccessibleConnectorTool {
            connector_id: connector_id.to_string(),
            connector_name: tool.connector_name.clone(),
            connector_description: tool.connector_description.clone(),
            plugin_display_names: tool.plugin_display_names.clone(),
        })
    });
    lyra_connectors::accessible::collect_accessible_connectors(tools)
}

pub(crate) fn with_app_enabled_state(
    mut connectors: Vec<AppInfo>,
    config: &Config,
) -> Vec<AppInfo> {
    if !config.features.enabled(lyra_features::Feature::Apps) {
        for connector in &mut connectors {
            connector.is_enabled = false;
        }
        return connectors;
    }

    let Some(apps_config) = read_user_apps_config(config) else {
        return connectors;
    };
    for connector in &mut connectors {
        if apps_config.default.is_some() || apps_config.apps.contains_key(connector.id.as_str()) {
            connector.is_enabled = app_is_enabled(&apps_config, Some(connector.id.as_str()));
        }
    }
    connectors
}

async fn tool_suggest_connector_ids(config: &Config) -> HashSet<String> {
    let mut connector_ids = config
        .tool_suggest
        .discoverables
        .iter()
        .filter(|discoverable| discoverable.kind == ToolSuggestDiscoverableType::Connector)
        .map(|discoverable| discoverable.id.clone())
        .collect::<HashSet<_>>();
    connector_ids.extend(
        crate::plugins::PluginsManager::new(config.lyra_home.to_path_buf())
            .plugins_for_config(config)
            .await
            .capability_summaries()
            .iter()
            .flat_map(|plugin| plugin.app_connector_ids.iter())
            .map(|connector_id| connector_id.0.clone()),
    );
    connector_ids
}

fn read_user_apps_config(config: &Config) -> Option<AppsConfigToml> {
    config
        .config_layer_stack
        .effective_config()
        .as_table()
        .and_then(|table| table.get("apps"))
        .cloned()
        .and_then(|value| AppsConfigToml::deserialize(value).ok())
}

fn app_is_enabled(apps_config: &AppsConfigToml, connector_id: Option<&str>) -> bool {
    let mut enabled = apps_config
        .default
        .as_ref()
        .map(|config| config.enabled)
        .unwrap_or(true);
    if let Some(app_config) = connector_id.and_then(|id| apps_config.apps.get(id)) {
        enabled = app_config.enabled;
    }
    enabled
}
