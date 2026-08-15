export type OpeningLocale = "en-US" | "zh-CN";

type TechCardCopy = {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail?: string;
};

export type OpeningCopy = {
  readonly prompt: string;
  readonly workingIntro: string;
  readonly finalResponse: string;
  readonly activities: {
    readonly webSearchRunning: string;
    readonly webSearchDone: string;
    readonly repositoryRunning: string;
    readonly repositoryDone: string;
    readonly fileRunning: string;
    readonly fileDone: string;
  };
  readonly cards: readonly TechCardCopy[];
};

const copyByLocale: Record<OpeningLocale, OpeningCopy> = {
  "en-US": {
    prompt: "Build the Lyra website from this repository. Research modern product sites, implement it, run it locally, and verify every section in the browser.",
    workingIntro: "I’ll research the strongest product-site patterns, inspect the existing Lyra design system, then build and verify the site locally.",
    finalResponse:
      "The Lyra website is running locally. I rebuilt the complete experience from the existing design system, verified every section in the browser, and left the development server ready for review.",
    activities: {
      webSearchRunning: "Searching the web",
      webSearchDone: "Searched the web",
      repositoryRunning: "Inspecting repository",
      repositoryDone: "Inspected repository",
      fileRunning: "Reading agent runtime",
      fileDone: "Read agent runtime"
    },
    cards: [
      { eyebrow: "LYRA", title: "ONE WORKBENCH.", detail: "EVERY TOOL IN CONTEXT." },
      {
        eyebrow: "02",
        title: "CONTEXT, UNIFIED.",
        detail: "Browser  ·  Files  ·  Terminal  ·  Memory"
      },
      {
        eyebrow: "03",
        title: "PLAN. ACT. OBSERVE.",
        detail: "One continuous agent runtime"
      },
      {
        eyebrow: "04",
        title: "STREAMING, END TO END.",
        detail: "Events  ·  Tools  ·  Diffs  ·  Progress"
      },
      {
        eyebrow: "05",
        title: "BUILT TO FINISH.",
        detail: "Recoverable  ·  Auditable  ·  Local-first"
      }
    ]
  },
  "zh-CN": {
    prompt: "根据当前仓库构建 Lyra 官网。调研现代产品网站，完成实现，在本地运行，并在浏览器中验证每一个页面区块。",
    workingIntro: "我会先调研优秀产品网站的表达方式，检查 Lyra 现有设计系统，然后在本地完成构建与验证。",
    finalResponse:
      "Lyra 官网已经在本地运行。我基于现有设计系统完成了完整体验，并在浏览器中逐一验证所有页面区块，开发服务器已准备好供你检查。",
    activities: {
      webSearchRunning: "正在搜索网络",
      webSearchDone: "已搜索网络",
      repositoryRunning: "正在检查仓库",
      repositoryDone: "已检查仓库",
      fileRunning: "正在读取 Agent Runtime",
      fileDone: "已读取 Agent Runtime"
    },
    cards: [
      { eyebrow: "LYRA", title: "ONE WORKBENCH.", detail: "EVERY TOOL IN CONTEXT." },
      {
        eyebrow: "02",
        title: "统一所有上下文。",
        detail: "浏览器  ·  文件  ·  终端  ·  记忆"
      },
      {
        eyebrow: "03",
        title: "规划。行动。观察。",
        detail: "一套连续运行的 Agent Runtime"
      },
      {
        eyebrow: "04",
        title: "端到端实时流转。",
        detail: "事件  ·  工具  ·  差异  ·  进度"
      },
      {
        eyebrow: "05",
        title: "为完成工作而生。",
        detail: "可恢复  ·  可审计  ·  本地优先"
      }
    ]
  }
};

export const resolveOpeningLocale = (): OpeningLocale => {
  const requested = new URLSearchParams(window.location.search).get("locale");
  if (requested === "zh-CN" || requested === "en-US") return requested;
  return "en-US";
};

export const openingCopy = (locale: OpeningLocale): OpeningCopy => copyByLocale[locale];
