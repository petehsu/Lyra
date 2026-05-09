mod create_directory;
mod delete_path;
mod edit_file;
mod fetch_url;
mod find_path;
mod git_diff;
mod git_status;
mod list_directory;
mod mcp;
mod move_path;
mod open_clarification_panel;
mod permissions;
mod permissions_hardcoded;
mod read_file;
mod search_text;
mod terminal;
mod update_plan;
mod web_search;
mod write_file;

use crate::model_gateway::ToolDefinition;
use crate::tool_runtime::{
    execute_tool, ToolExecutionContext, ToolFsOp, ToolOperationEnvelope, ToolResultEnvelope,
};
use anyhow::{anyhow, Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

pub use create_directory::CreateDirectoryTool;
pub use delete_path::DeletePathTool;
pub use edit_file::EditFileTool;
pub use fetch_url::FetchUrlTool;
pub use find_path::FindPathTool;
pub use git_diff::GitDiffTool;
pub use git_status::GitStatusTool;
pub use list_directory::ListDirectoryTool;
pub use mcp::{mcp_tool_definitions, mcp_tool_operation_path, resolve_mcp_tool_ref, run_mcp_tool};
pub use move_path::MovePathTool;
pub use open_clarification_panel::{
    OpenClarificationOptionInput, OpenClarificationPanelInput, OpenClarificationPanelTool,
};
pub use permissions::{
    decide_tool_permission, ToolPermissionDecision, ToolPermissionPolicy, ToolPermissionRuleSet,
};
pub use read_file::ReadFileTool;
pub use search_text::SearchTextTool;
pub use terminal::TerminalTool;
pub use update_plan::UpdatePlanTool;
pub use web_search::WebSearchTool;
pub use write_file::WriteFileTool;

#[derive(Clone, Debug)]
pub struct ToolContext {
    execution: ToolExecutionContext,
    op_id_prefix: String,
    permission_policy: ToolPermissionPolicy,
}

impl ToolContext {
    pub fn new(workspace_root: Option<String>) -> Self {
        Self {
            execution: ToolExecutionContext { workspace_root },
            op_id_prefix: "agent_tool".to_string(),
            permission_policy: ToolPermissionPolicy::default(),
        }
    }

    pub fn with_op_id_prefix(mut self, op_id_prefix: impl Into<String>) -> Self {
        self.op_id_prefix = op_id_prefix.into();
        self
    }

    pub fn execution(&self) -> &ToolExecutionContext {
        &self.execution
    }

    pub fn permission_policy(&self) -> &ToolPermissionPolicy {
        &self.permission_policy
    }

    pub fn with_permission_policy(mut self, permission_policy: ToolPermissionPolicy) -> Self {
        self.permission_policy = permission_policy;
        self
    }

    pub fn operation(&self, path: &str, args: Value) -> ToolOperationEnvelope {
        ToolOperationEnvelope {
            schema_version: "v1".to_string(),
            kind: "tool_operation".to_string(),
            op_id: format!("{}_{}", self.op_id_prefix, sanitized_tool_id(path)),
            op: ToolFsOp::Run,
            path: path.to_string(),
            args,
        }
    }

    pub fn run_tool_path<I: Serialize>(&self, path: &str, input: &I) -> Result<ToolResultEnvelope> {
        let args = serde_json::to_value(input).context("failed to serialize tool input")?;
        let operation = self.operation(path, args);
        Ok(execute_tool(&self.execution, &operation))
    }
}

pub trait AgentTool: Send + Sync {
    const NAME: &'static str;
    type Input: DeserializeOwned + JsonSchema + Serialize + Send + 'static;
    type Output: Serialize + Send + 'static;

    fn description() -> &'static str;

    fn input_schema() -> Value {
        Self::Input::json_schema()
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output>;
}

pub trait JsonSchema {
    fn json_schema() -> Value;
}

pub(crate) fn object_schema(properties: Vec<(&str, Value)>, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": properties
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect::<serde_json::Map<_, _>>(),
        "required": required,
    })
}

pub(crate) fn string_schema(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub(crate) fn bool_schema(description: &str) -> Value {
    json!({ "type": "boolean", "description": description })
}

pub(crate) fn usize_schema(description: &str) -> Value {
    json!({ "type": "integer", "minimum": 0, "description": description })
}

pub(crate) fn string_array_schema(description: &str) -> Value {
    json!({
        "type": "array",
        "items": { "type": "string" },
        "description": description
    })
}

pub(crate) fn string_map_schema(description: &str) -> Value {
    json!({
        "type": "object",
        "additionalProperties": { "type": "string" },
        "description": description
    })
}

pub fn run_registered_tool(name: &str, arguments: Value, ctx: &ToolContext) -> Result<Value> {
    run_builtin_tool(name, arguments, ctx)
}

pub(crate) fn workspace_write_paths_for_tool(tool_name: &str, arguments: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    match tool_name {
        "write_file" | "delete_path" | "create_directory" => {
            push_arg_path(&mut paths, arguments, "path");
        }
        "move_path" => {
            push_arg_path(&mut paths, arguments, "fromPath");
            push_arg_path(&mut paths, arguments, "toPath");
        }
        _ => {}
    }
    paths
}

fn push_arg_path(paths: &mut Vec<String>, arguments: &Value, key: &str) {
    if let Some(path) = arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        paths.push(path.to_string());
    }
}

fn run_tool<T>(arguments: Value, ctx: &ToolContext) -> Result<Value>
where
    T: AgentTool + Default,
{
    let input = serde_json::from_value::<T::Input>(arguments)
        .with_context(|| format!("invalid input for {}", T::NAME))?;
    let permission_arguments = serde_json::to_value(&input)
        .with_context(|| format!("failed to serialize permission input for {}", T::NAME))?;
    match decide_tool_permission(T::NAME, &permission_arguments, ctx.permission_policy()) {
        ToolPermissionDecision::Allow => {}
        ToolPermissionDecision::Confirm => {
            return Err(anyhow!("AgentTool requires user confirmation: {}", T::NAME));
        }
        ToolPermissionDecision::Deny(reason) => {
            return Err(anyhow!("AgentTool denied: {reason}"));
        }
    }
    let output = T::default().run(input, ctx)?;
    serde_json::to_value(output).context("failed to serialize tool output")
}

fn definition<T: AgentTool>() -> ToolDefinition {
    ToolDefinition {
        name: T::NAME.to_string(),
        description: T::description().to_string(),
        input_schema: T::input_schema(),
    }
}

macro_rules! tools {
    ($($tool:ty),+ $(,)?) => {
        pub const ALL_TOOL_NAMES: &[&str] = &[$(<$tool>::NAME,)+];

        const _: () = {
            const fn str_eq(left: &str, right: &str) -> bool {
                let left = left.as_bytes();
                let right = right.as_bytes();
                if left.len() != right.len() {
                    return false;
                }
                let mut index = 0;
                while index < left.len() {
                    if left[index] != right[index] {
                        return false;
                    }
                    index += 1;
                }
                true
            }

            let names = ALL_TOOL_NAMES;
            let mut left = 0;
            while left < names.len() {
                let mut right = left + 1;
                while right < names.len() {
                    if str_eq(names[left], names[right]) {
                        panic!("duplicate AgentTool name");
                    }
                    right += 1;
                }
                left += 1;
            }
        };

        pub fn built_in_tool_definitions() -> Vec<ToolDefinition> {
            vec![$(definition::<$tool>(),)+]
        }

        fn run_builtin_tool(name: &str, arguments: Value, ctx: &ToolContext) -> Result<Value> {
            $(
                if name == <$tool>::NAME {
                    return run_tool::<$tool>(arguments, ctx);
                }
            )+
            Err(anyhow!("AgentTool not found: {name}"))
        }
    };
}

tools! {
    ReadFileTool,
    ListDirectoryTool,
    SearchTextTool,
    EditFileTool,
    TerminalTool,
    FindPathTool,
    GitStatusTool,
    GitDiffTool,
    WriteFileTool,
    DeletePathTool,
    MovePathTool,
    CreateDirectoryTool,
    UpdatePlanTool,
    OpenClarificationPanelTool,
    FetchUrlTool,
    WebSearchTool,
}

fn sanitized_tool_id(path: &str) -> String {
    path.trim_matches('/')
        .replace('/', "_")
        .replace('.', "_")
        .replace('-', "_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_required_phase_two_tools() {
        let names = ALL_TOOL_NAMES;

        for expected in [
            "read_file",
            "list_directory",
            "search_text",
            "edit_file",
            "terminal",
            "find_path",
            "git_status",
            "git_diff",
            "write_file",
            "delete_path",
            "move_path",
            "create_directory",
            "update_plan",
            "open_clarification_panel",
            "fetch_url",
            "web_search",
        ] {
            assert!(names.contains(&expected), "missing {expected}");
        }
    }

    #[test]
    fn built_in_definitions_export_function_calling_schemas() {
        let definitions = built_in_tool_definitions();
        let read_file = definitions
            .iter()
            .find(|definition| definition.name == "read_file")
            .expect("read_file definition");

        assert_eq!(definitions.len(), ALL_TOOL_NAMES.len());
        assert!(read_file.input_schema["properties"]["path"].is_object());
    }
}
