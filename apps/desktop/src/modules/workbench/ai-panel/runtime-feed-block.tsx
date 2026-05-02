import { useMemo, useState } from "react";

import type { FileEditorRevealLocation } from "../file-editor";
import {
  isTerminalToolName,
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

const TerminalTranscriptBlock = ({ item }: { readonly item: AgentRuntimeFeedItem }) => {
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
          Show full output
        </button>
      )}
    </div>
  );
};

export const AiPanelRuntimeFeedBlock = ({
  items,
  canOpenPath,
  statusLabels,
  openRuntimeTargetPath,
  onOpenThread,
}: AiPanelRuntimeFeedBlockProps) => (
  <div className="lyra-ai-agent-runtime-feed-shell">
    <div className="lyra-ai-agent-runtime-feed">
      {items.map((item) => {
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
        const hasTerminalTranscript =
          (item.terminalTranscript?.chunks.length ?? 0) > 0
          || (item.liveOutput !== undefined && item.liveOutput.length > 0);
        const isTerminal = isTerminalToolName(item.toolName);
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
        const targetClassName = isRunning
          ? "lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-link lyra-ai-agent-runtime-feed-target-running"
          : "lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-link";
        return (
          <div
            key={item.id}
            className={
              item.status === "failed"
                ? "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-failed"
                : item.status === "completed"
                  ? "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-completed"
                  : "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-running"
            }
          >
            <span className="lyra-ai-agent-runtime-feed-leading">
              <StatusIndicator
                tone={statusTone}
                variant="dot"
                ariaLabel={statusLabel}
                className={
                  isRunning
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
            {isOpenable ? (
              <button
                type="button"
                className={targetClassName}
                onClick={() => {
                  void openRuntimeTargetPath(openPath, {
                    ...(location === undefined ? {} : { location })
                  });
                }}
                title={openPath}
              >
                {item.target}
              </button>
            ) : isThreadOpenable && openThreadTargets.length > 1 ? (
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
                    onClick={() => {
                      onOpenThread?.(threadTarget.threadId);
                    }}
                    title={threadTarget.threadId}
                  >
                    {threadTarget.label}
                  </button>
                ))}
              </span>
            ) : isThreadOpenable ? (
              <button
                type="button"
                className={targetClassName}
                onClick={() => {
                  if (primaryOpenThreadTarget !== undefined) {
                    onOpenThread?.(primaryOpenThreadTarget.threadId);
                  }
                }}
                title={primaryOpenThreadTarget?.threadId}
              >
                {item.target}
              </button>
            ) : (
              <span
                className={
                  isRunning
                    ? "lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-running"
                    : "lyra-ai-agent-runtime-feed-target"
                }
              >
                {item.target}
              </span>
            )}
            {isTerminal && hasTerminalTranscript ? <TerminalTranscriptBlock item={item} /> : null}
          </div>
        );
      })}
    </div>
  </div>
);

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
