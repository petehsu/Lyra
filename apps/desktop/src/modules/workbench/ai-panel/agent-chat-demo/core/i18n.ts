// ============================================================================
// Lyra Agent UI — Internationalization
// ============================================================================
//
// Minimal i18n layer: a flat message map per locale, plus a `t(key)` helper.
// Kept dependency-free so replacing with react-i18next or i18next later is a
// two-line swap.

export type Locale = "zh-CN" | "en-US";

type Messages = Record<string, string>;

const DICTIONARIES: Record<Locale, Messages> = {
  "zh-CN": {
    "app.title": "Lyra Agent UI",
    "app.tagline": "Agent 交互体验演示",

    "composer.placeholder": "给 Agent 发送消息",
    "composer.send": "发送",
    "composer.attach": "附件",

    "scroll.toBottom": "回到底部",

    "decision.submit": "提交",
    "decision.prev": "上一个",
    "decision.next": "下一个",
    "decision.custom": "自定义",
    "decision.customPlaceholder": "输入你的回答",

    "permission.approve": "允许",
    "permission.deny": "拒绝",

    "todo.plan": "执行计划",

    "diff.files": "个文件",

    "debug.title": "调试面板",
    "debug.decisions": "提问面板",
    "debug.permission": "权限申请面板",

    "msg.copy": "复制消息",
    "msg.undo": "撤回",

    "working": "处理中",

    "tool.ask.prefix": "Asked:",
  },

  "en-US": {
    "app.title": "Lyra Agent UI",
    "app.tagline": "Agent interaction demo",

    "composer.placeholder": "Send a message to Agent",
    "composer.send": "Send",
    "composer.attach": "Attach",

    "scroll.toBottom": "Scroll to bottom",

    "decision.submit": "Submit",
    "decision.prev": "Previous",
    "decision.next": "Next",
    "decision.custom": "Custom",
    "decision.customPlaceholder": "Type your answer",

    "permission.approve": "Allow",
    "permission.deny": "Deny",

    "todo.plan": "Execution plan",

    "diff.files": "files",

    "debug.title": "Debug",
    "debug.decisions": "Decisions panel",
    "debug.permission": "Permissions panel",

    "msg.copy": "Copy message",
    "msg.undo": "Undo",

    "working": "Working",

    "tool.ask.prefix": "Asked:",
  },
};

let currentLocale: Locale = detectLocale();

function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-CN";
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  return "en-US";
}

/** Get a localized string. Returns the key when missing for easy debugging. */
export function t(key: string): string {
  return DICTIONARIES[currentLocale][key] ?? key;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}
