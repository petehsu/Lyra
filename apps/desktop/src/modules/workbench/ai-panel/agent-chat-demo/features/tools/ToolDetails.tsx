import { useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type {
  ToolDetails as ToolDetailsType,
  WorkbenchTabSummary
} from "../../core/types";
import { ChevronIcon } from "../../components/Icons";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { TickingNumber } from "../../components/TickingNumber";
import { useFoldAnchorVisible } from "../../hooks/useFoldAnchorVisible";
import { t } from "../../core/i18n";
import { useData } from "../../data/DataProvider";
import { ActionText, ClickableImage } from "../rich-text/ActionTargets";
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
    case "web":
      return <WebCard details={details} />;
    case "workbench":
      return <WorkbenchCard details={details} />;
    case "lumen":
      return <LumenCard details={details} />;
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
  return (
    <div className="info-block lumen-card">
      <ToolPeekStrip peek={details.peek} className="lumen-card-peek" />
      {details.screenshot && (
        <div className="tool-screenshot-container">
          <ClickableImage
            src={details.screenshot}
            alt="Lyra Lumen snapshot"
            className="tool-screenshot-img"
          />
        </div>
      )}
      {details.text && (
        <pre className="info-pre lumen-output">
          <ActionText text={details.text} />
        </pre>
      )}
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
