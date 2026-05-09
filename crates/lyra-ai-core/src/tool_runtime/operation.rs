use crate::tool_runtime::catalog;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub const TOOL_SCHEMA_VERSION: &str = "v1";
pub const TOOL_OPERATION_KIND: &str = "tool_operation";
pub const TOOL_WORKSPACE_REQUIRED: &str = "TOOL_WORKSPACE_REQUIRED";
pub const TOOL_INSPECT_REQUIRED: &str = "TOOL_INSPECT_REQUIRED";
pub const TOOL_INVALID_ARGUMENT: &str = "TOOL_INVALID_ARGUMENT";
pub const TOOL_PATH_NOT_FOUND: &str = "TOOL_PATH_NOT_FOUND";
pub const TOOL_PATH_OUTSIDE_WORKSPACE: &str = "TOOL_PATH_OUTSIDE_WORKSPACE";
pub const TOOL_PATH_NOT_FILE: &str = "TOOL_PATH_NOT_FILE";
pub const TOOL_PATH_NOT_DIRECTORY: &str = "TOOL_PATH_NOT_DIRECTORY";
pub const TOOL_UNSUPPORTED_ENCODING: &str = "TOOL_UNSUPPORTED_ENCODING";
pub const TOOL_GIT_UNAVAILABLE: &str = "TOOL_GIT_UNAVAILABLE";
pub const TOOL_GIT_NOT_REPOSITORY: &str = "TOOL_GIT_NOT_REPOSITORY";
pub const TOOL_EXECUTION_FAILED: &str = "TOOL_EXECUTION_FAILED";
pub const TOOL_PATCH_INVALID: &str = "TOOL_PATCH_INVALID";
pub const TOOL_APPROVAL_REQUIRED: &str = "TOOL_APPROVAL_REQUIRED";
pub const TOOL_APPROVAL_DENIED: &str = "TOOL_APPROVAL_DENIED";
pub const TOOL_APPROVAL_NOT_PENDING: &str = "TOOL_APPROVAL_NOT_PENDING";
pub const TOOL_APPROVAL_UNSUPPORTED: &str = "TOOL_APPROVAL_UNSUPPORTED";
pub const TOOL_PATCH_ALREADY_APPLIED: &str = "TOOL_PATCH_ALREADY_APPLIED";
pub const TOOL_PATCH_ALREADY_ROLLED_BACK: &str = "TOOL_PATCH_ALREADY_ROLLED_BACK";
pub const TOOL_ROLLBACK_UNSAFE: &str = "TOOL_ROLLBACK_UNSAFE";
pub const TOOL_COMMAND_REJECTED: &str = "TOOL_COMMAND_REJECTED";
pub const TOOL_COMMAND_TIMEOUT: &str = "TOOL_COMMAND_TIMEOUT";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolFsOp {
    List,
    ReadDoc,
    Inspect,
    Run,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOperationEnvelope {
    pub schema_version: String,
    pub kind: String,
    pub op_id: String,
    pub op: ToolFsOp,
    pub path: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolResultStatus {
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEnvelope {
    pub schema_version: String,
    pub op_id: String,
    pub op: ToolFsOp,
    pub path: String,
    pub status: ToolResultStatus,
    pub summary: String,
    pub content: String,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

impl ToolResultEnvelope {
    pub fn completed(
        operation: &ToolOperationEnvelope,
        summary: impl Into<String>,
        content: impl Into<String>,
        truncated: bool,
    ) -> Self {
        Self {
            schema_version: TOOL_SCHEMA_VERSION.to_string(),
            op_id: operation.op_id.clone(),
            op: operation.op.clone(),
            path: operation.path.clone(),
            status: ToolResultStatus::Completed,
            summary: summary.into(),
            content: content.into(),
            truncated,
            result_ref: None,
            metadata: None,
            error_code: None,
            error_message: None,
        }
    }

    pub fn failed(
        operation: &ToolOperationEnvelope,
        error_code: impl Into<String>,
        error_message: impl Into<String>,
    ) -> Self {
        let error_code = error_code.into();
        let error_message = error_message.into();
        Self {
            schema_version: TOOL_SCHEMA_VERSION.to_string(),
            op_id: operation.op_id.clone(),
            op: operation.op.clone(),
            path: operation.path.clone(),
            status: ToolResultStatus::Failed,
            summary: format!(
                "{} {:?} failed: {}",
                operation.path, operation.op, error_message
            ),
            content: String::new(),
            truncated: false,
            result_ref: None,
            metadata: None,
            error_code: Some(error_code),
            error_message: Some(error_message),
        }
    }
}

#[derive(Debug)]
pub struct ToolRuntimeError {
    pub code: &'static str,
    pub message: String,
}

impl fmt::Display for ToolRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ToolRuntimeError {}

pub fn tool_error(code: &'static str, message: impl Into<String>) -> anyhow::Error {
    ToolRuntimeError {
        code,
        message: message.into(),
    }
    .into()
}

pub fn tool_error_code(error: &anyhow::Error, fallback: &'static str) -> &'static str {
    error
        .downcast_ref::<ToolRuntimeError>()
        .map(|error| error.code)
        .unwrap_or(fallback)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolOperationParseError {
    InvalidJson(String),
    InvalidEnvelope(String),
}

impl fmt::Display for ToolOperationParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ToolOperationParseError::InvalidJson(message) => {
                write!(f, "invalid tool JSON: {message}")
            }
            ToolOperationParseError::InvalidEnvelope(message) => {
                write!(f, "invalid tool envelope: {message}")
            }
        }
    }
}

impl std::error::Error for ToolOperationParseError {}

pub fn parse_tool_operation(
    text: &str,
) -> std::result::Result<Option<ToolOperationEnvelope>, ToolOperationParseError> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.starts_with('{') == false {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(trimmed)
        .map_err(|error| ToolOperationParseError::InvalidJson(error.to_string()))?;
    let Some(kind) = value.get("kind").and_then(Value::as_str) else {
        return Ok(None);
    };
    if kind != TOOL_OPERATION_KIND {
        return Ok(None);
    }
    let operation: ToolOperationEnvelope = serde_json::from_value(value)
        .map_err(|error| ToolOperationParseError::InvalidEnvelope(error.to_string()))?;
    validate_operation(&operation)
        .map_err(|error| ToolOperationParseError::InvalidEnvelope(error.to_string()))?;
    Ok(Some(operation))
}

pub fn tool_result_chat_message(result: &ToolResultEnvelope) -> Result<String> {
    Ok(format!(
        "Runtime ToolFS result. Use this as the only evidence for claims about workspace files, code, git state, or tools.\n{}",
        serde_json::to_string(result)?
    ))
}

fn validate_operation(operation: &ToolOperationEnvelope) -> Result<()> {
    if operation.schema_version != TOOL_SCHEMA_VERSION {
        return Err(anyhow!("schemaVersion must be v1"));
    }
    if operation.kind != TOOL_OPERATION_KIND {
        return Err(anyhow!("kind must be tool_operation"));
    }
    if operation.op_id.trim().is_empty() {
        return Err(anyhow!("opId is required"));
    }
    if operation.path.trim().is_empty() {
        return Err(anyhow!("path is required"));
    }
    if operation.path.starts_with("/tools") == false {
        return Err(anyhow!("path must be under /tools"));
    }
    if operation.args.is_null() == false && operation.args.is_object() == false {
        return Err(anyhow!("args must be an object"));
    }
    catalog::validate_operation(operation)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_accepts_strict_toolfs_operation_json() {
        let parsed = parse_tool_operation(
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op1","op":"inspect","path":"/tools/filesystem/read_file"}"#,
        )
        .expect("parse")
        .expect("tool op");

        assert_eq!(parsed.op_id, "op1");
        assert_eq!(parsed.op, ToolFsOp::Inspect);
        assert_eq!(parsed.path, "/tools/filesystem/read_file");
    }

    #[test]
    fn parser_does_not_extract_markdown_tool_json() {
        let parsed = parse_tool_operation(
            "```json\n{\"schemaVersion\":\"v1\",\"kind\":\"tool_operation\"}\n```",
        )
        .expect("parse");

        assert!(parsed.is_none());
    }

    #[test]
    fn parser_rejects_partial_json_and_direct_legacy_tools() {
        assert!(parse_tool_operation(
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op1""#
        )
        .is_err());
        assert!(parse_tool_operation(
            r#"{"schemaVersion":"v1","kind":"tool_operation","operationId":"op1","toolName":"filesystem.read_file","arguments":{"path":"Cargo.toml"}}"#
        )
        .is_err());
        assert!(parse_tool_operation(
            r#"{"schemaVersion":"v1","kind":"tool_operation","opId":"op1","op":"run","path":"/tools/filesystem/read_file","args":{"path":"Cargo.toml","extra":true}}"#
        )
        .is_err());
    }
}
