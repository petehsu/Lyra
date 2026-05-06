import type {
  AgentPendingInteraction,
  AgentPatchChangedFile,
  AgentRuntimeEvent,
  AgentSessionDetail,
} from "./agent-ui-types";

export type PatchProposalEvent = {
  readonly key: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly timestamp: number;
  readonly summary: string;
  readonly artifactId: string | null;
  readonly evidenceId: string | null;
  readonly patchRef: string | null;
  readonly resultRef: string | null;
  readonly changedFiles: readonly AgentPatchChangedFile[];
  readonly truncated: boolean;
};

export type PatchApplyEvent = {
  readonly key: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly timestamp: number;
  readonly status: string;
  readonly artifactId: string | null;
  readonly evidenceId: string | null;
  readonly approvalTicketId: string | null;
  readonly patchRef: string | null;
  readonly appliedFromArtifactId: string | null;
  readonly changedFiles: readonly AgentPatchChangedFile[];
};

export type PatchDeniedEvent = {
  readonly key: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly timestamp: number;
  readonly approvalTicketId: string | null;
  readonly artifactId: string | null;
  readonly patchRef: string | null;
};

export type PatchApprovalInteraction = {
  readonly key: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly approvalTicketId: string;
  readonly toolPath: string;
  readonly artifactId: string | null;
  readonly patchRef: string | null;
  readonly approvalMode: string | null;
};

export type PatchProposalTotals = {
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

export const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const readBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : false;

export const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const extractChangedFiles = (value: unknown): readonly AgentPatchChangedFile[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  return value
    .map((item): AgentPatchChangedFile | null => {
      if (isRecord(item) === false) {
        return null;
      }
      const path = readString(item.path);
      if (path === null) {
        return null;
      }
      return {
        path,
        changeType: readString(item.changeType) ?? "modified",
        additions: readNumber(item.additions) ?? 0,
        deletions: readNumber(item.deletions) ?? 0,
      };
    })
    .filter((item): item is AgentPatchChangedFile => item !== null);
};

export const patchProposalTotals = (
  changedFiles: readonly AgentPatchChangedFile[]
): PatchProposalTotals => ({
  fileCount: changedFiles.length,
  additions: changedFiles.reduce((sum, file) => sum + file.additions, 0),
  deletions: changedFiles.reduce((sum, file) => sum + file.deletions, 0),
});

export const formatPatchTotals = (totals: PatchProposalTotals): string => {
  const fileLabel = `${String(totals.fileCount)} file${totals.fileCount === 1 ? "" : "s"} changed`;
  return `${fileLabel} · +${String(totals.additions)} -${String(totals.deletions)}`;
};

export const changedFilesSummary = (changedFiles: readonly AgentPatchChangedFile[]): string | null => {
  if (changedFiles.length === 0) {
    return null;
  }
  const files = changedFiles.map((file) =>
    `${file.path} +${String(file.additions)} -${String(file.deletions)}`
  );
  const visible = files.slice(0, 2);
  const hiddenCount = files.length - visible.length;
  return hiddenCount > 0
    ? `${visible.join(", ")} +${String(hiddenCount)} more`
    : visible.join(", ");
};

export const extractPatchProposalEvent = (
  event: AgentRuntimeEvent
): PatchProposalEvent | null => {
  if (event.phase !== "tool_operation_completed") {
    return null;
  }
  const payload = isRecord(event.payload) ? event.payload : {};
  const operation = isRecord(payload.operation) ? payload.operation : {};
  const result = isRecord(payload.result) ? payload.result : {};
  const toolPath = readString(operation.toolPath)
    ?? readString(operation.path)
    ?? readString(result.path);
  const patchRef = readString(result.patchRef);
  const artifactId = readString(result.artifactId);
  if (toolPath?.includes("/propose_patch") !== true) {
    return null;
  }
  const resultRef = readString(result.resultRef);
  const key = [
    event.sessionId,
    artifactId ?? patchRef ?? resultRef ?? event.turnId,
    String(event.timestamp),
  ].join(":");
  return {
    key,
    sessionId: event.sessionId,
    turnId: event.turnId,
    timestamp: event.timestamp,
    summary: readString(result.summary) ?? readString(operation.summary) ?? "Patch preview",
    artifactId,
    evidenceId: readString(result.evidenceId),
    patchRef,
    resultRef,
    changedFiles: extractChangedFiles(result.changedFiles),
    truncated: readBoolean(result.truncated),
  };
};

export const extractPatchApplyEvent = (
  event: AgentRuntimeEvent
): PatchApplyEvent | null => {
  if (event.phase !== "tool_operation_completed") {
    return null;
  }
  const payload = isRecord(event.payload) ? event.payload : {};
  const operation = isRecord(payload.operation) ? payload.operation : {};
  const result = isRecord(payload.result) ? payload.result : {};
  const toolPath = readString(operation.toolPath)
    ?? readString(operation.path)
    ?? readString(result.path);
  if (toolPath?.includes("/apply_patch") !== true) {
    return null;
  }
  const patchRef = readString(result.patchRef);
  const artifactId = readString(result.artifactId);
  const approvalTicketId = readString(result.approvalTicketId);
  const key = [
    event.sessionId,
    patchRef ?? artifactId ?? approvalTicketId ?? event.turnId,
    String(event.timestamp),
  ].join(":");
  return {
    key,
    sessionId: event.sessionId,
    turnId: event.turnId,
    timestamp: event.timestamp,
    status: readString(result.status) ?? "applied",
    artifactId,
    evidenceId: readString(result.evidenceId),
    approvalTicketId,
    patchRef,
    appliedFromArtifactId: readString(result.appliedFromArtifactId),
    changedFiles: extractChangedFiles(result.changedFiles),
  };
};

export const extractPatchDeniedEvent = (
  event: AgentRuntimeEvent
): PatchDeniedEvent | null => {
  if (event.phase !== "tool_operation_failed" && event.phase !== "approval_ticket_resolved") {
    return null;
  }
  const payload = isRecord(event.payload) ? event.payload : {};
  const operation = isRecord(payload.operation) ? payload.operation : {};
  const result = isRecord(payload.result) ? payload.result : payload;
  const toolPath = readString(operation.toolPath)
    ?? readString(operation.path)
    ?? readString(result.toolPath)
    ?? readString(result.path);
  if (toolPath?.includes("/apply_patch") !== true) {
    return null;
  }
  const status = readString(result.status);
  const errorCode = readString(result.errorCode);
  if (status !== "denied" && errorCode !== "TOOL_APPROVAL_DENIED") {
    return null;
  }
  const approvalTicketId = readString(result.approvalTicketId);
  const artifactId = readString(result.artifactId);
  const patchRef = readString(result.patchRef);
  const key = [
    event.sessionId,
    approvalTicketId ?? artifactId ?? patchRef ?? event.turnId,
    String(event.timestamp),
  ].join(":");
  return {
    key,
    sessionId: event.sessionId,
    turnId: event.turnId,
    timestamp: event.timestamp,
    approvalTicketId,
    artifactId,
    patchRef,
  };
};

export const extractPatchProposalEvents = (
  detail: AgentSessionDetail | null
): readonly PatchProposalEvent[] =>
  detail?.runtimeEvents
    .map(extractPatchProposalEvent)
    .filter((event): event is PatchProposalEvent => event !== null)
    .sort((left, right) => left.timestamp - right.timestamp)
  ?? [];

export const latestPatchProposalEvent = (
  detail: AgentSessionDetail | null
): PatchProposalEvent | null =>
  extractPatchProposalEvents(detail).at(-1) ?? null;

export const latestPendingPatchProposalEvent = (
  detail: AgentSessionDetail | null
): PatchProposalEvent | null =>
  extractPatchProposalEvents(detail)
    .filter((proposal) =>
      !isPatchProposalApplied(detail, proposal) && !isPatchProposalDenied(detail, proposal)
    )
    .at(-1)
  ?? null;

export const extractPatchApplyEvents = (
  detail: AgentSessionDetail | null
): readonly PatchApplyEvent[] =>
  detail?.runtimeEvents
    .map(extractPatchApplyEvent)
    .filter((event): event is PatchApplyEvent => event !== null)
    .sort((left, right) => left.timestamp - right.timestamp)
  ?? [];

export const extractPatchDeniedEvents = (
  detail: AgentSessionDetail | null
): readonly PatchDeniedEvent[] =>
  detail?.runtimeEvents
    .map(extractPatchDeniedEvent)
    .filter((event): event is PatchDeniedEvent => event !== null)
    .sort((left, right) => left.timestamp - right.timestamp)
  ?? [];

export const isPatchProposalApplied = (
  detail: AgentSessionDetail | null,
  proposal: PatchProposalEvent
): boolean =>
  extractPatchApplyEvents(detail).some((event) =>
    event.status === "applied"
    && (
      (proposal.patchRef !== null && event.patchRef === proposal.patchRef)
      || (proposal.resultRef !== null && event.patchRef === proposal.resultRef)
      || (proposal.artifactId !== null && event.appliedFromArtifactId === proposal.artifactId)
    )
  );

export const isPatchProposalDenied = (
  detail: AgentSessionDetail | null,
  proposal: PatchProposalEvent
): boolean =>
  extractPatchDeniedEvents(detail).some((event) =>
    (proposal.patchRef !== null && event.patchRef === proposal.patchRef)
    || (proposal.resultRef !== null && event.patchRef === proposal.resultRef)
    || (proposal.artifactId !== null && event.artifactId === proposal.artifactId)
  );

const extractPatchApprovalInteraction = (
  interaction: AgentPendingInteraction
): PatchApprovalInteraction | null => {
  if (interaction.kind !== "tool_approval" || interaction.status !== "pending") {
    return null;
  }
  const payload = isRecord(interaction.payload) ? interaction.payload : {};
  const toolPath = readString(payload.toolPath);
  if (toolPath?.includes("/apply_patch") !== true) {
    return null;
  }
  const approvalTicketId = readString(payload.approvalTicketId) ?? interaction.id;
  return {
    key: interaction.id,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    approvalTicketId,
    toolPath,
    artifactId: readString(payload.artifactId),
    patchRef: readString(payload.patchRef),
    approvalMode: readString(payload.approvalMode),
  };
};

export const extractPatchApprovalInteractions = (
  detail: AgentSessionDetail | null
): readonly PatchApprovalInteraction[] =>
  detail?.pendingInteractions
    .map(extractPatchApprovalInteraction)
    .filter((interaction): interaction is PatchApprovalInteraction => interaction !== null)
  ?? [];

export const patchApprovalForProposal = (
  detail: AgentSessionDetail | null,
  proposal: PatchProposalEvent
): PatchApprovalInteraction | null =>
  extractPatchApprovalInteractions(detail).find((interaction) =>
    (proposal.artifactId !== null && interaction.artifactId === proposal.artifactId)
    || (proposal.patchRef !== null && interaction.patchRef === proposal.patchRef)
    || (proposal.resultRef !== null && interaction.patchRef === proposal.resultRef)
  ) ?? null;
