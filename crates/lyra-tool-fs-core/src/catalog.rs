use serde_json::{Value, json};
use std::collections::HashSet;

use crate::error::ToolFsError;
use crate::model::ToolManifest;
use crate::registry::normalize_tool_path;
use crate::schema::{attach_schema_id, object_schema, schema_id_for_path};

pub(crate) fn validate_manifest_set(manifests: &[ToolManifest]) -> Result<(), ToolFsError> {
    let mut paths = HashSet::new();
    let mut handles = HashSet::new();
    for manifest in manifests {
        validate_manifest(manifest)?;
        if !paths.insert(manifest.path.clone()) {
            return Err(ToolFsError::new(
                "duplicate_tool_path",
                format!("Tool-FS manifest path is duplicated: {}", manifest.path),
                "Fix the manifest provider so every tool path is unique.",
            ));
        }
        if let Some(handle) = manifest.handle.as_deref().filter(|value| !value.is_empty())
            && !handles.insert(handle.to_string())
        {
            return Err(ToolFsError::new(
                "duplicate_tool_handle",
                format!("Tool-FS manifest handle is duplicated: {handle}"),
                "Fix the manifest provider so every pinned handle is unique.",
            ));
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &ToolManifest) -> Result<(), ToolFsError> {
    let normalized = normalize_tool_path(&manifest.path);
    if manifest.path != normalized || !manifest.path.starts_with("/tools/") {
        return Err(ToolFsError::new(
            "invalid_tool_path",
            format!("Tool-FS manifest path is invalid: {}", manifest.path),
            "Use a normalized /tools/<domain>/<operation> path.",
        ));
    }
    let path_domain = manifest
        .path
        .trim_start_matches("/tools/")
        .split('/')
        .next()
        .unwrap_or_default();
    if manifest.domain.trim().is_empty()
        || manifest.domain != path_domain
        || !is_manifest_token(&manifest.domain)
    {
        return Err(ToolFsError::new(
            "invalid_tool_domain",
            format!(
                "Tool-FS manifest domain `{}` does not match path `{}`.",
                manifest.domain, manifest.path
            ),
            "Use a lowercase manifest domain matching /tools/<domain>.",
        ));
    }
    if manifest.operation.trim().is_empty() || !is_manifest_token(&manifest.operation) {
        return Err(ToolFsError::new(
            "invalid_tool_operation",
            format!(
                "Tool-FS manifest operation is invalid: {}",
                manifest.operation
            ),
            "Use a non-empty lowercase operation id.",
        ));
    }
    if manifest.title.trim().is_empty() || manifest.summary.trim().is_empty() {
        return Err(ToolFsError::new(
            "invalid_tool_manifest",
            format!(
                "Tool-FS manifest is missing title or summary: {}",
                manifest.path
            ),
            "Provide a user-facing title and summary.",
        ));
    }
    if manifest.input_schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err(ToolFsError::new(
            "invalid_tool_schema",
            format!(
                "Tool-FS manifest inputSchema must be an object: {}",
                manifest.path
            ),
            "Provide an object inputSchema.",
        ));
    }
    let expected_schema_id = schema_id_for_path(&manifest.path);
    if manifest.input_schema.get("$id").and_then(Value::as_str) != Some(expected_schema_id.as_str())
    {
        return Err(ToolFsError::new(
            "invalid_tool_schema_id",
            format!(
                "Tool-FS manifest inputSchema $id is invalid: {}",
                manifest.path
            ),
            "Attach the stable Tool-FS schema id for this path.",
        )
        .with_detail(json!({
            "expected": expected_schema_id,
            "actual": manifest.input_schema.get("$id").cloned().unwrap_or(Value::Null),
        })));
    }
    Ok(())
}

fn is_manifest_token(value: &str) -> bool {
    value.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '_'
            || character == '-'
    })
}

pub(crate) fn builtin_manifests() -> Vec<ToolManifest> {
    let mut entries = vec![
        s(
            "/tools/runtime/artifact_read",
            "runtime",
            "read",
            "Read artifact",
            "Read a Lyra-owned artifact.",
            Some("artifact_read"),
        ),
        s(
            "/tools/memory/search",
            "memory",
            "search",
            "Search memory",
            "Search Lyra long-term shared memory.",
            Some("memory_search"),
        ),
        s(
            "/tools/memory/remember",
            "memory",
            "remember",
            "Remember",
            "Write a durable Lyra memory.",
            None,
        ),
        s(
            "/tools/memory/update",
            "memory",
            "update",
            "Update memory",
            "Update an existing memory record.",
            None,
        ),
        s(
            "/tools/memory/forget",
            "memory",
            "forget",
            "Forget memory",
            "Archive or delete a memory record.",
            None,
        ),
        s(
            "/tools/memory/list",
            "memory",
            "list",
            "List memory",
            "List memory summaries.",
            None,
        ),
        s(
            "/tools/memory/link",
            "memory",
            "link",
            "Link memory",
            "Create a memory relation.",
            None,
        ),
        s(
            "/tools/memory/review_candidates",
            "memory",
            "review_candidates",
            "Review memory candidates",
            "Review pending memory candidates.",
            None,
        ),
        s(
            "/tools/memory/apply_candidate",
            "memory",
            "apply_candidate",
            "Apply memory candidate",
            "Apply a memory candidate.",
            None,
        ),
        s(
            "/tools/memory/reject_candidate",
            "memory",
            "reject_candidate",
            "Reject memory candidate",
            "Reject a memory candidate.",
            None,
        ),
        s(
            "/tools/memory/explain_injection",
            "memory",
            "explain_injection",
            "Explain memory injection",
            "Explain injected memories.",
            None,
        ),
        s(
            "/tools/clarification/ask",
            "clarification",
            "ask",
            "Ask user",
            "Ask a structured clarification question.",
            Some("ask_user"),
        ),
        s(
            "/tools/workbench/list_tabs",
            "workbench",
            "list_tabs",
            "List workbench tabs",
            "List Lyra workbench tabs.",
            Some("workbench_list_tabs"),
        ),
        s(
            "/tools/workbench/read_workspace",
            "workbench",
            "read_workspace",
            "Read workspace",
            "Read visible workspace state.",
            Some("workbench_read_workspace"),
        ),
        s(
            "/tools/workbench/read_tab",
            "workbench",
            "read_tab",
            "Read workbench tab",
            "Read one Lyra workbench tab.",
            Some("workbench_read_tab"),
        ),
        s(
            "/tools/workbench/activate_tab",
            "workbench",
            "activate_tab",
            "Activate workbench tab",
            "Activate one Lyra workbench tab.",
            None,
        ),
        s(
            "/tools/software/list_capabilities",
            "software",
            "list_capabilities",
            "List software capabilities",
            "List installed software adapters.",
            None,
        ),
        s(
            "/tools/software/inspect_capability",
            "software",
            "inspect_capability",
            "Inspect software capability",
            "Inspect a software adapter capability.",
            None,
        ),
        s(
            "/tools/software/read_state",
            "software",
            "read_state",
            "Read software state",
            "Read lightweight software state.",
            None,
        ),
        s(
            "/tools/software/invoke_capability",
            "software",
            "invoke_capability",
            "Invoke software capability",
            "Invoke a software adapter capability.",
            None,
        ),
        s(
            "/tools/browser/map",
            "browser",
            "map",
            "Map browser page",
            "Map actionable browser elements.",
            Some("browser_map"),
        ),
        s(
            "/tools/browser/read",
            "browser",
            "read",
            "Read browser page",
            "Read text from a browser page.",
            Some("browser_read"),
        ),
        s(
            "/tools/browser/find",
            "browser",
            "find",
            "Find in browser page",
            "Search text within a browser page and optionally reveal the selected match.",
            Some("browser_find"),
        ),
        s(
            "/tools/browser/locate",
            "browser",
            "locate",
            "Locate browser page section",
            "Find or semantically locate text on a browser page, reveal it, and map nearby controls.",
            Some("browser_locate"),
        ),
        s(
            "/tools/browser/see",
            "browser",
            "see",
            "See browser page",
            "Capture a visual browser snapshot.",
            None,
        ),
        s(
            "/tools/browser/act",
            "browser",
            "act",
            "Act in browser",
            "Click or hover a browser target.",
            None,
        ),
        s(
            "/tools/browser/type",
            "browser",
            "type",
            "Type in browser",
            "Type text into a browser target.",
            None,
        ),
        s(
            "/tools/browser/press",
            "browser",
            "press",
            "Press browser key",
            "Press a browser keyboard key.",
            None,
        ),
        s(
            "/tools/browser/submit",
            "browser",
            "submit",
            "Submit browser control",
            "Submit focused browser control.",
            None,
        ),
        s(
            "/tools/browser/scroll",
            "browser",
            "scroll",
            "Scroll browser page",
            "Scroll the browser viewport or a target area before mapping or interacting.",
            Some("browser_scroll"),
        ),
        s(
            "/tools/browser/scroll_to_target",
            "browser",
            "scroll_to_target",
            "Scroll to browser target",
            "Bring a mapped browser target near the visible viewport center.",
            Some("browser_scroll_to_target"),
        ),
        s(
            "/tools/browser/ensure_visible",
            "browser",
            "ensure_visible",
            "Ensure browser target visible",
            "Auto-scroll a browser target or point into the visible viewport before acting.",
            Some("browser_ensure_visible"),
        ),
        s(
            "/tools/browser/wait",
            "browser",
            "wait",
            "Wait browser",
            "Wait for browser page state.",
            None,
        ),
        s(
            "/tools/browser/read_until",
            "browser",
            "read_until",
            "Read browser until",
            "Wait and read browser text.",
            None,
        ),
        s(
            "/tools/browser/navigate",
            "browser",
            "navigate",
            "Navigate browser",
            "Navigate a browser page.",
            None,
        ),
        s(
            "/tools/browser/reveal",
            "browser",
            "reveal",
            "Reveal browser target",
            "Reveal a browser target.",
            None,
        ),
        s(
            "/tools/browser/focus_scan",
            "browser",
            "focus_scan",
            "Focus scan browser",
            "Scan focusable browser targets.",
            None,
        ),
        s(
            "/tools/browser/follow_audit",
            "browser",
            "follow_audit",
            "Audit browser Follow",
            "Audit browser follow state.",
            None,
        ),
        s(
            "/tools/browser/explain_target",
            "browser",
            "explain_target",
            "Explain browser target",
            "Explain a browser target reference.",
            None,
        ),
        s(
            "/tools/browser/audit",
            "browser",
            "audit",
            "Audit browser",
            "Audit browser state.",
            None,
        ),
        s(
            "/tools/browser/elevate",
            "browser",
            "elevate",
            "Elevate browser task",
            "Elevate an isolated browser task.",
            None,
        ),
        s(
            "/tools/filesystem/list_files",
            "filesystem",
            "list",
            "List files",
            "List workspace directory entries.",
            Some("list_files"),
        ),
        s(
            "/tools/filesystem/read_file",
            "filesystem",
            "read",
            "Read file",
            "Read a workspace file.",
            Some("read_file"),
        ),
        s(
            "/tools/filesystem/read_range",
            "filesystem",
            "read",
            "Read file range",
            "Read a line range from a workspace file.",
            Some("read_range"),
        ),
        s(
            "/tools/filesystem/glob",
            "filesystem",
            "glob",
            "Glob files",
            "Find files by glob.",
            Some("find_files"),
        ),
        s(
            "/tools/filesystem/write_file",
            "filesystem",
            "write",
            "Write file",
            "Write a workspace file.",
            None,
        ),
        s(
            "/tools/filesystem/edit_file",
            "filesystem",
            "edit",
            "Edit file",
            "Replace text in a workspace file.",
            None,
        ),
        s(
            "/tools/filesystem/strict_edit",
            "filesystem",
            "strict_edit",
            "Strict edit",
            "Replace exact text in a file after verifying the file was read and has not changed.",
            Some("strict_edit"),
        ),
        s(
            "/tools/filesystem/multi_edit",
            "filesystem",
            "multiedit",
            "Multi-edit file",
            "Apply multiple exact replacements.",
            None,
        ),
        s(
            "/tools/filesystem/apply_patch",
            "filesystem",
            "apply_patch",
            "Apply patch",
            "Apply structured workspace patch operations.",
            Some("apply_patch"),
        ),
        s(
            "/tools/code/search_project",
            "code",
            "project",
            "Search project",
            "Search workspace files and content.",
            None,
        ),
        s(
            "/tools/code/search_code",
            "code",
            "search_text",
            "Search code",
            "Search code text with structured snippets.",
            Some("search_code"),
        ),
        s(
            "/tools/code/search_symbol",
            "code",
            "search_symbol",
            "Search symbols",
            "Search source symbols.",
            Some("search_symbol"),
        ),
        s(
            "/tools/code/graph_expand",
            "code",
            "graph_expand",
            "Expand code graph",
            "Expand imports and related code.",
            None,
        ),
        s(
            "/tools/code/lsp_query",
            "code",
            "query",
            "Query LSP",
            "Query language server diagnostics or symbols.",
            Some("diagnostics"),
        ),
        s(
            "/tools/shell/run_command",
            "shell",
            "run",
            "Run command",
            "Run a bounded shell command.",
            Some("run_command"),
        ),
        s(
            "/tools/git/status",
            "git",
            "status",
            "Git status",
            "Read Git repository status.",
            Some("git_status"),
        ),
        s(
            "/tools/git/diff",
            "git",
            "diff",
            "Git diff",
            "Read Git diff for a changed file.",
            Some("git_diff"),
        ),
        s(
            "/tools/git/stage",
            "git",
            "stage",
            "Git stage",
            "Stage a Git file.",
            None,
        ),
        s(
            "/tools/git/unstage",
            "git",
            "unstage",
            "Git unstage",
            "Unstage a Git file.",
            None,
        ),
        s(
            "/tools/git/discard",
            "git",
            "discard",
            "Git discard",
            "Discard a changed file.",
            None,
        ),
        s(
            "/tools/git/log",
            "git",
            "log",
            "Git log",
            "Read recent Git commits.",
            Some("git_log"),
        ),
        s(
            "/tools/git/show",
            "git",
            "show",
            "Git show",
            "Show a Git object or commit.",
            Some("git_show"),
        ),
        s(
            "/tools/git/branch",
            "git",
            "branch",
            "Git branch",
            "Read current Git branch state.",
            Some("git_branch"),
        ),
        s(
            "/tools/network/status",
            "network",
            "status",
            "Network status",
            "Read native network status.",
            None,
        ),
        s(
            "/tools/web/search",
            "web",
            "search",
            "Web search",
            "Search the web.",
            Some("web_search"),
        ),
        s(
            "/tools/web/fetch",
            "web",
            "fetch",
            "Fetch URL",
            "Fetch a web URL.",
            Some("web_fetch"),
        ),
        s(
            "/tools/render/surface",
            "render",
            "surface",
            "Render surface",
            "Create an inline render surface.",
            Some("render_surface"),
        ),
        s(
            "/tools/todo/read",
            "todo",
            "read",
            "Read todos",
            "Read active Lyra todos.",
            Some("todo_read"),
        ),
        s(
            "/tools/todo/write",
            "todo",
            "write",
            "Write todos",
            "Update active Lyra todos.",
            Some("todo_write"),
        ),
        s(
            "/tools/design/search_styles",
            "design",
            "search_styles",
            "Search design styles",
            "Search Lyra design references.",
            Some("design_search_styles"),
        ),
        s(
            "/tools/design/get_style_details",
            "design",
            "get_style_details",
            "Get design style details",
            "Read one design reference.",
            Some("design_get_style_details"),
        ),
        s(
            "/tools/skills/list",
            "skills",
            "list",
            "List skills",
            "List installed Lyra skills.",
            Some("skill_list"),
        ),
        s(
            "/tools/skills/inspect",
            "skills",
            "inspect",
            "Inspect skill",
            "Inspect one Lyra skill.",
            None,
        ),
        s(
            "/tools/skills/activate",
            "skills",
            "activate",
            "Activate skill",
            "Activate one Lyra skill.",
            None,
        ),
        s(
            "/tools/skills/deactivate",
            "skills",
            "deactivate",
            "Deactivate skill",
            "Deactivate one Lyra skill.",
            None,
        ),
        s(
            "/tools/mcp/server_list",
            "mcp",
            "server_list",
            "List MCP servers",
            "List configured MCP servers.",
            Some("mcp_server_list"),
        ),
        s(
            "/tools/mcp/server_connect",
            "mcp",
            "server_connect",
            "Connect MCP server",
            "Connect an MCP server.",
            None,
        ),
        s(
            "/tools/mcp/server_disconnect",
            "mcp",
            "server_disconnect",
            "Disconnect MCP server",
            "Disconnect an MCP server.",
            None,
        ),
        s(
            "/tools/mcp/server_reload",
            "mcp",
            "server_reload",
            "Reload MCP server",
            "Reload an MCP server.",
            None,
        ),
        s(
            "/tools/mcp/tool_discover",
            "mcp",
            "tool_discover",
            "Discover MCP tools",
            "Search MCP tool manifests.",
            Some("mcp_tool_discover"),
        ),
        s(
            "/tools/mcp/tool_inspect",
            "mcp",
            "tool_inspect",
            "Inspect MCP tool",
            "Inspect one MCP tool schema.",
            None,
        ),
        s(
            "/tools/mcp/tool_execute",
            "mcp",
            "tool_execute",
            "Execute MCP tool",
            "Execute one MCP tool.",
            None,
        ),
    ];
    entries.extend(terminal_manifests());
    entries
}

fn terminal_manifests() -> Vec<ToolManifest> {
    [
        ("list", "List terminal sessions", Some("terminal_list")),
        ("create", "Create terminal session", None),
        ("read", "Read terminal output", Some("terminal_read")),
        ("screen", "Read terminal screen", Some("terminal_screen")),
        ("wait", "Wait terminal", Some("terminal_wait")),
        ("write", "Write terminal input", None),
        ("close", "Close terminal session", None),
        ("events", "Read terminal events", None),
        ("read_until", "Read terminal until", None),
        ("run", "Run terminal command", Some("terminal_run")),
        ("input", "Submit terminal input", Some("terminal_input")),
        ("keys", "Press terminal keys", None),
        ("resize", "Resize terminal", None),
        ("signal", "Signal terminal process", None),
        ("processes", "Read terminal processes", None),
        ("command_status", "Read command status", None),
        ("map", "Map terminal screen", None),
        ("act", "Act in terminal UI", None),
        ("attach_agent", "Attach terminal agent", None),
        ("detach_agent", "Detach terminal agent", None),
    ]
    .into_iter()
    .map(|(operation, title, handle)| {
        s(
            &format!("/tools/terminal/{operation}"),
            "terminal",
            operation,
            title,
            title,
            handle,
        )
    })
    .collect()
}

fn s(
    path: &str,
    domain: &str,
    operation: &str,
    title: &str,
    summary: &str,
    handle: Option<&str>,
) -> ToolManifest {
    let description = description_for(path, domain, operation, title, summary);
    let aliases = aliases_for(domain, operation, title);
    let examples = examples_for(domain, operation, title);
    let tags = tags_for(domain, operation);
    ToolManifest {
        path: path.to_string(),
        handle: handle.map(str::to_string),
        domain: domain.to_string(),
        operation: operation.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        description,
        aliases,
        examples,
        tags,
        risk_level: risk_level(domain, operation).to_string(),
        permission_policy: permission_policy(domain, operation).to_string(),
        input_schema: input_schema_for(path, domain, operation),
        output_kind: output_kind(domain, operation).to_string(),
        activity_kind: activity_kind(domain, operation).to_string(),
        renderer_hint: renderer_hint(domain, operation).to_string(),
    }
}

fn description_for(
    path: &str,
    domain: &str,
    operation: &str,
    title: &str,
    summary: &str,
) -> String {
    let purpose = match (domain, operation) {
        ("filesystem", "read") if path.ends_with("/read_file") => {
            "Use when the agent needs to open, inspect, or quote a complete file from the workspace."
        }
        ("filesystem", "read") => {
            "Use when the agent needs a precise line range from a workspace file without loading the whole file."
        }
        ("filesystem", "list") => {
            "Use when the agent needs to browse a directory, see file names, or understand project structure."
        }
        ("filesystem", "glob") => {
            "Use when the agent knows a file name pattern, extension, or glob and needs matching paths."
        }
        ("filesystem", "write") => {
            "Use when the agent must create or replace a whole workspace file."
        }
        ("filesystem", "strict_edit") => {
            "Use when the agent must safely modify existing file text with an exact replacement after reading the current file."
        }
        ("filesystem", "edit" | "multiedit") => {
            "Use when the agent must update existing file text with exact replacements."
        }
        ("filesystem", "apply_patch") => {
            "Use when the agent must make structured multi-file code or text edits through a patch."
        }
        ("code", "search_text" | "project") => {
            "Use when the agent needs to find real code snippets, project text, function calls, labels, strings, or file content."
        }
        ("code", "search_symbol") => {
            "Use when the agent needs to find classes, functions, components, methods, symbols, or definitions."
        }
        ("code", "graph_expand") => {
            "Use when the agent needs related imports, dependency context, call graph clues, or nearby code relationships."
        }
        ("code", "query") => {
            "Use when the agent needs language-server diagnostics, symbol metadata, references, or editor intelligence."
        }
        ("shell", "run") => {
            "Use when the agent needs to run a bounded non-interactive shell command, test, build, lint, typecheck, or inspect the system."
        }
        ("terminal", "run" | "input" | "write" | "keys" | "act") => {
            "Use when the agent needs to operate an interactive terminal session or terminal UI."
        }
        ("terminal", _) => {
            "Use when the agent needs to inspect, manage, wait for, or read persistent terminal sessions."
        }
        ("git", "status") => {
            "Use when the agent needs the repository working tree state, changed files, staged files, or branch cleanliness."
        }
        ("git", "diff") => {
            "Use when the agent needs to review exact source changes before explaining, committing, or editing further."
        }
        ("git", "log" | "show" | "branch") => {
            "Use when the agent needs commit history, the current branch, or a specific Git object."
        }
        ("git", "stage" | "unstage" | "discard") => {
            "Use when the agent needs to mutate Git index or working tree state."
        }
        ("browser", "read" | "read_until") => {
            "Use when the agent needs readable text, page state, or content from a Lyra browser or Lumen page."
        }
        ("browser", "find" | "locate") => {
            "Use when the agent needs to search, reveal, or semantically locate text or a section within a Lyra browser page before mapping nearby controls."
        }
        ("browser", "map" | "focus_scan" | "explain_target") => {
            "Use when the agent needs to discover clickable, typable, focusable, or targetable browser elements."
        }
        ("browser", "see") => {
            "Use when the agent needs a visual screenshot or bitmap observation of the browser page."
        }
        ("browser", "scroll" | "scroll_to_target" | "ensure_visible") => {
            "Use when the agent needs to scroll a browser page, bring an offscreen button or input into view, keep the Agent cursor visible, or recover after a mapped target is outside the viewport."
        }
        ("browser", "act" | "type" | "press" | "submit" | "navigate" | "wait" | "reveal") => {
            "Use when the agent needs to interact with, navigate, type into, click, wait for, or reveal browser page controls."
        }
        ("workbench", _) => {
            "Use when the agent needs Lyra workspace tabs, active tab state, visible app surfaces, or workbench navigation."
        }
        ("web", "search") => {
            "Use when the agent needs current web search results from the network."
        }
        ("web", "fetch") => "Use when the agent needs to download or inspect a known URL.",
        ("memory", "search" | "list" | "explain_injection") => {
            "Use when the agent needs stored Lyra memory, user preferences, project facts, or memory injection diagnostics."
        }
        ("memory", _) => {
            "Use when the agent needs to create, update, connect, review, or remove durable Lyra memory records."
        }
        ("todo", "read") => "Use when the agent needs current task checklist or progress state.",
        ("todo", "write") => "Use when the agent needs to update the active task checklist.",
        ("design", _) => {
            "Use when the agent needs Lyra design references, visual style guidance, or UI implementation patterns."
        }
        ("software", _) => {
            "Use when the agent needs to inspect or invoke installed Lyra software adapter capabilities."
        }
        ("skills", _) => {
            "Use when the agent needs to discover, inspect, activate, or deactivate Lyra skills."
        }
        ("mcp", _) => {
            "Use when the agent needs to manage MCP servers or discover, inspect, and execute MCP tools."
        }
        ("runtime", "read") => {
            "Use when the agent needs to reopen a Lyra-owned artifact, large output, screenshot, or tool data reference."
        }
        _ => "Use when the agent needs this Tool-FS capability for the current Lyra task.",
    };
    format!(
        "{title}. {summary} {purpose} Tool path: {path}. Domain: {domain}. Operation: {operation}."
    )
}

fn aliases_for(domain: &str, operation: &str, title: &str) -> Vec<String> {
    let mut aliases = vec![
        title.to_string(),
        title.to_ascii_lowercase(),
        domain.replace('_', " "),
        operation.replace('_', " "),
    ];
    aliases.extend(
        match (domain, operation) {
            ("filesystem", "list") => vec!["browse files", "list directory", "查看文件", "列目录"],
            ("filesystem", "read") => vec!["open file", "read source", "查看文件", "读取文件"],
            ("filesystem", "glob") => vec!["find file", "file pattern", "glob search", "找文件"],
            ("filesystem", "write") => vec!["create file", "overwrite file", "写文件", "新建文件"],
            ("filesystem", "strict_edit") => {
                vec![
                    "strict edit",
                    "safe edit",
                    "exact replacement",
                    "replace text after reading",
                    "modify file",
                    "edit code",
                    "修改文件",
                    "精确替换",
                    "安全编辑",
                ]
            }
            ("filesystem", "edit" | "multiedit") => {
                vec![
                    "modify file",
                    "replace text",
                    "edit code",
                    "修改文件",
                    "编辑代码",
                ]
            }
            ("filesystem", "apply_patch") => {
                vec![
                    "patch files",
                    "apply diff",
                    "code edit",
                    "修改代码",
                    "打补丁",
                ]
            }
            ("code", "search_text" | "project") => {
                vec![
                    "search code",
                    "find snippet",
                    "grep",
                    "搜索代码",
                    "查代码片段",
                ]
            }
            ("code", "search_symbol") => {
                vec![
                    "find symbol",
                    "find definition",
                    "function search",
                    "搜索函数",
                    "查定义",
                ]
            }
            ("code", "graph_expand") => vec!["related code", "imports", "dependencies", "代码关系"],
            ("code", "query") => vec!["lsp", "diagnostics", "references", "语言服务", "诊断"],
            ("shell", "run") => vec![
                "run command",
                "execute command",
                "test command",
                "执行命令",
                "跑测试",
            ],
            ("terminal", _) => vec!["terminal", "interactive command", "终端", "交互命令"],
            ("git", "status") => vec!["git status", "changed files", "工作区状态", "查看改动"],
            ("git", "diff") => vec!["git diff", "review changes", "查看 diff", "代码变更"],
            ("git", "log" | "show" | "branch") => {
                vec!["git history", "commit", "branch", "提交历史"]
            }
            ("git", "stage" | "unstage" | "discard") => {
                vec!["git mutation", "stage file", "撤销改动"]
            }
            ("browser", "read" | "read_until") => {
                vec!["read page", "browser text", "读取网页", "页面内容"]
            }
            ("browser", "find" | "locate") => vec![
                "find page text",
                "search in page",
                "locate section",
                "jump to text",
                "semantic page search",
                "查找网页内容",
                "跳到页面位置",
                "定位页面段落",
            ],
            ("browser", "map" | "focus_scan" | "explain_target") => {
                vec![
                    "find button",
                    "page controls",
                    "DOM map",
                    "找按钮",
                    "页面元素",
                ]
            }
            ("browser", "see") => vec!["screenshot", "visual page", "截图", "看页面"],
            ("browser", "scroll" | "scroll_to_target" | "ensure_visible") => vec![
                "scroll page",
                "scroll down",
                "scroll up",
                "bring target into view",
                "ensure visible",
                "cursor offscreen",
                "button outside viewport",
                "滚动页面",
                "向下滚动",
                "滚到按钮附近",
                "让目标可见",
                "光标不可见",
            ],
            ("browser", _) => vec![
                "click page",
                "type in browser",
                "navigate page",
                "浏览器操作",
            ],
            ("workbench", _) => vec!["workspace tabs", "active tab", "工作区", "标签页"],
            ("web", "search") => vec!["internet search", "search web", "联网搜索", "网页搜索"],
            ("web", "fetch") => vec!["fetch url", "download page", "读取链接", "抓取网页"],
            ("memory", _) => vec![
                "memory",
                "remember user",
                "long term memory",
                "记忆",
                "偏好",
            ],
            ("todo", "read") => vec!["read todo", "task list", "待办", "任务列表"],
            ("todo", "write") => vec!["update todo", "checklist", "更新待办", "计划"],
            ("design", _) => vec!["design reference", "UI style", "设计参考", "界面风格"],
            ("software", _) => vec!["app capability", "software adapter", "应用能力"],
            ("skills", _) => vec!["skill", "plugin skill", "技能"],
            ("mcp", _) => vec!["mcp", "external tool", "外部工具"],
            ("runtime", "read") => vec!["read artifact", "open artifact", "查看产物", "大输出"],
            _ => vec!["tool", "capability", "工具"],
        }
        .into_iter()
        .map(str::to_string),
    );
    dedupe_strings(aliases)
}

fn examples_for(domain: &str, operation: &str, title: &str) -> Vec<String> {
    let specific = match (domain, operation) {
        ("filesystem", "read") => vec!["Read src/main.rs before editing.", "查看这个文件的内容。"],
        ("filesystem", "strict_edit") => {
            vec![
                "Read a file, then safely replace one exact string.",
                "先读取文件，然后精确替换一段代码。",
            ]
        }
        ("filesystem", "edit" | "multiedit") => {
            vec!["Replace an exact string in a file.", "把按钮标题改掉。"]
        }
        ("filesystem", "apply_patch") => vec![
            "Patch multiple files after locating the bug.",
            "批量修改代码。",
        ],
        ("code", "search_text" | "project") => vec![
            "Search for the text 新回话 in the project.",
            "Find every caller of createSession.",
        ],
        ("code", "search_symbol") => vec![
            "Find the React component or Rust function definition.",
            "查找函数定义。",
        ],
        ("shell", "run") => vec!["Run cargo test or npm typecheck.", "执行测试命令。"],
        ("git", "status") => vec![
            "Check whether the repo has uncommitted changes.",
            "查看 Git 状态。",
        ],
        ("git", "diff") => vec![
            "Inspect the exact changes before summarizing.",
            "查看某个文件 diff。",
        ],
        ("browser", "read" | "read_until") => {
            vec!["Read the visible browser page text.", "读取当前网页内容。"]
        }
        ("browser", "find" | "locate") => {
            vec![
                "Find a visible browser page phrase and reveal the match.",
                "Locate a long page section before mapping nearby controls.",
            ]
        }
        ("browser", "map" | "focus_scan" | "explain_target") => {
            vec!["Find the submit button on the page.", "定位页面按钮。"]
        }
        ("browser", "act" | "type" | "press" | "submit" | "navigate") => {
            vec![
                "Click a browser target or type into an input.",
                "在浏览器里输入并提交。",
            ]
        }
        ("browser", "scroll") => vec![
            "Scroll the browser down one viewport and map again.",
            "页面没有看到目标时先向下滚动。",
        ],
        ("browser", "scroll_to_target") => vec![
            "Bring targetRef lumen:... near the viewport center before clicking.",
            "把已映射的按钮滚动到屏幕中间附近。",
        ],
        ("browser", "ensure_visible") => vec![
            "Ensure an offscreen targetRef is visible before act or type.",
            "光标定位到按钮但按钮不在可见区域时先拉回可见区域。",
        ],
        ("workbench", _) => vec![
            "Inspect open Lyra tabs and active workspace state.",
            "查看当前工作区标签页。",
        ],
        ("web", "search") => vec!["Search the web for recent documentation.", "联网搜索资料。"],
        ("web", "fetch") => vec!["Fetch a known documentation URL.", "读取指定网页。"],
        ("memory", "search") => vec![
            "Find saved user preferences or project facts.",
            "搜索记忆里的偏好。",
        ],
        ("todo", "write") => vec!["Mark a plan step as completed.", "更新任务清单。"],
        ("terminal", _) => vec![
            "Read or operate an existing terminal pane.",
            "操作交互式终端。",
        ],
        ("runtime", "read") => vec![
            "Open a large stdout artifact or screenshot ref.",
            "查看工具产物。",
        ],
        _ => vec!["Use this capability when the task asks for it."],
    };
    let mut examples = vec![format!("Use {title} for a matching Lyra task.")];
    examples.extend(specific.into_iter().map(str::to_string));
    dedupe_strings(examples)
}

fn tags_for(domain: &str, operation: &str) -> Vec<String> {
    let mut tags = vec![domain.to_string(), operation.to_string()];
    tags.extend(
        match domain {
            "filesystem" => vec!["file", "workspace", "code"],
            "code" => vec!["search", "source", "symbol"],
            "shell" => vec!["command", "test", "build"],
            "terminal" => vec!["interactive", "process", "pane"],
            "git" => vec!["repo", "diff", "commit"],
            "browser" => vec!["page", "lumen", "dom"],
            "workbench" => vec!["workspace", "tabs", "state"],
            "web" => vec!["network", "url", "internet"],
            "memory" => vec!["memory", "preference", "profile"],
            "todo" => vec!["task", "plan", "checklist"],
            "design" => vec!["ui", "style", "reference"],
            "software" => vec!["adapter", "app", "capability"],
            "skills" => vec!["skill", "activation", "instructions"],
            "mcp" => vec!["server", "external", "tool"],
            "runtime" => vec!["artifact", "projection", "large-output"],
            _ => vec!["tool"],
        }
        .into_iter()
        .map(str::to_string),
    );
    dedupe_strings(tags)
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.to_ascii_lowercase()))
        .collect()
}

fn risk_level(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "file",
        ("shell", "run") => "shell",
        ("terminal", "run" | "write" | "input" | "keys" | "resize" | "signal" | "act") => {
            "terminal"
        }
        ("git", "stage" | "unstage" | "discard") => "git_mutation",
        ("browser", "act" | "type" | "press" | "submit" | "navigate" | "elevate") => "browser",
        (
            "memory",
            "remember" | "update" | "forget" | "link" | "apply_candidate" | "reject_candidate",
        ) => "memory_mutation",
        ("todo", "write") => "mutation",
        ("skills", "activate" | "deactivate") => "runtime_mutation",
        ("mcp", "server_connect" | "server_disconnect" | "server_reload" | "tool_execute") => {
            "external"
        }
        ("software", "invoke_capability") => "external",
        _ => "read",
    }
}

fn permission_policy(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch")
        | ("shell", "run")
        | ("git", "stage" | "unstage" | "discard")
        | ("browser", "elevate") => "ask_on_risk",
        ("software", "invoke_capability") | ("mcp", "tool_execute") => "host_policy",
        _ => "runtime_policy",
    }
}

fn output_kind(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "read") => "text",
        ("browser", "see") => "artifact",
        ("render", _) => "render",
        _ => "json",
    }
}

fn activity_kind(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "edit",
        ("filesystem", _) => "read",
        ("code", _) => "search",
        ("shell", _) => "shell",
        ("terminal", _) => "terminal",
        ("browser", _) | ("web", _) => "web",
        ("workbench", _) => "workbench",
        ("render", _) => "render",
        ("todo", _) => "task",
        ("git", _) => "git",
        _ => "task",
    }
}

fn renderer_hint(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("browser", _) => "lumen",
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "edit",
        ("filesystem", _) => "read",
        ("code", _) => "search",
        ("git", _) => "git",
        _ => activity_kind(domain, operation),
    }
}

fn input_schema_for(path: &str, domain: &str, operation: &str) -> Value {
    let string = |description: &str| json!({ "type": "string", "description": description });
    let working_dir = json!({
        "type": "string",
        "description": "Defaults to the current Lyra session workingDir when available."
    });
    let schema = match (domain, operation) {
        ("runtime", "read") => object_schema(
            [
                ("artifactId", string("Lyra artifact id.")),
                ("path", string("Artifact path.")),
            ],
            &[],
        ),
        ("filesystem", "list") => object_schema(
            [
                ("path", string("Workspace path.")),
                ("recursive", json!({ "type": "boolean", "default": false })),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 1000 }),
                ),
            ],
            &[],
        ),
        ("filesystem", "read") if path.ends_with("/read_range") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("startLine", json!({ "type": "integer", "minimum": 1 })),
                ("endLine", json!({ "type": "integer", "minimum": 1 })),
            ],
            &["path"],
        ),
        ("filesystem", "read") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("startLine", json!({ "type": "integer", "minimum": 1 })),
                ("endLine", json!({ "type": "integer", "minimum": 1 })),
                ("maxBytes", json!({ "type": "integer", "minimum": 1 })),
            ],
            &["path"],
        ),
        ("filesystem", "glob") => object_schema(
            [
                ("pattern", string("Glob pattern.")),
                ("path", string("Optional workspace directory.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 1000 }),
                ),
            ],
            &["pattern"],
        ),
        ("filesystem", "write") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("content", string("New file content.")),
                ("overwrite", json!({ "type": "boolean", "default": false })),
            ],
            &["path", "content"],
        ),
        ("filesystem", "edit") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("oldString", string("Exact text to replace.")),
                ("newString", string("Replacement text.")),
                ("replaceAll", json!({ "type": "boolean", "default": false })),
            ],
            &["path", "oldString", "newString"],
        ),
        ("filesystem", "strict_edit") => object_schema(
            [
                ("path", string("Workspace file path that was already read.")),
                ("oldString", string("Exact unique text to replace.")),
                ("newString", string("Replacement text.")),
                ("replaceAll", json!({ "type": "boolean", "default": false })),
                (
                    "expectedReadVersion",
                    string("Optional readVersion returned by read_file/read_range."),
                ),
            ],
            &["path", "oldString", "newString"],
        ),
        ("filesystem", "multiedit") => object_schema(
            [
                ("path", string("Workspace file path.")),
                (
                    "edits",
                    json!({ "type": "array", "items": { "type": "object" } }),
                ),
            ],
            &["path", "edits"],
        ),
        ("filesystem", "apply_patch") => object_schema(
            [
                (
                    "operations",
                    json!({ "type": "array", "items": { "type": "object" } }),
                ),
                ("patch", string("Unified or structured patch text.")),
            ],
            &[],
        ),
        ("code", _) => object_schema(
            [
                ("query", string("Search query.")),
                ("path", string("Optional workspace path.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 200 }),
                ),
            ],
            if operation == "graph_expand" {
                &[]
            } else {
                &["query"]
            },
        ),
        ("shell", "run") => object_schema(
            [
                ("command", string("Command to run.")),
                ("cwd", working_dir.clone()),
                ("workingDir", working_dir.clone()),
                (
                    "description",
                    string("Short active-voice summary of what this command does."),
                ),
                (
                    "runInBackground",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
                (
                    "maxOutputBytes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 1000000 }),
                ),
            ],
            &["command"],
        ),
        ("git", "status" | "branch") => object_schema([("workingDir", working_dir.clone())], &[]),
        ("git", "diff") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                ("path", string("Changed file path.")),
                (
                    "scope",
                    json!({ "type": "string", "enum": ["auto", "unstaged", "staged"], "default": "auto" }),
                ),
            ],
            &["path"],
        ),
        ("git", "stage" | "unstage" | "discard") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                ("path", string("Changed file path.")),
            ],
            &["path"],
        ),
        ("git", "log") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }),
                ),
            ],
            &[],
        ),
        ("git", "show") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                ("ref", json!({ "type": "string", "default": "HEAD" })),
            ],
            &[],
        ),
        ("browser", _) => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                ("targetRef", string("Lumen target reference.")),
                ("elementId", json!({ "type": ["integer", "string"] })),
                (
                    "direction",
                    json!({ "type": "string", "enum": ["up", "down", "left", "right", "current", "next", "previous", "scan"], "description": "Scroll direction for /tools/browser/scroll, find navigation for /tools/browser/find, or focus scan direction." }),
                ),
                (
                    "amount",
                    json!({ "type": "number", "minimum": 1, "maximum": 5000, "description": "Scroll pixels or wheel-like amount. Defaults to about one viewport." }),
                ),
                (
                    "pages",
                    json!({ "type": "number", "minimum": 0.1, "maximum": 10, "description": "Viewport pages to scroll; overrides amount when provided." }),
                ),
                (
                    "block",
                    json!({ "type": "string", "enum": ["start", "center", "end", "nearest"], "default": "center", "description": "Preferred target placement after scroll_to_target or ensure_visible." }),
                ),
                (
                    "behavior",
                    json!({ "type": "string", "enum": ["instant", "smooth"], "default": "instant" }),
                ),
                (
                    "containerRef",
                    string("Optional scroll container targetRef."),
                ),
                (
                    "point",
                    json!({ "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "reason": { "type": "string" } } }),
                ),
                (
                    "x",
                    json!({ "type": "number", "description": "Viewport x coordinate for point-based ensure_visible." }),
                ),
                (
                    "y",
                    json!({ "type": "number", "description": "Viewport y coordinate for point-based ensure_visible." }),
                ),
                ("autoMap", json!({ "type": "boolean", "default": true })),
                ("text", string("Text for type operations.")),
                (
                    "query",
                    string("Text query for /tools/browser/find or /tools/browser/locate."),
                ),
                (
                    "matchMode",
                    json!({ "type": "string", "enum": ["exact", "semantic"], "default": "semantic", "description": "Match mode for /tools/browser/locate." }),
                ),
                (
                    "activeIndex",
                    json!({ "type": "number", "minimum": 0, "description": "Current 1-based match index for browser find navigation." }),
                ),
                (
                    "caseSensitive",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "maxMatches",
                    json!({ "type": "number", "minimum": 1, "maximum": 100 }),
                ),
                ("reveal", json!({ "type": "boolean", "default": true })),
                ("autoMap", json!({ "type": "boolean", "default": true })),
                (
                    "nearbyLimit",
                    json!({ "type": "number", "minimum": 1, "maximum": 20 }),
                ),
                ("url", string("URL for navigate operations.")),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("terminal", "run") => object_schema(
            [
                ("command", string("Terminal command.")),
                ("sessionId", string("Terminal session id.")),
                ("cwd", string("Working directory.")),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &["command"],
        ),
        ("terminal", _) => object_schema(
            [
                ("sessionId", string("Terminal session id.")),
                ("input", string("Terminal input.")),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("web", "search") => object_schema(
            [
                ("query", string("Web search query.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 20 }),
                ),
            ],
            &["query"],
        ),
        ("web", "fetch") => object_schema([("url", string("URL to fetch."))], &["url"]),
        ("todo", "write") => object_schema(
            [(
                "todos",
                json!({ "type": "array", "items": { "type": "object" } }),
            )],
            &["todos"],
        ),
        ("memory", "remember") => object_schema([("fact", string("Fact to remember."))], &["fact"]),
        ("clarification", "ask") => object_schema(
            [
                ("question", string("Question to ask the user.")),
                ("options", json!({ "type": "array" })),
                (
                    "allowCustomAnswer",
                    json!({ "type": "boolean", "default": true }),
                ),
            ],
            &["question"],
        ),
        ("software", "inspect_capability" | "invoke_capability" | "read_state") => object_schema(
            [
                ("softwareId", string("Software adapter id.")),
                ("capabilityId", string("Capability id.")),
                (
                    "input",
                    json!({ "type": "object", "additionalProperties": true }),
                ),
            ],
            &[],
        ),
        _ => json!({ "type": "object", "properties": {} }),
    };
    attach_schema_id(path, schema)
}

pub fn domain_summary(domain: &str) -> &'static str {
    match domain {
        "runtime" => "Runtime and artifact utilities.",
        "memory" => "Lyra long-term memory search and mutation tools.",
        "clarification" => "Structured user clarification through the Lyra decision panel.",
        "workbench" => "Read and operate Lyra workspace tabs and workspace state.",
        "software" => "Inspect and invoke installed Lyra software adapters.",
        "browser" => "Operate Lyra browser/Lumen pages with DOM, target, visual, and wait tools.",
        "filesystem" => "List, read, write, edit, and patch files in the bound workspace.",
        "code" => "Search code text, symbols, code graph, and LSP data.",
        "shell" => "Run bounded shell commands in the bound workspace.",
        "terminal" => "Control Lyra terminal sessions and terminal panes.",
        "git" => "Inspect and mutate Git repository state for the bound project.",
        "network" => "Inspect native network status.",
        "web" => "Fetch and search web resources through native network tools.",
        "render" => "Create inline render surfaces in the chat timeline.",
        "todo" => "Read and update Lyra task todos.",
        "design" => "Use Lyra design reference tools.",
        "skills" => "List, inspect, activate, and deactivate Lyra skills.",
        "mcp" => "Discover and manage MCP servers and MCP tools.",
        _ => "Lyra tool directory.",
    }
}
