use super::{object_schema, string_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::catalog::TOOL_FS_LIST_FILES;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct ListDirectoryTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListDirectoryInput {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_entries: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

impl JsonSchema for ListDirectoryInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                ("path", string_schema("Workspace-relative directory path.")),
                ("maxEntries", usize_schema("Maximum entries to return.")),
                ("offset", usize_schema("Entry offset for continuation.")),
            ],
            &[],
        )
    }
}

impl AgentTool for ListDirectoryTool {
    const NAME: &'static str = "list_directory";
    type Input = ListDirectoryInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "List files and directories inside the bound workspace."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_FS_LIST_FILES, &input)
    }
}
