use std::collections::HashMap;

pub use lyra_app_server_protocol::AppBranding;
pub use lyra_app_server_protocol::AppInfo;
pub use lyra_app_server_protocol::AppMetadata;
use lyra_login::LyraAuth;
use lyra_tools::DiscoverableTool;

use crate::config::Config;
use crate::plugins::list_tool_suggest_discoverable_plugins;
use lyra_mcp::McpConnectionManager;
use lyra_mcp::ToolInfo;

pub(crate) async fn list_accessible_and_enabled_connectors_from_manager(
    _mcp_connection_manager: &McpConnectionManager,
    _config: &Config,
) -> Vec<AppInfo> {
    Vec::new()
}

pub(crate) async fn list_tool_suggest_discoverable_tools_with_auth(
    config: &Config,
    _auth: Option<&LyraAuth>,
    _accessible_connectors: &[AppInfo],
) -> anyhow::Result<Vec<DiscoverableTool>> {
    Ok(list_tool_suggest_discoverable_plugins(config)
        .await?
        .into_iter()
        .map(DiscoverableTool::from)
        .collect())
}

pub(crate) fn accessible_connectors_from_mcp_tools(
    _mcp_tools: &HashMap<String, ToolInfo>,
) -> Vec<AppInfo> {
    Vec::new()
}

pub(crate) fn with_app_enabled_state(
    mut connectors: Vec<AppInfo>,
    config: &Config,
) -> Vec<AppInfo> {
    if !config.features.enabled(lyra_features::Feature::Apps) {
        for connector in &mut connectors {
            connector.is_enabled = false;
        }
    }
    connectors
}
