import { Circle, Pause, Play } from "lucide-react";

import type { AgentSessionDetail } from "./agent-ui-types";
import { hasToolProgressProjection, ToolProgressStrip } from "./tool-progress-strip";

type FollowProcessListProps = {
  readonly detail: AgentSessionDetail | null;
  readonly pauseFollow?: (() => Promise<void>) | undefined;
  readonly resumeFollow?: (() => Promise<void>) | undefined;
  readonly onOpenWorkspaceUri?: ((workspaceUri: string) => void) | undefined;
};

export const FollowProcessList = ({
  detail,
  pauseFollow,
  resumeFollow,
  onOpenWorkspaceUri,
}: FollowProcessListProps) => {
  const summary = detail?.followSummary ?? null;
  const status = summary?.status ?? "auto_following";
  if (summary === null && !hasToolProgressProjection(detail?.runtimeEvents ?? [])) {
    return null;
  }
  const canPause = summary !== null && status !== "paused_by_user" && pauseFollow !== undefined;
  const canResume = summary !== null && status === "paused_by_user" && resumeFollow !== undefined;
  return (
    <section
      className="lyra-ai-follow-process"
      aria-label="Follow process"
      data-status={status}
    >
      <div className="lyra-ai-follow-header">
        <span className="lyra-ai-follow-header-icon" aria-hidden="true">
          {status === "paused_by_user" ? <Pause size={13} /> : <Circle size={13} />}
        </span>
        <span className="lyra-ai-follow-header-label">
          {status === "paused_by_user" ? "Following paused" : "Following"}
        </span>
        {canPause ? (
          <button
            className="lyra-ai-follow-icon-button"
            type="button"
            aria-label="Pause following"
            title="Pause following"
            onClick={(event) => {
              event.stopPropagation();
              void pauseFollow();
            }}
          >
            <Pause size={13} aria-hidden="true" />
          </button>
        ) : null}
        {canResume ? (
          <button
            className="lyra-ai-follow-icon-button"
            type="button"
            aria-label="Resume following"
            title="Resume following"
            onClick={(event) => {
              event.stopPropagation();
              void resumeFollow();
            }}
          >
            <Play size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ToolProgressStrip
        summary={summary}
        runtimeEvents={detail?.runtimeEvents ?? []}
        onOpenWorkspaceUri={onOpenWorkspaceUri}
      />
    </section>
  );
};
