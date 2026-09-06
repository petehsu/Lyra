/**
 * Streamdown plugin configuration for Lyra.
 *
 * Wires streamdown's math (KaTeX), mermaid (diagrams), and code (Shiki)
 * sub-packages so that streaming and final rendering use the same renderer
 * with the same plugins — eliminating the streaming-vs-final style divergence
 * that existed when streaming used streamdown (cjk only) and final used
 * markdown-it + KaTeX + Monaco + LazyMermaid.
 *
 * Mermaid theme colors are bridged from Lyra's CSS variables so diagrams
 * match the app theme (dark/light).
 */

import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import type { MermaidConfig } from "mermaid";
import { useSyncExternalStore } from "react";
import type { DiagramPlugin, StreamdownProps } from "streamdown";

import { lyraDarkTheme, lyraLightTheme } from "./lyra-shiki-themes";

// ---- Mermaid theme bridging (from LyraDocument.tsx) ----

type LyraMermaidTone = "dark" | "light";

type LyraMermaidColors = {
  readonly tone: LyraMermaidTone;
  readonly surface: string;
  readonly surfaceStrong: string;
  readonly panel: string;
  readonly rowHover: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly note: string;
};

const fallbackMermaidColors = (tone: LyraMermaidTone): LyraMermaidColors =>
  tone === "dark"
    ? {
      tone,
      surface: "#1c1c1c",
      surfaceStrong: "#222221",
      panel: "#191919",
      rowHover: "#2b2b2a",
      text: "#dedede",
      textSecondary: "#b6b6b6",
      textMuted: "#8e8f90",
      border: "#303031",
      borderStrong: "#424445",
      note: "#2b241c"
    }
    : {
      tone,
      surface: "#edeced",
      surfaceStrong: "#f3f2f3",
      panel: "#f6f5f6",
      rowHover: "#e4e3e4",
      text: "#242529",
      textSecondary: "#4f5054",
      textMuted: "#6f7074",
      border: "#dedddd",
      borderStrong: "#c5c7c7",
      note: "#fff7ed"
    };

const readCssVar = (style: CSSStyleDeclaration, name: string, fallback: string): string => {
  const value = style.getPropertyValue(name).trim();
  return normalizeMermaidThemeColor(value, fallback);
};

// Mermaid's color parser deliberately supports a much smaller grammar than
// Chromium CSS. In particular it throws on color-mix(), even though that value
// is perfectly valid in Lyra's design tokens. Keep theme input at the
// integration boundary to the formats Mermaid accepts; falling back to the
// tone palette is preferable to losing the entire diagram.
const MERMAID_COLOR = /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|rgba?\(\s*[\d.]+(?:\s*[,/]\s*|\s+)[\d.]+)/iu;

export const normalizeMermaidThemeColor = (value: string, fallback: string): string => {
  const normalized = value.trim();
  return MERMAID_COLOR.test(normalized) ? normalized : fallback;
};

const readLyraMermaidColors = (): LyraMermaidColors => {
  if (typeof window === "undefined") {
    return fallbackMermaidColors("light");
  }
  const tone: LyraMermaidTone =
    document.documentElement.dataset.lyraThemeTone === "dark" ? "dark" : "light";
  const fallback = fallbackMermaidColors(tone);
  const style = window.getComputedStyle(document.documentElement);
  return {
    tone,
    surface: readCssVar(style, "--lyra-app-surface-bg", fallback.surface),
    surfaceStrong: readCssVar(style, "--lyra-app-surface-strong-bg", fallback.surfaceStrong),
    panel: readCssVar(style, "--lyra-app-panel-bg", fallback.panel),
    rowHover: readCssVar(style, "--lyra-app-row-hover-bg", fallback.rowHover),
    text: readCssVar(style, "--lyra-text-primary", fallback.text),
    textSecondary: readCssVar(style, "--lyra-text-secondary", fallback.textSecondary),
    textMuted: readCssVar(style, "--lyra-text-muted", fallback.textMuted),
    border: readCssVar(style, "--lyra-app-border", fallback.border),
    borderStrong: readCssVar(style, "--lyra-app-border-strong", fallback.borderStrong),
    note: fallback.note
  };
};

const createLyraMermaidConfig = (colors: LyraMermaidColors): MermaidConfig => ({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "base",
  htmlLabels: false,
  flowchart: {
    htmlLabels: false,
    useMaxWidth: false
  },
  sequence: {
    useMaxWidth: false,
    actorFontWeight: 600,
    messageFontWeight: 500,
    noteFontWeight: 500
  },
  mindmap: {
    useMaxWidth: false
  },
  themeVariables: {
    background: "transparent",
    darkMode: colors.tone === "dark",
    primaryColor: colors.surfaceStrong,
    primaryTextColor: colors.text,
    primaryBorderColor: colors.borderStrong,
    lineColor: colors.textMuted,
    secondaryColor: colors.rowHover,
    secondaryTextColor: colors.text,
    secondaryBorderColor: colors.borderStrong,
    tertiaryColor: colors.panel,
    tertiaryTextColor: colors.text,
    tertiaryBorderColor: colors.border,
    clusterBkg: colors.surface,
    clusterBorder: colors.border,
    edgeLabelBackground: colors.surface,
    noteBkgColor: colors.note,
    noteTextColor: colors.text,
    noteBorderColor: colors.borderStrong,
    actorBkg: colors.surfaceStrong,
    actorTextColor: colors.text,
    actorBorder: colors.borderStrong,
    signalColor: colors.textMuted,
    signalTextColor: colors.text,
    labelTextColor: colors.text,
    textColor: colors.text,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
  }
} as const);

/** Read the current Lyra mermaid config from CSS vars. Called lazily. */
const lyraMermaidConfig = (): MermaidConfig =>
  createLyraMermaidConfig(readLyraMermaidColors());

// ---- Plugin assembly ----

const mathPlugin = createMathPlugin({ singleDollarTextMath: true });
const codePlugin = createCodePlugin({ themes: [lyraLightTheme, lyraDarkTheme] });
const pluginCache = new Map<LyraMermaidTone, NonNullable<StreamdownProps["plugins"]>>();

/** Load Mermaid only when a completed diagram is actually visible. */
const createLazyMermaidPlugin = (initialConfig: MermaidConfig): DiagramPlugin => {
  let config = initialConfig;
  let instancePromise: Promise<ReturnType<DiagramPlugin["getMermaid"]>> | null = null;
  const load = (): Promise<ReturnType<DiagramPlugin["getMermaid"]>> => {
    instancePromise ??= import("@streamdown/mermaid").then(({ createMermaidPlugin }) =>
      createMermaidPlugin({ config }).getMermaid()
    );
    return instancePromise;
  };
  return {
    language: "mermaid",
    name: "mermaid",
    type: "diagram",
    getMermaid(nextConfig) {
      if (nextConfig !== undefined) config = { ...config, ...nextConfig };
      return {
        initialize(next) {
          config = { ...config, ...next };
        },
        async render(id, source) {
          return (await load()).render(id, source);
        }
      };
    }
  };
};

const pluginsForTone = (tone: LyraMermaidTone): NonNullable<StreamdownProps["plugins"]> => {
  const cached = pluginCache.get(tone);
  if (cached !== undefined) return cached;
  const plugins = {
    cjk,
    math: mathPlugin,
    mermaid: createLazyMermaidPlugin(lyraMermaidConfig()),
    code: codePlugin
  } satisfies NonNullable<StreamdownProps["plugins"]>;
  pluginCache.set(tone, plugins);
  return plugins;
};

const readThemeTone = (): LyraMermaidTone =>
  typeof document !== "undefined" && document.documentElement.dataset.lyraThemeTone === "dark"
    ? "dark"
    : "light";

const subscribeThemeTone = (onChange: () => void): (() => void) => {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-lyra-theme-tone"]
  });
  return () => observer.disconnect();
};

/**
 * Return one shared plugin bundle per theme tone. Mermaid reads Lyra's live
 * CSS palette when the tone changes; Shiki and KaTeX instances stay shared so
 * every message does not create another parser/highlighter.
 */
export const useLyraStreamdownPlugins = (): NonNullable<StreamdownProps["plugins"]> => {
  const tone = useSyncExternalStore<LyraMermaidTone>(
    subscribeThemeTone,
    readThemeTone,
    () => "light"
  );
  return pluginsForTone(tone);
};

export const streamdownLinkSafety = { enabled: false } satisfies NonNullable<
  StreamdownProps["linkSafety"]
>;
