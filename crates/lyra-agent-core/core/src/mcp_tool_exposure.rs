use std::collections::HashMap;
use std::collections::HashSet;

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
    connectors: Option<&[connectors::AppInfo]>,
    explicitly_enabled_connectors: &[connectors::AppInfo],
    config: &Config,
    tools_config: &ToolsConfig,
) -> McpToolExposure {
    let mut deferred_tools = match connectors {
        Some(connectors) => {
            let mut tools = all_mcp_tools.clone();
            for direct_tool in
                filter_connector_tools(all_mcp_tools, connectors, /*enabled_only*/ true).keys()
            {
                tools.remove(direct_tool);
            }
            tools
        }
        None => all_mcp_tools.clone(),
    };

    let should_defer = tools_config.search_tool
        && (config
            .features
            .enabled(Feature::ToolSearchAlwaysDeferMcpTools)
            || deferred_tools.len() >= DIRECT_MCP_TOOL_EXPOSURE_THRESHOLD);

    if !should_defer {
        if let Some(connectors) = connectors {
            deferred_tools.extend(filter_connector_tools(
                all_mcp_tools,
                connectors,
                /*enabled_only*/ true,
            ));
        }
        return McpToolExposure {
            direct_tools: deferred_tools,
            deferred_tools: None,
        };
    }

    let direct_tools = filter_connector_tools(
        all_mcp_tools,
        explicitly_enabled_connectors,
        /*enabled_only*/ true,
    );
    for direct_tool_name in direct_tools.keys() {
        deferred_tools.remove(direct_tool_name);
    }

    McpToolExposure {
        direct_tools,
        deferred_tools: (!deferred_tools.is_empty()).then_some(deferred_tools),
    }
}

fn filter_connector_tools(
    mcp_tools: &HashMap<String, McpToolInfo>,
    connectors: &[connectors::AppInfo],
    enabled_only: bool,
) -> HashMap<String, McpToolInfo> {
    let allowed: HashSet<&str> = connectors
        .iter()
        .filter(|connector| !enabled_only || connector.is_enabled)
        .map(|connector| connector.id.as_str())
        .collect();

    mcp_tools
        .iter()
        .filter(|(_, tool)| {
            tool.connector_id
                .as_deref()
                .is_some_and(|connector_id| allowed.contains(connector_id))
        })
        .map(|(name, tool)| (name.clone(), tool.clone()))
        .collect()
}
