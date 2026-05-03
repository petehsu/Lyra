import type {
  AgentRuntimeEvent,
  AgentToolCall,
} from "../../../../shared/desktop-bridge";
import type { LyraTurnPlanState } from "../use-lyra-thread-runtime";

export type AgentRuntimeFeedStatus = "running" | "completed" | "failed";

export type AgentRuntimeFeedIconKind =
  | "search"
  | "readRange"
  | "list"
  | "glob"
  | "write"
  | "edit"
  | "multiEdit"
  | "agent"
  | "tool";

export type AgentTerminalTranscriptStream = "stdin" | "stdout" | "stderr";

export type AgentTerminalTranscriptChunk = {
  readonly stream: AgentTerminalTranscriptStream;
  readonly text: string;
  readonly timestamp: number;
};

export type AgentTerminalTranscript = {
  readonly command?: string;
  readonly cwd?: string;
  readonly processId?: string;
  readonly chunks: readonly AgentTerminalTranscriptChunk[];
  readonly outputLength: number;
  readonly exitCode?: number | null;
  readonly durationMs?: number | null;
};

export type AgentRuntimeThreadTarget = {
  readonly threadId: string;
  readonly label: string;
};

export type AgentRuntimeFeedItem = {
  readonly id: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly toolLabel: string;
  readonly target: string;
  readonly icon: AgentRuntimeFeedIconKind;
  readonly sessionId?: string;
  readonly openPath?: string;
  readonly openThreadId?: string;
  readonly openThreadTargets?: readonly AgentRuntimeThreadTarget[];
  readonly autoOpen?: boolean;
  readonly firstChangedLine?: number;
  readonly addedLines?: number;
  readonly removedLines?: number;
  readonly status: AgentRuntimeFeedStatus;
  readonly timestamp: number;
  readonly liveOutput?: string;
  readonly terminalTranscript?: AgentTerminalTranscript;
};

export type AgentTurnTimelineItem =
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly timestamp: number;
      readonly tool: AgentRuntimeFeedItem;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly timestamp: number;
      readonly content: string;
    }
  | {
      readonly kind: "plan";
      readonly id: string;
      readonly timestamp: number;
      readonly plan: LyraTurnPlanState;
      readonly sessionId: string;
    };

type RuntimeToolTarget = {
  readonly target: string;
  readonly openPath?: string;
  readonly openThreadId?: string;
  readonly openThreadTargets?: readonly AgentRuntimeThreadTarget[];
};

export type ToolNameLabelMap = {
  readonly search: string;
  readonly readRange: string;
  readonly list: string;
  readonly glob: string;
  readonly write: string;
  readonly edit: string;
  readonly multiEdit: string;
  readonly terminalSession: string;
  readonly terminalRead: string;
  readonly terminalInput: string;
  readonly terminalClose: string;
  readonly terminalExec: string;
  readonly collabSpawnAgent: string;
  readonly collabSendInput: string;
  readonly collabResumeAgent: string;
  readonly collabWait: string;
  readonly collabCloseAgent: string;
  readonly collabAgent: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const pickString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next : null;
};

const normalizeRuntimePath = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const shellTerminated = trimmed.replace(/;+$/u, "");
  if (shellTerminated === "/dev/null" || shellTerminated === "dev/null") {
    return null;
  }
  return trimmed;
};

const pickPathString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" ? normalizeRuntimePath(next) : null;
};

const pickNumber = (value: Record<string, unknown>, key: string): number | null => {
  const next = value[key];
  return typeof next === "number" ? next : null;
};

const pickRawString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" ? next : null;
};

const pickTerminalStream = (value: unknown): AgentTerminalTranscriptStream | null =>
  value === "stdin" || value === "stdout" || value === "stderr" ? value : null;

const readTerminalChunks = (
  value: unknown,
  fallbackTimestamp: number
): readonly AgentTerminalTranscriptChunk[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const stream = pickTerminalStream(entry.stream);
      const text = pickRawString(entry, "text");
      if (stream === null || text === null || text.length === 0) {
        return null;
      }
      return {
        stream,
        text,
        timestamp: pickNumber(entry, "timestamp") ?? fallbackTimestamp,
      };
    })
    .filter((entry): entry is AgentTerminalTranscriptChunk => entry !== null);
};

const terminalOutputFromChunks = (
  chunks: readonly AgentTerminalTranscriptChunk[]
): string => chunks.map((chunk) => chunk.text).join("");

const createTerminalTranscript = (
  toolName: string,
  inputPayload: Record<string, unknown> | null,
  outputPayload: Record<string, unknown> | null,
  timestamp: number
): AgentTerminalTranscript | undefined => {
  if (!isTerminalToolName(toolName)) {
    return undefined;
  }
  const chunks = readTerminalChunks(outputPayload?.terminalChunks, timestamp);
  const aggregatedOutput =
    outputPayload === null
      ? null
      : pickRawString(outputPayload, "aggregatedOutput")
        ?? pickRawString(outputPayload, "liveOutput")
        ?? pickRawString(outputPayload, "output");
  const transcriptChunks = chunks.length > 0
    ? chunks
    : aggregatedOutput === null || aggregatedOutput.length === 0
      ? []
      : [{ stream: "stdout" as const, text: aggregatedOutput, timestamp }];
  const command = inputPayload === null ? null : pickRawString(inputPayload, "command");
  const cwd = inputPayload === null ? null : pickRawString(inputPayload, "cwd");
  const processId = outputPayload === null ? null : pickRawString(outputPayload, "processId");
  if (
    transcriptChunks.length === 0
    && command === null
    && cwd === null
    && processId === null
  ) {
    return undefined;
  }
  const exitCode = outputPayload === null ? null : pickNumber(outputPayload, "exitCode");
  const durationMs = outputPayload === null ? null : pickNumber(outputPayload, "durationMs");
  return {
    ...(command === null ? {} : { command }),
    ...(cwd === null ? {} : { cwd }),
    ...(processId === null ? {} : { processId }),
    chunks: transcriptChunks,
    outputLength: transcriptChunks.reduce((total, chunk) => total + chunk.text.length, 0),
    ...(exitCode === null ? {} : { exitCode }),
    ...(durationMs === null ? {} : { durationMs }),
  };
};

export const normalizeToolName = (toolName: string, labels: ToolNameLabelMap): string => {
  switch (toolName) {
    case "filesystem.search":
      return labels.search;
    case "filesystem.read_range":
      return labels.readRange;
    case "filesystem.list":
      return labels.list;
    case "filesystem.glob":
      return labels.glob;
    case "filesystem.write":
      return labels.write;
    case "filesystem.edit":
      return labels.edit;
    case "filesystem.multi_edit":
      return labels.multiEdit;
    case "filesystem.apply_patch":
      return labels.edit;
    case "terminal.session.start":
      return labels.terminalSession;
    case "terminal.session.read":
      return labels.terminalRead;
    case "terminal.session.write":
      return labels.terminalInput;
    case "terminal.session.close":
      return labels.terminalClose;
    case "terminal.exec":
      return labels.terminalExec;
    case "collab.spawnAgent":
      return labels.collabSpawnAgent;
    case "collab.sendInput":
      return labels.collabSendInput;
    case "collab.resumeAgent":
      return labels.collabResumeAgent;
    case "collab.wait":
      return labels.collabWait;
    case "collab.closeAgent":
      return labels.collabCloseAgent;
    default:
      return toolName;
  }
};

const resolveRuntimeToolIconKind = (toolName: string): AgentRuntimeFeedIconKind => {
  switch (toolName) {
    case "filesystem.search":
      return "search";
    case "filesystem.read_range":
      return "readRange";
    case "filesystem.list":
      return "list";
    case "filesystem.glob":
      return "glob";
    case "filesystem.write":
      return "write";
    case "filesystem.edit":
      return "edit";
    case "filesystem.multi_edit":
      return "multiEdit";
    case "filesystem.apply_patch":
      return "edit";
    case "terminal.exec":
      return "tool";
    case "collab.spawnAgent":
    case "collab.sendInput":
    case "collab.resumeAgent":
    case "collab.wait":
    case "collab.closeAgent":
      return "agent";
    default:
      return "tool";
  }
};

export const isWriteToolName = (toolName: string): boolean =>
  toolName === "filesystem.write" ||
  toolName === "filesystem.edit" ||
  toolName === "filesystem.multi_edit" ||
  toolName === "filesystem.apply_patch";

export const isTerminalToolName = (toolName: string): boolean =>
  toolName === "terminal.exec"
  || toolName === "terminal.session.start"
  || toolName === "terminal.session.read"
  || toolName === "terminal.session.write"
  || toolName === "terminal.session.close";

const pickPathField = (value: Record<string, unknown>): string | null =>
  pickPathString(value, "path")
  ?? pickPathString(value, "rootPath")
  ?? pickPathString(value, "root")
  ?? pickPathString(value, "relativePath");

const pickStringArray = (value: Record<string, unknown>, key: string): readonly string[] => {
  const next = value[key];
  return Array.isArray(next)
    ? next.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
};

const resolveRuntimeToolTarget = (
  toolName: string,
  payload: Record<string, unknown>,
  labels: ToolNameLabelMap,
  toolFallbackLabel: string
): RuntimeToolTarget => {
  const input = isRecord(payload.input) ? payload.input : payload;
  const output = isRecord(payload.output) ? payload.output : null;
  const source = input;
  const fallbackTarget = normalizeToolName(toolName, labels);
  const path = pickPathField(source) ?? (output === null ? null : pickPathField(output));
  const query = pickString(source, "query") ?? pickString(source, "pattern");

  if (toolName.startsWith("collab.")) {
    const receiverThreadIds = [
      ...pickStringArray(source, "receiverThreadIds"),
      ...(output === null ? [] : pickStringArray(output, "receiverThreadIds")),
    ].filter((value, index, values) => values.indexOf(value) === index);
    const receiverThreadTargets = receiverThreadIds.map((threadId) => ({
      threadId,
      label: threadId,
    }));
    const prompt = pickString(source, "prompt") ?? (output === null ? null : pickString(output, "prompt"));
    const model = pickString(source, "model") ?? (output === null ? null : pickString(output, "model"));
    const targetParts = [
      receiverThreadIds.length > 1 ? receiverThreadIds.join(", ") : receiverThreadIds[0],
      model,
      prompt,
    ].filter((value): value is string => value !== undefined && value !== null && value.length > 0);
    return {
      target: targetParts.length > 0
        ? targetParts.join(" · ")
        : normalizeToolName(toolName, labels) || labels.collabAgent,
      ...(receiverThreadIds[0] === undefined ? {} : { openThreadId: receiverThreadIds[0] }),
      ...(receiverThreadTargets.length === 0 ? {} : { openThreadTargets: receiverThreadTargets }),
    };
  }

  if (toolName === "filesystem.read_range") {
    if (path !== null) {
      const startLine = pickNumber(source, "startLine");
      const endLine = pickNumber(source, "endLine");
      if (startLine !== null && endLine !== null) {
        return {
          target: `${path}:${String(startLine)}-${String(endLine)}`,
          openPath: path
        };
      }
      return {
        target: path,
        openPath: path
      };
    }
    return { target: fallbackTarget };
  }

  if (toolName === "filesystem.list") {
    if (path !== null) {
      return {
        target: path,
        openPath: path
      };
    }
    return { target: fallbackTarget };
  }

  if (toolName === "terminal.exec") {
    const cmd = pickString(source, "command");
    if (cmd !== null) {
      return { target: cmd };
    }
    return { target: fallbackTarget };
  }

  if (toolName === "terminal.session.start") {
    const sessionId = pickString(output ?? source, "sessionId");
    const mode = pickString(output ?? source, "mode");
    const command = pickString(source, "command") ?? pickString(output ?? source, "command");
    const target = [sessionId, mode, command]
      .filter((value): value is string => value !== null && value.length > 0)
      .join(" · ");
    return { target: target.length > 0 ? target : fallbackTarget };
  }

  if (
    toolName === "terminal.session.read"
    || toolName === "terminal.session.write"
    || toolName === "terminal.session.close"
  ) {
    const sessionId =
      pickString(source, "sessionId")
      ?? (output === null ? null : pickString(output, "sessionId"));
    return { target: sessionId ?? fallbackTarget };
  }

  if (toolName === "filesystem.glob") {
    if (path !== null && query !== null) {
      return {
        target: `${path} · ${query}`,
        openPath: path
      };
    }
    if (path !== null) {
      return {
        target: path,
        openPath: path
      };
    }
    if (query !== null) {
      return { target: query };
    }
    return { target: fallbackTarget };
  }

  if (toolName === "filesystem.search") {
    if (path !== null && query !== null) {
      return {
        target: `${path} · ${query}`,
        openPath: path
      };
    }
    if (path !== null) {
      return {
        target: path,
        openPath: path
      };
    }
    if (query !== null) {
      return { target: query };
    }
    return { target: fallbackTarget };
  }

  if (isWriteToolName(toolName)) {
    const writePath = (output === null ? null : pickPathField(output)) ?? path;
    if (writePath !== null) {
      return {
        target: writePath,
        openPath: writePath
      };
    }
    return { target: fallbackTarget };
  }

  if (path !== null) {
    return {
      target: path,
      openPath: path
    };
  }
  if (query !== null) {
    return { target: query };
  }
  return {
    target: fallbackTarget.length > 0 ? fallbackTarget : toolFallbackLabel
  };
};

const resolveFirstChangedLine = (payload: Record<string, unknown>): number | undefined => {
  const output = isRecord(payload.output) ? payload.output : null;
  if (output !== null) {
    const value = pickNumber(output, "firstChangedLine");
    if (value !== null && Number.isFinite(value)) {
      return Math.max(1, Math.round(value));
    }
  }
  const progress = isRecord(payload.progress) ? payload.progress : null;
  if (progress !== null) {
    const value = pickNumber(progress, "firstChangedLine");
    if (value !== null && Number.isFinite(value)) {
      return Math.max(1, Math.round(value));
    }
  }
  return undefined;
};

const resolveRuntimeLineCount = (
  payload: Record<string, unknown>,
  keys: readonly string[]
): number | undefined => {
  const sources = [
    payload,
    isRecord(payload.output) ? payload.output : null,
    isRecord(payload.progress) ? payload.progress : null,
    isRecord(payload.input) ? payload.input : null,
  ].filter((source): source is Record<string, unknown> => source !== null);
  for (const source of sources) {
    for (const key of keys) {
      const value = pickNumber(source, key);
      if (value !== null && Number.isFinite(value)) {
        return Math.max(0, Math.round(value));
      }
    }
  }
  return undefined;
};

export const toRuntimeFeedItem = (
  event: AgentRuntimeEvent,
  toolNameLabels: ToolNameLabelMap,
  toolFallbackLabel: string
): AgentRuntimeFeedItem | null => {
  if (
    event.phase !== "tool_started"
    && event.phase !== "tool_progress"
    && event.phase !== "tool_finished"
  ) {
    return null;
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  const toolName = pickString(payload, "toolName") ?? toolFallbackLabel;
  const target = resolveRuntimeToolTarget(toolName, payload, toolNameLabels, toolFallbackLabel);
  const outputPayload = isRecord(payload.output) ? payload.output : null;
  const inputPayload = isRecord(payload.input) ? payload.input : null;
  const terminalTranscript = createTerminalTranscript(
    toolName,
    inputPayload,
    outputPayload,
    event.timestamp
  );
  const sessionId =
    (outputPayload === null ? null : pickString(outputPayload, "sessionId"))
    ?? (inputPayload === null ? null : pickString(inputPayload, "sessionId"));
  const toolCallId =
    pickString(payload, "toolCallId")
    ?? sessionId
    ?? `${event.turnId}-${toolName}-${String(event.timestamp)}`;
  const toolLabel =
    typeof toolName === "string" && toolName.length > 0
      ? normalizeToolName(toolName, toolNameLabels)
      : toolFallbackLabel;
  const firstChangedLine = resolveFirstChangedLine(payload);
  const addedLines = resolveRuntimeLineCount(payload, ["addedLines", "added_lines"]);
  const removedLines = resolveRuntimeLineCount(payload, ["removedLines", "removed_lines"]);
  const status: AgentRuntimeFeedStatus =
    event.phase === "tool_started" || event.phase === "tool_progress"
      ? "running"
      : pickString(payload, "status") === "failed"
        ? "failed"
        : "completed";

  return {
    id: toolCallId,
    turnId: event.turnId,
    toolName,
    toolLabel,
    target: target.target,
    ...(sessionId === null ? {} : { sessionId }),
    ...(target.openPath === undefined ? {} : { openPath: target.openPath }),
    ...(target.openThreadId === undefined ? {} : { openThreadId: target.openThreadId }),
    ...(target.openThreadTargets === undefined ? {} : { openThreadTargets: target.openThreadTargets }),
    ...(isWriteToolName(toolName) || toolName === "filesystem.read_range"
      ? { autoOpen: true }
      : {}),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    ...(addedLines === undefined ? {} : { addedLines }),
    ...(removedLines === undefined ? {} : { removedLines }),
    icon: resolveRuntimeToolIconKind(toolName),
    status,
    timestamp: event.timestamp,
    ...(terminalTranscript === undefined
      ? {}
      : {
          terminalTranscript,
          liveOutput: terminalOutputFromChunks(terminalTranscript.chunks),
        }),
  };
};

export const toPersistedRuntimeFeedItem = (
  call: AgentToolCall,
  toolNameLabels: ToolNameLabelMap,
  toolFallbackLabel: string
): AgentRuntimeFeedItem => {
  const payload = {
    toolName: call.toolName,
    input: call.input,
    output: call.output
  };
  const inputPayload = isRecord(call.input) ? call.input : null;
  const outputPayload = isRecord(call.output) ? call.output : null;
  const terminalTranscript = createTerminalTranscript(
    call.toolName,
    inputPayload,
    outputPayload,
    call.finishedAt ?? call.startedAt
  );
  const sessionId =
    (outputPayload === null ? null : pickString(outputPayload, "sessionId"))
    ?? (inputPayload === null ? null : pickString(inputPayload, "sessionId"));
  const firstChangedLine = resolveFirstChangedLine(payload);
  const addedLines = resolveRuntimeLineCount(payload, ["addedLines", "added_lines"]);
  const removedLines = resolveRuntimeLineCount(payload, ["removedLines", "removed_lines"]);
  const target = resolveRuntimeToolTarget(call.toolName, payload, toolNameLabels, toolFallbackLabel);
  return {
    id: call.id,
    turnId: call.turnId,
    toolName: call.toolName,
    toolLabel: normalizeToolName(call.toolName, toolNameLabels),
    target: target.target,
    ...(sessionId === null ? {} : { sessionId }),
    ...(target.openPath === undefined ? {} : { openPath: target.openPath }),
    ...(target.openThreadId === undefined ? {} : { openThreadId: target.openThreadId }),
    ...(target.openThreadTargets === undefined ? {} : { openThreadTargets: target.openThreadTargets }),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    ...(addedLines === undefined ? {} : { addedLines }),
    ...(removedLines === undefined ? {} : { removedLines }),
    icon: resolveRuntimeToolIconKind(call.toolName),
    status: call.status,
    timestamp: call.startedAt,
    ...(terminalTranscript === undefined
      ? {}
      : {
          terminalTranscript,
          liveOutput: terminalOutputFromChunks(terminalTranscript.chunks),
        }),
  };
};

const runtimeStatusRank = (status: AgentRuntimeFeedStatus): number => {
  if (status === "running") {
    return 0;
  }
  if (status === "completed") {
    return 1;
  }
  return 2;
};

const mergeTerminalTranscript = (
  current: AgentTerminalTranscript | undefined,
  next: AgentTerminalTranscript | undefined
): AgentTerminalTranscript | undefined => {
  if (current === undefined) {
    return next;
  }
  if (next === undefined) {
    return current;
  }
  const chunks = next.chunks.length >= current.chunks.length
    ? next.chunks
    : current.chunks;
  return {
    ...current,
    ...next,
    chunks,
    outputLength: chunks.reduce((total, chunk) => total + chunk.text.length, 0),
  };
};

export const mergeRuntimeFeedItem = (
  current: AgentRuntimeFeedItem | undefined,
  next: AgentRuntimeFeedItem
): AgentRuntimeFeedItem => {
  if (current === undefined) {
    return next;
  }
  if (
    current.sessionId !== undefined
    && next.sessionId !== undefined
    && current.sessionId === next.sessionId
  ) {
    const liveOutput = next.liveOutput ?? current.liveOutput;
    const terminalTranscript = mergeTerminalTranscript(
      current.terminalTranscript,
      next.terminalTranscript
    );
    return {
      ...current,
      ...next,
      id: current.id,
      status:
        runtimeStatusRank(next.status) >= runtimeStatusRank(current.status)
          ? next.status
          : current.status,
      ...(liveOutput === undefined ? {} : { liveOutput }),
      ...(terminalTranscript === undefined ? {} : { terminalTranscript }),
    };
  }
  if (next.timestamp > current.timestamp) {
    return next;
  }
  if (
    next.timestamp === current.timestamp &&
    runtimeStatusRank(next.status) >= runtimeStatusRank(current.status)
  ) {
    return next;
  }
  return current;
};

const appendOrMergeTimelineText = (
  items: AgentTurnTimelineItem[],
  turnId: string,
  kind: "assistant",
  timestamp: number,
  content: string
): void => {
  if (content.length === 0) {
    return;
  }
  const lastItem = items[items.length - 1];
  if (lastItem !== undefined && lastItem.kind === kind) {
    const nextContent = `${lastItem.content}${content}`;
    items[items.length - 1] = {
      ...lastItem,
      timestamp: Math.max(lastItem.timestamp, timestamp),
      content: nextContent
    };
    return;
  }
  items.push({
    kind,
    id: `${turnId}-${kind}-${String(items.length + 1)}`,
    timestamp,
    content
  });
};

const resolveTimelineEventPriority = (event: AgentRuntimeEvent): number => {
  if (event.phase === "assistant_delta") {
    return 0;
  }
  if (
    event.phase === "tool_started"
    || event.phase === "tool_progress"
    || event.phase === "tool_finished"
  ) {
    return 1;
  }
  return 2;
};

export const buildTurnTimelineItems = ({
  turnId,
  messageContent,
  messageCreatedAt,
  runtimeEvents,
  runtimeFeedItems,
  toolNameLabels,
  runtimeToolFallbackLabel
}: {
  readonly turnId: string;
  readonly messageContent: string;
  readonly messageCreatedAt: number;
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
  readonly runtimeFeedItems: readonly AgentRuntimeFeedItem[];
  readonly toolNameLabels: ToolNameLabelMap;
  readonly runtimeToolFallbackLabel: string;
}): readonly AgentTurnTimelineItem[] => {
  const timelineItems: AgentTurnTimelineItem[] = [];
  const toolIndexById = new Map<string, number>();
  let hasNarrativeTimeline = false;
  const sortedEvents = runtimeEvents
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      if (left.event.timestamp !== right.event.timestamp) {
        return left.event.timestamp - right.event.timestamp;
      }
      const priorityDiff = resolveTimelineEventPriority(left.event) - resolveTimelineEventPriority(right.event);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.event);

  for (const event of sortedEvents) {
    const payload = isRecord(event.payload) ? event.payload : {};
    if (event.phase === "assistant_delta") {
      const delta = pickRawString(payload, "delta") ?? "";
      appendOrMergeTimelineText(timelineItems, turnId, "assistant", event.timestamp, delta);
      if (delta.length > 0) {
        hasNarrativeTimeline = true;
      }
    }

    const runtimeItem = toRuntimeFeedItem(event, toolNameLabels, runtimeToolFallbackLabel);
    if (runtimeItem === null) {
      continue;
    }

    const existingIndex = toolIndexById.get(runtimeItem.id);
    if (existingIndex === undefined) {
      toolIndexById.set(runtimeItem.id, timelineItems.length);
      timelineItems.push({
        kind: "tool",
        id: `tool-${runtimeItem.id}`,
        timestamp: runtimeItem.timestamp,
        tool: runtimeItem
      });
      continue;
    }

    const existing = timelineItems[existingIndex];
    if (existing === undefined || existing.kind !== "tool") {
      continue;
    }
    timelineItems[existingIndex] = {
      ...existing,
      timestamp: Math.max(existing.timestamp, runtimeItem.timestamp),
      tool: mergeRuntimeFeedItem(existing.tool, runtimeItem)
    };
  }

  for (const runtimeItem of runtimeFeedItems) {
    if (toolIndexById.has(runtimeItem.id)) {
      continue;
    }
    toolIndexById.set(runtimeItem.id, timelineItems.length);
    timelineItems.push({
      kind: "tool",
      id: `tool-${runtimeItem.id}`,
      timestamp: runtimeItem.timestamp,
      tool: runtimeItem
    });
  }

  const trimmedMessage = messageContent.trim();
  const assistantSegments = timelineItems.filter(
    (item): item is Extract<AgentTurnTimelineItem, { kind: "assistant" }> =>
      item.kind === "assistant"
  );
  const aggregatedAssistantContent = assistantSegments
    .map((item) => item.content)
    .join("")
    .trim();
  const shouldAppendMessage =
    trimmedMessage.length > 0
    && (
      assistantSegments.length === 0
      || !aggregatedAssistantContent.includes(trimmedMessage)
    );
  if (shouldAppendMessage) {
    const finalAssistantItem: AgentTurnTimelineItem = {
      kind: "assistant",
      id: `${turnId}-assistant-final`,
      timestamp: messageCreatedAt,
      content: messageContent
    };
    const hasToolItems = timelineItems.some((item) => item.kind === "tool");
    if (!hasNarrativeTimeline && hasToolItems) {
      timelineItems.unshift(finalAssistantItem);
    } else {
      timelineItems.push(finalAssistantItem);
    }
  } else if (
    assistantSegments.length > 0
    && trimmedMessage.length > aggregatedAssistantContent.length
  ) {
    for (let index = timelineItems.length - 1; index >= 0; index -= 1) {
      const item = timelineItems[index];
      if (item?.kind !== "assistant") {
        continue;
      }
      timelineItems[index] = {
        ...item,
        timestamp: Math.max(item.timestamp, messageCreatedAt),
        content: messageContent
      };
      break;
    }
  }

  return timelineItems;
};
