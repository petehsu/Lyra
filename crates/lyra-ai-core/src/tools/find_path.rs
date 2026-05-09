use super::{object_schema, string_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::catalog::TOOL_FS_SEARCH_FILES;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct FindPathTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FindPathInput {
    pub query: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

impl JsonSchema for FindPathInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                ("query", string_schema("Filename or path query.")),
                (
                    "path",
                    string_schema("Optional workspace-relative search root."),
                ),
                ("maxResults", usize_schema("Maximum paths to return.")),
                ("offset", usize_schema("Result offset for continuation.")),
            ],
            &["query"],
        )
    }
}

impl AgentTool for FindPathTool {
    const NAME: &'static str = "find_path";
    type Input = FindPathInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Find workspace paths by filename or path query."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_FS_SEARCH_FILES, &input)
    }
}
