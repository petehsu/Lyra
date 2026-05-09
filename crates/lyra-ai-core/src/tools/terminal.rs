use super::{
    object_schema, string_array_schema, string_map_schema, string_schema, usize_schema, AgentTool,
    JsonSchema, ToolContext,
};
use crate::tool_runtime::catalog::TOOL_SHELL_RUN_COMMAND;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Default)]
pub struct TerminalTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalInput {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub argv: Option<Vec<String>>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub output_limit_bytes: Option<usize>,
    #[serde(default)]
    pub purpose: Option<String>,
}

impl JsonSchema for TerminalInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                ("mode", string_schema("Command mode: argv or shell.")),
                ("argv", string_array_schema("Command argv vector.")),
                ("command", string_schema("Shell command string.")),
                (
                    "cwd",
                    string_schema("Workspace-relative working directory."),
                ),
                ("env", string_map_schema("Environment variables.")),
                ("timeoutMs", usize_schema("Timeout in milliseconds.")),
                ("outputLimitBytes", usize_schema("Maximum output bytes.")),
                ("purpose", string_schema("Why this command is being run.")),
            ],
            &[],
        )
    }
}

impl AgentTool for TerminalTool {
    const NAME: &'static str = "terminal";
    type Input = TerminalInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Run a short workspace command through the runtime command policy."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_SHELL_RUN_COMMAND, &input)
    }
}
