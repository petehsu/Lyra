//! Dynamic MCP capability manifests for the Tool-FS registry.
//!
//! The static MCP catalog only registers the 9 management tools
//! (server_list/connect/upsert/...). The tools that MCP servers actually
//! expose were invisible to tool_fs_search/list/inspect — the model had to
//! guess paths and probe one by one (the "43 tool calls to configure two
//! MCP servers" failure). This module projects each configured server's
//! tools into the registry as `/tools/mcp/capability/<serverId>/<toolName>`
//! manifests so the standard discovery path works:
//!
//!   tool_fs_search "query supabase database"        → capability manifest
//!   tool_fs_run /tools/mcp/capability/supabase/query → mcp_tool_execute
//!
//! Disconnected/disabled servers keep their manifests (state annotated in
//! the summary) — like installed software that is simply not running — so
//! search still surfaces them and `server_connect` stays discoverable.

use serde_json::{json, Value};

use super::*;

/// Path prefix for dynamic MCP capability manifests.
pub(super) const MCP_CAPABILITY_PREFIX: &str = "/tools/mcp/capability";

/// Parse `/tools/mcp/capability/<serverId>/<toolName>` into its parts.
pub(crate) fn parse_mcp_capability_path(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix(MCP_CAPABILITY_PREFIX)?;
    let rest = rest.strip_prefix('/')?;
    let (server_id, tool_name) = rest.split_once('/')?;
    if server_id.is_empty() || tool_name.is_empty() {
        return None;
    }
    Some((
        urlencoding::decode(server_id)
            .unwrap_or_default()
            .into_owned(),
        urlencoding::decode(tool_name)
            .unwrap_or_default()
            .into_owned(),
    ))
}

pub(crate) fn mcp_capability_path(server_id: &str, tool_name: &str) -> String {
    format!(
        "{MCP_CAPABILITY_PREFIX}/{}/{}",
        urlencoding::encode(server_id),
        urlencoding::encode(tool_name)
    )
}

/// Build dynamic Tool-FS manifests for all configured MCP servers' tools.
///
/// Servers whose state is not `connected` still contribute manifests (so
/// search finds them) with a note in the summary pointing at
/// `server_connect`/`server_reload`.
pub(super) fn mcp_capability_manifests() -> (Vec<ToolManifest>, Vec<Value>) {
    let registry = crate::native_backend::mcp_catalog::registry_snapshot();
    let mut manifests = Vec::new();
    let mut disconnected_servers = 0_usize;
    for server in &registry.servers {
        let connected = server.state == "connected" && server.enabled;
        if !connected {
            disconnected_servers += 1;
        }
        for tool in &server.tools {
            if tool.name.trim().is_empty() {
                continue;
            }
            let path = mcp_capability_path(&server.id, &tool.name);
            let summary = mcp_tool_summary(server, tool, connected);
            manifests.push(ToolManifest {
                path: path.clone(),
                handle: None,
                domain: "mcp".to_string(),
                operation: "invoke_capability".to_string(),
                title: tool.name.clone(),
                summary: summary.clone(),
                description: format!(
                    "Invoke the {} tool exposed by the MCP server {}. {} The serverId and toolName are filled automatically; pass the tool arguments under `arguments`.",
                    tool.name, server.name, summary
                ),
                aliases: vec![
                    tool.name.clone(),
                    server.name.clone(),
                    format!("{} {}", server.name, tool.name),
                    "mcp".to_string(),
                ],
                examples: vec![
                    format!("Use {} from {}.", tool.name, server.name),
                    format!("Run MCP tool {}/{}.", server.id, tool.name),
                ],
                tags: vec![
                    "mcp".to_string(),
                    "capability".to_string(),
                    server.id.clone(),
                ],
                risk_level: "external".to_string(),
                permission_policy: "allowed".to_string(),
                input_schema: attach_schema_id(&path, mcp_tool_input_schema(&tool.input_schema)),
                output_kind: "json".to_string(),
                activity_kind: "mcp".to_string(),
                renderer_hint: "mcp".to_string(),
            });
        }
    }
    let diagnostics = if registry.servers.is_empty() {
        vec![json!({
            "code": "dynamic_provider_empty",
            "domain": "mcp",
            "message": "No MCP servers are configured. Use /tools/mcp/server_upsert to add one.",
            "recoverable": true,
        })]
    } else if disconnected_servers > 0 {
        vec![json!({
            "code": "mcp_servers_disconnected",
            "domain": "mcp",
            "message": format!(
                "{disconnected_servers} of {} MCP servers are not connected; run /tools/mcp/server_connect before invoking their tools.",
                registry.servers.len()
            ),
            "recoverable": true,
        })]
    } else {
        Vec::new()
    };
    (manifests, diagnostics)
}

fn mcp_tool_summary(
    server: &crate::native_backend::mcp_catalog::McpServerConfig,
    tool: &crate::native_backend::mcp_catalog::McpToolInfo,
    connected: bool,
) -> String {
    let base = tool
        .description
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let base = if base.is_empty() {
        format!("MCP tool {} on server {}", tool.name, server.name)
    } else {
        base
    };
    if connected {
        base
    } else {
        format!("{base} (server not connected — run /tools/mcp/server_connect first)")
    }
}

/// The Tool-FS input schema for a capability manifest. The MCP tool's own
/// inputSchema is embedded as a reference so `tool_fs_inspect` shows the
/// real argument shape; the executable envelope is always
/// `{ arguments: object }`.
fn mcp_tool_input_schema(mcp_schema: &Option<Value>) -> Value {
    let mut arguments = json!({
        "type": "object",
        "description": "Arguments forwarded to the MCP tool.",
        "additionalProperties": true,
    });
    if let Some(schema) = mcp_schema
        && schema.is_object()
    {
        if let Some(object) = arguments.as_object_mut() {
            object.insert("mcpInputSchema".to_string(), schema.clone());
        }
    }
    json!({
        "type": "object",
        "properties": {
            "arguments": arguments
        },
        "required": [],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mcp_capability_path_roundtrip() {
        let path = mcp_capability_path("supabase", "query");
        assert_eq!(path, "/tools/mcp/capability/supabase/query");
        let parsed = parse_mcp_capability_path(&path);
        assert_eq!(
            parsed,
            Some(("supabase".to_string(), "query".to_string()))
        );
    }

    #[test]
    fn parse_mcp_capability_path_url_encoded() {
        let path = mcp_capability_path("my server", "my tool");
        let parsed = parse_mcp_capability_path(&path);
        assert_eq!(
            parsed,
            Some(("my server".to_string(), "my tool".to_string()))
        );
    }

    #[test]
    fn parse_mcp_capability_path_rejects_malformed() {
        assert_eq!(parse_mcp_capability_path("/tools/mcp/capability"), None);
        assert_eq!(parse_mcp_capability_path("/tools/mcp/capability/only"), None);
        assert_eq!(
            parse_mcp_capability_path("/tools/mcp/server_list"),
            None
        );
    }

    #[test]
    fn capability_manifests_generated_for_registry_servers() {
        // The real registry may be empty in tests — assert the function is
        // robust either way and produces the right shape when it has data.
        let (manifests, _diagnostics) = mcp_capability_manifests();
        for manifest in &manifests {
            assert!(manifest.path.starts_with("/tools/mcp/capability/"));
            assert_eq!(manifest.domain, "mcp");
            assert_eq!(manifest.operation, "invoke_capability");
            // Schema must carry the $id and expose the arguments envelope.
            assert!(
                manifest.input_schema.get("$id").is_some(),
                "{} missing schema id",
                manifest.path
            );
            assert!(
                manifest.input_schema.pointer("/properties/arguments").is_some(),
                "{} missing arguments property",
                manifest.path
            );
        }
    }
}