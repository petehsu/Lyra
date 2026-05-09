use super::{bool_schema, object_schema, string_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::security::WorkspaceSecurity;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;

#[derive(Default)]
pub struct MovePathTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovePathInput {
    pub from_path: String,
    pub to_path: String,
    #[serde(default)]
    pub overwrite: bool,
}

impl JsonSchema for MovePathInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                (
                    "fromPath",
                    string_schema("Existing workspace-relative source path."),
                ),
                (
                    "toPath",
                    string_schema("Workspace-relative destination path."),
                ),
                (
                    "overwrite",
                    bool_schema("Replace existing destination if true."),
                ),
            ],
            &["fromPath", "toPath"],
        )
    }
}

impl AgentTool for MovePathTool {
    const NAME: &'static str = "move_path";
    type Input = MovePathInput;
    type Output = Value;

    fn description() -> &'static str {
        "Move or rename a file or directory within the bound workspace."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        let security = WorkspaceSecurity::new(ctx.execution().workspace_root.as_deref())?;
        let from = security.resolve_existing_path(Some(&input.from_path))?;
        let to_relative = security.validate_relative_path_for_write_preview(&input.to_path)?;
        let to = security.root().join(&to_relative);
        if to.exists() {
            if !input.overwrite {
                return Err(anyhow!(
                    "move_path target exists; set overwrite=true to replace it"
                ));
            }
            if to.is_dir() {
                fs::remove_dir_all(&to)?;
            } else {
                fs::remove_file(&to)?;
            }
        }
        fs::rename(&from, &to)?;
        Ok(json!({
            "fromPath": security.relative_display(&from),
            "toPath": to_relative,
            "moved": true
        }))
    }
}
