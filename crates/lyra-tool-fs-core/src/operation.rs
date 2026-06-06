use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::error::ToolFsError;
use crate::model::{
    DEFAULT_TOOL_TIMEOUT_MS, MAX_TOOL_TIMEOUT_MS, TOOL_FS_SCHEMA_VERSION, ToolManifest,
};
use crate::registry::ToolFsRegistry;
use crate::schema::validate_args_against_schema;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOperationEnvelope {
    pub schema_version: u32,
    pub op_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub op: String,
    pub path: Option<String>,
    pub args: Value,
    pub tool_handle: Option<String>,
    pub policy_snapshot_id: Option<String>,
    pub permission_mode: String,
    pub trace_id: String,
    pub timeout_ms: Option<u64>,
    pub risk_context: Value,
    pub output_contract: Value,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOperationContext {
    pub session_id: String,
    pub turn_id: String,
    pub working_dir: Option<String>,
    pub active_tab_id: Option<String>,
    pub workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolTraceRecord {
    pub schema_version: u32,
    pub trace_id: String,
    pub op_id: String,
    pub runtime_turn_id: String,
    pub tool_path: Option<String>,
    pub phase: String,
    pub status: String,
    pub message: Option<String>,
    pub detail: Value,
    pub timestamp: String,
}

impl ToolOperationEnvelope {
    pub fn validate(&self, registry: &ToolFsRegistry) -> Result<Option<ToolManifest>, ToolFsError> {
        if self.schema_version != TOOL_FS_SCHEMA_VERSION {
            return Err(ToolFsError::new(
                "unsupported_schema_version",
                format!(
                    "Tool-FS operation schemaVersion {} is not supported.",
                    self.schema_version
                ),
                "Retry with the current Tool-FS operation envelope schema.",
            )
            .with_detail(json!({ "expectedSchemaVersion": TOOL_FS_SCHEMA_VERSION })));
        }
        if self.session_id.trim().is_empty() {
            return Err(ToolFsError::new(
                "missing_session",
                "Tool-FS operation is missing sessionId.",
                "Retry after creating or restoring an Agent session.",
            ));
        }
        if self.runtime_turn_id.trim().is_empty() {
            return Err(ToolFsError::new(
                "missing_runtime_turn",
                "Tool-FS operation is missing runtimeTurnId.",
                "Retry inside an active Agent runtime turn.",
            ));
        }
        if self.op.trim().is_empty() {
            return Err(ToolFsError::new(
                "missing_operation",
                "Tool-FS operation is missing op.",
                "Retry with list, read_doc, inspect, or run.",
            ));
        }
        if self
            .policy_snapshot_id
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err(ToolFsError::new(
                "missing_policy_snapshot",
                "Tool-FS operation is missing policySnapshotId.",
                "Retry after the runtime attaches the current policy snapshot.",
            ));
        }
        if !valid_permission_mode(&self.permission_mode) {
            return Err(ToolFsError::new(
                "invalid_permission_mode",
                format!(
                    "Tool-FS permissionMode is not supported: {}",
                    self.permission_mode
                ),
                "Retry with runtime_policy, ask, deny, read_only, or full_access.",
            )
            .with_detail(json!({ "permissionMode": self.permission_mode })));
        }
        if let Some(timeout_ms) = self.timeout_ms
            && !(1..=MAX_TOOL_TIMEOUT_MS).contains(&timeout_ms)
        {
            return Err(ToolFsError::new(
                "invalid_timeout",
                format!("Tool-FS timeoutMs must be between 1 and {MAX_TOOL_TIMEOUT_MS}."),
                "Retry with a valid timeoutMs or omit it.",
            )
            .with_detail(json!({ "timeoutMs": timeout_ms })));
        }
        if self
            .risk_context
            .get("cancellationRequested")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Err(ToolFsError::new(
                "operation_cancelled",
                "Tool-FS operation was cancelled before execution.",
                "Stop this tool call and wait for a new user turn.",
            ));
        }
        if !self.args.is_object() {
            return Err(ToolFsError::new(
                "invalid_tool_args",
                "Tool-FS args must be a JSON object.",
                "Retry with args as an object matching the inspected inputSchema.",
            )
            .with_detail(json!({ "args": self.args })));
        }

        match self.op.as_str() {
            "search" => Ok(None),
            "list" | "read_doc" => {
                if self
                    .path
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty())
                {
                    return Err(ToolFsError::new(
                        "tool_path_required",
                        format!("tool_fs_{} requires path.", self.op),
                        "Provide /tools or a concrete /tools path.",
                    ));
                }
                Ok(None)
            }
            "inspect" | "run" => {
                let manifest = self.resolve_target_manifest(registry)?;
                if self.op == "run" {
                    validate_args_against_schema(&manifest, &self.args)?;
                }
                Ok(Some(manifest))
            }
            other => Err(ToolFsError::new(
                "unknown_tool_fs_operation",
                format!("Unknown Tool-FS operation: {other}"),
                "Use search, list, read_doc, inspect, or run.",
            )),
        }
    }

    fn resolve_target_manifest(
        &self,
        registry: &ToolFsRegistry,
    ) -> Result<ToolManifest, ToolFsError> {
        registry.resolve_target(self.path.as_deref(), self.tool_handle.as_deref(), &self.op)
    }
}

fn valid_permission_mode(value: &str) -> bool {
    matches!(
        value.trim(),
        "runtime_policy"
            | "ask"
            | "deny"
            | "read_only"
            | "read-only"
            | "full_access"
            | "full-access"
    )
}

impl ToolTraceRecord {
    pub fn new(
        trace_id: impl Into<String>,
        op_id: impl Into<String>,
        runtime_turn_id: impl Into<String>,
        tool_path: Option<String>,
        phase: impl Into<String>,
        status: impl Into<String>,
        message: Option<String>,
        detail: Value,
        timestamp: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            trace_id: trace_id.into(),
            op_id: op_id.into(),
            runtime_turn_id: runtime_turn_id.into(),
            tool_path,
            phase: phase.into(),
            status: status.into(),
            message,
            detail,
            timestamp: timestamp.into(),
        }
    }
}

pub fn new_operation_envelope(
    manifest: &ToolManifest,
    args: Value,
    requested_handle: Option<String>,
    context: ToolOperationContext,
) -> ToolOperationEnvelope {
    let op_id = format!("tool-op-{}", Uuid::new_v4());
    ToolOperationEnvelope {
        schema_version: TOOL_FS_SCHEMA_VERSION,
        op_id: op_id.clone(),
        session_id: context.session_id,
        runtime_turn_id: context.turn_id,
        op: "run".to_string(),
        path: Some(manifest.path.clone()),
        args,
        tool_handle: requested_handle.or_else(|| manifest.handle.clone()),
        policy_snapshot_id: Some("runtime-default".to_string()),
        permission_mode: "runtime_policy".to_string(),
        trace_id: format!("trace-{op_id}"),
        timeout_ms: Some(DEFAULT_TOOL_TIMEOUT_MS),
        risk_context: json!({
            "workingDir": context.working_dir,
            "activeTabId": context.active_tab_id,
            "workspaceId": context.workspace_id,
        }),
        output_contract: json!({
            "kind": manifest.output_kind,
            "activityKind": manifest.activity_kind,
            "rendererHint": manifest.renderer_hint,
        }),
        created_at: String::new(),
    }
}
