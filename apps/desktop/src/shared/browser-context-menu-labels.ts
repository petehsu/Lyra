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
  const fallback = LABELS["en-US"]!;
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
