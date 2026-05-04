import type {
  AgentPlanArtifact,
  AgentPlanBlock,
  AgentPendingInteraction,
  AgentPendingInteractionKind,
  AgentQuestionItem,
  AgentQuestionOption,
  AgentQuestionRequest,
  PlanApprovalRequest,
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

type InteractionAgentQuestionRequest = AgentQuestionRequest & InteractionPanelRequestMeta;
type InteractionPlanApprovalRequest = PlanApprovalRequest & InteractionPanelRequestMeta;

export type McpElicitationFieldOption = {
  readonly value: string;
  readonly label: string;
};

export type McpElicitationField = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: "string" | "number" | "boolean" | "single_select" | "multi_select";
  readonly required: boolean;
  readonly options: readonly McpElicitationFieldOption[];
  readonly defaultValue?: string | number | boolean | readonly string[];
};

export type InteractionMcpElicitationRequest = InteractionPanelRequestMeta & {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly serverName: string;
  readonly mode: "form" | "url";
  readonly message: string;
  readonly url?: string;
  readonly elicitationId?: string;
  readonly fields: readonly McpElicitationField[];
  readonly meta?: Record<string, unknown>;
};

export type PendingInteractionPanel =
  | { readonly kind: "commandApproval"; readonly request: InteractionCommandApprovalRequest }
  | { readonly kind: "agentQuestion"; readonly request: InteractionAgentQuestionRequest }
  | { readonly kind: "mcpElicitation"; readonly request: InteractionMcpElicitationRequest }
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

const pickBoolean = (value: Record<string, unknown>, key: string): boolean | null => {
  const next = value[key];
  return typeof next === "boolean" ? next : null;
};

const pickRecord = (value: Record<string, unknown>, key: string): Record<string, unknown> | null => {
  const next = value[key];
  return isRecord(next) ? next : null;
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

const normalizeQuestionOption = (value: unknown): AgentQuestionOption | null => {
  if (!isRecord(value)) {
    return null;
  }
  const label = pickString(value, "label");
  const description = pickString(value, "description");
  if (label === null) {
    return null;
  }
  return {
    label,
    description: description ?? "",
    ...(pickString(value, "preview") === null ? {} : { preview: pickString(value, "preview")! }),
  };
};

const normalizeQuestion = (value: unknown): AgentQuestionItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = pickString(value, "id");
  const header = pickString(value, "header");
  const question = pickString(value, "question");
  if (id === null || header === null || question === null) {
    return null;
  }
  const options = Array.isArray(value.options)
    ? value.options.map(normalizeQuestionOption).filter((option): option is AgentQuestionOption => option !== null)
    : [];
  const explicitOther =
    pickBoolean(value, "allowOther")
    ?? pickBoolean(value, "isOther")
    ?? pickBoolean(value, "is_other")
    ?? false;
  const isSecret = pickBoolean(value, "isSecret") ?? pickBoolean(value, "is_secret") ?? false;
  return {
    id,
    header,
    question,
    options,
    allowOther: explicitOther || options.length === 0,
    ...(isSecret ? { isSecret } : {}),
  };
};

const normalizeAgentQuestionSource = (
  value: Record<string, unknown>
): NonNullable<AgentQuestionRequest["source"]> => {
  const agentThreadId = pickString(value, "agentThreadId") ?? pickString(value, "agent_thread_id");
  const agentNickname = pickString(value, "agentNickname") ?? pickString(value, "agent_nickname");
  const agentRole = pickString(value, "agentRole") ?? pickString(value, "agent_role");
  return {
    ...(agentThreadId === null ? {} : { agentThreadId }),
    ...(agentNickname === null ? {} : { agentNickname }),
    ...(agentRole === null ? {} : { agentRole }),
  };
};

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

const toAgentQuestionRequest = (
  interaction: AgentPendingInteraction
): InteractionAgentQuestionRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const rawPayload = isRecord(payload.raw) ? payload.raw : payload;

  if (interaction.kind === "agent_question" || interaction.kind === "tool_user_input") {
    const questions = Array.isArray(rawPayload.questions)
      ? rawPayload.questions.map(normalizeQuestion).filter((question): question is AgentQuestionItem => question !== null)
      : [];
    if (questions.length === 0) {
      return null;
    }
    const source = pickRecord(rawPayload, "source");
    const reason = pickString(rawPayload, "reason");
    return {
      id: interaction.id,
      interactionId: interaction.id,
      interactionKind: interaction.kind,
      sessionId: interaction.sessionId,
      turnId: interaction.turnId,
      ...(reason === null ? {} : { reason }),
      ...(source === null ? {} : { source: normalizeAgentQuestionSource(source) }),
      questions,
      allowNote: true,
    };
  }

  return null;
};

const enumOptions = (schema: Record<string, unknown>): readonly McpElicitationFieldOption[] => {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf
      .map((entry): McpElicitationFieldOption | null => {
        if (!isRecord(entry)) {
          return null;
        }
        const value = pickString(entry, "const");
        if (value === null) {
          return null;
        }
        return { value, label: pickString(entry, "title") ?? value };
      })
      .filter((entry): entry is McpElicitationFieldOption => entry !== null);
  }
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : undefined;
    return schema.enum
      .filter((entry): entry is string => typeof entry === "string")
      .map((value, index) => ({
        value,
        label: typeof names?.[index] === "string" ? names[index] : value,
      }));
  }
  const items = pickRecord(schema, "items");
  const anyOf = items === null ? undefined : (Array.isArray(items.anyOf) ? items.anyOf : items.oneOf);
  if (Array.isArray(anyOf)) {
    return anyOf
      .map((entry): McpElicitationFieldOption | null => {
        if (!isRecord(entry)) {
          return null;
        }
        const value = pickString(entry, "const");
        if (value === null) {
          return null;
        }
        return { value, label: pickString(entry, "title") ?? value };
      })
      .filter((entry): entry is McpElicitationFieldOption => entry !== null);
  }
  if (items !== null && Array.isArray(items.enum)) {
    return items.enum
      .filter((entry): entry is string => typeof entry === "string")
      .map((value) => ({ value, label: value }));
  }
  return [];
};

const mcpFieldDefault = (schema: Record<string, unknown>): string | number | boolean | readonly string[] | undefined => {
  const value = schema.default;
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  ) {
    return value;
  }
  return undefined;
};

const mcpFieldKind = (
  schema: Record<string, unknown>,
  options: readonly McpElicitationFieldOption[]
): McpElicitationField["kind"] => {
  if (schema.type === "boolean") {
    return "boolean";
  }
  if (schema.type === "number" || schema.type === "integer") {
    return "number";
  }
  if (schema.type === "array") {
    return "multi_select";
  }
  return options.length > 0 ? "single_select" : "string";
};

const toMcpElicitationRequest = (
  interaction: AgentPendingInteraction
): InteractionMcpElicitationRequest | null => {
  if (!isRecord(interaction.payload)) {
    return null;
  }
  const payload = interaction.payload;
  const rawPayload = isRecord(payload.raw) ? payload.raw : payload;
  const mode = pickString(rawPayload, "mode") === "url" ? "url" : "form";
  const serverName = pickString(rawPayload, "serverName") ?? "MCP";
  const message = pickString(rawPayload, "message") ?? "MCP request needs input";
  const meta = pickRecord(rawPayload, "_meta");
  const requestedSchema = pickRecord(rawPayload, "requestedSchema");
  const properties = requestedSchema === null ? null : pickRecord(requestedSchema, "properties");
  const required = requestedSchema !== null && Array.isArray(requestedSchema.required)
    ? new Set(requestedSchema.required.filter((entry): entry is string => typeof entry === "string"))
    : new Set<string>();
  const fields = properties === null
    ? []
    : Object.entries(properties)
        .map(([id, schema]): McpElicitationField | null => {
          if (!isRecord(schema)) {
            return null;
          }
          const options = enumOptions(schema);
          const defaultValue = mcpFieldDefault(schema);
          return {
            id,
            label: pickString(schema, "title") ?? id,
            ...(pickString(schema, "description") === null ? {} : { description: pickString(schema, "description")! }),
            kind: mcpFieldKind(schema, options),
            required: required.has(id),
            options,
            ...(defaultValue === undefined ? {} : { defaultValue }),
          };
        })
        .filter((field): field is McpElicitationField => field !== null);

  return {
    id: interaction.id,
    interactionId: interaction.id,
    interactionKind: interaction.kind,
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    serverName,
    mode,
    message,
    fields,
    ...(pickString(rawPayload, "url") === null ? {} : { url: pickString(rawPayload, "url")! }),
    ...(pickString(rawPayload, "elicitationId") === null ? {} : { elicitationId: pickString(rawPayload, "elicitationId")! }),
    ...(meta === null ? {} : { meta }),
  };
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
  if (interaction.kind === "agent_question" || interaction.kind === "tool_user_input") {
    const request = toAgentQuestionRequest(interaction);
    return request === null ? null : { kind: "agentQuestion", request };
  }
  if (interaction.kind === "mcp_elicitation") {
    const request = toMcpElicitationRequest(interaction);
    return request === null ? null : { kind: "mcpElicitation", request };
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
