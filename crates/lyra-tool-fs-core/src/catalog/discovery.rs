use super::dedupe_strings;

pub(super) fn description_for(
    path: &str,
    domain: &str,
    operation: &str,
    title: &str,
    summary: &str,
) -> String {
    let purpose = match (domain, operation) {
        ("agent", "spawn") => {
            "Use for broader codebase exploration, independent parallel work, or protecting the main context from intermediate output. Do not use for a known file path, a specific class, or a search inside two or three files. Write a self-contained prompt. Never write \"based on your findings\"."
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
        ("browser", "read") => {
            "Use when the agent needs page text, an in-page text search (query), or a JSON schema hint for structured extraction. Do not use this to discover clickable controls; use /tools/browser/map."
        }
        ("browser", "map") => {
            "Use to see what the user can operate: a Now clickable list (current window) and a Needs scroll list (same controls, below the fold). Nested chrome is collapsed to the button itself. Act, type, or press those targetRefs; do not scroll to discover them."
        }
        ("browser", "see") => {
            "Use when the agent needs a visual screenshot or bitmap observation of the browser page. Returns a VisualFrame (captureId, dpr, device-pixel image size, scroll offset) whose coordinates feed /tools/browser/vact. Optionally draws targetRef highlights and downsamples for vision models."
        }
        ("browser", "detect_qr") => {
            "Use when the agent needs to decode QR codes on the page (login QR, payment QR) into payload and device-pixel bounds for vact."
        }
        ("browser", "scroll") => {
            "Use only to scroll the page when there is no targetRef (infinite feed, load-more). /tools/browser/map already lists below-fold controls under Needs scroll, and act/type scroll them into view."
        }
        ("browser", "act") => {
            "Use to click or hover a mapped targetRef. Off-screen targets are scrolled into view first."
        }
        ("browser", "type") => "Use to type text into a mapped input or contenteditable targetRef.",
        ("browser", "press") => {
            "Use to send a keyboard key (Enter, Escape, Tab, shortcuts) in the browser page."
        }
        ("browser", "navigate") => "Use to open a URL in the Lyra browser.",
        ("browser", "wait") => {
            "Use to wait for page idle, text change, or a specific string before mapping or reading again."
        }
        ("browser", "elevate") => {
            "Use to run a login or sensitive flow in an isolated browser session that does not pollute the live tab."
        }
        ("browser", "vact") => {
            "Use only when DOM mapping is unavailable or unreliable (canvas/WebGL apps, custom-rendered widgets, blocked frames, OAuth/Google identity iframes, browser-native account choosers, or when map/act returned no usable targetRef): visually click, drag, or scroll using device-pixel coordinates read directly from the latest see screenshot."
        }
        ("browser_ax", "map") => {
            "Use when DOM map/targetRef cannot see or reliably address a control (cross-origin OAuth/identity iframes, FedCM choosers, complex ARIA menus/comboboxes/dialogs): read the page accessibility tree. Optional role/name/provider filters return matching nodes from the same snapshot."
        }
        ("browser_ax", "act") => {
            "Use when an AX node from browser_ax.map is the right target: click/hover/focus/toggle/select by axRef, or press a key. Account/authorization nodes return needsUserAction instead of acting silently."
        }
        ("computer", operation) => super::computer::purpose(operation).unwrap_or(
            "Use this native desktop computer capability when the task asks for it.",
        ),
        ("workbench", "read_tab") => {
            "Use when the agent needs to read one Lyra workbench tab. Omit tabId to read the current focused/active tab; pass tabId from page citations or list_tabs to read a specific tab."
        }
        ("workbench", "capture_visual_evidence") => {
            "Use when the agent needs a screenshot of what is on screen in Lyra. Omit args to capture the active browser page pixels. Do not use computer.see for Lyra browser pages — that captures an OS window and can miss the webpage."
        }
        ("workbench", _) => {
            "Use when the agent needs Lyra workspace tabs, active tab state, visible app surfaces, or workbench navigation."
        }
        ("web", "search") => {
            "Use when the agent needs zero-config public web search. Local SearXNG aggregates engines first; if it fails or returns nothing, Lyra tries a short-timeout fallback. Do not issue several web_search calls for the same query. Returns result metadata only; use research when top sources should be read."
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
        ("memory", "search") => {
            "Use when the agent needs stored Lyra memory, user preferences, or project facts. Omit query or pass an empty query to list summaries instead of ranking."
        }
        ("memory", "write") => {
            "Use when the agent needs to remember, update, forget, or link durable Lyra memory. Set action to remember, update, forget, or link. These mutations share one permission."
        }
        ("memory", "explain_injection") => {
            "Use when the agent needs memory injection diagnostics."
        }
        ("memory", _) => {
            "Use when the agent needs to review, apply, reject, or inspect durable Lyra memory records."
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
            ("agent", "spawn") => vec![
                "spawn agent",
                "launch agent",
                "hire",
                "hire agent",
                "subagent",
                "explore worker",
                "delegate task",
                "雇工",
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
            ("browser", "read") => {
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
                    "find page text",
                    "search in page",
                    "search current page",
                    "find in browser",
                    "find text on page",
                    "locate page text",
                    "locate section",
                    "locate page section",
                    "extract page",
                    "structured extract",
                    "extract table",
                    "读取网页",
                    "读取当前页",
                    "读取当前网页",
                    "读取浏览器页面",
                    "查看网页内容",
                    "页面内容",
                    "当前页面内容",
                    "网页正文",
                    "浏览器页面文字",
                    "页内搜索",
                    "页面搜索",
                    "查找网页内容",
                    "搜索当前页",
                    "定位页面文字",
                    "页面结构化抽取",
                    "提取页面数据",
                ]
            }
            ("browser", "map") => {
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
            ("browser", "scroll") => vec![
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
                "submit form",
                "按键",
                "键盘操作",
                "按回车",
                "按 Tab",
                "按 Escape",
                "提交表单",
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
            ("browser", "detect_qr") => vec![
                "detect qr",
                "scan qr code",
                "login qr",
                "识别二维码",
                "扫描二维码",
            ],
            ("browser", "elevate") => vec![
                "elevate browser",
                "isolated browser",
                "isolated login",
                "隔离浏览器",
                "隔离登录",
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
            ("memory", "write") => vec![
                "memory",
                "remember user",
                "update memory",
                "forget memory",
                "link memory",
                "long term memory",
                "记忆",
                "偏好",
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
