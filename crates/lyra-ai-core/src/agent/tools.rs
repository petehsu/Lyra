use std::collections::HashMap;
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use globset::{Glob, GlobSet};
use lyra_terminal_core::{
    close_session as close_terminal_session, create_session as create_terminal_session,
    read_session as read_terminal_session, write_session as write_terminal_session,
    TerminalCloseRequest, TerminalCreateRequest, TerminalReadRequest, TerminalWriteRequest,
};
use lyra_sandbox::{
    detect_env_injection, evaluate_builtin, needs_interactive_pty, permissions::PermissionsStore,
    policy::CommandRiskLevel,
};
use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::agent::terminal_policy::{
    classify_terminal_command, rewrite_interactive_command_if_possible, TerminalCommandCategory,
    TerminalInteractionPolicy, TerminalInteractionPolicyKind, TerminalRewriteAdvice,
};
use crate::agent::types::{
    AgentPlanState, AgentPlanStatus, AGENT_PLAN_APPROVAL_REQUIRED,
    AGENT_PLAN_QUESTION_REQUIRED, AGENT_TOOL_APPROVAL_REQUIRED, AGENT_TOOL_EXEC_FAILED,
    AGENT_TOOL_READ_BLOCKED,
};
use crate::provider::types::AgentToolDefinition;
use crate::storage::registry_db;
use crate::error::now_ms;

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

// --- Dynamic Tool Registry (MCP + external tools) ---

/// A registered external tool with its definition and execution callback.
#[derive(Clone)]
pub struct RegisteredExternalTool {
    pub definition: AgentToolDefinition,
    /// JSON-in → JSON-out executor. Errors should be returned as AgentToolError-shaped JSON.
    pub executor: ExternalToolExecutor,
}

/// Thread-safe, cloneable executor function.
pub type ExternalToolExecutor =
    std::sync::Arc<dyn Fn(&Value) -> Result<Value, AgentToolError> + Send + Sync>;

static EXTERNAL_TOOLS: Lazy<Mutex<Vec<RegisteredExternalTool>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

/// Register an external tool (e.g. MCP server tool) into the agent's tool set.
/// Tools are identified by name; re-registering the same name replaces the previous entry.
pub fn register_external_tool(tool: RegisteredExternalTool) {
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.retain(|t| t.definition.name != tool.definition.name);
        tools.push(tool);
    }
}

/// Remove an external tool by name.
pub fn unregister_external_tool(name: &str) {
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.retain(|t| t.definition.name != name);
    }
}

/// Remove all external tools for a given server (tools prefixed with "mcp:{server_id}/").
pub fn unregister_mcp_server_tools(server_id: &str) {
    let prefix = format!("mcp:{server_id}/");
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.retain(|t| !t.definition.name.starts_with(&prefix));
    }
}

/// Clear all external tools.
pub fn clear_external_tools() {
    if let Ok(mut tools) = EXTERNAL_TOOLS.lock() {
        tools.clear();
    }
}

/// Get current tool definitions from the external registry.
fn external_tool_definitions() -> Vec<AgentToolDefinition> {
    EXTERNAL_TOOLS
        .lock()
        .map(|tools| tools.iter().map(|t| t.definition.clone()).collect())
        .unwrap_or_default()
}

/// Try to execute a tool from the external registry. Returns None if not found.
fn try_execute_external_tool(name: &str, input: &Value) -> Option<Result<Value, AgentToolError>> {
    let executor = EXTERNAL_TOOLS.lock().ok().and_then(|tools| {
        tools
            .iter()
            .find(|t| t.definition.name == name)
            .map(|t| t.executor.clone())
    })?;
    Some(executor(input))
}

// --- Skill Prompt Registry ---

static SKILL_PROMPTS: Lazy<Mutex<Vec<SkillPromptEntry>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// A skill prompt to be injected into the agent's context.
#[derive(Clone, Debug)]
pub struct SkillPromptEntry {
    pub skill_id: String,
    pub name: String,
    pub content: String,
}

/// Register skill prompts to be injected into agent turns.
pub fn set_skill_prompts(prompts: Vec<SkillPromptEntry>) {
    if let Ok(mut skills) = SKILL_PROMPTS.lock() {
        *skills = prompts;
    }
}

/// Get the currently registered skill prompts.
pub fn get_skill_prompts() -> Vec<SkillPromptEntry> {
    SKILL_PROMPTS.lock().map(|s| s.clone()).unwrap_or_default()
}

/// Render activated skill prompts into a concise markdown block for system prompt injection.
pub fn render_activated_skill_prompts() -> String {
    let skills = get_skill_prompts();
    if skills.is_empty() {
        return "- none".to_string();
    }
    skills
        .iter()
        .map(|entry| {
            format!(
                "- Skill `{}` (`{}`):\n{}\n",
                entry.name,
                entry.skill_id,
                entry.content.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Render MCP tool metadata as JSON for prompt context.
pub fn render_mcp_tools_prompt_json() -> String {
    let tools = EXTERNAL_TOOLS
        .lock()
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.definition.name.starts_with("mcp:"))
                .map(|entry| {
                    json!({
                        "name": entry.definition.name,
                        "description": entry.definition.description,
                        "inputSchema": entry.definition.input_schema,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if tools.is_empty() {
        return "[]".to_string();
    }
    serde_json::to_string_pretty(&tools).unwrap_or_else(|_| "[]".to_string())
}

// --- Built-in Tool Definitions ---

#[derive(Clone, Debug)]
pub struct AgentToolError {
    pub code: String,
    pub message: String,
    /// Optional metadata carried with approval-required errors.
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

#[derive(Clone, Debug)]
struct OneTimeApprovalGrant {
    command: Option<String>,
    session_id: Option<String>,
}

#[derive(Clone, Debug)]
struct ManagedTerminalSession {
    owner_session_id: Option<String>,
    owner_turn_id: Option<String>,
    source: String,
    mode: String,
    persist: bool,
}

static APPROVED_ONCE_GRANTS: Lazy<Mutex<HashMap<String, OneTimeApprovalGrant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static MANAGED_TERMINAL_SESSIONS: Lazy<Mutex<HashMap<String, ManagedTerminalSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn readonly_tool_definitions() -> Vec<AgentToolDefinition> {
    let mut tools = vec![
        AgentToolDefinition {
            name: "filesystem.list".to_string(),
            description:
                "List files and directories under a target path. Read-only; no write side effects."
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "filesystem.glob".to_string(),
            description:
                "Find files or directories by glob pattern in a root directory. Read-only."
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["pattern"],
                "properties": {
                    "pattern": { "type": "string" },
                    "root": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "filesystem.search".to_string(),
            description: "Search plain text in files and return line matches. Read-only."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["pattern"],
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" },
                    "glob": { "type": "string" },
                    "limit": { "type": "number" },
                    "caseSensitive": { "type": "boolean" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "filesystem.read_range".to_string(),
            description: "Read a line range from a UTF-8 text file. Read-only.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["path", "startLine", "endLine"],
                "properties": {
                    "path": { "type": "string" },
                    "startLine": { "type": "number" },
                    "endLine": { "type": "number" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "filesystem.write".to_string(),
            description:
                "Write full UTF-8 text content to a file path. Creates the file if missing."
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "filesystem.edit".to_string(),
            description: "Edit an existing UTF-8 text file by replacing an exact text block."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["path", "oldText", "newText"],
                "properties": {
                    "path": { "type": "string" },
                    "oldText": { "type": "string" },
                    "newText": { "type": "string" },
                    "replaceAll": { "type": "boolean" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "filesystem.multi_edit".to_string(),
            description: "Apply multiple exact text replacements to one existing UTF-8 text file."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["path", "edits"],
                "properties": {
                    "path": { "type": "string" },
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["oldText", "newText"],
                            "properties": {
                                "oldText": { "type": "string" },
                                "newText": { "type": "string" },
                                "replaceAll": { "type": "boolean" }
                            },
                            "additionalProperties": false
                        },
                        "minItems": 1
                    }
                },
                "additionalProperties": false
            }),
        },
        // Memory tools
        AgentToolDefinition {
            name: "memory.remember".to_string(),
            description: "Save a fact, preference, or project convention to long-term memory. Use this when you learn something worth recalling in future sessions.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["value"],
                "properties": {
                    "value": { "type": "string", "description": "The fact or knowledge to remember" },
                    "scope": { "type": "string", "enum": ["project", "global", "user"], "description": "Memory scope: project-specific, global, or user-personal" },
                    "layer": { "type": "string", "enum": ["shared", "frozen"], "description": "shared for general knowledge, frozen for stable user facts" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "memory.recall".to_string(),
            description: "Search long-term memory for relevant facts, preferences, or project conventions.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": { "type": "string", "description": "Search query to find relevant memories" },
                    "scope": { "type": "string", "enum": ["project", "global", "user"] },
                    "limit": { "type": "number", "description": "Max results to return (default 5)" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "request_user_input".to_string(),
            description: "Ask the user 1-4 structured questions with 2-4 options each when a blocking preference or decision cannot be derived from the repo or prior context.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["questions"],
                "properties": {
                    "questions": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4,
                        "items": {
                            "type": "object",
                            "required": ["id", "header", "question", "options"],
                            "properties": {
                                "id": { "type": "string" },
                                "header": { "type": "string" },
                                "question": { "type": "string" },
                                "allowOther": { "type": "boolean" },
                                "options": {
                                    "type": "array",
                                    "minItems": 2,
                                    "maxItems": 4,
                                    "items": {
                                        "type": "object",
                                        "required": ["label", "description"],
                                        "properties": {
                                            "label": { "type": "string" },
                                            "description": { "type": "string" },
                                            "preview": { "type": "string" }
                                        },
                                        "additionalProperties": false
                                    }
                                }
                            },
                            "additionalProperties": false
                        }
                    },
                    "allowNote": { "type": "boolean" }
                },
                "additionalProperties": false
            }),
        },
        // Terminal tool
        AgentToolDefinition {
            name: "terminal.exec".to_string(),
            description: "Execute a shell command and return its output. Use for running build commands, tests, or inspecting system state.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" },
                    "cwd": { "type": "string", "description": "Working directory (defaults to project root)" },
                    "timeout_ms": { "type": "number", "description": "Timeout in milliseconds (default 30000, max 120000)" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "terminal.session.start".to_string(),
            description: "Start an interactive PTY-backed terminal session. Use command mode for a single interactive command, or shell mode only when the user explicitly asked for a full shell.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["command", "shell"] },
                    "command": { "type": "string" },
                    "cwd": { "type": "string" },
                    "title": { "type": "string" },
                    "shell": { "type": "string" },
                    "cols": { "type": "number" },
                    "rows": { "type": "number" },
                    "persist": { "type": "boolean" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "terminal.session.read".to_string(),
            description: "Read incremental output from an existing PTY terminal session.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["sessionId"],
                "properties": {
                    "sessionId": { "type": "string" },
                    "cursor": { "type": "string" },
                    "maxBytes": { "type": "number" },
                    "waitMs": { "type": "number" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "terminal.session.write".to_string(),
            description: "Send text or navigation keys to an existing PTY terminal session.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["sessionId"],
                "properties": {
                    "sessionId": { "type": "string" },
                    "text": { "type": "string" },
                    "keys": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["enter", "escape", "tab", "ctrl_c", "ctrl_d", "up", "down", "left", "right", "page_up", "page_down", "home", "end"]
                        }
                    },
                    "appendNewline": { "type": "boolean" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "terminal.session.close".to_string(),
            description: "Close an interactive PTY terminal session.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["sessionId"],
                "properties": {
                    "sessionId": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        // LSP code intelligence tools
        AgentToolDefinition {
            name: "lsp.goto_definition".to_string(),
            description: "Jump to the definition of a symbol at a given position in a source file. Returns file paths and line ranges of the definition(s).".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["filePath", "line", "column"],
                "properties": {
                    "filePath": { "type": "string", "description": "Absolute path to the source file" },
                    "line": { "type": "number", "description": "0-based line number" },
                    "column": { "type": "number", "description": "0-based column/character offset" },
                    "languageId": { "type": "string", "description": "Language identifier (typescript, rust, python). Auto-detected from extension if omitted." }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "lsp.find_references".to_string(),
            description: "Find all references to a symbol at a given position across the project. Returns file paths and line ranges.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["filePath", "line", "column"],
                "properties": {
                    "filePath": { "type": "string", "description": "Absolute path to the source file" },
                    "line": { "type": "number", "description": "0-based line number" },
                    "column": { "type": "number", "description": "0-based column/character offset" },
                    "languageId": { "type": "string", "description": "Language identifier (typescript, rust, python). Auto-detected from extension if omitted." }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "lsp.hover".to_string(),
            description: "Get type information and documentation for the symbol at a given position. Returns the hover contents (type signature, docs).".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["filePath", "line", "column"],
                "properties": {
                    "filePath": { "type": "string", "description": "Absolute path to the source file" },
                    "line": { "type": "number", "description": "0-based line number" },
                    "column": { "type": "number", "description": "0-based column/character offset" },
                    "languageId": { "type": "string", "description": "Language identifier (typescript, rust, python). Auto-detected from extension if omitted." }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "lsp.get_diagnostics".to_string(),
            description: "Get compiler errors, warnings, and lint diagnostics for a source file. Requires providing the current file content.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["filePath", "content"],
                "properties": {
                    "filePath": { "type": "string", "description": "Absolute path to the source file" },
                    "content": { "type": "string", "description": "Current full text content of the file" },
                    "languageId": { "type": "string", "description": "Language identifier (typescript, rust, python). Auto-detected from extension if omitted." }
                },
                "additionalProperties": false
            }),
        },
    ];
    // Append dynamically registered external tools (MCP servers, etc.)
    tools.extend(external_tool_definitions());
    tools
}

fn plan_mode_only_tool_definitions() -> Vec<AgentToolDefinition> {
    vec![
        AgentToolDefinition {
            name: "plan.update_draft".to_string(),
            description: "Replace the current plan draft with a new complete markdown draft. Each update increments the plan version.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["draftMarkdown"],
                "properties": {
                    "draftMarkdown": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "plan.submit_for_approval".to_string(),
            description: "Submit the current plan for user approval. The plan must be complete enough that implementation no longer requires decisions.".to_string(),
            input_schema: json!({
                "type": "object",
                "required": ["planMarkdown"],
                "properties": {
                    "planMarkdown": { "type": "string" },
                    "summary": { "type": "string" }
                },
                "additionalProperties": false
            }),
        },
    ]
}

pub fn plan_mode_tool_definitions() -> Vec<AgentToolDefinition> {
    let allowed = [
        "filesystem.list",
        "filesystem.glob",
        "filesystem.search",
        "filesystem.read_range",
        "memory.recall",
        "request_user_input",
        "terminal.exec",
        "lsp.goto_definition",
        "lsp.find_references",
        "lsp.hover",
        "lsp.get_diagnostics",
    ];
    let mut tools = readonly_tool_definitions()
        .into_iter()
        .filter(|tool| allowed.contains(&tool.name.as_str()))
        .collect::<Vec<_>>();
    tools.extend(plan_mode_only_tool_definitions());
    tools
}

#[allow(dead_code)]
pub fn execute_readonly_tool(
    name: &str,
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    execute_tool_with_progress(name, input, ToolExecutionContext::readonly(project_root), |_| {})
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
            if let Some(result) = try_execute_external_tool(name, input) {
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

fn run_filesystem_list(input: &Value, scope_root: Option<&Path>) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let root_path = optional_string(object, "path")
        .map(|value| resolve_path(&value, scope_root))
        .transpose()?
        .unwrap_or(current_dir_path(scope_root)?);
    let limit = clamp_limit(optional_usize(object, "limit"), 200);

    let metadata = fs::metadata(&root_path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to stat path {}: {error}",
            root_path.display()
        ))
    })?;

    if metadata.is_file() {
        let name = root_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| root_path.to_string_lossy().to_string());
        return Ok(json!({
            "path": root_path.to_string_lossy(),
            "entries": [{
                "name": name,
                "path": root_path.to_string_lossy(),
                "kind": "file",
                "sizeBytes": metadata.len()
            }],
            "truncated": false
        }));
    }

    let read_dir = fs::read_dir(&root_path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to read directory {}: {error}",
            root_path.display()
        ))
    })?;

    let mut entries = read_dir.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

    let truncated = entries.len() > limit;
    let mapped = entries
        .into_iter()
        .take(limit)
        .map(|entry| {
            let entry_path = entry.path();
            let entry_type = entry.file_type().ok();
            let kind = if entry_type.as_ref().is_some_and(|value| value.is_dir()) {
                "directory"
            } else if entry_type.as_ref().is_some_and(|value| value.is_file()) {
                "file"
            } else {
                "other"
            };
            let size_bytes = fs::metadata(&entry_path)
                .ok()
                .map(|metadata| metadata.len());
            json!({
                "name": entry.file_name().to_string_lossy(),
                "path": entry_path.to_string_lossy(),
                "kind": kind,
                "sizeBytes": size_bytes,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "path": root_path.to_string_lossy(),
        "entries": mapped,
        "truncated": truncated,
    }))
}

fn run_filesystem_glob(input: &Value, scope_root: Option<&Path>) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let pattern = required_string(object, "pattern")?;
    let root_path = optional_string(object, "root")
        .map(|value| resolve_path(&value, scope_root))
        .transpose()?
        .unwrap_or(current_dir_path(scope_root)?);
    let limit = clamp_limit(optional_usize(object, "limit"), DEFAULT_GLOB_LIMIT);
    let glob_set = build_glob(&pattern)?;

    let candidates = collect_candidates(&root_path, limit.saturating_mul(8))?;
    let mut matched = Vec::new();
    for candidate in &candidates {
        if matched.len() >= limit {
            break;
        }
        if matches_glob(&candidate.relative_path, &pattern, &glob_set) {
            matched.push(json!({
                "path": candidate.absolute_path.to_string_lossy(),
                "relativePath": candidate.relative_path,
                "kind": candidate.kind,
            }));
        }
    }

    Ok(json!({
        "rootPath": root_path.to_string_lossy(),
        "pattern": pattern,
        "truncated": matched.len() >= limit,
        "matches": matched,
    }))
}

fn run_filesystem_search(
    input: &Value,
    scope_root: Option<&Path>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let pattern = required_string(object, "pattern")?;
    let root_path = optional_string(object, "path")
        .map(|value| resolve_path(&value, scope_root))
        .transpose()?
        .unwrap_or(current_dir_path(scope_root)?);
    let limit = clamp_limit(optional_usize(object, "limit"), DEFAULT_SEARCH_LIMIT);
    let case_sensitive = optional_bool(object, "caseSensitive").unwrap_or(false);

    let glob_pattern = optional_string(object, "glob");
    let glob = glob_pattern
        .as_ref()
        .map(|pattern| build_glob(pattern))
        .transpose()?;

    let metadata = fs::metadata(&root_path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to stat path {}: {error}",
            root_path.display()
        ))
    })?;

    let candidates = if metadata.is_file() {
        vec![CandidatePath {
            absolute_path: root_path.clone(),
            relative_path: root_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| root_path.to_string_lossy().to_string()),
            kind: "file",
        }]
    } else {
        collect_candidates(&root_path, MAX_RESULT_LIMIT.saturating_mul(8))?
            .into_iter()
            .filter(|candidate| candidate.kind == "file")
            .collect()
    };

    let needle = if case_sensitive {
        pattern.clone()
    } else {
        pattern.to_lowercase()
    };

    let mut matches = Vec::new();
    let mut truncated = false;

    for candidate in candidates {
        if matches.len() >= limit {
            truncated = true;
            break;
        }

        if let (Some(glob_set), Some(glob_pattern_value)) = (&glob, &glob_pattern) {
            if !matches_glob(&candidate.relative_path, glob_pattern_value, glob_set) {
                continue;
            }
        }

        let content = match read_text_file(&candidate.absolute_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let lines = split_lines(&content);

        for (index, line) in lines.iter().enumerate() {
            if matches.len() >= limit {
                truncated = true;
                break;
            }
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if !haystack.contains(&needle) {
                continue;
            }
            matches.push(json!({
                "path": candidate.absolute_path.to_string_lossy(),
                "relativePath": candidate.relative_path,
                "line": index + 1,
                "excerpt": clip_excerpt(line),
            }));
        }
    }

    Ok(json!({
        "rootPath": root_path.to_string_lossy(),
        "pattern": pattern,
        "caseSensitive": case_sensitive,
        "truncated": truncated,
        "matches": matches,
    }))
}

fn run_filesystem_read_range(
    input: &Value,
    scope_root: Option<&Path>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let start_line = required_positive_line(object, "startLine")?;
    let end_line = required_positive_line(object, "endLine")?.max(start_line);

    let content = match read_text_file(&path) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "kind": "unsupported",
                "path": path.to_string_lossy(),
                "reason": error.message,
                "requestedStartLine": start_line,
                "requestedEndLine": end_line,
                "actualStartLine": 0,
                "actualEndLine": 0,
                "totalLines": 0,
            }))
        }
    };

    let lines = split_lines(&content);
    if lines.is_empty() {
        return Ok(json!({
            "kind": "text",
            "path": path.to_string_lossy(),
            "requestedStartLine": start_line,
            "requestedEndLine": end_line,
            "actualStartLine": 0,
            "actualEndLine": 0,
            "totalLines": 0,
            "content": "",
        }));
    }

    let actual_start = start_line.min(lines.len());
    let actual_end = end_line.min(lines.len());
    let content_slice = if actual_start == 0 || actual_end == 0 || actual_start > actual_end {
        String::new()
    } else {
        lines[(actual_start - 1)..actual_end].join("\n")
    };

    Ok(json!({
        "kind": "text",
        "path": path.to_string_lossy(),
        "requestedStartLine": start_line,
        "requestedEndLine": end_line,
        "actualStartLine": actual_start,
        "actualEndLine": actual_end,
        "totalLines": lines.len(),
        "content": content_slice,
    }))
}

fn line_count(content: &str) -> usize {
    if content.is_empty() {
        return 0;
    }
    content.replace("\r\n", "\n").split('\n').count()
}

fn first_changed_line(previous: &str, next: &str) -> usize {
    if previous == next {
        return 1;
    }
    let previous_lines = split_lines(previous);
    let next_lines = split_lines(next);
    let max_len = previous_lines.len().max(next_lines.len());
    for index in 0..max_len {
        if previous_lines.get(index) != next_lines.get(index) {
            return index + 1;
        }
    }
    1
}

#[derive(Clone, Debug)]
struct EditCandidate {
    old_text: String,
    new_text: String,
    mode: &'static str,
}

#[derive(Clone, Debug)]
enum EditResolution {
    Applied {
        next_content: String,
        replacements: usize,
        mode: &'static str,
    },
    AlreadyApplied {
        mode: &'static str,
    },
    NoMatch,
}

fn push_edit_candidate(
    candidates: &mut Vec<EditCandidate>,
    old_text: String,
    new_text: String,
    mode: &'static str,
) {
    if old_text.is_empty() {
        return;
    }
    if candidates
        .iter()
        .any(|entry| entry.old_text == old_text && entry.new_text == new_text)
    {
        return;
    }
    candidates.push(EditCandidate {
        old_text,
        new_text,
        mode,
    });
}

fn build_edit_candidates(old_text: &str, new_text: &str) -> Vec<EditCandidate> {
    let mut candidates = Vec::new();
    push_edit_candidate(
        &mut candidates,
        old_text.to_string(),
        new_text.to_string(),
        "exact",
    );

    let old_lf = old_text.replace("\r\n", "\n");
    let new_lf = new_text.replace("\r\n", "\n");
    if old_lf != old_text || new_lf != new_text {
        push_edit_candidate(
            &mut candidates,
            old_lf.clone(),
            new_lf.clone(),
            "normalize_lf",
        );
    }

    if old_lf.contains('\n') {
        let old_crlf = old_lf.replace('\n', "\r\n");
        let new_crlf = new_lf.replace('\n', "\r\n");
        if old_crlf != old_text || new_crlf != new_text {
            push_edit_candidate(&mut candidates, old_crlf, new_crlf, "normalize_crlf");
        }
    }

    candidates
}

fn resolve_text_edit(
    current: &str,
    old_text: &str,
    new_text: &str,
    replace_all: bool,
) -> EditResolution {
    let candidates = build_edit_candidates(old_text, new_text);

    for candidate in &candidates {
        let matches = current.matches(candidate.old_text.as_str()).count();
        if matches == 0 {
            continue;
        }
        let replacements = if replace_all { matches } else { 1 };
        let next_content = if replace_all {
            current.replace(candidate.old_text.as_str(), candidate.new_text.as_str())
        } else {
            current.replacen(candidate.old_text.as_str(), candidate.new_text.as_str(), 1)
        };
        return EditResolution::Applied {
            next_content,
            replacements,
            mode: candidate.mode,
        };
    }

    for candidate in &candidates {
        if !candidate.new_text.is_empty() && current.contains(candidate.new_text.as_str()) {
            return EditResolution::AlreadyApplied {
                mode: candidate.mode,
            };
        }
    }

    EditResolution::NoMatch
}

fn write_text_file_with_progress(
    path: &Path,
    content: &str,
    first_changed_line: Option<usize>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<(), AgentToolError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AgentToolError::exec_failed(format!(
                "failed to create parent directory {}: {error}",
                parent.display()
            ))
        })?;
    }

    let bytes = content.as_bytes();
    let total = bytes.len();
    let display_path = path.to_string_lossy().to_string();
    on_progress(json!({
        "stage": "preparing",
        "path": display_path,
        "bytesTotal": total,
        "bytesWritten": 0,
        "firstChangedLine": first_changed_line,
    }));

    let mut file = std::fs::File::create(path).map_err(|error| {
        AgentToolError::exec_failed(format!("failed to write file {}: {error}", path.display()))
    })?;
    if total == 0 {
        file.flush().map_err(|error| {
            AgentToolError::exec_failed(format!("failed to flush file {}: {error}", path.display()))
        })?;
        on_progress(json!({
            "stage": "writing",
            "path": display_path,
            "bytesTotal": 0,
            "bytesWritten": 0,
            "progress": 1.0,
            "chunkText": "",
            "firstChangedLine": first_changed_line,
        }));
        return Ok(());
    }

    let target_events = 10usize;
    let char_boundaries = content
        .char_indices()
        .map(|(offset, _)| offset)
        .chain(std::iter::once(content.len()))
        .collect::<Vec<_>>();
    let total_chars = char_boundaries.len().saturating_sub(1);
    let chunk_chars = (total_chars / target_events).max(1);
    let mut current_char_index = 0usize;
    let mut written = 0usize;
    while current_char_index < total_chars {
        let next_char_index = (current_char_index + chunk_chars).min(total_chars);
        let end = char_boundaries[next_char_index];
        file.write_all(&bytes[written..end]).map_err(|error| {
            AgentToolError::exec_failed(format!("failed to write file {}: {error}", path.display()))
        })?;
        file.flush().map_err(|error| {
            AgentToolError::exec_failed(format!("failed to flush file {}: {error}", path.display()))
        })?;
        let chunk_text = &content[written..end];
        written = end;
        current_char_index = next_char_index;
        on_progress(json!({
            "stage": "writing",
            "path": display_path,
            "bytesTotal": total,
            "bytesWritten": written,
            "progress": (written as f64 / total as f64),
            "chunkText": chunk_text,
            "firstChangedLine": first_changed_line,
        }));
    }
    Ok(())
}

fn run_filesystem_write(
    input: &Value,
    scope_root: Option<&Path>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let content = required_raw_string(object, "content")?;
    let previous_content = fs::read_to_string(&path).ok();
    let created = previous_content.is_none();
    let previous_line_count = previous_content.as_deref().map(line_count).unwrap_or(0);
    if previous_content.as_deref() == Some(content.as_str()) {
        on_progress(json!({
            "stage": "baseline",
            "path": path.to_string_lossy(),
            "created": false,
            "baselineContent": previous_content,
        }));
        on_progress(json!({
            "stage": "writing",
            "path": path.to_string_lossy(),
            "status": "unchanged",
        }));
        return Ok(json!({
            "kind": "unchanged",
            "path": path.to_string_lossy(),
            "created": false,
            "bytes": content.len(),
            "addedLines": 0,
            "removedLines": 0,
            "firstChangedLine": 1,
        }));
    }
    let first_changed_line = previous_content
        .as_deref()
        .map(|previous| first_changed_line(previous, &content))
        .unwrap_or(1);
    on_progress(json!({
        "stage": "baseline",
        "path": path.to_string_lossy(),
        "created": created,
        "baselineContent": previous_content,
    }));
    write_text_file_with_progress(&path, &content, Some(first_changed_line), on_progress)?;
    let new_line_count = line_count(&content);
    Ok(json!({
        "kind": if created { "created" } else { "updated" },
        "path": path.to_string_lossy(),
        "created": created,
        "bytes": content.len(),
        "addedLines": new_line_count.saturating_sub(previous_line_count),
        "removedLines": previous_line_count.saturating_sub(new_line_count),
        "firstChangedLine": first_changed_line,
    }))
}

fn run_filesystem_edit(
    input: &Value,
    scope_root: Option<&Path>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let old_text = required_nonempty_raw_string(object, "oldText")?;
    let new_text = required_raw_string(object, "newText")?;
    let replace_all = optional_bool(object, "replaceAll").unwrap_or(false);

    let current = read_text_file(&path)?;
    on_progress(json!({
        "stage": "baseline",
        "path": path.to_string_lossy(),
        "created": false,
        "baselineContent": current.clone(),
    }));
    match resolve_text_edit(&current, &old_text, &new_text, replace_all) {
        EditResolution::Applied {
            next_content,
            replacements,
            mode,
        } => {
            if next_content == current {
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "status": "unchanged",
                    "matchMode": mode,
                }));
                return Ok(json!({
                    "kind": "unchanged",
                    "path": path.to_string_lossy(),
                    "replacements": 0,
                    "alreadyApplied": true,
                    "matchMode": mode,
                }));
            }

            let first_changed_line = first_changed_line(&current, &next_content);

            on_progress(json!({
                "stage": "editing",
                "path": path.to_string_lossy(),
                "status": "applied",
                "matchMode": mode,
                "replacements": replacements,
                "firstChangedLine": first_changed_line,
            }));

            let previous_line_count = line_count(&current);
            let next_line_count = line_count(&next_content);
            write_text_file_with_progress(
                &path,
                &next_content,
                Some(first_changed_line),
                on_progress,
            )?;

            Ok(json!({
                "kind": "updated",
                "path": path.to_string_lossy(),
                "replacements": replacements,
                "matchMode": mode,
                "addedLines": next_line_count.saturating_sub(previous_line_count),
                "removedLines": previous_line_count.saturating_sub(next_line_count),
                "firstChangedLine": first_changed_line,
            }))
        }
        EditResolution::AlreadyApplied { mode } => {
            on_progress(json!({
                "stage": "editing",
                "path": path.to_string_lossy(),
                "status": "already_applied",
                "matchMode": mode,
            }));
            Ok(json!({
                "kind": "unchanged",
                "path": path.to_string_lossy(),
                "replacements": 0,
                "alreadyApplied": true,
                "matchMode": mode,
            }))
        }
        EditResolution::NoMatch => {
            on_progress(json!({
                "stage": "editing",
                "path": path.to_string_lossy(),
                "status": "no_match",
            }));
            Ok(json!({
                "kind": "no_match",
                "path": path.to_string_lossy(),
                "replacements": 0,
                "alreadyApplied": false,
                "message": format!(
                    "oldText was not found in file {}. Consider reading the latest file content and retrying with a narrower edit.",
                    path.display()
                ),
            }))
        }
    }
}

fn run_filesystem_multi_edit(
    input: &Value,
    scope_root: Option<&Path>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let edits = object
        .get("edits")
        .and_then(Value::as_array)
        .ok_or_else(|| AgentToolError::exec_failed("edits is required"))?;
    if edits.is_empty() {
        return Err(AgentToolError::exec_failed(
            "edits must contain at least one edit",
        ));
    }

    let mut next_content = read_text_file(&path)?;
    let baseline_content = next_content.clone();
    let previous_line_count = line_count(&next_content);
    let mut total_replacements = 0usize;
    let mut applied_edits = 0usize;
    let mut already_applied_edit_indexes = Vec::<usize>::new();
    let mut not_found_edit_indexes = Vec::<usize>::new();
    on_progress(json!({
        "stage": "baseline",
        "path": path.to_string_lossy(),
        "created": false,
        "baselineContent": baseline_content,
    }));

    for (index, edit_value) in edits.iter().enumerate() {
        let edit = edit_value.as_object().ok_or_else(|| {
            AgentToolError::exec_failed(format!("edits[{index}] must be an object"))
        })?;
        let old_text = required_nonempty_raw_string(edit, "oldText")?;
        let new_text = required_raw_string(edit, "newText")?;
        let replace_all = optional_bool(edit, "replaceAll").unwrap_or(false);
        match resolve_text_edit(&next_content, &old_text, &new_text, replace_all) {
            EditResolution::Applied {
                next_content: resolved_next,
                replacements,
                mode,
            } => {
                if resolved_next == next_content {
                    already_applied_edit_indexes.push(index + 1);
                    on_progress(json!({
                        "stage": "editing",
                        "path": path.to_string_lossy(),
                        "editIndex": index + 1,
                        "editCount": edits.len(),
                        "status": "already_applied",
                        "matchMode": mode,
                        "replacements": total_replacements,
                    }));
                    continue;
                }

                total_replacements = total_replacements.saturating_add(replacements);
                applied_edits = applied_edits.saturating_add(1);
                next_content = resolved_next;
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "editIndex": index + 1,
                    "editCount": edits.len(),
                    "status": "applied",
                    "matchMode": mode,
                    "replacements": total_replacements,
                }));
            }
            EditResolution::AlreadyApplied { mode } => {
                already_applied_edit_indexes.push(index + 1);
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "editIndex": index + 1,
                    "editCount": edits.len(),
                    "status": "already_applied",
                    "matchMode": mode,
                    "replacements": total_replacements,
                }));
            }
            EditResolution::NoMatch => {
                not_found_edit_indexes.push(index + 1);
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "editIndex": index + 1,
                    "editCount": edits.len(),
                    "status": "no_match",
                    "replacements": total_replacements,
                }));
            }
        }
    }

    let has_changes = baseline_content != next_content;
    let kind = if has_changes && not_found_edit_indexes.is_empty() {
        "updated"
    } else if has_changes {
        "partial"
    } else if !not_found_edit_indexes.is_empty() {
        "no_match"
    } else {
        "unchanged"
    };

    let first_changed_line = if has_changes {
        Some(first_changed_line(&baseline_content, &next_content))
    } else {
        None
    };

    if has_changes {
        write_text_file_with_progress(&path, &next_content, first_changed_line, on_progress)?;
    }

    let next_line_count = line_count(&next_content);

    Ok(json!({
        "kind": kind,
        "path": path.to_string_lossy(),
        "editCount": edits.len(),
        "appliedEditCount": applied_edits,
        "replacements": total_replacements,
        "alreadyAppliedEditIndexes": already_applied_edit_indexes,
        "notFoundEditIndexes": not_found_edit_indexes,
        "addedLines": next_line_count.saturating_sub(previous_line_count),
        "removedLines": previous_line_count.saturating_sub(next_line_count),
        "firstChangedLine": first_changed_line,
        "message": if kind == "no_match" {
            Some("No edit blocks matched exactly. Consider reading latest file content before retrying.")
        } else if kind == "partial" {
            Some("Some edits were applied, while others did not match the latest file content.")
        } else {
            None
        },
    }))
}

// --- Memory Tools ---

fn run_memory_remember(
    input: &Value,
    project_root: Option<&str>,
    storage_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let value = required_string(obj, "value")?;
    let scope = obj.get("scope").and_then(Value::as_str).unwrap_or("global");
    let layer = obj.get("layer").and_then(Value::as_str).unwrap_or("shared");

    if !matches!(scope, "project" | "global" | "user") {
        return Err(AgentToolError::exec_failed(
            "scope must be 'project', 'global', or 'user'",
        ));
    }
    if !matches!(layer, "shared" | "frozen") {
        return Err(AgentToolError::exec_failed(
            "layer must be 'shared' or 'frozen'",
        ));
    }

    // We need a storage root to write memory. Derive from project_root or fallback.
    let storage_root = resolve_memory_storage_root(storage_root, project_root)?;
    let effective_project = if scope == "project" {
        project_root
    } else {
        None
    };

    crate::memory::upsert_shared_entry_public(
        &storage_root,
        layer,
        scope,
        effective_project,
        &value,
        None,
        None,
        true,
        0.95,
    )
    .map_err(|e| AgentToolError::exec_failed(format!("failed to save memory: {e}")))?;

    Ok(json!({
        "kind": "remembered",
        "layer": layer,
        "scope": scope,
        "content": value,
    }))
}

fn run_memory_recall(
    input: &Value,
    project_root: Option<&str>,
    storage_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let query = required_string(obj, "query")?;
    let scope_filter = obj.get("scope").and_then(Value::as_str);
    let limit = obj
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .min(20) as usize;

    let storage_root = resolve_memory_storage_root(storage_root, project_root)?;

    let results = crate::memory::recall_shared_entries(
        &storage_root,
        &query,
        scope_filter,
        project_root,
        limit,
    )
    .map_err(|e| AgentToolError::exec_failed(format!("failed to recall memory: {e}")))?;

    Ok(json!({
        "kind": "recalled",
        "count": results.len(),
        "entries": results,
    }))
}

fn resolve_memory_storage_root(
    explicit_storage_root: Option<&str>,
    _project_root: Option<&str>,
) -> Result<String, AgentToolError> {
    if let Some(storage_root) = explicit_storage_root {
        let trimmed = storage_root.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    // Resolve the storage root from the home directory's .lyra path
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| AgentToolError::exec_failed("cannot determine home directory"))?;
    Ok(format!("{home}/.lyra"))
}

// --- Plan Mode Tools ---

fn default_plan_state() -> AgentPlanState {
    AgentPlanState {
        status: AgentPlanStatus::Draft,
        version: 0,
        draft_markdown: String::new(),
        proposed_markdown: None,
        approved_markdown: None,
        last_submitted_version: None,
        updated_at: now_ms(),
    }
}

fn load_plan_state(
    storage_root: &str,
    session_id: &str,
) -> Result<AgentPlanState, AgentToolError> {
    registry_db::read_agent_plan(storage_root, session_id)
        .map_err(|error| AgentToolError::exec_failed(format!("failed to read plan state: {error}")))?
        .map(Ok)
        .unwrap_or_else(|| {
            registry_db::upsert_agent_plan(storage_root, session_id, &default_plan_state())
                .map_err(|error| {
                    AgentToolError::exec_failed(format!("failed to initialize plan state: {error}"))
                })
        })
}

fn require_interaction_context<'a>(
    context: ToolExecutionContext<'a>,
) -> Result<(&'a str, &'a str, &'a str, &'a str), AgentToolError> {
    let storage_root = context
        .storage_root
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("storage root is required"))?;
    let session_id = context
        .agent_session_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("agent session id is required"))?;
    let turn_id = context
        .agent_turn_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("agent turn id is required"))?;
    let request_id = context
        .tool_call_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("tool call id is required"))?;
    Ok((storage_root, session_id, turn_id, request_id))
}

fn run_request_user_input(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let (_, session_id, turn_id, request_id) = require_interaction_context(context)?;
    let questions = obj
        .get("questions")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| AgentToolError::exec_failed("questions is required"))?;
    if questions.len() > 4 {
        return Err(AgentToolError::exec_failed(
            "request_user_input supports at most 4 questions",
        ));
    }
    let allow_note = optional_bool(obj, "allowNote").unwrap_or(false);
    Err(AgentToolError::plan_question_required(
        "additional user input required",
        json!({
            "requestId": request_id,
            "sessionId": session_id,
            "turnId": turn_id,
            "questions": questions,
            "allowNote": allow_note,
        }),
    ))
}

fn run_plan_update_draft(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let draft_markdown = required_nonempty_raw_string(obj, "draftMarkdown")?;
    let (storage_root, session_id, _turn_id, _request_id) = require_interaction_context(context)?;
    let mut plan = load_plan_state(storage_root, session_id)?;
    plan.draft_markdown = draft_markdown;
    plan.status = AgentPlanStatus::Draft;
    plan.version += 1;
    plan.updated_at = now_ms();
    let plan = registry_db::upsert_agent_plan(storage_root, session_id, &plan)
        .map_err(|error| AgentToolError::exec_failed(format!("failed to update plan draft: {error}")))?;
    Ok(json!({
        "kind": "plan_draft_updated",
        "status": "draft",
        "version": plan.version,
        "draftMarkdown": plan.draft_markdown,
        "updatedAt": plan.updated_at,
    }))
}

fn run_plan_submit_for_approval(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let plan_markdown = required_nonempty_raw_string(obj, "planMarkdown")?;
    let summary = optional_string(obj, "summary").unwrap_or_else(|| {
        plan_markdown
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Proposed plan")
            .trim()
            .to_string()
    });
    let (storage_root, session_id, turn_id, request_id) = require_interaction_context(context)?;
    let mut plan = load_plan_state(storage_root, session_id)?;
    if plan.draft_markdown != plan_markdown {
        plan.version += 1;
        plan.draft_markdown = plan_markdown.clone();
    } else if plan.version == 0 {
        plan.version = 1;
    }
    plan.status = AgentPlanStatus::Submitted;
    plan.proposed_markdown = Some(plan_markdown.clone());
    plan.last_submitted_version = Some(plan.version);
    plan.updated_at = now_ms();
    let plan = registry_db::upsert_agent_plan(storage_root, session_id, &plan)
        .map_err(|error| {
            AgentToolError::exec_failed(format!("failed to submit plan for approval: {error}"))
        })?;
    Err(AgentToolError::plan_approval_required(
        "plan approval required",
        json!({
            "requestId": request_id,
            "sessionId": session_id,
            "turnId": turn_id,
            "version": plan.version,
            "status": "submitted",
            "summary": summary,
            "proposedMarkdown": plan.proposed_markdown,
            "draftMarkdown": plan.draft_markdown,
        }),
    ))
}

// --- Terminal Tool ---

const MAX_TERMINAL_OUTPUT_BYTES: usize = 8 * 1024;
const DEFAULT_TERMINAL_TIMEOUT_MS: u64 = 30_000;
const MAX_TERMINAL_TIMEOUT_MS: u64 = 120_000;

/// Result of running a terminal command, including sandbox evaluation info.
pub struct TerminalExecResult {
    /// The command output (only present if execution succeeded).
    pub output: Option<Value>,
    /// Sandbox evaluation metadata.
    pub evaluation: TerminalEvaluation,
}

pub struct TerminalEvaluation {
    pub risk_level: CommandRiskLevel,
    pub needs_pty: bool,
    pub env_injections: Vec<String>,
    pub matched_rule: Option<String>,
    /// Whether the command was approved via permissions store.
    pub was_pre_approved: bool,
    pub interactive_category: TerminalCommandCategory,
    pub rewritable: bool,
    pub suggested_alternative: Option<String>,
    pub suggested_tool: Option<String>,
    pub mode: String,
    pub approval_pattern: Option<String>,
}

impl TerminalEvaluation {
    /// Convert to JSON metadata payload for approval-required errors.
    pub fn as_approval_metadata(
        &self,
        command: &str,
        cwd: Option<&str>,
        session_id: Option<&str>,
    ) -> Option<Value> {
        if self.risk_level.is_auto_approvable() && self.env_injections.is_empty() {
            return None;
        }
        Some(json!({
            "riskLevel": self.risk_level.label(),
            "needsPty": self.needs_pty,
            "envInjections": self.env_injections,
            "matchedRule": self.matched_rule,
            "wasPreApproved": self.was_pre_approved,
            "interactiveCategory": self.interactive_category.as_str(),
            "rewritable": self.rewritable,
            "suggestedAlternative": self.suggested_alternative,
            "suggestedTool": self.suggested_tool,
            "mode": self.mode,
            "approvalPattern": self.approval_pattern,
            "command": command,
            "cwd": cwd,
            "sessionId": session_id,
        }))
    }
}

fn register_managed_terminal_session(session_id: &str, meta: ManagedTerminalSession) {
    if let Ok(mut guard) = MANAGED_TERMINAL_SESSIONS.lock() {
        guard.insert(session_id.to_string(), meta);
    }
}

fn managed_terminal_session(session_id: &str) -> Option<ManagedTerminalSession> {
    MANAGED_TERMINAL_SESSIONS
        .lock()
        .ok()
        .and_then(|guard| guard.get(session_id).cloned())
}

fn remove_managed_terminal_session(session_id: &str) {
    if let Ok(mut guard) = MANAGED_TERMINAL_SESSIONS.lock() {
        guard.remove(session_id);
    }
}

pub fn cleanup_transient_ai_sessions(owner_session_id: &str, owner_turn_id: &str) {
    let session_ids = MANAGED_TERMINAL_SESSIONS
        .lock()
        .map(|guard| {
            guard
                .iter()
                .filter(|(_, session)| {
                    session.source == "ai"
                        && !session.persist
                        && session.owner_session_id.as_deref() == Some(owner_session_id)
                        && session.owner_turn_id.as_deref() == Some(owner_turn_id)
                })
                .map(|(session_id, _)| session_id.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for session_id in session_ids {
        let _ = close_terminal_session(TerminalCloseRequest {
            session_id: session_id.clone(),
        });
        remove_managed_terminal_session(&session_id);
    }
}

pub fn grant_approval_once(tool_call_id: &str, metadata: &Value) {
    let command = metadata
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let session_id = metadata
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if let Ok(mut guard) = APPROVED_ONCE_GRANTS.lock() {
        guard.insert(
            tool_call_id.to_string(),
            OneTimeApprovalGrant { command, session_id },
        );
    }
}

fn take_one_time_approval(
    tool_call_id: Option<&str>,
    command: Option<&str>,
    session_id: Option<&str>,
) -> bool {
    let Some(tool_call_id) = tool_call_id else {
        return false;
    };
    let Ok(mut guard) = APPROVED_ONCE_GRANTS.lock() else {
        return false;
    };
    let Some(grant) = guard.get(tool_call_id).cloned() else {
        return false;
    };
    let command_matches = match (grant.command.as_deref(), command) {
        (Some(expected), Some(actual)) => expected == actual,
        (None, _) => true,
        _ => false,
    };
    let session_matches = match (grant.session_id.as_deref(), session_id) {
        (Some(expected), Some(actual)) => expected == actual,
        (None, _) => true,
        _ => false,
    };
    if command_matches && session_matches {
        guard.remove(tool_call_id);
        true
    } else {
        false
    }
}

fn terminal_policy_or_default<'a>(
    context: ToolExecutionContext<'a>,
) -> TerminalInteractionPolicy {
    context
        .terminal_policy
        .cloned()
        .unwrap_or(TerminalInteractionPolicy {
            kind: TerminalInteractionPolicyKind::AvoidTui,
            reasons: vec!["default non-interactive terminal policy".to_string()],
            explicit_tui_request: false,
            user_insistence: false,
        })
}

fn build_terminal_evaluation(
    command: &str,
    project_root: Option<&str>,
    tool_call_id: Option<&str>,
    interactive_category: TerminalCommandCategory,
    mode: &str,
    suggested_alternative: Option<String>,
    suggested_tool: Option<String>,
) -> TerminalEvaluation {
    let perms = project_root
        .map(PermissionsStore::load)
        .unwrap_or_default();
    let one_time_approved = take_one_time_approval(tool_call_id, Some(command), None);
    let pre_approved = one_time_approved || perms.is_allowed(command);
    let (risk_level, matched_desc) = evaluate_builtin(command);
    let env_injections = detect_env_injection(command);
    let needs_pty = interactive_category.requires_pty() || needs_interactive_pty(command);
    let rewritable = suggested_alternative.is_some() || suggested_tool.is_some();

    TerminalEvaluation {
        risk_level,
        needs_pty,
        env_injections,
        matched_rule: matched_desc.map(String::from),
        was_pre_approved: pre_approved,
        interactive_category,
        rewritable,
        suggested_alternative,
        suggested_tool,
        mode: mode.to_string(),
        approval_pattern: Some(command.to_string()),
    }
}

fn interactive_advisory_value(
    command: &str,
    category: &TerminalCommandCategory,
    policy: &TerminalInteractionPolicy,
    rewrite: Option<&TerminalRewriteAdvice>,
) -> Value {
    json!({
        "kind": "interactive_advisory",
        "command": command,
        "interactiveCategory": category.as_str(),
        "policy": policy.kind.as_str(),
        "message": match policy.kind {
            TerminalInteractionPolicyKind::AvoidTui => "Prefer a non-interactive alternative for this request unless the user explicitly insists on a TUI workflow.",
            TerminalInteractionPolicyKind::AllowFallbackPty => "A PTY session is available, but prefer a non-interactive alternative unless the user clearly needs the interactive workflow.",
            TerminalInteractionPolicyKind::RequireRequestedTui => "This command needs a PTY session. Use terminal.session.start instead of terminal.exec.",
        },
        "suggestedAlternative": rewrite.and_then(|value| value.replacement_command.clone()),
        "suggestedTool": rewrite.and_then(|value| value.suggested_tool.clone()).or_else(|| Some("terminal.session.start".to_string())),
        "rewritable": rewrite.is_some(),
        "reason": rewrite.map(|value| value.reason.clone()),
    })
}

fn is_plan_mode_mutating_command(command: &str) -> bool {
    let normalized = command.trim().to_ascii_lowercase();
    [
        "rm ",
        "mv ",
        "cp ",
        "mkdir ",
        "touch ",
        "chmod ",
        "chown ",
        "git add",
        "git commit",
        "git checkout",
        "git switch",
        "git reset",
        "git merge",
        "git rebase",
        "npm install",
        "pnpm install",
        "yarn install",
        "bun install",
        "cargo build",
        "cargo test",
        "cargo run",
        "go test",
        "go build",
        "python -m pip",
        "pip install",
        "brew ",
        "apt ",
        "sudo ",
        "make ",
        "cmake ",
        "docker ",
        "kubectl apply",
    ]
    .iter()
    .any(|token| normalized == *token || normalized.contains(token))
}

/// Evaluate a command through the sandbox and execute if safe.
///
/// Replaces the old TERMINAL_BLOCKLIST approach with a layered security model:
/// 1. Check permissions store (.lyra/permissions.json) for pre-approved rules
/// 2. Evaluate against builtin rules (command classification)
/// 3. Detect environment variable injection attempts
/// 4. Determine PTY routing needs
/// 5. Execute if approved, or return evaluation for approval flow
pub fn run_terminal_exec<F>(
    input: &Value,
    scope_root: Option<&str>,
    context: ToolExecutionContext<'_>,
    mut on_progress: F,
) -> TerminalExecResult
where
    F: FnMut(&str, &str),
{
    let obj = match as_object(input) {
        Ok(o) => o,
        Err(e) => {
            return TerminalExecResult {
                output: Some(error_value(&e.to_string())),
                evaluation: TerminalEvaluation {
                    risk_level: CommandRiskLevel::Critical,
                    needs_pty: false,
                    env_injections: vec![],
                    matched_rule: None,
                    was_pre_approved: false,
                    interactive_category: TerminalCommandCategory::OneShotNonInteractive,
                    rewritable: false,
                    suggested_alternative: None,
                    suggested_tool: None,
                    mode: "exec".to_string(),
                    approval_pattern: None,
                },
            };
        }
    };
    let command = match required_string(obj, "command") {
        Ok(c) => c,
        Err(e) => {
            return TerminalExecResult {
                output: Some(error_value(&e.to_string())),
                evaluation: TerminalEvaluation {
                    risk_level: CommandRiskLevel::Critical,
                    needs_pty: false,
                    env_injections: vec![],
                    matched_rule: None,
                    was_pre_approved: false,
                    interactive_category: TerminalCommandCategory::OneShotNonInteractive,
                    rewritable: false,
                    suggested_alternative: None,
                    suggested_tool: None,
                    mode: "exec".to_string(),
                    approval_pattern: None,
                },
            };
        }
    };
    let policy = terminal_policy_or_default(context);
    let interactive_category = classify_terminal_command(&command);
    let rewrite = rewrite_interactive_command_if_possible(&command);
    let evaluation = build_terminal_evaluation(
        &command,
        context.project_root,
        context.tool_call_id,
        interactive_category.clone(),
        "exec",
        rewrite.as_ref().and_then(|value| value.replacement_command.clone()),
        rewrite
            .as_ref()
            .and_then(|value| value.suggested_tool.clone())
            .or_else(|| {
                if interactive_category.requires_pty() {
                    Some("terminal.session.start".to_string())
                } else {
                    None
                }
            }),
    );

    if interactive_category.requires_pty() {
        return TerminalExecResult {
            output: Some(interactive_advisory_value(
                &command,
                &interactive_category,
                &policy,
                rewrite.as_ref(),
            )),
            evaluation,
        };
    }

    if context.plan_mode
        && (!evaluation.risk_level.is_auto_approvable()
            || !evaluation.env_injections.is_empty()
            || is_plan_mode_mutating_command(&command))
    {
        return TerminalExecResult {
            output: Some(json!({
                "kind": "denied",
                "exitCode": -1,
                "stdout": "",
                "stderr": "plan mode only allows bounded read-only terminal inspection commands",
                "timedOut": false,
                "riskLevel": evaluation.risk_level.label(),
                "requiresApproval": false,
                "planModeReadonly": true,
            })),
            evaluation,
        };
    }

    // Step 5: Decide whether to execute or request approval
    // Pre-approved commands bypass risk checks
    if !evaluation.was_pre_approved {
        // Environment injection of critical vars → deny
        if !evaluation.env_injections.is_empty()
            && evaluation
                .env_injections
                .iter()
                .any(|v| matches_critical_env(v))
        {
            return TerminalExecResult {
                output: Some(json!({
                    "kind": "denied",
                    "exitCode": -1,
                    "stdout": "",
                    "stderr": format!("command denied: dangerous environment variable injection detected ({})", evaluation.env_injections.join(", ")),
                    "timedOut": false,
                    "riskLevel": evaluation.risk_level.label(),
                    "requiresApproval": false,
                })),
                evaluation,
            };
        }

        // Critical risk → deny unless pre-approved
        if evaluation.risk_level.is_always_denied() {
            return TerminalExecResult {
                output: Some(json!({
                    "kind": "denied",
                    "exitCode": -1,
                    "stdout": "",
                    "stderr": format!(
                        "command denied: {}",
                        evaluation
                            .matched_rule
                            .as_deref()
                            .unwrap_or("critical risk operation")
                    ),
                    "timedOut": false,
                    "riskLevel": evaluation.risk_level.label(),
                    "requiresApproval": false,
                })),
                evaluation,
            };
        }

        // High/Medium risk → needs approval (unless pre-approved)
        // Return None output to signal that approval is required upstream
        if !evaluation.risk_level.is_auto_approvable() {
            return TerminalExecResult {
                output: None,
                evaluation,
            };
        }
    }

    // Command is approved — execute it
    let cwd = obj
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(scope_root);
    let timeout_ms = obj
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TERMINAL_TIMEOUT_MS)
        .min(MAX_TERMINAL_TIMEOUT_MS);

    let exec_result =
        execute_terminal_command(&command, cwd, timeout_ms, |stdout_chunk, stderr_chunk| {
            on_progress(stdout_chunk, stderr_chunk);
        });

    let stdout = truncate_output(&exec_result.stdout);
    let stderr = truncate_output(&exec_result.stderr);

    TerminalExecResult {
        output: Some(json!({
            "kind": if exec_result.timed_out { "timed_out" } else if exec_result.exit_code == 0 { "success" } else { "failed" },
            "exitCode": exec_result.exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "timedOut": exec_result.timed_out,
            "riskLevel": evaluation.risk_level.label(),
        })),
        evaluation,
    }
}

fn run_terminal_session_start(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let mode = optional_string(obj, "mode").unwrap_or_else(|| "command".to_string());
    let persist = optional_bool(obj, "persist").unwrap_or(false);
    let cols = obj.get("cols").and_then(Value::as_u64).unwrap_or(120) as u16;
    let rows = obj.get("rows").and_then(Value::as_u64).unwrap_or(40) as u16;
    let cwd = optional_string(obj, "cwd").or_else(|| context.project_root.map(str::to_string));
    let title = optional_string(obj, "title");
    let shell = optional_string(obj, "shell");
    let command = optional_string(obj, "command");
    let policy = terminal_policy_or_default(context);

    if persist && policy.kind != TerminalInteractionPolicyKind::RequireRequestedTui {
        return Ok(json!({
            "kind": "interactive_policy_blocked",
            "mode": mode,
            "message": "Persistent PTY sessions are reserved for explicit user requests.",
        }));
    }

    if mode == "shell" && policy.kind != TerminalInteractionPolicyKind::RequireRequestedTui {
        return Ok(json!({
            "kind": "interactive_policy_blocked",
            "mode": mode,
            "message": "A full interactive shell should only be opened when the user explicitly asked for it.",
        }));
    }

    let command_category = command
        .as_deref()
        .map(classify_terminal_command)
        .unwrap_or(TerminalCommandCategory::InteractivePrompt);
    if mode == "command"
        && command_category.requires_pty()
        && policy.kind == TerminalInteractionPolicyKind::AvoidTui
    {
        let rewrite = command
            .as_deref()
            .and_then(rewrite_interactive_command_if_possible);
        return Ok(interactive_advisory_value(
            command.as_deref().unwrap_or_default(),
            &command_category,
            &policy,
            rewrite.as_ref(),
        ));
    }

    if mode == "command" {
        let command = command
            .clone()
            .ok_or_else(|| AgentToolError::exec_failed("command is required"))?;
        let evaluation = build_terminal_evaluation(
            &command,
            context.project_root,
            context.tool_call_id,
            command_category,
            "command",
            rewrite_interactive_command_if_possible(&command)
                .as_ref()
                .and_then(|value| value.replacement_command.clone()),
            Some("terminal.session.start".to_string()),
        );
        if !evaluation.was_pre_approved {
            if !evaluation.risk_level.is_auto_approvable() {
                return Err(AgentToolError::approval_required(
                    "interactive terminal command requires user approval",
                    evaluation
                        .as_approval_metadata(&command, cwd.as_deref(), None)
                        .unwrap_or_else(|| json!({})),
                ));
            }
            if !evaluation.env_injections.is_empty()
                && evaluation
                    .env_injections
                    .iter()
                    .any(|value| matches_critical_env(value))
            {
                return Ok(json!({
                    "kind": "denied",
                    "message": format!(
                        "command denied: dangerous environment variable injection detected ({})",
                        evaluation.env_injections.join(", ")
                    ),
                }));
            }
        }
    } else if mode == "shell" {
        let approved_once = take_one_time_approval(context.tool_call_id, None, None);
        let perms = context
            .project_root
            .map(PermissionsStore::load)
            .unwrap_or_default();
        if !(approved_once || perms.is_allowed("__lyra_shell_session__")) {
            return Err(AgentToolError::approval_required(
                "interactive shell session requires user approval",
                json!({
                    "riskLevel": "high",
                    "needsPty": true,
                    "interactiveCategory": TerminalCommandCategory::InteractivePrompt.as_str(),
                    "mode": "shell",
                    "approvalPattern": "__lyra_shell_session__",
                    "suggestedTool": "terminal.session.start",
                }),
            ));
        }
    } else {
        return Err(AgentToolError::exec_failed("mode must be command or shell"));
    }

    let snapshot = create_terminal_session(TerminalCreateRequest {
        session_id: None,
        title,
        cwd,
        shell,
        cols,
        rows,
        source: Some("ai".to_string()),
        mode: Some(mode.clone()),
        command: command.clone(),
        persist: Some(persist),
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;

    register_managed_terminal_session(
        &snapshot.session_id,
        ManagedTerminalSession {
            owner_session_id: context.agent_session_id.map(str::to_string),
            owner_turn_id: context.agent_turn_id.map(str::to_string),
            source: snapshot.source.clone(),
            mode: snapshot.mode.clone(),
            persist: snapshot.persist,
        },
    );

    Ok(json!({
        "kind": "started",
        "sessionId": snapshot.session_id,
        "title": snapshot.title,
        "cwd": snapshot.cwd,
        "shell": snapshot.shell,
        "source": snapshot.source,
        "mode": snapshot.mode,
        "command": snapshot.command,
        "persist": snapshot.persist,
        "running": snapshot.running,
        "exitCode": snapshot.exit_code,
    }))
}

fn run_terminal_session_read(input: &Value) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let session_id = required_string(obj, "sessionId")?;
    let cursor = optional_string(obj, "cursor");
    let max_bytes = obj.get("maxBytes").and_then(Value::as_u64).map(|value| value as u32);
    let wait_ms = obj.get("waitMs").and_then(Value::as_u64).map(|value| value as u32);
    let response = read_terminal_session(TerminalReadRequest {
        session_id: session_id.clone(),
        cursor,
        max_bytes,
        wait_ms,
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;
    Ok(json!({
        "kind": "read",
        "sessionId": response.session_id,
        "cursor": response.cursor,
        "output": truncate_output(response.output.as_bytes()),
        "running": response.running,
        "exitCode": response.exit_code,
        "truncated": response.truncated,
        "source": response.source,
        "mode": response.mode,
    }))
}

fn run_terminal_session_write(
    input: &Value,
    context: ToolExecutionContext<'_>,
) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let session_id = required_string(obj, "sessionId")?;
    let text = optional_string(obj, "text");
    let append_newline = optional_bool(obj, "appendNewline").unwrap_or(false);
    let keys = obj.get("keys").and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>()
    });
    if text.is_none() && keys.as_ref().is_none_or(|items| items.is_empty()) {
        return Err(AgentToolError::exec_failed(
            "terminal.session.write requires text or keys",
        ));
    }

    let managed = managed_terminal_session(&session_id);
    let session_mode = managed
        .as_ref()
        .map(|meta| meta.mode.as_str())
        .unwrap_or("command");

    if session_mode == "shell" {
        let command_candidate = text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && append_newline)
            .map(str::to_string);
        if let Some(command) = command_candidate.as_deref() {
            let evaluation = build_terminal_evaluation(
                command,
                context.project_root,
                context.tool_call_id,
                classify_terminal_command(command),
                "shell",
                rewrite_interactive_command_if_possible(command)
                    .as_ref()
                    .and_then(|value| value.replacement_command.clone()),
                None,
            );
            let one_time_session_grant =
                take_one_time_approval(context.tool_call_id, Some(command), Some(&session_id));
            let perms = context
                .project_root
                .map(PermissionsStore::load)
                .unwrap_or_default();
            if !(one_time_session_grant
                || evaluation.was_pre_approved
                || perms.is_allowed(command))
                && !evaluation.risk_level.is_auto_approvable()
            {
                return Err(AgentToolError::approval_required(
                    "shell command requires user approval",
                    evaluation
                        .as_approval_metadata(command, context.project_root, Some(&session_id))
                        .unwrap_or_else(|| json!({})),
                ));
            }
        }
    }

    write_terminal_session(TerminalWriteRequest {
        session_id: session_id.clone(),
        data: None,
        text,
        keys,
        append_newline: Some(append_newline),
        source: Some("ai".to_string()),
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;

    Ok(json!({
        "kind": "written",
        "sessionId": session_id,
        "mode": session_mode,
    }))
}

fn run_terminal_session_close(input: &Value) -> Result<Value, AgentToolError> {
    let obj = as_object(input)?;
    let session_id = required_string(obj, "sessionId")?;
    close_terminal_session(TerminalCloseRequest {
        session_id: session_id.clone(),
    })
    .map_err(|error| AgentToolError::exec_failed(error.to_string()))?;
    remove_managed_terminal_session(&session_id);
    Ok(json!({
        "kind": "closed",
        "sessionId": session_id,
    }))
}

fn matches_critical_env(var: &str) -> bool {
    matches!(
        var,
        "LD_PRELOAD" | "LD_LIBRARY_PATH" | "LD_AUDIT" | "DYLD_INSERT_LIBRARIES" | "DOCKER_HOST"
    )
}

fn error_value(msg: &str) -> Value {
    json!({
        "kind": "error",
        "exitCode": -1,
        "stdout": "",
        "stderr": msg,
        "timedOut": false,
    })
}

struct ExecOutput {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

fn execute_terminal_command<F>(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
    on_progress: F,
) -> ExecOutput
where
    F: FnMut(&str, &str),
{
    use std::io::BufRead;
    use std::sync::mpsc;

    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(command);

    if let Some(cwd) = cwd {
        let cwd_path = Path::new(cwd);
        if cwd_path.exists() {
            cmd.current_dir(cwd_path);
        }
    }

    cmd.env("TERM", "dumb");

    let mut child = match cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return ExecOutput {
                exit_code: -1,
                stdout: Vec::new(),
                stderr: format!("failed to spawn command: {e}").into_bytes(),
                timed_out: false,
            };
        }
    };

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let child_id = child.id();

    // Channel for reader threads to send output chunks back to main thread
    // (text, is_stderr)
    let (tx, rx) = mpsc::channel::<(String, bool)>();

    // Reader thread: stdout
    let stdout_handle = stdout_pipe.map(|pipe| {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(pipe);
            let mut buf = Vec::new();
            let mut collected = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Ok(text) = std::str::from_utf8(&buf) {
                            let _ = tx.send((text.to_string(), false));
                        }
                        collected.extend_from_slice(&buf);
                    }
                    Err(_) => break,
                }
            }
            collected
        })
    });

    // Reader thread: stderr
    let stderr_handle = stderr_pipe.map(|pipe| {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(pipe);
            let mut buf = Vec::new();
            let mut collected = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Ok(text) = std::str::from_utf8(&buf) {
                            let _ = tx.send((text.to_string(), true));
                        }
                        collected.extend_from_slice(&buf);
                    }
                    Err(_) => break,
                }
            }
            collected
        })
    });

    // Drop the original sender so rx will return RecvError when both readers finish
    drop(tx);

    // Main thread: poll child process and drain output channel
    let mut on_progress = on_progress;
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        // Drain all available messages from the channel (non-blocking)
        loop {
            match rx.try_recv() {
                Ok((text, is_stderr)) => {
                    if is_stderr {
                        on_progress("", &text);
                    } else {
                        on_progress(&text, "");
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => break,
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }

        if std::time::Instant::now() > deadline {
            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .arg("-9")
                    .arg(child_id.to_string())
                    .output();
            }
            // Wait for reader threads to finish after killing
            let full_stdout = stdout_handle
                .map(|h| h.join().unwrap_or_default())
                .unwrap_or_default();
            let _full_stderr = stderr_handle
                .map(|h| h.join().unwrap_or_default())
                .unwrap_or_default();
            // Drain remaining messages
            while let Ok((text, is_stderr)) = rx.try_recv() {
                if is_stderr {
                    on_progress("", &text);
                } else {
                    on_progress(&text, "");
                }
            }
            return ExecOutput {
                exit_code: -1,
                stdout: full_stdout,
                stderr: format!("command timed out after {timeout_ms}ms").into_bytes(),
                timed_out: true,
            };
        }

        let stdout_done = stdout_handle.as_ref().map_or(true, |h| h.is_finished());
        let stderr_done = stderr_handle.as_ref().map_or(true, |h| h.is_finished());

        if stdout_done && stderr_done {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let full_stdout = stdout_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    let full_stderr = stderr_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    // Drain any remaining messages
                    while let Ok((text, is_stderr)) = rx.try_recv() {
                        if is_stderr {
                            on_progress("", &text);
                        } else {
                            on_progress(&text, "");
                        }
                    }
                    return ExecOutput {
                        exit_code: status.code().unwrap_or(-1),
                        stdout: full_stdout,
                        stderr: full_stderr,
                        timed_out: false,
                    };
                }
                Ok(None) => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    let full_stdout = stdout_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    let full_stderr = stderr_handle
                        .map(|h| h.join().unwrap_or_default())
                        .unwrap_or_default();
                    // Drain remaining messages
                    while let Ok((text, is_stderr)) = rx.try_recv() {
                        if is_stderr {
                            on_progress("", &text);
                        } else {
                            on_progress(&text, "");
                        }
                    }
                    return ExecOutput {
                        exit_code: -1,
                        stdout: full_stdout,
                        stderr: full_stderr,
                        timed_out: false,
                    };
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

fn truncate_output(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    if s.len() > MAX_TERMINAL_OUTPUT_BYTES {
        let truncated = &s[..MAX_TERMINAL_OUTPUT_BYTES];
        format!("{truncated}\n... [truncated to {MAX_TERMINAL_OUTPUT_BYTES} bytes]")
    } else {
        s.into_owned()
    }
}

// --- LSP code intelligence tools ---

fn infer_language_id(file_path: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())?;
    match ext {
        "ts" | "tsx" | "mts" | "cts" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "rs" => Some("rust"),
        "py" | "pyi" => Some("python"),
        _ => None,
    }
}

fn resolve_lsp_language_id(
    object: &serde_json::Map<String, Value>,
    file_path: &str,
) -> Result<String, AgentToolError> {
    if let Some(lang) = object.get("languageId").and_then(Value::as_str) {
        let trimmed = lang.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    infer_language_id(file_path)
        .map(str::to_string)
        .ok_or_else(|| {
            AgentToolError::exec_failed(format!(
                "cannot infer language for {file_path}; provide languageId explicitly"
            ))
        })
}

fn run_lsp_goto_definition(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let line = required_u32(object, "line")?;
    let column = required_u32(object, "column")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let locations = lyra_lsp_core::goto_definition(lyra_lsp_core::LspPositionRequest {
        file_path: file_path.clone(),
        language_id,
        line,
        column,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp goto_definition failed: {e}")))?;

    if locations.is_empty() {
        return Ok(json!({ "definitions": [], "message": "No definition found" }));
    }

    let items: Vec<Value> = locations
        .iter()
        .map(|loc| {
            json!({
                "filePath": loc.file_path,
                "startLine": loc.start_line,
                "startColumn": loc.start_character,
                "endLine": loc.end_line,
                "endColumn": loc.end_character,
            })
        })
        .collect();

    Ok(json!({ "definitions": items }))
}

fn run_lsp_find_references(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let line = required_u32(object, "line")?;
    let column = required_u32(object, "column")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let locations = lyra_lsp_core::find_references(lyra_lsp_core::LspPositionRequest {
        file_path: file_path.clone(),
        language_id,
        line,
        column,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp find_references failed: {e}")))?;

    let items: Vec<Value> = locations
        .iter()
        .map(|loc| {
            json!({
                "filePath": loc.file_path,
                "startLine": loc.start_line,
                "startColumn": loc.start_character,
                "endLine": loc.end_line,
                "endColumn": loc.end_character,
            })
        })
        .collect();

    Ok(json!({ "references": items, "count": items.len() }))
}

fn run_lsp_hover(input: &Value, project_root: Option<&str>) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let line = required_u32(object, "line")?;
    let column = required_u32(object, "column")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let result = lyra_lsp_core::hover(lyra_lsp_core::LspPositionRequest {
        file_path,
        language_id,
        line,
        column,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp hover failed: {e}")))?;

    match result {
        Some(hover) => Ok(json!({
            "contents": hover.contents,
            "range": {
                "startLine": hover.start_line,
                "startColumn": hover.start_character,
                "endLine": hover.end_line,
                "endColumn": hover.end_character,
            }
        })),
        None => Ok(json!({ "contents": null, "message": "No hover information available" })),
    }
}

fn run_lsp_get_diagnostics(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let content = required_raw_string(object, "content")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let diagnostics = lyra_lsp_core::get_diagnostics(lyra_lsp_core::LspDiagnosticsRequest {
        file_path,
        language_id,
        content,
        version: 1,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp get_diagnostics failed: {e}")))?;

    let items: Vec<Value> = diagnostics
        .iter()
        .map(|d| {
            json!({
                "startLine": d.start_line,
                "startColumn": d.start_character,
                "endLine": d.end_line,
                "endColumn": d.end_character,
                "severity": match d.severity {
                    Some(1) => "error",
                    Some(2) => "warning",
                    Some(3) => "info",
                    Some(4) => "hint",
                    _ => "unknown",
                },
                "code": d.code,
                "source": d.source,
                "message": d.message,
            })
        })
        .collect();

    let error_count = diagnostics.iter().filter(|d| d.severity == Some(1)).count();
    let warning_count = diagnostics.iter().filter(|d| d.severity == Some(2)).count();

    Ok(json!({
        "diagnostics": items,
        "count": items.len(),
        "errors": error_count,
        "warnings": warning_count,
    }))
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
