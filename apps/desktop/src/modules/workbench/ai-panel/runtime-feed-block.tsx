import type { FileEditorRevealLocation } from "../file-editor";
import {
  isTerminalToolName,
  type AgentRuntimeFeedItem,
} from "./runtime/feed-utils";
import {
  SpinnerLabel,
  StatusBadge,
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
};

export const AiPanelRuntimeFeedBlock = ({
  items,
  canOpenPath,
  statusLabels,
  openRuntimeTargetPath,
}: AiPanelRuntimeFeedBlockProps) => (
  <div className="lyra-ai-agent-runtime-feed-shell">
    <div className="lyra-ai-agent-runtime-feed">
      {items.map((item) => {
        const openPath = item.openPath;
        const isOpenable = openPath !== undefined && canOpenPath;
        const location =
          item.firstChangedLine === undefined
            ? undefined
            : ({ line: item.firstChangedLine } as FileEditorRevealLocation);
        const hasLiveOutput = item.liveOutput !== undefined && item.liveOutput.length > 0;
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
              {isRunning ? (
                <SpinnerLabel
                  variant="dots"
                  tone={statusTone}
                  size="sm"
                  ariaLabel={statusLabel}
                  className="lyra-ai-agent-runtime-feed-spinner-label"
                  glyphClassName="lyra-ai-agent-runtime-feed-spinner-glyph"
                />
              ) : (
                <StatusIndicator
                  tone={statusTone}
                  variant="dot"
                  ariaLabel={statusLabel}
                  className="lyra-ai-agent-runtime-feed-indicator"
                />
              )}
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
                className="lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-link"
                onClick={() => {
                  void openRuntimeTargetPath(openPath, {
                    ...(location === undefined ? {} : { location })
                  });
                }}
                title={openPath}
              >
                {item.target}
              </button>
            ) : (
              <span className="lyra-ai-agent-runtime-feed-target">{item.target}</span>
            )}
            <StatusBadge
              tone={statusTone}
              label={statusLabel}
              className="lyra-ai-agent-runtime-feed-item-status"
            />
            {isTerminal && hasLiveOutput && (
              <pre className="lyra-ai-agent-runtime-feed-output">{item.liveOutput}</pre>
            )}
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

  return (
    <div
      className={
        status.tone === "failed"
          ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-failed"
          : "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-completed"
      }
    >
      <StatusBadge
        tone={status.tone === "failed" ? "danger" : "success"}
        label={status.label}
      />
    </div>
  );
};
