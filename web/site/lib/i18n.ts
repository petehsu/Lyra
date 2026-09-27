export const SITE_LOCALES = ["zh", "en"] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

export type SiteCopy = {
  readonly metadata: { readonly title: string; readonly description: string };
  readonly nav: {
    readonly details: string;
    readonly local: string;
    readonly pricing: string;
    readonly docs: string;
    readonly download: string;
    readonly language: string;
    readonly lightTheme: string;
    readonly darkTheme: string;
  };
  readonly hero: { readonly title: string; readonly previewCaption: string };
  readonly product: {
    readonly title: string;
    readonly body: string;
    readonly items: readonly { readonly title: string; readonly body: string }[];
  };
  readonly local: {
    readonly title: string;
    readonly body: string;
    readonly points: readonly string[];
  };
  readonly video: { readonly title: string; readonly frameTitle: string };
  readonly pricing: {
    readonly title: string;
    readonly body: string;
    readonly note: string;
    readonly plans: readonly {
      readonly name: string;
      readonly status: string;
      readonly price: string;
      readonly description: string;
      readonly points: readonly string[];
      readonly available: boolean;
    }[];
  };
  readonly download: {
    readonly title: string;
    readonly body: string;
    readonly action: string;
    readonly select: string;
    readonly otherVersions: string;
    readonly recommended: string;
    readonly upcomingTitle: string;
    readonly upcoming: readonly [string, string];
    readonly waiting: string;
    readonly upcomingNote: string;
    readonly platforms: readonly [
      { readonly id: "macos"; readonly name: string; readonly detail: string },
      { readonly id: "windows"; readonly name: string; readonly detail: string },
      { readonly id: "linux"; readonly name: string; readonly detail: string }
    ];
  };
  readonly contact: {
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
      title: "Lyra — 电脑上的通用 Agent",
      description: "用 Lyra 查阅网页、处理文件、修改代码和运行命令。支持桌面应用操作、自选模型、Skills 与 MCP。提供 macOS、Windows 和 Linux 预览版。"
    },
    nav: {
      details: "功能",
      local: "模型与工具",
      pricing: "费用",
      docs: "文档",
      download: "下载",
      language: "English",
      lightTheme: "切换为浅色主题",
      darkTheme: "切换为深色主题"
    },
    hero: {
      title: "Anything? Lyra.",
      previewCaption: "界面预览 · 拖动分隔线调整布局"
    },
    product: {
      title: "电脑上的通用 Agent。",
      body: "把要做的事告诉 Lyra。它可以查阅网页、处理本地文件、编写代码和运行命令。浏览器、编辑器和终端都在同一个窗口里，方便你查看过程和结果。",
      items: [
        {
          title: "查资料，处理文件。",
          body: "让 Lyra 查找网页、阅读材料，把结果整理成文件。你可以在工作区打开原始材料，对照检查，也可以直接修改。"
        },
        {
          title: "改代码，运行命令。",
          body: "让 Lyra 修改项目、运行脚本或排查报错。打开文件查看改动，在终端检查输出，再决定下一步。"
        },
        {
          title: "操作应用，随时接手。",
          body: "授权后，Lyra 可以通过屏幕和键鼠操作支持的桌面应用。你可以在过程中补充要求，也可以亲自接手。可用操作取决于应用和系统权限。"
        }
      ]
    },
    local: {
      title: "用你选的模型。",
      body: "连接自己的模型服务，或使用本地模型。通过 Skills 加入任务说明，通过 MCP 连接外部工具和数据。",
      points: [
        "本地模式无需登录 Lyra 账户",
        "支持自带 API Key 和兼容模型接口",
        "云端模型会接收任务相关内容"
      ]
    },
    video: {
      title: "看看实际操作。",
      frameTitle: "Lyra 桌面版演示视频"
    },
    pricing: {
      title: "选择方案。",
      body: "当前可下载免费测试版。Pro 与 Max 为规划方案，尚未开放订阅。",
      note: "模型服务可能另行收费，费用和额度由所选服务商决定。",
      plans: [
        {
          name: "Free",
          status: "当前测试版",
          price: "免费",
          description: "下载桌面版，连接你选择的模型。",
          points: ["无需 Lyra 账户使用本地模式", "自带 API Key 或连接本地模型", "支持 Skills 与 MCP"],
          available: true
        },
        {
          name: "Pro",
          status: "规划中",
          price: "待公布",
          description: "价格、使用额度和具体功能将在方案确定后公布。",
          points: [],
          available: false
        },
        {
          name: "Max",
          status: "规划中",
          price: "待公布",
          description: "具体权益尚未确定，暂不接受订阅或预订。",
          points: [],
          available: false
        }
      ]
    },
    download: {
      title: "下载 Lyra。",
      body: "选择适合你电脑的 Lyra Preview 安装包。当前为测试版，请备份重要文件。",
      action: "下载",
      select: "选择版本",
      otherVersions: "其他架构与格式",
      recommended: "适合当前设备",
      upcomingTitle: "平台规划",
      upcoming: ["移动端", "CLI"],
      waiting: "规划中",
      upcomingNote: "独立下载入口与发布时间确认后更新。",
      platforms: [
        { id: "macos", name: "macOS", detail: "Apple Silicon / Intel" },
        { id: "windows", name: "Windows", detail: "ARM64 / x86_64" },
        { id: "linux", name: "Linux", detail: "AppImage、deb、rpm、Flatpak、Arch" }
      ]
    },
    contact: {
      title: "联系开发者。",
      body: "反馈问题、交流想法或洽谈合作，可以发邮件或通过以下渠道联系我。",
      emailLabel: "个人联系邮箱",
      personalNotice:
        "以上渠道及电子邮箱均由运营者本人以个人身份提供和维护，并非专职客服或企业工单系统。受平台限制、网络状况、垃圾信息过滤或消息请求设置影响，个别消息可能无法送达或未被及时查看；如在合理时间内未收到回复，请改用其他列明渠道或重新发送邮件。请勿通过公开渠道发送密码、API 密钥或其他敏感信息。",
      channels: [
        { label: "X", value: "@Qxuzhong" },
        { label: "Telegram", value: "@PeteHsu" },
        { label: "QQ", value: "交流群" },
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
      title: "Lyra — A general-purpose agent for your computer",
      description: "Use Lyra to browse the web, work with files, write code, and run commands. Choose your models and add tools with Skills and MCP. Preview for macOS, Windows, and Linux."
    },
    nav: {
      details: "Features",
      local: "Models & tools",
      pricing: "Pricing",
      docs: "Docs",
      download: "Download",
      language: "中文",
      lightTheme: "Switch to light theme",
      darkTheme: "Switch to dark theme"
    },
    hero: {
      title: "Anything? Lyra.",
      previewCaption: "Interface preview · Drag a divider to resize"
    },
    product: {
      title: "An agent for your computer.",
      body: "Tell Lyra what you need to do. It can browse the web, work with local files, write code, and run commands. The browser, editor, and terminal share one window, so you can follow the work and check the results.",
      items: [
        {
          title: "Research and work with files.",
          body: "Ask Lyra to find webpages, read your materials, and save its findings to a file. Open the sources in the workspace to check the results or make your own edits."
        },
        {
          title: "Edit code and run commands.",
          body: "Ask Lyra to change a project, run a script, or investigate an error. Review the file changes and terminal output before deciding what comes next."
        },
        {
          title: "Work in desktop apps.",
          body: "With permission, Lyra can use the screen, keyboard, and pointer to operate supported apps. Give it more instructions or take over yourself. Available actions depend on the app and system permissions."
        }
      ]
    },
    local: {
      title: "Use the model you choose.",
      body: "Connect a model provider or a local model endpoint. Add task instructions with Skills and connect external tools and data through MCP.",
      points: [
        "Use local mode without a Lyra account",
        "Bring your API key or a compatible endpoint",
        "Cloud models receive task-related content"
      ]
    },
    video: {
      title: "See Lyra in use.",
      frameTitle: "Lyra desktop demo video"
    },
    pricing: {
      title: "Plans.",
      body: "The free beta is available now. Pro and Max are planned tiers; subscriptions are not open.",
      note: "Model services may charge separately. Costs and limits depend on your provider.",
      plans: [
        {
          name: "Free",
          status: "Current beta",
          price: "$0",
          description: "Download the desktop app and connect your chosen model.",
          points: ["Local mode without a Lyra account", "Your API key or a local model", "Skills and MCP support"],
          available: true
        },
        {
          name: "Pro",
          status: "Planned",
          price: "Not yet priced",
          description: "Pricing, usage limits, and included features will be published once confirmed.",
          points: [],
          available: false
        },
        {
          name: "Max",
          status: "Planned",
          price: "Not yet priced",
          description: "Included features are still being decided. No subscriptions or reservations yet.",
          points: [],
          available: false
        }
      ]
    },
    download: {
      title: "Download Lyra.",
      body: "Choose the Lyra Preview installer for your computer. This is a beta; back up important files.",
      action: "Download",
      select: "Choose version",
      otherVersions: "Other architectures and formats",
      recommended: "For this device",
      upcomingTitle: "Planned platforms",
      upcoming: ["Mobile", "CLI"],
      waiting: "Planned",
      upcomingNote: "Standalone downloads and release dates will be listed once confirmed.",
      platforms: [
        { id: "macos", name: "macOS", detail: "Apple Silicon / Intel" },
        { id: "windows", name: "Windows", detail: "ARM64 / x86_64" },
        { id: "linux", name: "Linux", detail: "AppImage, deb, rpm, Flatpak, Arch" }
      ]
    },
    contact: {
      title: "Contact the developer.",
      body: "Report an issue, share feedback, or discuss a collaboration. Email me or use one of the channels below.",
      emailLabel: "Personal contact email",
      personalNotice:
        "All listed channels and the email address are provided and maintained personally by the operator, not by a staffed support desk or corporate ticketing system. Platform restrictions, network conditions, spam filtering, or message-request settings may prevent delivery or timely review. If you do not receive a response within a reasonable time, please try another listed channel or resend your email. Do not send passwords, API keys, or other sensitive information through public channels.",
      channels: [
        { label: "X", value: "@Qxuzhong" },
        { label: "Telegram", value: "@PeteHsu" },
        { label: "QQ", value: "Community" },
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
