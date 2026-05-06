use crate::tool_runtime::operation::{ToolFsOp, ToolOperationEnvelope};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::{json, Value};

pub const TOOLS_ROOT: &str = "/tools";
pub const TOOL_SEARCH: &str = "/tools/search";
pub const TOOL_FS_LIST_FILES: &str = "/tools/filesystem/list_files";
pub const TOOL_FS_STAT_PATH: &str = "/tools/filesystem/stat_path";
pub const TOOL_FS_READ_FILE: &str = "/tools/filesystem/read_file";
pub const TOOL_FS_READ_RANGE: &str = "/tools/filesystem/read_range";
pub const TOOL_FS_SEARCH_FILES: &str = "/tools/filesystem/search_files";
pub const TOOL_FS_SEARCH_TEXT: &str = "/tools/filesystem/search_text";
pub const TOOL_FS_WALK_DIRECTORY: &str = "/tools/filesystem/walk_directory";
pub const TOOL_FS_PROPOSE_PATCH: &str = "/tools/filesystem/propose_patch";
pub const TOOL_FS_APPLY_PATCH: &str = "/tools/filesystem/apply_patch";
pub const TOOL_FS_ROLLBACK_PATCH: &str = "/tools/filesystem/rollback_patch";
pub const TOOL_CODE_SEARCH_CODE: &str = "/tools/code/search_code";
pub const TOOL_GIT_STATUS: &str = "/tools/git/status";
pub const TOOL_GIT_DIFF: &str = "/tools/git/diff";

#[derive(Clone, Debug)]
pub struct ToolManifest {
    pub path: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub domain: &'static str,
    pub risk_level: &'static str,
    pub side_effect: &'static str,
    pub args: Value,
    pub returns: Value,
    pub tags: &'static [&'static str],
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchToolsArgs {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListFilesArgs {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_entries: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatPathArgs {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadFileArgs {
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<usize>,
    #[serde(default)]
    pub offset_bytes: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRangeArgs {
    pub path: String,
    #[serde(default)]
    pub start_line: Option<usize>,
    #[serde(default)]
    pub end_line: Option<usize>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchFilesArgs {
    pub query: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchTextArgs {
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalkDirectoryArgs {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_entries: Option<usize>,
    #[serde(default)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposePatchArgs {
    pub title: String,
    #[serde(default)]
    pub rationale: Option<String>,
    pub patch: String,
    pub expected_files: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyPatchArgs {
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub patch_ref: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackPatchArgs {
    pub applied_artifact_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchCodeArgs {
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitStatusArgs {
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitDiffArgs {
    #[serde(default)]
    pub stat: Option<bool>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

pub fn list_catalog_path(path: &str) -> Result<Value> {
    let path = normalize_tool_path(path);
    let entries = match path.as_str() {
        TOOLS_ROOT => vec![
            entry(TOOL_SEARCH, "tool", "recommend tools by task context"),
            entry(
                "/tools/filesystem",
                "directory",
                "read workspace files and directories",
            ),
            entry("/tools/code", "directory", "search and inspect source code"),
            entry("/tools/git", "directory", "inspect local git state"),
        ],
        "/tools/filesystem" => vec![
            entry(TOOL_FS_LIST_FILES, "tool", "list files and directories"),
            entry(TOOL_FS_STAT_PATH, "tool", "read path metadata"),
            entry(TOOL_FS_READ_FILE, "tool", "read a text file"),
            entry(
                TOOL_FS_READ_RANGE,
                "tool",
                "read a line range from a text file",
            ),
            entry(TOOL_FS_SEARCH_FILES, "tool", "find files by path or name"),
            entry(
                TOOL_FS_SEARCH_TEXT,
                "tool",
                "search text in workspace files",
            ),
            entry(
                TOOL_FS_WALK_DIRECTORY,
                "tool",
                "walk a directory tree summary",
            ),
            entry(
                TOOL_FS_PROPOSE_PATCH,
                "tool",
                "propose a unified diff without applying it",
            ),
            entry(
                TOOL_FS_APPLY_PATCH,
                "tool",
                "apply an approved patch artifact to the workspace",
            ),
            entry(
                TOOL_FS_ROLLBACK_PATCH,
                "tool",
                "rollback an applied patch using recorded backups",
            ),
        ],
        "/tools/code" => vec![entry(
            TOOL_CODE_SEARCH_CODE,
            "tool",
            "search source code with file and line snippets",
        )],
        "/tools/git" => vec![
            entry(TOOL_GIT_STATUS, "tool", "read git status"),
            entry(TOOL_GIT_DIFF, "tool", "read git diff or diff stat"),
        ],
        _ => return Err(anyhow!("ToolFS path is not a directory: {path}")),
    };
    Ok(json!({
        "path": path,
        "entries": entries
    }))
}

pub fn read_doc(path: &str) -> Result<String> {
    let path = normalize_tool_path(path);
    match path.as_str() {
        TOOLS_ROOT => Ok("Use /tools to discover available low-risk read-only capabilities. Start with list /tools, inspect a specific tool before run, and never assume unavailable tools exist.".to_string()),
        "/tools/filesystem" => Ok("Filesystem tools read files and directories inside the bound workspace only. They cannot write, move, delete, or execute files.".to_string()),
        "/tools/code" => Ok("Code tools search source files and return path, line, column, and snippet evidence. They do not edit or run code.".to_string()),
        "/tools/git" => Ok("Git tools are read-only and only inspect status or diff for the bound workspace. They never change branches, commits, or index state.".to_string()),
        TOOL_SEARCH => Ok("Run /tools/search with { query, maxResults? } to recommend matching tool paths. It only discovers tools and never executes business actions.".to_string()),
        _ => inspect_tool(path.as_str())
            .map(|manifest| manifest_to_doc(&manifest))
            .ok_or_else(|| anyhow!("ToolFS doc not found: {path}")),
    }
}

pub fn inspect_tool(path: &str) -> Option<ToolManifest> {
    let path = normalize_tool_path(path);
    tool_manifests()
        .into_iter()
        .find(|manifest| manifest.path == path)
}

pub fn inspect_tool_json(path: &str) -> Result<Value> {
    let manifest = inspect_tool(path).ok_or_else(|| anyhow!("ToolFS tool not found: {path}"))?;
    Ok(manifest_json(&manifest))
}

pub fn search_tools(args: SearchToolsArgs) -> Result<Value> {
    require_non_empty("query", &args.query)?;
    let query = args.query.to_ascii_lowercase();
    let max_results = args.max_results.unwrap_or(5).clamp(1, 10);
    let mut scored = tool_manifests()
        .into_iter()
        .filter_map(|manifest| {
            let haystack = format!(
                "{} {} {} {}",
                manifest.path,
                manifest.description,
                manifest.domain,
                manifest.tags.join(" ")
            )
            .to_ascii_lowercase();
            let score = query
                .split_whitespace()
                .filter(|part| haystack.contains(part))
                .count();
            if score == 0 {
                None
            } else {
                Some((score, manifest))
            }
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.path.cmp(right.1.path)));
    let recommendations = scored
        .into_iter()
        .take(max_results)
        .map(|(_, manifest)| {
            json!({
                "path": manifest.path,
                "description": manifest.description,
                "riskLevel": manifest.risk_level,
                "inspectRequired": true
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "query": args.query,
        "recommendations": recommendations
    }))
}

pub fn validate_operation(operation: &ToolOperationEnvelope) -> Result<()> {
    match operation.op {
        ToolFsOp::List => {
            if operation.args.is_null() == false
                && operation
                    .args
                    .as_object()
                    .is_some_and(|value| value.is_empty() == false)
            {
                return Err(anyhow!("list does not accept args"));
            }
            let path = normalize_tool_path(&operation.path);
            if matches!(
                path.as_str(),
                TOOLS_ROOT | "/tools/filesystem" | "/tools/code" | "/tools/git"
            ) == false
            {
                return Err(anyhow!("list path is not a ToolFS directory"));
            }
        }
        ToolFsOp::ReadDoc => {
            if operation.args.is_null() == false
                && operation
                    .args
                    .as_object()
                    .is_some_and(|value| value.is_empty() == false)
            {
                return Err(anyhow!("read_doc does not accept args"));
            }
            read_doc(&operation.path)?;
        }
        ToolFsOp::Inspect => {
            if operation.args.is_null() == false
                && operation
                    .args
                    .as_object()
                    .is_some_and(|value| value.is_empty() == false)
            {
                return Err(anyhow!("inspect does not accept args"));
            }
            inspect_tool(&operation.path)
                .ok_or_else(|| anyhow!("ToolFS tool not found: {}", operation.path))?;
        }
        ToolFsOp::Run => validate_run_args(&operation.path, &operation.args)?,
    }
    Ok(())
}

pub fn parse_args<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T> {
    serde_json::from_value(value.clone()).map_err(|error| anyhow!(error.to_string()))
}

pub fn require_non_empty(name: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("{name} is required"));
    }
    Ok(())
}

pub fn normalize_tool_path(path: &str) -> String {
    let mut value = path.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        value = TOOLS_ROOT.to_string();
    }
    value
}

pub fn tool_manifests() -> Vec<ToolManifest> {
    vec![
        manifest(
            TOOL_SEARCH,
            "search",
            "Recommend ToolFS tools for a task query.",
            "tools",
            json!({"query":"string","maxResults":"number?"}),
            &["tool", "search", "discover", "recommend"],
        ),
        manifest(
            TOOL_FS_LIST_FILES,
            "list_files",
            "List files and directories inside the bound workspace.",
            "filesystem",
            json!({"path":"string?","maxEntries":"number?","offset":"number?"}),
            &["file", "directory", "list", "project", "structure"],
        ),
        manifest(
            TOOL_FS_STAT_PATH,
            "stat_path",
            "Read type, size, and permission summary for a workspace path.",
            "filesystem",
            json!({"path":"string"}),
            &["file", "metadata", "stat", "size"],
        ),
        manifest(
            TOOL_FS_READ_FILE,
            "read_file",
            "Read a UTF-8 text file inside the bound workspace.",
            "filesystem",
            json!({"path":"string","maxBytes":"number?","offsetBytes":"number?"}),
            &["file", "read", "text"],
        ),
        manifest(
            TOOL_FS_READ_RANGE,
            "read_range",
            "Read a line range from a UTF-8 text file.",
            "filesystem",
            json!({"path":"string","startLine":"number?","endLine":"number?","maxBytes":"number?"}),
            &["file", "read", "range", "lines"],
        ),
        manifest(
            TOOL_FS_SEARCH_FILES,
            "search_files",
            "Find files by path, file name, or extension fragment.",
            "filesystem",
            json!({"query":"string","path":"string?","maxResults":"number?","offset":"number?"}),
            &["file", "find", "name", "glob", "extension"],
        ),
        manifest(
            TOOL_FS_SEARCH_TEXT,
            "search_text",
            "Search literal text in workspace files.",
            "filesystem",
            json!({"query":"string","path":"string?","maxResults":"number?","offset":"number?","contextLines":"number?"}),
            &["text", "grep", "search", "content"],
        ),
        manifest(
            TOOL_FS_WALK_DIRECTORY,
            "walk_directory",
            "Return a recursive directory tree summary.",
            "filesystem",
            json!({"path":"string?","maxEntries":"number?","maxDepth":"number?","offset":"number?"}),
            &["tree", "directory", "walk", "structure"],
        ),
        ToolManifest {
            path: TOOL_FS_PROPOSE_PATCH,
            name: "propose_patch",
            description: "Validate and store a proposed unified diff without applying it.",
            domain: "filesystem",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"title":"string","rationale":"string?","patch":"string","expectedFiles":"string[]"}),
            returns: json!({
                "type": "object",
                "description": "Patch artifact refs, changed file summary, and approval preview metadata."
            }),
            tags: &["patch", "diff", "preview", "proposal", "edit"],
        },
        ToolManifest {
            path: TOOL_FS_APPLY_PATCH,
            name: "apply_patch",
            description:
                "Apply an existing patch proposal artifact or patchRef to workspace files.",
            domain: "filesystem",
            risk_level: "medium",
            side_effect: "workspace_write",
            args: json!({"artifactId":"string?","patchRef":"string?"}),
            returns: json!({
                "type": "object",
                "description": "Apply status, approval ticket, applied artifact/evidence refs, patchRef, and changed files."
            }),
            tags: &["patch", "diff", "apply", "approval", "edit"],
        },
        ToolManifest {
            path: TOOL_FS_ROLLBACK_PATCH,
            name: "rollback_patch",
            description:
                "Rollback an applied patch artifact if workspace files still match the applied hashes.",
            domain: "filesystem",
            risk_level: "medium",
            side_effect: "workspace_write",
            args: json!({"appliedArtifactId":"string"}),
            returns: json!({
                "type": "object",
                "description": "Rollback status, approval ticket, rollback artifact/evidence refs, and changed files."
            }),
            tags: &["patch", "diff", "rollback", "approval", "edit"],
        },
        manifest(
            TOOL_CODE_SEARCH_CODE,
            "search_code",
            "Search source code files and return line snippets.",
            "code",
            json!({"query":"string","path":"string?","maxResults":"number?","offset":"number?","contextLines":"number?"}),
            &["code", "source", "search", "function", "symbol"],
        ),
        manifest(
            TOOL_GIT_STATUS,
            "status",
            "Read git status for the bound workspace.",
            "git",
            json!({"maxBytes":"number?"}),
            &["git", "status", "changes"],
        ),
        manifest(
            TOOL_GIT_DIFF,
            "diff",
            "Read git diff or diff stat for the bound workspace.",
            "git",
            json!({"stat":"boolean?","maxBytes":"number?"}),
            &["git", "diff", "changes", "patch"],
        ),
    ]
}

fn validate_run_args(path: &str, args: &Value) -> Result<()> {
    match normalize_tool_path(path).as_str() {
        TOOL_SEARCH => {
            let args = parse_args::<SearchToolsArgs>(args)?;
            require_non_empty("query", &args.query)
        }
        TOOL_FS_LIST_FILES => {
            parse_args::<ListFilesArgs>(args)?;
            Ok(())
        }
        TOOL_FS_STAT_PATH => {
            let args = parse_args::<StatPathArgs>(args)?;
            require_non_empty("path", &args.path)
        }
        TOOL_FS_READ_FILE => {
            let args = parse_args::<ReadFileArgs>(args)?;
            require_non_empty("path", &args.path)
        }
        TOOL_FS_READ_RANGE => {
            let args = parse_args::<ReadRangeArgs>(args)?;
            require_non_empty("path", &args.path)
        }
        TOOL_FS_SEARCH_FILES => {
            let args = parse_args::<SearchFilesArgs>(args)?;
            require_non_empty("query", &args.query)
        }
        TOOL_FS_SEARCH_TEXT => {
            let args = parse_args::<SearchTextArgs>(args)?;
            require_non_empty("query", &args.query)
        }
        TOOL_FS_WALK_DIRECTORY => {
            parse_args::<WalkDirectoryArgs>(args)?;
            Ok(())
        }
        TOOL_FS_PROPOSE_PATCH => {
            let args = parse_args::<ProposePatchArgs>(args)?;
            require_non_empty("title", &args.title)?;
            require_non_empty("patch", &args.patch)?;
            if args.expected_files.is_empty() {
                return Err(anyhow!("expectedFiles is required"));
            }
            Ok(())
        }
        TOOL_FS_APPLY_PATCH => {
            let args = parse_args::<ApplyPatchArgs>(args)?;
            let artifact_id = args
                .artifact_id
                .as_deref()
                .and_then(crate::storage::trim_to_string);
            let patch_ref = args
                .patch_ref
                .as_deref()
                .and_then(crate::storage::trim_to_string);
            if artifact_id.is_some() == patch_ref.is_some() {
                return Err(anyhow!("Provide exactly one of artifactId or patchRef"));
            }
            Ok(())
        }
        TOOL_FS_ROLLBACK_PATCH => {
            let args = parse_args::<RollbackPatchArgs>(args)?;
            require_non_empty("appliedArtifactId", &args.applied_artifact_id)
        }
        TOOL_CODE_SEARCH_CODE => {
            let args = parse_args::<SearchCodeArgs>(args)?;
            require_non_empty("query", &args.query)
        }
        TOOL_GIT_STATUS => {
            parse_args::<GitStatusArgs>(args)?;
            Ok(())
        }
        TOOL_GIT_DIFF => {
            parse_args::<GitDiffArgs>(args)?;
            Ok(())
        }
        _ => Err(anyhow!("ToolFS runnable tool not found: {path}")),
    }
}

fn manifest(
    path: &'static str,
    name: &'static str,
    description: &'static str,
    domain: &'static str,
    args: Value,
    tags: &'static [&'static str],
) -> ToolManifest {
    ToolManifest {
        path,
        name,
        description,
        domain,
        risk_level: "low",
        side_effect: "none",
        args,
        returns: json!({
            "type": "object",
            "description": "Compressed, redacted ToolFS result content."
        }),
        tags,
    }
}

fn entry(path: &str, kind: &str, description: &str) -> Value {
    json!({
        "path": path,
        "kind": kind,
        "description": description
    })
}

fn manifest_json(manifest: &ToolManifest) -> Value {
    json!({
        "name": manifest.name,
        "path": manifest.path,
        "description": manifest.description,
        "domain": manifest.domain,
        "args": manifest.args,
        "returns": manifest.returns,
        "risk": {
            "level": manifest.risk_level,
            "sideEffect": manifest.side_effect
        },
        "permission": {
            "requiresConfirmation": manifest.side_effect != "none",
            "sandboxRequired": true,
            "allowedScopes": ["workspace"]
        },
        "audit": {
            "eventType": "tool_operation_completed",
            "evidenceRequired": false
        },
            "output": {
            "maxBytes": 65536,
            "supportsPagination": true,
            "supportsResultRefs": true
        }
    })
}

fn manifest_to_doc(manifest: &ToolManifest) -> String {
    format!(
        "{}\npath: {}\ndomain: {}\nrisk: {}\nside_effect: {}\nRun through ToolFS with op=run and args matching inspect output.",
        manifest.description, manifest.path, manifest.domain, manifest.risk_level, manifest.side_effect
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_runtime::operation::{ToolFsOp, ToolOperationEnvelope};

    #[test]
    fn tools_top_level_list_is_short_directory_summary() {
        let value = list_catalog_path(TOOLS_ROOT).expect("list");
        let encoded = value.to_string();

        assert!(encoded.contains("/tools/filesystem"));
        assert!(encoded.contains("\"args\"") == false);
    }

    #[test]
    fn filesystem_list_returns_tool_path_summaries() {
        let value = list_catalog_path("/tools/filesystem").expect("list");
        let encoded = value.to_string();

        assert!(encoded.contains(TOOL_FS_READ_FILE));
        assert!(encoded.contains(TOOL_FS_PROPOSE_PATCH));
        assert!(encoded.contains(TOOL_FS_APPLY_PATCH));
        assert!(encoded.contains(TOOL_FS_ROLLBACK_PATCH));
        assert!(encoded.contains("\"args\"") == false);
    }

    #[test]
    fn inspect_read_file_returns_manifest_schema() {
        let value = inspect_tool_json(TOOL_FS_READ_FILE).expect("inspect");

        assert_eq!(value["path"], TOOL_FS_READ_FILE);
        assert_eq!(value["args"]["path"], "string");
    }

    #[test]
    fn inspect_propose_patch_returns_medium_risk_manifest() {
        let value = inspect_tool_json(TOOL_FS_PROPOSE_PATCH).expect("inspect");

        assert_eq!(value["path"], TOOL_FS_PROPOSE_PATCH);
        assert_eq!(value["risk"]["level"], "medium");
        assert_eq!(value["risk"]["sideEffect"], "none");
        assert_eq!(value["args"]["expectedFiles"], "string[]");
    }

    #[test]
    fn inspect_apply_patch_returns_write_manifest() {
        let value = inspect_tool_json(TOOL_FS_APPLY_PATCH).expect("inspect");

        assert_eq!(value["path"], TOOL_FS_APPLY_PATCH);
        assert_eq!(value["risk"]["level"], "medium");
        assert_eq!(value["risk"]["sideEffect"], "workspace_write");
        assert_eq!(value["args"]["artifactId"], "string?");
    }

    #[test]
    fn inspect_rollback_patch_returns_write_manifest() {
        let value = inspect_tool_json(TOOL_FS_ROLLBACK_PATCH).expect("inspect");

        assert_eq!(value["path"], TOOL_FS_ROLLBACK_PATCH);
        assert_eq!(value["risk"]["level"], "medium");
        assert_eq!(value["risk"]["sideEffect"], "workspace_write");
        assert_eq!(value["args"]["appliedArtifactId"], "string");
    }

    #[test]
    fn search_tool_recommends_without_running_business_tools() {
        let value = search_tools(SearchToolsArgs {
            query: "find code fetch".to_string(),
            max_results: Some(3),
        })
        .expect("search");

        assert!(value["recommendations"]
            .as_array()
            .expect("recommendations")
            .iter()
            .any(|item| item["path"] == TOOL_CODE_SEARCH_CODE));
    }

    #[test]
    fn validate_rejects_unknown_args_for_run() {
        let operation = ToolOperationEnvelope {
            schema_version: "v1".to_string(),
            kind: "tool_operation".to_string(),
            op_id: "op1".to_string(),
            op: ToolFsOp::Run,
            path: TOOL_FS_READ_FILE.to_string(),
            args: json!({"path":"Cargo.toml","extra":true}),
        };

        assert!(validate_operation(&operation).is_err());
    }
}
