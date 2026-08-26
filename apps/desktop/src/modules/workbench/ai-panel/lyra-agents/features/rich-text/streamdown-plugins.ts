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
import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "mermaid";
import type { StreamdownProps } from "streamdown";

import { remarkDetailsContainer } from "./remark-details-container";
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
  return value.length > 0 ? value : fallback;
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

export const lyraStreamdownPlugins = {
  cjk,
  // singleDollarTextMath: true aligns with the previous markdown-it katex
  // behavior where $...$ inline math was supported.
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: createMermaidPlugin({ config: lyraMermaidConfig() }),
  // Custom Lyra Shiki themes mapped from the Monaco theme palette.
  code: createCodePlugin({ themes: [lyraLightTheme, lyraDarkTheme] })
} satisfies StreamdownProps["plugins"];

export const streamdownLinkSafety = { enabled: false } satisfies NonNullable<
  StreamdownProps["linkSafety"]
>;

/**
 * Custom remark plugins applied by streamdown's `remarkPlugins` prop.
 * :::details container directive support (streamdown has no built-in
 * container directives).
 */
export const lyraRemarkPlugins = [remarkDetailsContainer];