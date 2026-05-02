import type {
  AgentPlanArtifact,
  AgentPlanBlock,
  AgentPendingInteraction,
  AgentPendingInteractionKind,
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

type InteractionPanelRequestMeta = {
  readonly interactionId?: string;
  readonly interactionKind?: AgentPendingInteractionKind;
};

type InteractionCommandApprovalRequest = CommandApprovalRequest
  & InteractionPanelRequestMeta
  & {
    readonly requestedPermissions?: unknown;
  };

type InteractionPlanQuestionRequest = PlanQuestionRequest & InteractionPanelRequestMeta;
type InteractionPlanApprovalRequest = PlanApprovalRequest & InteractionPanelRequestMeta;

export type PendingInteractionPanel =
  | { readonly kind: "commandApproval"; readonly request: InteractionCommandApprovalRequest }
  | { readonly kind: "planQuestion"; readonly request: InteractionPlanQuestionRequest }
  | { readonly kind: "planApproval"; readonly request: InteractionPlanApprovalRequest };

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

const pickNumber = (value: Record<string, unknown>, key: string): number | null => {
  const next = value[key];
  return typeof next === "number" && Number.isFinite(next) ? next : null;
};

const planStatusFromValue = (value: string | null): PlanApprovalRequest["status"] =>
  value === "draft" || value === "proposed" || value === "approved" || value === "rejected"
    ? value
    : "proposed";

const toPlanBlock = (value: unknown): AgentPlanBlock | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = pickString(value, "id");
  const kind = pickString(value, "kind");
  const title = pickString(value, "title");
  const body = pickString(value, "body");
  if (id === null || kind === null || title === null || body === null) {
    return null;
  }
  return { id, kind, title, body };
};

const toPlanBlocks = (value: unknown): readonly AgentPlanBlock[] =>
  Array.isArray(value)
    ? value.map(toPlanBlock).filter((block): block is AgentPlanBlock => block !== null)
    : [];

const toPlanArtifact = (value: unknown): AgentPlanArtifact | null => {
  if (!isRecord(value)) {
    return null;
  }
  const planId = pickString(value, "planId");
  const title = pickString(value, "title");
  const summary = pickString(value, "summary");
  const objective = pickString(value, "objective");
  if (planId === null || title === null || summary === null || objective === null) {
    return null;
  }
  return {
    planId,
    status: planStatusFromValue(pickString(value, "status")),
    title,
    summary,
    objective,
    assumptions: toPlanBlocks(value.assumptions),
    steps: toPlanBlocks(value.steps),
    interfaces: toPlanBlocks(value.interfaces),
    risks: toPlanBlocks(value.risks),
    tests: toPlanBlocks(value.tests),
    acceptanceCriteria: toPlanBlocks(value.acceptanceCriteria),
  };
};

const toCommandApprovalRequest = (
  interaction: AgentPendingInteraction,
  labels: InteractionTextBundle
): InteractionCommandApprovalRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const rawPayload = isRecord(payload.raw) ? payload.raw : payload;
  const inputPayload = isRecord(rawPayload.input) ? rawPayload.input : {};
  const metadataPayload = isRecord(rawPayload.metadata) ? rawPayload.metadata : {};
  const toolCallId =
    pickString(rawPayload, "itemId")
    ?? pickString(rawPayload, "approvalId")
    ?? interaction.id;
  const riskLevelCandidate = pickString(metadataPayload, "riskLevel");
  const riskLevel: CommandApprovalRequest["riskLevel"] =
    riskLevelCandidate === "safe"
    || riskLevelCandidate === "low"
    || riskLevelCandidate === "medium"
    || riskLevelCandidate === "high"
    || riskLevelCandidate === "critical"
      ? riskLevelCandidate
      : "medium";
  const defaultToolName =
    interaction.kind === "file_change_approval"
      ? "filesystem.write"
      : interaction.kind === "permissions_approval"
        ? "permissions.request"
        : "terminal.exec";
  const toolName = pickString(rawPayload, "toolName") ?? defaultToolName;
  const commandPreview =
    interaction.kind === "command_execution_approval"
      ? resolveCommandApprovalCommandPreview({
        toolName,
        inputPayload,
        metadataPayload,
      })
      : interaction.kind === "file_change_approval"
        ? "Approve file changes"
        : "Approve permission request";
  const requestedPermissions =
    interaction.kind === "permissions_approval" && isRecord(rawPayload)
      ? rawPayload.permissions
      : undefined;
  return {
    id: interaction.id,
    interactionId: interaction.id,
    interactionKind: interaction.kind,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    toolCallId,
    toolName,
    toolLabel: resolveCommandApprovalToolLabel(toolName, labels),
    command: commandPreview,
    riskLevel,
    riskDescription:
      pickString(rawPayload, "reason")
      ?? pickString(rawPayload, "message")
      ?? labels.commandNeedsApproval,
    ...(pickString(inputPayload, "cwd") === null ? {} : { cwd: pickString(inputPayload, "cwd")! }),
    ...(pickString(metadataPayload, "mode") === "command"
    || pickString(metadataPayload, "mode") === "shell"
        ? { mode: pickString(metadataPayload, "mode") as "command" | "shell" }
        : {}),
    ...(pickString(metadataPayload, "interactiveCategory") === null
        ? {}
        : { interactiveCategory: pickString(metadataPayload, "interactiveCategory")! }),
    isRepeat: metadataPayload.wasPreApproved === true,
    ...(requestedPermissions === undefined ? {} : { requestedPermissions }),
  };
};

const toPlanQuestionRequest = (
  interaction: AgentPendingInteraction
): InteractionPlanQuestionRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const rawPayload = isRecord(payload.raw) ? payload.raw : payload;

  if (interaction.kind === "tool_user_input") {
    const questions = Array.isArray(rawPayload.questions) ? rawPayload.questions : null;
    if (questions === null || questions.length === 0) {
      return null;
    }
    return {
      id: interaction.id,
      interactionId: interaction.id,
      interactionKind: interaction.kind,
      sessionId: interaction.sessionId,
      turnId: interaction.turnId,
      questions: questions as PlanQuestionRequest["questions"],
      allowNote: true,
    };
  }

  if (interaction.kind === "mcp_elicitation") {
    const header = pickString(rawPayload, "serverName") ?? "MCP";
    const question =
      pickString(rawPayload, "message")
      ?? pickString(rawPayload, "title")
      ?? pickString(rawPayload, "prompt")
      ?? "Provide input for MCP request";
    return {
      id: interaction.id,
      interactionId: interaction.id,
      interactionKind: interaction.kind,
      sessionId: interaction.sessionId,
      turnId: interaction.turnId,
      questions: [
        {
          id: "response",
          header,
          question,
          options: [],
          allowOther: true,
        },
      ],
      allowNote: true,
    };
  }

  return null;
};

const toPlanApprovalRequest = (
  interaction: AgentPendingInteraction,
  labels: InteractionTextBundle
): InteractionPlanApprovalRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const rawPayload = isRecord(payload.raw) ? payload.raw : payload;
  const artifact = toPlanArtifact(rawPayload.artifact);
  if (artifact === null) {
    return null;
  }
  const planId = pickString(rawPayload, "planId") ?? artifact.planId;

  return {
    id: interaction.id,
    interactionId: interaction.id,
    interactionKind: interaction.kind,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    planId,
    version: pickNumber(rawPayload, "version") ?? 0,
    status: planStatusFromValue(pickString(rawPayload, "status")),
    summary:
      pickString(rawPayload, "summary")
      ?? artifact.summary
      ?? labels.proposedPlanSummaryFallback,
    artifact,
  };
};

export const toPendingInteractionPanel = (
  interaction: AgentPendingInteraction,
  labels: InteractionTextBundle
): PendingInteractionPanel | null => {
  if (
    interaction.kind === "command_execution_approval"
    || interaction.kind === "file_change_approval"
    || interaction.kind === "permissions_approval"
  ) {
    const request = toCommandApprovalRequest(interaction, labels);
    return request === null ? null : { kind: "commandApproval", request };
  }
  if (interaction.kind === "tool_user_input" || interaction.kind === "mcp_elicitation") {
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
