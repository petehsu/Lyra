use super::{bool_schema, object_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::catalog::TOOL_GIT_DIFF;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct GitDiffTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitDiffInput {
    #[serde(default)]
    pub stat: Option<bool>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

impl JsonSchema for GitDiffInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                (
                    "stat",
                    bool_schema("Return diff stat instead of full diff."),
                ),
                ("maxBytes", usize_schema("Maximum bytes to return.")),
            ],
            &[],
        )
    }
}

impl AgentTool for GitDiffTool {
    const NAME: &'static str = "git_diff";
    type Input = GitDiffInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Read git diff or diff stat for the bound workspace."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_GIT_DIFF, &input)
    }
}
