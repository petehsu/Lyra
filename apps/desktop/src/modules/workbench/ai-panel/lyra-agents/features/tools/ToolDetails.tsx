import { useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type {
  ToolDetails as ToolDetailsType,
  ToolActionTarget,
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
import { ToolPeekStrip } from "./ToolPeek";
import { TerminalToolCard } from "./TerminalToolCard";
import { RenderSurfacePreview } from "./RenderSurfacePreview";
import { AppButton } from "@renderer/ui/components";

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
      return <TerminalToolCard details={details} />;
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
        <p className="lyra-agents-tool-details-text">
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
    <div className="lyra-agents-info-block lyra-agents-lumen-card">
      <ToolPeekStrip peek={details.peek} className="lyra-agents-lumen-card-peek" />
      {details.screenshot && (
        <div className="lyra-agents-tool-screenshot-container">
          <ClickableImage
            src={details.screenshot}
            alt="Lyra Lumen snapshot"
            image={details.screenshotImage}
            className="lyra-agents-tool-screenshot-img"
            allowTargetFallback={false}
          />
        </div>
      )}
      <ActionTargetList targets={visibleTargets} />
      {details.text && (
        <pre className="lyra-agents-info-pre lyra-agents-lumen-output">
          {details.text}
        </pre>
      )}
    </div>
  );
}

export function RenderSurfaceCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "render" }>;
}) {
  return (
    <div className="lyra-agents-render-surface">
      <div className="lyra-agents-render-surface-header">
        <div className="lyra-agents-render-surface-title">
          <span>{details.title}</span>
          <span className="lyra-agents-render-surface-format">{details.format}</span>
        </div>
        <div className="lyra-agents-render-surface-meta">
          <span>{details.operation}</span>
          <span>{details.surfaceId}</span>
        </div>
      </div>
      {details.summary ? (
        <p className="lyra-agents-render-surface-summary">
          <ActionText text={details.summary} />
        </p>
      ) : null}
      <RenderSurfacePreview details={details} />
      <div className="lyra-agents-render-surface-footer">
        <span>{details.interactive ? "Interactive sandbox" : "Static surface"}</span>
        {details.security?.node === false ? <span>No Node</span> : null}
        <span>{details.height}px</span>
      </div>
    </div>
  );
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
    <div className="lyra-agents-info-block">
      <ActionTargetList targets={details.targets} />
      {details.softwareId || details.actionId ? (
        <div className="lyra-agents-info-line">
          {details.softwareId ? <span className="lyra-agents-info-dim">{details.softwareId}</span> : null}
          {details.actionId ? <span className="lyra-agents-info-strong">{details.actionId}</span> : null}
        </div>
      ) : null}
      {details.text ? (
        <pre className="lyra-agents-info-pre">
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
    <div className={`lyra-agents-edit-card ${open ? "open" : ""}`}>
      <AppButton variant="ghost" size="sm"
        type="button"
        className="lyra-agents-edit-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span ref={anchorRef} className="lyra-agents-icon-swap">
          <span className="lyra-agents-icon-swap-tool">
            <FileTypeIcon filename={details.file} />
          </span>
          <span className="lyra-agents-icon-swap-chevron">
            <ChevronIcon open={open} />
          </span>
        </span>
        <span className="lyra-agents-edit-card-file">{details.file}</span>
        <span className="lyra-agents-edit-card-stats">
          <span className="lyra-agents-diff-add">
            +<TickingNumber value={details.additions} direction="up" />
          </span>
          <span className="lyra-agents-diff-del">
            -<TickingNumber value={details.deletions} direction="down" />
          </span>
        </span>
      </AppButton>

      {open && !anchorVisible && (
        <AppButton variant="ghost" size="sm"
          type="button"
          className="lyra-agents-fold-line lyra-agents-fold-line-edit"
          onClick={() => setOpen(false)}
          aria-label={t("tool.collapseEditDetails")}
        />
      )}

      <div className="lyra-agents-collapse" data-open={open}>
        <div className="lyra-agents-collapse-inner">
          <div className="lyra-agents-edit-card-body">
            {details.hunks.map((hunk, i) => (
              <div key={i} className="lyra-agents-diff-hunk">
                {hunk.lines.map((line, j) => {
                  const lineNumber = hunk.startLine + j;
                  return (
                    <div
                      key={j}
                      className={`lyra-agents-diff-line diff-line-${line.kind} lyra-agents-stagger-item`}
                      style={{ "--stagger-index": j } as React.CSSProperties}
                    >
                      <span className="lyra-agents-diff-gutter">{lineNumber}</span>
                      <span className="lyra-agents-diff-sign">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                      </span>
                      <span className="lyra-agents-diff-text">{line.text || "\u00A0"}</span>
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
    <div className="lyra-agents-info-block">
      <div className="lyra-agents-info-line">
        <FileTypeIcon filename={details.file} />
        <FileOpenButton filePath={details.file} className="lyra-agents-info-strong lyra-agents-info-file-button">
          {details.file}
        </FileOpenButton>
        {details.range && <span className="lyra-agents-info-dim">:{details.range}</span>}
      </div>
      {details.preview && (
        <pre className="lyra-agents-info-pre">
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
    <div className="lyra-agents-info-block">
      <div className="lyra-agents-info-line">
        <span className="lyra-agents-info-dim">query</span>
        <span className="lyra-agents-info-strong">{details.query}</span>
      </div>
      <div className="lyra-agents-search-results">
        {details.results.map((r, i) => (
          <div key={i} className="lyra-agents-search-row">
            <FileOpenButton filePath={`${r.file}:${r.line}`} className="lyra-agents-info-dim lyra-agents-search-path-button">
              {r.file}:{r.line}
            </FileOpenButton>
            <span className="lyra-agents-search-text">
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
    <div className="lyra-agents-info-block">
      <div className="lyra-agents-shell-command">
        <span className="lyra-agents-shell-prompt">$</span>
        <span>
          <ActionText text={details.command} />
        </span>
      </div>
      <pre className="lyra-agents-info-pre">
        <ActionText text={details.output} />
      </pre>
      <div className="lyra-agents-info-dim lyra-agents-shell-exit">exit {details.exitCode}</div>
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
    <div className="lyra-agents-info-block">
      {results.length > 0 ? (
        <>
          <div className="lyra-agents-info-line">
            <span className="lyra-agents-info-dim">query</span>
            <span className="lyra-agents-info-strong">{details.query ?? details.url}</span>
          </div>
          <div className="lyra-agents-web-results">
            {results.map((result, index) => (
              <div key={`${result.url}-${index}`} className="lyra-agents-web-result-row">
                <span className="lyra-agents-web-result-index">{index + 1}</span>
                <div className="lyra-agents-web-result-main">
                  <AppButton variant="ghost" size="sm"
                    type="button"
                    className="lyra-agents-web-result-title"
                    title={result.url}
                    onClick={() => openResult(result.url, result.title)}
                  >
                    <span>{result.title}</span>
                    <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
                  </AppButton>
                  <div className="lyra-agents-web-result-url">{webResultHost(result.url)}</div>
                  {result.snippet && (
                    <p className="lyra-agents-web-result-snippet">{result.snippet}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="lyra-agents-info-line">
            <span className="lyra-agents-info-dim">URL</span>
            <AppButton variant="ghost" size="sm"
              type="button"
              className="lyra-agents-web-url-button"
              title={details.url}
              onClick={() => openResult(details.url, details.title ?? details.url)}
            >
              <span>{details.url}</span>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </AppButton>
          </div>
          {details.title && <div className="lyra-agents-web-fetch-title">{details.title}</div>}
          {typeof details.fetchedBytes === "number" && details.fetchedBytes > 0 ? (
            <div className="lyra-agents-info-dim">{details.fetchedBytes.toLocaleString()} bytes</div>
          ) : null}
        </>
      )}
      {details.summary && (
        <p className={results.length > 0 ? "lyra-agents-tool-details-text" : "lyra-agents-web-fetch-preview"}>
          <ActionText text={details.summary} />
        </p>
      )}
      {details.screenshot && (
        <div className="lyra-agents-tool-screenshot-container">
          <ClickableImage
            src={details.screenshot}
            alt="Browser Screenshot"
            className="lyra-agents-tool-screenshot-img"
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
    <div className="lyra-agents-info-block lyra-agents-workbench-card">
      <div className="lyra-agents-workbench-card-summary">
        <span className="lyra-agents-workbench-action-label">{details.label}</span>
        {tabs.length > 0 && (
          <span className="lyra-agents-info-dim">
            {tabs.length === 1 ? "1 tab" : `${tabs.length} tabs`}
          </span>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="lyra-agents-workbench-tab-list">
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
        <pre className="lyra-agents-workbench-tab-excerpt">
          <ActionText text={details.excerpt} />
        </pre>
      )}
      {details.text && (
        <pre className="lyra-agents-workbench-tab-excerpt">
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
    <div className="lyra-agents-workbench-tab-row">
      <span
        className="lyra-agents-workbench-tab-state"
        data-active={tab.flags.includes("active")}
        aria-hidden
      />
      <div className="lyra-agents-workbench-tab-main">
        <div className="lyra-agents-workbench-tab-title-row">
          {hasUrl ? (
            <AppButton variant="ghost" size="sm"
              type="button"
              className="lyra-agents-workbench-tab-title"
              title={tab.url}
              onClick={onOpen}
            >
              <span>{tab.title}</span>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </AppButton>
          ) : (
            <span className="lyra-agents-workbench-tab-title-static">{tab.title}</span>
          )}
        </div>
        <div className="lyra-agents-workbench-tab-meta">
          <span>{tab.tabId}</span>
          <span>{tab.kind}</span>
          {tab.observationKind && <span>{tab.observationKind}</span>}
        </div>
        {tab.flags.length > 0 && (
          <div className="lyra-agents-workbench-tab-flags">
            {tab.flags.map((flag) => (
              <span key={flag} className="lyra-agents-workbench-tab-flag">
                {flag}
              </span>
            ))}
          </div>
        )}
        {tab.url && <div className="lyra-agents-workbench-tab-url">{webResultHost(tab.url)}</div>}
        {tab.excerpt && (
          <p className="lyra-agents-workbench-tab-preview">
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
    <AppButton variant="ghost" size="sm"
      type="button"
      className={className}
      title={filePath}
      onClick={() => {
        void openFileInWorkbench(filePath).catch(() => undefined);
      }}
    >
      {children}
    </AppButton>
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
    <div className="lyra-agents-task-card">
      <div className="lyra-agents-task-card-head">Execution plan</div>
      <ul className="lyra-agents-task-list">
        {details.tasks.map((t, i) => (
          <li key={i} className={`lyra-agents-task-item status-${t.status}`}>
            <span className={t.status === "running" ? "lyra-agents-shimmer" : ""}>
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
    <div className="lyra-agents-ask-card">
      <div className="lyra-agents-ask-question">{details.question}</div>
      <div className="lyra-agents-ask-answer">{details.answer}</div>
    </div>
  );
}
