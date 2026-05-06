import type {
  AgentMessage,
  AgentRecoverySummary,
  AgentRollbackImpactLevel,
  AgentRollbackPreviewSummary,
} from "./agent-ui-types";

export type RollbackTone = "safe" | "conflict" | "external" | "destructive";

export const canPreviewMessageRollback = (
  recoverySummary: AgentRecoverySummary | null | undefined,
  message: AgentMessage
): boolean =>
  message.role === "user"
  && recoverySummary?.rollbackReadyMessageIds.includes(message.id) === true;

export const activeRollbackPreview = (
  recoverySummary: AgentRecoverySummary | null | undefined
): AgentRollbackPreviewSummary | null =>
  recoverySummary?.activeRollbackPreview
  ?? recoverySummary?.rollbackPreviews.find((preview) => preview.status === "previewed")
  ?? recoverySummary?.rollbackPreviews[0]
  ?? null;

export const rollbackImpactLabel = (impactLevel: AgentRollbackImpactLevel): string => {
  switch (impactLevel) {
    case "conflict":
      return "Conflict";
    case "external_side_effect":
      return "External effect";
    case "destructive":
      return "Destructive";
    default:
      return "Safe preview";
  }
};

export const rollbackTone = (impactLevel: AgentRollbackImpactLevel): RollbackTone => {
  switch (impactLevel) {
    case "conflict":
      return "conflict";
    case "external_side_effect":
      return "external";
    case "destructive":
      return "destructive";
    default:
      return "safe";
  }
};

export const rollbackPreviewCounts = (preview: AgentRollbackPreviewSummary): string => {
  const parts = [
    `${String(preview.messageCount)} msg`,
    `${String(preview.workspaceChangeCount)} file`,
  ];
  if (preview.externalSideEffectCount > 0) {
    parts.push(`${String(preview.externalSideEffectCount)} external`);
  }
  return parts.join(" / ");
};
