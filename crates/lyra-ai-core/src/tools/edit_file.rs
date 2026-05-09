use super::{
    object_schema, string_array_schema, string_schema, AgentTool, JsonSchema, ToolContext,
};
use crate::tool_runtime::catalog::{TOOL_FS_APPLY_PATCH, TOOL_FS_PROPOSE_PATCH};
use crate::tool_runtime::ToolResultEnvelope;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Default)]
pub struct EditFileTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditFileInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub rationale: Option<String>,
    #[serde(default)]
    pub patch: Option<String>,
    #[serde(default)]
    pub expected_files: Vec<String>,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub patch_ref: Option<String>,
}

impl JsonSchema for EditFileInput {
    fn json_schema() -> serde_json::Value {
        object_schema(
            vec![
                (
                    "title",
                    string_schema("Short edit title for a patch proposal."),
                ),
                ("rationale", string_schema("Reason for the edit.")),
                (
                    "patch",
                    string_schema("Unified diff patch text to propose."),
                ),
                (
                    "expectedFiles",
                    string_array_schema("Files expected to change."),
                ),
                (
                    "artifactId",
                    string_schema("Existing patch artifact id to apply."),
                ),
                ("patchRef", string_schema("Existing patch ref to apply.")),
            ],
            &[],
        )
    }
}

impl AgentTool for EditFileTool {
    const NAME: &'static str = "edit_file";
    type Input = EditFileInput;
    type Output = ToolResultEnvelope;

    fn description() -> &'static str {
        "Propose a unified diff or apply an existing approved patch artifact."
    }

    fn run(&self, input: Self::Input, ctx: &ToolContext) -> Result<Self::Output> {
        if input.artifact_id.is_some() || input.patch_ref.is_some() {
            return ctx.run_tool_path(
                TOOL_FS_APPLY_PATCH,
                &json!({
                    "artifactId": input.artifact_id,
                    "patchRef": input.patch_ref
                }),
            );
        }
        let patch = input
            .patch
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("edit_file requires patch or artifactId/patchRef"))?;
        ctx.run_tool_path(
            TOOL_FS_PROPOSE_PATCH,
            &json!({
                "title": input.title.unwrap_or_else(|| "Edit file".to_string()),
                "rationale": input.rationale,
                "patch": patch,
                "expectedFiles": input.expected_files,
            }),
        )
    }
}
