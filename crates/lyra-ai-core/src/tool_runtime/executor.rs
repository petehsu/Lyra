use crate::tool_runtime::catalog::{
    self, GitDiffArgs, GitStatusArgs, ListCatalogArgs, ProposePatchArgs, ReadFileArgs,
    ReadRangeArgs, SearchCodeArgs, SearchFilesArgs, SearchTextArgs, SearchToolsArgs, StatPathArgs,
    WalkDirectoryArgs, TOOL_CODE_SEARCH_CODE, TOOL_FS_LIST_FILES, TOOL_FS_PROPOSE_PATCH,
    TOOL_FS_READ_FILE, TOOL_FS_READ_RANGE, TOOL_FS_SEARCH_FILES, TOOL_FS_SEARCH_TEXT,
    TOOL_FS_STAT_PATH, TOOL_FS_WALK_DIRECTORY, TOOL_GIT_DIFF, TOOL_GIT_STATUS,
    TOOL_MEMORY_ASSEMBLE_CONTEXT, TOOL_MEMORY_AUDIT_MEMORY, TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE,
    TOOL_MEMORY_GET_CONTEXT_SNAPSHOT, TOOL_MEMORY_PROPOSE_MEMORY, TOOL_MEMORY_SEARCH_FROZEN,
    TOOL_MEMORY_SEARCH_SESSION, TOOL_MEMORY_SEARCH_SHARED, TOOL_MEMORY_UPDATE_MEMORY, TOOL_SEARCH,
    TOOL_SHELL_RUN_COMMAND,
};
use crate::tool_runtime::filesystem;
use crate::tool_runtime::git;
use crate::tool_runtime::operation::{
    ToolFsOp, ToolOperationEnvelope, ToolResultEnvelope, ToolRuntimeError, TOOL_EXECUTION_FAILED,
    TOOL_INSPECT_REQUIRED,
};
use crate::tool_runtime::patch;
use crate::tool_runtime::security::redact_secrets;
use anyhow::{anyhow, Result};
use serde_json::json;

#[derive(Clone, Debug)]
pub struct ToolExecutionContext {
    pub workspace_root: Option<String>,
}

pub fn execute_tool(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> ToolResultEnvelope {
    match execute_tool_result(context, operation) {
        Ok(result) => result,
        Err(error) => tool_failure(operation, error),
    }
}

pub fn inspect_required_result(operation: &ToolOperationEnvelope) -> ToolResultEnvelope {
    ToolResultEnvelope::failed(
        operation,
        TOOL_INSPECT_REQUIRED,
        format!("Inspect {} before running it in this turn", operation.path),
    )
}

pub fn tool_runtime_prompt(workspace_root: Option<&str>) -> String {
    let workspace = workspace_root
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .unwrap_or("unknown");
    if workspace == "unknown" {
        return r#"ToolFS runtime:
- No workspace root is bound, so /tools can be browsed but workspace tools cannot run.
- If the request requires reading project files, ask the requester to bind or open a project first.
- Do not claim to have read files, code, or git state unless a Runtime ToolFS result appears in the conversation."#
            .to_string();
    }
    format!(
        r#"ToolFS runtime:
- Bound workspace_root: {workspace}
- You may browse /tools when the request needs current workspace, file, code, or git facts.
- Ordinary conversation, explanation, and writing tasks should not browse /tools.
- Only these ToolFS meta operations are visible:
  - list: list /tools or a ToolFS directory.
  - read_doc: read /tools or tool documentation.
  - inspect: inspect a concrete tool manifest before running it.
  - run: run a concrete tool path under /tools.
- To call ToolFS, respond with exactly one JSON object and no Markdown:
{{"schemaVersion":"v1","kind":"tool_operation","opId":"short-unique-id","op":"list","path":"/tools"}}
- Real tools are addressed only by /tools/... paths discovered from ToolFS results.
- The runtime requires inspect on a concrete /tools/... tool path before run in the same turn, except /tools/search which only discovers tools.
- Use list /tools/manifest with optional args {{"limit": number, "offset": number}} for paged registry manifests.
- Tool results may include resultRef and continuation fields such as nextOffset, nextOffsetBytes, or nextStartLine.
- You may propose a patch preview through /tools/filesystem/propose_patch when requested.
- You may request applying an existing patch proposal artifact through /tools/filesystem/apply_patch. The runtime accepts only artifactId or patchRef from the current session, never arbitrary patch text. In sandbox permission mode this returns approval required instead of writing files; in full_access permission mode the runtime may auto-approve and apply.
- You may request rolling back an applied patch through /tools/filesystem/rollback_patch using appliedArtifactId. Rollback uses recorded backups and refuses if workspace files drifted after apply.
- You may run short verification commands through /tools/shell/run_command. Prefer argv mode. The runtime validates cwd inside the workspace, caps output and time, rejects destructive or long-running commands, and may require user approval in sandbox permission mode.
- Do not claim files were modified, saved, formatted, built, or tested unless a runtime result explicitly proves it.
- The runtime rejects arbitrary writes, unmanaged long-running processes, destructive shell commands, network tools, external URLs, and paths outside the workspace."#
    )
}

fn execute_tool_result(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> Result<ToolResultEnvelope> {
    match operation.op {
        ToolFsOp::List => {
            let content = if operation.args.is_null() {
                catalog::list_catalog_path(&operation.path)?
            } else {
                catalog::list_catalog_path_with_args(
                    &operation.path,
                    catalog::parse_args::<ListCatalogArgs>(&operation.args)?,
                )?
            };
            Ok(ToolResultEnvelope::completed(
                operation,
                format!("Listed {}", operation.path),
                serde_json::to_string_pretty(&content)?,
                false,
            ))
        }
        ToolFsOp::ReadDoc => {
            let content = catalog::read_doc(&operation.path)?;
            Ok(ToolResultEnvelope::completed(
                operation,
                format!("Read doc {}", operation.path),
                content,
                false,
            ))
        }
        ToolFsOp::Inspect => {
            let content = catalog::inspect_tool_json(&operation.path)?;
            Ok(ToolResultEnvelope::completed(
                operation,
                format!("Inspected {}", operation.path),
                serde_json::to_string_pretty(&content)?,
                false,
            ))
        }
        ToolFsOp::Run => run_tool_path(context, operation),
    }
}

fn run_tool_path(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
) -> Result<ToolResultEnvelope> {
    match catalog::normalize_tool_path(&operation.path).as_str() {
        TOOL_SEARCH => {
            let content =
                catalog::search_tools(catalog::parse_args::<SearchToolsArgs>(&operation.args)?)?;
            Ok(ToolResultEnvelope::completed(
                operation,
                "Recommended ToolFS tools",
                serde_json::to_string_pretty(&content)?,
                false,
            ))
        }
        TOOL_FS_LIST_FILES => {
            filesystem::list_files(context, operation, catalog::parse_args(&operation.args)?)
        }
        TOOL_FS_STAT_PATH => filesystem::stat_path(
            context,
            operation,
            catalog::parse_args::<StatPathArgs>(&operation.args)?,
        ),
        TOOL_FS_READ_FILE => filesystem::read_file(
            context,
            operation,
            catalog::parse_args::<ReadFileArgs>(&operation.args)?,
        ),
        TOOL_FS_READ_RANGE => filesystem::read_range(
            context,
            operation,
            catalog::parse_args::<ReadRangeArgs>(&operation.args)?,
        ),
        TOOL_FS_SEARCH_FILES => filesystem::search_files(
            context,
            operation,
            catalog::parse_args::<SearchFilesArgs>(&operation.args)?,
        ),
        TOOL_FS_SEARCH_TEXT => filesystem::search_text(
            context,
            operation,
            catalog::parse_args::<SearchTextArgs>(&operation.args)?,
        ),
        TOOL_FS_WALK_DIRECTORY => filesystem::walk_directory(
            context,
            operation,
            catalog::parse_args::<WalkDirectoryArgs>(&operation.args)?,
        ),
        TOOL_FS_PROPOSE_PATCH => patch::propose_patch(
            context,
            operation,
            catalog::parse_args::<ProposePatchArgs>(&operation.args)?,
        ),
        TOOL_SHELL_RUN_COMMAND => Err(anyhow!(
            "{} requires Agent runtime policy context",
            TOOL_SHELL_RUN_COMMAND
        )),
        TOOL_CODE_SEARCH_CODE => filesystem::search_code(
            context,
            operation,
            catalog::parse_args::<SearchCodeArgs>(&operation.args)?,
        ),
        TOOL_GIT_STATUS => git::status(
            context,
            operation,
            catalog::parse_args::<GitStatusArgs>(&operation.args)?,
        ),
        TOOL_GIT_DIFF => git::diff(
            context,
            operation,
            catalog::parse_args::<GitDiffArgs>(&operation.args)?,
        ),
        TOOL_MEMORY_SEARCH_SESSION
        | TOOL_MEMORY_SEARCH_SHARED
        | TOOL_MEMORY_SEARCH_FROZEN
        | TOOL_MEMORY_GET_CONTEXT_SNAPSHOT
        | TOOL_MEMORY_ASSEMBLE_CONTEXT
        | TOOL_MEMORY_PROPOSE_MEMORY
        | TOOL_MEMORY_UPDATE_MEMORY
        | TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE
        | TOOL_MEMORY_AUDIT_MEMORY => Err(anyhow!(
            "{} requires Agent runtime memory context",
            operation.path
        )),
        path if path.starts_with("/tools/clarification/") => Err(anyhow!(
            "{} requires Agent runtime clarification context",
            operation.path
        )),
        path if path.starts_with("/tools/security/") => Err(anyhow!(
            "{} requires Agent runtime security context",
            operation.path
        )),
        path if path.starts_with("/tools/capsule/") => Err(anyhow!(
            "{} requires Agent runtime capsule context",
            operation.path
        )),
        _ => Err(anyhow!(
            "ToolFS runnable tool not found: {}",
            operation.path
        )),
    }
}

pub fn tool_event_metadata(operation: &ToolOperationEnvelope) -> serde_json::Value {
    let risk_level = catalog::inspect_tool(&operation.path)
        .map(|manifest| manifest.risk_level)
        .unwrap_or("low");
    json!({
        "op": operation.op,
        "path": operation.path,
        "toolPath": if operation.op == ToolFsOp::Run { Some(operation.path.as_str()) } else { None },
        "riskLevel": risk_level,
        "summary": tool_operation_summary(operation),
    })
}

pub fn normalized_tool_path(path: &str) -> String {
    catalog::normalize_tool_path(path)
}

fn tool_failure(operation: &ToolOperationEnvelope, error: anyhow::Error) -> ToolResultEnvelope {
    let (code, message) = error
        .downcast_ref::<ToolRuntimeError>()
        .map(|error| (error.code, error.message.clone()))
        .unwrap_or((TOOL_EXECUTION_FAILED, error.to_string()));
    ToolResultEnvelope::failed(operation, code, redact_secrets(&message))
}

fn tool_operation_summary(operation: &ToolOperationEnvelope) -> String {
    match operation.op {
        ToolFsOp::List => format!("List {}", operation.path),
        ToolFsOp::ReadDoc => format!("Read doc {}", operation.path),
        ToolFsOp::Inspect => format!("Inspect {}", operation.path),
        ToolFsOp::Run => format!("Run {}", operation.path),
    }
}
