use serde_json::Value;

use super::super::catalog::ToolExecutionMode;
use super::super::external::{
    ExternalToolApprovalMode, ExternalToolExecutionContext, ExternalToolSideEffects,
};

#[derive(Clone, Debug)]
pub struct HostToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Value,
    pub execution_mode: ToolExecutionMode,
    pub approval_mode: ExternalToolApprovalMode,
    pub side_effects: ExternalToolSideEffects,
    pub host_method: String,
}

#[derive(Clone, Debug, Default)]
pub struct HostToolCallContext {
    pub storage_root: Option<String>,
    pub project_root: Option<String>,
    pub agent_session_id: Option<String>,
    pub agent_turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub plan_mode: bool,
}

impl From<&ExternalToolExecutionContext> for HostToolCallContext {
    fn from(value: &ExternalToolExecutionContext) -> Self {
        Self {
            storage_root: value.storage_root.clone(),
            project_root: value.project_root.clone(),
            agent_session_id: value.agent_session_id.clone(),
            agent_turn_id: value.agent_turn_id.clone(),
            tool_call_id: value.tool_call_id.clone(),
            plan_mode: value.plan_mode,
        }
    }
}
