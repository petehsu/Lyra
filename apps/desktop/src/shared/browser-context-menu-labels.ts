export type BrowserContextMenuLocale = "zh-CN" | "en-US";

export type BrowserContextMenuLabels = {
  readonly back: string;
  readonly forward: string;
  readonly reload: string;
  readonly copy: string;
  readonly cut: string;
  readonly paste: string;
  readonly copyLink: string;
  readonly openLinkInNewTab: string;
  readonly citeSelection: string;
  readonly citeLink: string;
  readonly citePage: string;
};

const LABELS: Record<BrowserContextMenuLocale, BrowserContextMenuLabels> = {
  "zh-CN": {
    back: "后退",
    forward: "前进",
    reload: "重新加载",
    copy: "复制",
    cut: "剪切",
    paste: "粘贴",
    copyLink: "复制链接",
    openLinkInNewTab: "在新标签页中打开链接",
    citeSelection: "引用选区到 AI",
    citeLink: "引用链接到 AI",
    citePage: "引用页面到 AI"
  },
  "en-US": {
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    copy: "Copy",
    cut: "Cut",
    paste: "Paste",
    copyLink: "Copy link",
    openLinkInNewTab: "Open link in new tab",
    citeSelection: "Cite selection to AI",
    citeLink: "Cite link to AI",
    citePage: "Cite page to AI"
  }
};

export const normalizeBrowserContextMenuLocale = (value: unknown): BrowserContextMenuLocale =>
  value === "en-US" ? "en-US" : "zh-CN";

export const browserContextMenuLabels = (
  locale: BrowserContextMenuLocale
): BrowserContextMenuLabels => LABELS[locale];