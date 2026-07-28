use super::dedupe_strings;

pub(super) fn description_for(
    path: &str,
    domain: &str,
    operation: &str,
    title: &str,
    summary: &str,
) -> String {
    let purpose = match (domain, operation) {
        ("agent", "send") => {
            "Use in Oma mode to queue concise follow-up work in an active Agent's private channel. The host runs it after the current turn; this does not fabricate a reply."
        }
        ("agent", "ask") => {
            "Use in Oma mode when an Agent needs a real synchronous reply from a specific active Agent package. The target runs through the same host provider and tool chain in its private channel."
        }
        ("agent", "handoff") => {
            "Use in Oma mode when the current response should queue follow-up work for another active Agent without moving the user's channel."
        }
        ("design", "extract_reference") => {
            "Use when the agent needs live website visual style evidence for UI or website work: computed colors, typography, spacing, radius, shadows, section bounds, area ratios, components, and assets. This is the non-visual fallback for web design references; browser/see text fallback is not enough for visual style decisions."
        }
        ("design", "quality") => {
            "Use for native UI/UX quality review: inspect universal rules, audit frontend source, or audit rendered DOM and computed styles. Findings are contextual leads, not automatic violations."
        }
        ("design", "read") => {
            "Use when the agent needs real-world design tokens (colors, typography, spacing, patterns) for UI work. Call action=list, then action=read to load a DESIGN.md as advisory design evidence; the latest read becomes the current reference."
        }
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
        ("filesystem", "grep") => {
            "Use when the agent needs to search file contents by regex or exact text across the workspace."
        }
        ("filesystem", "write") => {
            "Use when the agent needs to create a small file or overwrite short text content."
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
        ("code", "explore") => {
            "Use when the agent needs indexed code navigation for a symbol or concept: matching symbols, call edges, and blast-radius hints from the bound project."
        }
        ("code", "callers") => {
            "Use when the agent needs direct callers of a symbol from the CodeGraph index."
        }
        ("code", "callees") => {
            "Use when the agent needs direct callees of a symbol from the CodeGraph index."
        }
        ("code", "impact") => {
            "Use before changing a symbol to inspect upstream callers and blast radius from the CodeGraph index."
        }
        ("code", "context") => {
            "Use when the agent needs a CodeGraph project overview: index status, entry points, key modules, frameworks, architecture, and language bridges."
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
        ("browser", "extract") => {
            "Use when the agent needs structured data from a browser page (list/detail/table → JSON). Returns page text + the requested JSON schema as a hint (schemaHint); the model emits JSON conforming to the schema in its next reply. Cheaper than read+manual parse for tabular or list data."
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
            "Use when an osRef from computer.map/find is the right desktop target: press/focus/setText/typeText/toggle/select/scroll/pressKey/secondaryAction it semantically (no coordinates except drag), or verify changes — re-read one node's state, or diff a whole computer.map snapshot (added/removed/changed) against a fresh read. computer.act already returns a before/after diff. typeText types via keyboard events (unlike setText which replaces the whole value). pressKey sends key combinations (e.g. cmd+c). secondaryAction invokes non-primary AX actions (e.g. AXShowMenu for right-click). drag moves the pointer from (fromX,fromY) to (toX,toY) — shared mode only."
        }
        ("computer", "see") => {
            "Use only as a visual fallback when semantic control fails: computer.map returned nothing usable, the control has no accessibility node, or you must read image/canvas content. Screenshots the screen or focused window for the vision model; it does not act or steal focus. Prefer semantic map/find/act whenever the node exists."
        }
        ("workbench", "read_tab") => {
            "Use when the agent needs to read one Lyra workbench tab. Omit tabId to read the current focused/active tab; pass tabId from page citations or list_tabs to read a specific tab."
        }
        ("workbench", _) => {
            "Use when the agent needs Lyra workspace tabs, active tab state, visible app surfaces, or workbench navigation."
        }
        ("web", "search") => {
            "Use when the agent needs zero-config public web search results from the network: general web, GitHub/docs/community, public YouTube/Bilibili/V2EX topics, or another public platform without a configured dedicated tool. Returns result metadata only; use research when top sources should be read."
        }
        ("web", "research") => {
            "Use when the agent needs current public web results plus reader-backed deep summaries from top sources: web/docs/GitHub/community discussions, public platform pages, reviews, comparisons, and 'what people think' questions. Use browser tools when rendering, login, or interaction blocks HTTP reads."
        }
        ("web", "map") => {
            "Use before bulk crawling: discover same-origin URLs from a seed page and optional sitemap, then selectively fetch."
        }
        ("web", "batch") => {
            "Use for multiple known URLs. Small batches run inline; larger batches return a jobId and emit session progress events."
        }
        ("web", "fetch") => {
            "Use when the agent needs to fetch a known public URL, RSS/Atom feed, GitHub/V2EX page, or public video/article page as agent-friendly markdown, metadata, chunks, or document/image recommendations. Use browser tools when rendering, login, or interaction is required."
        }
        ("memory", "search" | "list" | "explain_injection") => {
            "Use when the agent needs stored Lyra memory, user preferences, project facts, or memory injection diagnostics."
        }
        ("memory", _) => {
            "Use when the agent needs to create, update, connect, review, or remove durable Lyra memory records."
        }
        ("todo", "read") => "Use when the agent needs current task checklist or progress state.",
        ("todo", "write") => "Use when the agent needs to update the active task checklist.",
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

pub(super) fn aliases_for(domain: &str, operation: &str, title: &str) -> Vec<String> {
    let mut aliases = vec![
        title.to_string(),
        title.to_ascii_lowercase(),
        domain.replace('_', " "),
        operation.replace('_', " "),
    ];
    aliases.extend(
        match (domain, operation) {
            ("agent", "send") => vec![
                "oma send",
                "agent message",
                "multi agent chat",
                "Agent 发消息",
            ],
            ("agent", "ask") => vec!["oma ask", "ask agent", "agent consult", "Agent 私聊"],
            ("agent", "handoff") => vec![
                "oma handoff",
                "switch agent",
                "delegate agent",
                "切换 Agent",
            ],
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
            ("filesystem", "grep") => {
                vec![
                    "content search",
                    "regex search",
                    "find in files",
                    "text search",
                    "rg",
                    "ripgrep",
                    "搜索内容",
                    "正则搜索",
                    "查文本",
                ]
            }
            ("filesystem", "write") => vec![
                "small file write",
                "create small file",
                "overwrite small file",
                "short text file",
                "写小文件",
                "新建小文件",
            ],
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
            ("code", "explore") => vec![
                "codegraph",
                "code graph explore",
                "symbol graph",
                "call graph overview",
                "blast radius",
                "代码图谱",
                "符号图谱",
                "调用关系",
            ],
            ("code", "callers") => vec![
                "find callers",
                "who calls",
                "incoming calls",
                "upstream callers",
                "调用方",
                "谁调用了",
            ],
            ("code", "callees") => vec![
                "find callees",
                "what calls",
                "outgoing calls",
                "downstream calls",
                "被调用方",
                "调用了谁",
            ],
            ("code", "impact") => vec![
                "impact analysis",
                "blast radius",
                "change impact",
                "affected callers",
                "影响分析",
                "变更影响",
            ],
            ("code", "context") => vec![
                "project context",
                "codegraph context",
                "entry points",
                "architecture summary",
                "frameworks",
                "项目上下文",
                "架构摘要",
            ],
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
            ("design", "extract_reference") => vec![
                "design reference extraction",
                "extract design tokens",
                "computed style",
                "visual style",
                "website clone",
                "clone website",
                "colors typography spacing",
                "bounds area ratio",
                "non visual design fallback",
                "提取设计参考",
                "提取网站风格",
                "设计 token",
                "颜色 字体 间距",
                "占用面积",
                "仿站",
                "克隆网站",
            ],
            ("design", "read") => vec![
                "design reference",
                "design system",
                "DESIGN.md",
                "品牌设计",
                "设计规范",
            ],
            ("design", "quality") => vec![
                "design quality",
                "design audit",
                "ui ux review",
                "anti template",
                "ai slop",
                "frontend quality",
                "accessibility review",
                "设计审查",
                "界面审查",
                "去除 ai 味",
                "模板化",
                "设计质量",
                "前端质量",
                "可访问性审查",
            ],
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
            ("browser", "extract") => vec![
                "extract page",
                "scrape page",
                "structured extract",
                "extract table",
                "extract list",
                "页面结构化抽取",
                "提取页面数据",
                "结构化提取",
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
            ("web", "search") => vec![
                "internet search",
                "search web",
                "public platform search",
                "github search",
                "youtube search",
                "bilibili search",
                "v2ex search",
                "agent reach",
                "联网搜索",
                "网页搜索",
                "全网搜索",
                "GitHub搜索",
                "YouTube搜索",
                "B站搜索",
                "V2EX搜索",
            ],
            ("web", "research") => {
                vec![
                    "research web",
                    "deep read search",
                    "public platform research",
                    "community discussion research",
                    "what people think",
                    "agent reach research",
                    "联网调研",
                    "全网调研",
                    "搜索并阅读",
                    "网上讨论",
                    "大家怎么评价",
                    "搜索并总结",
                ]
            }
            ("web", "map") => vec![
                "map site",
                "discover urls",
                "sitemap",
                "发现链接",
                "站点地图",
            ],
            ("web", "batch") => {
                vec![
                    "batch fetch",
                    "crawl urls",
                    "bulk fetch",
                    "批量抓取",
                    "批量读取",
                ]
            }
            ("web", "fetch") => vec![
                "fetch url",
                "download page",
                "read url",
                "read rss",
                "rss feed",
                "atom feed",
                "jina reader",
                "github repo",
                "github issue",
                "youtube page",
                "bilibili page",
                "v2ex hot",
                "v2ex topic",
                "读取链接",
                "读链接",
                "看链接",
                "抓取网页",
                "读取RSS",
                "RSS订阅",
                "GitHub仓库",
                "YouTube视频",
                "B站视频",
                "V2EX热门",
            ],
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
            ("software", _) => vec!["app capability", "software adapter", "应用能力"],
            ("skills", "activate") => vec!["enable skill", "turn on skill", "启用技能", "开启技能"],
            ("skills", "deactivate") => {
                vec!["disable skill", "turn off skill", "停用技能", "关闭技能"]
            }
            ("skills", "install_local" | "install_git" | "install_store") => {
                vec!["install skill", "add skill", "安装技能", "添加技能"]
            }
            ("skills", "uninstall") => vec!["remove skill", "delete skill", "卸载技能", "删除技能"],
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
