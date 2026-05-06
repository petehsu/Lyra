import { Check, FileDiff, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  AgentPendingInteraction,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import { isRecord, readString } from "./patch-artifact";

type PendingApprovalListProps = {
  readonly detail: AgentSessionDetail | null;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
};

type ApprovalRow = {
  readonly interaction: AgentPendingInteraction;
  readonly approvalTicketId: string;
  readonly toolPath: string;
  readonly title: string;
  readonly files: readonly string[];
};

type RowState = "approving" | "denying" | "denied";

export const PendingApprovalList = ({
  detail,
  resolveApproval,
}: PendingApprovalListProps) => {
  const [rowStateById, setRowStateById] = useState<Record<string, RowState>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const rows = useMemo(() => extractApprovalRows(detail), [detail]);
  if (rows.length === 0) {
    return null;
  }

  const resolve = async (row: ApprovalRow, decision: "approve" | "deny") => {
    if (resolveApproval === undefined) {
      return;
    }
    setRowStateById((current) => ({
      ...current,
      [row.approvalTicketId]: decision === "approve" ? "approving" : "denying",
    }));
    setErrorById((current) => {
      const next = { ...current };
      delete next[row.approvalTicketId];
      return next;
    });
    try {
      await resolveApproval({
        sessionId: row.interaction.sessionId,
        approvalTicketId: row.approvalTicketId,
        decision,
      });
      if (decision === "deny") {
        setRowStateById((current) => ({
          ...current,
          [row.approvalTicketId]: "denied",
        }));
      }
    } catch (error) {
      setRowStateById((current) => {
        const next = { ...current };
        delete next[row.approvalTicketId];
        return next;
      });
      setErrorById((current) => ({
        ...current,
        [row.approvalTicketId]: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  return (
    <section className="lyra-ai-pending-approval-list" aria-label="Pending tool approvals">
      {rows.map((row) => {
        const rowState = rowStateById[row.approvalTicketId] ?? null;
        const disabled = resolveApproval === undefined || rowState === "approving" || rowState === "denying";
        const error = errorById[row.approvalTicketId] ?? null;
        return (
          <div key={row.approvalTicketId} className="lyra-ai-pending-approval-row">
            <span className="lyra-ai-pending-approval-icon">
              {approvalIcon(row.toolPath)}
            </span>
            <span className="lyra-ai-pending-approval-main">
              <span className="lyra-ai-pending-approval-title">{row.title}</span>
              <span className="lyra-ai-pending-approval-detail">
                {approvalImpact(row.toolPath, row.files)}
              </span>
              {error === null ? null : (
                <span className="lyra-ai-pending-approval-error" role="alert">
                  {error}
                </span>
              )}
            </span>
            <span className="lyra-ai-pending-approval-actions">
              {rowState === "denied" ? (
                <span className="lyra-ai-pending-approval-state">Denied</span>
              ) : null}
              <button
                type="button"
                className="lyra-ai-pending-approval-button"
                disabled={disabled || rowState === "denied"}
                onClick={() => {
                  void resolve(row, "approve");
                }}
              >
                {rowState === "approving" ? <Loader2 size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
                <span>{rowState === "approving" ? "Approving" : "Approve"}</span>
              </button>
              <button
                type="button"
                className="lyra-ai-pending-approval-button lyra-ai-pending-approval-button-deny"
                disabled={disabled || rowState === "denied"}
                onClick={() => {
                  void resolve(row, "deny");
                }}
              >
                {rowState === "denying" ? <Loader2 size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                <span>{rowState === "denying" ? "Denying" : "Deny"}</span>
              </button>
            </span>
          </div>
        );
      })}
    </section>
  );
};

const extractApprovalRows = (detail: AgentSessionDetail | null): readonly ApprovalRow[] =>
  detail?.pendingInteractions
    .filter((interaction) => interaction.kind === "tool_approval" && interaction.status === "pending")
    .map(extractApprovalRow)
    .filter((row): row is ApprovalRow => row !== null)
  ?? [];

const extractApprovalRow = (interaction: AgentPendingInteraction): ApprovalRow | null => {
  const payload = isRecord(interaction.payload) ? interaction.payload : {};
  const toolPath = readString(payload.toolPath);
  if (toolPath === null) {
    return null;
  }
  const approvalTicketId = readString(payload.approvalTicketId) ?? interaction.id;
  const title = readString(payload.title) ?? approvalTitle(toolPath);
  const impactScope = isRecord(payload.impactScope) ? payload.impactScope : {};
  const files = Array.isArray(impactScope.files)
    ? impactScope.files.map(readString).filter((file): file is string => file !== null)
    : [];
  return {
    interaction,
    approvalTicketId,
    toolPath,
    title,
    files,
  };
};

const approvalTitle = (toolPath: string): string => {
  if (toolPath.includes("/apply_patch")) {
    return "Apply workspace patch";
  }
  if (toolPath.includes("/rollback_patch")) {
    return "Rollback workspace patch";
  }
  return "Tool approval";
};

const approvalIcon = (toolPath: string) => {
  if (toolPath.includes("/apply_patch")) {
    return <FileDiff size={13} aria-hidden="true" />;
  }
  if (toolPath.includes("/rollback_patch")) {
    return <RotateCcw size={13} aria-hidden="true" />;
  }
  return <ShieldCheck size={13} aria-hidden="true" />;
};

const approvalImpact = (toolPath: string, files: readonly string[]): string => {
  const fileLabel = files.length === 0
    ? "workspace"
    : files.length === 1
      ? files[0]
      : `${files[0]} +${String(files.length - 1)} more`;
  return `${toolPath} · ${fileLabel}`;
};
