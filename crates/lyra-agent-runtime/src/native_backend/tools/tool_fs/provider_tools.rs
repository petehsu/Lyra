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
            "Search Lyra Tool Filesystem with a natural-language task description. Prefer this before listing /tools; use results to inspect and run concrete tool paths or handles.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural-language task or capability to find, such as edit a file, search code, show git diff, read browser page, or run tests." },
                    "scene": { "type": "string", "enum": ["general", "project-code", "git", "terminal", "browser", "workbench", "design", "automation"] },
                    "domain": { "type": "string", "description": "Optional Tool-FS domain filter such as filesystem, code, shell, git, browser, web, memory, todo, software, skills, or mcp." },
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
            "Run one Lyra Tool Filesystem target. Provide path or pinned toolHandle plus args matching the inspected inputSchema.",
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
