use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct LyraLumenTool;

impl LyraLumenTool {
    pub fn new() -> Self {
        Self
    }
}

fn lyra_lumen_tool_description_text() -> &'static str {
    "Operate Lyra web pages through Lyra Lumen, Lyra's picker-first browser control runtime. Prefer action='map' to get a compact element map, action='focus_scan' to trace real Tab/focus order, then operate returned element_id values with action='act', action='type', action='press', or action='submit'. If an editable element was just clicked or focused, action='type' may omit element_id and will type into the focused control with Chromium keyboard input. Use action='submit' after typing instead of guessing a send button; it presses Enter on the focused control unless an element_id is supplied. When the user enables Lyra Follow Agent mode, the host forces Lumen to target='live' so the visible browser tab is controlled and the user can watch the operation. Otherwise target='isolated' is the default and uses a hidden Lumen page so visible user browsing is not disturbed; set target='live' only when intentionally controlling the visible Lyra browser tab. action='read' returns a small recent text tail by default; strategy='domFallback' is an explicit heavier fallback. action='see' returns screenshots only for model vision fallback when picker/focus/read signals are insufficient. Lumen gives the Agent real Chromium mouse/keyboard input without moving the user's OS cursor."
}

#[derive(Debug, Deserialize)]
struct LyraLumenInput {
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
    vision: Option<String>,
    #[serde(default)]
    point: Option<Value>,
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
impl Tool for LyraLumenTool {
    fn name(&self) -> &str {
        "lyra_lumen"
    }

    fn description(&self) -> &str {
        lyra_lumen_tool_description_text()
    }

    fn parameters_schema(&self) -> Value {
        let mut properties = Map::new();
        properties.insert("intent".into(), super::intent_schema_property());
        properties.insert(
            "action".into(),
            json!({
                "type": "string",
                "enum": ["map", "focus_scan", "act", "type", "press", "submit", "navigate", "read", "see", "wait"],
                "description": "Lyra Lumen action. Start with map or focus_scan, then operate a returned element_id. Use submit after typing into chat/form controls. Use see only when picker/focus/read signals are insufficient."
            }),
        );
        properties.insert(
            "strategy".into(),
            json!({
                "type": "string",
                "enum": ["picker", "focus", "hybrid", "domFallback"],
                "description": "Lumen map/read strategy. picker is the default for map; focus is the default lightweight read path; domFallback is an explicit heavier read fallback."
            }),
        );
        properties.insert(
            "vision".into(),
            json!({
                "type": "string",
                "enum": ["auto", "force", "off"],
                "description": "Vision fallback policy. auto returns visual evidence only when requested by see; force asks Lumen to include vision-friendly capture metadata; off keeps the operation picker/focus only."
            }),
        );
        properties.insert(
            "interaction".into(),
            json!({
                "type": "string",
                "enum": ["hover", "click", "double_click", "right_click"],
                "description": "Interaction for action='act'."
            }),
        );
        properties.insert(
            "direction".into(),
            json!({
                "type": "string",
                "enum": ["next", "previous", "scan"],
                "description": "Focus direction for action='focus_scan'. scan advances through multiple Tab stops and reports the focus graph."
            }),
        );
        properties.insert(
            "target".into(),
            json!({
                "type": "string",
                "enum": ["isolated", "live"],
                "description": "Execution target. When Lyra Follow Agent mode is enabled, the host forces live even if isolated is requested. Otherwise isolated is default and uses a hidden Lyra Lumen page so user-visible browsing is not disturbed. live intentionally controls the visible Lyra browser tab."
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
                    "description": "Opaque element id returned by action='map' or action='focus_scan'. Optional for action='type' after focusing an editable element, and optional for action='submit' when the focused control should submit."
                }),
            ),
            (
                "point",
                json!({
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "reason": {"type": "string"}
                    },
                    "description": "Vision fallback point for action='act' when no element_id is available."
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
        let params: LyraLumenInput = serde_json::from_value(input)?;
        let (method, payload, title) = lyra_lumen_request(&params)?;

        match crate::lyra_runtime::call_host_capability(&method, payload) {
            Ok(result) => Ok(render_lyra_lumen_output(&params.action, title, result)),
            Err(error) => Ok(render_lumen_host_capability_error(
                title,
                &method,
                &error.to_string(),
            )),
        }
    }
}

fn lyra_lumen_request(input: &LyraLumenInput) -> Result<(String, Value, String)> {
    let action = input.action.trim();
    let method_suffix = match action {
        "map" => "map",
        "act" => "act",
        "type" => "type",
        "press" => "press",
        "submit" => "submit",
        "focus_scan" => "focusScan",
        "navigate" => "navigate",
        "read" => "read",
        "see" => "see",
        "wait" => "wait",
        other => anyhow::bail!("Unsupported lyra_lumen action: {}", other),
    };

    let mut payload = Map::new();
    apply_common_payload(&mut payload, input)?;

    match action {
        "map" => {
            payload.insert(
                "strategy".into(),
                json!(input.strategy.as_deref().unwrap_or("picker")),
            );
            payload.insert(
                "vision".into(),
                json!(input.vision.as_deref().unwrap_or("auto")),
            );
        }
        "act" => {
            if let Some(element_id) = &input.element_id {
                payload.insert(
                    "elementId".into(),
                    normalize_id_value(element_id, "element_id")?,
                );
            } else if let Some(point) = &input.point {
                payload.insert("point".into(), normalize_point_value(point)?);
            } else {
                anyhow::bail!("element_id or point is required for lyra_lumen action 'act'");
            }
            payload.insert(
                "interaction".into(),
                json!(input.interaction.as_deref().unwrap_or("click")),
            );
            if let Some(vision) = input.vision.as_deref() {
                payload.insert("vision".into(), json!(vision));
            }
        }
        "type" => {
            if let Some(element_id) = &input.element_id {
                payload.insert(
                    "elementId".into(),
                    normalize_id_value(element_id, "element_id")?,
                );
            }
            payload.insert(
                "text".into(),
                json!(input.text.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("text is required for lyra_lumen action 'type'")
                })?),
            );
            if let Some(clear) = input.clear {
                payload.insert("clear".into(), json!(clear));
            }
        }
        "press" => {
            if let Some(element_id) = &input.element_id {
                payload.insert(
                    "elementId".into(),
                    normalize_id_value(element_id, "element_id")?,
                );
            }
            payload.insert(
                "key".into(),
                json!(input.key.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("key is required for lyra_lumen action 'press'")
                })?),
            );
        }
        "submit" => {
            if let Some(element_id) = &input.element_id {
                payload.insert(
                    "elementId".into(),
                    normalize_id_value(element_id, "element_id")?,
                );
            }
            payload.insert("key".into(), json!(input.key.as_deref().unwrap_or("Enter")));
        }
        "focus_scan" => {
            payload.insert(
                "direction".into(),
                json!(input.direction.as_deref().unwrap_or("scan")),
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
                    anyhow::anyhow!("url is required for lyra_lumen action 'navigate'")
                })?),
            );
            if let Some(new_tab) = input.new_tab {
                payload.insert("newTab".into(), json!(new_tab));
            }
        }
        "read" => {
            payload.insert(
                "strategy".into(),
                json!(input.strategy.as_deref().unwrap_or("focus")),
            );
        }
        "see" => {
            payload.insert(
                "vision".into(),
                json!(input.vision.as_deref().unwrap_or("force")),
            );
        }
        "wait" => {
            payload.insert("timeoutMs".into(), json!(input.timeout_ms.unwrap_or(1_000)));
        }
        _ => {}
    }

    Ok((
        format!("lyraLumen.{}", method_suffix),
        Value::Object(payload),
        format!("lyra_lumen {}", action),
    ))
}

fn apply_common_payload(params: &mut Map<String, Value>, input: &LyraLumenInput) -> Result<()> {
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

fn normalize_id_value(value: &Value, field_name: &str) -> Result<Value> {
    match value {
        Value::String(raw) if !raw.trim().is_empty() => Ok(json!(raw.trim())),
        Value::Number(_) => Ok(value.clone()),
        _ => anyhow::bail!("{} must be a non-empty string or integer", field_name),
    }
}

fn normalize_point_value(value: &Value) -> Result<Value> {
    let Value::Object(point) = value else {
        anyhow::bail!("point must be an object with numeric x and y");
    };
    let x = point
        .get("x")
        .and_then(|value| value.as_f64())
        .ok_or_else(|| anyhow::anyhow!("point.x must be a number"))?;
    let y = point
        .get("y")
        .and_then(|value| value.as_f64())
        .ok_or_else(|| anyhow::anyhow!("point.y must be a number"))?;
    let mut normalized = Map::new();
    normalized.insert("x".into(), json!(x));
    normalized.insert("y".into(), json!(y));
    if let Some(reason) = point.get("reason").and_then(|value| value.as_str()) {
        normalized.insert("reason".into(), json!(reason));
    }
    Ok(Value::Object(normalized))
}

fn render_lyra_lumen_output(action: &str, title: String, result: Value) -> ToolOutput {
    let image_base64 = if action == "see" {
        result
            .get("imageBase64")
            .or_else(|| result.get("data"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
    } else {
        None
    };

    let body = match action {
        "map" => format_observation_result(&result),
        "read" => format_read_result(&result),
        "focus_scan" => format_focus_result(&result),
        "act" | "type" | "press" | "submit" | "navigate" | "wait" => format_action_result(&result),
        "see" => {
            if image_base64.is_some() {
                "Captured Lyra Lumen visual fallback evidence.".to_string()
            } else {
                format_action_result(&result)
            }
        }
        _ => serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
    };

    let output = ToolOutput::new(body)
        .with_title(title)
        .with_metadata(attach_lyra_lumen_metadata(result));

    match image_base64 {
        Some(image) => output.with_labeled_image("image/png", image, "lyra lumen visual fallback"),
        None => output,
    }
}

fn render_lumen_host_capability_error(title: String, method: &str, message: &str) -> ToolOutput {
    let result = json!({
        "ok": false,
        "kind": "lyraLumenResult",
        "error": {
            "kind": "hostCapabilityFailed",
            "message": message
        },
        "requestedMethod": method,
        "nextRecommendedAction": "lyra_lumen.map"
    });
    ToolOutput::new(format_action_result(&result))
        .with_title(title)
        .with_metadata(attach_lyra_lumen_metadata(result))
}

fn attach_lyra_lumen_metadata(mut result: Value) -> Value {
    if let Value::Object(map) = &mut result {
        map.insert("backend".into(), json!("lyra_lumen"));
        map.insert("browser".into(), json!("lyra"));
        map.insert("runtime".into(), json!("lumen"));
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
        .unwrap_or("picker");
    let title = result
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("Untitled page");
    let url = result
        .get("url")
        .and_then(|value| value.as_str())
        .unwrap_or("");

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
        let x = bounds
            .get("x")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let y = bounds
            .get("y")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
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
    if is_not_applicable(result)
        || result.get("ok").and_then(|value| value.as_bool()) == Some(false)
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
                let step = item
                    .get("step")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0);
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
            .unwrap_or("Lyra Lumen action is not applicable to the active tab.");
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
            .unwrap_or("Lyra Lumen action failed.");
        let next = result
            .get("nextRecommendedAction")
            .and_then(|value| value.as_str())
            .unwrap_or("lyra_lumen.map");
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
#[path = "lyra_lumen_tests.rs"]
mod lyra_lumen_tests;
