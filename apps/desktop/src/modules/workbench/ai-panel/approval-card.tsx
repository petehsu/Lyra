import { Check, FileDiff, Loader2, RotateCcw, ShieldCheck, Terminal, X } from "lucide-react";

import type { AgentPendingInteraction } from "./agent-ui-types";

export type ApprovalCardRow = {
  readonly interaction: AgentPendingInteraction;
  readonly approvalTicketId: string;
  readonly toolPath: string;
  readonly title: string;
  readonly files: readonly string[];
  readonly command: string | null;
  readonly cwd: string | null;
};

export type ApprovalCardState = "approving" | "approved" | "denying" | "denied";

type ApprovalCardProps = {
  readonly row: ApprovalCardRow;
  readonly state: ApprovalCardState | null;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onResolve: (row: ApprovalCardRow, decision: "approve" | "deny") => void;
};

export const ApprovalCard = ({
  row,
  state,
  disabled,
  error,
  onResolve,
}: ApprovalCardProps) => {
  const resolved = state === "approved" || state === "denied";
  return (
    <div className="lyra-ai-pending-approval-row" data-state={state ?? "pending"}>
      <span className="lyra-ai-pending-approval-icon">
        {approvalIcon(row.toolPath)}
      </span>
      <span className="lyra-ai-pending-approval-main">
        <span className="lyra-ai-pending-approval-title">{row.title}</span>
        <span className="lyra-ai-pending-approval-detail">
          {approvalImpact(row)}
        </span>
        {error === null ? null : (
          <span className="lyra-ai-pending-approval-error" role="alert">
            {error}
          </span>
        )}
      </span>
      <span className="lyra-ai-pending-approval-actions">
        {resolved ? (
          <span className="lyra-ai-pending-approval-state">
            {state === "approved" ? "Approved" : "Denied"}
          </span>
        ) : null}
        <button
          type="button"
          className="lyra-ai-pending-approval-button"
          disabled={disabled || resolved}
          onClick={() => {
            onResolve(row, "approve");
          }}
        >
          {state === "approving" ? <Loader2 size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
          <span>{state === "approving" ? "Approving" : "Approve"}</span>
        </button>
        <button
          type="button"
          className="lyra-ai-pending-approval-button lyra-ai-pending-approval-button-deny"
          disabled={disabled || resolved}
          onClick={() => {
            onResolve(row, "deny");
          }}
        >
          {state === "denying" ? <Loader2 size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
          <span>{state === "denying" ? "Denying" : "Deny"}</span>
        </button>
      </span>
    </div>
  );
};

const approvalIcon = (toolPath: string) => {
  if (toolPath.includes("/apply_patch")) {
    return <FileDiff size={13} aria-hidden="true" />;
  }
  if (toolPath.includes("/rollback_patch")) {
    return <RotateCcw size={13} aria-hidden="true" />;
  }
  if (toolPath.includes("/run_command")) {
    return <Terminal size={13} aria-hidden="true" />;
  }
  return <ShieldCheck size={13} aria-hidden="true" />;
};

const approvalImpact = (row: ApprovalCardRow): string => {
  if (row.command !== null) {
    return truncateMiddle(`${row.toolPath} · ${row.command}${row.cwd === null ? "" : ` · ${row.cwd}`}`);
  }
  const fileLabel = row.files.length === 0
    ? "workspace"
    : row.files.length === 1
      ? row.files[0]
      : `${row.files[0]} +${String(row.files.length - 1)} more`;
  return truncateMiddle(`${row.toolPath} · ${fileLabel}`);
};

const truncateMiddle = (value: string): string => {
  if (value.length <= 140) {
    return value;
  }
  return `${value.slice(0, 84)}...${value.slice(-40)}`;
};
