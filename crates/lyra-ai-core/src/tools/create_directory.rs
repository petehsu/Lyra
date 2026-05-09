use super::{bool_schema, object_schema, string_schema, AgentTool, JsonSchema, ToolContext};
use crate::tool_runtime::operation::{tool_error, TOOL_PATH_OUTSIDE_WORKSPACE};
use crate::tool_runtime::security::WorkspaceSecurity;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Default)]
pub struct CreateDirectoryTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateDirectoryInput {
    pub path: String,
    #[serde(default = "default_parents")]
    pub parents: bool,
}

impl JsonSchema for CreateDirectoryInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                (
                    "path",
                    string_schema("Workspace-relative directory path to create."),
                ),
                (
                    "parents",
                    bool_schema("Create missing parent directories if true."),
                ),
            ],
            &["path"],
        )
    }
}

impl AgentTool for CreateDirectoryTool {
    const NAME: &'static str = "create_directory";
    type Input = CreateDirectoryInput;
    type Output = Value;

    fn description() -> &'static str {
        "Create a directory inside the bound workspace."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        let security = WorkspaceSecurity::new(ctx.execution().workspace_root.as_deref())?;
        let relative = validate_relative_directory_path(&input.path)?;
        let target = security.root().join(&relative);
        ensure_existing_ancestor_inside_workspace(security.root(), &target)?;
        if input.parents {
            fs::create_dir_all(&target)?;
        } else {
            fs::create_dir(&target)?;
        }
        Ok(json!({
            "path": relative.to_string_lossy().replace('\\', "/"),
            "created": true
        }))
    }
}

fn default_parents() -> bool {
    true
}

fn validate_relative_directory_path(raw_path: &str) -> Result<PathBuf> {
    let raw_path = raw_path.trim();
    let requested = Path::new(raw_path);
    if raw_path.is_empty()
        || requested.is_absolute()
        || requested
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(tool_error(
            TOOL_PATH_OUTSIDE_WORKSPACE,
            "path must be relative to the workspace",
        ));
    }
    Ok(requested.to_path_buf())
}

fn ensure_existing_ancestor_inside_workspace(root: &Path, target: &Path) -> Result<()> {
    let mut current = target.parent();
    while let Some(path) = current {
        if path.exists() {
            let canonical = path.canonicalize()?;
            if !canonical.starts_with(root) {
                return Err(tool_error(
                    TOOL_PATH_OUTSIDE_WORKSPACE,
                    "directory parent is outside the workspace",
                ));
            }
            return Ok(());
        }
        current = path.parent();
    }
    Ok(())
}
