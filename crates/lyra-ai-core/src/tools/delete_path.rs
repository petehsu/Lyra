use super::{bool_schema, object_schema, string_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::security::WorkspaceSecurity;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;

#[derive(Default)]
pub struct DeletePathTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeletePathInput {
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

impl JsonSchema for DeletePathInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("path", string_schema("Workspace-relative path to delete.")),
                ("recursive", bool_schema("Required for directory deletion.")),
            ],
            &["path"],
        )
    }
}

impl AgentTool for DeletePathTool {
    const NAME: &'static str = "delete_path";
    type Input = DeletePathInput;
    type Output = Value;

    fn description() -> &'static str {
        "Delete a file or, with recursive=true, a directory inside the workspace."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        let security = WorkspaceSecurity::new(ctx.execution().workspace_root.as_deref())?;
        let target = security.resolve_existing_path(Some(&input.path))?;
        let relative = security.relative_display(&target);
        let metadata = fs::metadata(&target)?;
        if metadata.is_dir() {
            if !input.recursive {
                return Err(anyhow!(
                    "delete_path requires recursive=true for directories"
                ));
            }
            fs::remove_dir_all(&target)?;
        } else {
            fs::remove_file(&target)?;
        }
        Ok(json!({
            "path": relative,
            "deleted": true,
            "kind": if metadata.is_dir() { "directory" } else { "file" }
        }))
    }
}
