use serde_json::{Value, json};
use std::collections::HashSet;

use crate::error::ToolFsError;
use crate::model::ToolManifest;
use crate::registry::normalize_tool_path;
use crate::schema::{attach_schema_id, object_schema, schema_id_for_path};

mod browser;
mod browser_ax;
mod clarification;
mod code;
mod computer;
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
    entries.extend(browser_ax::manifests());
    entries.extend(computer::manifests());
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
            "Use when the agent knows a file name pattern, extension, or glob and only needs matching paths. This is the fastest choice for path discovery."
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
        ("code", "grep_text") => {
            "Use first for exact strings, regex, identifiers, labels, call sites, or content inside a known workspace/root. This is the fastest precise content search; prefer it over the Lyra index for grep-like tasks."
        }
        ("code", "search_text" | "project") => {
            "Use when the agent needs Lyra native indexed search: fuzzy file/content recall, broad Home or multi-root lookup, approximate names, or quick candidate discovery before reading files. Prefer grep_text for exact strings or regex."
        }
        ("code", "search_symbol") => {
            "Use when the agent needs classes, functions, components, methods, exported constants, symbols, or definitions. Prefer this over grep_text when the query is a symbol/definition rather than arbitrary text."
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
        ("browser", "interact") => {
            "Use when the agent needs a short declarative operate-then-extract flow (navigate, wait, click, scroll, type, then read/map) in one call instead of many separate browser tools."
        }
        ("browser", "read" | "read_until") => {
            "Use when the agent needs readable text, page state, or content from a Lyra browser or Lumen page."
        }
        ("browser", "find" | "locate") => {
            "Use when the agent needs to search, reveal, or semantically locate text or a section within a Lyra browser page before mapping nearby controls."
        }
        ("browser", "map" | "focus_scan" | "explain_target") => {
            "Use when the agent needs to discover clickable, typable, focusable, or targetable browser elements, including authChallengeSignals for OAuth/identity iframes that cannot be selected as normal DOM controls. Repeated maps may return mapCompaction and scrollHints when the page is unchanged or content is below the fold."
        }
        ("browser", "see") => {
            "Use when the agent needs a visual screenshot or bitmap observation of the browser page. Returns a VisualFrame (captureId, dpr, device-pixel image size, scroll offset) whose coordinates feed /tools/browser/vact. Optionally draws targetRef highlights and downsamples for vision models."
        }
        ("browser", "judge_task") => {
            "Use when the agent needs to verify browser task completion, detect captcha/auth blocks, or decide whether to escalate after a multi-step browser trajectory."
        }
        ("browser", "scroll" | "scroll_to_target" | "ensure_visible") => {
            "Use when the agent needs to scroll a browser page, bring an offscreen button or input into view, keep the Agent cursor visible, or recover after a mapped target is outside the viewport."
        }
        ("browser", "act" | "type" | "press" | "submit" | "navigate" | "wait" | "reveal") => {
            "Use when the agent needs to interact with, navigate, type into, click, wait for, or reveal browser page controls."
        }
        ("browser", "vact") => {
            "Use only when DOM mapping is unavailable or unreliable (canvas/WebGL apps, custom-rendered widgets, blocked frames, OAuth/Google identity iframes, browser-native account choosers, or when map/act returned no usable targetRef): visually click, drag, or scroll using device-pixel coordinates read directly from the latest see screenshot."
        }
        ("browser_ax", "map" | "query" | "explain") => {
            "Use when DOM map/targetRef cannot see or reliably address a control (cross-origin OAuth/identity iframes, FedCM choosers, complex ARIA menus/comboboxes/dialogs): read the page accessibility tree, query AX nodes by role/name/provider, or explain why DOM is blind and whether visual/user action is needed."
        }
        ("browser_ax", "act" | "focus" | "press") => {
            "Use when an AX node from browser_ax.map is the right target: click/hover/focus/toggle/select by axRef, move keyboard focus through the accessibility tree, or press a key. Account/authorization nodes return needsUserAction instead of acting silently."
        }
        ("computer", "list_apps" | "observe") => {
            "Use before driving an external app to see what is running and which app/window/control has focus. computer.list_apps enumerates apps and windows; computer.observe returns the current foreground app, focused window, and focused control without mapping the full tree."
        }
        ("computer", "focus") => {
            "Use to switch the member's desktop to a specific native app or window (session-level foreground focus). Distinct from computer.act(action: focus), which only moves accessibility focus to one control. Requires shared mode; background/isolated sessions refuse foreground steal."
        }
        ("computer", "map" | "find" | "explain") => {
            "Use to control native desktop apps outside the Lyra browser through the OS accessibility tree (osRef): read the focused window's semantic tree, find a control by role/name, or explain whether semantic control is available and reachable. Prefer this over screenshots+coordinates."
        }
        ("computer", "act" | "diff") => {
            "Use when an osRef from computer.map/find is the right desktop target: press/focus/setText/toggle/select it semantically (no coordinates, no foreground steal), or verify changes — re-read one node's state, or diff a whole computer.map snapshot (added/removed/changed) against a fresh read. computer.act already returns a before/after diff."
        }
        ("computer", "see") => {
            "Use only as a visual fallback when semantic control fails: computer.map returned nothing usable, the control has no accessibility node, or you must read image/canvas content. Screenshots the screen or focused window for the vision model; it does not act or steal focus. Prefer semantic map/find/act whenever the node exists."
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
        ("web", "map") => {
            "Use before bulk crawling: discover same-origin URLs from a seed page and optional sitemap, then selectively fetch."
        }
        ("web", "batch") => {
            "Use for multiple known URLs. Small batches run inline; larger batches return a jobId and emit session progress events."
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
            ("filesystem", "glob") => {
                vec![
                    "find file",
                    "file pattern",
                    "glob search",
                    "fd",
                    "path search",
                    "找文件",
                ]
            }
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
            ("code", "grep_text") => {
                vec![
                    "grep",
                    "rg",
                    "ripgrep",
                    "regex",
                    "exact text",
                    "content search",
                    "精确搜索",
                    "正则",
                    "查文本",
                ]
            }
            ("code", "search_text" | "project") => {
                vec![
                    "indexed search",
                    "fuzzy code search",
                    "local index",
                    "broad search",
                    "search code candidates",
                    "搜索代码",
                    "索引搜索",
                    "模糊搜索",
                ]
            }
            ("code", "search_symbol") => {
                vec![
                    "find symbol",
                    "find definition",
                    "search_symbol",
                    "symbol search",
                    "function search",
                    "component search",
                    "搜索函数",
                    "查定义",
                    "查符号",
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
            ("browser", "interact") => vec![
                "browser interact",
                "operate then read",
                "click then read",
                "navigate wait click read",
                "页面操作后读取",
                "先操作再提取",
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
            ("browser", "see") => vec![
                "screenshot",
                "visual page",
                "highlight targets",
                "target highlights",
                "截图",
                "看页面",
                "高亮控件",
            ],
            ("browser", "judge_task") => vec![
                "judge browser task",
                "verify browser completion",
                "check browser task",
                "browser task verdict",
                "trajectory judge",
                "任务完成判断",
                "浏览器任务验收",
                "验收浏览器任务",
            ],
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
            ("browser", "vact") => vec![
                "visual click",
                "click by coordinates",
                "click screenshot point",
                "click canvas",
                "drag on screenshot",
                "visual scroll",
                "视觉点击",
                "按坐标点击",
                "点击截图位置",
                "点击画布",
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
            ("browser_ax", _) => vec![
                "accessibility tree",
                "ax map",
                "ax tool",
                "screen reader view",
                "oauth iframe button",
                "cross-origin button",
                "可访问性树",
                "无障碍树",
                "屏幕阅读器",
                "跨域按钮",
                "授权弹窗按钮",
            ],
            ("computer", _) => vec![
                "computer use",
                "control desktop app",
                "native app automation",
                "click button in app",
                "os accessibility",
                "desktop tree",
                "电脑操作",
                "操控桌面应用",
                "控制软件",
                "系统无障碍",
            ],
            ("workbench", _) => vec!["workspace tabs", "active tab", "工作区", "标签页"],
            ("web", "search") => vec!["internet search", "search web", "联网搜索", "网页搜索"],
            ("web", "research") => {
                vec!["research web", "deep read search", "联网调研", "搜索并阅读"]
            }
            ("web", "map") => vec!["map site", "discover urls", "sitemap", "发现链接", "站点地图"],
            ("web", "batch") => {
                vec!["batch fetch", "crawl urls", "bulk fetch", "批量抓取", "批量读取"]
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
        ("browser", "interact") => vec![
            "Navigate to settings, wait for load, click Privacy, then read the section.",
            "打开页面、等待加载、点击按钮并读取结果。",
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
        ("browser", "vact") => vec![
            "Click a canvas control by its screenshot coordinates after see.",
            "用截图坐标点击画布/自定义渲染的控件。",
        ],
        ("browser_ax", "map" | "query" | "explain") => vec![
            "Read the accessibility tree to find a Google OAuth iframe button DOM cannot see.",
            "读取可访问性树定位 DOM 看不到的跨域授权按钮。",
        ],
        ("browser_ax", "act" | "focus" | "press") => vec![
            "Click an AX node by axRef when the DOM selector is unreliable.",
            "用 axRef 操作 DOM selector 不稳定但 AX 可见的控件。",
        ],
        ("computer", "list_apps" | "observe") => vec![
            "List running desktop apps to find Finder before computer.map.",
            "列出正在运行的桌面应用,在 computer.map 之前找到 Finder。",
        ],
        ("computer", "focus") => vec![
            "Bring System Settings to the foreground before mapping its accessibility tree.",
            "在映射无障碍树之前把「系统设置」切到前台。",
        ],
        ("computer", "map" | "find" | "explain") => vec![
            "Read the focused app's accessibility tree to locate its New Folder button.",
            "读取前台应用的无障碍树,定位它的「新建文件夹」按钮。",
        ],
        ("computer", "act" | "diff") => vec![
            "Toggle a checkbox in System Settings by osRef, then read back its state.",
            "用 osRef 勾选系统设置里的开关,再回读它的状态确认生效。",
        ],
        ("computer", "see") => vec![
            "Screenshot the focused window to read a canvas-drawn chart that has no accessibility node.",
            "截图前台窗口,读取没有无障碍节点的 canvas 图表内容。",
        ],
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
        ("browser", "judge_task") => vec![
            "Judge whether the login flow completed after act/type steps.",
            "判断浏览器任务是否完成。",
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
        ("web", "map") => vec![
            "Map URLs from a documentation site before selective fetch.",
            "先发现站点链接再决定抓哪些页面。",
        ],
        ("web", "batch") => vec![
            "Fetch several known URLs as one batch job.",
            "批量抓取多个已知 URL。",
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
            "browser_ax" => vec!["page", "accessibility", "ax"],
            "computer" => vec!["desktop", "accessibility", "computer-use"],
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
        ("browser", "act" | "vact" | "type" | "press" | "submit" | "navigate" | "elevate") => {
            "browser"
        }
        ("browser_ax", "act" | "press" | "focus") => "browser",
        ("computer", "act" | "focus") => "computer",
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
        | ("browser", "elevate")
        | ("browser_ax", "act" | "press")
        | ("computer", "act" | "focus") => "ask_on_risk",
        ("software", "invoke_capability") | ("mcp", "tool_execute") => "host_policy",
        _ => "runtime_policy",
    }
}

fn output_kind(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "read") => "text",
        ("browser", "see") | ("computer", "see") => "artifact",
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
        ("browser", _) | ("browser_ax", _) | ("web", _) => "web",
        ("computer", _) => "computer",
        ("workbench", _) => "workbench",
        ("render", _) => "render",
        ("todo", _) => "task",
        ("git", _) => "git",
        _ => "task",
    }
}

fn renderer_hint(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("browser", _) | ("browser_ax", _) => "lumen",
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "edit",
        ("filesystem", _) => "read",
        ("code", _) => "search",
        ("git", _) => "git",
        _ => activity_kind(domain, operation),
    }
}

fn input_schema_for(path: &str, domain: &str, operation: &str) -> Value {
    let string = |description: &str| json!({ "type": "string", "description": description });
    let string_array = |description: &str| {
        json!({
            "type": "array",
            "items": { "type": "string" },
            "description": description
        })
    };
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
        ("code", "grep_text") => object_schema(
            [
                (
                    "query",
                    string("Exact text or regex pattern to search for."),
                ),
                ("pattern", string("Alias for query.")),
                ("path", string("Optional workspace path/root.")),
                ("root", string("Optional workspace search root.")),
                ("roots", string_array("Optional workspace search roots.")),
                ("glob", string("Optional include glob such as **/*.rs.")),
                (
                    "includeGlobs",
                    string_array("Optional include glob patterns."),
                ),
                (
                    "excludeGlobs",
                    string_array("Optional exclude glob patterns."),
                ),
                ("regex", json!({ "type": "boolean", "default": false })),
                (
                    "caseSensitive",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includeHidden",
                    json!({ "type": "boolean", "default": false }),
                ),
                ("maxFileBytes", json!({ "type": "integer", "minimum": 1 })),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 500 }),
                ),
            ],
            &["query"],
        ),
        ("code", _) => object_schema(
            [
                ("query", string("Search query.")),
                ("path", string("Optional workspace path.")),
                ("root", string("Optional workspace search root.")),
                ("roots", string_array("Optional workspace search roots.")),
                ("glob", string("Optional include glob such as **/*.rs.")),
                (
                    "includeGlobs",
                    string_array("Optional include glob patterns."),
                ),
                (
                    "excludeGlobs",
                    string_array("Optional exclude glob patterns."),
                ),
                (
                    "includeHidden",
                    json!({ "type": "boolean", "default": false }),
                ),
                ("enableContent", json!({ "type": "boolean" })),
                (
                    "mode",
                    json!({ "type": "string", "enum": ["fast", "normal", "full"] }),
                ),
                (
                    "caseSensitive",
                    json!({ "type": "boolean", "default": false }),
                ),
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
        ("browser", "see") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "highlightTargets",
                    json!({ "type": "boolean", "default": true, "description": "Draw targetRef bounding boxes on the screenshot for vision models." }),
                ),
                (
                    "highlightTargetRefs",
                    string_array("Optional targetRefs to highlight; defaults to mapped targets when highlightTargets is true."),
                ),
                (
                    "downsampleForVision",
                    json!({ "type": "boolean", "default": true, "description": "Downsample screenshots to <=2000px longest edge before returning vision artifacts." }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("browser", "interact") => object_schema(
            [
                (
                    "actions",
                    json!({
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "kind": { "type": "string", "enum": ["navigate", "wait", "read_until", "click", "hover", "scroll", "scroll_to_target", "ensure_visible", "type", "press", "submit", "reveal"] },
                                "url": { "type": "string" },
                                "targetRef": { "type": "string" },
                                "text": { "type": "string" },
                                "key": { "type": "string" },
                                "timeoutMs": { "type": "integer", "minimum": 250, "maximum": 120000 }
                            },
                            "required": ["kind"]
                        },
                        "description": "Ordered browser actions to run before extract."
                    }),
                ),
                (
                    "extract",
                    json!({ "type": "string", "enum": ["read", "map", "both"], "default": "read" }),
                ),
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                ("workflowId", string("Optional workflow id for record/replay.")),
                (
                    "cacheMode",
                    json!({ "type": "string", "enum": ["record", "replay"], "description": "Workflow cache mode when workflowId is set." }),
                ),
                (
                    "baselineSnapshotId",
                    string("Optional prior pageSnapshot id to diff after extract."),
                ),
            ],
            &["actions"],
        ),
        ("browser", "judge_task") => object_schema(
            [
                (
                    "goal",
                    string("Optional task goal text to check against the final page observation."),
                ),
                (
                    "trajectory",
                    json!({
                        "type": "object",
                        "description": "Browser tool trajectory from this turn or isolated session.",
                        "properties": {
                            "steps": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "toolPath": { "type": "string" },
                                        "ok": { "type": "boolean" },
                                        "pathTaken": { "type": "string" },
                                        "elementDiffChanged": { "type": "array", "items": { "type": "string" } },
                                        "cacheHit": { "type": "boolean" },
                                        "cacheMiss": { "type": "boolean" }
                                    },
                                    "required": ["toolPath", "ok"]
                                }
                            }
                        },
                        "required": ["steps"]
                    }),
                ),
                (
                    "finalObservation",
                    json!({
                        "type": "object",
                        "description": "Latest browser map/read observation used to judge task completion.",
                        "properties": {
                            "url": { "type": "string" },
                            "title": { "type": "string" },
                            "elements": { "type": "array", "items": { "type": "object" } },
                            "authChallengeSignals": { "type": "array", "items": { "type": "object" } },
                            "blockedRegions": { "type": "array", "items": { "type": "object" } },
                            "nextRecommendedAction": { "type": "string" }
                        }
                    }),
                ),
            ],
            &["trajectory"],
        ),
        ("browser", "vact") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "captureId",
                    string(
                        "captureId from the latest /tools/browser/see VisualFrame these coordinates were read from. Stale ids (after scroll, navigation, or any panel/window resize) are rejected.",
                    ),
                ),
                (
                    "point",
                    json!({
                        "type": "object",
                        "description": "Device-pixel coordinate read directly off the latest see screenshot (origin = top-left of the screenshot).",
                        "properties": {
                            "x": { "type": "number", "description": "Device-pixel X on the see image." },
                            "y": { "type": "number", "description": "Device-pixel Y on the see image." },
                            "reason": { "type": "string", "description": "Why this point is the intended target." }
                        },
                        "required": ["x", "y"]
                    }),
                ),
                (
                    "interaction",
                    json!({ "type": "string", "enum": ["click", "doubleClick", "rightClick", "hover", "drag", "scroll"], "default": "click" }),
                ),
                (
                    "to",
                    json!({
                        "type": "object",
                        "description": "Drag target device-pixel coordinate (for interaction=drag).",
                        "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
                        "required": ["x", "y"]
                    }),
                ),
                (
                    "scrollDy",
                    json!({ "type": "number", "description": "Vertical scroll delta in CSS pixels (for interaction=scroll). Positive scrolls down." }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &["point", "captureId"],
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
        ("browser_ax", "map") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document", "auth"], "default": "interactive", "description": "interactive: clickable/typable/focusable nodes; document: reading structure; auth: prioritize OAuth/FedCM/dialog/account chooser." }),
                ),
                (
                    "maxNodes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 400, "default": 200, "description": "Cap on returned AX nodes to prevent tree explosion." }),
                ),
                (
                    "includeIgnored",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includeText",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "includeFrames",
                    json!({ "type": "boolean", "default": true }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("browser_ax", "query") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "snapshotId",
                    string(
                        "snapshotId from a prior browser_ax.map; defaults to the latest snapshot for the tab.",
                    ),
                ),
                (
                    "role",
                    string("AX role to match, e.g. button, textbox, link."),
                ),
                (
                    "nameIncludes",
                    string("Substring the accessible name must contain."),
                ),
                (
                    "provider",
                    string(
                        "OAuth provider filter: google, apple, microsoft, okta, auth0, stripe, paypal.",
                    ),
                ),
                (
                    "visibleOnly",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "maxResults",
                    json!({ "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }),
                ),
            ],
            &[],
        ),
        ("browser_ax", "act") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "axRef",
                    string(
                        "AX node reference from browser_ax.map (ax:<snapshotHash>:<nodeHash>). Not a targetRef or captureId.",
                    ),
                ),
                (
                    "interaction",
                    json!({ "type": "string", "enum": ["click", "hover", "focus", "toggle", "select"], "default": "click" }),
                ),
                (
                    "verification",
                    json!({ "type": "string", "enum": ["fast", "full"], "default": "fast" }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &["axRef"],
        ),
        ("browser_ax", "focus") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "direction",
                    json!({ "type": "string", "enum": ["next", "previous"], "default": "next" }),
                ),
                (
                    "role",
                    string("Stop when the focused node matches this AX role."),
                ),
                (
                    "nameIncludes",
                    string("Stop when the focused node name contains this substring."),
                ),
                (
                    "maxSteps",
                    json!({ "type": "integer", "minimum": 1, "maximum": 40, "default": 20 }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("browser_ax", "press") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                (
                    "key",
                    string("Key to press, e.g. Enter, Tab, Space, ArrowDown."),
                ),
                (
                    "axRef",
                    string("Optional AX node to focus before pressing the key."),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &["key"],
        ),
        ("browser_ax", "explain") => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                ("axRef", string("AX node reference to explain.")),
                ("snapshotId", string("Optional snapshotId for context.")),
            ],
            &[],
        ),
        ("computer", "list_apps") => object_schema(
            [
                (
                    "maxApps",
                    json!({ "type": "integer", "minimum": 1, "maximum": 100, "default": 50, "description": "Cap on returned desktop apps." }),
                ),
                (
                    "includeBackground",
                    json!({ "type": "boolean", "default": false, "description": "Include apps without a visible/focused window." }),
                ),
            ],
            &[],
        ),
        ("computer", "observe") => object_schema([], &[]),
        ("computer", "focus") => object_schema(
            [
                ("appRef", string("Opaque app reference from computer.list_apps (e.g. osxapp:<pid>, winapp:<pid>, atspiapp:<index>, lytab:<tabId>).")),
                ("pid", json!({ "type": "integer", "description": "Process id on macOS/Windows when appRef is unknown." })),
                ("bundleId", string("Application bundle id (platform-dependent; may be unsupported).")),
                ("windowTitle", string("Exact window title to raise when appRef is unknown.")),
                ("windowRef", string("Opaque window reference from computer.list_apps.")),
                ("lyraTabId", string("Lyra workbench tab id to activate (Level-1 internal surface).")),
                (
                    "mode",
                    json!({ "type": "string", "enum": ["shared", "background-semantic", "isolated-session"], "default": "shared", "description": "shared only: computer.focus refuses foreground steal in background/isolated modes." }),
                ),
            ],
            &[],
        ),
        ("computer", "map") => object_schema(
            [
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document"], "default": "interactive", "description": "interactive: actionable controls only; document: include text/headings for reading structure." }),
                ),
                (
                    "maxNodes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 400, "default": 200, "description": "Cap on returned desktop nodes to prevent tree explosion." }),
                ),
            ],
            &[],
        ),
        ("computer", "find") => object_schema(
            [
                ("role", string("Desktop role to match, e.g. button, textbox, checkbox, menuitem.")),
                ("nameIncludes", string("Substring the accessible name must contain (case-insensitive).")),
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document"], "default": "interactive" }),
                ),
                (
                    "maxResults",
                    json!({ "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }),
                ),
            ],
            &[],
        ),
        ("computer", "act") => object_schema(
            [
                (
                    "osRef",
                    string("Desktop node reference from computer.map/find (osax:<path>). Not an axRef or targetRef."),
                ),
                (
                    "action",
                    json!({ "type": "string", "enum": ["press", "focus", "setText", "toggle", "select", "scroll"], "default": "press" }),
                ),
                ("text", string("Plaintext payload for the setText action; ignored otherwise. Never use this for passwords — pass sensitiveValueRef instead.")),
                (
                    "sensitiveValueRef",
                    json!({ "type": "object", "description": "A lyra-sensitive-value-ref (from the login manager / sensitive-values store) to autofill into a setText target. The plaintext is resolved host-side and never enters the model; this is the only sanctioned way to fill a secure (password) field." }),
                ),
                (
                    "mode",
                    json!({ "type": "string", "enum": ["shared", "background-semantic", "isolated-session"], "default": "shared", "description": "shared: user-visible, focus/raise allowed. background-semantic/isolated-session: true background, semantic actions only — focus/raise is refused." }),
                ),
            ],
            &["osRef"],
        ),
        ("computer", "diff") => object_schema(
            [
                (
                    "baselineSnapshotId",
                    string("snapshotId from a prior computer.map/find. When set, returns the observation diff (added/removed/changed) against a fresh read."),
                ),
                (
                    "osRef",
                    string("Desktop node reference to re-read for single-node verification. Used when baselineSnapshotId is absent."),
                ),
                (
                    "strategy",
                    json!({ "type": "string", "enum": ["interactive", "document"], "default": "interactive", "description": "Strategy for the fresh read in a snapshot diff." }),
                ),
                (
                    "maxNodes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 400, "default": 200 }),
                ),
            ],
            &[],
        ),
        ("computer", "explain") => object_schema(
            [("osRef", string("Optional desktop node reference to check for reachability."))],
            &[],
        ),
        ("computer", "see") => object_schema(
            [
                (
                    "scope",
                    json!({ "type": "string", "enum": ["screen", "focused-window"], "default": "focused-window", "description": "screen: full primary display. focused-window: only the frontmost app window." }),
                ),
                (
                    "downsampleForVision",
                    json!({ "type": "boolean", "default": true, "description": "Downsample to <=2000px longest edge before returning the vision artifact." }),
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
        ("web", "map") => object_schema(
            [
                ("url", string("Seed URL to map.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 500, "default": 50 }),
                ),
                (
                    "includeSitemap",
                    json!({ "type": "boolean", "default": true }),
                ),
                (
                    "sameOriginOnly",
                    json!({ "type": "boolean", "default": true }),
                ),
                (
                    "allowPrivateNetwork",
                    json!({ "type": "boolean", "default": false }),
                ),
            ],
            &["url"],
        ),
        ("web", "batch") => object_schema(
            [
                (
                    "urls",
                    json!({
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Absolute URLs to fetch."
                    }),
                ),
                (
                    "mode",
                    json!({ "type": "string", "enum": ["sync", "async", "status", "cancel"], "default": "sync" }),
                ),
                ("jobId", string("Existing batch job id when mode=status.")),
                (
                    "maxCharsPerUrl",
                    json!({ "type": "integer", "minimum": 1, "maximum": 20000, "default": 4000 }),
                ),
                (
                    "engine",
                    json!({ "type": "string", "enum": ["auto", "http", "browser"], "default": "auto" }),
                ),
                (
                    "allowPrivateNetwork",
                    json!({ "type": "boolean", "default": false }),
                ),
                ("queryFocus", string("Optional query focus passed to each fetch.")),
                (
                    "preset",
                    json!({ "type": "string", "enum": ["agent", "research", "index", "reader", "raw"], "default": "agent" }),
                ),
            ],
            &["urls"],
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

pub fn scenario_playbooks_doc() -> &'static str {
    r#"Lyra Tool-FS scenario decision tree (pick one primary path):

Web / external content
- Need one known URL as agent markdown → /tools/web/fetch (engine auto: http then browser)
- Need search results only → /tools/web/search
- Need search + deep read top hits → /tools/web/research
- Need many URLs on a site first → /tools/web/map, then selective /tools/web/fetch or /tools/web/batch
- Need many known URLs at once → /tools/web/batch (sync small batches; async + jobId for large)

Lyra browser / Lumen (interactive pages)
- Short operate-then-read flow → /tools/browser/interact (navigate → wait → click/scroll/type → read/map)
- Repeatable multi-step UI flow → browser.interact or workflowId cacheMode record/replay on act/type
- Discover controls on current page → /tools/browser/map (or locate/find for long pages)
- Multi-field form → /tools/browser/plan once, then batch act/type by targetRef
- DOM blind (OAuth iframe, ARIA) → /tools/browser_ax/map then browser_ax/act
- Visual last resort → /tools/browser/see then /tools/browser/vact
- Verify completion → /tools/browser/judge_task

Project / code / shell
- Repo survey or code change → code search/grep → read_file → strict_edit/apply_patch → shell run → git diff

Do not flatten these into interchangeable tools: map before blind fetch/crawl; interact before many separate navigate/wait/act/read calls when the flow is short."#
}

pub fn domain_summary(domain: &str) -> &'static str {
    match domain {
        "runtime" => "Runtime and artifact utilities.",
        "memory" => "Lyra long-term memory search and mutation tools.",
        "clarification" => "Structured user clarification through the Lyra decision panel.",
        "workbench" => "Read and operate Lyra workspace tabs and workspace state.",
        "software" => "Inspect and invoke installed Lyra software adapters.",
        "browser" => "Operate Lyra browser/Lumen pages. Prefer /tools/browser/interact for short operate-then-extract flows; use map/locate/plan for discovery and batch act/type for forms.",
        "browser_ax" => {
            "Operate browser pages through the accessibility tree (axRef) for cross-origin OAuth/ARIA controls DOM cannot reach."
        }
        "computer" => {
            "Control native desktop apps through the OS accessibility tree (osRef): map, find, act, and verify semantically without screenshots or coordinates."
        }
        "filesystem" => "List, read, write, edit, and patch files in the bound workspace.",
        "code" => "Search code text, symbols, code graph, and LSP data.",
        "shell" => "Run bounded shell commands in the bound workspace.",
        "terminal" => "Control Lyra terminal sessions and terminal panes.",
        "git" => "Inspect and mutate Git repository state for the bound project.",
        "network" => "Inspect native network status.",
        "web" => "Fetch and search web resources. Use map→selective fetch/batch for multi-page sites; fetch/research for single pages or search-backed reads.",
        "render" => "Create inline render surfaces in the chat timeline.",
        "todo" => "Read and update Lyra task todos.",
        "design" => "Use Lyra design reference tools.",
        "skills" => "List, inspect, activate, and deactivate Lyra skills.",
        "mcp" => "Discover and manage MCP servers and MCP tools.",
        _ => "Lyra tool directory.",
    }
}
