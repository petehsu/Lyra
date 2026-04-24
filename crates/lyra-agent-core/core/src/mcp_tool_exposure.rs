use std::collections::HashMap;

use lyra_features::Feature;
use lyra_mcp::ToolInfo as McpToolInfo;
use lyra_tools::ToolsConfig;

use crate::config::Config;
use crate::connectors;

pub(crate) const DIRECT_MCP_TOOL_EXPOSURE_THRESHOLD: usize = 100;

pub(crate) struct McpToolExposure {
    pub(crate) direct_tools: HashMap<String, McpToolInfo>,
    pub(crate) deferred_tools: Option<HashMap<String, McpToolInfo>>,
}

pub(crate) fn build_mcp_tool_exposure(
    all_mcp_tools: &HashMap<String, McpToolInfo>,
    _connectors: Option<&[connectors::AppInfo]>,
    _explicitly_enabled_connectors: &[connectors::AppInfo],
    config: &Config,
    tools_config: &ToolsConfig,
) -> McpToolExposure {
    let should_defer = tools_config.search_tool
        && (config
            .features
            .enabled(Feature::ToolSearchAlwaysDeferMcpTools)
            || all_mcp_tools.len() >= DIRECT_MCP_TOOL_EXPOSURE_THRESHOLD);

    if should_defer {
        McpToolExposure {
            direct_tools: HashMap::new(),
            deferred_tools: Some(all_mcp_tools.clone()),
        }
    } else {
        McpToolExposure {
            direct_tools: all_mcp_tools.clone(),
            deferred_tools: None,
        }
    }
}
