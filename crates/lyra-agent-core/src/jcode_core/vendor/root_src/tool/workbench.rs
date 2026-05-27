use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct WorkbenchTool;

impl WorkbenchTool {
    pub fn new() -> Self {
        Self
    }
}

fn workbench_tool_description_text() -> &'static str {
    "Inspect Lyra Workbench tabs. Use list_tabs first to see all open workspace tabs, then read_tab or extract_tab_text only for the specific tab whose details are needed. This includes browser pages, file editors, file managers, terminals, search results, settings, and other workspace apps."
}

#[derive(Debug, Deserialize)]
struct WorkbenchInput {
    action: String,
    #[serde(default)]
    tab_id: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    include_visual: Option<bool>,
    #[serde(default)]
    include_unsupported: Option<bool>,
    #[serde(default)]
    max_chars: Option<u64>,
    #[serde(default)]
    max_entries: Option<u64>,
    #[serde(default)]
    max_bytes: Option<u64>,
    #[serde(default)]
    cursor: Option<u64>,
    #[serde(default)]
    pane_id: Option<String>,
}

#[async_trait]
impl Tool for WorkbenchTool {
    fn name(&self) -> &str {
        "workbench"
    }

    fn description(&self) -> &str {
        workbench_tool_description_text()
    }

    fn parameters_schema(&self) -> Value {
        Value::Object(Map::from_iter([
            ("type".into(), json!("object")),
            ("required".into(), json!(["action"])),
            (
                "properties".into(),
                json!({
                    "intent": super::intent_schema_property(),
                    "action": {
                        "type": "string",
                        "enum": ["list_tabs", "read_tab", "read_workspace", "extract_tab_text"],
                        "description": "Use list_tabs first. Use read_tab for one tab summary/full details. Use read_workspace for currently visible tabs. Use extract_tab_text for paginated long text."
                    },
                    "tab_id": {
                        "type": "string",
                        "description": "Workspace tab id for read_tab or extract_tab_text."
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["all", "visible", "active", "main", "full"],
                        "description": "For list_tabs: all/visible/active. For extract_tab_text: main/full."
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["summary", "full"],
                        "description": "Read detail level for read_tab/read_workspace."
                    },
                    "include_visual": {
                        "type": "boolean",
                        "description": "Attach a visual capture when supported and useful."
                    },
                    "include_unsupported": {
                        "type": "boolean",
                        "description": "For list_tabs, include tabs that only have a basic summary."
                    },
                    "max_chars": { "type": "integer" },
                    "max_entries": { "type": "integer" },
                    "max_bytes": { "type": "integer" },
                    "cursor": { "type": "integer" },
                    "pane_id": {
                        "type": "string",
                        "description": "Terminal pane id when reading a specific terminal pane."
                    }
                }),
            ),
        ]))
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let input: WorkbenchInput = serde_json::from_value(input)?;
        let (method, payload) = workbench_request(&input)?;
        let result = crate::lyra_runtime::call_host_capability(method, payload)
            .map_err(|error| anyhow::anyhow!("Lyra workbench host capability failed: {}", error))?;

        Ok(render_workbench_output(&input.action, result))
    }
}

fn workbench_request(input: &WorkbenchInput) -> Result<(&'static str, Value)> {
    let mut params = Map::new();

    match input.action.as_str() {
        "list_tabs" => {
            if let Some(scope) = input.scope.as_deref().filter(|scope| !scope.is_empty()) {
                match scope {
                    "all" | "visible" | "active" => {
                        params.insert("scope".into(), json!(scope));
                    }
                    other => anyhow::bail!(
                        "scope '{}' is invalid for list_tabs; use all, visible, or active",
                        other
                    ),
                }
            } else {
                params.insert("scope".into(), json!("all"));
            }
            params.insert(
                "includeUnsupported".into(),
                json!(input.include_unsupported.unwrap_or(true)),
            );
            Ok(("workbench.listTabs", Value::Object(params)))
        }
        "read_tab" => {
            params.insert("tabId".into(), json!(required_tab_id(input)?));
            apply_read_options(&mut params, input);
            Ok(("workbench.readTab", Value::Object(params)))
        }
        "read_workspace" => {
            apply_workspace_options(&mut params, input);
            Ok(("workbench.readWorkspace", Value::Object(params)))
        }
        "extract_tab_text" => {
            params.insert("tabId".into(), json!(required_tab_id(input)?));
            if let Some(scope) = input.scope.as_deref().filter(|scope| !scope.is_empty()) {
                match scope {
                    "main" | "full" => {
                        params.insert("scope".into(), json!(scope));
                    }
                    other => anyhow::bail!(
                        "scope '{}' is invalid for extract_tab_text; use main or full",
                        other
                    ),
                }
            }
            if let Some(cursor) = input.cursor {
                params.insert("cursor".into(), json!(cursor));
            }
            apply_size_options(&mut params, input);
            if let Some(pane_id) = input.pane_id.as_deref().filter(|value| !value.is_empty()) {
                params.insert("paneId".into(), json!(pane_id));
            }
            Ok(("workbench.extractTabText", Value::Object(params)))
        }
        other => anyhow::bail!("Unsupported workbench action: {}", other),
    }
}

fn required_tab_id(input: &WorkbenchInput) -> Result<&str> {
    input
        .tab_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("tab_id is required for {}", input.action))
}

fn apply_read_options(params: &mut Map<String, Value>, input: &WorkbenchInput) {
    if let Some(detail) = input.detail.as_deref().filter(|value| !value.is_empty()) {
        params.insert("detail".into(), json!(detail));
    }
    if let Some(include_visual) = input.include_visual {
        params.insert("includeVisual".into(), json!(include_visual));
    }
    if let Some(pane_id) = input.pane_id.as_deref().filter(|value| !value.is_empty()) {
        params.insert("paneId".into(), json!(pane_id));
    }
    apply_size_options(params, input);
}

fn apply_workspace_options(params: &mut Map<String, Value>, input: &WorkbenchInput) {
    if let Some(detail) = input.detail.as_deref().filter(|value| !value.is_empty()) {
        params.insert("detail".into(), json!(detail));
    }
    if let Some(include_visual) = input.include_visual {
        params.insert("includeVisual".into(), json!(include_visual));
    }
}

fn apply_size_options(params: &mut Map<String, Value>, input: &WorkbenchInput) {
    if let Some(max_chars) = input.max_chars {
        params.insert("maxChars".into(), json!(max_chars));
    }
    if let Some(max_entries) = input.max_entries {
        params.insert("maxEntries".into(), json!(max_entries));
    }
    if let Some(max_bytes) = input.max_bytes {
        params.insert("maxBytes".into(), json!(max_bytes));
    }
}

fn render_workbench_output(action: &str, result: Value) -> ToolOutput {
    let body = match action {
        "list_tabs" => format_tab_list(&result),
        "extract_tab_text" => format_extracted_text(&result),
        "read_workspace" => format_workspace_snapshot(&result),
        "read_tab" => format_tab_observation(&result),
        _ => serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
    };

    ToolOutput::new(body)
        .with_title(format!("workbench {}", action))
        .with_metadata(result)
}

fn format_tab_list(result: &Value) -> String {
    let Some(tabs) = result.get("tabs").and_then(Value::as_array) else {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    };
    if tabs.is_empty() {
        return "No Lyra Workbench tabs are open.".to_string();
    }

    let mut lines = Vec::new();
    for tab in tabs {
        let id = tab.get("tabId").and_then(Value::as_str).unwrap_or("-");
        let title = tab
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled");
        let page_kind = tab.get("pageKind").and_then(Value::as_str).unwrap_or("-");
        let app_id = tab.get("appId").and_then(Value::as_str);
        let observation_kind = tab.get("observationKind").and_then(Value::as_str);
        let display_address = tab.get("displayAddress").and_then(Value::as_str);
        let mut flags = Vec::new();
        if tab.get("active").and_then(Value::as_bool) == Some(true) {
            flags.push("active");
        }
        if tab.get("visible").and_then(Value::as_bool) == Some(true) {
            flags.push("visible");
        }
        if tab.get("focusedPane").and_then(Value::as_bool) == Some(true) {
            flags.push("focused");
        }
        if tab.get("observable").and_then(Value::as_bool) != Some(true) {
            flags.push("summary-only");
        }
        let kind = app_id
            .map(|app| format!("{}:{}", page_kind, app))
            .unwrap_or_else(|| page_kind.to_string());
        let observed = observation_kind.unwrap_or("tab-summary");
        let suffix = display_address
            .filter(|value| !value.is_empty())
            .map(|value| format!(" | {}", value))
            .unwrap_or_default();
        lines.push(format!(
            "- {} [{}] {} ({}) flags={}{}",
            title,
            id,
            kind,
            observed,
            if flags.is_empty() {
                "none".to_string()
            } else {
                flags.join(",")
            },
            suffix
        ));
    }
    lines.join("\n")
}

fn format_extracted_text(result: &Value) -> String {
    let text = result.get("text").and_then(Value::as_str).unwrap_or("");
    if text.is_empty() {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    }
    let has_more = result
        .get("hasMore")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let next_cursor = result.get("nextCursor").and_then(Value::as_u64);
    let mut output = text.to_string();
    if has_more {
        output.push_str(&format!(
            "\n\n[More text available. nextCursor={}]",
            next_cursor
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ));
    }
    output
}

fn format_workspace_snapshot(result: &Value) -> String {
    let Some(tabs) = result.get("visibleTabs").and_then(Value::as_array) else {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    };
    if tabs.is_empty() {
        return "No visible Lyra Workbench tabs are readable.".to_string();
    }
    tabs.iter()
        .map(format_tab_observation)
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

fn format_tab_observation(result: &Value) -> String {
    let Some(tab) = result.get("tab") else {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    };
    let title = tab
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled");
    let tab_id = tab.get("tabId").and_then(Value::as_str).unwrap_or("-");
    let kind = tab
        .get("observationKind")
        .or_else(|| tab.get("pageKind"))
        .and_then(Value::as_str)
        .unwrap_or("tab");
    let observation = result.get("observation").unwrap_or(&Value::Null);
    let rendered = match observation.get("kind").and_then(Value::as_str) {
        Some("file-editor") => observation
            .get("content")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| serde_json::to_string_pretty(observation).unwrap_or_default()),
        Some("terminal") => observation
            .get("activeOutput")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| serde_json::to_string_pretty(observation).unwrap_or_default()),
        Some("page") => observation
            .get("mainTextExcerpt")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| serde_json::to_string_pretty(observation).unwrap_or_default()),
        Some("image-viewer") => format_image_viewer_observation(observation),
        _ => serde_json::to_string_pretty(observation).unwrap_or_default(),
    };
    format!("{} [{}] ({})\n{}", title, tab_id, kind, rendered)
}

fn format_image_viewer_observation(observation: &Value) -> String {
    let mut lines = Vec::new();
    if let Some(path) = observation.get("filePath").and_then(Value::as_str) {
        lines.push(format!("Image: {path}"));
    }
    if let Some(title) = observation.get("title").and_then(Value::as_str) {
        lines.push(format!("Title: {title}"));
    }
    if let Some(status) = observation.get("status").and_then(Value::as_str) {
        lines.push(format!("Status: {status}"));
    }
    if let Some(mime_type) = observation.get("mimeType").and_then(Value::as_str) {
        lines.push(format!("MIME: {mime_type}"));
    }
    if let Some(format) = observation.get("format").and_then(Value::as_str) {
        lines.push(format!("Format: {format}"));
    }
    if let (Some(width), Some(height)) = (
        observation.get("width").and_then(Value::as_u64),
        observation.get("height").and_then(Value::as_u64),
    ) {
        lines.push(format!("Dimensions: {width}x{height}"));
    }
    if let Some(size_bytes) = observation.get("sizeBytes").and_then(Value::as_u64) {
        lines.push(format!("Size bytes: {size_bytes}"));
    }
    if let Some(source_url) = observation.get("sourceUrl").and_then(Value::as_str) {
        lines.push(format!("Source URL: {source_url}"));
    }
    if let Some(cache_state) = observation.get("cacheState").and_then(Value::as_str) {
        lines.push(format!("Cache: {cache_state}"));
    }
    if let Some(viewport) = observation.get("viewport").and_then(Value::as_object) {
        let zoom = viewport
            .get("zoom")
            .and_then(Value::as_f64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "?".to_string());
        let rotation = viewport
            .get("rotation")
            .and_then(Value::as_f64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "?".to_string());
        lines.push(format!("Viewport: zoom={zoom} rotation={rotation}"));
    }
    if lines.is_empty() {
        serde_json::to_string_pretty(observation).unwrap_or_default()
    } else {
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_exposes_workbench_actions() {
        let schema = WorkbenchTool::new().parameters_schema();
        let actions = schema["properties"]["action"]["enum"]
            .as_array()
            .expect("action enum");
        assert!(actions.contains(&json!("list_tabs")));
        assert!(actions.contains(&json!("read_tab")));
        assert!(actions.contains(&json!("read_workspace")));
        assert!(actions.contains(&json!("extract_tab_text")));
    }

    #[test]
    fn list_tabs_maps_scope_and_include_unsupported() {
        let input = WorkbenchInput {
            action: "list_tabs".to_string(),
            tab_id: None,
            scope: Some("visible".to_string()),
            detail: None,
            include_visual: None,
            include_unsupported: Some(false),
            max_chars: None,
            max_entries: None,
            max_bytes: None,
            cursor: None,
            pane_id: None,
        };
        let (method, payload) = workbench_request(&input).expect("request");
        assert_eq!(method, "workbench.listTabs");
        assert_eq!(payload["scope"], "visible");
        assert_eq!(payload["includeUnsupported"], false);
    }

    #[tokio::test]
    async fn tool_formats_workspace_tabs_from_host_capability() {
        use std::sync::Arc;

        let dispatcher = Arc::new(|method: String, payload_json: String| {
            assert_eq!(method, "workbench.listTabs");
            let payload: Value = serde_json::from_str(&payload_json).unwrap();
            assert_eq!(payload["scope"], "all");
            Ok(json!({
                "activeTabId": "file-tab-1",
                "visibleTabIds": ["file-tab-1"],
                "tabs": [
                    {
                        "tabId": "file-tab-1",
                        "title": "main.ts",
                        "pageKind": "app",
                        "appId": "file-editor",
                        "active": true,
                        "visible": true,
                        "focusedPane": true,
                        "observable": true,
                        "observationKind": "file-editor"
                    }
                ]
            })
            .to_string())
        });
        crate::lyra_runtime::register_host_capability_dispatcher(dispatcher);

        let ctx = ToolContext {
            session_id: "test-session".to_string(),
            message_id: "test-message".to_string(),
            tool_call_id: "test-call".to_string(),
            working_dir: None,
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: crate::tool::ToolExecutionMode::Direct,
        };
        let output = WorkbenchTool::new()
            .execute(json!({"action": "list_tabs"}), ctx)
            .await
            .expect("tool output");

        assert!(output.output.contains("main.ts"));
        assert!(output.output.contains("file-editor"));
        crate::lyra_runtime::clear_host_capability_dispatcher();
    }
}
