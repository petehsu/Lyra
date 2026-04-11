use serde_json::json;

use super::external::{
    ExternalToolApprovalMode, ExternalToolSideEffectLevel, ExternalToolSideEffects,
};
use crate::provider::types::AgentToolDefinition;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolExecutionMode {
    ParallelReadOnly,
    Serial,
}

impl ToolExecutionMode {
    pub const fn executes_serially(self) -> bool {
        matches!(self, Self::Serial)
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ParallelReadOnly => "parallel_readonly",
            Self::Serial => "serial",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct BuiltinToolSpec {
    pub definition: AgentToolDefinition,
    pub execution_mode: ToolExecutionMode,
    pub approval_mode: ExternalToolApprovalMode,
    pub side_effects: ExternalToolSideEffects,
    pub available_in_plan_mode: bool,
    pub available_in_standard_mode: bool,
}

pub(super) fn decorated_builtin_definition(tool: &BuiltinToolSpec) -> AgentToolDefinition {
    AgentToolDefinition {
        name: tool.definition.name.clone(),
        description: decorate_builtin_description(tool),
        input_schema: tool.definition.input_schema.clone(),
    }
}

fn infer_builtin_side_effects(name: &str) -> ExternalToolSideEffects {
    match name {
        "filesystem.write" | "filesystem.edit" | "filesystem.multi_edit" => {
            ExternalToolSideEffects::workspace_write()
        }
        "memory.remember" => ExternalToolSideEffects {
            level: ExternalToolSideEffectLevel::SessionMutation,
            mutates_workspace: false,
            mutates_memory: true,
            mutates_external_systems: false,
            mutates_session_state: true,
            opens_interactive_session: false,
            reads_network: false,
        },
        "terminal.exec" => ExternalToolSideEffects {
            level: ExternalToolSideEffectLevel::ExternalMutation,
            mutates_workspace: true,
            mutates_memory: false,
            mutates_external_systems: true,
            mutates_session_state: true,
            opens_interactive_session: false,
            reads_network: true,
        },
        "terminal.session.start" | "terminal.session.write" | "terminal.session.close" => {
            ExternalToolSideEffects {
                level: ExternalToolSideEffectLevel::SessionMutation,
                mutates_workspace: false,
                mutates_memory: false,
                mutates_external_systems: false,
                mutates_session_state: true,
                opens_interactive_session: true,
                reads_network: false,
            }
        }
        "terminal.session.read" => ExternalToolSideEffects {
            level: ExternalToolSideEffectLevel::SessionMutation,
            mutates_workspace: false,
            mutates_memory: false,
            mutates_external_systems: false,
            mutates_session_state: true,
            opens_interactive_session: false,
            reads_network: false,
        },
        "plan.update_draft" | "plan.submit_for_approval" | "request_user_input" => {
            ExternalToolSideEffects {
                level: ExternalToolSideEffectLevel::SessionMutation,
                mutates_workspace: false,
                mutates_memory: false,
                mutates_external_systems: false,
                mutates_session_state: true,
                opens_interactive_session: false,
                reads_network: false,
            }
        }
        _ => ExternalToolSideEffects::read_only(),
    }
}

fn infer_builtin_approval_mode(name: &str) -> ExternalToolApprovalMode {
    match name {
        "filesystem.write"
        | "filesystem.edit"
        | "filesystem.multi_edit"
        | "memory.remember"
        | "terminal.exec"
        | "terminal.session.start"
        | "terminal.session.write"
        | "terminal.session.close" => ExternalToolApprovalMode::Ask,
        _ => ExternalToolApprovalMode::Auto,
    }
}

fn side_effect_summary(side_effects: &ExternalToolSideEffects) -> String {
    let mut parts = vec![format!("level={}", side_effects.level.as_str())];
    if side_effects.mutates_workspace {
        parts.push("workspace-write".to_string());
    }
    if side_effects.mutates_memory {
        parts.push("memory-write".to_string());
    }
    if side_effects.mutates_external_systems {
        parts.push("external-mutation".to_string());
    }
    if side_effects.mutates_session_state {
        parts.push("session-mutation".to_string());
    }
    if side_effects.opens_interactive_session {
        parts.push("interactive-session".to_string());
    }
    if side_effects.reads_network {
        parts.push("network-read".to_string());
    }
    parts.join(", ")
}

fn decorate_builtin_description(tool: &BuiltinToolSpec) -> String {
    format!(
        "{}\n\nExecution mode: {}. Approval mode: {}. Side effects: {}.",
        tool.definition.description,
        tool.execution_mode.as_str(),
        tool.approval_mode.as_str(),
        side_effect_summary(&tool.side_effects)
    )
}

fn builtin_tool(
    name: &str,
    description: &str,
    input_schema: serde_json::Value,
    execution_mode: ToolExecutionMode,
    available_in_plan_mode: bool,
) -> BuiltinToolSpec {
    BuiltinToolSpec {
        definition: AgentToolDefinition {
            name: name.to_string(),
            description: description.to_string(),
            input_schema,
        },
        execution_mode,
        approval_mode: infer_builtin_approval_mode(name),
        side_effects: infer_builtin_side_effects(name),
        available_in_plan_mode,
        available_in_standard_mode: true,
    }
}

fn plan_only_tool(
    name: &str,
    description: &str,
    input_schema: serde_json::Value,
    execution_mode: ToolExecutionMode,
) -> BuiltinToolSpec {
    BuiltinToolSpec {
        definition: AgentToolDefinition {
            name: name.to_string(),
            description: description.to_string(),
            input_schema,
        },
        execution_mode,
        approval_mode: infer_builtin_approval_mode(name),
        side_effects: infer_builtin_side_effects(name),
        available_in_plan_mode: true,
        available_in_standard_mode: false,
    }
}

pub(super) fn standard_builtin_tool_specs() -> Vec<BuiltinToolSpec> {
    vec![
        builtin_tool(
            "filesystem.list",
            "List files and directories under a target path. Read-only; no write side effects.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "filesystem.glob",
            "Find files or directories by glob pattern in a root directory. Read-only.",
            json!({
                "type": "object",
                "required": ["pattern"],
                "properties": {
                    "pattern": { "type": "string" },
                    "root": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "filesystem.search",
            "Search plain text in files and return line matches. Read-only.",
            json!({
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
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "filesystem.read_range",
            "Read a line range from a UTF-8 text file. Read-only.",
            json!({
                "type": "object",
                "required": ["path", "startLine", "endLine"],
                "properties": {
                    "path": { "type": "string" },
                    "startLine": { "type": "number" },
                    "endLine": { "type": "number" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "filesystem.write",
            "Write full UTF-8 text content to a file path. Creates the file if missing.",
            json!({
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "filesystem.edit",
            "Edit an existing UTF-8 text file by replacing an exact text block.",
            json!({
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
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "filesystem.multi_edit",
            "Apply multiple exact text replacements to one existing UTF-8 text file.",
            json!({
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
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "memory.remember",
            "Save a fact, preference, or project convention to long-term memory. Use this when you learn something worth recalling in future sessions.",
            json!({
                "type": "object",
                "required": ["value"],
                "properties": {
                    "value": { "type": "string", "description": "The fact or knowledge to remember" },
                    "scope": { "type": "string", "enum": ["project", "global", "user"], "description": "Memory scope: project-specific, global, or user-personal" },
                    "layer": { "type": "string", "enum": ["shared", "frozen"], "description": "shared for general knowledge, frozen for stable user facts" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "memory.recall",
            "Search long-term memory for relevant facts, preferences, or project conventions.",
            json!({
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": { "type": "string", "description": "Search query to find relevant memories" },
                    "scope": { "type": "string", "enum": ["project", "global", "user"] },
                    "limit": { "type": "number", "description": "Max results to return (default 5)" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "request_user_input",
            "Ask the user 1-4 structured questions with 2-4 options each when a blocking preference or decision cannot be derived from the repo or prior context.",
            json!({
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
            ToolExecutionMode::Serial,
            true,
        ),
        builtin_tool(
            "terminal.exec",
            "Execute a shell command and return its output. Use for running build commands, tests, or inspecting system state.",
            json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" },
                    "cwd": { "type": "string", "description": "Working directory (defaults to project root)" },
                    "timeout_ms": { "type": "number", "description": "Timeout in milliseconds (default 30000, max 120000)" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::Serial,
            true,
        ),
        builtin_tool(
            "terminal.session.start",
            "Start an interactive PTY-backed terminal session. Use command mode for a single interactive command, or shell mode only when the user explicitly asked for a full shell.",
            json!({
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
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "terminal.session.read",
            "Read incremental output from an existing PTY terminal session.",
            json!({
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
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "terminal.session.write",
            "Send text or navigation keys to an existing PTY terminal session.",
            json!({
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
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "terminal.session.close",
            "Close an interactive PTY terminal session.",
            json!({
                "type": "object",
                "required": ["sessionId"],
                "properties": {
                    "sessionId": { "type": "string" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::Serial,
            false,
        ),
        builtin_tool(
            "lsp.goto_definition",
            "Jump to the definition of a symbol at a given position in a source file. Returns file paths and line ranges of the definition(s).",
            json!({
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
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "lsp.find_references",
            "Find all references to a symbol at a given position across the project. Returns file paths and line ranges.",
            json!({
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
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "lsp.hover",
            "Get type information and documentation for the symbol at a given position. Returns the hover contents (type signature, docs).",
            json!({
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
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
        builtin_tool(
            "lsp.get_diagnostics",
            "Get compiler errors, warnings, and lint diagnostics for a source file. Requires providing the current file content.",
            json!({
                "type": "object",
                "required": ["filePath", "content"],
                "properties": {
                    "filePath": { "type": "string", "description": "Absolute path to the source file" },
                    "content": { "type": "string", "description": "Current full text content of the file" },
                    "languageId": { "type": "string", "description": "Language identifier (typescript, rust, python). Auto-detected from extension if omitted." }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::ParallelReadOnly,
            true,
        ),
    ]
    .into_iter()
    .filter(|tool| tool.available_in_standard_mode)
    .collect()
}

pub(super) fn plan_only_tool_specs() -> Vec<BuiltinToolSpec> {
    vec![
        plan_only_tool(
            "plan.update_draft",
            "Replace the current plan draft with a new complete markdown draft. Each update increments the plan version.",
            json!({
                "type": "object",
                "required": ["draftMarkdown"],
                "properties": {
                    "draftMarkdown": { "type": "string" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::Serial,
        ),
        plan_only_tool(
            "plan.submit_for_approval",
            "Submit the current plan for user approval. The plan must be complete enough that implementation no longer requires decisions.",
            json!({
                "type": "object",
                "required": ["planMarkdown"],
                "properties": {
                    "planMarkdown": { "type": "string" },
                    "summary": { "type": "string" }
                },
                "additionalProperties": false
            }),
            ToolExecutionMode::Serial,
        ),
    ]
}

pub(super) fn all_builtin_tool_specs() -> Vec<BuiltinToolSpec> {
    let mut specs = standard_builtin_tool_specs();
    specs.extend(plan_only_tool_specs());
    specs
}

pub fn builtin_tool_execution_mode(name: &str) -> Option<ToolExecutionMode> {
    all_builtin_tool_specs()
        .into_iter()
        .find(|tool| tool.definition.name == name)
        .map(|tool| tool.execution_mode)
}
