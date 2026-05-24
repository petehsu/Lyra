use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct BrowserTool;

static LYRA_PROVIDER: LyraBrowserProvider = LyraBrowserProvider;

impl BrowserTool {
    pub fn new() -> Self {
        Self
    }
}

fn browser_tool_description_text() -> &'static str {
    "Control the Lyra embedded browser. Use action='status' to check whether browser automation is ready. Use action='setup' only for first-time repair when status shows automation is not already ready. Do not run setup before every browser task."
}

#[derive(Debug, Deserialize)]
struct BrowserInput {
    action: String,
    #[serde(default)]
    browser: Option<String>,
    #[serde(default)]
    provider_action: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    tab_id: Option<i64>,
    #[serde(default)]
    frame_id: Option<i64>,
    #[serde(default)]
    all_frames: Option<bool>,
    #[serde(default)]
    selector: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    contains: Option<String>,
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    wait: Option<bool>,
    #[serde(default)]
    new_tab: Option<bool>,
    #[serde(default)]
    focus: Option<bool>,
    #[serde(default)]
    clear: Option<bool>,
    #[serde(default)]
    submit: Option<bool>,
    #[serde(default)]
    page_world: Option<bool>,
    #[serde(default)]
    position: Option<String>,
    #[serde(default)]
    behavior: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    fields: Option<Vec<BrowserField>>,
    #[serde(default)]
    scroll_to: Option<ScrollTo>,
}

#[derive(Debug, Deserialize)]
struct BrowserField {
    selector: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    checked: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ScrollTo {
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
}

#[async_trait]
trait BrowserProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn supported_browsers(&self) -> &'static [&'static str];

    async fn status(&self, ctx: &ToolContext) -> Result<ToolOutput>;
    async fn setup(&self) -> Result<ToolOutput>;
    async fn ensure_ready(&self) -> Result<Option<String>>;
    async fn execute(
        &self,
        action: &str,
        input: &BrowserInput,
        ctx: &ToolContext,
    ) -> Result<ToolOutput>;
}

struct LyraBrowserProvider;

#[async_trait]
impl BrowserProvider for LyraBrowserProvider {
    fn id(&self) -> &'static str {
        "lyra_browser"
    }

    fn supported_browsers(&self) -> &'static [&'static str] {
        &["auto", "firefox", "chrome", "safari", "edge"]
    }

    async fn status(&self, _ctx: &ToolContext) -> Result<ToolOutput> {
        let mut metadata = Map::new();
        metadata.insert("setup_complete".into(), json!(true));
        metadata.insert("binary_installed".into(), json!(true));
        metadata.insert("responding".into(), json!(true));
        metadata.insert("compatible".into(), json!(true));
        metadata.insert("ready".into(), json!(true));
        metadata.insert("backend".into(), json!("lyra_browser"));
        metadata.insert("browser".into(), json!("lyra"));

        Ok(
            ToolOutput::new("Lyra embedded browser capability bridge is connected and active.")
                .with_title("browser status")
                .with_metadata(Value::Object(metadata)),
        )
    }

    async fn setup(&self) -> Result<ToolOutput> {
        Ok(
            ToolOutput::new("Lyra embedded browser is always ready. No manual setup is needed.")
                .with_title("browser setup"),
        )
    }

    async fn ensure_ready(&self) -> Result<Option<String>> {
        Ok(None)
    }

    async fn execute(
        &self,
        action: &str,
        input: &BrowserInput,
        _ctx: &ToolContext,
    ) -> Result<ToolOutput> {
        let (bridge_action, bridge_params, title) = bridge_request(action, input)?;
        let capability_method = format!("browser.{}", bridge_action);

        match crate::lyra_runtime::call_host_capability(&capability_method, bridge_params) {
            Ok(result) => {
                if action == "screenshot" {
                    let b64 = result
                        .get("data")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow::anyhow!("Screenshot response missing data field"))?
                        .to_string();
                    let body = format!("Captured browser screenshot via Lyra embedded browser.");
                    let output = ToolOutput::new(body)
                        .with_title(title)
                        .with_metadata(result)
                        .with_labeled_image("image/png", b64, "browser screenshot");
                    Ok(attach_browser_metadata(output, self.id(), "lyra"))
                } else {
                    Ok(attach_browser_metadata(
                        render_browser_output(action, title, result),
                        self.id(),
                        "lyra",
                    ))
                }
            }
            Err(e) => {
                anyhow::bail!("Lyra browser host capability request failed: {}", e)
            }
        }
    }
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
                "enum": [
                    "status", "setup", "list_tabs", "new_tab", "select_tab", "get_active_tab",
                    "list_frames", "open", "snapshot", "get_content", "interactables", "click", "type",
                    "fill_form", "select", "wait", "screenshot", "eval", "scroll", "upload",
                    "press", "provider_command"
                ],
                "description": "Action. Use 'status' to check readiness first. Use 'setup' only for first-time repair, not before every browser task."
            }),
        );
        properties.insert(
            "browser".into(),
            json!({
                "type": "string",
                "enum": ["auto", "firefox", "chrome", "safari", "edge"],
                "description": "Browser."
            }),
        );
        properties.insert(
            "provider_action".into(),
            json!({
                "type": "string",
                "description": "Provider command name."
            }),
        );
        properties.insert(
            "params".into(),
            json!({
                "type": "object",
                "description": "Raw provider params."
            }),
        );
        for (name, schema) in [
            ("url", json!({"type": "string"})),
            ("tab_id", json!({"type": "integer"})),
            ("frame_id", json!({"type": "integer"})),
            ("all_frames", json!({"type": "boolean"})),
            ("selector", json!({"type": "string"})),
            ("text", json!({"type": "string"})),
            ("contains", json!({"type": "string"})),
            ("script", json!({"type": "string"})),
            ("key", json!({"type": "string"})),
            ("x", json!({"type": "number"})),
            ("y", json!({"type": "number"})),
            ("wait", json!({"type": "boolean"})),
            ("new_tab", json!({"type": "boolean"})),
            ("focus", json!({"type": "boolean"})),
            ("clear", json!({"type": "boolean"})),
            ("submit", json!({"type": "boolean"})),
            ("page_world", json!({"type": "boolean"})),
            ("position", json!({"type": "string"})),
            ("behavior", json!({"type": "string"})),
            ("timeout_ms", json!({"type": "integer"})),
            ("path", json!({"type": "string"})),
        ] {
            properties.insert(name.into(), schema);
        }
        properties.insert(
            "format".into(),
            json!({
                "type": "string",
                "enum": ["annotated", "text", "textFast", "html", "title"],
                "description": "Format."
            }),
        );
        properties.insert(
            "fields".into(),
            json!({
                "type": "array",
                "description": "Form fields.",
                "items": {
                    "type": "object",
                    "required": ["selector"],
                    "properties": {
                        "selector": { "type": "string" },
                        "value": { "type": "string" },
                        "checked": { "type": "boolean" }
                    }
                }
            }),
        );
        properties.insert(
            "scroll_to".into(),
            json!({
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                }
            }),
        );
        Value::Object(Map::from_iter([
            ("type".into(), json!("object")),
            ("required".into(), json!(["action"])),
            ("properties".into(), Value::Object(properties)),
        ]))
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: BrowserInput = serde_json::from_value(input)?;
        let provider = resolve_provider(params.browser.as_deref())?;

        match params.action.as_str() {
            "status" => provider.status(&ctx).await,
            "setup" => provider.setup().await,
            other => {
                let setup_message = provider.ensure_ready().await?;
                let output = provider.execute(other, &params, &ctx).await?;
                Ok(match setup_message {
                    Some(message) if !message.is_empty() => prepend_setup_message(output, &message),
                    _ => output,
                })
            }
        }
    }
}

fn prepend_setup_message(mut output: ToolOutput, message: &str) -> ToolOutput {
    output.output = format!("{}\n\n{}", message, output.output);
    if output.title.is_none() {
        output.title = Some("browser".to_string());
    }

    let mut metadata = match output.metadata.take() {
        Some(Value::Object(map)) => map,
        Some(other) => {
            let mut map = Map::new();
            map.insert("result".into(), other);
            map
        }
        None => Map::new(),
    };
    metadata.insert("setup_ran".into(), json!(true));
    output.metadata = Some(Value::Object(metadata));
    output
}

fn attach_browser_metadata(
    mut output: ToolOutput,
    backend: &'static str,
    browser: &'static str,
) -> ToolOutput {
    let mut metadata = match output.metadata.take() {
        Some(Value::Object(map)) => map,
        Some(other) => {
            let mut map = Map::new();
            map.insert("result".into(), other);
            map
        }
        None => Map::new(),
    };
    metadata.insert("backend".into(), json!(backend));
    metadata.insert("browser".into(), json!(browser));
    output.metadata = Some(Value::Object(metadata));
    output
}

fn resolve_provider(browser: Option<&str>) -> Result<&'static dyn BrowserProvider> {
    let browser = browser.unwrap_or("auto");
    if LYRA_PROVIDER.supported_browsers().contains(&browser) {
        return Ok(&LYRA_PROVIDER);
    }

    anyhow::bail!(
        "Browser backend '{}' is not wired into the built-in browser tool yet. Use auto/firefox/chrome/safari/edge for now.",
        browser
    )
}

fn bridge_request(action: &str, input: &BrowserInput) -> Result<(String, Value, String)> {
    let bridge_action = match action {
        "list_tabs" => "listTabs",
        "new_tab" => "newSession",
        "select_tab" => "setActiveTab",
        "get_active_tab" => "getActiveTab",
        "list_frames" => "listFrames",
        "open" => "navigate",
        "snapshot" => "getContent",
        "get_content" => "getContent",
        "interactables" => "getInteractables",
        "click" => "click",
        "type" => "type",
        "fill_form" => "fillForm",
        "select" => "fillForm",
        "wait" => "waitFor",
        "screenshot" => "screenshot",
        "eval" => "evaluate",
        "scroll" => "scroll",
        "upload" => "uploadFile",
        "press" => "evaluate",
        "provider_command" => input.provider_action.as_deref().ok_or_else(|| {
            anyhow::anyhow!("provider_action is required when action='provider_command'")
        })?,
        other => anyhow::bail!("Unsupported browser action: {}", other),
    }
    .to_string();

    let mut params = Map::new();
    apply_common_targeting(&mut params, input);

    match action {
        "new_tab" => {
            if let Some(url) = &input.url {
                params.insert("url".into(), json!(url));
            }
            if let Some(timeout_ms) = input.timeout_ms {
                params.insert("timeoutMs".into(), json!(timeout_ms));
            }
        }
        "select_tab" => {
            let tab_id = input
                .tab_id
                .ok_or_else(|| anyhow::anyhow!("tab_id is required for select_tab"))?;
            params.insert("tabId".into(), json!(tab_id));
            if let Some(focus) = input.focus {
                params.insert("focus".into(), json!(focus));
            }
        }
        "open" => {
            let url = input
                .url
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("url is required for open"))?;
            params.insert("url".into(), json!(url));
            params.insert("wait".into(), json!(input.wait.unwrap_or(true)));
            if let Some(new_tab) = input.new_tab {
                params.insert("newTab".into(), json!(new_tab));
            }
            if let Some(timeout_ms) = input.timeout_ms {
                params.insert("timeoutMs".into(), json!(timeout_ms));
            }
        }
        "snapshot" => {
            params.insert("format".into(), json!("annotated"));
        }
        "get_content" => {
            params.insert(
                "format".into(),
                json!(input.format.as_deref().unwrap_or("text")),
            );
        }
        "interactables" => {}
        "click" => {
            if input.selector.is_none()
                && input.text.is_none()
                && input.x.is_none()
                && input.y.is_none()
            {
                anyhow::bail!("click requires selector, text, or x/y coordinates");
            }
            if let Some(x) = input.x {
                params.insert("x".into(), json!(x));
            }
            if let Some(y) = input.y {
                params.insert("y".into(), json!(y));
            }
        }
        "type" => {
            let text = input
                .text
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("text is required for type"))?;
            params.insert("text".into(), json!(text));
            if let Some(clear) = input.clear {
                params.insert("clear".into(), json!(clear));
            }
            if let Some(submit) = input.submit {
                params.insert("submit".into(), json!(submit));
            }
        }
        "fill_form" => {
            let fields = input
                .fields
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("fields are required for fill_form"))?;
            let mapped: Vec<Value> = fields
                .iter()
                .map(|field| {
                    let mut obj = Map::new();
                    obj.insert("selector".into(), json!(field.selector));
                    if let Some(value) = &field.value {
                        obj.insert("value".into(), json!(value));
                    }
                    if let Some(checked) = field.checked {
                        obj.insert("checked".into(), json!(checked));
                    }
                    Value::Object(obj)
                })
                .collect();
            params.insert("fields".into(), Value::Array(mapped));
        }
        "select" => {
            let selector = input
                .selector
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("selector is required for select"))?;
            let value = input.text.as_deref().ok_or_else(|| {
                anyhow::anyhow!("text is required for select and is used as the option value")
            })?;
            params.insert(
                "fields".into(),
                json!([{ "selector": selector, "value": value }]),
            );
        }
        "wait" => {
            if input.selector.is_none() && input.text.is_none() && input.contains.is_none() {
                anyhow::bail!("wait requires selector, text, or contains");
            }
            if let Some(timeout_ms) = input.timeout_ms {
                params.insert("timeout".into(), json!(timeout_ms));
            }
            if let Some(contains) = &input.contains {
                params.insert("contains".into(), json!(contains));
            }
        }
        "screenshot" => {}
        "eval" => {
            let script = input
                .script
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("script is required for eval"))?;
            params.insert("script".into(), json!(script));
            if let Some(page_world) = input.page_world {
                params.insert("pageWorld".into(), json!(page_world));
            }
        }
        "scroll" => {
            if let Some(x) = input.x {
                params.insert("x".into(), json!(x));
            }
            if let Some(y) = input.y {
                params.insert("y".into(), json!(y));
            }
            if let Some(position) = &input.position {
                params.insert("position".into(), json!(position));
            }
            if let Some(behavior) = &input.behavior {
                params.insert("behavior".into(), json!(behavior));
            }
            if let Some(scroll_to) = &input.scroll_to {
                let mut target = Map::new();
                if let Some(x) = scroll_to.x {
                    target.insert("x".into(), json!(x));
                }
                if let Some(y) = scroll_to.y {
                    target.insert("y".into(), json!(y));
                }
                params.insert("scrollTo".into(), Value::Object(target));
            }
            if !params.contains_key("x")
                && !params.contains_key("y")
                && !params.contains_key("selector")
                && !params.contains_key("position")
                && !params.contains_key("scrollTo")
            {
                anyhow::bail!("scroll requires x/y, selector, position, or scroll_to");
            }
        }
        "upload" => {
            let path = input
                .path
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("path is required for upload"))?;
            params.insert("path".into(), json!(path));
        }
        "press" => {
            let script = build_press_script(input.key.as_deref(), input.selector.as_deref())?;
            params.insert("script".into(), json!(script));
            params.insert("pageWorld".into(), json!(true));
        }
        "provider_command" => {
            if let Some(raw) = &input.params {
                return Ok((bridge_action, raw.clone(), format!("browser {}", action)));
            }
        }
        _ => {}
    }

    Ok((
        bridge_action,
        Value::Object(params),
        format!("browser {}", action),
    ))
}

fn apply_common_targeting(params: &mut Map<String, Value>, input: &BrowserInput) {
    if let Some(tab_id) = input.tab_id {
        params.insert("tabId".into(), json!(tab_id));
    }
    if let Some(frame_id) = input.frame_id {
        params.insert("frameId".into(), json!(frame_id));
    }
    if let Some(all_frames) = input.all_frames {
        params.insert("allFrames".into(), json!(all_frames));
    }
    if let Some(selector) = &input.selector {
        params.insert("selector".into(), json!(selector));
    }
    if let Some(text) = &input.text {
        params.insert("text".into(), json!(text));
    }
}

fn build_press_script(key: Option<&str>, selector: Option<&str>) -> Result<String> {
    let key = key.ok_or_else(|| anyhow::anyhow!("key is required for press"))?;
    let selector_literal = selector.map(serde_json::to_string).transpose()?;
    let selector_expr = selector_literal
        .map(|s| format!("document.querySelector({})", s))
        .unwrap_or_else(|| "null".to_string());
    let key_literal = serde_json::to_string(key)?;
    Ok(format!(
        r#"return (() => {{
  const target = {selector_expr} || document.activeElement || document.body;
  if (!target) throw new Error('No target available for key press');
  if (typeof target.focus === 'function') target.focus();
  const key = {key_literal};
  const eventInit = {{ key, bubbles: true, cancelable: true }};
  target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  target.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  if (key === 'Enter' && target.form && typeof target.form.submit === 'function') {{
    target.form.submit();
  }}
  target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  return {{ pressed: true, key, tag: target.tagName || null }};
}})();"#
    ))
}

fn render_browser_output(action: &str, title: String, result: Value) -> ToolOutput {
    let body = match action {
        "snapshot" => result
            .get("content")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| serde_json::to_string_pretty(&result).unwrap_or_default()),
        "get_content" => format_content_result(&result),
        "interactables" => format_interactables_result(&result),
        "eval" => format_eval_result(&result),
        _ => serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
    };

    ToolOutput::new(body)
        .with_title(title)
        .with_metadata(result)
}

fn format_content_result(result: &Value) -> String {
    if let Some(content) = result.get("content").and_then(|v| v.as_str()) {
        return content.to_string();
    }
    if let Some(text) = result.get("text").and_then(|v| v.as_str()) {
        return text.to_string();
    }
    if let Some(html) = result.get("html").and_then(|v| v.as_str()) {
        return html.to_string();
    }
    if let Some(title) = result.get("title").and_then(|v| v.as_str()) {
        if let Some(url) = result.get("url").and_then(|v| v.as_str()) {
            return format!("{}\n{}", title, url);
        }
        return title.to_string();
    }
    serde_json::to_string_pretty(result).unwrap_or_default()
}

fn format_eval_result(result: &Value) -> String {
    let value = result.get("result").cloned().unwrap_or(Value::Null);
    let rendered = if let Some(s) = value.as_str() {
        s.to_string()
    } else {
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
    };

    match result.get("type").and_then(|v| v.as_str()) {
        Some(kind) => format!("{}\n\n(type: {})", rendered, kind),
        None => rendered,
    }
}

fn format_interactables_result(result: &Value) -> String {
    let Some(elements) = result.get("elements").and_then(|v| v.as_array()) else {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    };

    if elements.is_empty() {
        return "No interactable elements found.".to_string();
    }

    let mut lines = Vec::new();
    for (idx, element) in elements.iter().enumerate() {
        let kind = element
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("element");
        let tag = element.get("tag").and_then(|v| v.as_str()).unwrap_or("?");
        let text = element
            .get("text")
            .or_else(|| element.get("label"))
            .or_else(|| element.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let selector = element
            .get("selector")
            .and_then(|v| v.as_str())
            .unwrap_or("-");
        lines.push(format!(
            "{}. [{}] <{}> {} | selector: {}",
            idx + 1,
            kind,
            tag.to_lowercase(),
            text,
            selector
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod browser_tests;
