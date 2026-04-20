import type {
  AgentPendingInteraction,
  PlanApprovalRequest,
  PlanQuestionRequest,
} from "../../../../shared/desktop-bridge";
import type {
  CommandApprovalRequest,
} from "../../command-approval-bar";
import {
  resolveCommandApprovalCommandPreview,
  resolveCommandApprovalToolLabel,
} from "../command-approval-display";

export type PendingInteractionPanel =
  | { readonly kind: "commandApproval"; readonly request: CommandApprovalRequest }
  | { readonly kind: "planQuestion"; readonly request: PlanQuestionRequest }
  | { readonly kind: "planApproval"; readonly request: PlanApprovalRequest };

export type ActiveInteractionPanel = PendingInteractionPanel | null;

export type InteractionTextBundle = {
  readonly toolTerminalSession: string;
  readonly toolTerminalInput: string;
  readonly toolTerminalExec: string;
  readonly commandNeedsApproval: string;
  readonly proposedPlanSummaryFallback: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const pickString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next : null;
};

const pickRawString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" ? next : null;
};

const pickNumber = (value: Record<string, unknown>, key: string): number | null => {
  const next = value[key];
  return typeof next === "number" ? next : null;
};

const toCommandApprovalRequest = (
  interaction: AgentPendingInteraction,
  labels: InteractionTextBundle
): CommandApprovalRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const inputPayload = isRecord(payload.input) ? payload.input : {};
  const metadataPayload = isRecord(payload.metadata) ? payload.metadata : {};
  const toolCallId = pickString(payload, "toolCallId") ?? interaction.id;
  const riskLevelCandidate = pickString(metadataPayload, "riskLevel");
  const riskLevel: CommandApprovalRequest["riskLevel"] =
    riskLevelCandidate === "safe"
    || riskLevelCandidate === "low"
    || riskLevelCandidate === "medium"
    || riskLevelCandidate === "high"
    || riskLevelCandidate === "critical"
      ? riskLevelCandidate
      : "medium";
  const toolName = pickString(payload, "toolName") ?? "terminal.exec";
  return {
    id: interaction.id,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    toolCallId,
    toolName,
    toolLabel: resolveCommandApprovalToolLabel(toolName, labels),
    command: resolveCommandApprovalCommandPreview({
      toolName,
      inputPayload,
      metadataPayload,
    }),
    riskLevel,
    riskDescription: pickString(payload, "message") ?? labels.commandNeedsApproval,
    ...(pickString(inputPayload, "cwd") === null ? {} : { cwd: pickString(inputPayload, "cwd")! }),
    ...(pickString(metadataPayload, "mode") === "command"
      || pickString(metadataPayload, "mode") === "shell"
        ? { mode: pickString(metadataPayload, "mode") as "command" | "shell" }
        : {}),
    ...(pickString(metadataPayload, "interactiveCategory") === null
      ? {}
      : { interactiveCategory: pickString(metadataPayload, "interactiveCategory")! }),
    isRepeat: metadataPayload.wasPreApproved === true,
  };
};

const toPlanQuestionRequest = (
  interaction: AgentPendingInteraction
): PlanQuestionRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const questions = Array.isArray(payload.questions) ? payload.questions : null;
  if (questions === null || questions.length === 0) {
    return null;
  }
  return {
    id: pickString(payload, "requestId") ?? interaction.id,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    questions: questions as PlanQuestionRequest["questions"],
    ...(typeof payload.allowNote === "boolean" ? { allowNote: payload.allowNote } : {}),
  };
};

const toPlanApprovalRequest = (
  interaction: AgentPendingInteraction,
  labels: InteractionTextBundle
): PlanApprovalRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const proposedMarkdown = pickRawString(payload, "proposedMarkdown");
  if (proposedMarkdown === null) {
    return null;
  }
  return {
    id: pickString(payload, "requestId") ?? interaction.id,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    version: pickNumber(payload, "version") ?? 0,
    status: "submitted",
    summary:
      pickString(payload, "summary")
      ?? proposedMarkdown.split("\n").find((line) => line.trim().length > 0)
      ?? labels.proposedPlanSummaryFallback,
    proposedMarkdown,
    ...(pickRawString(payload, "draftMarkdown") === null
      ? {}
      : { draftMarkdown: pickRawString(payload, "draftMarkdown")! }),
  };
};

export const toPendingInteractionPanel = (
  interaction: AgentPendingInteraction,
  labels: InteractionTextBundle
): PendingInteractionPanel | null => {
  if (interaction.kind === "command_approval") {
    const request = toCommandApprovalRequest(interaction, labels);
    return request === null ? null : { kind: "commandApproval", request };
  }
  if (interaction.kind === "user_question") {
    const request = toPlanQuestionRequest(interaction);
    return request === null ? null : { kind: "planQuestion", request };
  }
  if (interaction.kind === "plan_approval") {
    const request = toPlanApprovalRequest(interaction, labels);
    return request === null ? null : { kind: "planApproval", request };
  }
  return null;
};

export const sortPendingInteractions = (
  interactions: readonly AgentPendingInteraction[]
): readonly AgentPendingInteraction[] =>
  [...interactions].sort((left, right) => left.createdAt - right.createdAt);

export const mergePendingInteractionLists = (
  current: readonly AgentPendingInteraction[],
  incoming: readonly AgentPendingInteraction[]
): readonly AgentPendingInteraction[] => {
  const merged = new Map<string, AgentPendingInteraction>();
  for (const interaction of current) {
    merged.set(interaction.id, interaction);
  }
  for (const interaction of incoming) {
    const previous = merged.get(interaction.id);
    if (previous === undefined || interaction.updatedAt >= previous.updatedAt) {
      merged.set(interaction.id, interaction);
    }
  }
  return sortPendingInteractions([...merged.values()]);
};
