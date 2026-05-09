import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  MinusCircle,
  PackageCheck,
  XCircle,
} from "lucide-react";

import type { AgentSessionDetail } from "./agent-ui-types";

type DeliveryStatusRowProps = {
  readonly detail: AgentSessionDetail | null;
  readonly onlyNeedsAttention?: boolean | undefined;
};

export const DeliveryStatusRow = ({ detail, onlyNeedsAttention = false }: DeliveryStatusRowProps) => {
  const proof = detail?.deliveryProof ?? null;
  const audit = detail?.completionAudit ?? null;
  if (proof === null && audit === null) {
    return null;
  }
  const status = proof?.status ?? audit?.status ?? "pending";
  if (onlyNeedsAttention && !deliveryNeedsAttention(status)) {
    return null;
  }
  const summary = proof?.summary ?? audit?.summary ?? "Delivery proof is pending.";
  const stats = deliveryStats(detail);
  return (
    <section className="lyra-ai-delivery-status" aria-label="Delivery status" data-status={status}>
      <span className="lyra-ai-delivery-icon" aria-label={statusLabel(status)}>
        {statusIcon(status)}
      </span>
      <span className="lyra-ai-delivery-main">
        <span className="lyra-ai-delivery-title">
          <PackageCheck size={13} aria-hidden="true" />
          Delivery
        </span>
        <span className="lyra-ai-delivery-detail">{summary}</span>
      </span>
      <span className="lyra-ai-delivery-meta">{stats}</span>
    </section>
  );
};

const statusIcon = (status: string) => {
  if (status === "ready" || status === "passed") {
    return <CheckCircle2 size={14} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <XCircle size={14} aria-hidden="true" />;
  }
  if (status === "partial" || status === "partial_allowed") {
    return <MinusCircle size={14} aria-hidden="true" />;
  }
  if (status === "blocked") {
    return <AlertTriangle size={14} aria-hidden="true" />;
  }
  return <Circle size={14} aria-hidden="true" />;
};

const deliveryNeedsAttention = (status: string): boolean =>
  status === "blocked"
  || status === "failed"
  || status === "partial"
  || status === "partial_allowed";

const statusLabel = (status: string): string => {
  if (status === "ready" || status === "passed") {
    return "Ready";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "partial" || status === "partial_allowed") {
    return "Partial";
  }
  if (status === "blocked") {
    return "Blocked";
  }
  return "Pending";
};

const deliveryStats = (detail: AgentSessionDetail | null): string => {
  const audit = detail?.completionAudit ?? null;
  const proof = detail?.deliveryProof ?? null;
  if (audit !== null) {
    const parts = [
      audit.failedVerificationRunIds.length === 0
        ? null
        : `${String(audit.failedVerificationRunIds.length)} failed`,
      audit.blockedVerificationRunIds.length === 0
        ? null
        : `${String(audit.blockedVerificationRunIds.length)} blocked`,
      audit.notRunVerificationRunIds.length === 0
        ? null
        : `${String(audit.notRunVerificationRunIds.length)} not run`,
      audit.pendingApprovalTicketIds.length === 0
        ? null
        : `${String(audit.pendingApprovalTicketIds.length)} approval`,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) {
      return parts.join(" · ");
    }
  }
  if (proof !== null && proof.verificationRunIds.length > 0) {
    return `${String(proof.verificationRunIds.length)} verification`;
  }
  return statusLabel(proof?.status ?? audit?.status ?? "pending");
};
