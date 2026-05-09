import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  Terminal,
  XCircle,
} from "lucide-react";

import type {
  AgentDeliveryProofSummary,
  AgentSessionDetail,
  AgentVerificationRunSummary,
} from "./agent-ui-types";

type VerificationSummaryListProps = {
  readonly detail: AgentSessionDetail | null;
  readonly onlyNeedsAttention?: boolean | undefined;
};

export const VerificationSummaryList = ({ detail, onlyNeedsAttention = false }: VerificationSummaryListProps) => {
  const summary = detail?.verificationSummary ?? null;
  if (summary === null || summary.runs.length === 0) {
    return null;
  }
  const runs = onlyNeedsAttention
    ? summary.runs.filter((run) => verificationNeedsAttention(run.status))
    : summary.runs;
  if (runs.length === 0) {
    return null;
  }
  const proof = detail?.deliveryProof ?? null;
  return (
    <section className="lyra-ai-verification-list" aria-label="Verification">
      <div className="lyra-ai-verification-header">
        <Terminal size={13} aria-hidden="true" />
        <span className="lyra-ai-verification-title">Verification</span>
        <span className="lyra-ai-verification-summary">
          {summary.status}
          {proof === null ? "" : ` · ${deliveryProofLabel(proof)}`}
        </span>
      </div>
      <ol className="lyra-ai-verification-items">
        {runs.map((run) => (
          <li key={run.verificationRunId} className="lyra-ai-verification-item" data-status={run.status}>
            <span className="lyra-ai-verification-status" aria-label={statusLabel(run.status)}>
              {statusIcon(run.status)}
            </span>
            <span className="lyra-ai-verification-main">
              <span className="lyra-ai-verification-command">
                {run.command ?? run.skipReason ?? "Verification not run"}
              </span>
              <span className="lyra-ai-verification-detail">
                {runDetail(run)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

const statusIcon = (status: string) => {
  if (status === "passed") {
    return <CheckCircle2 size={13} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <XCircle size={13} aria-hidden="true" />;
  }
  if (status === "blocked") {
    return <AlertTriangle size={13} aria-hidden="true" />;
  }
  if (status === "not_run") {
    return <MinusCircle size={13} aria-hidden="true" />;
  }
  if (status === "running") {
    return <Loader2 size={13} aria-hidden="true" />;
  }
  return <Circle size={13} aria-hidden="true" />;
};

const verificationNeedsAttention = (status: string): boolean =>
  status === "failed" || status === "blocked" || status === "not_run";

const statusLabel = (status: string): string => {
  if (status === "passed") {
    return "Passed";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "blocked") {
    return "Blocked";
  }
  if (status === "not_run") {
    return "Not run";
  }
  if (status === "running") {
    return "Running";
  }
  return "Pending";
};

const runDetail = (run: AgentVerificationRunSummary): string => {
  const parts = [
    statusLabel(run.status),
    run.cwd === undefined ? null : run.cwd,
    run.exitCode === undefined ? null : `exit ${String(run.exitCode)}`,
    run.evidenceRefs.length === 0
      ? null
      : `${String(run.evidenceRefs.length)} evidence ref${run.evidenceRefs.length === 1 ? "" : "s"}`,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
};

const deliveryProofLabel = (proof: AgentDeliveryProofSummary): string =>
  proof.status === "ready"
    ? "proof ready"
    : proof.status === "partial"
      ? "proof partial"
      : proof.status === "failed"
        ? "proof failed"
        : proof.status === "blocked"
          ? "proof blocked"
          : "proof pending";
