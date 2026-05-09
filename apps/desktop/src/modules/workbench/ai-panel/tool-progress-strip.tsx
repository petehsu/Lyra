import {
  AlertTriangle,
  CheckCircle2,
  FileDiff,
  FileText,
  Loader2,
  Terminal,
} from "lucide-react";

import type {
  AgentFollowEventSummary,
  AgentFollowSummary,
  AgentFollowTargetSummary,
  AgentRuntimeEvent,
} from "./agent-ui-types";
import { isRecord, readString } from "./patch-artifact";

type ToolProgressStripProps = {
  readonly summary: AgentFollowSummary | null;
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
  readonly onOpenWorkspaceUri?: ((workspaceUri: string) => void) | undefined;
};

type ToolProgressRow = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly label: string;
  readonly detail: string;
  readonly workspaceUri?: string;
};

export const ToolProgressStrip = ({
  summary,
  runtimeEvents,
  onOpenWorkspaceUri,
}: ToolProgressStripProps) => {
  const rows = summary === null
    ? rowsFromProjectionEvents(runtimeEvents)
    : compactRows(summary, summary.activeTarget ?? summary.targets[0] ?? null);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="lyra-ai-follow-rows" aria-label="Tool progress">
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
  );
};

export const hasToolProgressProjection = (runtimeEvents: readonly AgentRuntimeEvent[]): boolean =>
  runtimeEvents.some((event) => event.phase === "follow_projection_updated");

const compactRows = (
  summary: AgentFollowSummary,
  activeTarget: AgentFollowTargetSummary | null
): readonly ToolProgressRow[] => {
  const rows: ToolProgressRow[] = [];
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

const rowsFromProjectionEvents = (
  runtimeEvents: readonly AgentRuntimeEvent[]
): readonly ToolProgressRow[] => {
  const event = [...runtimeEvents]
    .reverse()
    .find((candidate) => candidate.phase === "follow_projection_updated");
  const payload = isRecord(event?.payload) ? event.payload : {};
  const operations = Array.isArray(payload.operations) ? payload.operations : [];
  return operations
    .map((value, index): ToolProgressRow | null => {
      if (!isRecord(value)) {
        return null;
      }
      const toolName = readString(value.toolName) ?? readString(value.toolPath) ?? "Tool";
      const status = readString(value.status) ?? "running";
      const filePath = readString(value.filePath);
      return {
        id: `projection:${String(index)}:${toolName}:${filePath ?? ""}`,
        kind: toolName.includes("command") || toolName.includes("shell") ? "terminal" : "file",
        status,
        label: statusLabel(status, toolName),
        detail: filePath ?? toolName,
        ...(filePath === null ? {} : { workspaceUri: filePath }),
      };
    })
    .filter((row): row is ToolProgressRow => row !== null)
    .slice(0, 4);
};

const targetRow = (
  target: AgentFollowTargetSummary,
  recentEvent: AgentFollowEventSummary | undefined
): ToolProgressRow => ({
  id: `target:${target.followTargetId}`,
  kind: target.kind,
  status: target.status,
  label: labelForTarget(target, recentEvent),
  detail: target.workspaceUri ?? target.resourceRef ?? target.title,
  ...(target.workspaceUri === undefined ? {} : { workspaceUri: target.workspaceUri }),
});

const eventRow = (event: AgentFollowEventSummary): ToolProgressRow => ({
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
  if (target.kind === "terminal") {
    return "Command finished";
  }
  return target.title;
};

const statusLabel = (status: string, toolName: string): string => {
  if (status === "running" || status === "active") {
    return `Running ${toolName}`;
  }
  if (status === "completed") {
    return `${toolName} completed`;
  }
  if (status === "failed") {
    return `${toolName} failed`;
  }
  return toolName;
};

const targetIcon = (kind: string, status: string) => {
  if (status === "active" || status === "running") {
    return <Loader2 size={13} />;
  }
  if (status === "failed" || status === "blocked") {
    return <AlertTriangle size={13} />;
  }
  if (kind === "terminal" || kind === "test_report" || kind === "lint_report" || kind === "build_report") {
    return <Terminal size={13} />;
  }
  if (kind === "diff" || kind === "file") {
    return <FileDiff size={13} />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={13} />;
  }
  return <FileText size={13} />;
};
