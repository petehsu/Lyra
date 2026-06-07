use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/mcp/server_list",
            "mcp",
            "server_list",
            "List MCP servers",
            "List configured MCP servers.",
            Some("mcp_server_list"),
        ),
        super::s(
            "/tools/mcp/server_connect",
            "mcp",
            "server_connect",
            "Connect MCP server",
            "Connect an MCP server.",
            None,
        ),
        super::s(
            "/tools/mcp/server_disconnect",
            "mcp",
            "server_disconnect",
            "Disconnect MCP server",
            "Disconnect an MCP server.",
            None,
        ),
        super::s(
            "/tools/mcp/server_reload",
            "mcp",
            "server_reload",
            "Reload MCP server",
            "Reload an MCP server.",
            None,
        ),
        super::s(
            "/tools/mcp/tool_discover",
            "mcp",
            "tool_discover",
            "Discover MCP tools",
            "Search MCP tool manifests.",
            Some("mcp_tool_discover"),
        ),
        super::s(
            "/tools/mcp/tool_inspect",
            "mcp",
            "tool_inspect",
            "Inspect MCP tool",
            "Inspect one MCP tool schema.",
            None,
        ),
        super::s(
            "/tools/mcp/tool_execute",
            "mcp",
            "tool_execute",
            "Execute MCP tool",
            "Execute one MCP tool.",
            None,
        ),
    ]
}
