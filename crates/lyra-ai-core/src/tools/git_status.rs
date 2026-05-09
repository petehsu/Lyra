use super::{object_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::catalog::TOOL_GIT_STATUS;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct GitStatusTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStatusInput {
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

impl JsonSchema for GitStatusInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![("maxBytes", usize_schema("Maximum bytes to return."))],
            &[],
        )
    }
}

impl AgentTool for GitStatusTool {
    const NAME: &'static str = "git_status";
    type Input = GitStatusInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Read git status for the bound workspace without changing repository state."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_GIT_STATUS, &input)
    }
}
