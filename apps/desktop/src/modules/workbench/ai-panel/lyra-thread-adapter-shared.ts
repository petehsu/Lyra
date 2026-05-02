import type {
  AgentPlanArtifact,
  AgentPendingInteraction,
  AgentSessionDetail,
  AgentToolCall,
  AgentTurn,
  AgentUsage,
} from "../../../shared/desktop-bridge";

export type JsonRecord = Record<string, unknown>;
export type AgentToolCallStatus = AgentToolCall["status"];
export type AgentTurnStatus = AgentTurn["status"];

export type LyraThreadItem = JsonRecord & {
  readonly type: string;
  readonly id?: string;
};

export type LyraTurn = {
  readonly id: string;
  readonly status: string;
  readonly items: readonly LyraThreadItem[];
  readonly startedAt?: number | null;
  readonly completedAt?: number | null;
  readonly durationMs?: number | null;
  readonly usage?: AgentUsage;
};

export type LyraThread = {
  readonly id: string;
  readonly preview: string;
  readonly name?: string | null;
  readonly cwd?: string | null;
  readonly boundProjectRoot?: string | null;
  readonly modelProvider: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly turns: readonly LyraTurn[];
  readonly aiPanelViewModel?: ThreadAiPanelViewModel | null;
};

export type ThreadAiPanelMessageContentPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "attachment";
    readonly name: string;
    readonly path: string;
    readonly kind?: "file" | "directory" | "local_image" | "image";
  };

export type ThreadAiPanelMessage = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly role: "user" | "assistant" | string;
  readonly content: string;
  readonly displayContent?: string;
  readonly contentParts?: readonly ThreadAiPanelMessageContentPart[];
  readonly createdAtMs: number;
};

export type ThreadAiPanelTurn = {
  readonly id: string;
  readonly sessionId: string;
  readonly status: AgentTurnStatus | string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly usage?: AgentUsage;
};

export type ThreadAiPanelToolCall = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly status: AgentToolCallStatus | string;
  readonly startedAtMs: number;
  readonly finishedAtMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
};

export type ThreadAiPanelPlan = {
  readonly turnId: string;
  readonly artifact: AgentPlanArtifact;
  readonly updatedAtMs: number;
};

export type ThreadAiPanelTurnMeta = {
  readonly turnId: string;
  readonly sessionId: string;
  readonly firstAssistantMessageId?: string;
  readonly lastAssistantMessageId?: string;
  readonly assistantOrder?: number;
  readonly hasAssistantDisplay: boolean;
};

export type ThreadAiPanelPendingInteraction = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly kind: "planApproval" | string;
  readonly status: "pending" | "resolved" | "cancelled" | "expired" | string;
  readonly payload: unknown;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type ThreadAiPanelViewModel = {
  readonly messages: readonly ThreadAiPanelMessage[];
  readonly turns: readonly ThreadAiPanelTurn[];
  readonly toolCalls: readonly ThreadAiPanelToolCall[];
  readonly plans: readonly ThreadAiPanelPlan[];
  readonly pendingInteractions?: readonly ThreadAiPanelPendingInteraction[];
  readonly turnMeta: readonly ThreadAiPanelTurnMeta[];
};

export type AiPanelAgentSessionDetail = AgentSessionDetail & {
  readonly aiPanelTurnMeta?: readonly ThreadAiPanelTurnMeta[];
  readonly pendingInteractions: readonly AgentPendingInteraction[];
};

export const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const readRawString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readUsageNumber = (value: unknown): number | undefined => {
  const numberValue = readNumber(value);
  return numberValue === null ? undefined : Math.max(0, Math.round(numberValue));
};

export const readAgentUsage = (value: unknown): AgentUsage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const inputTokens = readUsageNumber(value.inputTokens);
  const cachedInputTokens = readUsageNumber(value.cachedInputTokens);
  const outputTokens = readUsageNumber(value.outputTokens);
  const reasoningOutputTokens = readUsageNumber(value.reasoningOutputTokens);
  const totalTokens = readUsageNumber(value.totalTokens);
  const modelContextWindow = readUsageNumber(value.modelContextWindow);
  const usage: AgentUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(modelContextWindow === undefined ? {} : { modelContextWindow }),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
};

export const readStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

export const toMs = (value: number | null | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value < 10_000_000_000 ? value * 1000 : value;
};

export const normalizeStatus = (value: unknown): string =>
  readString(value)?.replace(/[_\s-]+/g, "").toLowerCase() ?? "";

export const turnStatusToAgent = (status: string): AgentTurnStatus => {
  const normalized = normalizeStatus(status);
  if (normalized === "inprogress" || normalized === "running") {
    return "running";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "interrupted" || normalized === "paused" || normalized === "waiting") {
    return "paused";
  }
  return "completed";
};

export const toolStatusToAgent = (
  value: unknown,
  fallback: AgentToolCallStatus
): AgentToolCallStatus => {
  const normalized = normalizeStatus(value);
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "failed";
  }
  if (
    normalized.includes("complete")
    || normalized.includes("success")
    || normalized.includes("applied")
  ) {
    return "completed";
  }
  if (normalized.includes("progress") || normalized.includes("running") || normalized.includes("pending")) {
    return "running";
  }
  return fallback;
};

export const readPath = (value: unknown): string | null => {
  const direct = readString(value);
  if (direct !== null) {
    return direct;
  }
  if (isRecord(value)) {
    return readString(value.path) ?? readString(value.display);
  }
  return null;
};

export const basename = (path: string | null | undefined): string | undefined => {
  if (path === null || path === undefined) {
    return undefined;
  }
  if (/^data:image\//iu.test(path)) {
    return "image";
  }
  const normalized = path.trim().replace(/\\/g, "/");
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.split("/").filter(Boolean).at(-1);
};
