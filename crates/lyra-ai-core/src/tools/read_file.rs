use super::{object_schema, string_schema, usize_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::catalog::TOOL_FS_READ_FILE;
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct ReadFileTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadFileInput {
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<usize>,
    #[serde(default)]
    pub offset_bytes: Option<usize>,
}

impl JsonSchema for ReadFileInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                (
                    "path",
                    string_schema("Workspace-relative file path to read."),
                ),
                ("maxBytes", usize_schema("Maximum bytes to return.")),
                ("offsetBytes", usize_schema("Byte offset for continuation.")),
            ],
            &["path"],
        )
    }
}

impl AgentTool for ReadFileTool {
    const NAME: &'static str = "read_file";
    type Input = ReadFileInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Read a text file from the bound workspace with optional byte pagination."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        ctx.run_tool_path(TOOL_FS_READ_FILE, &input)
    }
}
