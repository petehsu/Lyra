use serde_json::{json, Value};

use crate::agent::tools::AgentToolError;

fn is_placeholder_like_value(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return true;
    }
    let normalized = trimmed.to_lowercase();
    matches!(
        normalized.as_str(),
        "unknown"
            | "todo"
            | "tbd"
            | "n/a"
            | "none"
            | "null"
            | "undefined"
            | "?"
            | "??"
            | "待定"
            | "不确定"
    ) || normalized.contains("placeholder")
        || normalized.contains("fill_me")
}

fn find_uncertain_input_path(value: &Value, path: &str) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(raw) => {
            if is_placeholder_like_value(raw) {
                Some(path.to_string())
            } else {
                None
            }
        }
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(index, item)| find_uncertain_input_path(item, &format!("{path}[{index}]"))),
        Value::Object(map) => map
            .iter()
            .find_map(|(key, item)| find_uncertain_input_path(item, &format!("{path}.{key}"))),
        _ => None,
    }
}

fn is_uncertainty_gate_exempt_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "request_user_input" | "plan.update_draft" | "plan.submit_for_approval"
    )
}

pub(crate) fn maybe_build_uncertain_input_error(
    tool_name: &str,
    input: &Value,
) -> Option<AgentToolError> {
    if is_uncertainty_gate_exempt_tool(tool_name) {
        return None;
    }
    let uncertain_path = find_uncertain_input_path(input, "$")?;
    Some(AgentToolError::plan_question_required(
        "tool input contains unknown or placeholder values",
        json!({
            "questions": [
                {
                    "id": "missing_required_input",
                    "header": "Need Exact Input",
                    "question": format!(
                        "Tool `{tool_name}` has an uncertain value at `{uncertain_path}`. What exact value should be used?"
                    ),
                    "options": [
                        {
                            "label": "Provide exact value (Recommended)",
                            "description": "Use custom reply to provide the concrete value and continue."
                        },
                        {
                            "label": "Skip this action",
                            "description": "Do not run this tool and choose a different approach."
                        }
                    ]
                }
            ],
            "allowNote": true
        }),
    ))
}

/// Raw result from concurrent tool execution (no napi types).
pub(crate) struct RawToolExecResult {
    pub(crate) tool_result: Option<Value>,
    pub(crate) error_code: Option<String>,
    pub(crate) error_message: Option<String>,
    pub(crate) error_metadata: Option<Value>,
}

/// Execute tools concurrently in a pure-Rust context (no napi errors).
pub(crate) fn run_concurrent_tools(
    invocations: Vec<(String, Value, Option<String>)>,
) -> Vec<RawToolExecResult> {
    std::thread::scope(|s| {
        let threads: Vec<_> = invocations
            .iter()
            .map(|(name, input, proj_root)| {
                let name = name.clone();
                let input = input.clone();
                let proj_root = proj_root.clone();
                s.spawn(move || {
                    match crate::agent::tools::execute_readonly_tool(
                        &name,
                        &input,
                        proj_root.as_deref(),
                    ) {
                        Ok(value) => RawToolExecResult {
                            tool_result: Some(value),
                            error_code: None,
                            error_message: None,
                            error_metadata: None,
                        },
                        Err(err) => RawToolExecResult {
                            tool_result: None,
                            error_code: Some(err.code),
                            error_message: Some(err.message),
                            error_metadata: err.metadata,
                        },
                    }
                })
            })
            .collect();

        threads
            .into_iter()
            .map(|t| {
                t.join().unwrap_or_else(|_| RawToolExecResult {
                    tool_result: None,
                    error_code: Some("AGENT_TOOL_EXEC_FAILED".to_string()),
                    error_message: Some("concurrent tool execution panicked".to_string()),
                    error_metadata: None,
                })
            })
            .collect()
    })
}
