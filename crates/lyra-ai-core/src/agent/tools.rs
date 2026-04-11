use std::collections::HashMap;
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;

use globset::{Glob, GlobSet};
use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::agent::terminal_policy::TerminalInteractionPolicy;
use crate::agent::types::{
    AgentPlanState, AgentPlanStatus, AGENT_PLAN_APPROVAL_REQUIRED, AGENT_PLAN_QUESTION_REQUIRED,
    AGENT_TOOL_APPROVAL_REQUIRED, AGENT_TOOL_EXEC_FAILED, AGENT_TOOL_READ_BLOCKED,
};
use crate::error::now_ms;
use crate::provider::types::AgentToolDefinition;
use crate::storage::registry_db;

mod catalog;
mod external;
mod filesystem;
mod host_bridge;
mod lsp;
mod memory;
mod plan;
mod ranking;
mod routing;
mod skill_prompts;
mod terminal;

pub use catalog::ToolExecutionMode;
pub use external::{
    clear_external_tools, register_external_tool, render_mcp_tools_prompt_json,
    unregister_external_tool, unregister_mcp_server_tools, ExternalToolApprovalMode,
    ExternalToolExecutionContext, ExternalToolExecutor, ExternalToolMetadata,
    ExternalToolSideEffectLevel, ExternalToolSideEffects, RegisteredExternalTool,
};
pub use host_bridge::{
    register_host_tools_bridge, unregister_host_tool_set, HostToolCallContext, HostToolDescriptor,
};
pub use ranking::ToolRankingContext;
#[allow(unused_imports)]
pub use routing::web_context::{derive_workbench_web_routing_context, WorkbenchWebRoutingContext};
pub use skill_prompts::{render_activated_skill_prompts, set_skill_prompts, SkillPromptEntry};

use catalog::builtin_tool_execution_mode;
use external::{
    external_tool_execution_mode, grant_approval_once as grant_external_tool_approval_once,
    try_execute_external_tool,
};
use filesystem::{
    run_filesystem_edit, run_filesystem_glob, run_filesystem_list, run_filesystem_multi_edit,
    run_filesystem_read_range, run_filesystem_search, run_filesystem_write,
};
use lsp::{
    run_lsp_find_references, run_lsp_get_diagnostics, run_lsp_goto_definition, run_lsp_hover,
};
use memory::{run_memory_recall, run_memory_remember};
use plan::{run_plan_submit_for_approval, run_plan_update_draft, run_request_user_input};
use ranking::{
    ranked_plan_tool_definitions, ranked_plan_tool_definitions_with_context,
    ranked_standard_tool_definitions, ranked_standard_tool_definitions_with_context,
};
pub use terminal::{cleanup_transient_ai_sessions, run_terminal_exec};
use terminal::{
    grant_approval_once as grant_terminal_approval_once, run_terminal_session_close,
    run_terminal_session_read, run_terminal_session_start, run_terminal_session_write,
};

const DEFAULT_GLOB_LIMIT: usize = 80;
const DEFAULT_SEARCH_LIMIT: usize = 40;
const MAX_RESULT_LIMIT: usize = 400;
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EXCERPT_CHARS: usize = 240;

const SKIPPED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    "coverage",
    ".turbo",
];

#[derive(Clone, Debug)]
pub struct AgentToolError {
    pub code: String,
    pub message: String,
    /// Optional structured metadata carried with approval requests or execution diagnostics.
    pub metadata: Option<Value>,
}

impl std::fmt::Display for AgentToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl AgentToolError {
    fn read_blocked(message: impl Into<String>) -> Self {
        Self {
            code: AGENT_TOOL_READ_BLOCKED.to_string(),
            message: message.into(),
            metadata: None,
        }
    }

    pub fn exec_failed(message: impl Into<String>) -> Self {
        Self {
            code: AGENT_TOOL_EXEC_FAILED.to_string(),
            message: message.into(),
            metadata: None,
        }
    }

    pub fn approval_required(message: impl Into<String>, metadata: Value) -> Self {
        Self {
            code: AGENT_TOOL_APPROVAL_REQUIRED.to_string(),
            message: message.into(),
            metadata: Some(metadata),
        }
    }

    pub fn plan_question_required(message: impl Into<String>, metadata: Value) -> Self {
        Self {
            code: AGENT_PLAN_QUESTION_REQUIRED.to_string(),
            message: message.into(),
            metadata: Some(metadata),
        }
    }

    pub fn plan_approval_required(message: impl Into<String>, metadata: Value) -> Self {
        Self {
            code: AGENT_PLAN_APPROVAL_REQUIRED.to_string(),
            message: message.into(),
            metadata: Some(metadata),
        }
    }
}

#[derive(Clone, Debug)]
struct CandidatePath {
    absolute_path: PathBuf,
    relative_path: String,
    kind: &'static str,
}

#[derive(Clone, Copy)]
pub struct ToolExecutionContext<'a> {
    pub storage_root: Option<&'a str>,
    pub project_root: Option<&'a str>,
    pub agent_session_id: Option<&'a str>,
    pub agent_turn_id: Option<&'a str>,
    pub tool_call_id: Option<&'a str>,
    pub terminal_policy: Option<&'a TerminalInteractionPolicy>,
    pub plan_mode: bool,
}

impl<'a> ToolExecutionContext<'a> {
    pub fn readonly(project_root: Option<&'a str>) -> Self {
        Self {
            storage_root: None,
            project_root,
            agent_session_id: None,
            agent_turn_id: None,
            tool_call_id: None,
            terminal_policy: None,
            plan_mode: false,
        }
    }
}

#[allow(dead_code)]
pub fn readonly_tool_definitions() -> Vec<AgentToolDefinition> {
    readonly_tool_definitions_for_input("")
}

pub fn readonly_tool_definitions_for_input(user_input: &str) -> Vec<AgentToolDefinition> {
    ranked_standard_tool_definitions(user_input)
}

pub fn readonly_tool_definitions_for_input_with_context(
    user_input: &str,
    context: Option<&ToolRankingContext>,
) -> Vec<AgentToolDefinition> {
    ranked_standard_tool_definitions_with_context(user_input, context)
}

#[allow(dead_code)]
pub fn plan_mode_tool_definitions() -> Vec<AgentToolDefinition> {
    plan_mode_tool_definitions_for_input("")
}

pub fn plan_mode_tool_definitions_for_input(user_input: &str) -> Vec<AgentToolDefinition> {
    ranked_plan_tool_definitions(user_input)
}

pub fn plan_mode_tool_definitions_for_input_with_context(
    user_input: &str,
    context: Option<&ToolRankingContext>,
) -> Vec<AgentToolDefinition> {
    ranked_plan_tool_definitions_with_context(user_input, context)
}

pub fn tool_execution_mode(name: &str) -> ToolExecutionMode {
    builtin_tool_execution_mode(name)
        .or_else(|| external_tool_execution_mode(name))
        .unwrap_or(ToolExecutionMode::Serial)
}

pub fn tool_executes_serially(name: &str) -> bool {
    tool_execution_mode(name).executes_serially()
}

pub fn grant_approval_once(tool_call_id: &str, metadata: &Value) {
    match metadata.get("approvalKind").and_then(Value::as_str) {
        Some("external_tool") => grant_external_tool_approval_once(tool_call_id, metadata),
        _ => grant_terminal_approval_once(tool_call_id, metadata),
    }
}

#[allow(dead_code)]
pub fn execute_readonly_tool(
    name: &str,
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    execute_tool_with_progress(
        name,
        input,
        ToolExecutionContext::readonly(project_root),
        |_| {},
    )
}

pub fn execute_tool_with_progress<F>(
    name: &str,
    input: &Value,
    context: ToolExecutionContext<'_>,
    mut on_progress: F,
) -> Result<Value, AgentToolError>
where
    F: FnMut(Value),
{
    let scope_root = resolve_scope_root(context.project_root)?;
    match name {
        "filesystem.list" => run_filesystem_list(input, scope_root.as_deref()),
        "filesystem.glob" => run_filesystem_glob(input, scope_root.as_deref()),
        "filesystem.search" => run_filesystem_search(input, scope_root.as_deref()),
        "filesystem.read_range" => run_filesystem_read_range(input, scope_root.as_deref()),
        "filesystem.write" => run_filesystem_write(input, scope_root.as_deref(), &mut on_progress),
        "filesystem.edit" => run_filesystem_edit(input, scope_root.as_deref(), &mut on_progress),
        "filesystem.multi_edit" => {
            run_filesystem_multi_edit(input, scope_root.as_deref(), &mut on_progress)
        }
        "memory.remember" => run_memory_remember(input, context.project_root, context.storage_root),
        "memory.recall" => run_memory_recall(input, context.project_root, context.storage_root),
        "terminal.exec" => {
            let command = input
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let result = run_terminal_exec(
                input,
                scope_root.as_ref().and_then(|p| p.to_str()),
                context,
                |stdout_chunk, stderr_chunk| {
                    if !stdout_chunk.is_empty() || !stderr_chunk.is_empty() {
                        on_progress(json!({
                            "stage": "executing",
                            "command": command,
                            "stdoutChunk": stdout_chunk,
                            "stderrChunk": stderr_chunk,
                        }));
                    }
                },
            );
            match result.output {
                Some(output) => Ok(output),
                None => {
                    // Approval required — emit error with metadata for upstream handler
                    let meta = result
                        .evaluation
                        .as_approval_metadata(
                            &command,
                            input.get("cwd").and_then(Value::as_str),
                            None,
                        )
                        .unwrap_or_else(|| json!({}));
                    Err(AgentToolError::approval_required(
                        "command requires user approval",
                        meta,
                    ))
                }
            }
        }
        "terminal.session.start" => run_terminal_session_start(input, context),
        "terminal.session.read" => run_terminal_session_read(input),
        "terminal.session.write" => run_terminal_session_write(input, context),
        "terminal.session.close" => run_terminal_session_close(input),
        "request_user_input" => run_request_user_input(input, context),
        "plan.update_draft" => run_plan_update_draft(input, context),
        "plan.submit_for_approval" => run_plan_submit_for_approval(input, context),
        "lsp.goto_definition" => run_lsp_goto_definition(input, context.project_root),
        "lsp.find_references" => run_lsp_find_references(input, context.project_root),
        "lsp.hover" => run_lsp_hover(input, context.project_root),
        "lsp.get_diagnostics" => run_lsp_get_diagnostics(input, context.project_root),
        _ => {
            // Try external tool registry (MCP tools, etc.)
            if let Some(result) = try_execute_external_tool(name, input, context) {
                result
            } else {
                Err(AgentToolError::read_blocked(format!(
                    "unsupported tool: {name}"
                )))
            }
        }
    }
}

fn as_object(input: &Value) -> Result<&serde_json::Map<String, Value>, AgentToolError> {
    input
        .as_object()
        .ok_or_else(|| AgentToolError::exec_failed("tool input must be a JSON object"))
}

fn required_string(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<String, AgentToolError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .ok_or_else(|| AgentToolError::exec_failed(format!("{field} is required")))
}

fn required_raw_string(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<String, AgentToolError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| AgentToolError::exec_failed(format!("{field} is required")))
}

fn required_nonempty_raw_string(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<String, AgentToolError> {
    let value = required_raw_string(object, field)?;
    if value.is_empty() {
        return Err(AgentToolError::exec_failed(format!(
            "{field} must not be empty"
        )));
    }
    Ok(value)
}

fn required_u32(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<u32, AgentToolError> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .map(|v| v as u32)
        .ok_or_else(|| AgentToolError::exec_failed(format!("{field} is required")))
}

fn optional_string(object: &serde_json::Map<String, Value>, field: &str) -> Option<String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn optional_bool(object: &serde_json::Map<String, Value>, field: &str) -> Option<bool> {
    object.get(field).and_then(Value::as_bool)
}

fn optional_usize(object: &serde_json::Map<String, Value>, field: &str) -> Option<usize> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

fn required_positive_line(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<usize, AgentToolError> {
    let value = object
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| AgentToolError::exec_failed(format!("{field} is required")))?;
    if value <= 0 {
        return Err(AgentToolError::exec_failed(format!(
            "{field} must be greater than zero"
        )));
    }
    Ok(value as usize)
}

fn clamp_limit(value: Option<usize>, fallback: usize) -> usize {
    value.unwrap_or(fallback).max(1).min(MAX_RESULT_LIMIT)
}

fn normalize_slashes(value: &str) -> String {
    value.replace('\\', "/")
}

fn normalize_path_lexical(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

fn canonical_or_lexical(path: &Path) -> PathBuf {
    path.canonicalize()
        .unwrap_or_else(|_| normalize_path_lexical(path))
}

fn resolve_unscoped_path(input: &str) -> Result<PathBuf, AgentToolError> {
    let candidate = PathBuf::from(input.trim());
    if candidate.is_absolute() {
        return Ok(candidate);
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(candidate))
        .map_err(|error| AgentToolError::exec_failed(format!("failed to resolve path: {error}")))
}

fn resolve_scope_root(project_root: Option<&str>) -> Result<Option<PathBuf>, AgentToolError> {
    let Some(raw_value) = project_root else {
        return Ok(None);
    };
    let trimmed = raw_value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let root_path = resolve_unscoped_path(trimmed)?;
    let metadata = fs::metadata(&root_path).map_err(|error| {
        AgentToolError::read_blocked(format!(
            "project root {} is not accessible: {error}",
            root_path.display()
        ))
    })?;
    if !metadata.is_dir() {
        return Err(AgentToolError::read_blocked(format!(
            "project root {} is not a directory",
            root_path.display()
        )));
    }
    Ok(Some(canonical_or_lexical(&root_path)))
}

fn ensure_scoped_path(path: PathBuf, scope_root: Option<&Path>) -> Result<PathBuf, AgentToolError> {
    let normalized_path = canonical_or_lexical(&path);
    let Some(scope_root) = scope_root else {
        return Ok(normalized_path);
    };
    let normalized_scope_root = canonical_or_lexical(scope_root);
    if normalized_path.starts_with(&normalized_scope_root) {
        return Ok(normalized_path);
    }
    Err(AgentToolError::read_blocked(format!(
        "path {} is outside the bound project root {}",
        normalized_path.display(),
        normalized_scope_root.display()
    )))
}

fn resolve_path(input: &str, scope_root: Option<&Path>) -> Result<PathBuf, AgentToolError> {
    let candidate = PathBuf::from(input.trim());
    let resolved = if candidate.is_absolute() {
        candidate
    } else if let Some(root) = scope_root {
        root.join(candidate)
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(candidate))
            .map_err(|error| {
                AgentToolError::exec_failed(format!("failed to resolve path: {error}"))
            })?
    };
    ensure_scoped_path(resolved, scope_root)
}

fn current_dir_path(scope_root: Option<&Path>) -> Result<PathBuf, AgentToolError> {
    if let Some(root) = scope_root {
        return Ok(root.to_path_buf());
    }
    std::env::current_dir().map_err(|error| {
        AgentToolError::exec_failed(format!("failed to read current dir: {error}"))
    })
}

fn should_skip_directory(name: &str) -> bool {
    SKIPPED_DIRECTORIES.iter().any(|entry| *entry == name)
}

fn collect_candidates(root: &Path, limit: usize) -> Result<Vec<CandidatePath>, AgentToolError> {
    let root_abs = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let metadata = fs::metadata(&root_abs)
        .map_err(|error| AgentToolError::exec_failed(format!("failed to stat path: {error}")))?;

    if metadata.is_file() {
        let relative = root_abs
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| root_abs.to_string_lossy().to_string());
        return Ok(vec![CandidatePath {
            absolute_path: root_abs,
            relative_path: normalize_slashes(&relative),
            kind: "file",
        }]);
    }

    let mut queue = VecDeque::new();
    queue.push_back(root_abs.clone());

    let mut results = Vec::new();
    while let Some(current) = queue.pop_front() {
        if results.len() >= limit {
            break;
        }

        let read_dir = match fs::read_dir(&current) {
            Ok(value) => value,
            Err(error) => {
                return Err(AgentToolError::exec_failed(format!(
                    "failed to read directory {}: {error}",
                    current.display()
                )));
            }
        };

        let mut entries = read_dir.filter_map(Result::ok).collect::<Vec<_>>();
        entries.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

        for entry in entries {
            if results.len() >= limit {
                break;
            }

            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };

            if file_type.is_symlink() {
                continue;
            }

            let absolute = entry.path();
            let relative_path = absolute
                .strip_prefix(&root_abs)
                .ok()
                .map(|value| normalize_slashes(&value.to_string_lossy()))
                .unwrap_or_else(|| normalize_slashes(&absolute.to_string_lossy()));

            if relative_path.is_empty() {
                continue;
            }

            if file_type.is_dir() {
                if should_skip_directory(&file_name) {
                    continue;
                }
                results.push(CandidatePath {
                    absolute_path: absolute.clone(),
                    relative_path,
                    kind: "directory",
                });
                queue.push_back(absolute);
                continue;
            }

            if file_type.is_file() {
                results.push(CandidatePath {
                    absolute_path: absolute,
                    relative_path,
                    kind: "file",
                });
            }
        }
    }

    Ok(results)
}

fn build_glob(pattern: &str) -> Result<GlobSet, AgentToolError> {
    let glob = Glob::new(pattern)
        .map_err(|error| AgentToolError::exec_failed(format!("invalid glob pattern: {error}")))?;
    let mut builder = globset::GlobSetBuilder::new();
    builder.add(glob);
    builder
        .build()
        .map_err(|error| AgentToolError::exec_failed(format!("failed to build glob: {error}")))
}

fn file_name_from_relative(relative_path: &str) -> String {
    relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .last()
        .unwrap_or(relative_path)
        .to_string()
}

fn matches_glob(candidate_relative_path: &str, pattern: &str, set: &GlobSet) -> bool {
    if set.is_match(candidate_relative_path) {
        return true;
    }

    if pattern.contains('/') || pattern.contains('\\') {
        return false;
    }

    set.is_match(file_name_from_relative(candidate_relative_path))
}

fn read_text_file(path: &Path) -> Result<String, AgentToolError> {
    let metadata = fs::metadata(path).map_err(|error| {
        AgentToolError::exec_failed(format!("failed to stat file {}: {error}", path.display()))
    })?;
    if metadata.len() > MAX_SEARCH_FILE_BYTES {
        return Err(AgentToolError::exec_failed(format!(
            "file too large to read as text: {}",
            path.display()
        )));
    }

    fs::read_to_string(path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to read UTF-8 text file {}: {error}",
            path.display()
        ))
    })
}

fn split_lines(content: &str) -> Vec<String> {
    if content.is_empty() {
        return Vec::new();
    }
    let normalized = content.replace("\r\n", "\n");
    normalized
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect()
}

fn clip_excerpt(value: &str) -> String {
    let normalized = value.trim();
    if normalized.len() <= MAX_EXCERPT_CHARS {
        normalized.to_string()
    } else {
        format!("{}…", &normalized[..MAX_EXCERPT_CHARS])
    }
}

// --- Command Approval Coordination ---

/// Decision received from the frontend approval UI.
#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub decision: String, // "allow_once", "allow_always", "deny"
}

#[derive(Debug, Clone)]
pub struct PlanQuestionResolution {
    pub answers: Value,
    pub note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlanApprovalResolution {
    pub decision: String, // "approve_and_implement" | "keep_planning" | "reject"
    pub feedback: Option<String>,
}

/// Channel pair for waiting on an approval decision.
type ApprovalChannel = mpsc::Sender<ApprovalDecision>;

/// Global registry mapping tool_call_id → approval channel.
static APPROVAL_CHANNELS: Lazy<Mutex<HashMap<String, ApprovalChannel>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PLAN_QUESTION_CHANNELS: Lazy<Mutex<HashMap<String, mpsc::Sender<PlanQuestionResolution>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PLAN_APPROVAL_CHANNELS: Lazy<Mutex<HashMap<String, mpsc::Sender<PlanApprovalResolution>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Register a oneshot channel for a pending approval request.
/// Returns the receiver that will block until the decision arrives.
pub fn register_approval_waiter(tool_call_id: &str) -> mpsc::Receiver<ApprovalDecision> {
    let (tx, rx) = mpsc::channel::<ApprovalDecision>();
    if let Ok(mut guard) = APPROVAL_CHANNELS.lock() {
        guard.insert(tool_call_id.to_string(), tx);
    }
    rx
}

/// Resolve a pending approval request with the user's decision.
pub fn resolve_approval(tool_call_id: &str, decision: &str) {
    if let Ok(mut guard) = APPROVAL_CHANNELS.lock() {
        if let Some(tx) = guard.remove(tool_call_id) {
            let _ = tx.send(ApprovalDecision {
                decision: decision.to_string(),
            });
        }
    }
}

/// Cancel a pending approval request (e.g., session closed).
pub fn cancel_approval(tool_call_id: &str) {
    if let Ok(mut guard) = APPROVAL_CHANNELS.lock() {
        guard.remove(tool_call_id);
    }
}

pub fn register_plan_question_waiter(request_id: &str) -> mpsc::Receiver<PlanQuestionResolution> {
    let (tx, rx) = mpsc::channel::<PlanQuestionResolution>();
    if let Ok(mut guard) = PLAN_QUESTION_CHANNELS.lock() {
        guard.insert(request_id.to_string(), tx);
    }
    rx
}

pub fn resolve_plan_question(request_id: &str, answers: Value, note: Option<String>) {
    if let Ok(mut guard) = PLAN_QUESTION_CHANNELS.lock() {
        if let Some(tx) = guard.remove(request_id) {
            let _ = tx.send(PlanQuestionResolution { answers, note });
        }
    }
}

pub fn cancel_plan_question(request_id: &str) {
    if let Ok(mut guard) = PLAN_QUESTION_CHANNELS.lock() {
        guard.remove(request_id);
    }
}

pub fn register_plan_approval_waiter(request_id: &str) -> mpsc::Receiver<PlanApprovalResolution> {
    let (tx, rx) = mpsc::channel::<PlanApprovalResolution>();
    if let Ok(mut guard) = PLAN_APPROVAL_CHANNELS.lock() {
        guard.insert(request_id.to_string(), tx);
    }
    rx
}

pub fn resolve_plan_approval(request_id: &str, decision: &str, feedback: Option<String>) -> bool {
    if let Ok(mut guard) = PLAN_APPROVAL_CHANNELS.lock() {
        if let Some(tx) = guard.remove(request_id) {
            let _ = tx.send(PlanApprovalResolution {
                decision: decision.to_string(),
                feedback,
            });
            return true;
        }
    }
    false
}

pub fn cancel_plan_approval(request_id: &str) {
    if let Ok(mut guard) = PLAN_APPROVAL_CHANNELS.lock() {
        guard.remove(request_id);
    }
}
