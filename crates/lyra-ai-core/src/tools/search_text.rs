use super::{object_schema, string_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::catalog::TOOL_FS_SEARCH_TEXT;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct SearchTextTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchTextInput {
    pub query: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub context_lines: Option<usize>,
}

impl JsonSchema for SearchTextInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                ("query", string_schema("Text query to search for.")),
                (
                    "path",
                    string_schema("Optional workspace-relative search root."),
                ),
                ("maxResults", usize_schema("Maximum matches to return.")),
                ("offset", usize_schema("Result offset for continuation.")),
                (
                    "contextLines",
                    usize_schema("Context lines around each match."),
                ),
            ],
            &["query"],
        )
    }
}

impl AgentTool for SearchTextTool {
    const NAME: &'static str = "search_text";
    type Input = SearchTextInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Search text in workspace files with bounded, paginated results."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_FS_SEARCH_TEXT, &input)
    }
}
