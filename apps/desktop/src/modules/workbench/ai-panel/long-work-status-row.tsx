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
  if (status === "blocked") {
    return <AlertTriangle size={14} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <XCircle size={14} aria-hidden="true" />;
  }
  if (status === "cancelled") {
    return <MinusCircle size={14} aria-hidden="true" />;
  }
  if (status === "running" || status === "created") {
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
  if (status === "failed") {
    return "Failed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "running" || status === "created") {
    return "Running";
  }
  return "Pending";
};

const summaryMeta = (summary: AgentLongWorkSummary): string => {
  const progress = `${String(summary.todoProgress.completed)}/${String(summary.todoProgress.total)}`;
  if (summary.status === "blocked" && summary.blockerSummary !== undefined) {
    return `${progress} · ${summary.blockerSummary}`;
  }
  return `${progress} · ${statusLabel(summary.status)}`;
};
