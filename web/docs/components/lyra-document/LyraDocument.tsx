"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  renderMarkdown,
  sanitizeMermaidSvg,
  type MermaidRenderJob
} from "@lyra/markdown-render";

function PlainDocumentText({ content }: { readonly content: string }) {
  return <pre className="lyra-docs-plain-text">{content}</pre>;
}

const mermaidSvgCache = new Map<string, string>();
let mermaidInitializeSignature: string | null = null;

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
      surface: "#18181b",
      surfaceStrong: "#27272a",
      panel: "#111113",
      rowHover: "#3f3f46",
      text: "#f4f4f5",
      textSecondary: "#d4d4d8",
      textMuted: "#a1a1aa",
      border: "#3f3f46",
      borderStrong: "#52525b",
      note: "#2b241c"
    }
    : {
      tone,
      surface: "#ffffff",
      surfaceStrong: "#f8fafc",
      panel: "#f6f7fb",
      rowHover: "#eef6ff",
      text: "#111827",
      textSecondary: "#374151",
      textMuted: "#64748b",
      border: "#cbd5e1",
      borderStrong: "#94a3b8",
      note: "#fff7ed"
    };

const readCssVar = (style: CSSStyleDeclaration, names: readonly string[], fallback: string): string => {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value.length > 0) return value;
  }
  return fallback;
};

const readLyraMermaidColors = (): LyraMermaidColors => {
  if (typeof window === "undefined") {
    return fallbackMermaidColors("light");
  }
  const root = document.documentElement;
  const style = window.getComputedStyle(root);
  const tone: LyraMermaidTone =
    root.dataset.lyraThemeTone === "dark" ||
    root.classList.contains("dark") ||
    style.colorScheme === "dark"
      ? "dark"
      : "light";
  const fallback = fallbackMermaidColors(tone);
  return {
    tone,
    surface: readCssVar(style, ["--lyra-app-surface-bg", "--color-fd-card", "--color-fd-background"], fallback.surface),
    surfaceStrong: readCssVar(style, ["--lyra-app-surface-strong-bg", "--color-fd-muted"], fallback.surfaceStrong),
    panel: readCssVar(style, ["--lyra-app-panel-bg", "--color-fd-background"], fallback.panel),
    rowHover: readCssVar(style, ["--lyra-app-row-hover-bg", "--color-fd-accent"], fallback.rowHover),
    text: readCssVar(style, ["--lyra-text-primary", "--color-fd-foreground"], fallback.text),
    textSecondary: readCssVar(style, ["--lyra-text-secondary", "--color-fd-muted-foreground"], fallback.textSecondary),
    textMuted: readCssVar(style, ["--lyra-text-muted", "--color-fd-muted-foreground"], fallback.textMuted),
    border: readCssVar(style, ["--lyra-app-border", "--color-fd-border"], fallback.border),
    borderStrong: readCssVar(style, ["--lyra-app-border-strong", "--color-fd-border"], fallback.borderStrong),
    note: fallback.note
  };
};

const createLyraMermaidConfig = (colors: LyraMermaidColors) => ({
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

type LyraMermaidTheme = {
  readonly config: ReturnType<typeof createLyraMermaidConfig>;
  readonly signature: string;
};

const readLyraMermaidTheme = (): LyraMermaidTheme => {
  const colors = readLyraMermaidColors();
  return {
    config: createLyraMermaidConfig(colors),
    signature: JSON.stringify({ version: 2, colors })
  };
};

const useLyraMermaidTheme = (): LyraMermaidTheme => {
  const [theme, setTheme] = useState(readLyraMermaidTheme);

  useEffect(() => {
    const update = () => {
      const next = readLyraMermaidTheme();
      setTheme((current) => current.signature === next.signature ? current : next);
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-lyra-theme-tone", "data-lyra-window-material"]
    });

    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
    media?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", update);
    };
  }, []);

  return theme;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const showMermaidSource = (element: HTMLElement, source: string): void => {
  element.innerHTML = `<pre class="lyra-markdown-mermaid-source"><code>${escapeHtml(source)}</code></pre>`;
};

const showMermaidSvg = (element: HTMLElement, svg: string): void => {
  element.innerHTML = svg;
  element.classList.remove("lyra-markdown-mermaid-error");
  element.classList.add("lyra-markdown-mermaid-rendered");
};

const scheduleIdle = (callback: () => void): (() => void) => {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout: 1_500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(id);
};

function LazyMermaid({
  jobs,
  rootRef,
  theme
}: {
  readonly jobs: readonly MermaidRenderJob[];
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly theme: LyraMermaidTheme;
}) {
  useEffect(() => {
    if (jobs.length === 0) return;
    const root = rootRef.current;
    if (root === null) return;

    let disposed = false;
    const cleanupTasks: Array<() => void> = [];
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const renderedIds = new Set<string>();

    const renderElement = (element: HTMLElement, job: MermaidRenderJob) => {
      if (renderedIds.has(job.id)) return;
      renderedIds.add(job.id);
      const cacheKey = `${job.sourceHash}:${theme.signature}`;
      const cached = mermaidSvgCache.get(cacheKey);
      if (cached !== undefined) {
        showMermaidSvg(element, cached);
        return;
      }

      const cancelIdle = scheduleIdle(() => {
        void import("mermaid")
          .then(async ({ default: mermaid }) => {
            if (disposed) return;
            if (mermaidInitializeSignature !== theme.signature) {
              mermaid.initialize(theme.config);
              mermaidInitializeSignature = theme.signature;
            }
            const rendered = await mermaid.render(`lyra-docs-${job.id}`, job.source);
            if (disposed) return;
            const svg = sanitizeMermaidSvg(rendered.svg);
            mermaidSvgCache.set(cacheKey, svg);
            showMermaidSvg(element, svg);
          })
          .catch(() => {
            element.classList.remove("lyra-markdown-mermaid-rendered");
            element.classList.add("lyra-markdown-mermaid-error");
            showMermaidSource(element, job.source);
          });
      });
      cleanupTasks.push(cancelIdle);
    };

    const elements = [...root.querySelectorAll<HTMLElement>("[data-mermaid-id]")];
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          const jobId = element.dataset.mermaidId;
          const job = jobId === undefined ? undefined : jobsById.get(jobId);
          if (job !== undefined) {
            observer.unobserve(element);
            renderElement(element, job);
          }
        }
      }, { rootMargin: "240px" });
      for (const element of elements) observer.observe(element);
      cleanupTasks.push(() => observer.disconnect());
    } else {
      for (const element of elements) {
        const jobId = element.dataset.mermaidId;
        const job = jobId === undefined ? undefined : jobsById.get(jobId);
        if (job !== undefined) renderElement(element, job);
      }
    }

    return () => {
      disposed = true;
      for (const cleanup of cleanupTasks) cleanup();
    };
  }, [jobs, rootRef, theme]);

  return null;
}

export function LyraDocument({ content }: { readonly content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mermaidTheme = useLyraMermaidTheme();
  const rendered = useMemo(() => renderMarkdown(content, { mode: "final" }), [content]);

  if (rendered.html.trim().length === 0 && content.trim().length > 0) {
    return <PlainDocumentText content={content} />;
  }

  return (
    <>
      <div
        ref={rootRef}
        className="lyra-docs-rich-document"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
      <LazyMermaid jobs={rendered.mermaidJobs} rootRef={rootRef} theme={mermaidTheme} />
    </>
  );
}
