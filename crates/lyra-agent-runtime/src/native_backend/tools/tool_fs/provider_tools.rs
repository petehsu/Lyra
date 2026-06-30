use super::*;

pub(crate) fn is_tool_fs_model_tool(name: &str) -> bool {
    PROVIDER_VISIBLE_TOOL_NAMES.contains(&name)
}

pub(crate) fn model_tool_names() -> Vec<String> {
    provider_tool_names()
}

pub(crate) fn model_provider_tools() -> Vec<Value> {
    vec![
        function_tool(
            TOOL_FS_SEARCH,
            "Search Lyra Tool Filesystem for capabilities such as CodeGraph navigation, browser, workbench, memory, software, hardware, web, todo, terminal, skills, or mcp. For project file reads, shell checks, git review, and file edits, keep using the direct code tools instead of Tool-FS.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural-language task or capability to find, such as codegraph explore/callers/impact/context, read browser page, inspect workbench state, use memory, run terminal interaction, or operate software." },
                    "scene": { "type": "string", "enum": ["general", "project-code", "git", "terminal", "browser", "workbench", "automation"] },
                    "domain": { "type": "string", "description": "Optional Tool-FS domain filter such as browser, web, workbench, memory, todo, terminal, software, hardware, skills, or mcp." },
                    "page": { "type": "integer", "minimum": 0, "default": 0 },
                    "pageSize": { "type": "integer", "minimum": 1, "maximum": 100, "default": 12 }
                },
                "required": ["query"]
            }),
        ),
        function_tool(
            TOOL_FS_LIST,
            "List Lyra Tool Filesystem directories and tool manifests. Use only as a fallback after tool_fs_search, or to browse a concrete /tools/<domain> directory.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "default": "/tools" },
                    "page": { "type": "integer", "minimum": 0, "default": 0 },
                    "pageSize": { "type": "integer", "minimum": 1, "maximum": 200, "default": 80 }
                }
            }),
        ),
        function_tool(
            TOOL_FS_READ_DOC,
            "Read concise documentation for a Lyra Tool Filesystem path such as /tools or /tools/filesystem.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "default": "/tools" }
                },
                "required": ["path"]
            }),
        ),
        function_tool(
            TOOL_FS_INSPECT,
            "Inspect one Lyra Tool Filesystem target and get its argument schema. Provide either path or toolHandle.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "toolHandle": { "type": "string" }
                }
            }),
        ),
        function_tool(
            TOOL_FS_RUN,
            "Run one Lyra Tool Filesystem target. Use it for CodeGraph navigation and non-code capabilities; do not use Tool-FS for project file reads, shell checks, git, or file edits.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "toolHandle": { "type": "string" },
                    "args": { "type": "object", "additionalProperties": true, "default": {} }
                },
                "required": ["args"]
            }),
        ),
    ]
}

pub(crate) fn root_summary_for_scene(
    scene: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    runtime_registry_with_dispatcher(dispatcher).root_summary_for_scene(ToolScene::parse(scene))
}

pub(crate) fn pinned_handles_for_scene(
    scene: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    serde_json::to_value(
        runtime_registry_with_dispatcher(dispatcher).pinned_handles(ToolScene::parse(scene)),
    )
    .unwrap_or_else(|_| json!([]))
}
