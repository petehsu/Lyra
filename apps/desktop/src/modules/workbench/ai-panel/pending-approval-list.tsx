import { useMemo, useState } from "react";

import type {
  AgentPendingInteraction,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import { ApprovalCard, type ApprovalCardRow, type ApprovalCardState } from "./approval-card";
import { isRecord, readString } from "./patch-artifact";

type PendingApprovalListProps = {
  readonly detail: AgentSessionDetail | null;
  readonly resolveApproval?: ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>) | undefined;
};

export const PendingApprovalList = ({
  detail,
  resolveApproval,
}: PendingApprovalListProps) => {
  const [rowStateById, setRowStateById] = useState<Record<string, ApprovalCardState>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const rows = useMemo(() => extractApprovalRows(detail), [detail]);
  if (rows.length === 0) {
    return null;
  }

  const resolve = async (row: ApprovalCardRow, decision: "approve" | "deny") => {
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
      setRowStateById((current) => ({
        ...current,
        [row.approvalTicketId]: decision === "approve" ? "approved" : "denied",
      }));
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
          <ApprovalCard
            key={row.approvalTicketId}
            row={row}
            state={rowState}
            disabled={disabled}
            error={error}
            onResolve={(targetRow, decision) => {
              void resolve(targetRow, decision);
            }}
          />
        );
      })}
    </section>
  );
};

const extractApprovalRows = (detail: AgentSessionDetail | null): readonly ApprovalCardRow[] =>
  detail?.pendingInteractions
    .filter((interaction) => interaction.kind === "tool_approval" && interaction.status === "pending")
    .map(extractApprovalRow)
    .filter((row): row is ApprovalCardRow => row !== null)
  ?? [];

export const hasPendingApprovalRows = (detail: AgentSessionDetail | null): boolean =>
  extractApprovalRows(detail).length > 0;

const extractApprovalRow = (interaction: AgentPendingInteraction): ApprovalCardRow | null => {
  const payload = isRecord(interaction.payload) ? interaction.payload : {};
  const toolPath = readString(payload.toolPath);
  if (toolPath === null) {
    return null;
  }
  const approvalTicketId = readString(payload.approvalTicketId) ?? interaction.id;
  const title = readString(payload.title) ?? approvalTitle(toolPath);
  const impactScope = isRecord(payload.impactScope) ? payload.impactScope : {};
  const requestedAction = isRecord(payload.requestedAction) ? payload.requestedAction : {};
  const requestedArguments = isRecord(requestedAction.arguments) ? requestedAction.arguments : {};
  const files = approvalFiles(impactScope, requestedArguments);
  return {
    interaction,
    approvalTicketId,
    toolPath,
    title,
    files,
    command: readString(payload.command)
      ?? readString(impactScope.command)
      ?? readString(requestedArguments.command),
    cwd: readString(payload.cwd) ?? readString(impactScope.cwd),
  };
};

const approvalFiles = (
  impactScope: Record<string, unknown>,
  requestedArguments: Record<string, unknown>
): readonly string[] => {
  const files = readStringArray(impactScope.files);
  if (files.length > 0) {
    return files;
  }
  const workspacePaths = readStringArray(impactScope.workspacePaths);
  if (workspacePaths.length > 0) {
    return workspacePaths;
  }
  return [
    readString(requestedArguments.path),
    readString(requestedArguments.fromPath),
    readString(requestedArguments.toPath),
  ].filter((file): file is string => file !== null);
};

const readStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.map(readString).filter((item): item is string => item !== null)
    : [];

const approvalTitle = (toolPath: string): string => {
  if (toolPath.includes("/apply_patch")) {
    return "Apply workspace patch";
  }
  if (toolPath.includes("/rollback_patch")) {
    return "Rollback workspace patch";
  }
  if (toolPath.includes("/run_command")) {
    return "Run shell command";
  }
  return "Tool approval";
};
