import type { FileEditorRevealLocation } from "../file-editor";
import {
  isTerminalToolName,
  type AgentRuntimeFeedItem,
} from "./runtime/feed-utils";
import { renderRuntimeFeedIcon } from "./view-helpers";

type AiPanelRuntimeFeedBlockProps = {
  readonly items: readonly AgentRuntimeFeedItem[];
  readonly canOpenPath: boolean;
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
            {isRunning ? (
              <span className="lyra-ai-agent-runtime-feed-spinner" />
            ) : (
              <span
                className={
                  item.status === "failed"
                    ? "lyra-ai-agent-runtime-feed-dot lyra-ai-agent-runtime-feed-dot-failed"
                    : "lyra-ai-agent-runtime-feed-dot lyra-ai-agent-runtime-feed-dot-completed"
                }
              />
            )}
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

export const AiPanelStreamStatusBlock = ({ status }: AiPanelStreamStatusBlockProps) => (
  <div
    className={
      status.tone === "failed"
        ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-failed"
        : status.tone === "completed"
          ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-completed"
          : status.tone === "waiting"
            ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-waiting"
            : "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-running"
    }
  >
    <span className="lyra-ai-stream-status-label">{status.label}</span>
  </div>
);
