use serde_json::{Value, json};

pub(crate) fn format_mcp_output(action: &str, value: &Value) -> String {
    match action {
        "server_list" => {
            let servers = value
                .get("servers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if servers.is_empty() {
                return "No MCP servers are configured.".to_string();
            }
            format!(
                "Configured {} MCP server(s):\n{}",
                servers.len(),
                servers
                    .iter()
                    .take(10)
                    .map(format_mcp_server_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "server_upsert" => {
            let servers = value
                .get("servers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            format!(
                "Saved {} MCP server config(s):\n{}",
                servers.len(),
                servers
                    .iter()
                    .take(10)
                    .map(format_mcp_server_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "server_remove" => {
            let server_id = value
                .get("serverId")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let removed = value
                .get("removed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            format!("Removed MCP server {server_id}: removed={removed}")
        }
        "server_connect" | "server_reload" | "server_disconnect" => {
            let servers = value
                .get("servers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            format!(
                "Updated {} MCP server(s):\n{}",
                servers.len(),
                servers
                    .iter()
                    .take(10)
                    .map(format_mcp_server_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "tool_discover" => {
            let tools = value
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if tools.is_empty() {
                return "No MCP tools matched.".to_string();
            }
            format!(
                "Discovered {} MCP tool(s):\n{}",
                tools.len(),
                tools
                    .iter()
                    .take(12)
                    .map(format_mcp_tool_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "tool_inspect" => {
            let server_id = value
                .pointer("/server/id")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let tool = value.get("tool").unwrap_or(&Value::Null);
            let name = tool.get("name").and_then(Value::as_str).unwrap_or("tool");
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let schema = tool
                .get("inputSchema")
                .or_else(|| tool.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            format!(
                "MCP tool {server_id}/{name}\ndescription: {description}\ninputSchema: {schema}"
            )
        }
        "tool_execute" => {
            let server_id = value
                .get("serverId")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let result = value.get("result").cloned().unwrap_or_else(|| json!({}));
            let summary = summarize_mcp_result(&result);
            format!("Executed MCP tool {server_id}/{tool_name}:\n{summary}")
        }
        _ => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

fn format_mcp_server_line(server: &Value) -> String {
    let id = server
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let name = server.get("name").and_then(Value::as_str).unwrap_or(id);
    let state = server
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let enabled = server
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tool_count = server.get("toolCount").and_then(Value::as_u64).unwrap_or(0);
    let transport = server
        .get("transportSummary")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let error = server
        .get("lastError")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let suffix = if error.is_empty() {
        String::new()
    } else {
        format!(" error={error}")
    };
    format!(
        "- {id} ({name}) enabled={enabled} state={state} tools={tool_count} transport={transport}{suffix}"
    )
}

fn format_mcp_tool_line(tool: &Value) -> String {
    let server_id = tool
        .get("serverId")
        .and_then(Value::as_str)
        .unwrap_or("server");
    let name = tool.get("name").and_then(Value::as_str).unwrap_or("tool");
    let description = tool
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    format!("- {server_id}/{name}: {description}")
}

fn summarize_mcp_result(result: &Value) -> String {
    if let Some(content) = result.get("content").and_then(Value::as_array) {
        let lines = content
            .iter()
            .take(6)
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .map(|text| text.chars().take(1200).collect::<String>())
                    .or_else(|| {
                        item.get("type")
                            .and_then(Value::as_str)
                            .map(|kind| format!("[{kind}]"))
                    })
            })
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            return lines.join("\n");
        }
    }
    serde_json::to_string_pretty(result)
        .unwrap_or_default()
        .chars()
        .take(4000)
        .collect()
}
