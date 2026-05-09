use super::*;
use serde_json::Value;
use std::path::Path;

const MCP_TOOL_PREFIX: &str = "mcp__";

#[derive(Clone, Debug)]
pub struct McpToolRef {
    pub server_id: String,
    pub tool_name: String,
}

pub fn mcp_tool_operation_path(tool_ref: &McpToolRef) -> String {
    format!(
        "/tools/mcp/{}/{}",
        sanitize_tool_name_part(&tool_ref.server_id),
        sanitize_tool_name_part(&tool_ref.tool_name)
    )
}

pub fn mcp_tool_definitions(
    storage_root: &Path,
    project_root: Option<&str>,
) -> Vec<ToolDefinition> {
    discover_mcp_tools(storage_root, project_root)
        .into_iter()
        .map(|tool| ToolDefinition {
            name: mcp_model_tool_name(&tool.server_id, &tool.tool_name),
            description: tool.description,
            input_schema: tool.input_schema,
        })
        .collect()
}

pub fn resolve_mcp_tool_ref(
    storage_root: &Path,
    project_root: Option<&str>,
    model_tool_name: &str,
) -> Option<McpToolRef> {
    if !is_mcp_tool_name(model_tool_name) {
        return None;
    }
    discover_mcp_tools(storage_root, project_root)
        .into_iter()
        .find(|tool| mcp_model_tool_name(&tool.server_id, &tool.tool_name) == model_tool_name)
        .map(|tool| McpToolRef {
            server_id: tool.server_id,
            tool_name: tool.tool_name,
        })
}

pub fn is_mcp_tool_name(model_tool_name: &str) -> bool {
    model_tool_name.starts_with(MCP_TOOL_PREFIX)
}

pub fn run_mcp_tool(
    storage_root: &Path,
    project_root: Option<&str>,
    model_tool_name: &str,
    arguments: Value,
) -> Result<Value> {
    let tool_ref = resolve_mcp_tool_ref(storage_root, project_root, model_tool_name)
        .ok_or_else(|| anyhow!("MCP tool not found: {model_tool_name}"))?;
    let response = lyra_mcp_core::call_mcp_runtime_tool_json(
        json!({
            "storageRoot": storage_root.to_string_lossy(),
            "projectRoot": project_root,
            "serverId": tool_ref.server_id,
            "toolName": tool_ref.tool_name,
            "arguments": arguments,
            "baseEnv": {},
        })
        .to_string(),
    )
    .map_err(|error| anyhow!("MCP tools/call failed: {error}"))?;
    serde_json::from_str(&response).context("failed to decode MCP tools/call result")
}

#[derive(Clone, Debug)]
struct DiscoveredMcpTool {
    server_id: String,
    tool_name: String,
    description: String,
    input_schema: Value,
}

fn discover_mcp_tools(storage_root: &Path, _project_root: Option<&str>) -> Vec<DiscoveredMcpTool> {
    let statuses = match lyra_mcp_core::read_mcp_runtime_statuses_json()
        .ok()
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        .and_then(|value| value.as_array().cloned())
    {
        Some(statuses) => statuses,
        None => return Vec::new(),
    };
    let mut tools = Vec::new();
    for status in statuses {
        if status.get("phase").and_then(Value::as_str) != Some("running") {
            continue;
        }
        let Some(server_id) = status.get("serverId").and_then(Value::as_str) else {
            continue;
        };
        let snapshot = match lyra_mcp_core::read_mcp_runtime_introspection_json(
            json!({
                "serverId": server_id,
                "fallbackSnapshot": null,
            })
            .to_string(),
        )
        .ok()
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        {
            Some(Value::Null) | None => continue,
            Some(snapshot) => snapshot,
        };
        for tool in snapshot
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(tool_name) = tool.get("name").and_then(Value::as_str) else {
                continue;
            };
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("MCP tool")
                .to_string();
            let input_schema = tool
                .get("inputSchema")
                .or_else(|| tool.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "additionalProperties": true }));
            tools.push(DiscoveredMcpTool {
                server_id: server_id.to_string(),
                tool_name: tool_name.to_string(),
                description: format!("MCP tool {tool_name} from server {server_id}. {description}"),
                input_schema,
            });
        }
    }
    tools.sort_by(|left, right| {
        (&left.server_id, &left.tool_name).cmp(&(&right.server_id, &right.tool_name))
    });
    tools.dedup_by(|left, right| {
        left.server_id == right.server_id && left.tool_name == right.tool_name
    });
    let _ = storage_root;
    tools
}

fn mcp_model_tool_name(server_id: &str, tool_name: &str) -> String {
    format!(
        "{MCP_TOOL_PREFIX}{}__{}",
        sanitize_tool_name_part(server_id),
        sanitize_tool_name_part(tool_name)
    )
}

fn sanitize_tool_name_part(value: &str) -> String {
    let mut output = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    while output.contains("___") {
        output = output.replace("___", "__");
    }
    output.trim_matches('_').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_tool_name_is_stable_and_function_safe() {
        assert_eq!(
            mcp_model_tool_name("server.one", "read file"),
            "mcp__server_one__read_file"
        );
        assert!(is_mcp_tool_name("mcp__server_one__read_file"));
        assert_eq!(
            mcp_tool_operation_path(&McpToolRef {
                server_id: "server.one".to_string(),
                tool_name: "read file".to_string(),
            }),
            "/tools/mcp/server_one/read_file"
        );
    }
}
