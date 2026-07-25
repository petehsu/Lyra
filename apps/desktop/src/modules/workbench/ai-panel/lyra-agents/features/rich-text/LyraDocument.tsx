import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject
} from "react";
import { renderMarkdown, sanitizeMermaidSvg, type MermaidRenderJob } from "@lyra/markdown-render";
import { useCodeBlockHighlight } from "./use-code-block-highlight";

import { useData } from "../../data/DataProvider";
import {
  classifyActionTarget,
  imageAttachmentFromDataUrl,
  isFileOpenTarget
} from "./ActionTargets";
import { knownFaviconUrlForUrl } from "../chat/web-link";
import { mountWebsiteLinkIcon } from "../chat/page-citation-tab-icon";

export function PlainAgentText({ content }: { readonly content: string }) {
  return <div className="lyra-agents-plain-text">{content}</div>;
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
            const rendered = await mermaid.render(`lyra-${job.id}`, job.source);
            if (disposed) return;
            const svg = sanitizeMermaidSvg(rendered.svg);
            mermaidSvgCache.set(cacheKey, svg);
            showMermaidSvg(element, svg);
          })
          .catch((error: unknown) => {
            if (import.meta.env.DEV) {
              console.warn("[lyra-markdown] mermaid render failed:", error);
            }
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
      for (const element of elements) {
        observer.observe(element);
      }
      cleanupTasks.push(() => observer.disconnect());
    } else {
      for (const element of elements) {
        const jobId = element.dataset.mermaidId;
        const job = jobId === undefined ? undefined : jobsById.get(jobId);
        if (job !== undefined) {
          renderElement(element, job);
        }
      }
    }

    return () => {
      disposed = true;
      for (const cleanup of cleanupTasks) cleanup();
    };
  }, [jobs, rootRef, theme]);

  return null;
}

const MARKDOWN_STREAM_BATCH_MS = 40;

function useBatchedMarkdownContent(content: string, streaming: boolean): string {
  const [renderedContent, setRenderedContent] = useState(content);
  const latestRef = useRef(content);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    latestRef.current = content;
    if (!streaming) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setRenderedContent(content);
      return;
    }
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setRenderedContent(latestRef.current);
    }, MARKDOWN_STREAM_BATCH_MS);
  }, [content, streaming]);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  return streaming ? renderedContent : content;
}

export function LyraDocument({
  content,
  streaming = false
}: {
  readonly content: string;
  readonly streaming?: boolean;
}) {
  const {
    aiRichRenderingEnabled,
    openUrlInWorkbench,
    openFileInWorkbench,
    revealPathInWorkbench,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    workspaceTabs
  } = useData();
  const rootRef = useRef<HTMLDivElement>(null);
  const decoratedLinksRef = useRef<Array<{
    readonly iconHost: HTMLElement;
    readonly url: string;
  }>>([]);
  const workspaceTabsRef = useRef(workspaceTabs);
  workspaceTabsRef.current = workspaceTabs;
  const mermaidTheme = useLyraMermaidTheme();
  const renderedContent = useBatchedMarkdownContent(content, streaming);
  const rendered = useMemo(
    () =>
      aiRichRenderingEnabled
        ? renderMarkdown(renderedContent, { mode: streaming ? "streaming" : "final" })
        : null,
    [aiRichRenderingEnabled, renderedContent, streaming]
  );

  useCodeBlockHighlight(rootRef, rendered?.html ?? "", aiRichRenderingEnabled && !streaming);

  useLayoutEffect(() => {
    if (!aiRichRenderingEnabled || streaming) return;
    const root = rootRef.current;
    if (root === null) return;

    const decorated = [...root.querySelectorAll<HTMLAnchorElement>("a.lyra-agents-md-link")]
      .flatMap((anchor) => {
        const target = classifyActionTarget(anchor.getAttribute("href") ?? "");
        if (target?.kind !== "url") return [];
        let url: URL;
        try {
          url = new URL(target.value);
        } catch {
          return [];
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") return [];

        const originalTitle = anchor.getAttribute("title");
        const iconHost = document.createElement("span");
        iconHost.className = "lyra-agents-md-url-link-icon-host";
        const label = document.createElement("span");
        label.className = "lyra-agents-md-url-link-label";
        label.append(...anchor.childNodes);
        anchor.append(iconHost, label);
        anchor.classList.add("lyra-agents-md-url-link");
        anchor.title = url.href;
        const unmountIcon = mountWebsiteLinkIcon(
          iconHost,
          knownFaviconUrlForUrl(url.href, workspaceTabsRef.current),
          12,
          "lyra-agents-md-url-link-icon",
          url.href
        );
        return [{
          anchor,
          iconHost,
          label,
          originalTitle,
          unmountIcon,
          url: url.href
        }];
      });
    decoratedLinksRef.current = decorated;

    return () => {
      if (decoratedLinksRef.current === decorated) {
        decoratedLinksRef.current = [];
      }
      for (const { anchor, iconHost, label, originalTitle, unmountIcon } of decorated) {
        queueMicrotask(unmountIcon);
        if (anchor.contains(iconHost) && anchor.contains(label)) {
          anchor.replaceChildren(...label.childNodes);
          anchor.classList.remove("lyra-agents-md-url-link");
          if (originalTitle === null) {
            anchor.removeAttribute("title");
          } else {
            anchor.title = originalTitle;
          }
        }
      }
    };
  }, [aiRichRenderingEnabled, rendered?.html, streaming]);

  useEffect(() => {
    for (const { iconHost, url } of decoratedLinksRef.current) {
      const faviconUrl = knownFaviconUrlForUrl(url, workspaceTabs);
      if (faviconUrl !== null) {
        mountWebsiteLinkIcon(
          iconHost,
          faviconUrl,
          12,
          "lyra-agents-md-url-link-icon",
          url
        );
      }
    }
  }, [workspaceTabs]);

  if (!aiRichRenderingEnabled) {
    return <PlainAgentText content={renderedContent} />;
  }

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;

    const image = target.closest("img");
    if (
      image instanceof HTMLImageElement
      && rootRef.current?.contains(image) === true
      && image.closest("a.lyra-agents-md-url-link") === null
    ) {
      const src = image.getAttribute("src") ?? image.currentSrc;
      const alt = image.getAttribute("alt") ?? null;
      const attachment = imageAttachmentFromDataUrl(src, alt) ?? {
        id: `markdown-image-${src}`,
        mediaType: "image/png",
        data: "",
        label: alt,
        source: src
      };
      if (canOpenImageInWorkbench(attachment)) {
        event.preventDefault();
        void openImageInWorkbench(attachment);
      }
      return;
    }

    const anchor = target.closest("a");
    if (anchor instanceof HTMLAnchorElement && rootRef.current?.contains(anchor) === true) {
      const href = anchor.getAttribute("href") ?? "";
      const classified = classifyActionTarget(href);
      if (classified !== null) {
        event.preventDefault();
        if (classified.kind === "url") {
          void openUrlInWorkbench(classified.value, anchor.textContent ?? classified.label);
        } else if (isFileOpenTarget(classified)) {
          void openFileInWorkbench(classified.value);
        } else {
          void revealPathInWorkbench(classified.value);
        }
      }
      return;
    }

    const code = target.closest("code");
    if (
      code instanceof HTMLElement &&
      rootRef.current?.contains(code) === true &&
      code.closest("pre") === null
    ) {
      const classified = classifyActionTarget(code.textContent ?? "");
      if (classified === null) return;
      event.preventDefault();
      if (classified.kind === "url") {
        void openUrlInWorkbench(classified.value, classified.label);
      } else if (isFileOpenTarget(classified)) {
        void openFileInWorkbench(classified.value);
      } else {
        void revealPathInWorkbench(classified.value);
      }
    }
  }, [
    canOpenImageInWorkbench,
    openFileInWorkbench,
    openImageInWorkbench,
    openUrlInWorkbench,
    revealPathInWorkbench
  ]);

  return (
    <>
      <div
        ref={rootRef}
        className="lyra-agents-rich-text lyra-agents-markdown-document"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: rendered?.html ?? "" }}
      />
      <LazyMermaid jobs={rendered?.mermaidJobs ?? []} rootRef={rootRef} theme={mermaidTheme} />
    </>
  );
}
