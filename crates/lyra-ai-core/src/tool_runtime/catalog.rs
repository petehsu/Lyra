use crate::tool_runtime::operation::{ToolFsOp, ToolOperationEnvelope};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const TOOLS_ROOT: &str = "/tools";
pub const TOOL_MANIFESTS: &str = "/tools/manifest";
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
pub const TOOL_SHELL_RUN_COMMAND: &str = "/tools/shell/run_command";
pub const TOOL_GIT_STATUS: &str = "/tools/git/status";
pub const TOOL_GIT_DIFF: &str = "/tools/git/diff";
pub const TOOL_MEMORY_SEARCH_SESSION: &str = "/tools/memory/search_session";
pub const TOOL_MEMORY_SEARCH_SHARED: &str = "/tools/memory/search_shared";
pub const TOOL_MEMORY_SEARCH_FROZEN: &str = "/tools/memory/search_frozen";
pub const TOOL_MEMORY_GET_CONTEXT_SNAPSHOT: &str = "/tools/memory/get_context_snapshot";
pub const TOOL_MEMORY_ASSEMBLE_CONTEXT: &str = "/tools/memory/assemble_context";
pub const TOOL_MEMORY_PROPOSE_MEMORY: &str = "/tools/memory/propose_memory";
pub const TOOL_MEMORY_UPDATE_MEMORY: &str = "/tools/memory/update_memory";
pub const TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE: &str = "/tools/memory/create_conflict_candidate";
pub const TOOL_MEMORY_AUDIT_MEMORY: &str = "/tools/memory/audit_memory";
pub const TOOL_CLARIFICATION_DETECT_UNCERTAINTY: &str = "/tools/clarification/detect_uncertainty";
pub const TOOL_CLARIFICATION_CREATE_QUESTION: &str = "/tools/clarification/create_question";
pub const TOOL_CLARIFICATION_CREATE_QUESTION_SET: &str = "/tools/clarification/create_question_set";
pub const TOOL_CLARIFICATION_READ_QUESTION: &str = "/tools/clarification/read_question";
pub const TOOL_CLARIFICATION_LIST_OPEN_QUESTIONS: &str = "/tools/clarification/list_open_questions";
pub const TOOL_CLARIFICATION_OPEN_PANEL: &str = "/tools/clarification/open_panel";
pub const TOOL_CLARIFICATION_UPDATE_PANEL: &str = "/tools/clarification/update_panel";
pub const TOOL_CLARIFICATION_READ_PANEL: &str = "/tools/clarification/read_panel";
pub const TOOL_CLARIFICATION_CLOSE_PANEL: &str = "/tools/clarification/close_panel";
pub const TOOL_CLARIFICATION_SUBMIT_PANEL_ANSWER: &str = "/tools/clarification/submit_panel_answer";
pub const TOOL_CLARIFICATION_ANSWER_QUESTION: &str = "/tools/clarification/answer_question";
pub const TOOL_CLARIFICATION_RECORD_ASSUMPTION: &str = "/tools/clarification/record_assumption";
pub const TOOL_CLARIFICATION_REJECT_ASSUMPTION: &str = "/tools/clarification/reject_assumption";
pub const TOOL_CLARIFICATION_LINK_TO_TASK: &str = "/tools/clarification/link_to_task";
pub const TOOL_CLARIFICATION_LINK_TO_OPERATION: &str = "/tools/clarification/link_to_operation";
pub const TOOL_CLARIFICATION_VALIDATE_READY_TO_EXECUTE: &str =
    "/tools/clarification/validate_ready_to_execute";
pub const TOOL_CLARIFICATION_RESUME_BLOCKED_EXECUTION: &str =
    "/tools/clarification/resume_blocked_execution";
pub const TOOL_SECURITY_CLASSIFY_RESOURCE: &str = "/tools/security/classify_resource";
pub const TOOL_SECURITY_SCAN_TEXT: &str = "/tools/security/scan_text";
pub const TOOL_SECURITY_SCAN_FILE: &str = "/tools/security/scan_file";
pub const TOOL_SECURITY_SCAN_ARTIFACT: &str = "/tools/security/scan_artifact";
pub const TOOL_SECURITY_REDACT_TEXT: &str = "/tools/security/redact_text";
pub const TOOL_SECURITY_CREATE_SECRET_RECORD: &str = "/tools/security/create_secret_record";
pub const TOOL_SECURITY_CREATE_SECRET_HANDLE: &str = "/tools/security/create_secret_handle";
pub const TOOL_SECURITY_READ_SECRET_METADATA: &str = "/tools/security/read_secret_metadata";
pub const TOOL_SECURITY_REVOKE_SECRET_HANDLE: &str = "/tools/security/revoke_secret_handle";
pub const TOOL_SECURITY_CHECK_EXFILTRATION: &str = "/tools/security/check_exfiltration";
pub const TOOL_SECURITY_VALIDATE_ENV_ACCESS: &str = "/tools/security/validate_env_access";
pub const TOOL_SECURITY_VALIDATE_SENSITIVE_FILE_ACCESS: &str =
    "/tools/security/validate_sensitive_file_access";
pub const TOOL_SECURITY_VALIDATE_CAPSULE_BRIDGE: &str = "/tools/security/validate_capsule_bridge";
pub const TOOL_SECURITY_AUDIT_SECRET_ACCESS: &str = "/tools/security/audit_secret_access";
pub const TOOL_CAPSULE_READ_IMAGE_MANIFEST: &str = "/tools/capsule/read_image_manifest";
pub const TOOL_CAPSULE_LIST_IMAGES: &str = "/tools/capsule/list_images";
pub const TOOL_CAPSULE_DOWNLOAD_IMAGE: &str = "/tools/capsule/download_image";
pub const TOOL_CAPSULE_VERIFY_IMAGE: &str = "/tools/capsule/verify_image";
pub const TOOL_CAPSULE_IMPORT_IMAGE: &str = "/tools/capsule/import_image";
pub const TOOL_CAPSULE_CREATE: &str = "/tools/capsule/create";
pub const TOOL_CAPSULE_START: &str = "/tools/capsule/start";
pub const TOOL_CAPSULE_STOP: &str = "/tools/capsule/stop";
pub const TOOL_CAPSULE_DESTROY: &str = "/tools/capsule/destroy";
pub const TOOL_CAPSULE_STATUS: &str = "/tools/capsule/status";
pub const TOOL_CAPSULE_EXEC: &str = "/tools/capsule/exec";
pub const TOOL_CAPSULE_CREATE_SNAPSHOT: &str = "/tools/capsule/create_snapshot";
pub const TOOL_CAPSULE_RESTORE_SNAPSHOT: &str = "/tools/capsule/restore_snapshot";
pub const TOOL_CAPSULE_UPDATE_BRIDGE_POLICY: &str = "/tools/capsule/update_bridge_policy";
pub const TOOL_CAPSULE_READ_GUEST_LOGS: &str = "/tools/capsule/read_guest_logs";
pub const TOOL_CAPSULE_EXPORT_ARTIFACT: &str = "/tools/capsule/export_artifact";
pub const TOOL_CAPSULE_LIST_SESSION_BINDINGS: &str = "/tools/capsule/list_session_bindings";
pub const TOOL_CAPSULE_READ_SESSION_BINDING: &str = "/tools/capsule/read_session_binding";
pub const TOOL_CAPSULE_ATTACH_SESSION_VM: &str = "/tools/capsule/attach_session_vm";
pub const TOOL_CAPSULE_TAKEOVER_SESSION_VM: &str = "/tools/capsule/takeover_session_vm";
pub const TOOL_CAPSULE_FORK_SESSION_VM: &str = "/tools/capsule/fork_session_vm";
pub const TOOL_CAPSULE_CREATE_INHERITANCE_PROFILE: &str =
    "/tools/capsule/create_inheritance_profile";
pub const TOOL_CAPSULE_APPLY_INHERITANCE_PROFILE: &str = "/tools/capsule/apply_inheritance_profile";
pub const TOOL_CAPSULE_REVOKE_SESSION_BINDING: &str = "/tools/capsule/revoke_session_binding";

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

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListCatalogArgs {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchToolsArgs {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub risk_level: Option<String>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunCommandArgs {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub argv: Option<Vec<String>>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(default, alias = "secret_env")]
    pub secret_env: Option<std::collections::HashMap<String, String>>,
    #[serde(default, alias = "capsule_id")]
    pub capsule_id: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub output_limit_bytes: Option<usize>,
    #[serde(default)]
    pub purpose: Option<String>,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemorySearchArgs {
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextSnapshotArgs {
    #[serde(default)]
    pub include_pinned: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryAssembleContextArgs {
    #[serde(default)]
    pub max_chars: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryProposeArgs {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub namespace: Option<String>,
    pub kind: String,
    pub value: Value,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryUpdateArgs {
    pub scope: String,
    pub memory_id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryConflictArgs {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub namespace: Option<String>,
    pub kind: String,
    pub value: Value,
    #[serde(default)]
    pub conflicts_with: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryAuditArgs {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

pub fn list_catalog_path(path: &str) -> Result<Value> {
    list_catalog_path_with_args(path, ListCatalogArgs::default())
}

pub fn list_catalog_path_with_args(path: &str, args: ListCatalogArgs) -> Result<Value> {
    validate_pagination(args.limit, args.offset)?;
    let path = normalize_directory_path(path);
    if path == TOOL_MANIFESTS {
        return list_manifest_page(args);
    }
    let entries = directory_entries(&path)
        .ok_or_else(|| anyhow!("ToolFS path is not a directory: {path}"))?;
    let total = entries.len();
    let page = paginate(entries, args.limit, args.offset);
    Ok(json!({
        "schemaVersion": "v1",
        "kind": "directory",
        "path": path,
        "entries": page.items,
        "pagination": page.metadata(total)
    }))
}

pub fn read_doc(path: &str) -> Result<String> {
    let path = normalize_doc_path(path);
    match path.as_str() {
        TOOLS_ROOT => Ok("Use /tools to discover available capabilities. Start with list /tools, read directory README.md files when needed, inspect a concrete tool manifest before run, and never assume unavailable tools exist. Use list /tools/manifest with limit/offset when a paged registry view is needed.".to_string()),
        TOOL_MANIFESTS => Ok("Tool registry manifest pages are available through op=list path=/tools/manifest with optional args { limit, offset }. Pages include canonical tool paths, risk, provider, and manifest refs without executing tools.".to_string()),
        "/tools/filesystem" => Ok("Filesystem tools read files and directories inside the bound workspace only. They cannot write, move, delete, or execute files.".to_string()),
        "/tools/code" => Ok("Code tools search source files and return path, line, column, and snippet evidence. They do not edit or run code.".to_string()),
        "/tools/shell" => Ok("Shell tools run short commands in the bound workspace. /tools/shell/run_command requires argv or shell mode, workspace cwd validation, output limits, and approval for unsafe commands.".to_string()),
        "/tools/git" => Ok("Git tools are read-only and only inspect status or diff for the bound workspace. They never change branches, commits, or index state.".to_string()),
        "/tools/memory" => Ok("Memory tools inspect and update Agent Memory V2. Search and snapshot tools are read-only; propose/update/conflict writes go through structured truth stores, audit logs, and policy gates.".to_string()),
        "/tools/clarification" => Ok("Clarification tools create auditable QuestionTickets, open Clarification Panels, collect A/B/C/D or Custom answers, record assumptions, and resume blocked execution. They are not ordinary chat messages.".to_string()),
        "/tools/security" => Ok("Security tools classify resources, scan and redact secrets, issue scoped SecretHandle leases, check exfiltration, and validate sensitive file/env/Agent VM bridge access.".to_string()),
        "/tools/capsule" => Ok("Agent VM tools manage local isolated Agent guests: image manifest, import/download/verify, create/start/stop/destroy, guest exec, snapshots, bridge policy, session binding, inheritance, logs, and artifact export.".to_string()),
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
    let query = normalize_search_text(&args.query);
    let max_results = args.max_results.unwrap_or(5).clamp(1, 10);
    let domain_filter = args
        .domain
        .as_deref()
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .map(str::to_ascii_lowercase);
    let risk_filter = args
        .risk_level
        .as_deref()
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .map(str::to_ascii_lowercase);
    let mut scored = tool_manifests()
        .into_iter()
        .filter_map(|manifest| {
            if domain_filter
                .as_deref()
                .is_some_and(|domain| manifest.domain != domain)
            {
                return None;
            }
            if risk_filter
                .as_deref()
                .is_some_and(|risk| manifest.risk_level != risk)
            {
                return None;
            }
            let score = score_manifest(&query, &manifest);
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
                "domain": manifest.domain,
                "riskLevel": manifest.risk_level,
                "inspectRequired": true,
                "reason": search_reason(&query, &manifest),
                "manifestRef": format!("{}.tool", manifest.path)
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "schemaVersion": "v1",
        "kind": "toolSearchResult",
        "query": args.query,
        "recommendations": recommendations
    }))
}

pub fn validate_operation(operation: &ToolOperationEnvelope) -> Result<()> {
    match operation.op {
        ToolFsOp::List => {
            let args = parse_optional_args::<ListCatalogArgs>(&operation.args)?;
            let path = normalize_directory_path(&operation.path);
            if is_directory_path(&path) == false {
                return Err(anyhow!("list path is not a ToolFS directory"));
            }
            validate_pagination(args.limit, args.offset)?;
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
    if let Some(stripped) = value.strip_suffix(".tool") {
        value = stripped.to_string();
    }
    value
}

fn normalize_directory_path(path: &str) -> String {
    let mut value = path.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        value = TOOLS_ROOT.to_string();
    }
    value
}

fn normalize_doc_path(path: &str) -> String {
    let value = normalize_directory_path(path);
    if value == "/tools/README.md" {
        return TOOLS_ROOT.to_string();
    }
    if value == "/tools/manifest/README.md" {
        return TOOL_MANIFESTS.to_string();
    }
    if let Some(parent) = value.strip_suffix("/README.md") {
        return parent.to_string();
    }
    normalize_tool_path(&value)
}

fn parse_optional_args<T: Default + for<'de> Deserialize<'de>>(value: &Value) -> Result<T> {
    if value.is_null() {
        return Ok(T::default());
    }
    parse_args(value)
}

fn validate_pagination(limit: Option<usize>, _offset: Option<usize>) -> Result<()> {
    if limit.is_some_and(|value| value == 0 || value > 100) {
        return Err(anyhow!("limit must be between 1 and 100"));
    }
    Ok(())
}

fn is_directory_path(path: &str) -> bool {
    matches!(
        path,
        TOOLS_ROOT
            | TOOL_MANIFESTS
            | "/tools/filesystem"
            | "/tools/code"
            | "/tools/shell"
            | "/tools/git"
            | "/tools/memory"
            | "/tools/clarification"
            | "/tools/security"
            | "/tools/capsule"
    )
}

fn directory_entries(path: &str) -> Option<Vec<Value>> {
    match path {
        TOOLS_ROOT => Some(vec![
            entry("/tools/README.md", "document", "how to use ToolFS"),
            entry(TOOL_MANIFESTS, "directory", "paged tool manifest registry"),
            entry(TOOL_SEARCH, "tool", "recommend tools by task context"),
            entry(
                "/tools/filesystem",
                "directory",
                "read workspace files and directories",
            ),
            entry("/tools/code", "directory", "search and inspect source code"),
            entry("/tools/shell", "directory", "run short workspace commands"),
            entry("/tools/git", "directory", "inspect local git state"),
            entry(
                "/tools/memory",
                "directory",
                "inspect and update Agent Memory V2",
            ),
            entry(
                "/tools/clarification",
                "directory",
                "ask structured questions and resume blocked execution",
            ),
            entry(
                "/tools/security",
                "directory",
                "classify, redact, broker secrets, and check exfiltration",
            ),
            entry(
                "/tools/capsule",
                "directory",
                "manage local isolated Agent capsules",
            ),
        ]),
        "/tools/filesystem" => Some(vec![
            entry(
                "/tools/filesystem/README.md",
                "document",
                "filesystem tool notes",
            ),
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
        ]),
        "/tools/code" => Some(vec![
            entry("/tools/code/README.md", "document", "code tool notes"),
            entry(
                TOOL_CODE_SEARCH_CODE,
                "tool",
                "search source code with file and line snippets",
            ),
        ]),
        "/tools/shell" => Some(vec![
            entry("/tools/shell/README.md", "document", "shell tool notes"),
            entry(
                TOOL_SHELL_RUN_COMMAND,
                "tool",
                "run a short command in the bound workspace",
            ),
        ]),
        "/tools/git" => Some(vec![
            entry("/tools/git/README.md", "document", "git tool notes"),
            entry(TOOL_GIT_STATUS, "tool", "read git status"),
            entry(TOOL_GIT_DIFF, "tool", "read git diff or diff stat"),
        ]),
        "/tools/memory" => Some(vec![
            entry("/tools/memory/README.md", "document", "memory tool notes"),
            entry(
                TOOL_MEMORY_SEARCH_SESSION,
                "tool",
                "search current session memory",
            ),
            entry(
                TOOL_MEMORY_SEARCH_SHARED,
                "tool",
                "search shared structured memory",
            ),
            entry(
                TOOL_MEMORY_SEARCH_FROZEN,
                "tool",
                "search frozen structured memory",
            ),
            entry(
                TOOL_MEMORY_GET_CONTEXT_SNAPSHOT,
                "tool",
                "read current context/memory snapshot summary",
            ),
            entry(
                TOOL_MEMORY_ASSEMBLE_CONTEXT,
                "tool",
                "assemble policy-bounded Head/Pinned/Middle/Tail context",
            ),
            entry(
                TOOL_MEMORY_PROPOSE_MEMORY,
                "tool",
                "submit a memory candidate",
            ),
            entry(
                TOOL_MEMORY_UPDATE_MEMORY,
                "tool",
                "update structured memory",
            ),
            entry(
                TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE,
                "tool",
                "create a conflict candidate",
            ),
            entry(TOOL_MEMORY_AUDIT_MEMORY, "tool", "read memory audit chain"),
        ]),
        "/tools/clarification" => {
            Some(vec![
            entry(
                "/tools/clarification/README.md",
                "document",
                "clarification tool notes",
            ),
            entry(
                TOOL_CLARIFICATION_DETECT_UNCERTAINTY,
                "tool",
                "detect unresolved goal, scope, acceptance, environment, risk, or preference gaps",
            ),
            entry(
                TOOL_CLARIFICATION_CREATE_QUESTION,
                "tool",
                "create one QuestionTicket",
            ),
            entry(
                TOOL_CLARIFICATION_CREATE_QUESTION_SET,
                "tool",
                "create a related set of one to three QuestionTickets",
            ),
            entry(
                TOOL_CLARIFICATION_READ_QUESTION,
                "tool",
                "read a QuestionTicket",
            ),
            entry(
                TOOL_CLARIFICATION_LIST_OPEN_QUESTIONS,
                "tool",
                "list open clarification questions",
            ),
            entry(
                TOOL_CLARIFICATION_OPEN_PANEL,
                "tool",
                "open a Clarification Panel",
            ),
            entry(
                TOOL_CLARIFICATION_UPDATE_PANEL,
                "tool",
                "update a Clarification Panel",
            ),
            entry(
                TOOL_CLARIFICATION_READ_PANEL,
                "tool",
                "read a Clarification Panel",
            ),
            entry(
                TOOL_CLARIFICATION_CLOSE_PANEL,
                "tool",
                "close a Clarification Panel",
            ),
            entry(
                TOOL_CLARIFICATION_SUBMIT_PANEL_ANSWER,
                "tool",
                "submit A/B/C/D or Custom answer from the panel",
            ),
            entry(
                TOOL_CLARIFICATION_ANSWER_QUESTION,
                "tool",
                "write an answer to a QuestionTicket",
            ),
            entry(
                TOOL_CLARIFICATION_RECORD_ASSUMPTION,
                "tool",
                "record a low-risk reversible assumption",
            ),
            entry(
                TOOL_CLARIFICATION_REJECT_ASSUMPTION,
                "tool",
                "mark an assumption as rejected",
            ),
            entry(TOOL_CLARIFICATION_LINK_TO_TASK, "tool", "link question to task"),
            entry(
                TOOL_CLARIFICATION_LINK_TO_OPERATION,
                "tool",
                "link question to operation",
            ),
            entry(
                TOOL_CLARIFICATION_VALIDATE_READY_TO_EXECUTE,
                "tool",
                "check whether execution is still blocked by open questions",
            ),
            entry(
                TOOL_CLARIFICATION_RESUME_BLOCKED_EXECUTION,
                "tool",
                "resume execution after required answers are available",
            ),
        ])
        }
        "/tools/security" => Some(vec![
            entry(
                "/tools/security/README.md",
                "document",
                "security tool notes",
            ),
            entry(
                TOOL_SECURITY_CLASSIFY_RESOURCE,
                "tool",
                "classify sensitive resources",
            ),
            entry(TOOL_SECURITY_SCAN_TEXT, "tool", "scan text for secrets"),
            entry(
                TOOL_SECURITY_SCAN_FILE,
                "tool",
                "scan a workspace file for secrets",
            ),
            entry(
                TOOL_SECURITY_SCAN_ARTIFACT,
                "tool",
                "scan artifact content for secrets",
            ),
            entry(
                TOOL_SECURITY_REDACT_TEXT,
                "tool",
                "redact secret-like content",
            ),
            entry(
                TOOL_SECURITY_CREATE_SECRET_RECORD,
                "tool",
                "create SecretRecord metadata",
            ),
            entry(
                TOOL_SECURITY_CREATE_SECRET_HANDLE,
                "tool",
                "create scoped SecretHandle lease",
            ),
            entry(
                TOOL_SECURITY_READ_SECRET_METADATA,
                "tool",
                "read SecretRecord metadata",
            ),
            entry(
                TOOL_SECURITY_REVOKE_SECRET_HANDLE,
                "tool",
                "revoke a SecretHandle",
            ),
            entry(
                TOOL_SECURITY_CHECK_EXFILTRATION,
                "tool",
                "check outgoing content risk",
            ),
            entry(
                TOOL_SECURITY_VALIDATE_ENV_ACCESS,
                "tool",
                "validate env access or injection",
            ),
            entry(
                TOOL_SECURITY_VALIDATE_SENSITIVE_FILE_ACCESS,
                "tool",
                "validate sensitive file access",
            ),
            entry(
                TOOL_SECURITY_VALIDATE_CAPSULE_BRIDGE,
                "tool",
                "validate capsule host bridge policy",
            ),
            entry(
                TOOL_SECURITY_AUDIT_SECRET_ACCESS,
                "tool",
                "record secret access audit",
            ),
        ]),
        "/tools/capsule" => Some(vec![
            entry(
                "/tools/capsule/README.md",
                "document",
                "Agent VM tool notes",
            ),
            entry(
                TOOL_CAPSULE_READ_IMAGE_MANIFEST,
                "tool",
                "read Agent VM image manifest",
            ),
            entry(
                TOOL_CAPSULE_LIST_IMAGES,
                "tool",
                "list Agent VM images for this host",
            ),
            entry(
                TOOL_CAPSULE_DOWNLOAD_IMAGE,
                "tool",
                "download and verify Agent VM image",
            ),
            entry(
                TOOL_CAPSULE_VERIFY_IMAGE,
                "tool",
                "verify installed Agent VM image",
            ),
            entry(
                TOOL_CAPSULE_IMPORT_IMAGE,
                "tool",
                "import local Agent VM image",
            ),
            entry(TOOL_CAPSULE_CREATE, "tool", "create Agent VM instance"),
            entry(TOOL_CAPSULE_START, "tool", "start Agent VM instance"),
            entry(TOOL_CAPSULE_STOP, "tool", "stop Agent VM instance"),
            entry(TOOL_CAPSULE_DESTROY, "tool", "destroy Agent VM instance"),
            entry(TOOL_CAPSULE_STATUS, "tool", "read Agent VM status"),
            entry(TOOL_CAPSULE_EXEC, "tool", "execute command in guest"),
            entry(
                TOOL_CAPSULE_CREATE_SNAPSHOT,
                "tool",
                "create Agent VM disk snapshot",
            ),
            entry(
                TOOL_CAPSULE_RESTORE_SNAPSHOT,
                "tool",
                "restore Agent VM disk snapshot",
            ),
            entry(
                TOOL_CAPSULE_UPDATE_BRIDGE_POLICY,
                "tool",
                "update host bridge policy",
            ),
            entry(TOOL_CAPSULE_READ_GUEST_LOGS, "tool", "read guest logs"),
            entry(
                TOOL_CAPSULE_EXPORT_ARTIFACT,
                "tool",
                "export guest artifact",
            ),
            entry(
                TOOL_CAPSULE_LIST_SESSION_BINDINGS,
                "tool",
                "list Agent VM session bindings",
            ),
            entry(
                TOOL_CAPSULE_READ_SESSION_BINDING,
                "tool",
                "read Agent VM session binding",
            ),
            entry(
                TOOL_CAPSULE_ATTACH_SESSION_VM,
                "tool",
                "attach session to Agent VM",
            ),
            entry(
                TOOL_CAPSULE_TAKEOVER_SESSION_VM,
                "tool",
                "take over Agent VM for session",
            ),
            entry(
                TOOL_CAPSULE_FORK_SESSION_VM,
                "tool",
                "fork Agent VM for session",
            ),
            entry(
                TOOL_CAPSULE_CREATE_INHERITANCE_PROFILE,
                "tool",
                "create Agent VM inheritance profile",
            ),
            entry(
                TOOL_CAPSULE_APPLY_INHERITANCE_PROFILE,
                "tool",
                "apply Agent VM inheritance profile",
            ),
            entry(
                TOOL_CAPSULE_REVOKE_SESSION_BINDING,
                "tool",
                "revoke Agent VM session binding",
            ),
        ]),
        _ => None,
    }
}

struct Page {
    items: Vec<Value>,
    limit: usize,
    offset: usize,
    next_offset: Option<usize>,
}

impl Page {
    fn metadata(&self, total: usize) -> Value {
        json!({
            "total": total,
            "limit": self.limit,
            "offset": self.offset,
            "nextOffset": self.next_offset,
            "hasMore": self.next_offset.is_some()
        })
    }
}

fn paginate(entries: Vec<Value>, limit: Option<usize>, offset: Option<usize>) -> Page {
    let total = entries.len();
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let offset = offset.unwrap_or(0).min(total);
    let end = offset.saturating_add(limit).min(total);
    let next_offset = (end < total).then_some(end);
    Page {
        items: entries.into_iter().skip(offset).take(limit).collect(),
        limit,
        offset,
        next_offset,
    }
}

fn list_manifest_page(args: ListCatalogArgs) -> Result<Value> {
    validate_pagination(args.limit, args.offset)?;
    let entries = tool_manifests()
        .iter()
        .map(manifest_page_entry)
        .collect::<Vec<_>>();
    let total = entries.len();
    let page = paginate(entries, args.limit, args.offset);
    Ok(json!({
        "schemaVersion": "v1",
        "kind": "manifestPage",
        "path": TOOL_MANIFESTS,
        "entries": page.items,
        "pagination": page.metadata(total)
    }))
}

fn manifest_page_entry(manifest: &ToolManifest) -> Value {
    json!({
        "path": manifest.path,
        "kind": "toolManifest",
        "description": manifest.description,
        "domain": manifest.domain,
        "riskLevel": manifest.risk_level,
        "status": "enabled",
        "manifestRef": format!("{}.tool", manifest.path),
        "manifest": manifest_json(manifest)
    })
}

fn normalize_search_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .collect::<String>()
}

fn search_terms(query: &str) -> Vec<String> {
    let mut terms = query
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '/'))
        .map(str::trim)
        .filter(|term| term.is_empty() == false)
        .map(str::to_string)
        .collect::<Vec<_>>();
    for ch in query.chars() {
        if ('\u{4e00}'..='\u{9fff}').contains(&ch) {
            terms.push(ch.to_string());
        }
    }
    terms.sort();
    terms.dedup();
    terms
}

fn score_manifest(query: &str, manifest: &ToolManifest) -> usize {
    let haystack = normalize_search_text(&format!(
        "{} {} {} {} {} {}",
        manifest.path,
        manifest.name,
        manifest.description,
        manifest.domain,
        manifest.args,
        manifest.tags.join(" ")
    ));
    let mut score = 0_usize;
    for term in search_terms(query) {
        if term == manifest.domain {
            score += 4;
        } else if manifest.path.contains(term.as_str()) || manifest.name.contains(term.as_str()) {
            score += 3;
        } else if manifest
            .tags
            .iter()
            .any(|tag| normalize_search_text(tag) == term)
        {
            score += 2;
        } else if haystack.contains(term.as_str()) {
            score += 1;
        }
    }
    score
}

fn search_reason(query: &str, manifest: &ToolManifest) -> String {
    let terms = search_terms(query);
    let matched_tags = manifest
        .tags
        .iter()
        .filter(|tag| {
            let tag = normalize_search_text(tag);
            terms
                .iter()
                .any(|term| tag.contains(term) || term.contains(&tag))
        })
        .take(3)
        .copied()
        .collect::<Vec<_>>();
    if matched_tags.is_empty() {
        format!(
            "Matched {} manifest fields for domain {}",
            manifest.name, manifest.domain
        )
    } else {
        format!(
            "Matched capability tags [{}] in domain {}",
            matched_tags.join(", "),
            manifest.domain
        )
    }
}

pub fn tool_manifests() -> Vec<ToolManifest> {
    vec![
        manifest(
            TOOL_SEARCH,
            "search",
            "Recommend ToolFS tools for a task query.",
            "tools",
            json!({"query":"string","maxResults":"number?","domain":"string?","riskLevel":"string?"}),
            &["tool", "search", "discover", "recommend", "发现", "搜索", "工具"],
        ),
        manifest(
            TOOL_FS_LIST_FILES,
            "list_files",
            "List files and directories inside the bound workspace.",
            "filesystem",
            json!({"path":"string?","maxEntries":"number?","offset":"number?"}),
            &["file", "directory", "list", "project", "structure", "文件", "目录", "列出"],
        ),
        manifest(
            TOOL_FS_STAT_PATH,
            "stat_path",
            "Read type, size, and permission summary for a workspace path.",
            "filesystem",
            json!({"path":"string"}),
            &["file", "metadata", "stat", "size", "文件", "元数据"],
        ),
        manifest(
            TOOL_FS_READ_FILE,
            "read_file",
            "Read a UTF-8 text file inside the bound workspace.",
            "filesystem",
            json!({"path":"string","maxBytes":"number?","offsetBytes":"number?"}),
            &["file", "read", "text", "文件", "读取"],
        ),
        manifest(
            TOOL_FS_READ_RANGE,
            "read_range",
            "Read a line range from a UTF-8 text file.",
            "filesystem",
            json!({"path":"string","startLine":"number?","endLine":"number?","maxBytes":"number?"}),
            &["file", "read", "range", "lines", "文件", "读取", "行"],
        ),
        manifest(
            TOOL_FS_SEARCH_FILES,
            "search_files",
            "Find files by path, file name, or extension fragment.",
            "filesystem",
            json!({"query":"string","path":"string?","maxResults":"number?","offset":"number?"}),
            &["file", "find", "name", "glob", "extension", "文件", "查找"],
        ),
        manifest(
            TOOL_FS_SEARCH_TEXT,
            "search_text",
            "Search literal text in workspace files.",
            "filesystem",
            json!({"query":"string","path":"string?","maxResults":"number?","offset":"number?","contextLines":"number?"}),
            &["text", "grep", "search", "content", "文本", "搜索"],
        ),
        manifest(
            TOOL_FS_WALK_DIRECTORY,
            "walk_directory",
            "Return a recursive directory tree summary.",
            "filesystem",
            json!({"path":"string?","maxEntries":"number?","maxDepth":"number?","offset":"number?"}),
            &["tree", "directory", "walk", "structure", "目录", "遍历"],
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
            tags: &["patch", "diff", "preview", "proposal", "edit", "补丁", "预览", "修改"],
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
            tags: &["patch", "diff", "apply", "approval", "edit", "补丁", "应用", "修改"],
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
            tags: &["patch", "diff", "rollback", "approval", "edit", "补丁", "回滚", "修改"],
        },
        ToolManifest {
            path: TOOL_SHELL_RUN_COMMAND,
            name: "run_command",
            description:
                "Run a short workspace command with argv or shell mode, cwd validation, output caps, and policy approval.",
            domain: "shell",
            risk_level: "high",
            side_effect: "process",
            args: json!({
                "mode": "\"argv\" | \"shell\"?",
                "argv": "string[]?",
                "command": "string?",
                "cwd": "string?",
                "env": "Record<string,string>?",
                "secretEnv": "Record<string,SecretHandleId>?",
                "capsuleId": "string?",
                "timeoutMs": "number?",
                "outputLimitBytes": "number?",
                "purpose": "string?"
            }),
            returns: json!({
                "type": "object",
                "description": "Command status, exit code, redacted stdout/stderr, artifact/evidence refs, and verification run refs."
            }),
            tags: &["shell", "command", "test", "verify", "lint", "build", "命令", "测试", "构建"],
        },
        manifest(
            TOOL_CODE_SEARCH_CODE,
            "search_code",
            "Search source code files and return line snippets.",
            "code",
            json!({"query":"string","path":"string?","maxResults":"number?","offset":"number?","contextLines":"number?"}),
            &["code", "source", "search", "function", "symbol", "代码", "搜索", "符号"],
        ),
        manifest(
            TOOL_GIT_STATUS,
            "status",
            "Read git status for the bound workspace.",
            "git",
            json!({"maxBytes":"number?"}),
            &["git", "status", "changes", "状态", "变更"],
        ),
        manifest(
            TOOL_GIT_DIFF,
            "diff",
            "Read git diff or diff stat for the bound workspace.",
            "git",
            json!({"stat":"boolean?","maxBytes":"number?"}),
            &["git", "diff", "changes", "patch", "差异", "变更"],
        ),
        manifest(
            TOOL_MEMORY_SEARCH_SESSION,
            "search_session",
            "Search current Agent session memory, including live dialog and cut archives.",
            "memory",
            json!({"query":"string","limit":"number?"}),
            &["memory", "session", "search", "archive", "记忆", "会话", "搜索"],
        ),
        ToolManifest {
            path: TOOL_MEMORY_SEARCH_SHARED,
            name: "search_shared",
            description: "Search shared structured memory truth.",
            domain: "memory",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"query":"string","limit":"number?"}),
            returns: json!({"type":"object","description":"Shared memory search results with refs and revisions."}),
            tags: &["memory", "shared", "search", "truth", "共享", "记忆"],
        },
        ToolManifest {
            path: TOOL_MEMORY_SEARCH_FROZEN,
            name: "search_frozen",
            description: "Search frozen structured memory truth.",
            domain: "memory",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"query":"string","limit":"number?"}),
            returns: json!({"type":"object","description":"Frozen memory search results with refs and revisions."}),
            tags: &["memory", "frozen", "search", "truth", "冻结", "记忆"],
        },
        manifest(
            TOOL_MEMORY_GET_CONTEXT_SNAPSHOT,
            "get_context_snapshot",
            "Read the current Agent memory context snapshot summary.",
            "memory",
            json!({"includePinned":"boolean?"}),
            &["memory", "context", "snapshot", "记忆", "上下文"],
        ),
        manifest(
            TOOL_MEMORY_ASSEMBLE_CONTEXT,
            "assemble_context",
            "Assemble a policy-bounded Head/Pinned/Middle/Tail context view.",
            "memory",
            json!({"maxChars":"number?"}),
            &["memory", "context", "assemble", "pinned", "上下文", "组装"],
        ),
        ToolManifest {
            path: TOOL_MEMORY_PROPOSE_MEMORY,
            name: "propose_memory",
            description: "Submit a structured memory candidate for Model Gateway scoring.",
            domain: "memory",
            risk_level: "medium",
            side_effect: "memory_write",
            args: json!({"scope":"\"shared\" | \"frozen\"?","namespace":"string?","kind":"string","value":"json","evidenceRefs":"string[]?"}),
            returns: json!({"type":"object","description":"Candidate memory id and status."}),
            tags: &["memory", "candidate", "propose", "model_gateway", "候选", "记忆"],
        },
        ToolManifest {
            path: TOOL_MEMORY_UPDATE_MEMORY,
            name: "update_memory",
            description: "Update structured memory value or status with an audit entry.",
            domain: "memory",
            risk_level: "high",
            side_effect: "memory_write",
            args: json!({"scope":"\"shared\" | \"frozen\"","memoryId":"string","status":"string?","value":"json?","evidenceRefs":"string[]?"}),
            returns: json!({"type":"object","description":"Updated memory record."}),
            tags: &["memory", "update", "audit", "truth", "更新", "记忆"],
        },
        ToolManifest {
            path: TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE,
            name: "create_conflict_candidate",
            description: "Create a structured conflict candidate without promoting it.",
            domain: "memory",
            risk_level: "medium",
            side_effect: "memory_write",
            args: json!({"scope":"\"shared\" | \"frozen\"?","namespace":"string?","kind":"string","value":"json","conflictsWith":"string[]?","evidenceRefs":"string[]?"}),
            returns: json!({"type":"object","description":"Conflict set id and candidate memory id."}),
            tags: &["memory", "conflict", "negative", "候选", "冲突", "记忆"],
        },
        manifest(
            TOOL_MEMORY_AUDIT_MEMORY,
            "audit_memory",
            "Read memory audit entries.",
            "memory",
            json!({"scope":"\"shared\" | \"frozen\"?","limit":"number?"}),
            &["memory", "audit", "trace", "审计", "记忆"],
        ),
        manifest(
            TOOL_CLARIFICATION_DETECT_UNCERTAINTY,
            "detect_uncertainty",
            "Detect unresolved uncertainty before execution.",
            "clarification",
            json!({"runtimeTurnId":"string?","scope":"string?","signals":"json?"}),
            &["clarification", "question", "uncertainty", "提问", "澄清"],
        ),
        manifest(
            TOOL_CLARIFICATION_CREATE_QUESTION,
            "create_question",
            "Create a single QuestionTicket.",
            "clarification",
            json!({"question":"string","whyItMatters":"string","options":"A/B/C/D[]","blockingLevel":"string"}),
            &["clarification", "question", "ticket", "提问"],
        ),
        manifest(
            TOOL_CLARIFICATION_CREATE_QUESTION_SET,
            "create_question_set",
            "Create one to three related QuestionTickets.",
            "clarification",
            json!({"questions":"QuestionTicketInput[]"}),
            &["clarification", "question", "set", "提问"],
        ),
        manifest(
            TOOL_CLARIFICATION_READ_QUESTION,
            "read_question",
            "Read a QuestionTicket.",
            "clarification",
            json!({"questionTicketId":"string"}),
            &["clarification", "question", "read", "读取"],
        ),
        manifest(
            TOOL_CLARIFICATION_LIST_OPEN_QUESTIONS,
            "list_open_questions",
            "List open QuestionTickets for the active session.",
            "clarification",
            json!({"limit":"number?"}),
            &["clarification", "question", "list", "列出"],
        ),
        ToolManifest {
            path: TOOL_CLARIFICATION_OPEN_PANEL,
            name: "open_panel",
            description: "Open a Clarification Panel bound to one to three QuestionTickets.",
            domain: "clarification",
            risk_level: "medium",
            side_effect: "runtime_state",
            args: json!({"title":"string","description":"string","questions":"QuestionTicketInput[]","blocksExecution":"boolean","presentation":"modal | side_panel | inline_card"}),
            returns: json!({"type":"object","description":"Panel id, question ids, and blocked execution metadata."}),
            tags: &["clarification", "panel", "question", "提问", "面板"],
        },
        manifest(
            TOOL_CLARIFICATION_UPDATE_PANEL,
            "update_panel",
            "Update Clarification Panel presentation or status.",
            "clarification",
            json!({"panelId":"string","status":"string?","presentation":"string?"}),
            &["clarification", "panel", "update", "更新"],
        ),
        manifest(
            TOOL_CLARIFICATION_READ_PANEL,
            "read_panel",
            "Read a Clarification Panel.",
            "clarification",
            json!({"panelId":"string"}),
            &["clarification", "panel", "read", "读取"],
        ),
        ToolManifest {
            path: TOOL_CLARIFICATION_CLOSE_PANEL,
            name: "close_panel",
            description: "Close a submitted, cancelled, expired, or superseded Clarification Panel.",
            domain: "clarification",
            risk_level: "medium",
            side_effect: "runtime_state",
            args: json!({"panelId":"string","status":"submitted | cancelled | expired | closed"}),
            returns: json!({"type":"object","description":"Closed panel status."}),
            tags: &["clarification", "panel", "close", "关闭"],
        },
        ToolManifest {
            path: TOOL_CLARIFICATION_SUBMIT_PANEL_ANSWER,
            name: "submit_panel_answer",
            description: "Submit A/B/C/D or Custom answer payload from a Clarification Panel.",
            domain: "clarification",
            risk_level: "medium",
            side_effect: "runtime_state",
            args: json!({"panelId":"string","answers":"PanelAnswer[]"}),
            returns: json!({"type":"object","description":"Submitted answers and resumed execution status."}),
            tags: &["clarification", "answer", "panel", "提交", "回答"],
        },
        ToolManifest {
            path: TOOL_CLARIFICATION_ANSWER_QUESTION,
            name: "answer_question",
            description: "Write one answer into a QuestionTicket.",
            domain: "clarification",
            risk_level: "medium",
            side_effect: "runtime_state",
            args: json!({"questionTicketId":"string","selectedOptionId":"A | B | C | D?","customAnswer":"string?"}),
            returns: json!({"type":"object","description":"Answered QuestionTicket."}),
            tags: &["clarification", "answer", "question", "回答"],
        },
        manifest(
            TOOL_CLARIFICATION_RECORD_ASSUMPTION,
            "record_assumption",
            "Record a low-risk reversible AssumptionRecord.",
            "clarification",
            json!({"statement":"string","basis":"string","riskLevel":"low | medium","reversible":"boolean"}),
            &["clarification", "assumption", "假设"],
        ),
        ToolManifest {
            path: TOOL_CLARIFICATION_REJECT_ASSUMPTION,
            name: "reject_assumption",
            description: "Reject a prior assumption and route affected work to correction or rollback.",
            domain: "clarification",
            risk_level: "medium",
            side_effect: "runtime_state",
            args: json!({"assumptionId":"string","reason":"string?"}),
            returns: json!({"type":"object","description":"Rejected assumption status."}),
            tags: &["clarification", "assumption", "reject", "否定"],
        },
        manifest(
            TOOL_CLARIFICATION_LINK_TO_TASK,
            "link_to_task",
            "Link a QuestionTicket to a task.",
            "clarification",
            json!({"questionTicketId":"string","taskId":"string"}),
            &["clarification", "task", "link", "绑定"],
        ),
        manifest(
            TOOL_CLARIFICATION_LINK_TO_OPERATION,
            "link_to_operation",
            "Link a QuestionTicket to a tool or runtime operation.",
            "clarification",
            json!({"questionTicketId":"string","operationId":"string"}),
            &["clarification", "operation", "link", "绑定"],
        ),
        manifest(
            TOOL_CLARIFICATION_VALIDATE_READY_TO_EXECUTE,
            "validate_ready_to_execute",
            "Validate that no blocking open clarification remains.",
            "clarification",
            json!({"runtimeTurnId":"string?"}),
            &["clarification", "validate", "execute", "校验"],
        ),
        ToolManifest {
            path: TOOL_CLARIFICATION_RESUME_BLOCKED_EXECUTION,
            name: "resume_blocked_execution",
            description: "Resume a blocked RuntimeTurn after required clarification answers are present.",
            domain: "clarification",
            risk_level: "medium",
            side_effect: "runtime_state",
            args: json!({"runtimeTurnId":"string","resumeToken":"string?"}),
            returns: json!({"type":"object","description":"Runtime resume status."}),
            tags: &["clarification", "resume", "runtime", "恢复"],
        },
        manifest(
            TOOL_SECURITY_CLASSIFY_RESOURCE,
            "classify_resource",
            "Classify whether a file, env, artifact, model input, or capsule bridge resource is sensitive.",
            "security",
            json!({"resourceKind":"string","resourceRef":"string"}),
            &["security", "classify", "sensitive", "secret", "安全", "敏感"],
        ),
        manifest(
            TOOL_SECURITY_SCAN_TEXT,
            "scan_text",
            "Scan text for secret-like values and return a redacted projection.",
            "security",
            json!({"text":"string","resourceKind":"string?","resourceRef":"string?"}),
            &["security", "scan", "secret", "redact", "安全", "扫描", "密钥"],
        ),
        ToolManifest {
            path: TOOL_SECURITY_SCAN_FILE,
            name: "scan_file",
            description: "Scan a workspace file for secret-like values.",
            domain: "security",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"path":"string","maxBytes":"number?"}),
            returns: json!({"type":"object","description":"Secret detection report and redacted preview."}),
            tags: &["security", "file", "scan", "secret", "安全", "文件", "扫描"],
        },
        ToolManifest {
            path: TOOL_SECURITY_SCAN_ARTIFACT,
            name: "scan_artifact",
            description: "Scan artifact content or a provided artifact ref for secret-like values.",
            domain: "security",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"artifactId":"string?","content":"string?"}),
            returns: json!({"type":"object","description":"Secret detection report and redacted preview."}),
            tags: &["security", "artifact", "scan", "secret", "安全", "产物"],
        },
        manifest(
            TOOL_SECURITY_REDACT_TEXT,
            "redact_text",
            "Redact secret-like values from text.",
            "security",
            json!({"text":"string"}),
            &["security", "redact", "secret", "安全", "脱敏"],
        ),
        ToolManifest {
            path: TOOL_SECURITY_CREATE_SECRET_RECORD,
            name: "create_secret_record",
            description: "Create SecretRecord metadata and optional local secret storage without exposing raw value to the model.",
            domain: "security",
            risk_level: "high",
            side_effect: "secret_write",
            args: json!({"kind":"string","label":"string","provider":"string?","value":"string?","storageRef":"string?","scope":"object?","expiresAt":"string?"}),
            returns: json!({"type":"object","description":"Created SecretRecord metadata without raw value."}),
            tags: &["security", "secret", "broker", "handle", "安全", "密钥"],
        },
        ToolManifest {
            path: TOOL_SECURITY_CREATE_SECRET_HANDLE,
            name: "create_secret_handle",
            description: "Create a scoped temporary SecretHandle lease for a tool operation.",
            domain: "security",
            risk_level: "high",
            side_effect: "secret_handle",
            args: json!({"secretId":"string","grantedToToolPath":"string","grantedForOperationId":"string","allowedTarget":"string","revealMode":"string?","ttlSeconds":"number?"}),
            returns: json!({"type":"object","description":"SecretHandle lease metadata without raw value."}),
            tags: &["security", "secret", "handle", "lease", "安全", "密钥"],
        },
        ToolManifest {
            path: TOOL_SECURITY_READ_SECRET_METADATA,
            name: "read_secret_metadata",
            description: "Read SecretRecord metadata without reading raw secret value.",
            domain: "security",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"secretId":"string"}),
            returns: json!({"type":"object","description":"Secret metadata only."}),
            tags: &["security", "secret", "metadata", "安全", "密钥"],
        },
        ToolManifest {
            path: TOOL_SECURITY_REVOKE_SECRET_HANDLE,
            name: "revoke_secret_handle",
            description: "Revoke a scoped SecretHandle lease.",
            domain: "security",
            risk_level: "medium",
            side_effect: "secret_handle",
            args: json!({"handleId":"string"}),
            returns: json!({"type":"object","description":"Revocation status."}),
            tags: &["security", "secret", "revoke", "安全", "撤销"],
        },
        ToolManifest {
            path: TOOL_SECURITY_CHECK_EXFILTRATION,
            name: "check_exfiltration",
            description: "Check outgoing model, HTTP, artifact export, browser, or capsule bridge content for exfiltration risk.",
            domain: "security",
            risk_level: "medium",
            side_effect: "security_audit",
            args: json!({"targetKind":"string","targetRef":"string","content":"string","operationId":"string?"}),
            returns: json!({"type":"object","description":"Exfiltration decision and redacted projection if needed."}),
            tags: &["security", "exfiltration", "model", "http", "安全", "外泄"],
        },
        ToolManifest {
            path: TOOL_SECURITY_VALIDATE_ENV_ACCESS,
            name: "validate_env_access",
            description: "Validate environment variable read or injection policy.",
            domain: "security",
            risk_level: "medium",
            side_effect: "security_audit",
            args: json!({"env":"Record<string,string>?","names":"string[]?","mode":"string?","toolPath":"string?"}),
            returns: json!({"type":"object","description":"Env access decision."}),
            tags: &["security", "env", "secret", "安全", "环境变量"],
        },
        ToolManifest {
            path: TOOL_SECURITY_VALIDATE_SENSITIVE_FILE_ACCESS,
            name: "validate_sensitive_file_access",
            description: "Validate sensitive file read, write, delete, or export access.",
            domain: "security",
            risk_level: "medium",
            side_effect: "security_audit",
            args: json!({"path":"string","access":"string?"}),
            returns: json!({"type":"object","description":"Sensitive file decision."}),
            tags: &["security", "file", "secret", "安全", "敏感文件"],
        },
        ToolManifest {
            path: TOOL_SECURITY_VALIDATE_CAPSULE_BRIDGE,
            name: "validate_capsule_bridge",
            description: "Validate capsule host bridge policy for mounts, secrets, env, SSH agent, network, and ports.",
            domain: "security",
            risk_level: "high",
            side_effect: "security_audit",
            args: json!({"capsuleId":"string?","bridgePolicy":"object"}),
            returns: json!({"type":"object","description":"Capsule bridge decision and audit ref."}),
            tags: &["security", "capsule", "bridge", "host", "安全", "隔离舱"],
        },
        ToolManifest {
            path: TOOL_SECURITY_AUDIT_SECRET_ACCESS,
            name: "audit_secret_access",
            description: "Record a structured secret access audit event.",
            domain: "security",
            risk_level: "medium",
            side_effect: "security_audit",
            args: json!({"secretId":"string?","handleId":"string?","operationId":"string?","accessKind":"string","targetRef":"string","decision":"string?","reasonCodes":"string[]?"}),
            returns: json!({"type":"object","description":"Secret access audit record."}),
            tags: &["security", "secret", "audit", "安全", "审计"],
        },
        manifest(
            TOOL_CAPSULE_READ_IMAGE_MANIFEST,
            "read_image_manifest",
            "Read the capsule image manifest.",
            "capsule",
            json!({"manifestRef":"string?"}),
            &["capsule", "image", "manifest", "隔离舱", "镜像"],
        ),
        manifest(
            TOOL_CAPSULE_LIST_IMAGES,
            "list_images",
            "List capsule images matching this host architecture.",
            "capsule",
            json!({"manifestRef":"string?"}),
            &["capsule", "image", "list", "隔离舱", "镜像"],
        ),
        ToolManifest {
            path: TOOL_CAPSULE_DOWNLOAD_IMAGE,
            name: "download_image",
            description: "Download a capsule image from manifest or explicit URL and verify sha256 when configured.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "download",
            args: json!({"imageId":"string","url":"string?","arch":"string?"}),
            returns: json!({"type":"object","description":"Image download/install record."}),
            tags: &["capsule", "image", "download", "checksum", "隔离舱", "下载"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_VERIFY_IMAGE,
            name: "verify_image",
            description: "Verify installed capsule image sha256 and optional GPG signature.",
            domain: "capsule",
            risk_level: "medium",
            side_effect: "security_audit",
            args: json!({"imageId":"string","signaturePath":"string?"}),
            returns: json!({"type":"object","description":"Image verification record."}),
            tags: &["capsule", "image", "verify", "checksum", "隔离舱", "校验"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_IMPORT_IMAGE,
            name: "import_image",
            description: "Import a local capsule image into the image store.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "workspace_write",
            args: json!({"imageId":"string","filePath":"string","name":"string?","arch":"string?","format":"string?","checksum":"string?"}),
            returns: json!({"type":"object","description":"Image import record."}),
            tags: &["capsule", "image", "import", "隔离舱", "导入"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_CREATE,
            name: "create",
            description: "Create a capsule instance from an installed image and bridge policy.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "capsule_lifecycle",
            args: json!({"capsuleId":"string?","imageId":"string","projectId":"string?","workspaceRoot":"string?","guestWorkspacePath":"string?","bridgePolicy":"object?","memoryMib":"number?","cpuCount":"number?"}),
            returns: json!({"type":"object","description":"Created capsule instance."}),
            tags: &["capsule", "create", "vm", "qemu", "隔离舱", "创建"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_START,
            name: "start",
            description: "Start a capsule instance using the QEMU backend.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "capsule_lifecycle",
            args: json!({"capsuleId":"string","backend":"string?"}),
            returns: json!({"type":"object","description":"Started capsule state or typed backend error."}),
            tags: &["capsule", "start", "qemu", "guest", "隔离舱", "启动"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_STOP,
            name: "stop",
            description: "Stop a running capsule instance.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "capsule_lifecycle",
            args: json!({"capsuleId":"string"}),
            returns: json!({"type":"object","description":"Stopped capsule state."}),
            tags: &["capsule", "stop", "guest", "隔离舱", "停止"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_DESTROY,
            name: "destroy",
            description: "Destroy a capsule instance and local instance state.",
            domain: "capsule",
            risk_level: "critical",
            side_effect: "capsule_destroy",
            args: json!({"capsuleId":"string"}),
            returns: json!({"type":"object","description":"Destroy status."}),
            tags: &["capsule", "destroy", "delete", "隔离舱", "销毁"],
        },
        manifest(
            TOOL_CAPSULE_STATUS,
            "status",
            "Read capsule instance status.",
            "capsule",
            json!({"capsuleId":"string"}),
            &["capsule", "status", "guest", "隔离舱", "状态"],
        ),
        ToolManifest {
            path: TOOL_CAPSULE_EXEC,
            name: "exec",
            description: "Execute a command in the capsule guest over the guest channel.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "process",
            args: json!({"capsuleId":"string","command":"string?","argv":"string[]?","timeoutMs":"number?","outputLimitBytes":"number?"}),
            returns: json!({"type":"object","description":"Guest command status and redacted output."}),
            tags: &["capsule", "exec", "command", "guest", "隔离舱", "命令"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_CREATE_SNAPSHOT,
            name: "create_snapshot",
            description: "Create a capsule disk snapshot.",
            domain: "capsule",
            risk_level: "medium",
            side_effect: "capsule_snapshot",
            args: json!({"capsuleId":"string","snapshotId":"string?"}),
            returns: json!({"type":"object","description":"Snapshot creation status."}),
            tags: &["capsule", "snapshot", "隔离舱", "快照"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_RESTORE_SNAPSHOT,
            name: "restore_snapshot",
            description: "Restore a capsule disk snapshot.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "capsule_snapshot",
            args: json!({"capsuleId":"string","snapshotId":"string"}),
            returns: json!({"type":"object","description":"Snapshot restore status."}),
            tags: &["capsule", "snapshot", "restore", "隔离舱", "恢复"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_UPDATE_BRIDGE_POLICY,
            name: "update_bridge_policy",
            description: "Update capsule host bridge policy after Security Gate validation.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "capsule_bridge",
            args: json!({"capsuleId":"string","bridgePolicy":"object"}),
            returns: json!({"type":"object","description":"Bridge policy update status."}),
            tags: &["capsule", "bridge", "security", "隔离舱", "桥接"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_READ_GUEST_LOGS,
            name: "read_guest_logs",
            description: "Read capsule guest logs.",
            domain: "capsule",
            risk_level: "medium",
            side_effect: "none",
            args: json!({"capsuleId":"string"}),
            returns: json!({"type":"object","description":"Guest log output."}),
            tags: &["capsule", "logs", "guest", "隔离舱", "日志"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_EXPORT_ARTIFACT,
            name: "export_artifact",
            description: "Export a guest artifact to host storage; caller must scan before external release.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "artifact_export",
            args: json!({"capsuleId":"string","guestPath":"string","outputName":"string?"}),
            returns: json!({"type":"object","description":"Exported host path and checksum."}),
            tags: &["capsule", "artifact", "export", "隔离舱", "产物"],
        },
        manifest(
            TOOL_CAPSULE_LIST_SESSION_BINDINGS,
            "list_session_bindings",
            "List Agent VM bindings by session or globally.",
            "capsule",
            json!({"sessionId":"string?"}),
            &["agent_vm", "binding", "session", "vm", "会话", "虚拟机"],
        ),
        manifest(
            TOOL_CAPSULE_READ_SESSION_BINDING,
            "read_session_binding",
            "Read the Agent VM binding for a session or VM id.",
            "capsule",
            json!({"sessionId":"string?","vmId":"string?"}),
            &["agent_vm", "binding", "read", "session", "vm", "虚拟机"],
        ),
        ToolManifest {
            path: TOOL_CAPSULE_ATTACH_SESSION_VM,
            name: "attach_session_vm",
            description: "Attach a session to an existing Agent VM.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "agent_vm_session_binding",
            args: json!({"sessionId":"string","vmId":"string","attachMode":"shared|exclusive?"}),
            returns: json!({"type":"object","description":"Updated Agent VM binding."}),
            tags: &["agent_vm", "attach", "session", "vm", "虚拟机", "会话"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_TAKEOVER_SESSION_VM,
            name: "takeover_session_vm",
            description: "Make a session the exclusive owner of an Agent VM.",
            domain: "capsule",
            risk_level: "critical",
            side_effect: "agent_vm_session_binding",
            args: json!({"sessionId":"string","vmId":"string","reason":"string?"}),
            returns: json!({"type":"object","description":"Updated exclusive Agent VM binding."}),
            tags: &["agent_vm", "takeover", "exclusive", "vm", "虚拟机"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_FORK_SESSION_VM,
            name: "fork_session_vm",
            description: "Fork an Agent VM disk state into a new session VM.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "agent_vm_session_binding",
            args: json!({"sessionId":"string","sourceVmId":"string","snapshotId":"string?","newVmId":"string?"}),
            returns: json!({"type":"object","description":"Forked Agent VM binding."}),
            tags: &["agent_vm", "fork", "snapshot", "vm", "继承", "虚拟机"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_CREATE_INHERITANCE_PROFILE,
            name: "create_inheritance_profile",
            description: "Create an explicit Agent VM state inheritance profile.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "agent_vm_inheritance",
            args: json!({"sessionId":"string","sourceVmId":"string","profileId":"string?","include":"string[]?","expiresAt":"string?","description":"string?"}),
            returns: json!({"type":"object","description":"Created inheritance profile."}),
            tags: &["agent_vm", "inheritance", "profile", "vm", "登录态", "继承"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_APPLY_INHERITANCE_PROFILE,
            name: "apply_inheritance_profile",
            description: "Apply an Agent VM inheritance profile by forking a bound VM.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "agent_vm_inheritance",
            args: json!({"sessionId":"string","profileId":"string","newVmId":"string?"}),
            returns: json!({"type":"object","description":"Applied inheritance profile and binding."}),
            tags: &["agent_vm", "inheritance", "apply", "vm", "继承"],
        },
        ToolManifest {
            path: TOOL_CAPSULE_REVOKE_SESSION_BINDING,
            name: "revoke_session_binding",
            description: "Detach a session from an Agent VM binding.",
            domain: "capsule",
            risk_level: "high",
            side_effect: "agent_vm_session_binding",
            args: json!({"sessionId":"string","vmId":"string"}),
            returns: json!({"type":"object","description":"Revoked Agent VM binding."}),
            tags: &["agent_vm", "detach", "revoke", "session", "虚拟机"],
        },
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
        TOOL_SHELL_RUN_COMMAND => {
            let args = parse_args::<RunCommandArgs>(args)?;
            let mode = args.mode.as_deref().unwrap_or("argv");
            match mode {
                "argv" => {
                    let argv = args
                        .argv
                        .as_ref()
                        .ok_or_else(|| anyhow!("argv is required"))?;
                    if argv.is_empty() {
                        return Err(anyhow!("argv is required"));
                    }
                    require_non_empty("argv[0]", &argv[0])
                }
                "shell" => {
                    let command = args
                        .command
                        .as_deref()
                        .ok_or_else(|| anyhow!("command is required"))?;
                    require_non_empty("command", command)
                }
                _ => Err(anyhow!("mode must be argv or shell")),
            }
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
        TOOL_MEMORY_SEARCH_SESSION | TOOL_MEMORY_SEARCH_SHARED | TOOL_MEMORY_SEARCH_FROZEN => {
            let args = parse_args::<MemorySearchArgs>(args)?;
            require_non_empty("query", &args.query)
        }
        TOOL_MEMORY_GET_CONTEXT_SNAPSHOT => {
            parse_args::<MemoryContextSnapshotArgs>(args)?;
            Ok(())
        }
        TOOL_MEMORY_ASSEMBLE_CONTEXT => {
            parse_args::<MemoryAssembleContextArgs>(args)?;
            Ok(())
        }
        TOOL_MEMORY_PROPOSE_MEMORY => {
            let args = parse_args::<MemoryProposeArgs>(args)?;
            require_non_empty("kind", &args.kind)?;
            validate_memory_scope_arg(args.scope.as_deref().unwrap_or("shared"))
        }
        TOOL_MEMORY_UPDATE_MEMORY => {
            let args = parse_args::<MemoryUpdateArgs>(args)?;
            validate_memory_scope_arg(&args.scope)?;
            require_non_empty("memoryId", &args.memory_id)
        }
        TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE => {
            let args = parse_args::<MemoryConflictArgs>(args)?;
            require_non_empty("kind", &args.kind)?;
            validate_memory_scope_arg(args.scope.as_deref().unwrap_or("shared"))
        }
        TOOL_MEMORY_AUDIT_MEMORY => {
            let args = parse_args::<MemoryAuditArgs>(args)?;
            validate_memory_scope_arg(args.scope.as_deref().unwrap_or("shared"))
        }
        path if path.starts_with("/tools/clarification/") => {
            validate_clarification_args(path, args)
        }
        TOOL_SECURITY_CLASSIFY_RESOURCE => require_json_string(args, "resourceKind")
            .and_then(|_| require_json_string(args, "resourceRef")),
        TOOL_SECURITY_SCAN_TEXT | TOOL_SECURITY_REDACT_TEXT => require_json_string(args, "text"),
        TOOL_SECURITY_SCAN_FILE => require_json_string(args, "path"),
        TOOL_SECURITY_SCAN_ARTIFACT => {
            if args.get("artifactId").and_then(Value::as_str).is_some()
                || args.get("content").and_then(Value::as_str).is_some()
            {
                Ok(())
            } else {
                Err(anyhow!("artifactId or content is required"))
            }
        }
        TOOL_SECURITY_CREATE_SECRET_RECORD => {
            require_json_string(args, "kind").and_then(|_| require_json_string(args, "label"))
        }
        TOOL_SECURITY_CREATE_SECRET_HANDLE => require_json_string(args, "secretId")
            .and_then(|_| require_json_string(args, "grantedToToolPath"))
            .and_then(|_| require_json_string(args, "grantedForOperationId"))
            .and_then(|_| require_json_string(args, "allowedTarget")),
        TOOL_SECURITY_READ_SECRET_METADATA => require_json_string(args, "secretId"),
        TOOL_SECURITY_REVOKE_SECRET_HANDLE => require_json_string(args, "handleId"),
        TOOL_SECURITY_CHECK_EXFILTRATION => require_json_string(args, "targetKind")
            .and_then(|_| require_json_string(args, "targetRef"))
            .and_then(|_| require_json_string(args, "content")),
        TOOL_SECURITY_VALIDATE_ENV_ACCESS => Ok(()),
        TOOL_SECURITY_VALIDATE_SENSITIVE_FILE_ACCESS => require_json_string(args, "path"),
        TOOL_SECURITY_VALIDATE_CAPSULE_BRIDGE => {
            if args.get("bridgePolicy").is_some() {
                Ok(())
            } else {
                Err(anyhow!("bridgePolicy is required"))
            }
        }
        TOOL_SECURITY_AUDIT_SECRET_ACCESS => require_json_string(args, "accessKind")
            .and_then(|_| require_json_string(args, "targetRef")),
        TOOL_CAPSULE_READ_IMAGE_MANIFEST | TOOL_CAPSULE_LIST_IMAGES => Ok(()),
        TOOL_CAPSULE_LIST_SESSION_BINDINGS => Ok(()),
        TOOL_CAPSULE_READ_SESSION_BINDING => {
            if args.get("sessionId").is_some() || args.get("vmId").is_some() {
                Ok(())
            } else {
                Err(anyhow!("sessionId or vmId is required"))
            }
        }
        TOOL_CAPSULE_DOWNLOAD_IMAGE
        | TOOL_CAPSULE_VERIFY_IMAGE
        | TOOL_CAPSULE_IMPORT_IMAGE
        | TOOL_CAPSULE_CREATE => require_json_string(args, "imageId"),
        TOOL_CAPSULE_START
        | TOOL_CAPSULE_STOP
        | TOOL_CAPSULE_DESTROY
        | TOOL_CAPSULE_STATUS
        | TOOL_CAPSULE_EXEC
        | TOOL_CAPSULE_CREATE_SNAPSHOT
        | TOOL_CAPSULE_RESTORE_SNAPSHOT
        | TOOL_CAPSULE_UPDATE_BRIDGE_POLICY
        | TOOL_CAPSULE_READ_GUEST_LOGS
        | TOOL_CAPSULE_EXPORT_ARTIFACT => require_json_string(args, "capsuleId"),
        TOOL_CAPSULE_ATTACH_SESSION_VM
        | TOOL_CAPSULE_TAKEOVER_SESSION_VM
        | TOOL_CAPSULE_REVOKE_SESSION_BINDING => {
            require_json_string(args, "sessionId").and_then(|_| require_json_string(args, "vmId"))
        }
        TOOL_CAPSULE_FORK_SESSION_VM => require_json_string(args, "sessionId")
            .and_then(|_| require_json_string(args, "sourceVmId")),
        TOOL_CAPSULE_CREATE_INHERITANCE_PROFILE => require_json_string(args, "sessionId")
            .and_then(|_| require_json_string(args, "sourceVmId")),
        TOOL_CAPSULE_APPLY_INHERITANCE_PROFILE => require_json_string(args, "sessionId")
            .and_then(|_| require_json_string(args, "profileId")),
        _ => Err(anyhow!("ToolFS runnable tool not found: {path}")),
    }
}

fn require_json_string(args: &Value, name: &str) -> Result<()> {
    let value = args
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("{name} is required"))?;
    require_non_empty(name, value)
}

fn validate_clarification_args(path: &str, args: &Value) -> Result<()> {
    match path {
        TOOL_CLARIFICATION_DETECT_UNCERTAINTY
        | TOOL_CLARIFICATION_LIST_OPEN_QUESTIONS
        | TOOL_CLARIFICATION_VALIDATE_READY_TO_EXECUTE => Ok(()),
        TOOL_CLARIFICATION_CREATE_QUESTION => require_json_string(args, "question")
            .and_then(|_| require_json_string(args, "whyItMatters")),
        TOOL_CLARIFICATION_CREATE_QUESTION_SET | TOOL_CLARIFICATION_OPEN_PANEL => {
            if args
                .get("questions")
                .and_then(Value::as_array)
                .is_some_and(|items| items.is_empty() == false && items.len() <= 3)
            {
                Ok(())
            } else {
                Err(anyhow!("questions must contain 1 to 3 items"))
            }
        }
        TOOL_CLARIFICATION_READ_QUESTION | TOOL_CLARIFICATION_ANSWER_QUESTION => {
            require_json_string(args, "questionTicketId")
        }
        TOOL_CLARIFICATION_UPDATE_PANEL
        | TOOL_CLARIFICATION_READ_PANEL
        | TOOL_CLARIFICATION_CLOSE_PANEL
        | TOOL_CLARIFICATION_SUBMIT_PANEL_ANSWER => require_json_string(args, "panelId"),
        TOOL_CLARIFICATION_RECORD_ASSUMPTION => require_json_string(args, "statement"),
        TOOL_CLARIFICATION_REJECT_ASSUMPTION => require_json_string(args, "assumptionId"),
        TOOL_CLARIFICATION_LINK_TO_TASK => require_json_string(args, "questionTicketId")
            .and_then(|_| require_json_string(args, "taskId")),
        TOOL_CLARIFICATION_LINK_TO_OPERATION => require_json_string(args, "questionTicketId")
            .and_then(|_| require_json_string(args, "operationId")),
        TOOL_CLARIFICATION_RESUME_BLOCKED_EXECUTION => require_json_string(args, "runtimeTurnId"),
        _ => Err(anyhow!("ToolFS runnable tool not found: {path}")),
    }
}

fn validate_memory_scope_arg(scope: &str) -> Result<()> {
    match scope {
        "shared" | "frozen" => Ok(()),
        _ => Err(anyhow!("memory scope must be shared or frozen")),
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
    let mut value = json!({
        "path": path,
        "kind": kind,
        "description": description
    });
    if kind == "tool" {
        value["manifestRef"] = json!(format!("{path}.tool"));
    }
    value
}

fn manifest_json(manifest: &ToolManifest) -> Value {
    let side_effects = if manifest.side_effect == "none" {
        Vec::<&str>::new()
    } else {
        vec![manifest.side_effect]
    };
    json!({
        "schemaVersion": "v1",
        "toolId": manifest.path.trim_start_matches("/tools/").replace('/', "."),
        "name": manifest.name,
        "displayName": manifest.name,
        "path": manifest.path,
        "description": manifest.description,
        "domain": manifest.domain,
        "version": "1.0.0",
        "status": "enabled",
        "argsSchemaRef": format!("{}.args.schema.json", manifest.path),
        "resultSchemaRef": format!("{}.result.schema.json", manifest.path),
        "args": manifest.args,
        "returns": manifest.returns,
        "risk": {
            "level": manifest.risk_level,
            "sideEffect": manifest.side_effect
        },
        "riskProfile": {
            "level": manifest.risk_level,
            "sideEffects": side_effects,
            "reversible": manifest.side_effect == "workspace_write"
        },
        "permission": {
            "requiresConfirmation": manifest.side_effect != "none",
            "sandboxRequired": true,
            "allowedScopes": ["workspace"]
        },
        "permissionProfile": {
            "defaultRequiresConfirmation": manifest.side_effect != "none",
            "allowedPermissionModes": ["sandbox", "full_access"],
            "allowedExecutionTargets": ["host", "agent_vm"],
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
        },
        "outputProfile": {
            "supportsStreaming": manifest.path == TOOL_SHELL_RUN_COMMAND,
            "supportsPagination": true,
            "supportsResultRefs": true,
            "maxDefaultBytes": 65536
        },
        "provider": {
            "kind": "builtin",
            "providerId": "lyra-core"
        },
        "compatibility": {
            "minLyraVersion": "0.1.0"
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
    fn memory_directory_lists_required_agent_memory_tools() {
        let value = list_catalog_path("/tools/memory").expect("list memory");
        let encoded = value.to_string();

        assert!(encoded.contains(TOOL_MEMORY_SEARCH_SESSION));
        assert!(encoded.contains(TOOL_MEMORY_SEARCH_SHARED));
        assert!(encoded.contains(TOOL_MEMORY_SEARCH_FROZEN));
        assert!(encoded.contains(TOOL_MEMORY_GET_CONTEXT_SNAPSHOT));
        assert!(encoded.contains(TOOL_MEMORY_ASSEMBLE_CONTEXT));
        assert!(encoded.contains(TOOL_MEMORY_PROPOSE_MEMORY));
        assert!(encoded.contains(TOOL_MEMORY_UPDATE_MEMORY));
        assert!(encoded.contains(TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE));
        assert!(encoded.contains(TOOL_MEMORY_AUDIT_MEMORY));
        assert!(encoded.contains("\"args\"") == false);
    }

    #[test]
    fn clarification_directory_lists_panel_and_answer_tools() {
        let value = list_catalog_path("/tools/clarification").expect("list clarification");
        let encoded = value.to_string();

        assert!(encoded.contains(TOOL_CLARIFICATION_OPEN_PANEL));
        assert!(encoded.contains(TOOL_CLARIFICATION_SUBMIT_PANEL_ANSWER));
        assert!(encoded.contains(TOOL_CLARIFICATION_RESUME_BLOCKED_EXECUTION));
        assert!(encoded.contains("\"args\"") == false);
    }

    #[test]
    fn inspect_read_file_returns_manifest_schema() {
        let value = inspect_tool_json(TOOL_FS_READ_FILE).expect("inspect");

        assert_eq!(value["path"], TOOL_FS_READ_FILE);
        assert_eq!(value["args"]["path"], "string");
        assert_eq!(value["schemaVersion"], "v1");
        assert_eq!(value["provider"]["kind"], "builtin");
    }

    #[test]
    fn inspect_accepts_virtual_tool_manifest_file_alias() {
        let value = inspect_tool_json("/tools/filesystem/read_file.tool").expect("inspect");

        assert_eq!(value["path"], TOOL_FS_READ_FILE);
    }

    #[test]
    fn readme_paths_resolve_to_virtual_directory_docs() {
        let doc = read_doc("/tools/filesystem/README.md").expect("doc");

        assert!(doc.contains("Filesystem tools"));
    }

    #[test]
    fn manifest_registry_is_paged() {
        let value = list_catalog_path_with_args(
            TOOL_MANIFESTS,
            ListCatalogArgs {
                limit: Some(2),
                offset: Some(0),
            },
        )
        .expect("manifest page");

        assert_eq!(value["kind"], "manifestPage");
        assert_eq!(value["pagination"]["limit"], 2);
        assert_eq!(value["entries"].as_array().expect("entries").len(), 2);
        assert!(value["pagination"]["hasMore"].as_bool().expect("has more"));
        assert!(value["entries"][0]["manifest"]["args"].is_object());
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
            domain: None,
            risk_level: None,
        })
        .expect("search");

        assert!(value["recommendations"]
            .as_array()
            .expect("recommendations")
            .iter()
            .any(|item| item["path"] == TOOL_CODE_SEARCH_CODE));
        assert!(value["recommendations"][0]["reason"].is_string());
    }

    #[test]
    fn search_tool_uses_manifest_capability_tags() {
        let value = search_tools(SearchToolsArgs {
            query: "读取 文件".to_string(),
            max_results: Some(5),
            domain: Some("filesystem".to_string()),
            risk_level: Some("low".to_string()),
        })
        .expect("search");

        assert!(value["recommendations"]
            .as_array()
            .expect("recommendations")
            .iter()
            .any(|item| item["path"] == TOOL_FS_READ_FILE));
    }

    #[test]
    fn search_tool_discovers_memory_tools() {
        let value = search_tools(SearchToolsArgs {
            query: "memory conflict audit".to_string(),
            max_results: Some(10),
            domain: Some("memory".to_string()),
            risk_level: None,
        })
        .expect("search memory");
        let recommendations = value["recommendations"]
            .as_array()
            .expect("recommendations");

        assert!(recommendations
            .iter()
            .any(|item| item["path"] == TOOL_MEMORY_CREATE_CONFLICT_CANDIDATE));
        assert!(recommendations
            .iter()
            .any(|item| item["path"] == TOOL_MEMORY_AUDIT_MEMORY));
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
