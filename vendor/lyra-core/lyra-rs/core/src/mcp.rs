use std::collections::HashMap;
use std::sync::Arc;

use crate::config::Config;
use crate::plugins::PluginsManager;
use lyra_config::McpServerConfig;
use lyra_login::LyraAuth;
use lyra_mcp::ToolPluginProvenance;
use lyra_mcp::configured_mcp_servers;
use lyra_mcp::effective_mcp_servers;
use lyra_mcp::tool_plugin_provenance as collect_tool_plugin_provenance;

#[derive(Clone)]
pub struct McpManager {
    plugins_manager: Arc<PluginsManager>,
}

impl McpManager {
    pub fn new(plugins_manager: Arc<PluginsManager>) -> Self {
        Self { plugins_manager }
    }

    pub async fn configured_servers(&self, config: &Config) -> HashMap<String, McpServerConfig> {
        let mcp_config = config.to_mcp_config(self.plugins_manager.as_ref()).await;
        configured_mcp_servers(&mcp_config)
    }

    pub async fn effective_servers(
        &self,
        config: &Config,
        auth: Option<&LyraAuth>,
    ) -> HashMap<String, McpServerConfig> {
        let mcp_config = config.to_mcp_config(self.plugins_manager.as_ref()).await;
        effective_mcp_servers(&mcp_config, auth)
    }

    pub async fn tool_plugin_provenance(&self, config: &Config) -> ToolPluginProvenance {
        let mcp_config = config.to_mcp_config(self.plugins_manager.as_ref()).await;
        collect_tool_plugin_provenance(&mcp_config)
    }
}
