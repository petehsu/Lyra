use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use lyra_sandbox::permissions::PermissionsStore;
use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::provider::types::AgentToolDefinition;

use super::{catalog::ToolExecutionMode, AgentToolError, ToolExecutionContext};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalToolApprovalMode {
    Auto,
    Ask,
    Deny,
}

impl ExternalToolApprovalMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Ask => "ask",
            Self::Deny => "deny",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalToolSideEffectLevel {
    ReadOnly,
    NetworkRead,
    SessionMutation,
    WorkspaceWrite,
    ExternalMutation,
}

impl ExternalToolSideEffectLevel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::NetworkRead => "network_read",
            Self::SessionMutation => "session_mutation",
            Self::WorkspaceWrite => "workspace_write",
            Self::ExternalMutation => "external_mutation",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ExternalToolSideEffects {
    pub level: ExternalToolSideEffectLevel,
    pub mutates_workspace: bool,
    pub mutates_memory: bool,
    pub mutates_external_systems: bool,
    pub mutates_session_state: bool,
    pub opens_interactive_session: bool,
    pub reads_network: bool,
}

impl ExternalToolSideEffects {
    pub const fn read_only() -> Self {
        Self {
            level: ExternalToolSideEffectLevel::ReadOnly,
            mutates_workspace: false,
            mutates_memory: false,
            mutates_external_systems: false,
            mutates_session_state: false,
            opens_interactive_session: false,
            reads_network: false,
        }
    }

    pub const fn network_read() -> Self {
        Self {
            level: ExternalToolSideEffectLevel::NetworkRead,
            mutates_workspace: false,
            mutates_memory: false,
            mutates_external_systems: false,
            mutates_session_state: false,
            opens_interactive_session: false,
            reads_network: true,
        }
    }

    pub const fn workspace_write() -> Self {
        Self {
            level: ExternalToolSideEffectLevel::WorkspaceWrite,
            mutates_workspace: true,
            mutates_memory: false,
            mutates_external_systems: false,
            mutates_session_state: false,
            opens_interactive_session: false,
            reads_network: false,
        }
    }

    pub const fn session_mutation() -> Self {
        Self {
            level: ExternalToolSideEffectLevel::SessionMutation,
            mutates_workspace: false,
            mutates_memory: false,
            mutates_external_systems: false,
            mutates_session_state: true,
            opens_interactive_session: false,
            reads_network: false,
        }
    }

    pub const fn external_mutation() -> Self {
        Self {
            level: ExternalToolSideEffectLevel::ExternalMutation,
            mutates_workspace: false,
            mutates_memory: false,
            mutates_external_systems: true,
            mutates_session_state: false,
            opens_interactive_session: false,
            reads_network: false,
        }
    }
}

impl Default for ExternalToolSideEffects {
    fn default() -> Self {
        Self::external_mutation()
    }
}

#[derive(Clone, Debug)]
pub struct ExternalToolMetadata {
    pub output_schema: Value,
    pub approval_mode: ExternalToolApprovalMode,
    pub side_effects: ExternalToolSideEffects,
}

impl ExternalToolMetadata {
    pub fn read_only_json() -> Self {
        Self {
            output_schema: json!({ "type": "object" }),
            approval_mode: ExternalToolApprovalMode::Auto,
            side_effects: ExternalToolSideEffects::read_only(),
        }
    }
}

impl Default for ExternalToolMetadata {
    fn default() -> Self {
        Self {
            output_schema: json!({ "type": "object" }),
            approval_mode: ExternalToolApprovalMode::Ask,
            side_effects: ExternalToolSideEffects::default(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ExternalToolExecutionContext {
    pub storage_root: Option<String>,
    pub project_root: Option<String>,
    pub agent_session_id: Option<String>,
    pub agent_turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub plan_mode: bool,
}

impl From<ToolExecutionContext<'_>> for ExternalToolExecutionContext {
    fn from(value: ToolExecutionContext<'_>) -> Self {
        Self {
            storage_root: value.storage_root.map(ToString::to_string),
            project_root: value.project_root.map(ToString::to_string),
            agent_session_id: value.agent_session_id.map(ToString::to_string),
            agent_turn_id: value.agent_turn_id.map(ToString::to_string),
            tool_call_id: value.tool_call_id.map(ToString::to_string),
            plan_mode: value.plan_mode,
        }
    }
}

#[derive(Clone)]
pub struct RegisteredExternalTool {
    pub definition: AgentToolDefinition,
    pub metadata: ExternalToolMetadata,
    pub executor: ExternalToolExecutor,
    pub execution_mode: ToolExecutionMode,
}

pub type ExternalToolExecutor = Arc<
    dyn Fn(&Value, &ExternalToolExecutionContext) -> Result<Value, AgentToolError> + Send + Sync,
>;

static EXTERNAL_TOOLS: Lazy<Mutex<Vec<RegisteredExternalTool>>> =
    Lazy::new(|| Mutex::new(Vec::new()));
static APPROVED_ONCE_EXTERNAL_TOOLS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn approval_pattern_for_tool(name: &str) -> String {
    format!("external_tool:{name}")
}

fn side_effect_summary(side_effects: &ExternalToolSideEffects) -> String {
    let mut parts = vec![format!("level={}", side_effects.level.as_str())];
    if side_effects.mutates_workspace {
        parts.push("workspace-write".to_string());
    }
    if side_effects.mutates_memory {
        parts.push("memory-write".to_string());
    }
    if side_effects.mutates_external_systems {
        parts.push("external-mutation".to_string());
    }
    if side_effects.mutates_session_state {
        parts.push("session-mutation".to_string());
    }
    if side_effects.opens_interactive_session {
        parts.push("interactive-session".to_string());
    }
    if side_effects.reads_network {
        parts.push("network-read".to_string());
    }
    parts.join(", ")
}

fn decorate_description(tool: &RegisteredExternalTool) -> String {
    format!(
        "{}\n\nExecution mode: {}. Approval mode: {}. Side effects: {}.",
        tool.definition.description,
        tool.execution_mode.as_str(),
        tool.metadata.approval_mode.as_str(),
        side_effect_summary(&tool.metadata.side_effects)
    )
}

pub(super) fn decorated_tool_definition(tool: &RegisteredExternalTool) -> AgentToolDefinition {
    AgentToolDefinition {
        name: tool.definition.name.clone(),
        description: decorate_description(tool),
        input_schema: tool.definition.input_schema.clone(),
    }
}

fn build_approval_metadata(tool: &RegisteredExternalTool) -> Value {
    let approval_pattern = approval_pattern_for_tool(&tool.definition.name);
    json!({
        "approvalKind": "external_tool",
        "toolName": tool.definition.name,
        "approvalPattern": approval_pattern,
        "executionMode": tool.execution_mode.as_str(),
        "approvalMode": tool.metadata.approval_mode.as_str(),
        "inputSchema": tool.definition.input_schema,
        "outputSchema": tool.metadata.output_schema,
        "sideEffects": {
            "level": tool.metadata.side_effects.level.as_str(),
            "mutatesWorkspace": tool.metadata.side_effects.mutates_workspace,
            "mutatesMemory": tool.metadata.side_effects.mutates_memory,
            "mutatesExternalSystems": tool.metadata.side_effects.mutates_external_systems,
            "mutatesSessionState": tool.metadata.side_effects.mutates_session_state,
            "opensInteractiveSession": tool.metadata.side_effects.opens_interactive_session,
            "readsNetwork": tool.metadata.side_effects.reads_network,
        }
    })
}

fn take_one_time_approval(tool_call_id: Option<&str>, approval_pattern: &str) -> bool {
    let Some(tool_call_id) = tool_call_id else {
        return false;
    };
    let Ok(mut guard) = APPROVED_ONCE_EXTERNAL_TOOLS.lock() else {
        return false;
    };
    let Some(pattern) = guard.get(tool_call_id).cloned() else {
        return false;
    };
    if pattern == approval_pattern {
        guard.remove(tool_call_id);
        true
    } else {
        false
    }
}

fn is_persisted_allowed(project_root: Option<&str>, approval_pattern: &str) -> bool {
    project_root
        .map(PermissionsStore::load)
        .is_some_and(|store| store.is_allowed(approval_pattern))
}

fn is_persisted_denied(project_root: Option<&str>, approval_pattern: &str) -> bool {
    project_root
        .map(PermissionsStore::load)
        .is_some_and(|store| store.is_denied(approval_pattern))
}

fn is_persisted_ask(project_root: Option<&str>, approval_pattern: &str) -> bool {
    project_root
        .map(PermissionsStore::load)
        .is_some_and(|store| store.requires_ask(approval_pattern))
}

pub fn register_external_tool(tool: RegisteredExternalTool) {
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.retain(|t| t.definition.name != tool.definition.name);
        tools.push(tool);
    }
}

pub fn unregister_external_tool(name: &str) {
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.retain(|t| t.definition.name != name);
    }
}

pub fn unregister_mcp_server_tools(server_id: &str) {
    let prefix = format!("mcp:{server_id}/");
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.retain(|t| !t.definition.name.starts_with(&prefix));
    }
}

pub fn clear_external_tools() {
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.clear();
    }
    if let Ok(mut approvals) = APPROVED_ONCE_EXTERNAL_TOOLS.lock() {
        approvals.clear();
    }
}

pub(super) fn registered_external_tools() -> Vec<RegisteredExternalTool> {
    EXTERNAL_TOOLS
        .lock()
        .map(|tools| tools.clone())
        .unwrap_or_default()
}

pub fn external_tool_execution_mode(name: &str) -> Option<ToolExecutionMode> {
    EXTERNAL_TOOLS.lock().ok().and_then(|tools| {
        tools
            .iter()
            .find(|tool| tool.definition.name == name)
            .map(|tool| tool.execution_mode)
    })
}

pub fn grant_approval_once(tool_call_id: &str, metadata: &Value) {
    let approval_pattern = metadata
        .get("approvalPattern")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            metadata
                .get("toolName")
                .and_then(Value::as_str)
                .map(approval_pattern_for_tool)
        });
    if let Some(approval_pattern) = approval_pattern {
        if let Ok(mut guard) = APPROVED_ONCE_EXTERNAL_TOOLS.lock() {
            guard.insert(tool_call_id.to_string(), approval_pattern);
        }
    }
}

pub fn try_execute_external_tool(
    name: &str,
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Option<Result<Value, AgentToolError>> {
    let tool = EXTERNAL_TOOLS
        .lock()
        .ok()
        .and_then(|tools| tools.iter().find(|t| t.definition.name == name).cloned())?;
    let approval_pattern = approval_pattern_for_tool(&tool.definition.name);
    let approved_once = take_one_time_approval(context.tool_call_id, &approval_pattern);
    let requires_ask = if is_persisted_ask(context.project_root, &approval_pattern) {
        true
    } else if approved_once || is_persisted_allowed(context.project_root, &approval_pattern) {
        false
    } else if is_persisted_denied(context.project_root, &approval_pattern) {
        return Some(Err(AgentToolError::exec_failed(format!(
            "external tool denied by policy: {}",
            tool.definition.name
        ))));
    } else {
        matches!(tool.metadata.approval_mode, ExternalToolApprovalMode::Ask)
    };

    if matches!(tool.metadata.approval_mode, ExternalToolApprovalMode::Deny)
        && !approved_once
        && !is_persisted_allowed(context.project_root, &approval_pattern)
    {
        return Some(Err(AgentToolError::exec_failed(format!(
            "external tool is disabled by policy: {}",
            tool.definition.name
        ))));
    }

    if requires_ask {
        return Some(Err(AgentToolError::approval_required(
            format!(
                "external tool requires user approval: {}",
                tool.definition.name
            ),
            build_approval_metadata(&tool),
        )));
    }

    let execution_context = ExternalToolExecutionContext::from(context);
    Some((tool.executor)(input, &execution_context))
}

pub fn render_mcp_tools_prompt_json() -> String {
    let tools = EXTERNAL_TOOLS
        .lock()
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.definition.name.starts_with("mcp:"))
                .map(|entry| {
                    json!({
                        "name": entry.definition.name,
                        "description": entry.definition.description,
                        "inputSchema": entry.definition.input_schema,
                        "outputSchema": entry.metadata.output_schema,
                        "executionMode": entry.execution_mode.as_str(),
                        "approvalMode": entry.metadata.approval_mode.as_str(),
                        "sideEffects": {
                            "level": entry.metadata.side_effects.level.as_str(),
                            "mutatesWorkspace": entry.metadata.side_effects.mutates_workspace,
                            "mutatesMemory": entry.metadata.side_effects.mutates_memory,
                            "mutatesExternalSystems": entry
                                .metadata
                                .side_effects
                                .mutates_external_systems,
                            "mutatesSessionState": entry
                                .metadata
                                .side_effects
                                .mutates_session_state,
                            "opensInteractiveSession": entry
                                .metadata
                                .side_effects
                                .opens_interactive_session,
                            "readsNetwork": entry.metadata.side_effects.reads_network,
                        }
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if tools.is_empty() {
        return "[]".to_string();
    }
    serde_json::to_string_pretty(&tools).unwrap_or_else(|_| "[]".to_string())
}
