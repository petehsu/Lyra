use super::{bool_schema, object_schema, string_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::security::WorkspaceSecurity;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;

#[derive(Default)]
pub struct WriteFileTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteFileInput {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub overwrite: bool,
}

impl JsonSchema for WriteFileInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                (
                    "path",
                    string_schema("Workspace-relative file path to write."),
                ),
                ("content", string_schema("Complete file content.")),
                (
                    "overwrite",
                    bool_schema("Replace an existing file if true."),
                ),
            ],
            &["path", "content"],
        )
    }
}

impl AgentTool for WriteFileTool {
    const NAME: &'static str = "write_file";
    type Input = WriteFileInput;
    type Output = Value;

    fn description() -> &'static str {
        "Create or overwrite a complete file inside the bound workspace."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        let security = WorkspaceSecurity::new(ctx.execution().workspace_root.as_deref())?;
        let relative = security.validate_relative_path_for_write_create(&input.path)?;
        let target = security.root().join(&relative);
        let existed = target.exists();
        if existed && !input.overwrite {
            return Err(anyhow!(
                "write_file target exists; set overwrite=true to replace it"
            ));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, input.content.as_bytes())?;
        Ok(json!({
            "path": relative,
            "bytesWritten": input.content.len(),
            "overwritten": existed
        }))
    }
}
