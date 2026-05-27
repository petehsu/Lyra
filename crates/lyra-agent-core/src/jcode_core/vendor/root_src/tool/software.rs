use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct SoftwareTool;

impl SoftwareTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
struct SoftwareInput {
    action: String,
    #[serde(default)]
    software_id: Option<String>,
    #[serde(default)]
    action_id: Option<String>,
    #[serde(default)]
    input: Option<Value>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    include_schemas: Option<bool>,
}

#[async_trait]
impl Tool for SoftwareTool {
    fn name(&self) -> &str {
        "software"
    }

    fn description(&self) -> &str {
        "Discover and invoke Lyra software capabilities through LCP. Use list first, inspect a software/action before invoke, then invoke only the selected action."
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
                        "enum": ["list", "inspect", "invoke"],
                        "description": "Use list for compact discovery, inspect for full schemas, invoke to execute one capability."
                    },
                    "software_id": {
                        "type": "string",
                        "description": "Software id returned by list."
                    },
                    "action_id": {
                        "type": "string",
                        "description": "Action id returned by list or inspect."
                    },
                    "input": {
                        "type": "object",
                        "description": "Structured action input."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this invocation is needed. Required for risky invoke requests."
                    },
                    "include_schemas": {
                        "type": "boolean",
                        "description": "For list, include action input/output schemas."
                    }
                }),
            ),
        ]))
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let input: SoftwareInput = serde_json::from_value(input)?;
        match input.action.as_str() {
            "list" => {
                let result = call_software_host(
                    "software.listCapabilities",
                    json!({ "includeSchemas": input.include_schemas.unwrap_or(false) }),
                )?;
                Ok(render_software_output("list", result))
            }
            "inspect" => {
                let result = inspect_action(&input, false)?;
                Ok(render_software_output("inspect", result))
            }
            "invoke" => {
                let inspected = inspect_action(&input, true)?;
                maybe_request_permission(&ctx, &input, &inspected)?;
                let result =
                    call_software_host("software.invokeCapability", invoke_payload(&input)?)?;
                Ok(render_software_output("invoke", result))
            }
            other => anyhow::bail!("Unsupported software action: {}", other),
        }
    }
}

fn call_software_host(method: &str, payload: Value) -> Result<Value> {
    crate::lyra_runtime::call_host_capability(method, payload)
        .map_err(|error| anyhow::anyhow!("Lyra software host capability failed: {}", error))
}

fn inspect_action(input: &SoftwareInput, require_action: bool) -> Result<Value> {
    let mut payload = Map::new();
    payload.insert("softwareId".into(), json!(required_software_id(input)?));
    if require_action {
        payload.insert("actionId".into(), json!(required_action_id(input)?));
    } else if let Some(action_id) = input
        .action_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        payload.insert("actionId".into(), json!(action_id));
    }
    call_software_host("software.inspectCapability", Value::Object(payload))
}

fn invoke_payload(input: &SoftwareInput) -> Result<Value> {
    let mut payload = Map::new();
    payload.insert("softwareId".into(), json!(required_software_id(input)?));
    payload.insert("actionId".into(), json!(required_action_id(input)?));
    if let Some(value) = &input.input {
        payload.insert("input".into(), value.clone());
    }
    if let Some(reason) = input
        .reason
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        payload.insert("reason".into(), json!(reason));
    }
    Ok(Value::Object(payload))
}

fn required_software_id(input: &SoftwareInput) -> Result<&str> {
    input
        .software_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("software_id is required for {}", input.action))
}

fn required_action_id(input: &SoftwareInput) -> Result<&str> {
    input
        .action_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("action_id is required for {}", input.action))
}

fn maybe_request_permission(
    ctx: &ToolContext,
    input: &SoftwareInput,
    inspected: &Value,
) -> Result<()> {
    let risk = inspected
        .get("action")
        .and_then(|action| action.get("risk"))
        .and_then(Value::as_str)
        .unwrap_or("read");
    if !requires_permission(risk) {
        return Ok(());
    }
    let software_title = inspected
        .get("software")
        .and_then(|software| software.get("title"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| input.software_id.as_deref().unwrap_or("software"));
    let action_title = inspected
        .get("action")
        .and_then(|action| action.get("title"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| input.action_id.as_deref().unwrap_or("action"));
    let description = format!(
        "Invoke Lyra software capability '{} / {}' with risk '{}'.{}",
        software_title,
        action_title,
        risk,
        input
            .reason
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|reason| format!(" Reason: {}", reason))
            .unwrap_or_default()
    );
    let allowed =
        crate::lyra_runtime::ask_user_permission(&ctx.session_id, "software.invoke", &description);
    if !allowed {
        anyhow::bail!("User denied software capability invocation");
    }
    Ok(())
}

fn requires_permission(risk: &str) -> bool {
    matches!(risk, "write" | "external" | "destructive")
}

fn render_software_output(action: &str, result: Value) -> ToolOutput {
    let body = match action {
        "list" => format_software_list(&result),
        "inspect" => format_software_inspection(&result),
        "invoke" => format_software_invoke(&result),
        _ => serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
    };
    ToolOutput::new(body)
        .with_title(format!("software {}", action))
        .with_metadata(result)
}

fn format_software_list(result: &Value) -> String {
    let Some(software) = result.get("software").and_then(Value::as_array) else {
        return serde_json::to_string_pretty(result).unwrap_or_default();
    };
    if software.is_empty() {
        return "No Lyra software capabilities are registered.".to_string();
    }
    software
        .iter()
        .map(|entry| {
            let id = entry.get("id").and_then(Value::as_str).unwrap_or("-");
            let title = entry.get("title").and_then(Value::as_str).unwrap_or(id);
            let actions = entry
                .get("actions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|action| {
                            let action_id = action.get("id").and_then(Value::as_str)?;
                            let risk = action.get("risk").and_then(Value::as_str).unwrap_or("read");
                            Some(format!("{action_id}:{risk}"))
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            format!("- {title} [{id}] actions={actions}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_software_inspection(result: &Value) -> String {
    let software = result.get("software").unwrap_or(&Value::Null);
    let title = software
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Software");
    let id = software.get("id").and_then(Value::as_str).unwrap_or("-");
    let handler = result
        .get("handlerRegistered")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if let Some(action) = result.get("action") {
        let action_id = action.get("id").and_then(Value::as_str).unwrap_or("-");
        let action_title = action
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(action_id);
        let risk = action.get("risk").and_then(Value::as_str).unwrap_or("read");
        return format!(
            "{title} [{id}]\n- {action_title} [{action_id}] risk={risk} registered={handler}"
        );
    }
    format!("{title} [{id}] registered={handler}")
}

fn format_software_invoke(result: &Value) -> String {
    let software_id = result
        .get("softwareId")
        .and_then(Value::as_str)
        .unwrap_or("-");
    let action_id = result
        .get("actionId")
        .and_then(Value::as_str)
        .unwrap_or("-");
    let output = result.get("output").unwrap_or(&Value::Null);
    if output.is_null() {
        return format!("Invoked {software_id} / {action_id}.");
    }
    format!(
        "Invoked {software_id} / {action_id}.\n{}",
        serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_exposes_progressive_actions() {
        let schema = SoftwareTool::new().parameters_schema();
        let actions = schema["properties"]["action"]["enum"]
            .as_array()
            .expect("action enum");
        assert!(actions.contains(&json!("list")));
        assert!(actions.contains(&json!("inspect")));
        assert!(actions.contains(&json!("invoke")));
    }

    #[test]
    fn high_risk_actions_require_permission() {
        assert!(!requires_permission("read"));
        assert!(!requires_permission("navigate"));
        assert!(requires_permission("write"));
        assert!(requires_permission("external"));
        assert!(requires_permission("destructive"));
    }

    #[test]
    fn invoke_payload_uses_camel_case_host_contract() {
        let input = SoftwareInput {
            action: "invoke".to_string(),
            software_id: Some("file-manager".to_string()),
            action_id: Some("file-manager.openPath".to_string()),
            input: Some(json!({ "path": "/tmp" })),
            reason: Some("open project".to_string()),
            include_schemas: None,
        };
        let payload = invoke_payload(&input).expect("payload");
        assert_eq!(payload["softwareId"], "file-manager");
        assert_eq!(payload["actionId"], "file-manager.openPath");
        assert_eq!(payload["input"]["path"], "/tmp");
        assert_eq!(payload["reason"], "open project");
    }
}
