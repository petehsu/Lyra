use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct BrowserTool;

impl BrowserTool {
    pub fn new() -> Self {
        Self
    }
}

fn browser_tool_description_text() -> &'static str {
    "Operate Lyra browser pages through the Browser Agent runtime. Prefer action='observe' to get an element map, use action='focus' to advance or scan real Tab focus, then use element_id with action='act', action='type', or action='press'. target='isolated' is the default and uses a hidden Browser Agent page so visible user browsing is not disturbed; set target='live' only when intentionally controlling the visible Lyra browser tab. This tool uses Lyra's element picker/focus model and Chromium virtual input; it does not expose raw selector clicking or arbitrary page eval."
}

#[derive(Debug, Deserialize)]
struct BrowserInput {
    action: String,
    #[serde(default)]
    tab_id: Option<Value>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    element_id: Option<Value>,
    #[serde(default)]
    interaction: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    direction: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    steps: Option<u64>,
    #[serde(default)]
    restore_focus: Option<bool>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    max_chars: Option<u64>,
    #[serde(default)]
    clear: Option<bool>,
    #[serde(default)]
    new_tab: Option<bool>,
}

#[async_trait]
impl Tool for BrowserTool {
    fn name(&self) -> &str {
        "browser"
    }

    fn description(&self) -> &str {
        browser_tool_description_text()
    }

    fn parameters_schema(&self) -> Value {
        let mut properties = Map::new();
        properties.insert("intent".into(), super::intent_schema_property());
        properties.insert(
            "action".into(),
            json!({
                "type": "string",
                "enum": ["observe", "act", "type", "press", "focus", "navigate", "read", "screenshot", "wait"],
                "description": "Browser Agent action. Start with observe, then operate a returned element_id."
            }),
        );
        properties.insert(
            "strategy".into(),
            json!({
                "type": "string",
                "enum": ["picker", "focus", "hybrid", "domFallback", "visionFallback"],
                "description": "Observation/read strategy. hybrid is the default for observe; domFallback and visionFallback are explicit fallbacks."
            }),
        );
        properties.insert(
            "interaction".into(),
            json!({
                "type": "string",
                "enum": ["hover", "click", "doubleClick", "rightClick"],
                "description": "Interaction for action='act'."
            }),
        );
        properties.insert(
            "direction".into(),
            json!({
                "type": "string",
                "enum": ["next", "previous", "scan"],
                "description": "Focus direction for action='focus'. scan advances through multiple Tab stops and reports the focus trail."
            }),
        );
        properties.insert(
            "target".into(),
            json!({
                "type": "string",
                "enum": ["isolated", "live"],
                "description": "Execution target. isolated is default and uses a hidden Browser Agent page so user-visible browsing is not disturbed. live intentionally controls the visible Lyra browser tab."
            }),
        );
        for (name, schema) in [
            (
                "tab_id",
                json!({
                    "oneOf": [{"type": "string"}, {"type": "integer"}],
                    "description": "Lyra Workbench browser page tab id. Omit to use the active browser page."
                }),
            ),
            ("url", json!({"type": "string"})),
            (
                "element_id",
                json!({
                    "oneOf": [{"type": "string"}, {"type": "integer"}],
                    "description": "Element id returned by action='observe'."
                }),
            ),
            ("text", json!({"type": "string"})),
            ("key", json!({"type": "string"})),
            ("steps", json!({"type": "integer"})),
            ("restore_focus", json!({"type": "boolean"})),
            ("timeout_ms", json!({"type": "integer"})),
            ("max_chars", json!({"type": "integer"})),
            ("clear", json!({"type": "boolean"})),
            ("new_tab", json!({"type": "boolean"})),
        ] {
            properties.insert(name.into(), schema);
        }

        Value::Object(Map::from_iter([
            ("type".into(), json!("object")),
            ("required".into(), json!(["action"])),
            ("properties".into(), Value::Object(properties)),
        ]))
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let params: BrowserInput = serde_json::from_value(input)?;
        let (method, payload, title) = browser_agent_request(&params)?;

        match crate::lyra_runtime::call_host_capability(&method, payload) {
            Ok(result) => Ok(render_browser_agent_output(&params.action, title, result)),
            Err(error) => Ok(render_host_capability_error(title, &method, &error.to_string())),
        }
    }
}

fn browser_agent_request(input: &BrowserInput) -> Result<(String, Value, String)> {
    let action = input.action.trim();
    let method_suffix = match action {
        "observe" => "observe",
        "act" => "act",
        "type" => "type",
        "press" => "press",
        "focus" => "focus",
        "navigate" => "navigate",
        "read" => "read",
        "screenshot" => "capture",
        "wait" => "wait",
        other => anyhow::bail!("Unsupported browser action: {}", other),
    };

    let mut payload = Map::new();
    apply_common_payload(&mut payload, input)?;

    match action {
        "observe" => {
            payload.insert(
                "strategy".into(),
                json!(input.strategy.as_deref().unwrap_or("hybrid")),
            );
        }
        "act" => {
            payload.insert("elementId".into(), required_element_id(input)?);
            payload.insert(
                "interaction".into(),
                json!(input.interaction.as_deref().unwrap_or("click")),
            );
        }
        "type" => {
            payload.insert("elementId".into(), required_element_id(input)?);
            payload.insert(
                "text".into(),
                json!(input.text.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("text is required for browser action 'type'")
                })?),
            );
            if let Some(clear) = input.clear {
                payload.insert("clear".into(), json!(clear));
            }
        }
        "press" => {
            if let Some(element_id) = &input.element_id {
                payload.insert("elementId".into(), normalize_id_value(element_id, "element_id")?);
            }
            payload.insert(
                "key".into(),
                json!(input.key.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("key is required for browser action 'press'")
                })?),
            );
        }
        "focus" => {
            payload.insert(
                "direction".into(),
                json!(input.direction.as_deref().unwrap_or("next")),
            );
            if let Some(steps) = input.steps {
                payload.insert("steps".into(), json!(steps));
            }
            if let Some(restore_focus) = input.restore_focus {
                payload.insert("restoreFocus".into(), json!(restore_focus));
            }
        }
        "navigate" => {
            payload.insert(
                "url".into(),
                json!(input.url.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("url is required for browser action 'navigate'")
                })?),
            );
            if let Some(new_tab) = input.new_tab {
                payload.insert("newTab".into(), json!(new_tab));
            }
        }
        "read" => {
            payload.insert(
                "strategy".into(),
                json!(input.strategy.as_deref().unwrap_or("domFallback")),
            );
        }
        "screenshot" => {}
        "wait" => {
            payload.insert("timeoutMs".into(), json!(input.timeout_ms.unwrap_or(1_000)));
        }
        _ => {}
    }

    Ok((
        format!("browserAgent.{}", method_suffix),
        Value::Object(payload),
        format!("browser {}", action),
    ))
}

fn apply_common_payload(params: &mut Map<String, Value>, input: &BrowserInput) -> Result<()> {
    if let Some(tab_id) = &input.tab_id {
        params.insert("tabId".into(), normalize_id_value(tab_id, "tab_id")?);
    }
    if let Some(target) = input.target.as_deref() {
        params.insert("target".into(), json!(target));
    }
    if let Some(timeout_ms) = input.timeout_ms {
        params.insert("timeoutMs".into(), json!(timeout_ms));
    }
    if let Some(max_chars) = input.max_chars {
        params.insert("maxChars".into(), json!(max_chars));
    }
    Ok(())
}

fn required_element_id(input: &BrowserInput) -> Result<Value> {
    input
        .element_id
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("element_id is required for browser action '{}'", input.action))
        .and_then(|value| normalize_id_value(value, "element_id"))
}

fn normalize_id_value(value: &Value, field_name: &str) -> Result<Value> {
    match value {
        Value::String(raw) if !raw.trim().is_empty() => Ok(json!(raw.trim())),
        Value::Number(_) => Ok(value.clone()),
        _ => anyhow::bail!("{} must be a non-empty string or integer", field_name),
    }
}

fn render_browser_agent_output(action: &str, title: String, result: Value) -> ToolOutput {
    let image_base64 = if action == "screenshot" {
        result
            .get("imageBase64")
            .or_else(|| result.get("data"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
    } else {
        None
    };

    let body = match action {
        "observe" => format_observation_result(&result),
        "read" => format_read_result(&result),
        "focus" => format_focus_result(&result),
        "act" | "type" | "press" | "navigate" | "wait" => format_action_result(&result),
        "screenshot" => {
            if image_base64.is_some() {
                "Captured browser screenshot through Browser Agent.".to_string()
            } else {
                format_action_result(&result)
            }
        }
        _ => serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
    };

    let output = ToolOutput::new(body)
        .with_title(title)
        .with_metadata(attach_browser_agent_metadata(result));

    match image_base64 {
        Some(image) => output.with_labeled_image("image/png", image, "browser screenshot"),
        None => output,
    }
}

fn render_host_capability_error(title: String, method: &str, message: &str) -> ToolOutput {
    let result = json!({
        "ok": false,
        "kind": "browserAgentResult",
        "error": {
            "kind": "hostCapabilityFailed",
            "message": message
        },
        "requestedMethod": method,
        "nextRecommendedAction": "browser.observe"
    });
    ToolOutput::new(format_action_result(&result))
        .with_title(title)
        .with_metadata(attach_browser_agent_metadata(result))
}

fn attach_browser_agent_metadata(mut result: Value) -> Value {
    if let Value::Object(map) = &mut result {
        map.insert("backend".into(), json!("lyra_browser_agent"));
        map.insert("browser".into(), json!("lyra"));
    }
    result
}

fn format_observation_result(result: &Value) -> String {
    if is_not_applicable(result) {
        return format_action_result(result);
    }

    let observation_id = result
        .get("observationId")
        .and_then(|value| value.as_str())
        .unwrap_or("-");
    let strategy = result
        .get("strategy")
        .and_then(|value| value.as_str())
        .unwrap_or("hybrid");
    let title = result
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Untitled page");
    let url = result.get("url").and_then(|value| value.as_str()).unwrap_or("");

    let mut lines = vec![format!(
        "Observation {observation_id} ({strategy}) for {title}{}",
        if url.is_empty() {
            String::new()
        } else {
            format!(" - {url}")
        }
    )];

    let Some(elements) = result.get("elements").and_then(|value| value.as_array()) else {
        lines.push("No element map returned.".to_string());
        return lines.join("\n");
    };

    if elements.is_empty() {
        lines.push("No actionable elements found.".to_string());
        return lines.join("\n");
    }

    for element in elements {
        let id = element
            .get("id")
            .and_then(|value| value.as_i64())
            .map(|value| value.to_string())
            .or_else(|| {
                element
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "?".to_string());
        let role = element
            .get("role")
            .and_then(|value| value.as_str())
            .unwrap_or("element");
        let label = element
            .get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("(no label)");
        let hint = element
            .get("actionHint")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let bounds = element.get("bounds").unwrap_or(&Value::Null);
        let x = bounds.get("x").and_then(|value| value.as_i64()).unwrap_or(0);
        let y = bounds.get("y").and_then(|value| value.as_i64()).unwrap_or(0);
        let width = bounds
            .get("width")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let height = bounds
            .get("height")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        lines.push(format!(
            "[{id}] {role}: \"{label}\"{} at ({x},{y}) {width}x{height}",
            if hint.is_empty() {
                String::new()
            } else {
                format!(" [{hint}]")
            }
        ));
    }

    lines.join("\n")
}

fn format_read_result(result: &Value) -> String {
    if is_not_applicable(result) {
        return format_action_result(result);
    }
    if let Some(content) = result.get("content").and_then(|value| value.as_str()) {
        return content.to_string();
    }
    if let Some(text) = result.get("text").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string())
}

fn format_focus_result(result: &Value) -> String {
    if is_not_applicable(result) || result.get("ok").and_then(|value| value.as_bool()) == Some(false)
    {
        return format_action_result(result);
    }

    let direction = result
        .get("direction")
        .and_then(|value| value.as_str())
        .unwrap_or("next");
    let active = result
        .get("activeElementId")
        .and_then(|value| value.as_i64())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string());
    let mut lines = vec![format!("Focus {direction}; active element: {active}")];

    if let Some(focused) = result.get("focusedElement") {
        let role = focused
            .get("role")
            .and_then(|value| value.as_str())
            .unwrap_or("element");
        let label = focused
            .get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("(no label)");
        lines.push(format!("Focused {role}: \"{label}\""));
    }

    if let Some(trail) = result.get("focusTrail").and_then(|value| value.as_array()) {
        if !trail.is_empty() {
            lines.push("Focus trail:".to_string());
            for item in trail {
                let step = item.get("step").and_then(|value| value.as_i64()).unwrap_or(0);
                let id = item
                    .get("elementId")
                    .and_then(|value| value.as_i64())
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "none".to_string());
                let label = item
                    .get("label")
                    .and_then(|value| value.as_str())
                    .unwrap_or("(no label)");
                lines.push(format!("  {step}. [{id}] {label}"));
            }
        }
    }

    lines.join("\n")
}

fn format_action_result(result: &Value) -> String {
    if is_not_applicable(result) {
        let message = result
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Browser Agent action is not applicable to the active tab.");
        let recommended = result
            .get("recommendedTool")
            .or_else(|| result.get("recommendedAction"))
            .and_then(|value| value.as_str())
            .unwrap_or("workbench.readTab");
        return format!("{message}\nRecommended tool: {recommended}");
    }

    if result.get("ok").and_then(|value| value.as_bool()) == Some(false) {
        let message = result
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("Browser Agent action failed.");
        let next = result
            .get("nextRecommendedAction")
            .and_then(|value| value.as_str())
            .unwrap_or("browser.observe");
        return format!("{message}\nNext recommended action: {next}");
    }

    if let Some(message) = result.get("message").and_then(|value| value.as_str()) {
        return message.to_string();
    }

    serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string())
}

fn is_not_applicable(result: &Value) -> bool {
    result
        .get("notApplicable")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod browser_tests;
