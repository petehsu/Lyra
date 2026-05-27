use super::{Tool, ToolContext, ToolOutput};
use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

const LYRA_DESIGN_TOOLBOX_PY: &str = include_str!("lyra_design_toolbox.py");
const LYRA_DESIGN_NODE_RUNNER_JS: &str = include_str!("lyra_design_runner.cjs");
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 90_000;

pub struct LyraDesignTool;

impl LyraDesignTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
struct LyraDesignInput {
    action: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    reference_id: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    headless: Option<bool>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[async_trait]
impl Tool for LyraDesignTool {
    fn name(&self) -> &str {
        "lyra_design"
    }

    fn description(&self) -> &str {
        "Search and retrieve professional Lyra Design References. Mandatory before implementing UI/UX: first action='search_references' for a relevant brand or product style, then action='get_reference_details' for DESIGN.md, Tailwind v4, CSS Variables, and Design Tokens."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["action"],
            "properties": {
                "intent": super::intent_schema_property(),
                "action": {
                    "type": "string",
                    "enum": ["search_references", "get_reference_details"],
                    "description": "Use search_references first, then get_reference_details for the selected reference id."
                },
                "query": {
                    "type": "string",
                    "description": "Search query for Lyra Design References, for example a brand, product category, or UI style. Required for search_references."
                },
                "reference_id": {
                    "type": "string",
                    "description": "Lyra design reference id returned by search_references. Required for get_reference_details."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum search results, clamped to 1-25. Defaults to 10."
                },
                "headless": {
                    "type": "boolean",
                    "description": "Run Playwright headless. Defaults to true."
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "Maximum runtime in milliseconds, clamped to 1000-90000. Defaults to 30000."
                }
            }
        })
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let params: LyraDesignInput = serde_json::from_value(input)?;
        let action = normalize_action(&params.action)?;
        let payload = payload_for_action(&action, &params)?;
        let result =
            run_lyra_design_toolbox(&action, payload, timeout_ms(params.timeout_ms)).await?;

        Ok(
            ToolOutput::new(render_lyra_design_output(&action, &params, &result))
                .with_title(format!("lyra_design {action}")),
        )
    }
}

fn normalize_action(action: &str) -> Result<String> {
    match action.trim() {
        "search_references" | "get_reference_details" => Ok(action.trim().to_string()),
        other => anyhow::bail!(
            "Unsupported lyra_design action: {other}. Use search_references or get_reference_details."
        ),
    }
}

fn payload_for_action(action: &str, params: &LyraDesignInput) -> Result<Value> {
    match action {
        "search_references" => {
            let query = params
                .query
                .as_deref()
                .map(str::trim)
                .filter(|query| !query.is_empty())
                .ok_or_else(|| {
                    anyhow::anyhow!("query is required for lyra_design search_references")
                })?;
            Ok(json!({
                "query": query,
                "limit": params.limit.unwrap_or(10).clamp(1, 25),
                "headless": params.headless.unwrap_or(true)
            }))
        }
        "get_reference_details" => {
            let reference_id = params
                .reference_id
                .as_deref()
                .map(str::trim)
                .filter(|reference_id| !reference_id.is_empty())
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "reference_id is required for lyra_design get_reference_details"
                    )
                })?;
            Ok(json!({
                "reference_id": reference_id,
                "headless": params.headless.unwrap_or(true)
            }))
        }
        _ => unreachable!("action was normalized"),
    }
}

fn timeout_ms(value: Option<u64>) -> Duration {
    Duration::from_millis(
        value
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(1_000, MAX_TIMEOUT_MS),
    )
}

async fn run_lyra_design_toolbox(action: &str, payload: Value, timeout: Duration) -> Result<Value> {
    if let Ok(value) = run_lyra_design_node_runner(action, payload.clone(), timeout).await {
        return Ok(value);
    }

    let script_path = ensure_lyra_design_toolbox_script().await?;
    let payload_arg = serde_json::to_string(&payload)?;
    let mut last_error: Option<anyhow::Error> = None;

    for program in ["python3", "python"] {
        match run_python(program, &script_path, action, &payload_arg, timeout).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                let not_found = error
                    .downcast_ref::<std::io::Error>()
                    .map(|io_error| io_error.kind() == std::io::ErrorKind::NotFound)
                    .unwrap_or(false);
                last_error = Some(error);
                if !not_found {
                    break;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        anyhow::anyhow!("lyra_design requires Python 3 and the Playwright Python package")
    }))
}

async fn run_lyra_design_node_runner(
    action: &str,
    payload: Value,
    timeout: Duration,
) -> Result<Value> {
    let script_path = ensure_lyra_design_node_runner_script().await?;
    let payload_arg = serde_json::to_string(&payload)?;
    let mut last_error: Option<anyhow::Error> = None;
    let mut programs = Vec::new();
    if let Ok(explicit) = std::env::var("LYRA_DESIGN_NODE_PATH") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            programs.push(trimmed.to_string());
        }
    }
    programs.push("node".to_string());

    for program in programs {
        match run_node(&program, &script_path, action, &payload_arg, timeout).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                let not_found = error
                    .downcast_ref::<std::io::Error>()
                    .map(|io_error| io_error.kind() == std::io::ErrorKind::NotFound)
                    .unwrap_or(false);
                last_error = Some(error);
                if !not_found {
                    break;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("lyra_design node runner is unavailable")))
}

async fn ensure_lyra_design_node_runner_script() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join("lyra-agent-tools");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join("lyra_design_runner.cjs");
    let should_write = match tokio::fs::read_to_string(&path).await {
        Ok(existing) => existing != LYRA_DESIGN_NODE_RUNNER_JS,
        Err(_) => true,
    };
    if should_write {
        tokio::fs::write(&path, LYRA_DESIGN_NODE_RUNNER_JS).await?;
    }
    Ok(path)
}

async fn ensure_lyra_design_toolbox_script() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join("lyra-agent-tools");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join("lyra_design_toolbox.py");
    let should_write = match tokio::fs::read_to_string(&path).await {
        Ok(existing) => existing != LYRA_DESIGN_TOOLBOX_PY,
        Err(_) => true,
    };
    if should_write {
        tokio::fs::write(&path, LYRA_DESIGN_TOOLBOX_PY).await?;
    }
    Ok(path)
}

async fn run_node(
    program: &str,
    script_path: &PathBuf,
    action: &str,
    payload_arg: &str,
    timeout: Duration,
) -> Result<Value> {
    let mut command = Command::new(program);
    command
        .arg(script_path)
        .arg(action)
        .arg(payload_arg)
        .kill_on_drop(true);
    if std::env::var("LYRA_DESIGN_NODE_RUN_AS_NODE")
        .ok()
        .as_deref()
        == Some("1")
    {
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    if let Ok(node_paths) = std::env::var("LYRA_DESIGN_NODE_PATHS")
        && !node_paths.trim().is_empty()
    {
        command.env("NODE_PATH", node_paths);
    }
    run_command_output(command, "lyra_design node", action, timeout).await
}

async fn run_python(
    program: &str,
    script_path: &PathBuf,
    action: &str,
    payload_arg: &str,
    timeout: Duration,
) -> Result<Value> {
    let mut command = Command::new(program);
    command
        .arg(script_path)
        .arg(action)
        .arg(payload_arg)
        .kill_on_drop(true);
    run_command_output(command, "lyra_design", action, timeout).await
}

async fn run_command_output(
    mut command: Command,
    label: &str,
    action: &str,
    timeout: Duration,
) -> Result<Value> {
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .with_context(|| format!("{label} {action} timed out after {}ms", timeout.as_millis()))??;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let value: Value = serde_json::from_str(&stdout).with_context(|| {
        format!("{label} returned non-JSON output. stdout={stdout:?} stderr={stderr:?}")
    })?;

    if output.status.success() {
        return Ok(value);
    }

    let message = value
        .get("error")
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty())
        .unwrap_or("Lyra design reference service failed");
    if stderr.is_empty() {
        anyhow::bail!("{message}");
    }
    anyhow::bail!("{message}\n{stderr}");
}

fn render_lyra_design_output(action: &str, params: &LyraDesignInput, value: &Value) -> String {
    match action {
        "search_references" => render_search_output(params, value),
        "get_reference_details" => render_style_details(value),
        _ => value.to_string(),
    }
}

fn render_search_output(params: &LyraDesignInput, value: &Value) -> String {
    let query = params.query.as_deref().unwrap_or("").trim();
    let Some(results) = value.get("result").and_then(Value::as_array) else {
        return format!("No Lyra Design References results found for: {query}");
    };
    if results.is_empty() {
        return format!("No Lyra Design References results found for: {query}");
    }

    let mut output = format!("Lyra Design References results for: {query}\n\n");
    for (index, item) in results.iter().enumerate() {
        let title = item
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Unknown");
        let id = item.get("id").and_then(Value::as_str).unwrap_or("");
        output.push_str(&format!("{}. {}  id: `{}`\n", index + 1, title, id));
    }
    output.push_str("\nNext step: call `lyra_design` with action=`get_reference_details` and the selected `reference_id` before writing UI code.");
    output
}

fn render_style_details(value: &Value) -> String {
    let Some(result) = value.get("result").and_then(Value::as_object) else {
        return value.to_string();
    };
    let title = result
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Lyra Design Reference");
    let id = result.get("id").and_then(Value::as_str).unwrap_or("");
    let screenshot_url = result
        .get("screenshot_url")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut output = format!("# {title}\n\n- reference_id: `{id}`\n");
    if !screenshot_url.is_empty() {
        output.push_str(&format!("- screenshot: {screenshot_url}\n"));
    }
    output.push('\n');

    if let Some(tech_data) = result.get("tech_data").and_then(Value::as_object) {
        for tab_name in ["DESIGN.md", "Tailwind v4", "CSS Variables", "Design Tokens"] {
            if let Some(content) = tech_data.get(tab_name).and_then(Value::as_str) {
                output.push_str(&format!("## {tab_name}\n\n```text\n{content}\n```\n\n"));
            }
        }
    }
    output.push_str("Before writing UI code, present a Design Research Summary table that names this reference, selected tokens, adherence decisions, and implementation targets.");
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_output_prompts_details_next_step() {
        let params = LyraDesignInput {
            action: "search_references".to_string(),
            query: Some("linear".to_string()),
            reference_id: None,
            limit: None,
            headless: None,
            timeout_ms: None,
        };
        let value = json!({
            "ok": true,
            "result": [{"title": "Linear", "id": "linear"}]
        });

        let output = render_search_output(&params, &value);
        assert!(output.contains("Linear"));
        assert!(output.contains("get_reference_details"));
    }

    #[test]
    fn details_output_keeps_design_sections() {
        let value = json!({
            "ok": true,
            "result": {
                "id": "linear",
                "title": "Linear",
                "screenshot_url": "https://example.test/linear.png",
                "tech_data": {
                    "DESIGN.md": "Use restrained surfaces.",
                    "CSS Variables": ":root { --color-bg: #000; }"
                }
            }
        });

        let output = render_style_details(&value);
        assert!(output.contains("## DESIGN.md"));
        assert!(output.contains("## CSS Variables"));
        assert!(output.contains("Design Research Summary"));
    }
}
