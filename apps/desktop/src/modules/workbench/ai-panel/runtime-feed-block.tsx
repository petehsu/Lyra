import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import type { FileEditorRevealLocation } from "../file-editor";
import {
  isTerminalToolName,
  isWriteToolName,
  type AgentTerminalTranscriptChunk,
  type AgentRuntimeFeedItem,
} from "./runtime/feed-utils";
import {
  SpinnerLabel,
  StatusIndicator,
  type StatusTone,
} from "./status-primitives";
import { renderRuntimeFeedIcon } from "./view-helpers";

type RuntimeFeedStatusLabels = {
  readonly running: string;
  readonly completed: string;
  readonly failed: string;
};

type AiPanelRuntimeFeedBlockProps = {
  readonly items: readonly AgentRuntimeFeedItem[];
  readonly canOpenPath: boolean;
  readonly statusLabels: RuntimeFeedStatusLabels;
  readonly showFullOutputLabel: string;
  readonly expandToolOutputLabel: string;
  readonly collapseToolOutputLabel: string;
  readonly fileChangesLabel: string;
  readonly openRuntimeTargetPath: (
    path: string,
    options?: {
      readonly forceReloadIfOpen?: boolean;
      readonly allowMissing?: boolean;
      readonly location?: FileEditorRevealLocation;
    }
  ) => Promise<void>;
  readonly onOpenThread?: (threadId: string) => void;
};

const TERMINAL_TRANSCRIPT_PREVIEW_LIMIT = 12_000;

const trimTerminalChunks = (
  chunks: readonly AgentTerminalTranscriptChunk[],
  limit: number
): {
  readonly chunks: readonly AgentTerminalTranscriptChunk[];
  readonly truncated: boolean;
} => {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.text.length, 0);
  if (totalLength <= limit) {
    return { chunks, truncated: false };
  }
  const nextChunks: AgentTerminalTranscriptChunk[] = [];
  let remaining = limit;
  for (let index = chunks.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const chunk = chunks[index];
    if (chunk === undefined) {
      continue;
    }
    if (chunk.text.length <= remaining) {
      nextChunks.unshift(chunk);
      remaining -= chunk.text.length;
      continue;
    }
    nextChunks.unshift({
      ...chunk,
      text: chunk.text.slice(chunk.text.length - remaining),
    });
    remaining = 0;
  }
  return { chunks: nextChunks, truncated: true };
};

const TerminalTranscriptBlock = ({
  item,
  showFullOutputLabel,
}: {
  readonly item: AgentRuntimeFeedItem;
  readonly showFullOutputLabel: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const transcript = item.terminalTranscript;
  const chunks = transcript?.chunks ?? (
    item.liveOutput === undefined || item.liveOutput.length === 0
      ? []
      : [{ stream: "stdout" as const, text: item.liveOutput, timestamp: item.timestamp }]
  );
  const visible = useMemo(
    () => expanded
      ? { chunks, truncated: false }
      : trimTerminalChunks(chunks, TERMINAL_TRANSCRIPT_PREVIEW_LIMIT),
    [chunks, expanded]
  );
  if (chunks.length === 0) {
    return null;
  }
  return (
    <div className="lyra-ai-agent-terminal-card">
      <div className="lyra-ai-agent-terminal-card-head">
        <span className="lyra-ai-agent-terminal-card-command">
          {transcript?.command ?? item.target}
        </span>
        {transcript?.cwd === undefined ? null : (
          <span className="lyra-ai-agent-terminal-card-cwd">{transcript.cwd}</span>
        )}
      </div>
      <pre className="lyra-ai-agent-runtime-feed-output lyra-ai-agent-terminal-card-output">
        {visible.chunks.map((chunk, index) => (
          <span
            key={`${chunk.stream}-${String(chunk.timestamp)}-${String(index)}`}
            className={`lyra-ai-agent-terminal-stream lyra-ai-agent-terminal-stream-${chunk.stream}`}
          >
            {chunk.text}
          </span>
        ))}
      </pre>
      {!visible.truncated ? null : (
        <button
          type="button"
          className="lyra-ai-agent-terminal-card-expand"
          onClick={() => {
            setExpanded(true);
          }}
        >
          {showFullOutputLabel}
        </button>
      )}
    </div>
  );
};

const itemHasTerminalTranscript = (item: AgentRuntimeFeedItem): boolean =>
  (item.terminalTranscript?.chunks.length ?? 0) > 0
  || (item.liveOutput !== undefined && item.liveOutput.length > 0);

const itemHasFileChangeSummary = (item: AgentRuntimeFeedItem): boolean =>
  isWriteToolName(item.toolName)
  || item.addedLines !== undefined
  || item.removedLines !== undefined
  || item.firstChangedLine !== undefined;

const fileChangeSummary = (item: AgentRuntimeFeedItem): string => {
  const location =
    item.firstChangedLine === undefined ? item.target : `${item.target}:${String(item.firstChangedLine)}`;
  const deltas = [
    item.addedLines === undefined ? null : `+${String(item.addedLines)}`,
    item.removedLines === undefined ? null : `-${String(item.removedLines)}`,
  ].filter((value): value is string => value !== null);
  return deltas.length === 0 ? location : `${location} · ${deltas.join(" ")}`;
};

const runtimeFeedStatusModel = (
  item: AgentRuntimeFeedItem,
  statusLabels: RuntimeFeedStatusLabels
): {
  readonly isRunning: boolean;
  readonly statusTone: StatusTone;
  readonly statusLabel: string;
  readonly itemClassName: string;
  readonly targetClassName: string;
} => {
  const isRunning = item.status !== "completed" && item.status !== "failed";
  const statusTone: StatusTone =
    item.status === "failed"
      ? "danger"
      : item.status === "completed"
        ? "success"
        : "info";
  const statusLabel =
    item.status === "failed"
      ? statusLabels.failed
      : item.status === "completed"
        ? statusLabels.completed
        : statusLabels.running;
  const itemClassName =
    item.status === "failed"
      ? "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-failed"
      : item.status === "completed"
        ? "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-completed"
        : "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-running";
  const targetClassName = isRunning
    ? "lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-link lyra-ai-agent-runtime-feed-target-running"
    : "lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-link";
  return {
    isRunning,
    statusTone,
    statusLabel,
    itemClassName,
    targetClassName,
  };
};

type RuntimeFeedTargetProps = {
  readonly item: AgentRuntimeFeedItem;
  readonly canOpenPath: boolean;
  readonly targetClassName: string;
  readonly openRuntimeTargetPath: AiPanelRuntimeFeedBlockProps["openRuntimeTargetPath"];
  readonly onOpenThread?: (threadId: string) => void;
};

const RuntimeFeedTarget = ({
  item,
  canOpenPath,
  targetClassName,
  openRuntimeTargetPath,
  onOpenThread,
}: RuntimeFeedTargetProps) => {
  const openPath = item.openPath;
  const isOpenable = openPath !== undefined && canOpenPath;
  const openThreadId = item.openThreadId;
  const openThreadTargets = item.openThreadTargets ?? (
    openThreadId === undefined ? [] : [{ threadId: openThreadId, label: item.target }]
  );
  const primaryOpenThreadTarget = openThreadTargets[0];
  const isThreadOpenable = primaryOpenThreadTarget !== undefined && onOpenThread !== undefined;
  const location =
    item.firstChangedLine === undefined
      ? undefined
      : ({ line: item.firstChangedLine } as FileEditorRevealLocation);

  if (isOpenable) {
    return (
      <button
        type="button"
        className={targetClassName}
        onClick={(event) => {
          event.stopPropagation();
          void openRuntimeTargetPath(openPath, {
            ...(location === undefined ? {} : { location })
          });
        }}
        title={openPath}
      >
        {item.target}
      </button>
    );
  }

  if (isThreadOpenable && openThreadTargets.length > 1 && onOpenThread !== undefined) {
    return (
      <span
        className="lyra-ai-agent-runtime-feed-thread-targets"
        title={item.target}
        aria-label={item.target}
      >
        {openThreadTargets.map((threadTarget) => (
          <button
            key={threadTarget.threadId}
            type="button"
            className={targetClassName}
            onClick={(event) => {
              event.stopPropagation();
              onOpenThread(threadTarget.threadId);
            }}
            title={threadTarget.threadId}
          >
            {threadTarget.label}
          </button>
        ))}
      </span>
    );
  }

  if (isThreadOpenable && primaryOpenThreadTarget !== undefined && onOpenThread !== undefined) {
    return (
      <button
        type="button"
        className={targetClassName}
        onClick={(event) => {
          event.stopPropagation();
          onOpenThread(primaryOpenThreadTarget.threadId);
        }}
        title={primaryOpenThreadTarget.threadId}
      >
        {item.target}
      </button>
    );
  }

  return (
    <span
      className={
        item.status !== "completed" && item.status !== "failed"
          ? "lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-running"
          : "lyra-ai-agent-runtime-feed-target"
      }
    >
      {item.target}
    </span>
  );
};

const RuntimeFeedDetails = ({
  item,
  showFullOutputLabel,
  fileChangesLabel,
}: {
  readonly item: AgentRuntimeFeedItem;
  readonly showFullOutputLabel: string;
  readonly fileChangesLabel: string;
}) => {
  if (isTerminalToolName(item.toolName) && itemHasTerminalTranscript(item)) {
    return (
      <TerminalTranscriptBlock
        item={item}
        showFullOutputLabel={showFullOutputLabel}
      />
    );
  }

  if (!itemHasFileChangeSummary(item)) {
    return null;
  }

  return (
    <div className="lyra-ai-agent-runtime-feed-details">
      <span className="lyra-ai-agent-runtime-feed-details-label">{fileChangesLabel}</span>
      <span className="lyra-ai-agent-runtime-feed-details-value">
        {fileChangeSummary(item)}
      </span>
    </div>
  );
};

const CollapsedRuntimeFeedItem = ({
  item,
  canOpenPath,
  statusLabels,
  showFullOutputLabel,
  expandToolOutputLabel,
  collapseToolOutputLabel,
  fileChangesLabel,
  expandedItemIds,
  collapsedItemIds,
  onToggleItem,
  openRuntimeTargetPath,
  onOpenThread,
}: Omit<AiPanelRuntimeFeedBlockProps, "items"> & {
  readonly item: AgentRuntimeFeedItem;
  readonly expandedItemIds: ReadonlySet<string>;
  readonly collapsedItemIds: ReadonlySet<string>;
  readonly onToggleItem: (itemId: string, expanded: boolean) => void;
}) => {
  const status = runtimeFeedStatusModel(item, statusLabels);
  const hasDetails =
    (isTerminalToolName(item.toolName) && itemHasTerminalTranscript(item))
    || itemHasFileChangeSummary(item);
  const defaultExpanded = status.isRunning || item.status === "failed";
  const expanded =
    expandedItemIds.has(item.id) || (defaultExpanded && !collapsedItemIds.has(item.id));
  const toggleExpanded = (): void => {
    if (!hasDetails) {
      return;
    }
    onToggleItem(item.id, !expanded);
  };
  const targetProps = {
    item,
    canOpenPath,
    targetClassName: status.targetClassName,
    openRuntimeTargetPath,
    ...(onOpenThread === undefined ? {} : { onOpenThread }),
  };

  return (
    <div
      className={`${status.itemClassName} lyra-ai-agent-runtime-feed-item-collapsed`}
      data-expanded={expanded ? "true" : "false"}
    >
      <div
        className={
          hasDetails
            ? "lyra-ai-agent-runtime-feed-collapsed-main lyra-ai-agent-runtime-feed-collapsed-main-toggleable"
            : "lyra-ai-agent-runtime-feed-collapsed-main"
        }
        onClick={hasDetails ? toggleExpanded : undefined}
      >
        {hasDetails ? (
          <button
            type="button"
            className="lyra-ai-agent-runtime-feed-disclosure"
            aria-label={expanded ? collapseToolOutputLabel : expandToolOutputLabel}
            title={expanded ? collapseToolOutputLabel : expandToolOutputLabel}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded();
            }}
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        ) : (
          <span className="lyra-ai-agent-runtime-feed-disclosure-spacer" />
        )}
        <span className="lyra-ai-agent-runtime-feed-leading">
          <StatusIndicator
            tone={status.statusTone}
            variant="dot"
            ariaLabel={status.statusLabel}
            className={
              status.isRunning
                ? "lyra-ai-agent-runtime-feed-indicator lyra-ai-agent-runtime-feed-indicator-running"
                : "lyra-ai-agent-runtime-feed-indicator"
            }
          />
        </span>
        <span
          className="lyra-ai-agent-runtime-feed-icon"
          title={item.toolLabel}
          aria-label={item.toolLabel}
        >
          {renderRuntimeFeedIcon(item.icon)}
        </span>
        <span className="lyra-ai-agent-runtime-feed-tool-label">{item.toolLabel}</span>
        <RuntimeFeedTarget {...targetProps} />
        <span className="lyra-ai-agent-runtime-feed-status-label">
          {status.statusLabel}
        </span>
      </div>
      {!expanded || !hasDetails ? null : (
        <RuntimeFeedDetails
          item={item}
          showFullOutputLabel={showFullOutputLabel}
          fileChangesLabel={fileChangesLabel}
        />
      )}
    </div>
  );
};

const CollapsedRuntimeFeedGroupHeader = ({
  items,
  expanded,
  statusLabels,
  expandToolOutputLabel,
  collapseToolOutputLabel,
  fileChangesLabel,
  onToggle,
}: {
  readonly items: readonly AgentRuntimeFeedItem[];
  readonly expanded: boolean;
  readonly statusLabels: RuntimeFeedStatusLabels;
  readonly expandToolOutputLabel: string;
  readonly collapseToolOutputLabel: string;
  readonly fileChangesLabel: string;
  readonly onToggle: () => void;
}) => {
  const hasRunning = items.some((item) => item.status !== "completed" && item.status !== "failed");
  const hasFailed = items.some((item) => item.status === "failed");
  const statusTone: StatusTone = hasFailed ? "danger" : hasRunning ? "info" : "success";
  const statusLabel = hasFailed
    ? statusLabels.failed
    : hasRunning
      ? statusLabels.running
      : statusLabels.completed;
  const allFileChanges = items.every((item) => itemHasFileChangeSummary(item));
  const firstItem = items[0];
  const title = allFileChanges ? fileChangesLabel : firstItem?.toolLabel ?? fileChangesLabel;
  const target = items
    .slice(0, 3)
    .map((item) => item.target)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");

  return (
    <button
      type="button"
      className="lyra-ai-agent-runtime-feed-group"
      data-expanded={expanded ? "true" : "false"}
      aria-label={expanded ? collapseToolOutputLabel : expandToolOutputLabel}
      title={expanded ? collapseToolOutputLabel : expandToolOutputLabel}
      onClick={onToggle}
    >
      <span className="lyra-ai-agent-runtime-feed-disclosure">
        <ChevronRight size={13} aria-hidden="true" />
      </span>
      <span className="lyra-ai-agent-runtime-feed-leading">
        <StatusIndicator
          tone={statusTone}
          variant="dot"
          ariaLabel={statusLabel}
          className={
            hasRunning
              ? "lyra-ai-agent-runtime-feed-indicator lyra-ai-agent-runtime-feed-indicator-running"
              : "lyra-ai-agent-runtime-feed-indicator"
          }
        />
      </span>
      <span className="lyra-ai-agent-runtime-feed-group-title">{title}</span>
      <span className="lyra-ai-agent-runtime-feed-group-target">{target}</span>
      <span className="lyra-ai-agent-runtime-feed-status-label">
        {String(items.length)}
      </span>
    </button>
  );
};

export const AiPanelRuntimeFeedBlock = ({
  items,
  canOpenPath,
  statusLabels,
  showFullOutputLabel,
  expandToolOutputLabel,
  collapseToolOutputLabel,
  fileChangesLabel,
  openRuntimeTargetPath,
  onOpenThread,
}: AiPanelRuntimeFeedBlockProps) => {
  const [expandedItemIds, setExpandedItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedItemIds, setCollapsedItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [groupExpandedOverride, setGroupExpandedOverride] = useState<boolean | null>(null);
  const hasRunningItems = items.some((item) => item.status !== "completed" && item.status !== "failed");
  const groupExpanded = groupExpandedOverride ?? hasRunningItems;
  const sharedProps = {
    canOpenPath,
    statusLabels,
    showFullOutputLabel,
    fileChangesLabel,
    openRuntimeTargetPath,
    ...(onOpenThread === undefined ? {} : { onOpenThread }),
  };

  const toggleItem = (itemId: string, expanded: boolean): void => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
    setCollapsedItemIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  return (
    <div className="lyra-ai-agent-runtime-feed-shell lyra-ai-agent-runtime-feed-shell-collapsed">
      <div className="lyra-ai-agent-runtime-feed lyra-ai-agent-runtime-feed-collapsed">
        {items.length <= 1 ? null : (
          <CollapsedRuntimeFeedGroupHeader
            items={items}
            expanded={groupExpanded}
            statusLabels={statusLabels}
            expandToolOutputLabel={expandToolOutputLabel}
            collapseToolOutputLabel={collapseToolOutputLabel}
            fileChangesLabel={fileChangesLabel}
            onToggle={() => {
              setGroupExpandedOverride(!groupExpanded);
            }}
          />
        )}
        {items.length > 1 && !groupExpanded
          ? null
          : items.map((item) => (
              <CollapsedRuntimeFeedItem
                key={item.id}
                item={item}
                {...sharedProps}
                expandToolOutputLabel={expandToolOutputLabel}
                collapseToolOutputLabel={collapseToolOutputLabel}
                expandedItemIds={expandedItemIds}
                collapsedItemIds={collapsedItemIds}
                onToggleItem={toggleItem}
              />
            ))}
      </div>
    </div>
  );
};

type StreamStatusTone = "running" | "waiting" | "completed" | "failed";

export type AiPanelStreamStatusItem = {
  readonly label: string;
  readonly tone: StreamStatusTone;
};

type AiPanelStreamStatusBlockProps = {
  readonly status: AiPanelStreamStatusItem;
};

export const AiPanelStreamStatusBlock = ({ status }: AiPanelStreamStatusBlockProps) => {
  if (status.tone === "running" || status.tone === "waiting") {
    return (
      <div
        className={
          status.tone === "waiting"
            ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-waiting"
            : "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-running"
        }
      >
        <SpinnerLabel
          variant={status.tone === "waiting" ? "sand" : "dots"}
          tone={status.tone === "waiting" ? "warning" : "info"}
          size="sm"
          {...(status.label.length > 0 ? { ariaLabel: status.label } : {})}
        />
      </div>
    );
  }

  return null;
};
