import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type {
  ToolDetails as ToolDetailsType,
  ToolActionTarget,
  RenderSurfaceColumn,
  RenderSurfaceRow,
  WorkbenchTabSummary
} from "../../core/types";
import { ChevronIcon } from "../../components/Icons";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { TickingNumber } from "../../components/TickingNumber";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";
import { t } from "../../core/i18n";
import { useData } from "../../data/DataProvider";
import {
  ActionTargetList,
  ActionText,
  ClickableImage,
  isImageFileReference
} from "../rich-text/ActionTargets";
import { RichText } from "../rich-text";
import { ToolPeekStrip } from "./ToolPeek";

/**
 * Level-3 renderer. Rendered inline without surrounding borders or panels so
 * it reads as a continuation of the message, not a nested card.
 */
export function ToolDetails({ details }: { details: ToolDetailsType }) {
  switch (details.type) {
    case "edit":
      return <EditCard details={details} />;
    case "read":
      return <ReadCard details={details} />;
    case "search":
      return <SearchCard details={details} />;
    case "shell":
      return <ShellCard details={details} />;
    case "terminal":
      return <TerminalCard details={details} />;
    case "web":
      return <WebCard details={details} />;
    case "workbench":
      return <WorkbenchCard details={details} />;
    case "lumen":
      return <LumenCard details={details} />;
    case "software":
      return <SoftwareCard details={details} />;
    case "render":
      return <RenderSurfaceCard details={details} />;
    case "task":
      return <TaskCard details={details} />;
    case "text":
      return (
        <p className="tool-details-text">
          <ActionText text={details.body} />
        </p>
      );
    case "ask":
      return <AskCard details={details} />;
  }
}

function LumenCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "lumen" }>;
}) {
  const visibleTargets = details.screenshot === undefined
    ? details.targets
    : details.targets?.filter((target) => !isImageActionTarget(target));

  return (
    <div className="info-block lumen-card">
      <ToolPeekStrip peek={details.peek} className="lumen-card-peek" />
      {details.screenshot && (
        <div className="tool-screenshot-container">
          <ClickableImage
            src={details.screenshot}
            alt="Lyra Lumen snapshot"
            image={details.screenshotImage}
            className="tool-screenshot-img"
            allowTargetFallback={false}
          />
        </div>
      )}
      <ActionTargetList targets={visibleTargets} />
      {details.text && (
        <pre className="info-pre lumen-output">
          {details.text}
        </pre>
      )}
    </div>
  );
}

function RenderSurfaceCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "render" }>;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const srcDoc = useMemo(() => {
    if (details.format === "svg") {
      return renderSurfaceDocument(details, svgShell(details.content, details.title));
    }
    if (details.format === "html") {
      return renderSurfaceDocument(details, details.content);
    }
    return "";
  }, [details]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const payload = event.data as unknown;
      if (payload === null || typeof payload !== "object") return;
      const record = payload as Record<string, unknown>;
      if (record.type !== "lyra.surface.event") return;
      setLastEvent(summarizeSurfaceEvent(record.payload));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="render-surface">
      <div className="render-surface-header">
        <div className="render-surface-title">
          <span>{details.title}</span>
          <span className="render-surface-format">{details.format}</span>
        </div>
        <div className="render-surface-meta">
          <span>{details.operation}</span>
          <span>{details.surfaceId}</span>
        </div>
      </div>
      {details.summary ? (
        <p className="render-surface-summary">
          <ActionText text={details.summary} />
        </p>
      ) : null}
      {details.format === "html" || details.format === "svg" ? (
        <iframe
          ref={iframeRef}
          className="render-surface-frame"
          sandbox="allow-forms allow-pointer-lock allow-popups allow-scripts"
          referrerPolicy="no-referrer"
          title={details.title}
          srcDoc={srcDoc}
          style={{ height: `${details.height}px` }}
        />
      ) : details.format === "markdown" ? (
        <div className="render-surface-markdown">
          <RichText content={details.content} />
        </div>
      ) : details.format === "table" ? (
        <RenderSurfaceTable columns={details.columns} rows={details.rows} />
      ) : details.format === "json" ? (
        <pre className="render-surface-json">
          {renderJsonSurface(details.data ?? details.content)}
        </pre>
      ) : (
        <pre className="render-surface-text">
          <ActionText text={details.content} />
        </pre>
      )}
      <div className="render-surface-footer">
        <span>{details.interactive ? "Interactive sandbox" : "Static surface"}</span>
        {details.security?.node === false ? <span>No Node</span> : null}
        {lastEvent ? <span className="render-surface-event">{lastEvent}</span> : null}
      </div>
    </div>
  );
}

function RenderSurfaceTable({
  columns,
  rows,
}: {
  columns: readonly RenderSurfaceColumn[] | undefined;
  rows: readonly RenderSurfaceRow[] | undefined;
}) {
  const safeRows = rows ?? [];
  const safeColumns = columns ?? inferSurfaceColumns(safeRows);
  if (safeColumns.length === 0 || safeRows.length === 0) {
    return <div className="render-surface-empty">No table data</div>;
  }
  return (
    <div className="render-surface-table-wrap">
      <table className="render-surface-table">
        <thead>
          <tr>
            {safeColumns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {safeColumns.map((column, columnIndex) => (
                <td key={column.key}>
                  {renderSurfaceCell(row, column.key, columnIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inferSurfaceColumns(rows: readonly RenderSurfaceRow[]): RenderSurfaceColumn[] {
  const first = rows[0];
  if (first === undefined) return [];
  if (Array.isArray(first)) {
    return first.map((_, index) => ({
      key: String(index),
      label: `Column ${index + 1}`,
    }));
  }
  return Object.keys(first).map((key) => ({ key, label: key }));
}

function renderSurfaceCell(row: RenderSurfaceRow, key: string, index: number): string {
  const value = Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function renderJsonSurface(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value) as unknown, null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function renderSurfaceDocument(
  details: Extract<ToolDetailsType, { type: "render" }>,
  body: string
): string {
  const colorScheme = details.theme === "light" ? "light" : details.theme === "dark" ? "dark" : "light dark";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: ${escapeHtml(colorScheme)}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
html, body { margin: 0; min-height: 100%; background: transparent; color: CanvasText; }
body { padding: 14px; overflow: auto; }
* { box-sizing: border-box; }
a { color: #5da8ff; }
button, input, select, textarea { font: inherit; }
</style>
<script>
window.lyraSurface = {
  emit: function(payload) {
    window.parent.postMessage({ type: 'lyra.surface.event', payload: payload }, '*');
  }
};
document.addEventListener('click', function(event) {
  var target = event.target && event.target.closest ? event.target.closest('button,a,input,select,textarea,[data-lyra-action]') : null;
  if (!target) return;
  window.lyraSurface.emit({
    kind: 'interaction',
    tag: target.tagName,
    text: (target.innerText || target.value || target.getAttribute('aria-label') || '').slice(0, 120),
    action: target.getAttribute('data-lyra-action') || null
  });
}, true);
</script>
</head>
<body data-lyra-surface-id="${escapeHtml(details.surfaceId)}">
${body}
</body>
</html>`;
}

function svgShell(svg: string, title: string): string {
  return `<main aria-label="${escapeHtml(title)}" style="min-height:100%;display:grid;place-items:center">${svg}</main>`;
}

function summarizeSurfaceEvent(value: unknown): string {
  if (value === null || typeof value !== "object") return "Surface event";
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : "event";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  return text.length === 0 ? kind : `${kind}: ${text}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const isImageActionTarget = (target: ToolActionTarget): boolean => {
  if ((target.mediaType ?? "").toLowerCase().startsWith("image/")) {
    return true;
  }
  return isImageFileReference(target.value);
};

function SoftwareCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "software" }>;
}) {
  return (
    <div className="info-block">
      <ActionTargetList targets={details.targets} />
      {details.softwareId || details.actionId ? (
        <div className="info-line">
          {details.softwareId ? <span className="info-dim">{details.softwareId}</span> : null}
          {details.actionId ? <span className="info-strong">{details.actionId}</span> : null}
        </div>
      ) : null}
      {details.text ? (
        <pre className="info-pre">
          {details.text}
        </pre>
      ) : null}
    </div>
  );
}

function EditCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "edit" }>;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const anchorVisible = useFoldAnchorVisible(anchorRef);
  return (
    <div className={`edit-card ${open ? "open" : ""}`}>
      <button
        type="button"
        className="edit-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span ref={anchorRef} className="icon-swap">
          <span className="icon-swap-tool">
            <FileTypeIcon filename={details.file} />
          </span>
          <span className="icon-swap-chevron">
            <ChevronIcon open={open} />
          </span>
        </span>
        <span className="edit-card-file">{details.file}</span>
        <span className="edit-card-stats">
          <span className="diff-add">
            +<TickingNumber value={details.additions} direction="up" />
          </span>
          <span className="diff-del">
            -<TickingNumber value={details.deletions} direction="down" />
          </span>
        </span>
      </button>

      {open && !anchorVisible && (
        <button
          type="button"
          className="fold-line fold-line-edit"
          onClick={() => setOpen(false)}
          aria-label={t("tool.collapseEditDetails")}
        />
      )}

      <div className="collapse" data-open={open}>
        <div className="collapse-inner">
          <div className="edit-card-body">
            {details.hunks.map((hunk, i) => (
              <div key={i} className="diff-hunk">
                {hunk.lines.map((line, j) => {
                  const lineNumber = hunk.startLine + j;
                  return (
                    <div
                      key={j}
                      className={`diff-line diff-line-${line.kind} stagger-item`}
                      style={{ "--stagger-index": j } as React.CSSProperties}
                    >
                      <span className="diff-gutter">{lineNumber}</span>
                      <span className="diff-sign">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                      </span>
                      <span className="diff-text">{line.text || "\u00A0"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "read" }>;
}) {
  return (
    <div className="info-block">
      <div className="info-line">
        <FileTypeIcon filename={details.file} />
        <FileOpenButton filePath={details.file} className="info-strong info-file-button">
          {details.file}
        </FileOpenButton>
        {details.range && <span className="info-dim">:{details.range}</span>}
      </div>
      {details.preview && (
        <pre className="info-pre">
          <ActionText text={details.preview} />
        </pre>
      )}
    </div>
  );
}

function SearchCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "search" }>;
}) {
  return (
    <div className="info-block">
      <div className="info-line">
        <span className="info-dim">query</span>
        <span className="info-strong">{details.query}</span>
      </div>
      <div className="search-results">
        {details.results.map((r, i) => (
          <div key={i} className="search-row">
            <FileOpenButton filePath={`${r.file}:${r.line}`} className="info-dim search-path-button">
              {r.file}:{r.line}
            </FileOpenButton>
            <span className="search-text">
              <ActionText text={r.text} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShellCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "shell" }>;
}) {
  return (
    <div className="info-block">
      <div className="shell-command">
        <span className="shell-prompt">$</span>
        <span>
          <ActionText text={details.command} />
        </span>
      </div>
      <pre className="info-pre">
        <ActionText text={details.output} />
      </pre>
      <div className="info-dim shell-exit">exit {details.exitCode}</div>
    </div>
  );
}

function TerminalCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "terminal" }>;
}) {
  const targetLabel =
    details.target === "ui" ? "ui terminal" : details.target === "list" ? "terminals" : "private terminal";
  const summary = details.command ?? details.wrote ?? details.sessionId ?? details.action;
  return (
    <div className="info-block terminal-card">
      <div className="info-line">
        <span className="info-dim">target</span>
        <span className="info-strong">{targetLabel}</span>
        {details.reason ? <span className="info-dim">reason {details.reason}</span> : null}
      </div>
      {summary ? (
        <div className="shell-command">
          <span className="shell-prompt">$</span>
          <span>
            <ActionText text={summary} />
          </span>
        </div>
      ) : null}
      {details.output.trim().length > 0 ? (
        <pre className="info-pre">
          <ActionText text={details.output} />
        </pre>
      ) : null}
      <div className="info-dim shell-exit">
        running {details.running ? "true" : "false"} - exit {details.exitCode ?? "null"}
        {details.truncated ? " - truncated" : ""}
      </div>
    </div>
  );
}

function WebCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "web" }>;
}) {
  const { openUrlInWorkbench } = useData();
  const results = details.results ?? [];

  const openResult = (url: string, title?: string) => {
    void openUrlInWorkbench(url, title).catch(() => undefined);
  };

  return (
    <div className="info-block">
      {results.length > 0 ? (
        <>
          <div className="info-line">
            <span className="info-dim">query</span>
            <span className="info-strong">{details.query ?? details.url}</span>
          </div>
          <div className="web-results">
            {results.map((result, index) => (
              <div key={`${result.url}-${index}`} className="web-result-row">
                <span className="web-result-index">{index + 1}</span>
                <div className="web-result-main">
                  <button
                    type="button"
                    className="web-result-title"
                    title={result.url}
                    onClick={() => openResult(result.url, result.title)}
                  >
                    <span>{result.title}</span>
                    <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
                  </button>
                  <div className="web-result-url">{webResultHost(result.url)}</div>
                  {result.snippet && (
                    <p className="web-result-snippet">{result.snippet}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="info-line">
            <span className="info-dim">URL</span>
            <button
              type="button"
              className="web-url-button"
              title={details.url}
              onClick={() => openResult(details.url, details.title ?? details.url)}
            >
              <span>{details.url}</span>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          {details.title && <div className="web-fetch-title">{details.title}</div>}
          {typeof details.fetchedBytes === "number" && details.fetchedBytes > 0 ? (
            <div className="info-dim">{details.fetchedBytes.toLocaleString()} bytes</div>
          ) : null}
        </>
      )}
      {details.summary && (
        <p className={results.length > 0 ? "tool-details-text" : "web-fetch-preview"}>
          <ActionText text={details.summary} />
        </p>
      )}
      {details.screenshot && (
        <div className="tool-screenshot-container">
          <ClickableImage
            src={details.screenshot}
            alt="Browser Screenshot"
            className="tool-screenshot-img"
          />
        </div>
      )}
    </div>
  );
}

function WorkbenchCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "workbench" }>;
}) {
  const { openUrlInWorkbench } = useData();
  const tabs = details.tabs ?? (details.tab === undefined ? [] : [details.tab]);

  const openTabUrl = (tab: WorkbenchTabSummary) => {
    if (tab.url === undefined) return;
    void openUrlInWorkbench(tab.url, tab.title).catch(() => undefined);
  };

  return (
    <div className="info-block workbench-card">
      <div className="workbench-card-summary">
        <span className="workbench-action-label">{details.label}</span>
        {tabs.length > 0 && (
          <span className="info-dim">
            {tabs.length === 1 ? "1 tab" : `${tabs.length} tabs`}
          </span>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="workbench-tab-list">
          {tabs.map((tab) => (
            <WorkbenchTabRow
              key={`${tab.tabId}-${tab.url ?? tab.title}`}
              tab={tab}
              onOpen={() => openTabUrl(tab)}
            />
          ))}
        </div>
      )}

      {details.excerpt && (
        <pre className="workbench-tab-excerpt">
          <ActionText text={details.excerpt} />
        </pre>
      )}
      {details.text && (
        <pre className="workbench-tab-excerpt">
          <ActionText text={details.text} />
        </pre>
      )}
    </div>
  );
}

function WorkbenchTabRow({
  tab,
  onOpen
}: {
  tab: WorkbenchTabSummary;
  onOpen: () => void;
}) {
  const hasUrl = tab.url !== undefined;
  return (
    <div className="workbench-tab-row">
      <span
        className="workbench-tab-state"
        data-active={tab.flags.includes("active")}
        aria-hidden
      />
      <div className="workbench-tab-main">
        <div className="workbench-tab-title-row">
          {hasUrl ? (
            <button
              type="button"
              className="workbench-tab-title"
              title={tab.url}
              onClick={onOpen}
            >
              <span>{tab.title}</span>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </button>
          ) : (
            <span className="workbench-tab-title-static">{tab.title}</span>
          )}
        </div>
        <div className="workbench-tab-meta">
          <span>{tab.tabId}</span>
          <span>{tab.kind}</span>
          {tab.observationKind && <span>{tab.observationKind}</span>}
        </div>
        {tab.flags.length > 0 && (
          <div className="workbench-tab-flags">
            {tab.flags.map((flag) => (
              <span key={flag} className="workbench-tab-flag">
                {flag}
              </span>
            ))}
          </div>
        )}
        {tab.url && <div className="workbench-tab-url">{webResultHost(tab.url)}</div>}
        {tab.excerpt && (
          <p className="workbench-tab-preview">
            <ActionText text={tab.excerpt} />
          </p>
        )}
      </div>
    </div>
  );
}

function FileOpenButton({
  filePath,
  className,
  children
}: {
  readonly filePath: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const { openFileInWorkbench } = useData();
  return (
    <button
      type="button"
      className={className}
      title={filePath}
      onClick={() => {
        void openFileInWorkbench(filePath).catch(() => undefined);
      }}
    >
      {children}
    </button>
  );
}

function webResultHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

function TaskCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "task" }>;
}) {
  return (
    <div className="task-card">
      <div className="task-card-head">Execution plan</div>
      <ul className="task-list">
        {details.tasks.map((t, i) => (
          <li key={i} className={`task-item status-${t.status}`}>
            <span className={t.status === "running" ? "shimmer" : ""}>
              {t.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AskCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "ask" }>;
}) {
  return (
    <div className="ask-card">
      <div className="ask-question">{details.question}</div>
      <div className="ask-answer">{details.answer}</div>
    </div>
  );
}
