import { NATIVE_CONTEXT_MENU_TRANSLATION_KEYS } from "./language-packs";

export type BrowserContextMenuLocale = string;

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

const LABELS: Record<string, BrowserContextMenuLabels> = {
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
  },
  "ja-JP": {
    back: "戻る",
    forward: "進む",
    reload: "再読み込み",
    copy: "コピー",
    cut: "切り取り",
    paste: "貼り付け",
    copyLink: "リンクをコピー",
    openLinkInNewTab: "新しいタブでリンクを開く",
    citeSelection: "選択範囲を AI に引用",
    citeLink: "リンクを AI に引用",
    citePage: "ページを AI に引用"
  },
  "ko-KR": {
    back: "뒤로",
    forward: "앞으로",
    reload: "새로 고침",
    copy: "복사",
    cut: "잘라내기",
    paste: "붙여넣기",
    copyLink: "링크 복사",
    openLinkInNewTab: "새 탭에서 링크 열기",
    citeSelection: "선택 영역을 AI에 인용",
    citeLink: "링크를 AI에 인용",
    citePage: "페이지를 AI에 인용"
  }
};

export const normalizeBrowserContextMenuLocale = (value: unknown): BrowserContextMenuLocale => {
  if (typeof value !== "string") {
    return "en-US";
  }
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? "en-US";
  } catch {
    return "en-US";
  }
};

export const browserContextMenuLabels = (
  locale: BrowserContextMenuLocale,
  resources?: Readonly<Record<string, string>>
): BrowserContextMenuLabels => {
  const fallback = LABELS[locale] ?? LABELS["en-US"]!;
  if (resources === undefined) {
    return fallback;
  }
  return {
    back: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.back] ?? fallback.back,
    forward: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.forward] ?? fallback.forward,
    reload: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.reload] ?? fallback.reload,
    copy: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.copy] ?? fallback.copy,
    cut: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.cut] ?? fallback.cut,
    paste: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.paste] ?? fallback.paste,
    copyLink: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.copyLink] ?? fallback.copyLink,
    openLinkInNewTab:
      resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.openLinkInNewTab] ?? fallback.openLinkInNewTab,
    citeSelection:
      resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.citeSelection] ?? fallback.citeSelection,
    citeLink: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.citeLink] ?? fallback.citeLink,
    citePage: resources[NATIVE_CONTEXT_MENU_TRANSLATION_KEYS.citePage] ?? fallback.citePage
  };
};
