import type {
  AgentRuntimeEvent,
  AgentToolCall,
} from "../../../../shared/desktop-bridge";

export type AgentRuntimeFeedStatus = "running" | "completed" | "failed";

export type AgentRuntimeFeedIconKind =
  | "search"
  | "readRange"
  | "list"
  | "glob"
  | "write"
  | "edit"
  | "multiEdit"
  | "tool";

export type AgentRuntimeFeedItem = {
  readonly id: string;
  readonly turnId: string;
  readonly toolName: string;
  readonly toolLabel: string;
  readonly target: string;
  readonly icon: AgentRuntimeFeedIconKind;
  readonly sessionId?: string;
  readonly openPath?: string;
  readonly autoOpen?: boolean;
  readonly firstChangedLine?: number;
  readonly status: AgentRuntimeFeedStatus;
  readonly timestamp: number;
  readonly liveOutput?: string;
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
    };

type RuntimeToolTarget = {
  readonly target: string;
  readonly openPath?: string;
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
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const pickString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next : null;
};

const pickNumber = (value: Record<string, unknown>, key: string): number | null => {
  const next = value[key];
  return typeof next === "number" ? next : null;
};

const pickRawString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" ? next : null;
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
    case "terminal.exec":
      return "tool";
    default:
      return "tool";
  }
};

export const isWriteToolName = (toolName: string): boolean =>
  toolName === "filesystem.write" ||
  toolName === "filesystem.edit" ||
  toolName === "filesystem.multi_edit";

export const isTerminalToolName = (toolName: string): boolean =>
  toolName === "terminal.exec"
  || toolName === "terminal.session.start"
  || toolName === "terminal.session.read"
  || toolName === "terminal.session.write"
  || toolName === "terminal.session.close";

const pickPathField = (value: Record<string, unknown>): string | null =>
  pickString(value, "path")
  ?? pickString(value, "rootPath")
  ?? pickString(value, "root")
  ?? pickString(value, "relativePath");

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
    ...(isWriteToolName(toolName)
      ? { autoOpen: true }
      : {}),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    icon: resolveRuntimeToolIconKind(toolName),
    status,
    timestamp: event.timestamp
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
  const sessionId =
    (outputPayload === null ? null : pickString(outputPayload, "sessionId"))
    ?? (inputPayload === null ? null : pickString(inputPayload, "sessionId"));
  const firstChangedLine = resolveFirstChangedLine(payload);
  const target = resolveRuntimeToolTarget(call.toolName, payload, toolNameLabels, toolFallbackLabel);
  return {
    id: call.id,
    turnId: call.turnId,
    toolName: call.toolName,
    toolLabel: normalizeToolName(call.toolName, toolNameLabels),
    target: target.target,
    ...(sessionId === null ? {} : { sessionId }),
    ...(target.openPath === undefined ? {} : { openPath: target.openPath }),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    icon: resolveRuntimeToolIconKind(call.toolName),
    status: call.status,
    timestamp: call.startedAt
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
    return {
      ...current,
      ...next,
      id: current.id,
      status:
        runtimeStatusRank(next.status) >= runtimeStatusRank(current.status)
          ? next.status
          : current.status,
      ...(liveOutput === undefined ? {} : { liveOutput })
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
