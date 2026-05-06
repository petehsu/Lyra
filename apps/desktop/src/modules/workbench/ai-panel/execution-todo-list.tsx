import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ListChecks,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";

import type { AgentSessionDetail, AgentTodoItem } from "./agent-ui-types";
import { isRecord, readString } from "./patch-artifact";

type ExecutionTodoListProps = {
  readonly detail: AgentSessionDetail | null;
};

export const ExecutionTodoList = ({ detail }: ExecutionTodoListProps) => {
  const todo = detail?.activeTodo ?? null;
  if (todo === null || todo.items.length === 0) {
    return null;
  }
  return (
    <section className="lyra-ai-execution-todo-list" aria-label="Execution todo">
      <div className="lyra-ai-execution-todo-header">
        <ListChecks size={13} aria-hidden="true" />
        <span className="lyra-ai-execution-todo-title">{todo.title}</span>
        <span className="lyra-ai-execution-todo-summary">
          {todoSummary(detail)}
        </span>
      </div>
      <ol className="lyra-ai-execution-todo-items">
        {todo.items.map((item) => (
          <li key={item.todoItemId} className="lyra-ai-execution-todo-item" data-status={item.status}>
            <span className="lyra-ai-execution-todo-status" aria-label={statusLabel(item.status)}>
              {statusIcon(item.status)}
            </span>
            <span className="lyra-ai-execution-todo-item-main">
              <span className="lyra-ai-execution-todo-item-title">{item.title}</span>
              <span className="lyra-ai-execution-todo-item-detail">{itemDetail(item)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

const todoSummary = (detail: AgentSessionDetail | null): string => {
  const todo = detail?.activeTodo ?? null;
  if (todo === null) {
    return "";
  }
  const coverage = detail?.planCoverageSummary ?? null;
  const coverageLabel = todo.kind === "plan_bound"
    && coverage !== null
    && coverage.todoListId === todo.todoListId
    ? coverage.status === "valid"
      ? "coverage valid"
      : "coverage blocked"
    : null;
  const progress = detail?.executionSummary === undefined || detail.executionSummary === null
    ? null
    : `${String(detail.executionSummary.completedStepCount)}/${String(todo.items.length)}`;
  return [todo.kind, coverageLabel, progress].filter((part): part is string => part !== null).join(" · ");
};

const statusIcon = (status: string) => {
  if (status === "completed") {
    return <CheckCircle2 size={13} aria-hidden="true" />;
  }
  if (status === "blocked") {
    return <AlertTriangle size={13} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <XCircle size={13} aria-hidden="true" />;
  }
  if (status === "skipped") {
    return <MinusCircle size={13} aria-hidden="true" />;
  }
  if (status === "in_progress" || status === "running") {
    return <Loader2 size={13} aria-hidden="true" />;
  }
  return <Circle size={13} aria-hidden="true" />;
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
  if (status === "skipped") {
    return "Skipped";
  }
  if (status === "in_progress" || status === "running") {
    return "Running";
  }
  return "Pending";
};

const itemDetail = (item: AgentTodoItem): string => {
  if (item.status === "blocked" && hasApprovalBlocker(item.blockers)) {
    return "Waiting for approval";
  }
  if (item.status === "failed" && hasDeniedBlocker(item.blockers)) {
    return "Approval denied";
  }
  if (item.evidenceRefs.length > 0) {
    return `${String(item.evidenceRefs.length)} evidence ref${item.evidenceRefs.length === 1 ? "" : "s"}`;
  }
  if (item.expectedTools.length === 0) {
    return statusLabel(item.status);
  }
  const firstTool = item.expectedTools[0]?.split("/").filter(Boolean).at(-1) ?? "tool";
  return item.expectedTools.length === 1
    ? firstTool
    : `${firstTool} +${String(item.expectedTools.length - 1)}`;
};

const hasApprovalBlocker = (blockers: unknown): boolean =>
  blockerEntries(blockers).some((blocker) => readString(blocker.kind) === "approval_required");

const hasDeniedBlocker = (blockers: unknown): boolean =>
  blockerEntries(blockers).some((blocker) => readString(blocker.kind) === "approval_denied");

const blockerEntries = (blockers: unknown): readonly Record<string, unknown>[] => {
  if (Array.isArray(blockers)) {
    return blockers.filter(isRecord);
  }
  return isRecord(blockers) ? [blockers] : [];
};
