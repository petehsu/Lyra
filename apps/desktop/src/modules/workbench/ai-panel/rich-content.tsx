import DOMPurify from "dompurify";
import { Check, ExternalLink, RotateCcw, X } from "lucide-react";
import { marked } from "marked";
import { memo, useEffect, useMemo, useRef } from "react";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type AiPanelRichContentProps = {
  readonly locale?: WorkbenchLocale;
  readonly content: string;
  readonly themeSignature?: string;
  readonly planActions?: {
    readonly onApprove?: () => void;
    readonly onKeepPlanning?: () => void;
    readonly onReject?: () => void;
    readonly onOpenInPanel?: () => void;
  };
};

type CompiledRichContent = {
  readonly html: string;
  readonly mermaidBlocks: readonly string[];
};

const MERMAID_BLOCK_PATTERN = /```mermaid[^\n]*\n([\s\S]*?)```/gi;
const PROPOSED_PLAN_PATTERN = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/gi;
const MONO_FONT_FAMILY = "\"JetBrains Mono\", \"SF Mono\", Menlo, monospace";

const FALLBACK_LIGHT = {
  textPrimary: "#20242b",
  textSecondary: "#4e5a6b",
  bgSurface: "#f7f9fc",
  bgPanel: "#eef2f7",
  bgEditor: "#ffffff",
  lineDefault: "#b9c4d3",
  lineFocused: "#4d88ff"
};

const FALLBACK_DARK = {
  textPrimary: "#d4d7dd",
  textSecondary: "#9aa4b2",
  bgSurface: "#171b23",
  bgPanel: "#212734",
  bgEditor: "#0e1218",
  lineDefault: "#4d5767",
  lineFocused: "#7aa2ff"
};

const readThemeTone = (): "light" | "dark" => {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.dataset.lyraThemeTone === "light"
    ? "light"
    : "dark";
};

const readCssVariable = (
  style: CSSStyleDeclaration,
  name: `--${string}`,
  fallback: string
): string => {
  const value = style.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
};

const resolveMermaidThemeConfig = (): {
  readonly theme: "base";
  readonly darkMode: boolean;
  readonly themeVariables: Record<string, string | number>;
} => {
  const tone = readThemeTone();
  const fallback = tone === "light" ? FALLBACK_LIGHT : FALLBACK_DARK;
  if (typeof window === "undefined") {
    return {
      theme: "base",
      darkMode: tone === "dark",
      themeVariables: {
        fontFamily: MONO_FONT_FAMILY,
        primaryColor: fallback.bgPanel,
        primaryTextColor: fallback.textPrimary,
        primaryBorderColor: fallback.lineFocused,
        lineColor: fallback.lineDefault,
        textColor: fallback.textPrimary,
        mainBkg: fallback.bgSurface,
        secondBkg: fallback.bgPanel,
        tertiaryBkg: fallback.bgEditor
      }
    };
  }

  const style = window.getComputedStyle(document.documentElement);
  const textPrimary = readCssVariable(style, "--lyra-text-primary", fallback.textPrimary);
  const textSecondary = readCssVariable(style, "--lyra-text-secondary", fallback.textSecondary);
  const bgSurface = readCssVariable(style, "--lyra-bg-surface", fallback.bgSurface);
  const bgPanel = readCssVariable(style, "--lyra-bg-panel", fallback.bgPanel);
  const bgEditor = readCssVariable(style, "--lyra-bg-editor", fallback.bgEditor);
  const lineDefault = readCssVariable(style, "--lyra-line-default", fallback.lineDefault);
  const lineFocused = readCssVariable(style, "--lyra-line-focused", fallback.lineFocused);

  return {
    theme: "base",
    darkMode: tone === "dark",
      themeVariables: {
        fontFamily: MONO_FONT_FAMILY,
        fontSize: "var(--lyra-text-size-meta)",
        primaryColor: bgPanel,
      secondaryColor: bgSurface,
      tertiaryColor: bgEditor,
      primaryTextColor: textPrimary,
      secondaryTextColor: textPrimary,
      tertiaryTextColor: textPrimary,
      primaryBorderColor: lineFocused,
      lineColor: lineDefault,
      textColor: textPrimary,
      nodeTextColor: textPrimary,
      labelTextColor: textSecondary,
      background: bgSurface,
      mainBkg: bgSurface,
      secondBkg: bgPanel,
      tertiaryBkg: bgEditor,
      clusterBkg: bgPanel,
      clusterBorder: lineDefault,
      defaultLinkColor: lineFocused,
      titleColor: textPrimary,
      edgeLabelBackground: bgSurface,
      actorBkg: bgPanel,
      actorBorder: lineDefault,
      actorTextColor: textPrimary,
      noteBkgColor: bgPanel,
      noteBorderColor: lineDefault,
      noteTextColor: textPrimary,
      activationBorderColor: lineDefault,
      activationBkgColor: bgSurface,
      sequenceNumberColor: textPrimary
    }
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const sanitizeHtml = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "class", "data-lyra-mermaid-index"]
  });

const compileRichContent = (
  content: string,
  options: { readonly proposedPlanTitle: string }
): CompiledRichContent => {
  const mermaidBlocks: string[] = [];
  const withPlanBlocks = content.replace(PROPOSED_PLAN_PATTERN, (_match, body: string) => {
    return `\n<div class="lyra-ai-proposed-plan"><div class="lyra-ai-proposed-plan__header">${escapeHtml(options.proposedPlanTitle)}</div><pre class="lyra-ai-proposed-plan__body">${escapeHtml(body.trim())}</pre></div>\n`;
  });
  const markdown = withPlanBlocks.replace(MERMAID_BLOCK_PATTERN, (_match, code: string) => {
    const blockIndex = mermaidBlocks.push(code.trim()) - 1;
    return `\n<div class="lyra-ai-mermaid lyra-ai-mermaid-loading" data-lyra-mermaid-index="${String(blockIndex)}"><div class="lyra-ai-mermaid-skeleton"></div></div>\n`;
  });
  const parsed = marked.parse(markdown, {
    gfm: true,
    breaks: true
  });
  const html = typeof parsed === "string" ? parsed : "";

  return {
    html: sanitizeHtml(html),
    mermaidBlocks
  };
};

export const AiPanelRichContent = memo(({
  locale = "en-US",
  content,
  themeSignature,
  planActions
}: AiPanelRichContentProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const containerRef = useRef<HTMLDivElement>(null);
  const compiled = useMemo(
    () =>
      compileRichContent(content, {
        proposedPlanTitle: t("ai.proposedPlanTitle")
      }),
    [content, t]
  );
  const hasProposedPlan = useMemo(
    () => /<proposed_plan>[\s\S]*?<\/proposed_plan>/i.test(content),
    [content]
  );

  useEffect(() => {
    const root = containerRef.current;
    if (root === null) {
      return;
    }
    const anchors = root.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const anchor of anchors) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
  }, [compiled.html]);

  useEffect(() => {
    const root = containerRef.current;
    if (root === null || compiled.mermaidBlocks.length === 0) {
      return;
    }
    const placeholders = [...root.querySelectorAll<HTMLElement>("[data-lyra-mermaid-index]")];
    if (placeholders.length === 0) {
      return;
    }

    let disposed = false;

    const renderMermaid = async (): Promise<void> => {
      try {
        const mermaidModule = await import("mermaid");
        if (disposed) {
          return;
        }
        const mermaid = mermaidModule.default;
        const themeConfig = resolveMermaidThemeConfig();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          ...themeConfig
        });

        let renderIndex = 0;
        for (const placeholder of placeholders) {
          if (disposed) {
            return;
          }
          const blockIndex = Number.parseInt(placeholder.dataset.lyraMermaidIndex ?? "", 10);
          if (!Number.isFinite(blockIndex)) {
            continue;
          }
          const source = compiled.mermaidBlocks[blockIndex];
          if (source === undefined || source.length === 0) {
            continue;
          }
          try {
            const id = `lyra-ai-mermaid-${String(Date.now())}-${String(renderIndex)}`;
            const rendered = await mermaid.render(id, source);
            if (disposed) {
              return;
            }
            placeholder.classList.remove("lyra-ai-mermaid-loading");
            placeholder.classList.add("lyra-ai-mermaid-rendered", "lyra-ai-mermaid-ready");
            placeholder.innerHTML = rendered.svg;
          } catch (error) {
            if (disposed) {
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            placeholder.classList.remove("lyra-ai-mermaid-loading");
            placeholder.innerHTML = `<pre class="lyra-ai-mermaid-error">${escapeHtml(message)}</pre>`;
          }
          renderIndex += 1;
        }
      } catch {
        for (const placeholder of placeholders) {
          const blockIndex = Number.parseInt(placeholder.dataset.lyraMermaidIndex ?? "", 10);
          if (!Number.isFinite(blockIndex)) {
            continue;
          }
          const source = compiled.mermaidBlocks[blockIndex];
          if (source === undefined || source.length === 0) {
            continue;
          }
          placeholder.classList.remove("lyra-ai-mermaid-loading");
          placeholder.innerHTML = `<pre class="lyra-ai-mermaid-error">${escapeHtml(source)}</pre>`;
        }
      }
    };

    void renderMermaid();

    return () => {
      disposed = true;
    };
  }, [compiled, themeSignature]);

  return (
    <>
      <div
        ref={containerRef}
        className="lyra-ai-rich-content lyra-ai-agent-message-content lyra-ai-agent-message-content-rich"
        dangerouslySetInnerHTML={{ __html: compiled.html }}
      />
      {hasProposedPlan && planActions !== undefined ? (
        <div className="lyra-ai-proposed-plan__actions">
          {planActions.onApprove === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-proposed-plan__action lyra-ai-proposed-plan__action-primary"
              aria-label={t("ai.planApprovalApproveAndImplement")}
              title={t("ai.planApprovalApproveAndImplement")}
              onClick={planActions.onApprove}
            >
              <Check size={14} aria-hidden="true" />
            </button>
          )}
          {planActions.onKeepPlanning === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-proposed-plan__action lyra-ai-proposed-plan__action-secondary"
              aria-label={t("ai.planApprovalKeepPlanning")}
              title={t("ai.planApprovalKeepPlanning")}
              onClick={planActions.onKeepPlanning}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          )}
          {planActions.onOpenInPanel === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-proposed-plan__action lyra-ai-proposed-plan__action-primary"
              aria-label={t("ai.proposedPlanOpenInPanel")}
              title={t("ai.proposedPlanOpenInPanel")}
              onClick={planActions.onOpenInPanel}
            >
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          )}
          {planActions.onReject === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-proposed-plan__action lyra-ai-proposed-plan__action-danger"
              aria-label={t("ai.proposedPlanReject")}
              title={t("ai.proposedPlanReject")}
              onClick={planActions.onReject}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}
    </>
  );
});

AiPanelRichContent.displayName = "AiPanelRichContent";
