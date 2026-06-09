use serde_json::{Value, json};
use std::collections::HashSet;

use crate::error::ToolFsError;
use crate::model::ToolManifest;
use crate::registry::normalize_tool_path;
use crate::schema::{attach_schema_id, object_schema, schema_id_for_path};

mod browser;
mod clarification;
mod code;
mod design;
mod filesystem;
mod git;
mod hardware;
mod mcp;
mod memory;
mod network;
mod render;
mod runtime;
mod shell;
mod skills;
mod software;
mod terminal;
mod todo;
mod web;
mod workbench;

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
    let mut entries = Vec::new();
    entries.extend(runtime::manifests());
    entries.extend(memory::manifests());
    entries.extend(clarification::manifests());
    entries.extend(workbench::manifests());
    entries.extend(software::manifests());
    entries.extend(browser::manifests());
    entries.extend(filesystem::manifests());
    entries.extend(code::manifests());
    entries.extend(shell::manifests());
    entries.extend(git::manifests());
    entries.extend(hardware::manifests());
    entries.extend(network::manifests());
    entries.extend(web::manifests());
    entries.extend(render::manifests());
    entries.extend(todo::manifests());
    entries.extend(design::manifests());
    entries.extend(skills::manifests());
    entries.extend(mcp::manifests());
    entries.extend(terminal::manifests());
    entries
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
        ("hardware", "list" | "inspect") => {
            "Use when the agent needs to discover connected serial hardware, development boards, protocols, or missing toolchains."
        }
        ("hardware", "session_open" | "session_read" | "session_write" | "session_close") => {
            "Use when the agent needs an audited serial hardware session for board logs, REPLs, or AT-style commands."
        }
        ("hardware", "run_action") => {
            "Use when the agent needs to run a declared hardware capability action such as serial.write_line, micropython.repl, esp.flash, or toolchain.install."
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
        ("web", "research") => {
            "Use when the agent needs current web results plus reader-backed deep summaries from top sources."
        }
        ("web", "fetch") => {
            "Use when the agent needs to fetch a known URL as agent-friendly markdown, metadata, chunks, or document/image recommendations."
        }
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
                vec![
                    "read page",
                    "read current page",
                    "browser text",
                    "page content",
                    "extract page text",
                    "inspect page text",
                    "read browser page",
                    "current page text",
                    "what is on this page",
                    "读取网页",
                    "读取当前页",
                    "读取当前网页",
                    "读取浏览器页面",
                    "查看网页内容",
                    "页面内容",
                    "当前页面内容",
                    "网页正文",
                    "浏览器页面文字",
                ]
            }
            ("browser", "find" | "locate") => vec![
                "find page text",
                "search in page",
                "search current page",
                "browser find",
                "find in browser",
                "find text on page",
                "find phrase on page",
                "locate section",
                "jump to text",
                "jump to match",
                "reveal page text",
                "go to page text",
                "semantic page search",
                "semantic locate",
                "locate text and nearby controls",
                "find setting on page",
                "find form field",
                "find copy button near text",
                "查找网页内容",
                "页内搜索",
                "页面搜索",
                "浏览器搜索",
                "当前网页搜索",
                "当前页面查找",
                "查找页面文字",
                "查找页面内容",
                "搜索当前页",
                "搜索当前网页",
                "跳到页面位置",
                "跳转到匹配位置",
                "跳到文字位置",
                "跳到设置项",
                "定位页面段落",
                "定位页面文字",
                "定位文本",
                "定位网页内容",
                "语义定位",
                "语义搜索页面",
                "找到附近控件",
                "找到复制按钮",
                "找到输入框",
            ],
            ("browser", "map" | "focus_scan" | "explain_target") => {
                vec![
                    "map browser page",
                    "map page elements",
                    "discover page controls",
                    "discover clickable elements",
                    "list page controls",
                    "find button",
                    "find link",
                    "find input",
                    "find form",
                    "find clickable",
                    "button target",
                    "input target",
                    "copy button",
                    "submit button",
                    "page controls",
                    "DOM map",
                    "actionable elements",
                    "targetRef elements",
                    "找按钮",
                    "找链接",
                    "找输入框",
                    "找表单",
                    "找可点击元素",
                    "找复制按钮",
                    "找提交按钮",
                    "页面控件",
                    "页面元素",
                    "可操作元素",
                    "映射页面",
                    "页面地图",
                    "控件列表",
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
            ("browser", "navigate") => vec![
                "open webpage",
                "open website",
                "go to url",
                "navigate url",
                "navigate browser",
                "load page",
                "visit site",
                "enter website",
                "打开网页",
                "打开网站",
                "进入网站",
                "访问网址",
                "跳转网址",
                "导航到网页",
                "浏览器打开链接",
                "加载网页",
            ],
            ("browser", "act") => vec![
                "click page",
                "click button",
                "click link",
                "click target",
                "hover target",
                "press page control",
                "activate browser element",
                "点按钮",
                "点击按钮",
                "点击链接",
                "点击网页元素",
                "操作网页",
                "操作页面控件",
                "悬停网页元素",
            ],
            ("browser", "type") => vec![
                "type in browser",
                "type text",
                "fill input",
                "fill form",
                "enter text",
                "input value",
                "paste text",
                "在网页输入",
                "输入文本",
                "填写输入框",
                "填写表单",
                "输入框填值",
                "粘贴文本",
            ],
            ("browser", "press") => vec![
                "press key",
                "keyboard shortcut",
                "press enter",
                "press tab",
                "press escape",
                "按键",
                "键盘操作",
                "按回车",
                "按 Tab",
                "按 Escape",
            ],
            ("browser", "submit") => vec![
                "submit form",
                "submit browser control",
                "send form",
                "confirm form",
                "提交表单",
                "提交页面",
                "确认输入",
                "发送表单",
            ],
            ("browser", "wait") => vec![
                "wait page",
                "wait browser",
                "wait loading",
                "wait for page",
                "wait for text",
                "等待页面",
                "等待浏览器",
                "等待加载",
                "等待文本出现",
            ],
            ("browser", "reveal") => vec![
                "reveal target",
                "show browser target",
                "highlight target",
                "显示目标",
                "揭示目标",
                "高亮目标",
                "显示网页控件",
            ],
            ("browser", _) => vec![
                "click page",
                "type in browser",
                "navigate page",
                "浏览器操作",
            ],
            ("workbench", _) => vec!["workspace tabs", "active tab", "工作区", "标签页"],
            ("web", "search") => vec!["internet search", "search web", "联网搜索", "网页搜索"],
            ("web", "research") => {
                vec!["research web", "deep read search", "联网调研", "搜索并阅读"]
            }
            ("web", "fetch") => vec!["fetch url", "download page", "读取链接", "抓取网页"],
            ("hardware", _) => vec![
                "development board",
                "serial device",
                "firmware flash",
                "开发板",
                "串口",
            ],
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
        ("hardware", "list" | "inspect") => vec![
            "Find connected serial development boards.",
            "查看已连接开发板和串口能力。",
        ],
        ("hardware", "session_open" | "session_read" | "session_write" | "session_close") => {
            vec![
                "Open a serial console and interact with a board REPL.",
                "打开串口会话并读取开发板日志。",
            ]
        }
        ("hardware", "run_action") => vec![
            "Run a hardware capability action such as serial.write_line or esp.flash.",
            "执行开发板动作，例如写串口或准备刷写固件。",
        ],
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
        ("web", "research") => vec![
            "Research a topic by searching and deep-reading top results.",
            "联网搜索并阅读多个来源。",
        ],
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
            "hardware" => vec!["device", "serial", "board"],
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
        ("hardware", "session_write" | "run_action") => "hardware",
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
        | ("hardware", "session_write" | "run_action")
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
        ("hardware", _) => "hardware",
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
        "description": "Defaults to the current Lyra session workingDir when available; shell falls back to the user home directory when the session is unbound."
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
        ("hardware", "list") => object_schema(
            [(
                "filter",
                json!({
                    "type": "object",
                    "properties": {
                        "transport": { "type": "string", "enum": ["serial", "usb", "hid", "bluetooth", "network", "storage", "debug_probe"] },
                        "includeSystem": { "type": "boolean", "default": false }
                    }
                }),
            )],
            &[],
        ),
        ("hardware", "inspect") => object_schema(
            [("deviceId", string("Hardware device id or path."))],
            &["deviceId"],
        ),
        ("hardware", "session_open") => object_schema(
            [
                ("deviceId", string("Hardware device id.")),
                ("path", string("Serial device path.")),
                (
                    "baudRate",
                    json!({ "type": "integer", "minimum": 300, "maximum": 4000000, "default": 115200 }),
                ),
                (
                    "mode",
                    string("Optional capability mode such as serial.uart or micropython.repl."),
                ),
            ],
            &["deviceId", "path"],
        ),
        ("hardware", "session_read") => object_schema(
            [
                ("sessionId", string("Hardware session id.")),
                (
                    "maxBytes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 64000, "default": 8192 }),
                ),
            ],
            &["sessionId"],
        ),
        ("hardware", "session_write") => object_schema(
            [
                ("sessionId", string("Hardware session id.")),
                ("text", string("Raw text bytes to write.")),
                ("line", string("Line to write with CRLF.")),
            ],
            &["sessionId"],
        ),
        ("hardware", "session_close") => object_schema(
            [("sessionId", string("Hardware session id."))],
            &["sessionId"],
        ),
        ("hardware", "run_action") => object_schema(
            [
                ("deviceId", string("Optional hardware device id.")),
                ("sessionId", string("Optional hardware session id.")),
                (
                    "capabilityId",
                    string(
                        "Capability id such as serial.uart, micropython.repl, esp.flash, or toolchain.install.",
                    ),
                ),
                (
                    "action",
                    string("Capability action such as write_line, flash, or install."),
                ),
                (
                    "args",
                    json!({ "type": "object", "additionalProperties": true }),
                ),
            ],
            &["capabilityId", "action"],
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
                    "provider",
                    json!({ "type": "string", "enum": ["duckduckgo", "searxng", "brave", "serpapi", "tavily", "exa"] }),
                ),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 20 }),
                ),
            ],
            &["query"],
        ),
        ("web", "research") => object_schema(
            [
                ("query", string("Web research query.")),
                (
                    "provider",
                    json!({ "type": "string", "enum": ["duckduckgo", "searxng", "brave", "serpapi", "tavily", "exa"] }),
                ),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 20, "default": 5 }),
                ),
                (
                    "readTopN",
                    json!({ "type": "integer", "minimum": 1, "maximum": 5, "default": 3 }),
                ),
                (
                    "maxCharsPerResult",
                    json!({ "type": "integer", "minimum": 1, "maximum": 20000, "default": 4000 }),
                ),
                (
                    "includeFailedReads",
                    json!({ "type": "boolean", "default": true }),
                ),
                ("indexResult", json!({ "type": "boolean", "default": true })),
            ],
            &["query"],
        ),
        ("web", "fetch") => object_schema(
            [
                ("url", string("URL to fetch.")),
                (
                    "maxChars",
                    json!({ "type": "integer", "minimum": 1, "maximum": 100000, "default": 12000 }),
                ),
                ("extractText", json!({ "type": "boolean", "default": true })),
                (
                    "includeLinks",
                    json!({ "type": "boolean", "default": true }),
                ),
                (
                    "engine",
                    json!({ "type": "string", "enum": ["auto", "http", "browser"], "default": "auto" }),
                ),
                (
                    "mode",
                    json!({ "type": "string", "enum": ["main", "full", "text", "raw"] }),
                ),
                (
                    "format",
                    json!({ "type": "string", "enum": ["markdown", "text", "json", "chunks", "frontmatter+markdown"] }),
                ),
                (
                    "preset",
                    json!({ "type": "string", "enum": ["agent", "research", "index", "reader", "raw"], "default": "agent" }),
                ),
                (
                    "targetSelector",
                    string("CSS selector to render as the root."),
                ),
                (
                    "removeSelector",
                    json!({
                        "oneOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    }),
                ),
                (
                    "includeTags",
                    json!({
                        "oneOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    }),
                ),
                (
                    "excludeTags",
                    json!({
                        "oneOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    }),
                ),
                ("maxTokens", json!({ "type": "integer", "minimum": 1 })),
                (
                    "chunking",
                    json!({
                        "oneOf": [
                            { "type": "boolean" },
                            { "type": "string", "enum": ["disabled", "heading", "block"] },
                            {
                                "type": "object",
                                "properties": {
                                    "mode": { "type": "string", "enum": ["disabled", "heading", "block"] },
                                    "maxCharsPerChunk": { "type": "integer", "minimum": 1 },
                                    "overlapChars": { "type": "integer", "minimum": 0 }
                                }
                            }
                        ]
                    }),
                ),
                (
                    "queryFocus",
                    string("Query used to build focused fit markdown."),
                ),
                (
                    "userTask",
                    string("User task text used as a secondary query-focus signal."),
                ),
                (
                    "retainLinks",
                    json!({ "type": "string", "enum": ["all", "text", "citations", "summary", "none"] }),
                ),
                (
                    "retainImages",
                    json!({ "type": "string", "enum": ["all", "alt", "summary", "none"] }),
                ),
                (
                    "retainMedia",
                    json!({ "type": "string", "enum": ["link", "text", "summary", "html", "none"] }),
                ),
                (
                    "headingStyle",
                    json!({ "type": "string", "enum": ["atx", "setext"], "default": "atx" }),
                ),
                (
                    "citationFormat",
                    json!({ "type": "string", "enum": ["square", "angle", "source"], "default": "square" }),
                ),
                (
                    "preserveHtmlTags",
                    json!({
                        "oneOf": [
                            { "type": "string" },
                            {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "enum": ["mark", "sub", "sup", "kbd", "abbr", "small", "u", "ins"]
                                }
                            }
                        ]
                    }),
                ),
                ("citations", json!({ "type": "boolean", "default": true })),
                (
                    "includeMetadata",
                    json!({ "type": "boolean", "default": true }),
                ),
                ("includeRaw", json!({ "type": "boolean", "default": false })),
                (
                    "cachePolicy",
                    json!({ "type": "string", "enum": ["auto", "noStore", "readWrite", "cacheOnly"], "default": "auto" }),
                ),
                (
                    "trustedLocal",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "allowPrivateNetwork",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "maxDomBytes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 64000000, "default": 16000000 }),
                ),
                (
                    "maxExtractedChars",
                    json!({ "type": "integer", "minimum": 1, "maximum": 5000000, "default": 1000000 }),
                ),
                ("indexResult", json!({ "type": "boolean", "default": true })),
                ("useOcr", json!({ "type": "boolean", "default": true })),
                ("useCaption", json!({ "type": "boolean", "default": true })),
                (
                    "waitForSelector",
                    string("CSS selector to wait for before browser snapshot."),
                ),
                (
                    "waitUntil",
                    json!({ "type": "string", "enum": ["html", "loadIdle", "textStable", "textChanged", "textContains"], "default": "loadIdle" }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000, "default": 20000 }),
                ),
                (
                    "browserMode",
                    json!({ "type": "string", "enum": ["matchingOrNewTab", "activeTab", "newTab"], "default": "matchingOrNewTab" }),
                ),
                (
                    "includeScreenshot",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "viewport",
                    json!({
                        "type": "object",
                        "properties": {
                            "width": { "type": "integer", "minimum": 240, "maximum": 5000 },
                            "height": { "type": "integer", "minimum": 240, "maximum": 10000 },
                            "deviceScaleFactor": { "type": "number", "minimum": 0.5, "maximum": 4 }
                        },
                        "required": ["width", "height"]
                    }),
                ),
                ("mobile", json!({ "type": "boolean", "default": false })),
                (
                    "includeIframes",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includeShadowDom",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includePageshot",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includeMedia",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includeDebugTrace",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "X-Respond-With",
                    string("Jina Reader compatible response format alias."),
                ),
                (
                    "X-Target-Selector",
                    string("Jina Reader compatible target selector alias."),
                ),
                (
                    "X-Remove-Selector",
                    string("Jina Reader compatible remove selector alias."),
                ),
                (
                    "X-Wait-For-Selector",
                    string("Jina Reader compatible wait selector alias."),
                ),
                ("X-With-Generated-Alt", json!({ "type": "boolean" })),
                ("X-With-Links-Summary", json!({ "type": "boolean" })),
                ("X-No-Cache", json!({ "type": "boolean" })),
                (
                    "X-Cache-Tolerance",
                    string("Jina Reader compatible cache tolerance alias."),
                ),
            ],
            &["url"],
        ),
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
