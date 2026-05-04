import type {
  AgentMessage,
  AgentMessageContentPart,
  AgentSession,
  AgentSessionDetail,
  AgentTurn,
} from "./agent-ui-types";
import {
  basename,
  isRecord,
  readCollaborationMode,
  readNumber,
  readAgentUsage,
  readPath,
  readRawString,
  readString,
  toMs,
  turnStatusToAgent,
  type LyraThread,
  type LyraThreadItem,
  type LyraTurn,
} from "./lyra-thread-adapter-shared";

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
  const usage = readAgentUsage(value.usage);
  return {
    id,
    status: readString(value.status) ?? "completed",
    collaborationMode: readCollaborationMode(value.collaborationMode ?? value.collaborationModeKind),
    items: Array.isArray(value.items)
      ? value.items.map(readThreadItem).filter((item): item is LyraThreadItem => item !== null)
      : [],
    startedAt: readNumber(value.startedAt),
    completedAt: readNumber(value.completedAt),
    durationMs: readNumber(value.durationMs),
    ...(usage === undefined ? {} : { usage }),
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

export const threadTitle = (thread: LyraThread): string =>
  thread.name?.trim() || thread.preview.trim() || "New thread";

const latestThreadCollaborationMode = (thread: LyraThread): AgentSession["collaborationMode"] => {
  const latestTurn = [...thread.turns].sort((left, right) =>
    toMs(right.startedAt ?? right.completedAt ?? null, thread.updatedAt)
    - toMs(left.startedAt ?? left.completedAt ?? null, thread.updatedAt)
  )[0];
  return latestTurn?.collaborationMode ?? "default";
};

export const createAgentSession = (thread: LyraThread): AgentSession => {
  const projectRoot = thread.boundProjectRoot ?? null;
  return {
    id: thread.id,
    title: threadTitle(thread),
    profileId: thread.modelProvider,
    collaborationMode: latestThreadCollaborationMode(thread),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(projectRoot === null || projectRoot === undefined ? {} : { projectRoot }),
    ...(basename(projectRoot) === undefined ? {} : { projectName: basename(projectRoot)! }),
  };
};

export const lyraThreadTurnsToAgentDetail = (thread: LyraThread): AgentSessionDetail => {
  const session = createAgentSession(thread);
  const turns: AgentTurn[] = [];
  const messages: AgentMessage[] = [];

  thread.turns.forEach((turn, turnIndex) => {
    const createdAt = toMs(turn.startedAt ?? null, thread.createdAt + turnIndex);
    const updatedAt = toMs(turn.completedAt ?? null, createdAt);
    turns.push({
      id: turn.id,
      sessionId: thread.id,
      profileId: thread.modelProvider,
      status: turnStatusToAgent(turn.status),
      collaborationMode: turn.collaborationMode,
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
      createdAt,
      updatedAt,
    });
    turn.items.forEach((item, itemIndex) => {
      const message = messageFromItem(thread, turn, item, itemIndex);
      if (message !== null) {
        messages.push(message);
      }
    });
  });

  return {
    session,
    pendingInteractions: [],
    turns,
    messages,
    runtimeEvents: [],
  };
};

export const buildThreadTitle = (thread: LyraThread | null, fallback: string): string =>
  thread === null ? fallback : threadTitle(thread);
