import type {
  AgentMessage,
  AgentPlanArtifact,
  AgentPlanBlock,
  AgentPendingInteraction,
  AgentToolCall,
  AgentTurn,
} from "../../../shared/desktop-bridge";
import {
  isRecord,
  normalizeStatus,
  readAgentUsage,
  readNumber,
  readRawString,
  readString,
  toolStatusToAgent,
  turnStatusToAgent,
  type AgentToolCallStatus,
  type AgentTurnStatus,
  type AiPanelAgentSessionDetail,
  type LyraThread,
  type ThreadAiPanelMessage,
  type ThreadAiPanelMessageContentPart,
  type ThreadAiPanelPendingInteraction,
  type ThreadAiPanelPlan,
  type ThreadAiPanelToolCall,
  type ThreadAiPanelTurn,
  type ThreadAiPanelTurnMeta,
  type ThreadAiPanelViewModel,
} from "./lyra-thread-adapter-shared";
import {
  createAgentSession,
  lyraThreadTurnsToAgentDetail,
} from "./lyra-thread-legacy-turns-adapter";

const readAgentToolStatus = (value: unknown): AgentToolCallStatus => toolStatusToAgent(value, "completed");

const readAgentTurnStatus = (value: unknown): AgentTurnStatus => turnStatusToAgent(readString(value) ?? "");

const readPendingInteractionStatus = (
  value: unknown
): AgentPendingInteraction["status"] => {
  const normalized = normalizeStatus(value);
  if (normalized === "resolved") {
    return "resolved";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  if (normalized === "expired") {
    return "expired";
  }
  return "pending";
};

const readPendingInteractionKind = (
  value: unknown
): AgentPendingInteraction["kind"] | null => {
  const normalized = normalizeStatus(value);
  if (normalized === "planapproval") {
    return "plan_approval";
  }
  if (normalized === "commandexecutionapproval") {
    return "command_execution_approval";
  }
  if (normalized === "filechangeapproval") {
    return "file_change_approval";
  }
  if (normalized === "permissionsapproval") {
    return "permissions_approval";
  }
  if (normalized === "tooluserinput") {
    return "tool_user_input";
  }
  if (normalized === "mcpelicitation") {
    return "mcp_elicitation";
  }
  return null;
};

const normalizeAiPanelAttachmentKind = (
  value: unknown
): "file" | "directory" | "local_image" | "image" | undefined => {
  const normalized = normalizeStatus(value);
  if (normalized === "directory") {
    return "directory";
  }
  if (normalized === "localimage") {
    return "local_image";
  }
  if (normalized === "image") {
    return "image";
  }
  if (normalized === "file") {
    return "file";
  }
  return undefined;
};

const readAiPanelMessageContentPart = (value: unknown): ThreadAiPanelMessageContentPart | null => {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  if (type === "text") {
    const text = readRawString(value.text);
    return text === null ? null : { type: "text", text };
  }
  if (type === "attachment") {
    const name = readString(value.name);
    const path = readString(value.path);
    if (name === null || path === null) {
      return null;
    }
    const kind = normalizeAiPanelAttachmentKind(value.kind);
    return {
      type: "attachment",
      name,
      path,
      ...(kind === undefined ? {} : { kind }),
    };
  }
  return null;
};

const readAiPanelMessage = (value: unknown): ThreadAiPanelMessage | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const sessionId = readString(value.sessionId);
  const role = readString(value.role);
  const content = readRawString(value.content);
  const createdAtMs = readNumber(value.createdAtMs);
  if (id === null || sessionId === null || role === null || content === null || createdAtMs === null) {
    return null;
  }
  const contentParts = Array.isArray(value.contentParts)
    ? value.contentParts
        .map(readAiPanelMessageContentPart)
        .filter((part): part is ThreadAiPanelMessageContentPart => part !== null)
    : [];
  return {
    id,
    sessionId,
    ...(readString(value.turnId) === null ? {} : { turnId: readString(value.turnId)! }),
    role,
    content,
    ...(readRawString(value.displayContent) === null ? {} : { displayContent: readRawString(value.displayContent)! }),
    ...(contentParts.length === 0 ? {} : { contentParts }),
    createdAtMs,
  };
};

const readAiPanelTurn = (value: unknown): ThreadAiPanelTurn | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const sessionId = readString(value.sessionId);
  const createdAtMs = readNumber(value.createdAtMs);
  const updatedAtMs = readNumber(value.updatedAtMs);
  if (id === null || sessionId === null || createdAtMs === null || updatedAtMs === null) {
    return null;
  }
  const usage = readAgentUsage(value.usage);
  return {
    id,
    sessionId,
    status: readAgentTurnStatus(value.status),
    createdAtMs,
    updatedAtMs,
    ...(readNumber(value.durationMs) === null ? {} : { durationMs: readNumber(value.durationMs)! }),
    ...(readString(value.errorCode) === null ? {} : { errorCode: readString(value.errorCode)! }),
    ...(readString(value.errorMessage) === null ? {} : { errorMessage: readString(value.errorMessage)! }),
    ...(usage === undefined ? {} : { usage }),
  };
};

const readAiPanelToolCall = (value: unknown): ThreadAiPanelToolCall | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const sessionId = readString(value.sessionId);
  const turnId = readString(value.turnId);
  const toolName = readString(value.toolName);
  const startedAtMs = readNumber(value.startedAtMs);
  if (id === null || sessionId === null || turnId === null || toolName === null || startedAtMs === null) {
    return null;
  }
  return {
    id,
    sessionId,
    turnId,
    toolName,
    input: value.input,
    ...(value.output === undefined ? {} : { output: value.output }),
    status: readAgentToolStatus(value.status),
    startedAtMs,
    ...(readNumber(value.finishedAtMs) === null ? {} : { finishedAtMs: readNumber(value.finishedAtMs)! }),
    ...(readString(value.errorCode) === null ? {} : { errorCode: readString(value.errorCode)! }),
    ...(readString(value.errorMessage) === null ? {} : { errorMessage: readString(value.errorMessage)! }),
  };
};

const readPlanBlock = (value: unknown): AgentPlanBlock | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const kind = readString(value.kind);
  const title = readString(value.title);
  const body = readString(value.body);
  if (id === null || kind === null || title === null || body === null) {
    return null;
  }
  return { id, kind, title, body };
};

const readPlanBlocks = (value: unknown): readonly AgentPlanBlock[] =>
  Array.isArray(value)
    ? value.map(readPlanBlock).filter((block): block is AgentPlanBlock => block !== null)
    : [];

const readPlanStatus = (value: unknown): AgentPlanArtifact["status"] => {
  const normalized = normalizeStatus(value);
  if (normalized === "proposed" || normalized === "submitted") {
    return "proposed";
  }
  if (normalized === "approved") {
    return "approved";
  }
  if (normalized === "rejected") {
    return "rejected";
  }
  return "draft";
};

const readPlanArtifact = (value: unknown): AgentPlanArtifact | null => {
  if (!isRecord(value)) {
    return null;
  }
  const planId = readString(value.planId);
  const title = readString(value.title);
  const summary = readString(value.summary);
  const objective = readString(value.objective);
  if (planId === null || title === null || summary === null || objective === null) {
    return null;
  }
  return {
    planId,
    status: readPlanStatus(value.status),
    title,
    summary,
    objective,
    assumptions: readPlanBlocks(value.assumptions),
    steps: readPlanBlocks(value.steps),
    interfaces: readPlanBlocks(value.interfaces),
    risks: readPlanBlocks(value.risks),
    tests: readPlanBlocks(value.tests),
    acceptanceCriteria: readPlanBlocks(value.acceptanceCriteria),
  };
};

const readAiPanelPlan = (value: unknown): ThreadAiPanelPlan | null => {
  if (!isRecord(value)) {
    return null;
  }
  const turnId = readString(value.turnId);
  const updatedAtMs = readNumber(value.updatedAtMs);
  const artifact = readPlanArtifact(value.artifact);
  if (turnId === null || updatedAtMs === null || artifact === null) {
    return null;
  }
  return {
    turnId,
    artifact,
    updatedAtMs,
  };
};

const readAiPanelTurnMeta = (value: unknown): ThreadAiPanelTurnMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const turnId = readString(value.turnId);
  const sessionId = readString(value.sessionId);
  if (turnId === null || sessionId === null) {
    return null;
  }
  return {
    turnId,
    sessionId,
    ...(readString(value.firstAssistantMessageId) === null
      ? {}
      : { firstAssistantMessageId: readString(value.firstAssistantMessageId)! }),
    ...(readString(value.lastAssistantMessageId) === null
      ? {}
      : { lastAssistantMessageId: readString(value.lastAssistantMessageId)! }),
    ...(readNumber(value.assistantOrder) === null ? {} : { assistantOrder: readNumber(value.assistantOrder)! }),
    hasAssistantDisplay: value.hasAssistantDisplay === true,
  };
};

const readAiPanelPendingInteraction = (value: unknown): ThreadAiPanelPendingInteraction | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const sessionId = readString(value.sessionId);
  const turnId = readString(value.turnId);
  const kind = readString(value.kind);
  const status = readString(value.status);
  const createdAtMs = readNumber(value.createdAtMs);
  const updatedAtMs = readNumber(value.updatedAtMs);
  if (
    id === null
    || sessionId === null
    || turnId === null
    || kind === null
    || status === null
    || createdAtMs === null
    || updatedAtMs === null
  ) {
    return null;
  }
  return {
    id,
    sessionId,
    turnId,
    kind,
    status,
    payload: value.payload,
    createdAtMs,
    updatedAtMs,
  };
};

export const readThreadAiPanelViewModel = (value: unknown): ThreadAiPanelViewModel | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    messages: Array.isArray(value.messages)
      ? value.messages.map(readAiPanelMessage).filter((message): message is ThreadAiPanelMessage => message !== null)
      : [],
    turns: Array.isArray(value.turns)
      ? value.turns.map(readAiPanelTurn).filter((turn): turn is ThreadAiPanelTurn => turn !== null)
      : [],
    toolCalls: Array.isArray(value.toolCalls)
      ? value.toolCalls.map(readAiPanelToolCall).filter((call): call is ThreadAiPanelToolCall => call !== null)
      : [],
    plans: Array.isArray(value.plans)
      ? value.plans.map(readAiPanelPlan).filter((plan): plan is ThreadAiPanelPlan => plan !== null)
      : [],
    pendingInteractions: Array.isArray(value.pendingInteractions)
      ? value.pendingInteractions
          .map(readAiPanelPendingInteraction)
          .filter((interaction): interaction is ThreadAiPanelPendingInteraction => interaction !== null)
      : [],
    turnMeta: Array.isArray(value.turnMeta)
      ? value.turnMeta.map(readAiPanelTurnMeta).filter((meta): meta is ThreadAiPanelTurnMeta => meta !== null)
      : [],
  };
};

export const attachThreadAiPanelViewModel = (
  thread: LyraThread,
  viewModel: ThreadAiPanelViewModel | null
): LyraThread => ({
  ...thread,
  aiPanelViewModel: viewModel,
});

export const aiPanelViewModelToAgentDetail = (
  thread: LyraThread,
  viewModel: ThreadAiPanelViewModel
): AiPanelAgentSessionDetail => {
  const session = createAgentSession(thread);
  const turns: AgentTurn[] = viewModel.turns.map((turn) => ({
    id: turn.id,
    sessionId: turn.sessionId,
    profileId: thread.modelProvider,
    status: turnStatusToAgent(turn.status),
    ...(turn.errorCode === undefined ? {} : { errorCode: turn.errorCode }),
    ...(turn.errorMessage === undefined ? {} : { errorMessage: turn.errorMessage }),
    ...(turn.usage === undefined ? {} : { usage: turn.usage }),
    createdAt: turn.createdAtMs,
    updatedAt: turn.updatedAtMs,
  }));
  const messages: AgentMessage[] = viewModel.messages.map((message) => ({
    id: message.id,
    sessionId: message.sessionId,
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    role: message.role,
    content: message.content,
    ...(message.contentParts === undefined ? {} : { contentParts: message.contentParts }),
    ...(message.displayContent === undefined ? {} : { displayContent: message.displayContent }),
    createdAt: message.createdAtMs,
  }));
  const toolCalls: AgentToolCall[] = viewModel.toolCalls.map((call) => ({
    id: call.id,
    sessionId: call.sessionId,
    turnId: call.turnId,
    toolName: call.toolName,
    input: call.input,
    ...(call.output === undefined ? {} : { output: call.output }),
    status: toolStatusToAgent(call.status, "completed"),
    ...(call.errorCode === undefined ? {} : { errorCode: call.errorCode }),
    ...(call.errorMessage === undefined ? {} : { errorMessage: call.errorMessage }),
    startedAt: call.startedAtMs,
    ...(call.finishedAtMs === undefined ? {} : { finishedAt: call.finishedAtMs }),
  }));
  const pendingInteractions: AgentPendingInteraction[] = (viewModel.pendingInteractions ?? [])
    .map((interaction): AgentPendingInteraction | null => {
      const kind = readPendingInteractionKind(interaction.kind);
      if (kind === null) {
        return null;
      }
      return {
        id: interaction.id,
        sessionId: interaction.sessionId,
        turnId: interaction.turnId,
        kind,
        status: readPendingInteractionStatus(interaction.status),
        payload: isRecord(interaction.payload) ? interaction.payload : { raw: interaction.payload },
        createdAt: interaction.createdAtMs,
        updatedAt: interaction.updatedAtMs,
      };
    })
    .filter((interaction): interaction is AgentPendingInteraction => interaction !== null);
  const fallbackDetail = lyraThreadTurnsToAgentDetail(thread);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  for (const message of fallbackDetail.messages) {
    if (!messageById.has(message.id)) {
      messageById.set(message.id, message);
    }
  }
  const turnById = new Map(turns.map((turn) => [turn.id, turn]));
  for (const turn of fallbackDetail.turns) {
    if (!turnById.has(turn.id)) {
      turnById.set(turn.id, turn);
    }
  }
  const toolCallById = new Map(toolCalls.map((call) => [call.id, call]));
  for (const call of fallbackDetail.toolCalls) {
    if (!toolCallById.has(call.id)) {
      toolCallById.set(call.id, call);
    }
  }
  return {
    session,
    pendingInteractions,
    turns: [...turnById.values()].sort((left, right) => left.createdAt - right.createdAt),
    messages: [...messageById.values()].sort((left, right) => left.createdAt - right.createdAt),
    toolCalls: [...toolCallById.values()].sort((left, right) => left.startedAt - right.startedAt),
    runtimeEvents: [],
    aiPanelTurnMeta: viewModel.turnMeta,
  };
};
