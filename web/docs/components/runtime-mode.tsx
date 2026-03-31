"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

type DocsHostMode = "lyra" | "web";
type DocsThemeMode = "dark" | "light";
type DocsLocaleMode = "zh-CN" | "en-US";
type LyraResolvedThemeId =
  | "one-light"
  | "one-dark"
  | "ayu-light"
  | "ayu-dark"
  | "gruvbox-light"
  | "gruvbox-dark";

type RuntimeModeState = {
  readonly host: DocsHostMode;
  readonly theme: DocsThemeMode;
  readonly lyraThemeId: LyraResolvedThemeId;
  readonly locale: DocsLocaleMode;
};

const STORAGE_KEYS = {
  theme: "lyra.docs.theme",
  locale: "lyra.docs.locale"
} as const;

const normalizeLocale = (value: string | null): DocsLocaleMode | null => {
  if (value === null || value.length === 0) {
    return null;
  }
  if (value === "en-US") {
    return value;
  }
  if (value === "zh-CN") {
    return value;
  }
  return "zh-CN";
};

const normalizeThemeMode = (value: string | null): DocsThemeMode => {
  if (value === null || value.length === 0) {
    return "dark";
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("light")) {
    return "light";
  }
  return "dark";
};

const normalizeLyraThemeId = (value: string | null): LyraResolvedThemeId => {
  switch (value) {
    case "one-light":
    case "one-dark":
    case "ayu-light":
    case "ayu-dark":
    case "gruvbox-light":
    case "gruvbox-dark":
      return value;
    default:
      return "one-dark";
  }
};

const toThemeMode = (themeId: LyraResolvedThemeId): DocsThemeMode =>
  themeId.endsWith("-light") ? "light" : "dark";

const parseRuntimeState = (): RuntimeModeState => {
  const params = new URLSearchParams(window.location.search);
  const host: DocsHostMode = params.get("host") === "lyra" ? "lyra" : "web";
  const queryLocale = normalizeLocale(params.get("locale"));

  if (host === "lyra") {
    const lyraThemeId = normalizeLyraThemeId(params.get("theme"));
    return {
      host,
      locale: queryLocale ?? "zh-CN",
      lyraThemeId,
      theme: toThemeMode(lyraThemeId)
    };
  }

  const theme = normalizeThemeMode(window.localStorage.getItem(STORAGE_KEYS.theme));
  const localeFromStorage = normalizeLocale(window.localStorage.getItem(STORAGE_KEYS.locale));
  return {
    host,
    locale: queryLocale ?? localeFromStorage ?? "zh-CN",
    theme,
    lyraThemeId: theme === "light" ? "one-light" : "one-dark"
  };
};

const zhLabels = {
  language: "语言",
  theme: "主题",
  zh: "中文",
  en: "EN",
  dark: "深色",
  light: "浅色"
} as const;

const enLabels = {
  language: "Language",
  theme: "Theme",
  zh: "中文",
  en: "EN",
  dark: "Dark",
  light: "Light"
} as const;

export const RuntimeModeBridge = () => {
  const { setTheme } = useTheme();
  const [state, setState] = useState<RuntimeModeState | null>(null);

  useEffect(() => {
    setState(parseRuntimeState());
  }, []);

  useEffect(() => {
    if (state === null) {
      return;
    }
    document.documentElement.lang = state.locale;
    document.documentElement.dataset.lyraHost = state.host;
    document.documentElement.dataset.lyraTheme = state.lyraThemeId;
    setTheme(state.theme);

    if (state.host === "web") {
      window.localStorage.setItem(STORAGE_KEYS.locale, state.locale);
      window.localStorage.setItem(STORAGE_KEYS.theme, state.theme);
    }
  }, [setTheme, state]);

  const labels = useMemo(
    () => (state?.locale === "en-US" ? enLabels : zhLabels),
    [state?.locale]
  );

  if (state === null || state.host === "lyra") {
    return null;
  }

  const updateLocale = (locale: DocsLocaleMode): void => {
    const url = new URL(window.location.href);
    url.searchParams.set("locale", locale);
    window.location.assign(url.toString());
  };

  const updateTheme = (theme: DocsThemeMode): void => {
    setState((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            theme,
            lyraThemeId: theme === "light" ? "one-light" : "one-dark"
          }
    );
  };

  return (
    <aside className="lyra-docs-standalone-controls" aria-label="docs-standalone-controls">
      <div className="lyra-docs-control-row">
        <span>{labels.language}</span>
        <button
          type="button"
          className={state.locale === "zh-CN" ? "is-active" : ""}
          onClick={() => updateLocale("zh-CN")}
        >
          {labels.zh}
        </button>
        <button
          type="button"
          className={state.locale === "en-US" ? "is-active" : ""}
          onClick={() => updateLocale("en-US")}
        >
          {labels.en}
        </button>
      </div>
      <div className="lyra-docs-control-row">
        <span>{labels.theme}</span>
        <button
          type="button"
          className={state.theme === "dark" ? "is-active" : ""}
          onClick={() => updateTheme("dark")}
        >
          {labels.dark}
        </button>
        <button
          type="button"
          className={state.theme === "light" ? "is-active" : ""}
          onClick={() => updateTheme("light")}
        >
          {labels.light}
        </button>
      </div>
    </aside>
  );
};
