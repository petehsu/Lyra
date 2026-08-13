export const SITE_LOCALES = ["zh", "en"] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

export type SiteCopy = {
  readonly metadata: {
    readonly title: string;
    readonly description: string;
  };
  readonly nav: {
    readonly product: string;
    readonly details: string;
    readonly oma: string;
    readonly local: string;
    readonly pricing: string;
    readonly docs: string;
    readonly download: string;
    readonly language: string;
    readonly lightTheme: string;
    readonly darkTheme: string;
  };
  readonly hero: {
    readonly title: string;
    readonly titleLines: readonly string[];
    readonly body: string;
    readonly primary: string;
    readonly secondary: string;
    readonly note: string;
    readonly imageAlt: string;
    readonly keywords: readonly [
      {
        readonly title: string;
        readonly body: string;
      },
      {
        readonly title: string;
        readonly body: string;
      },
      {
        readonly title: string;
        readonly body: string;
      }
    ];
  };
  readonly demo: {
    readonly windowLabel: string;
    readonly windowTitle: string;
    readonly actions: {
      readonly notifications: string;
      readonly history: string;
      readonly terminal: string;
      readonly settings: string;
      readonly store: string;
      readonly files: string;
      readonly discuss: string;
      readonly newSession: string;
      readonly more: string;
      readonly attach: string;
      readonly send: string;
      readonly back: string;
      readonly forward: string;
      readonly layers: string;
      readonly newTab: string;
    };
    readonly tabs: {
      readonly hello: string;
      readonly newSession: string;
      readonly files: string;
      readonly site: string;
      readonly home: string;
      readonly settings: string;
      readonly docs: string;
    };
    readonly chat: {
      readonly questionPrefix: string;
      readonly questionSuffix: string;
      readonly home: string;
      readonly placeholder: string;
      readonly model: string;
      readonly permission: string;
      readonly backend: string;
      readonly plan: string;
      readonly location: string;
      readonly reply: string;
    };
    readonly settings: {
      readonly title: string;
      readonly general: string;
      readonly appearance: string;
      readonly workspace: string;
      readonly notifications: string;
      readonly login: string;
      readonly lyra: string;
      readonly search: string;
      readonly agents: string;
      readonly models: string;
      readonly skills: string;
      readonly mcp: string;
      readonly experimental: string;
      readonly docs: string;
      readonly theme: string;
      readonly dark: string;
      readonly light: string;
      readonly material: string;
      readonly materialDescription: string;
      readonly language: string;
      readonly languageValue: string;
      readonly updates: string;
      readonly updatesDescription: string;
      readonly updatesValue: string;
      readonly terminalPosition: string;
      readonly bottom: string;
      readonly restore: string;
      readonly restoreDescription: string;
    };
    readonly workspace: {
      readonly search: string;
      readonly openProject: string;
      readonly newAgent: string;
      readonly recent: string;
      readonly omnibox: string;
      readonly siteUrl: string;
      readonly docsKicker: string;
      readonly docsTitle: string;
      readonly docsBody: string;
      readonly docsItems: readonly [string, string, string];
    };
    readonly terminal: {
      readonly tab: string;
      readonly prompt: string;
      readonly command: string;
      readonly output: string;
    };
  };
  readonly product: {
    readonly title: string;
    readonly body: string;
    readonly imageAlt: string;
    readonly items: readonly [
      {
        readonly title: string;
        readonly body: string;
        readonly alt: string;
      },
      {
        readonly title: string;
        readonly body: string;
        readonly alt: string;
      },
      {
        readonly title: string;
        readonly body: string;
        readonly alt: string;
      }
    ];
  };
  readonly oma: {
    readonly label: string;
    readonly title: string;
    readonly body: string;
    readonly agents: readonly [
      { readonly name: string; readonly role: string },
      { readonly name: string; readonly role: string },
      { readonly name: string; readonly role: string },
      { readonly name: string; readonly role: string },
      { readonly name: string; readonly role: string }
    ];
    readonly items: readonly [
      { readonly title: string; readonly body: string },
      { readonly title: string; readonly body: string },
      { readonly title: string; readonly body: string }
    ];
  };
  readonly local: {
    readonly title: string;
    readonly body: string;
    readonly points: readonly [string, string, string];
  };
  readonly pricing: {
    readonly title: string;
    readonly body: string;
    readonly plans: readonly [
      {
        readonly name: string;
        readonly status: string;
        readonly price: string;
        readonly description: string;
        readonly points: readonly [string, string, string];
        readonly note: string;
        readonly available: true;
      },
      {
        readonly name: string;
        readonly status: string;
        readonly price: string;
        readonly description: string;
        readonly points: readonly [string, string, string];
        readonly note: string;
        readonly available: false;
      },
      {
        readonly name: string;
        readonly status: string;
        readonly price: string;
        readonly description: string;
        readonly points: readonly [string, string, string];
        readonly note: string;
        readonly available: false;
      }
    ];
  };
  readonly download: {
    readonly kicker: string;
    readonly title: string;
    readonly body: string;
    readonly action: string;
    readonly platforms: readonly [
      { readonly name: string; readonly detail: string; readonly href: string; readonly available: boolean },
      { readonly name: string; readonly detail: string; readonly href: string; readonly available: boolean },
      { readonly name: string; readonly detail: string; readonly href: string; readonly available: boolean },
      { readonly name: string; readonly detail: string; readonly href: string; readonly available: boolean }
    ];
    readonly upcomingTitle: string;
    readonly upcoming: readonly [string, string, string];
    readonly waiting: string;
  };
  readonly contact: {
    readonly kicker: string;
    readonly title: string;
    readonly body: string;
    readonly emailLabel: string;
    readonly personalNotice: string;
    readonly channels: readonly [
      { readonly label: string; readonly value: string },
      { readonly label: string; readonly value: string },
      { readonly label: string; readonly value: string },
      { readonly label: string; readonly value: string }
    ];
  };
  readonly footer: {
    readonly statement: string;
    readonly independent: string;
    readonly terms: string;
    readonly privacy: string;
    readonly licenses: string;
    readonly legal: string;
  };
};

const dictionaries: Record<SiteLocale, SiteCopy> = {
  zh: {
    metadata: {
      title: "Lyra Agent 工作台",
      description: "Lyra 是一张由您与 Agent 共同使用的桌面工作台，让任务在网页、终端、文件与应用之间连续推进。"
    },
    nav: {
      product: "Lyra",
      details: "工作台",
      oma: "Oma",
      local: "选择权",
      pricing: "定价",
      docs: "文档",
      download: "下载",
      language: "English",
      lightTheme: "切换为浅色主题",
      darkTheme: "切换为深色主题"
    },
    hero: {
      title: "Lyra 是您与 Agent 共用的桌面工作台。",
      titleLines: ["Lyra 是桌面工作台，", "由您与 Agent 共同使用。"],
      body: "Lyra 把网页、终端、文件和桌面应用放进同一个工作现场，让您亲自操作或让 Agent 理解当前工作区并继续完成任务。",
      primary: "查看工作台",
      secondary: "阅读文档",
      note: "macOS、Windows 与 Linux 版本正在准备中。",
      imageAlt: "Lyra 桌面工作台，包含 Agent 会话、网页、设置与终端",
      keywords: [
        {
          title: "快速",
          body: "速度不只来自更快的回复。网页、终端、文件与任务上下文留在同一个工作现场，少一点切换、复制与重复解释，下一步就能更早发生。"
        },
        {
          title: "本地",
          body: "项目、会话与偏好优先留在您的设备上。无需账户也能进入完整工作台，并由您决定什么时候让云端能力参与其中。"
        },
        {
          title: "智能",
          body: "Agent 看到的不只是一段提示词。它能理解眼前的网页、终端、文件与任务状态，再调用合适的工具把工作继续推进。"
        }
      ]
    },
    demo: {
      windowLabel: "Lyra 桌面工作台交互预览",
      windowTitle: "Lyra",
      actions: {
        notifications: "通知",
        history: "历史记录",
        terminal: "显示或隐藏终端",
        settings: "打开设置",
        store: "软件商店",
        files: "文件",
        discuss: "和 Lyra 讨论",
        newSession: "新会话",
        more: "更多",
        attach: "添加上下文",
        send: "发送",
        back: "后退",
        forward: "前进",
        layers: "标签布局",
        newTab: "新标签"
      },
      tabs: {
        hello: "你好",
        newSession: "新会话",
        files: "文件管理",
        site: "Lyra 官网",
        home: "首页",
        settings: "设置",
        docs: "Lyra 文档"
      },
      chat: {
        questionPrefix: "想要在",
        questionSuffix: "中做什么？",
        home: "Home",
        placeholder: "给 Lyra 发送消息",
        model: "DeepSeek V4 Flash Free",
        permission: "全自动",
        backend: "后台终端",
        plan: "规划",
        location: "未定位",
        reply: "我会从当前工作区继续，先确认页面和项目状态，再完成下一步。"
      },
      settings: {
        title: "设置",
        general: "通用",
        appearance: "外观",
        workspace: "工作区",
        notifications: "通知",
        login: "登录管理器",
        lyra: "Lyra 软件",
        search: "搜索",
        agents: "Lyra Agents",
        models: "模型",
        skills: "技能",
        mcp: "MCP",
        experimental: "试验性功能",
        docs: "文档",
        theme: "主题",
        dark: "深色",
        light: "浅色",
        material: "系统材质背景",
        materialDescription: "使用系统的模糊与半透明窗口背景。",
        language: "界面语言",
        languageValue: "跟随系统",
        updates: "自动更新",
        updatesDescription: "在新版本可用时提醒您。",
        updatesValue: "已开启",
        terminalPosition: "终端位置",
        bottom: "底部",
        restore: "恢复上次工作区",
        restoreDescription: "重新打开上次保留的标签和终端。"
      },
      workspace: {
        search: "搜索、输入网址或文件路径",
        openProject: "打开项目",
        newAgent: "新建 Agent 会话",
        recent: "最近使用",
        omnibox: "搜索、输入网址或文件路径",
        siteUrl: "lyra.ltd",
        docsKicker: "LYRA DOCUMENTATION",
        docsTitle: "一个任务，一张工作台。",
        docsBody: "网页、文件、终端与 Agent 会话都在这里成为任务的一部分。您和 Agent 面对的是同一个工作现场。",
        docsItems: ["Agent 会话", "网页与桌面操作", "模型、Skills 与 MCP"]
      },
      terminal: {
        tab: "petehsu%",
        prompt: "petehsu@Lyra ~ %",
        command: "pnpm dev",
        output: "Lyra workspace ready on localhost:5180"
      }
    },
    product: {
      title: "一个任务，一张工作台。",
      body: "在 Lyra 中，网页、终端、文件和应用不是发给 Agent 的零散附件，而是您与 Agent 正在共同使用的工作空间。任务转向哪里，工作台就跟到哪里。",
      imageAlt: "Lyra 中由用户与 Agent 共同使用的桌面工作台",
      items: [
        {
          title: "从网页到本机，任务不用中断。",
          body: "查阅网页、操作页面、运行命令、打开文件或切换桌面应用，Agent 可以沿着同一个任务继续工作，不必由您在不同工具之间反复转述。",
          alt: "Lyra 在网页、终端、文件与桌面应用之间继续任务"
        },
        {
          title: "您与 Agent 看见同一处现场。",
          body: "标签、分屏、终端窗格和当前工作区都是明确的工作对象。您可以随时接手，也可以让 Agent 读取现状、切换界面并在原处继续。",
          alt: "用户与 Agent 共同操作 Lyra 工作区"
        },
        {
          title: "让工作台适应您的方法。",
          body: "在同一运行环境中选择模型与服务商，并通过 Skills、MCP 和本地 Agent 包扩展能力。Lyra 把它们带回正在发生的任务，而不是拆成彼此孤立的入口。",
          alt: "Lyra 的模型、Skills、MCP 与 Agent 配置"
        }
      ]
    },
    oma: {
      label: "OMA / OH MY AGENTS",
      title: "一个 Agent 专注执行，一组 Agent 分工协作。",
      body: "Oma 是 Lyra 的多 Agent 工作模式。简单任务由 Lyra Lead 直接处理；需要不同专长或并行推进时，Lead 会组织 Builder、Reviewer、Designer 与 Researcher，并先提交一份可以审阅的 Team Plan。",
      agents: [
        { name: "Lyra Lead", role: "统筹与交付" },
        { name: "Builder", role: "实现" },
        { name: "Reviewer", role: "审查" },
        { name: "Designer", role: "设计" },
        { name: "Researcher", role: "研究" }
      ],
      items: [
        {
          title: "由 Lead 对结果负责。",
          body: "Lead 判断何时直接执行、何时调动团队，并在工作结束后汇总交付、风险与下一步。"
        },
        {
          title: "每项工作都有明确归属。",
          body: "工作包写明负责人、依赖、验收条件与交付物，可以并行的部分会并行推进。"
        },
        {
          title: "计划经您批准后才执行。",
          body: "团队不会在复杂任务上自行开工。您先审阅 Team Plan，再决定是否让它进入执行。"
        }
      ]
    },
    local: {
      title: "工作台属于您。",
      body: "Lyra 可以在不登录的情况下使用。账户只负责资料与偏好的同步；本地项目、模型选择和能力扩展不需要先经过某个云端入口。",
      points: [
        "本地模式是完整入口，不是试用页面",
        "账户只同步资料与偏好",
        "模型、服务商、Skills 与 MCP 由您配置"
      ]
    },
    pricing: {
      title: "从免费开始。",
      body: "Lyra 会保留进入本地工作台的免费方案。Pro 与 Max 的价格、额度和具体权益仍在评估，在正式确认之前，我不会提前承诺一个数字。",
      plans: [
        {
          name: "Free",
          status: "当前方案",
          price: "免费",
          description: "无需订阅即可使用本地工作台，并连接您选择的模型、服务商与能力扩展。",
          points: [
            "完整的本地工作台入口",
            "自定义模型与服务商",
            "Skills、MCP 与本地 Agent 包"
          ],
          note: "随首个公开版本提供。",
          available: true
        },
        {
          name: "Pro",
          status: "规划中",
          price: "待定",
          description: "面向需要更多云端能力、同步体验与使用额度的用户，具体范围仍在确认。",
          points: [
            "具体权益待定",
            "使用额度待定",
            "开放时间待定"
          ],
          note: "确认后再公布价格。",
          available: false
        },
        {
          name: "Max",
          status: "规划中",
          price: "待定",
          description: "面向更高强度的使用方式与更大任务规模，名称、范围和定价仍可能调整。",
          points: [
            "具体权益待定",
            "使用额度待定",
            "开放时间待定"
          ],
          note: "目前不接受预订。",
          available: false
        }
      ]
    },
    download: {
      kicker: "DOWNLOAD / DESKTOP",
      title: "让 Lyra 进入您的工作台。",
      body: "Lyra Preview 现已在 macOS、Windows 和 Linux 上提供。",
      action: "下载",
      platforms: [
        { name: "macOS", detail: "Apple Silicon 桌面安装包", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-darwin-arm64.dmg", available: true },
        { name: "macOS", detail: "Intel 桌面安装包", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-darwin-x64.dmg", available: true },
        { name: "Windows", detail: "Windows 桌面安装包", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-windows-x64.exe", available: true },
        { name: "Linux", detail: "Linux 桌面安装包 (AppImage)", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-linux-x64.AppImage", available: true }
      ],
      upcomingTitle: "接下来",
      upcoming: ["HarmonyOS", "移动端", "CLI"],
      waiting: "等待中"
    },
    contact: {
      kicker: "CONTACT / COLLABORATION",
      title: "有些事情，适合认真聊一聊。",
      body: "关于 Lyra、产品合作、开发交流，或者其他值得讨论的事情，您可以通过下面四个渠道或电子邮箱与我联系。",
      emailLabel: "个人联系邮箱",
      personalNotice:
        "以上渠道及电子邮箱均由运营者本人以个人身份提供和维护，并非专职客服或企业工单系统。受平台限制、网络状况、垃圾信息过滤或消息请求设置影响，个别消息可能无法送达或未被及时查看；如在合理时间内未收到回复，请改用其他列明渠道或重新发送邮件。请勿通过公开渠道发送密码、API 密钥或其他敏感信息。",
      channels: [
        { label: "X", value: "@Qxuzhong" },
        { label: "Telegram", value: "@PeteHsu" },
        { label: "QQ", value: "联系群组" },
        { label: "GitHub", value: "petehsu" }
      ]
    },
    footer: {
      statement: "Anything. Anytime. Anywhere. And more.",
      independent: "由个人开发者独立设计、开发与维护。",
      terms: "用户协议",
      privacy: "隐私政策",
      licenses: "开源软件许可",
      legal: "法律信息"
    }
  },
  en: {
    metadata: {
      title: "Lyra Agent Workbench",
      description: "A desktop workbench shared by you and your Agents, carrying tasks across the web, terminals, files, and apps."
    },
    nav: {
      product: "Lyra",
      details: "Workbench",
      oma: "Oma",
      local: "Control",
      pricing: "Pricing",
      docs: "Docs",
      download: "Download",
      language: "中文",
      lightTheme: "Switch to light theme",
      darkTheme: "Switch to dark theme"
    },
    hero: {
      title: "Lyra is the desktop workbench shared by you and your Agents.",
      titleLines: ["Lyra is the desktop workbench", "shared by you and your Agents."],
      body: "Lyra brings web pages, terminals, files, and desktop apps into one place so you can work directly or let an Agent understand the current workspace and continue the task.",
      primary: "See the workbench",
      secondary: "Read the docs",
      note: "Desktop builds for macOS, Windows, and Linux are in development.",
      imageAlt: "The Lyra desktop workbench with an Agent session, web page, settings, and terminal",
      keywords: [
        {
          title: "Fast",
          body: "Speed is more than response time. The browser, terminal, files, and task context stay in one place, so less time disappears into switching, copying, and explaining the same work again."
        },
        {
          title: "Local",
          body: "Projects, sessions, and preferences stay on your device first. The complete workbench remains available without an account, and you decide when cloud services enter the loop."
        },
        {
          title: "Smart",
          body: "An Agent sees more than a prompt. It can understand the page, terminal, files, and task state in front of it, then use the right tool to keep the work moving."
        }
      ]
    },
    demo: {
      windowLabel: "Interactive preview of the Lyra desktop workbench",
      windowTitle: "Lyra",
      actions: {
        notifications: "Notifications",
        history: "History",
        terminal: "Show or hide terminal",
        settings: "Open settings",
        store: "Software store",
        files: "Files",
        discuss: "Discuss with Lyra",
        newSession: "New session",
        more: "More",
        attach: "Add context",
        send: "Send",
        back: "Back",
        forward: "Forward",
        layers: "Tab layout",
        newTab: "New tab"
      },
      tabs: {
        hello: "Hello",
        newSession: "New session",
        files: "Files",
        site: "Lyra",
        home: "Home",
        settings: "Settings",
        docs: "Lyra Docs"
      },
      chat: {
        questionPrefix: "What do you want to do in",
        questionSuffix: "?",
        home: "Home",
        placeholder: "Send a message to Lyra",
        model: "DeepSeek V4 Flash Free",
        permission: "Full auto",
        backend: "Terminal",
        plan: "Plan",
        location: "No location",
        reply: "I will continue from the current workspace, check the page and project state, then carry out the next step."
      },
      settings: {
        title: "Settings",
        general: "General",
        appearance: "Appearance",
        workspace: "Workspace",
        notifications: "Notifications",
        login: "Login Manager",
        lyra: "Lyra Software",
        search: "Search",
        agents: "Lyra Agents",
        models: "Models",
        skills: "Skills",
        mcp: "MCP",
        experimental: "Experimental",
        docs: "Documentation",
        theme: "Theme",
        dark: "Dark",
        light: "Light",
        material: "System material background",
        materialDescription: "Use the system blur and translucent window material.",
        language: "Interface language",
        languageValue: "Follow system",
        updates: "Automatic updates",
        updatesDescription: "Notify you when a new build is available.",
        updatesValue: "On",
        terminalPosition: "Terminal position",
        bottom: "Bottom",
        restore: "Restore previous workspace",
        restoreDescription: "Reopen retained tabs and terminals on launch."
      },
      workspace: {
        search: "Search, enter a URL, or open a file",
        openProject: "Open project",
        newAgent: "New Agent session",
        recent: "Recent work",
        omnibox: "Search, enter a URL, or open a file",
        siteUrl: "lyra.ltd",
        docsKicker: "LYRA DOCUMENTATION",
        docsTitle: "One task. One workbench.",
        docsBody: "Pages, files, terminals, and Agent sessions all become part of the task. You and your Agent work from the same place.",
        docsItems: ["Agent sessions", "Web and desktop action", "Models, Skills, and MCP"]
      },
      terminal: {
        tab: "petehsu%",
        prompt: "petehsu@Lyra ~ %",
        command: "pnpm dev",
        output: "Lyra workspace ready on localhost:5180"
      }
    },
    product: {
      title: "One task. One workbench.",
      body: "In Lyra, pages, terminals, files, and apps are not loose attachments sent into a chat. They are the workspace you and your Agent are using together. When the task moves, the workbench moves with it.",
      imageAlt: "The Lyra desktop workbench shared by a user and an Agent",
      items: [
        {
          title: "From the web to your machine, without breaking the task.",
          body: "Research a page, act on the web, run a command, open a file, or move to a desktop app. The Agent can follow the same task through instead of asking you to relay every step between tools.",
          alt: "A task continuing across web pages, terminals, files, and desktop apps in Lyra"
        },
        {
          title: "You and your Agent see the same workspace.",
          body: "Tabs, splits, terminal panes, and the active workspace are explicit objects. Take over at any point, or let the Agent read the current state, move through the interface, and continue in place.",
          alt: "A user and an Agent working in the same Lyra workspace"
        },
        {
          title: "Shape the workbench around the way you work.",
          body: "Choose models and providers within one runtime, then extend it with Skills, MCP, and local Agent packages. Lyra brings those capabilities back into the task instead of scattering them across separate entry points.",
          alt: "Models, Skills, MCP, and Agent configuration in Lyra"
        }
      ]
    },
    oma: {
      label: "OMA / OH MY AGENTS",
      title: "One Agent for focus. A team with clear ownership.",
      body: "Oma is Lyra's multi-Agent mode. Lyra Lead handles focused work directly. When a task needs different specialties or parallel progress, Lead brings in Builder, Reviewer, Designer, and Researcher, then presents a Team Plan for review.",
      agents: [
        { name: "Lyra Lead", role: "Coordination and delivery" },
        { name: "Builder", role: "Implementation" },
        { name: "Reviewer", role: "Review" },
        { name: "Designer", role: "Design" },
        { name: "Researcher", role: "Research" }
      ],
      items: [
        {
          title: "Lead owns the outcome.",
          body: "Lead decides when to work directly, when to involve the team, and how to report the delivery, remaining risks, and next steps."
        },
        {
          title: "Every piece of work has an owner.",
          body: "Work packages name their owner, dependencies, acceptance criteria, and deliverables. Independent work can run in parallel."
        },
        {
          title: "Execution starts with your approval.",
          body: "The team does not quietly begin a complex task. You review the Team Plan first, then decide whether it should run."
        }
      ]
    },
    local: {
      title: "The workbench is yours.",
      body: "Lyra can be used without signing in. An account only syncs profile details and preferences; local projects, model choices, and extensions do not need to pass through a cloud account first.",
      points: [
        "Local mode is a full entry point, not a trial screen",
        "Accounts only sync profile details and preferences",
        "You configure models, providers, Skills, and MCP"
      ]
    },
    pricing: {
      title: "Start free.",
      body: "Lyra will keep a free path into the local workbench. Pricing, allowances, and exact benefits for Pro and Max are still being evaluated; I will not promise numbers before they are ready.",
      plans: [
        {
          name: "Free",
          status: "Current plan",
          price: "$0",
          description: "Use the local workbench without a subscription, then connect the models, providers, and extensions you choose.",
          points: [
            "Full local workbench entry",
            "Your choice of models and providers",
            "Skills, MCP, and local Agent packages"
          ],
          note: "Included with the first public release.",
          available: true
        },
        {
          name: "Pro",
          status: "In planning",
          price: "TBD",
          description: "For people who need more cloud capability, synchronization, and usage allowance. The exact scope is still being decided.",
          points: [
            "Benefits to be confirmed",
            "Usage allowance to be confirmed",
            "Availability to be confirmed"
          ],
          note: "Pricing will be published when it is ready.",
          available: false
        },
        {
          name: "Max",
          status: "In planning",
          price: "TBD",
          description: "For heavier use and larger task scales. The name, scope, and pricing may still change.",
          points: [
            "Benefits to be confirmed",
            "Usage allowance to be confirmed",
            "Availability to be confirmed"
          ],
          note: "Reservations are not open.",
          available: false
        }
      ]
    },
    download: {
      kicker: "DOWNLOAD / DESKTOP",
      title: "Bring Lyra to your workbench.",
      body: "Lyra Preview is available for macOS, Windows, and Linux.",
      action: "Download",
      platforms: [
        { name: "macOS", detail: "Apple Silicon desktop installer", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-darwin-arm64.dmg", available: true },
        { name: "macOS", detail: "Intel desktop installer", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-darwin-x64.dmg", available: true },
        { name: "Windows", detail: "Desktop installer for Windows", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-windows-x64.exe", available: true },
        { name: "Linux", detail: "Desktop installer for Linux (AppImage)", href: "https://github.com/petehsu/lyra-releases/releases/download/v0.1.0-preview.10/Lyra-Online-linux-x64.AppImage", available: true }
      ],
      upcomingTitle: "Coming next",
      upcoming: ["HarmonyOS", "Mobile", "CLI"],
      waiting: "Waiting"
    },
    contact: {
      kicker: "CONTACT / COLLABORATION",
      title: "Some things deserve a proper conversation.",
      body: "For Lyra, product collaboration, development conversations, or anything else worth discussing, you can reach me through any of the four channels below or by email.",
      emailLabel: "Personal contact email",
      personalNotice:
        "All listed channels and the email address are provided and maintained personally by the operator, not by a staffed support desk or corporate ticketing system. Platform restrictions, network conditions, spam filtering, or message-request settings may prevent delivery or timely review. If you do not receive a response within a reasonable time, please try another listed channel or resend your email. Do not send passwords, API keys, or other sensitive information through public channels.",
      channels: [
        { label: "X", value: "@Qxuzhong" },
        { label: "Telegram", value: "@PeteHsu" },
        { label: "QQ", value: "Community group" },
        { label: "GitHub", value: "petehsu" }
      ]
    },
    footer: {
      statement: "Anything. Anytime. Anywhere. And more.",
      independent: "Independently designed, developed, and maintained.",
      terms: "Terms",
      privacy: "Privacy",
      licenses: "Open source licenses",
      legal: "Legal"
    }
  }
};

export const isSiteLocale = (value: string): value is SiteLocale =>
  SITE_LOCALES.includes(value as SiteLocale);

export const getDictionary = (locale: SiteLocale): SiteCopy =>
  dictionaries[locale];
