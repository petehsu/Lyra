import type {
  AgentMessageContentPart,
  AgentMessage,
  AgentSession,
  AgentSessionDetail,
  AgentToolCall,
  AgentTurn,
} from "../../../shared/desktop-bridge";

type JsonRecord = Record<string, unknown>;
type AgentToolCallStatus = AgentToolCall["status"];
type AgentTurnStatus = AgentTurn["status"];

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
};

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readRawString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const toMs = (value: number | null | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value < 10_000_000_000 ? value * 1000 : value;
};

const normalizeStatus = (value: unknown): string =>
  readString(value)?.replace(/[_\s-]+/g, "").toLowerCase() ?? "";

const turnStatusToAgent = (status: string): AgentTurnStatus => {
  const normalized = normalizeStatus(status);
  if (normalized === "inprogress" || normalized === "running") {
    return "running";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "interrupted" || normalized === "paused") {
    return "paused";
  }
  return "completed";
};

const toolStatusToAgent = (
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

const readPath = (value: unknown): string | null => {
  const direct = readString(value);
  if (direct !== null) {
    return direct;
  }
  if (isRecord(value)) {
    return readString(value.path) ?? readString(value.display);
  }
  return null;
};

const basename = (path: string | null | undefined): string | undefined => {
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

const readThreadItem = (value: unknown): LyraThreadItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  if (type === null) {
    return null;
  }
  return {
    ...value,
    type,
    ...(readString(value.id) === null ? {} : { id: readString(value.id)! }),
  };
};

const readTurn = (value: unknown): LyraTurn | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  if (id === null) {
    return null;
  }
  return {
    id,
    status: readString(value.status) ?? "completed",
    items: Array.isArray(value.items)
      ? value.items.map(readThreadItem).filter((item): item is LyraThreadItem => item !== null)
      : [],
    startedAt: readNumber(value.startedAt),
    completedAt: readNumber(value.completedAt),
    durationMs: readNumber(value.durationMs),
  };
};

export const readLyraThread = (value: unknown): LyraThread | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  if (id === null) {
    return null;
  }
  const createdAt = toMs(readNumber(value.createdAt), Date.now());
  return {
    id,
    preview: readString(value.preview) ?? "",
    name: readString(value.name),
    cwd: readPath(value.cwd),
    boundProjectRoot: readPath(value.boundProjectRoot),
    modelProvider: readString(value.modelProvider) ?? "lyra",
    createdAt,
    updatedAt: toMs(readNumber(value.updatedAt), createdAt),
    turns: Array.isArray(value.turns)
      ? value.turns.map(readTurn).filter((turn): turn is LyraTurn => turn !== null)
      : [],
  };
};

const renderUserInput = (input: unknown): string => {
  if (!isRecord(input)) {
    return "";
  }
  const type = readString(input.type);
  if (type === "text") {
    return readString(input.text) ?? "";
  }
  if (type === "image") {
    return `[image] ${readString(input.url) ?? ""}`.trim();
  }
  if (type === "localImage") {
    return `[local image] ${readPath(input.path) ?? ""}`.trim();
  }
  if (type === "skill") {
    return `[skill] ${readString(input.name) ?? readPath(input.path) ?? ""}`.trim();
  }
  if (type === "mention") {
    return `[mention] ${readString(input.name) ?? readString(input.path) ?? ""}`.trim();
  }
  return "";
};

const userInputContentPart = (input: unknown): AgentMessageContentPart | null => {
  if (!isRecord(input)) {
    return null;
  }
  const type = readString(input.type);
  if (type === "text") {
    const text = readRawString(input.text);
    return text === null || text.length === 0 ? null : { type: "text", text };
  }
  if (type === "mention") {
    const path = readString(input.path);
    const name = readString(input.name) ?? path;
    if (path === null || name === null) {
      return null;
    }
    return {
      type: "attachment",
      name,
      path,
      kind: path.endsWith("/") ? "directory" : "file",
    };
  }
  if (type === "localImage") {
    const path = readPath(input.path);
    if (path === null) {
      return null;
    }
    return {
      type: "attachment",
      name: basename(path) ?? path,
      path,
      kind: "local_image",
    };
  }
  if (type === "image") {
    const url = readString(input.url);
    if (url === null) {
      return null;
    }
    return {
      type: "attachment",
      name: basename(url) ?? url,
      path: url,
      kind: "image",
    };
  }
  return null;
};

const userInputContentParts = (content: readonly unknown[]): readonly AgentMessageContentPart[] => {
  const parts = content
    .map(userInputContentPart)
    .filter((part): part is AgentMessageContentPart => part !== null);
  return parts.length === 0 ? [] : parts;
};

const firstChangePath = (item: LyraThreadItem): string | null => {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  for (const change of changes) {
    if (!isRecord(change)) {
      continue;
    }
    const path = readPath(change.path);
    if (path !== null) {
      return path;
    }
  }
  return null;
};

const toolTiming = (
  turn: LyraTurn,
  thread: LyraThread,
  index: number
): { readonly startedAt: number; readonly finishedAt?: number } => {
  const startedAt = toMs(turn.startedAt ?? null, thread.updatedAt) + index;
  const completedAt = toMs(turn.completedAt ?? null, startedAt);
  const status = turnStatusToAgent(turn.status);
  return {
    startedAt,
    ...(status === "running" ? {} : { finishedAt: completedAt }),
  };
};

export const threadItemToToolCall = (
  thread: LyraThread,
  turn: LyraTurn,
  item: LyraThreadItem,
  index: number
): AgentToolCall | null => {
  const fallbackStatus: AgentToolCallStatus =
    turnStatusToAgent(turn.status) === "running" ? "running" : "completed";
  const timing = toolTiming(turn, thread, index);
  const id = item.id ?? `${turn.id}:${item.type}:${String(index)}`;
  const base = {
    id,
    sessionId: thread.id,
    turnId: turn.id,
    startedAt: timing.startedAt,
    ...("finishedAt" in timing ? { finishedAt: timing.finishedAt } : {}),
  };

  if (item.type === "commandExecution") {
    return {
      ...base,
      toolName: "terminal.exec",
      input: {
        command: readString(item.command) ?? "",
        cwd: readPath(item.cwd) ?? thread.cwd ?? undefined,
        commandActions: item.commandActions,
      },
      output: {
        aggregatedOutput: readString(item.aggregatedOutput) ?? "",
        exitCode: readNumber(item.exitCode),
        durationMs: readNumber(item.durationMs),
      },
      status: toolStatusToAgent(item.status, fallbackStatus),
    };
  }

  if (item.type === "fileChange") {
    return {
      ...base,
      toolName: "filesystem.write",
      input: {
        path: firstChangePath(item) ?? thread.cwd ?? "",
        changes: item.changes,
      },
      output: {
        status: item.status,
        changes: item.changes,
      },
      status: toolStatusToAgent(item.status, fallbackStatus),
    };
  }

  if (item.type === "dynamicToolCall") {
    return {
      ...base,
      toolName: readString(item.tool) ?? "dynamic.tool",
      input: item.arguments ?? {},
      output: {
        contentItems: item.contentItems,
        success: item.success,
        durationMs: readNumber(item.durationMs),
      },
      status: toolStatusToAgent(item.status, fallbackStatus),
    };
  }

  if (item.type === "mcpToolCall") {
    const server = readString(item.server) ?? "mcp";
    const tool = readString(item.tool) ?? "tool";
    const errorMessage = isRecord(item.error) ? readString(item.error.message) : null;
    return {
      ...base,
      toolName: `mcp.${server}.${tool}`,
      input: {
        server,
        tool,
        arguments: item.arguments,
      },
      output: item.error ?? item.result ?? {},
      status: toolStatusToAgent(item.status, fallbackStatus),
      ...(errorMessage === null ? {} : { errorMessage }),
    };
  }

  if (item.type === "collabAgentToolCall") {
    const tool = readString(item.tool) ?? "agent";
    const receiverThreadIds = readStringArray(item.receiverThreadIds);
    return {
      ...base,
      toolName: `collab.${tool}`,
      input: {
        senderThreadId: readString(item.senderThreadId) ?? thread.id,
        receiverThreadIds,
        prompt: readString(item.prompt),
        model: readString(item.model),
        reasoningEffort: readString(item.reasoningEffort),
      },
      output: {
        receiverThreadIds,
        agentsStates: item.agentsStates ?? {},
      },
      status: toolStatusToAgent(item.status, fallbackStatus),
    };
  }

  if (item.type === "webSearch") {
    return {
      ...base,
      toolName: "filesystem.search",
      input: { query: readString(item.query) ?? "" },
      output: { action: item.action },
      status: "completed",
    };
  }

  if (item.type === "imageGeneration") {
    return {
      ...base,
      toolName: "image.generate",
      input: { prompt: readString(item.revisedPrompt) ?? "" },
      output: {
        result: readString(item.result) ?? "",
        savedPath: readPath(item.savedPath),
      },
      status: toolStatusToAgent(item.status, fallbackStatus),
    };
  }

  return null;
};

const messageFromItem = (
  thread: LyraThread,
  turn: LyraTurn,
  item: LyraThreadItem,
  index: number
): AgentMessage | null => {
  const id = item.id ?? `${turn.id}:${item.type}:${String(index)}`;
  const createdAt = toMs(turn.startedAt ?? null, thread.createdAt) + index;
  if (item.type === "userMessage") {
    const contentParts = Array.isArray(item.content)
      ? userInputContentParts(item.content)
      : [];
    const content = Array.isArray(item.content)
      ? item.content.map(renderUserInput).filter(Boolean).join("").trim()
      : "";
    return content.length === 0
      ? null
      : {
          id,
          sessionId: thread.id,
          turnId: turn.id,
          role: "user",
          content,
          ...(contentParts.length === 0 ? {} : { contentParts }),
          createdAt,
        };
  }
  if (item.type === "agentMessage") {
    const content = readString(item.text) ?? "";
    return content.length === 0
      ? null
      : {
          id,
          sessionId: thread.id,
          turnId: turn.id,
          role: "assistant",
          content,
          displayContent: content,
          createdAt,
        };
  }
  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.map((entry) => readString(entry)).filter((entry): entry is string => entry !== null)
      : [];
    const content = summary.join("\n").trim();
    return content.length === 0
      ? null
      : {
          id,
          sessionId: thread.id,
          turnId: turn.id,
          role: "assistant",
          content,
          displayContent: content,
          createdAt,
        };
  }
  return null;
};

const threadTitle = (thread: LyraThread): string =>
  thread.name?.trim() || thread.preview.trim() || "New thread";

export const lyraThreadToAgentDetail = (thread: LyraThread): AgentSessionDetail => {
  const projectRoot = thread.boundProjectRoot ?? null;
  const session: AgentSession = {
    id: thread.id,
    title: threadTitle(thread),
    profileId: thread.modelProvider,
    collaborationMode: "default",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(projectRoot === null || projectRoot === undefined ? {} : { projectRoot }),
    ...(basename(projectRoot) === undefined ? {} : { projectName: basename(projectRoot)! }),
  };
  const turns: AgentTurn[] = [];
  const messages: AgentMessage[] = [];
  const toolCalls: AgentToolCall[] = [];

  thread.turns.forEach((turn, turnIndex) => {
    const createdAt = toMs(turn.startedAt ?? null, thread.createdAt + turnIndex);
    const updatedAt = toMs(turn.completedAt ?? null, createdAt);
    turns.push({
      id: turn.id,
      sessionId: thread.id,
      profileId: thread.modelProvider,
      status: turnStatusToAgent(turn.status),
      createdAt,
      updatedAt,
    });
    turn.items.forEach((item, itemIndex) => {
      const message = messageFromItem(thread, turn, item, itemIndex);
      if (message !== null) {
        messages.push(message);
      }
      const toolCall = threadItemToToolCall(thread, turn, item, itemIndex);
      if (toolCall !== null) {
        toolCalls.push(toolCall);
      }
    });
  });

  return {
    session,
    executionCheckpoints: [],
    pendingInteractions: [],
    turns,
    messages,
    toolCalls,
    runtimeEvents: [],
  };
};

export const buildThreadTitle = (thread: LyraThread | null, fallback: string): string =>
  thread === null ? fallback : threadTitle(thread);
