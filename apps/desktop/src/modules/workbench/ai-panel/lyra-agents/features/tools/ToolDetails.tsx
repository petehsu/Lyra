import { type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type {
  ToolDetails as ToolDetailsType,
  WorkbenchTabSummary
} from "../../core/types";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { t } from "@workbench/i18n";
import { useData } from "../../data/DataProvider";
import {
  ActionTargetList,
  ActionText,
  ClickableImage
} from "../rich-text/ActionTargets";
import { TerminalToolCard } from "./TerminalToolCard";
import { AppButton } from "@renderer/ui/components";
import { VirtualizedDiffView } from "./VirtualizedDiffView";

/**
 * Level-3 renderer. Rendered inline without surrounding borders or panels so
 * it reads as a continuation of the message, not a nested card.
 */
export function ToolDetails({
  details,
  running = false
}: {
  details: ToolDetailsType;
  running?: boolean;
}) {
  switch (details.type) {
    case "edit":
      return <EditCard details={details} running={running} />;
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
  return (
    <div className="lyra-agents-info-block lyra-agents-lumen-card">
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
      {details.text && (
        <pre className="lyra-agents-info-pre lyra-agents-lumen-output">
          {details.text}
        </pre>
      )}
    </div>
  );
}

function SoftwareCard({
  details,
}: {
  details: Extract<ToolDetailsType, { type: "software" }>;
}) {
  return (
    <div className="lyra-agents-info-block">
      <ActionTargetList targets={details.targets} />
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
  running = false,
}: {
  details: Extract<ToolDetailsType, { type: "edit" }>;
  running?: boolean;
}) {
  const hasDiff = details.hunks.length > 0;

  return (
    <div className="lyra-agents-info-block lyra-agents-edit-details">
      {running && !hasDiff ? (
        <div className="lyra-agents-edit-card-waiting lyra-agents-shimmer">
          {t("tool.streamingDiff")}
        </div>
      ) : null}
      <VirtualizedDiffView hunks={details.hunks} running={running} />
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
      {tab.excerpt ? (
        <p className="lyra-agents-workbench-tab-preview">
          <ActionText text={tab.excerpt} />
        </p>
      ) : null}
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
