import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  Workflow,
  XCircle,
} from "lucide-react";

import type { AgentLongWorkSummary, AgentSessionDetail } from "./agent-ui-types";

type LongWorkStatusRowProps = {
  readonly detail: AgentSessionDetail | null;
};

export const LongWorkStatusRow = ({ detail }: LongWorkStatusRowProps) => {
  const summary = detail?.longWorkSummary ?? null;
  if (summary === null) {
    return null;
  }
  return (
    <section
      className="lyra-ai-long-work-status"
      aria-label="Long work status"
      data-status={summary.status}
    >
      <span className="lyra-ai-long-work-icon" aria-label={statusLabel(summary.status)}>
        {statusIcon(summary.status)}
      </span>
      <span className="lyra-ai-long-work-main">
        <span className="lyra-ai-long-work-title">
          <Workflow size={13} aria-hidden="true" />
          Long Work
        </span>
        <span className="lyra-ai-long-work-detail">{summary.objectiveSummary}</span>
      </span>
      <span className="lyra-ai-long-work-meta">
        {summaryMeta(summary)}
      </span>
    </section>
  );
};

const statusIcon = (status: string) => {
  if (status === "completed") {
    return <CheckCircle2 size={14} aria-hidden="true" />;
  }
  if (status === "blocked" || status === "stuck") {
    return <AlertTriangle size={14} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <XCircle size={14} aria-hidden="true" />;
  }
  if (status === "cancelled") {
    return <MinusCircle size={14} aria-hidden="true" />;
  }
  if (status === "running" || status === "created" || status === "auto_resuming") {
    return <Loader2 size={14} aria-hidden="true" />;
  }
  return <Circle size={14} aria-hidden="true" />;
};

const statusLabel = (status: string): string => {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "blocked") {
    return "Blocked";
  }
  if (status === "stuck") {
    return "Stuck";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "auto_resuming") {
    return "Auto resuming";
  }
  if (status === "running" || status === "created") {
    return "Running";
  }
  return "Pending";
};

const summaryMeta = (summary: AgentLongWorkSummary): string => {
  const progress = `${String(summary.todoProgress.completed)}/${String(summary.todoProgress.total)}`;
  const slice = summary.currentSlice?.sequence === undefined
    ? null
    : `Slice ${String(summary.currentSlice.sequence)}`;
  const prefix = slice === null ? progress : `${progress} · ${slice}`;
  if (summary.stuck !== undefined && summary.stuck !== null) {
    return `${prefix} · ${summary.stuck.reasonSummary ?? "Stuck"}`;
  }
  if (summary.continuation !== undefined && summary.continuation !== null) {
    if (summary.continuation.status === "resuming" || summary.status === "auto_resuming") {
      return `${prefix} · Auto resuming`;
    }
    if (summary.continuation.status === "queued") {
      return `${prefix} · ${resumeCount(summary.continuation.nextSliceSequence)} auto resumes · ${
        summary.continuation.reasonSummary ?? "Queued continuation"
      }`;
    }
    if (summary.continuation.status === "blocked") {
      return `${prefix} · ${summary.continuation.reasonSummary ?? "Blocked continuation"}`;
    }
  }
  if (summary.status === "blocked" && summary.blockerSummary !== undefined) {
    return `${prefix} · ${summary.blockerSummary}`;
  }
  if (summary.currentSlice?.stopCause !== undefined && summary.currentSlice.stopCause !== null) {
    return `${prefix} · ${stopCauseLabel(summary.currentSlice.stopCause)}`;
  }
  return `${prefix} · ${statusLabel(summary.status)}`;
};

const resumeCount = (nextSliceSequence: number): string => {
  const used = Math.max(0, Math.min(3, nextSliceSequence - 1));
  return `${String(used)}/3`;
};

const stopCauseLabel = (cause: string): string => {
  if (cause === "completion_candidate") {
    return "model stopped early";
  }
  if (cause === "blocking_approval") {
    return "approval required";
  }
  if (cause === "tool_failure") {
    return "tool failed";
  }
  return cause.replaceAll("_", " ");
};
