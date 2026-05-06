import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileDiff,
  FileText,
  Loader2,
  Pause,
  Play,
  Terminal,
} from "lucide-react";

import type {
  AgentFollowEventSummary,
  AgentFollowSummary,
  AgentFollowTargetSummary,
  AgentSessionDetail,
} from "./agent-ui-types";

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
  if (summary === null) {
    return null;
  }
  const activeTarget = summary.activeTarget ?? summary.targets[0] ?? null;
  const rows = compactRows(summary, activeTarget);
  const canPause = summary.status !== "paused_by_user" && pauseFollow !== undefined;
  const canResume = summary.status === "paused_by_user" && resumeFollow !== undefined;
  return (
    <section
      className="lyra-ai-follow-process"
      aria-label="Follow process"
      data-status={summary.status}
    >
      <div className="lyra-ai-follow-header">
        <span className="lyra-ai-follow-header-icon" aria-hidden="true">
          {summary.status === "paused_by_user" ? <Pause size={13} /> : <Circle size={13} />}
        </span>
        <span className="lyra-ai-follow-header-label">
          {summary.status === "paused_by_user" ? "Following paused" : "Following"}
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
      <div className="lyra-ai-follow-rows">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="lyra-ai-follow-row"
            data-status={row.status}
            disabled={row.workspaceUri === undefined || onOpenWorkspaceUri === undefined}
            onClick={() => {
              if (row.workspaceUri !== undefined) {
                onOpenWorkspaceUri?.(row.workspaceUri);
              }
            }}
          >
            <span className="lyra-ai-follow-row-icon" aria-hidden="true">
              {targetIcon(row.kind, row.status)}
            </span>
            <span className="lyra-ai-follow-row-main">
              <span className="lyra-ai-follow-row-label">{row.label}</span>
              <span className="lyra-ai-follow-row-detail">{row.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

type FollowRow = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly label: string;
  readonly detail: string;
  readonly workspaceUri?: string;
};

const compactRows = (
  summary: AgentFollowSummary,
  activeTarget: AgentFollowTargetSummary | null
): readonly FollowRow[] => {
  const rows: FollowRow[] = [];
  if (activeTarget !== null) {
    rows.push(targetRow(activeTarget, summary.recentEvents[0]));
  }
  for (const event of summary.recentEvents.slice(0, 3)) {
    if (rows.some((row) => row.id === `event:${event.followEventId}`)) {
      continue;
    }
    rows.push(eventRow(event));
  }
  return rows.slice(0, 4);
};

const targetRow = (
  target: AgentFollowTargetSummary,
  recentEvent: AgentFollowEventSummary | undefined
): FollowRow => ({
  id: `target:${target.followTargetId}`,
  kind: target.kind,
  status: target.status,
  label: labelForTarget(target, recentEvent),
  detail: target.workspaceUri ?? target.resourceRef ?? target.title,
  ...(target.workspaceUri === undefined ? {} : { workspaceUri: target.workspaceUri }),
});

const eventRow = (event: AgentFollowEventSummary): FollowRow => ({
  id: `event:${event.followEventId}`,
  kind: "operation",
  status: event.status ?? "background",
  label: event.label,
  detail: event.eventType.replaceAll("_", " "),
});

const labelForTarget = (
  target: AgentFollowTargetSummary,
  recentEvent: AgentFollowEventSummary | undefined
): string => {
  if (target.status === "failed") {
    if (target.kind === "test_report") {
      return "Tests failed";
    }
    if (target.kind === "terminal") {
      return "Command failed";
    }
    return "Operation failed";
  }
  if (recentEvent?.label !== undefined && recentEvent.label.trim().length > 0) {
    return recentEvent.label;
  }
  if (target.status === "active") {
    return target.kind === "terminal" ? "Running command" : "Editing";
  }
  if (target.kind === "test_report") {
    return "Tests passed";
  }
  if (target.kind === "diff") {
    return "Patch applied";
  }
  return "Operation finished";
};

const targetIcon = (kind: string, status: string) => {
  if (status === "failed") {
    return <AlertTriangle size={13} />;
  }
  if (status === "active" || status === "background") {
    return <Loader2 size={13} />;
  }
  if (kind === "terminal" || kind === "test_report" || kind === "build_report" || kind === "lint_report") {
    return <Terminal size={13} />;
  }
  if (kind === "diff") {
    return <FileDiff size={13} />;
  }
  if (kind === "file") {
    return <FileText size={13} />;
  }
  return <CheckCircle2 size={13} />;
};
