import {
  Asterisk,
  BookText,
  FileCode,
  Files,
  FolderTree,
  Pencil,
  Search,
  Wrench
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTypewriter } from "./use-typewriter";

import type {
  AgentPendingInteraction,
  AgentRuntimeEvent,
  AgentSendTurnResult,
  AgentSessionDetail,
  AgentToolCall,
  AgentTurn,
  PlanApprovalRequest,
  PlanInteractionResponse,
  PlanQuestionRequest
} from "../../../shared/desktop-bridge";
import { subscribeAgentSessionSelected } from "../agent-session-events";
import { LyraBrandLogo } from "../brand";
import type { FileEditorRevealLocation } from "../file-editor";
import { createTranslator } from "../i18n";
import { AgentComposer } from "./agent-composer";
import {
  resolveCommandApprovalCommandPreview,
  resolveCommandApprovalToolLabel,
} from "./command-approval-display";
import { PlanApprovalBar } from "./plan-approval-bar";
import { PlanQuestionBar } from "./plan-question-bar";
import { renderAiPanelTopbarIcon } from "./icon-registry";
import { AiPanelRichContent } from "./rich-content";
import type { AiPanelSurfaceProps } from "./types";
import {
  CommandApprovalBar,
  type CommandApprovalRequest,
  type CommandApprovalResponse,
} from "../command-approval-bar";

const FEED_ITEM_LIMIT = 48;
const LOGO_URL = new URL("../../../renderer/assets/logo.svg", import.meta.url).toString();

type OptimisticUserMessage = {
  readonly id: string;
  readonly role: "user";
  readonly content: string;
  readonly createdAt: number;
  readonly optimistic: true;
};

type DisplayMessage = AgentSessionDetail["messages"][number] | OptimisticUserMessage;

type AgentRuntimeFeedStatus = "running" | "completed" | "failed";

type AgentRuntimeFeedIconKind =
  | "search"
  | "readRange"
  | "list"
  | "glob"
  | "write"
  | "edit"
  | "multiEdit"
  | "tool";

type AgentRuntimeFeedItem = {
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

type AgentTurnTimelineItem =
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

type StreamStatusTone = "running" | "waiting" | "completed" | "failed";

type StreamStatusItem = {
  readonly label: string;
  readonly tone: StreamStatusTone;
};

type PendingInteractionPanel =
  | { readonly kind: "commandApproval"; readonly request: CommandApprovalRequest }
  | { readonly kind: "planQuestion"; readonly request: PlanQuestionRequest }
  | { readonly kind: "planApproval"; readonly request: PlanApprovalRequest };

type ActiveInteractionPanel = PendingInteractionPanel | null;

type RuntimeToolTarget = {
  readonly target: string;
  readonly openPath?: string;
};

const sortByTime = <T extends { readonly createdAt: number }>(entries: readonly T[]): readonly T[] =>
  [...entries].sort((left, right) => left.createdAt - right.createdAt);

const resolveEventError = (event: AgentRuntimeEvent): string | null => {
  if (event.phase !== "failed") {
    return null;
  }
  if (event.payload === null || typeof event.payload !== "object") {
    return null;
  }
  const payload = event.payload as {
    readonly message?: unknown;
    readonly error?: { readonly message?: unknown };
  };
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  if (payload.error !== undefined && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return null;
};

const isSessionNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /session not found/i.test(message);
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

const formatDurationCompact = (durationMs: number): string => {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (remainSeconds === 0) {
    return `${String(minutes)}m`;
  }
  return `${String(minutes)}m ${String(remainSeconds)}s`;
};

const truncateDisplayText = (value: string, maxLength: number): string => {
  const chars = [...value.trim()];
  if (chars.length <= maxLength) {
    return chars.join("");
  }
  return `${chars.slice(0, maxLength).join("")}…`;
};

const normalizeStreamingStatusLabel = (label: string): string =>
  label.replace(/(?:\.\.\.|…)+\s*$/g, "").trim();

const internalReflectionHeadingPattern = /(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:reflection|反思)[\s\S]*$/i;

const sanitizeAssistantDisplayContent = (content: string): string => {
  if (content.length === 0) {
    return content;
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const withoutTaggedThinking = normalized
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "");
  const withoutTaggedReflection = withoutTaggedThinking
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, "")
    .replace(/<reflection>[\s\S]*$/gi, "");
  const headingMatch = internalReflectionHeadingPattern.exec(withoutTaggedReflection);
  if (headingMatch === null) {
    return withoutTaggedReflection;
  }
  const cutIndex = headingMatch.index + (headingMatch[0].startsWith("\n") ? 1 : 0);
  return withoutTaggedReflection.slice(0, cutIndex).trimEnd();
};

const runtimeEventPhasePriority = (phase: string): number => {
  if (phase === "failed") {
    return 8;
  }
  if (phase === "completed") {
    return 7;
  }
  if (phase === "paused" || phase === "interaction_pending") {
    return 6;
  }
  if (phase === "tool_finished") {
    return 5;
  }
  if (phase === "tool_started" || phase === "tool_progress") {
    return 4;
  }
  if (phase === "started") {
    return 3;
  }
  if (phase === "accepted") {
    return 2;
  }
  if (phase === "assistant_delta") {
    return 1;
  }
  return 0;
};

const pickMostRecentRuntimeEvent = (
  persisted: AgentRuntimeEvent | null,
  live: AgentRuntimeEvent | null
): AgentRuntimeEvent | null => {
  if (persisted === null) {
    return live;
  }
  if (live === null) {
    return persisted;
  }
  if (live.timestamp !== persisted.timestamp) {
    return live.timestamp > persisted.timestamp ? live : persisted;
  }
  return runtimeEventPhasePriority(live.phase) >= runtimeEventPhasePriority(persisted.phase)
    ? live
    : persisted;
};

const extractFolderName = (pathText: string): string => {
  const normalized = pathText.trim().replace(/\\/g, "/");
  if (normalized.length === 0) {
    return "";
  }
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return normalized;
  }
  return segments[segments.length - 1] ?? normalized;
};

type ToolNameLabelMap = {
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

const normalizeToolName = (toolName: string, labels: ToolNameLabelMap): string => {
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

const isWriteToolName = (toolName: string): boolean =>
  toolName === "filesystem.write" ||
  toolName === "filesystem.edit" ||
  toolName === "filesystem.multi_edit";

const isTerminalToolName = (toolName: string): boolean =>
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

const summarizeTurnToolCalls = (
  toolCalls: readonly AgentToolCall[],
  labels: ToolNameLabelMap,
  noToolCallsLabel: string
): string => {
  if (toolCalls.length === 0) {
    return noToolCallsLabel;
  }
  const grouped = new Map<string, number>();
  for (const call of toolCalls) {
    grouped.set(call.toolName, (grouped.get(call.toolName) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .map(([toolName, count]) =>
      count === 1
        ? normalizeToolName(toolName, labels)
        : `${normalizeToolName(toolName, labels)} x${String(count)}`
    )
    .join(" · ");
};

const resolveTurnDurationLabel = (
  turn: AgentTurn,
  turnWorkingLabel: string,
  turnWorkedForPrefix: string
): string => {
  if (turn.status === "running") {
    return turnWorkingLabel;
  }
  if (turn.status === "paused") {
    return turn.errorMessage ?? turnWorkedForPrefix;
  }
  const durationMs = Math.max(0, turn.updatedAt - turn.createdAt);
  return `${turnWorkedForPrefix} ${formatDurationCompact(durationMs)}`;
};

const resolveTurnSecondaryLabel = (
  turn: AgentTurn,
  toolCalls: readonly AgentToolCall[],
  labels: ToolNameLabelMap,
  turnNoToolCallsLabel: string,
  turnFailedLabel: string
): string => {
  if (turn.status === "failed") {
    return turn.errorMessage ?? turnFailedLabel;
  }
  if (turn.status === "paused") {
    return turn.errorMessage ?? turnNoToolCallsLabel;
  }
  return summarizeTurnToolCalls(toolCalls, labels, turnNoToolCallsLabel);
};

const toRuntimeFeedItem = (
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

const toPersistedRuntimeFeedItem = (
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
    timestamp: call.finishedAt ?? call.startedAt
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

const mergeRuntimeFeedItem = (
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

const buildTurnTimelineItems = ({
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

const isOptimisticUserMessage = (message: DisplayMessage): message is OptimisticUserMessage =>
  "optimistic" in message && message.optimistic === true;

const renderRuntimeFeedIcon = (kind: AgentRuntimeFeedIconKind) => {
  if (kind === "search") {
    return <Search size={11} />;
  }
  if (kind === "readRange") {
    return <BookText size={11} />;
  }
  if (kind === "list") {
    return <FolderTree size={11} />;
  }
  if (kind === "glob") {
    return <Asterisk size={11} />;
  }
  if (kind === "write" || kind === "edit") {
    return <Pencil size={11} />;
  }
  if (kind === "multiEdit") {
    return <Files size={11} />;
  }
  if (kind === "tool") {
    return <Wrench size={11} />;
  }
  return <FileCode size={11} />;
};

const trimOptionalText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const proposedPlanPattern = /<proposed_plan>[\s\S]*?<\/proposed_plan>/i;

type InteractionTextBundle = {
  readonly toolTerminalSession: string;
  readonly toolTerminalInput: string;
  readonly toolTerminalExec: string;
  readonly commandNeedsApproval: string;
  readonly proposedPlanSummaryFallback: string;
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

const toPendingInteractionPanel = (
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

const sortPendingInteractions = (
  interactions: readonly AgentPendingInteraction[]
): readonly AgentPendingInteraction[] =>
  [...interactions].sort((left, right) => left.createdAt - right.createdAt);

const mergePendingInteractionLists = (
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

export const AiPanelSurface = ({
  desktopApi,
  locale = "en-US",
  title,
  description,
  themeSignature,
  richRenderingEnabled = false,
  newSessionTitle,
  defaultProfileId,
  defaultProfileName,
  defaultModelNames,
  profileLabel,
  modelLabel,
  modelsLabel,
  openHistoryLabel,
  openMcpLabel,
  openSkillsLabel,
  bindProjectLabel,
  composeAriaLabel,
  composePlaceholder,
  composeSendLabel,
  emptyStateTitle,
  emptyStateDescription,
  loadingSessionLabel,
  emptyThreadLabel,
  turnNoToolCallsLabel,
  turnWorkingLabel,
  turnFailedLabel,
  turnWorkedForPrefix,
  runtimeToolFallbackLabel,
  toolNameSearchLabel,
  toolNameReadRangeLabel,
  toolNameListLabel,
  toolNameGlobLabel,
  toolNameWriteLabel,
  toolNameEditLabel,
  toolNameMultiEditLabel,
  onOpenFilePath,
  onWriteStreamEvent,
  onTerminalExecStarted,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onRequestProjectBind
}: AiPanelSurfaceProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const isZhLocale = (locale ?? "en-US").startsWith("zh");
  const hasDefaultProfile = defaultProfileName !== null && defaultProfileName.trim().length > 0;
  const resolvedModelNames = defaultModelNames
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
  const hasDefaultModels = resolvedModelNames.length > 0;
  const agentApi = desktopApi?.agent;
  const resolvedComposeAriaLabel =
    composeAriaLabel !== undefined && composeAriaLabel.trim().length > 0
      ? composeAriaLabel
      : title;
  const resolvedComposePlaceholder =
    composePlaceholder !== undefined && composePlaceholder.trim().length > 0
      ? composePlaceholder
      : "";
  const resolvedComposeSendLabel =
    composeSendLabel !== undefined && composeSendLabel.trim().length > 0
      ? composeSendLabel
      : "";

  const toolNameLabels = useMemo<ToolNameLabelMap>(
    () => ({
      search: toolNameSearchLabel,
      readRange: toolNameReadRangeLabel,
      list: toolNameListLabel,
      glob: toolNameGlobLabel,
      write: toolNameWriteLabel,
      edit: toolNameEditLabel,
      multiEdit: toolNameMultiEditLabel,
      terminalSession: t("ai.toolNameTerminalSession"),
      terminalRead: t("ai.toolNameTerminalRead"),
      terminalInput: t("ai.toolNameTerminalInput"),
      terminalClose: t("ai.toolNameTerminalClose"),
      terminalExec: t("ai.toolNameTerminalExec")
    }),
    [
      t,
      toolNameEditLabel,
      toolNameGlobLabel,
      toolNameListLabel,
      toolNameMultiEditLabel,
      toolNameReadRangeLabel,
      toolNameSearchLabel,
      toolNameWriteLabel
    ]
  );
  const interactionTextLabels = useMemo<InteractionTextBundle>(
    () => ({
      toolTerminalSession: t("ai.commandToolTerminalSession"),
      toolTerminalInput: t("ai.commandToolTerminalInput"),
      toolTerminalExec: t("ai.commandToolTerminalExec"),
      commandNeedsApproval: t("ai.commandNeedsApproval"),
      proposedPlanSummaryFallback: t("ai.proposedPlanSummaryFallback")
    }),
    [t]
  );

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<AgentSessionDetail | null>(null);
  const [draftInput, setDraftInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const streamingTurnIdRef = useRef<string | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState("");
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [latestRuntimeEventByTurn, setLatestRuntimeEventByTurn] =
    useState<Readonly<Record<string, AgentRuntimeEvent>>>({});
  const sanitizedStreamingAssistantText = useMemo(
    () => sanitizeAssistantDisplayContent(streamingAssistantText),
    [streamingAssistantText]
  );
  // During active streaming, show text directly — deltas already provide
  // incremental appearance. Typewriter effect is only used after streaming
  // ends (isStreamActive = false) to animate any remaining buffered text.
  // We always call the hook to respect Rules of Hooks, but pass instant=true
  // during streaming to bypass buffering.
  const typewriterText = useTypewriter(sanitizedStreamingAssistantText, isStreamActive, {
    charsPerSecond: 45,
    minChunkSize: 4,
    instant: isStreamActive
  });
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<readonly OptimisticUserMessage[]>([]);
  const [runtimeFeed, setRuntimeFeed] = useState<readonly AgentRuntimeFeedItem[]>([]);
  const [boundProjectPathBySession, setBoundProjectPathBySession] =
    useState<Readonly<Record<string, string>>>({});
  const [livePendingInteractionsBySession, setLivePendingInteractionsBySession] =
    useState<Readonly<Record<string, readonly AgentPendingInteraction[]>>>({});
  const [planModeArmedBySession, setPlanModeArmedBySession] =
    useState<Readonly<Record<string, boolean>>>({});
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [transientInteractionPanel, setTransientInteractionPanel] =
    useState<PendingInteractionPanel | null>(null);
  const [isBindingProject, setIsBindingProject] = useState(false);
  const [composerHeight, setComposerHeight] = useState(96);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const interactionPanelRef = useRef<HTMLDivElement | null>(null);
  const sessionListRequestSeqRef = useRef(0);
  const sessionDetailRequestSeqRef = useRef(0);
  const interactionPollTokenRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const livePendingInteractionsRef =
    useRef<Readonly<Record<string, readonly AgentPendingInteraction[]>>>({});

  const threadStyle = useMemo<CSSProperties>(
    () => ({
      "--lyra-ai-composer-reserve": `${String(Math.max(72, composerHeight))}px`
    }) as CSSProperties,
    [composerHeight]
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    livePendingInteractionsRef.current = livePendingInteractionsBySession;
  }, [livePendingInteractionsBySession]);

  const syncActiveInteractionState = useCallback(
    (sessionId: string, interactions: readonly AgentPendingInteraction[]) => {
      if (activeSessionIdRef.current !== sessionId) {
        return;
      }
      const pendingIds = interactions
        .filter((interaction) => interaction.status === "pending")
        .map((interaction) => interaction.id);
      if (pendingIds.length > 0) {
        setIsSending(false);
        setIsStreamActive(false);
      }
      setActiveInteractionId((current) => {
        if (current !== null && pendingIds.includes(current)) {
          return current;
        }
        return pendingIds[0] ?? null;
      });
    },
    []
  );

  const replacePendingInteractions = useCallback(
    (sessionId: string, interactions: readonly AgentPendingInteraction[]) => {
      const nextInteractions = sortPendingInteractions(interactions);
      livePendingInteractionsRef.current = {
        ...livePendingInteractionsRef.current,
        [sessionId]: nextInteractions
      };
      setLivePendingInteractionsBySession((current) => ({
        ...current,
        [sessionId]: nextInteractions
      }));
      setActiveDetail((current) => {
        if (current === null || current.session.id !== sessionId) {
          return current;
        }
        return {
          ...current,
          pendingInteractions: nextInteractions
        };
      });
      syncActiveInteractionState(sessionId, nextInteractions);
    },
    [syncActiveInteractionState]
  );

  const mergePendingInteractionsForSession = useCallback(
    (sessionId: string, interactions: readonly AgentPendingInteraction[]) => {
      const currentInteractions = livePendingInteractionsRef.current[sessionId] ?? [];
      const nextInteractions = mergePendingInteractionLists(currentInteractions, interactions);
      replacePendingInteractions(sessionId, nextInteractions);
    },
    [replacePendingInteractions]
  );

  const startPendingInteractionPolling = useCallback(
    (sessionId: string): (() => void) => {
      if (agentApi === undefined) {
        return () => {};
      }
      const pollToken = ++interactionPollTokenRef.current;
      let cancelled = false;
      void (async () => {
        while (!cancelled && interactionPollTokenRef.current === pollToken) {
          try {
            const interactions = await agentApi.getPendingInteractions({ sessionId });
            if (cancelled || interactionPollTokenRef.current !== pollToken) {
              return;
            }
            replacePendingInteractions(sessionId, interactions);
            if (interactions.some((interaction) => interaction.status === "pending")) {
              return;
            }
          } catch (_error) {
            // Ignore polling failures; runtime events and later polls can recover.
          }
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
        }
      })();
      return () => {
        cancelled = true;
        if (interactionPollTokenRef.current === pollToken) {
          interactionPollTokenRef.current += 1;
        }
      };
    },
    [agentApi, replacePendingInteractions]
  );

  useEffect(
    () => () => {
      interactionPollTokenRef.current += 1;
    },
    []
  );

  const loadSessions = useCallback(async (): Promise<void> => {
    if (agentApi === undefined) {
      return;
    }
    const requestSeq = ++sessionListRequestSeqRef.current;
    setIsLoading(true);
    try {
      let nextSessions = await agentApi.listSessions();
      if (requestSeq !== sessionListRequestSeqRef.current) {
        return;
      }
      if (nextSessions.length === 0) {
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(defaultProfileId === null || defaultProfileId === undefined
            ? {}
            : { profileId: defaultProfileId })
        });
        nextSessions = [created];
        if (requestSeq !== sessionListRequestSeqRef.current) {
          return;
        }
      }

      setActiveSessionId((current) => {
        if (current !== null && nextSessions.some((session) => session.id === current)) {
          return current;
        }
        return nextSessions[0]?.id ?? null;
      });
    } finally {
      setIsLoading(false);
    }
  }, [agentApi, defaultProfileId, newSessionTitle]);

  const loadSessionDetail = useCallback(
    async (sessionId: string): Promise<void> => {
      if (agentApi === undefined) {
        return;
      }
      const requestSeq = ++sessionDetailRequestSeqRef.current;
      try {
        const detail = await agentApi.getSession({ sessionId });
        if (requestSeq !== sessionDetailRequestSeqRef.current) {
          return;
        }
        setActiveDetail(detail);
        mergePendingInteractionsForSession(sessionId, detail.pendingInteractions);
      } catch (error) {
        if (requestSeq !== sessionDetailRequestSeqRef.current) {
          return;
        }
        if (isSessionNotFoundError(error)) {
          setActiveDetail((current) =>
            current !== null && current.session.id === sessionId ? null : current
          );
          setActiveSessionId((current) => (current === sessionId ? null : current));
          await loadSessions();
          return;
        }
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [agentApi, loadSessions, mergePendingInteractionsForSession]
  );

  useEffect(() => {
    if (agentApi === undefined) {
      return;
    }
    void loadSessions();
  }, [agentApi, loadSessions]);

  useEffect(() => {
    if (agentApi === undefined || activeSessionId === null) {
      setActiveDetail(null);
      return;
    }
    void loadSessionDetail(activeSessionId);
  }, [activeSessionId, agentApi, loadSessionDetail]);

  useEffect(() => {
    setActiveInteractionId(null);
    setTransientInteractionPanel(null);
    setLatestRuntimeEventByTurn({});
    sessionDetailRequestSeqRef.current += 1;
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId === null) {
      return;
    }
    if (activeDetail === null || activeDetail.session.id !== activeSessionId) {
      return;
    }
    setLivePendingInteractionsBySession((current) => ({
      ...current,
      [activeSessionId]: mergePendingInteractionLists(
        current[activeSessionId] ?? [],
        activeDetail.pendingInteractions
      )
    }));
  }, [activeDetail, activeSessionId]);

  useEffect(() => {
    if (activeSessionId === null || activeDetail?.session.id !== activeSessionId) {
      return;
    }
    if (activeDetail.session.collaborationMode !== "plan") {
      return;
    }
    setPlanModeArmedBySession((current) => {
      if (current[activeSessionId] !== true) {
        return current;
      }
      return {
        ...current,
        [activeSessionId]: false
      };
    });
  }, [activeDetail?.session.collaborationMode, activeDetail?.session.id, activeSessionId]);

  useEffect(
    () =>
      subscribeAgentSessionSelected((sessionId) => {
        setActiveSessionId(sessionId);
        setRuntimeError(null);
        setRuntimeFeed([]);
        setLatestRuntimeEventByTurn({});
        setIsStreamActive(false);
        setStreamingAssistantText("");
        streamingTurnIdRef.current = null;
        setStreamingTurnId(null);
        setOptimisticUserMessages([]);
        if (agentApi !== undefined) {
          void loadSessionDetail(sessionId);
          void loadSessions();
        }
      }),
    [agentApi, loadSessionDetail, loadSessions]
  );

  const openRuntimeTargetPath = useCallback(
    async (
      path: string,
      options?: {
        readonly forceReloadIfOpen?: boolean;
        readonly allowMissing?: boolean;
        readonly location?: FileEditorRevealLocation;
      }
    ): Promise<void> => {
      if (onOpenFilePath === undefined || desktopApi === null) {
        return;
      }
      const nextPath = path.trim();
      if (nextPath.length === 0) {
        return;
      }
      if (options?.allowMissing === true) {
        onOpenFilePath(nextPath, options);
        return;
      }
      try {
        const stat = await desktopApi.files.statFile({ path: nextPath });
        if (!stat.exists || stat.isDirectory) {
          return;
        }
        onOpenFilePath(nextPath, options);
      } catch (_error) {
        // Ignore path open failures to keep runtime feed non-disruptive.
      }
    },
    [desktopApi, onOpenFilePath]
  );

  useEffect(() => {
    if (agentApi === undefined) {
      return;
    }
    return agentApi.onEvent((event) => {
      const payload = isRecord(event.payload) ? event.payload : {};
      if (event.phase === "interaction_queue_updated") {
        const interactions = Array.isArray(payload.pendingInteractions)
          ? payload.pendingInteractions as readonly AgentPendingInteraction[]
          : [];
        replacePendingInteractions(event.sessionId, interactions);
      }
      if (event.phase === "interaction_pending") {
        const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
        if (interactionPayload !== null) {
          mergePendingInteractionsForSession(
            event.sessionId,
            [interactionPayload as AgentPendingInteraction]
          );
        }
      }
      if (event.phase === "interaction_resolved") {
        const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
        const interactionId =
          interactionPayload === null ? null : pickString(interactionPayload, "id");
        if (interactionId !== null) {
          replacePendingInteractions(
            event.sessionId,
            (livePendingInteractionsRef.current[event.sessionId] ?? []).filter(
              (interaction) => interaction.id !== interactionId
            )
          );
        }
      }
      if (event.sessionId !== activeSessionIdRef.current) {
        return;
      }
      if (event.phase !== "assistant_delta" && event.phase !== "reasoning_thought") {
        setLatestRuntimeEventByTurn((current) => {
          const previous = current[event.turnId];
          if (previous !== undefined) {
            if (previous.timestamp > event.timestamp) {
              return current;
            }
            if (
              previous.timestamp === event.timestamp
              && runtimeEventPhasePriority(previous.phase) > runtimeEventPhasePriority(event.phase)
            ) {
              return current;
            }
          }
          return {
            ...current,
            [event.turnId]: event
          };
        });
      }
      if (event.phase === "assistant_delta") {
        const delta = pickRawString(payload, "delta") ?? "";
        if (delta.length > 0) {
          const currentTurnId = streamingTurnIdRef.current;
          const isSameTurn = currentTurnId === event.turnId;
          setStreamingAssistantText(isSameTurn
            ? (current) => `${current}${delta}`
            : delta
          );
          streamingTurnIdRef.current = event.turnId;
          setIsStreamActive(true);
          setStreamingTurnId(event.turnId);
        }
        return;
      }
      const error = resolveEventError(event);
      if (error !== null) {
        setRuntimeError(error);
      }
      const progress = isRecord(payload.progress) ? payload.progress : null;
      if (onWriteStreamEvent !== undefined) {
        const toolName = pickString(payload, "toolName");
        const toolCallId = pickString(payload, "toolCallId");
        const input = isRecord(payload.input) ? payload.input : null;
        const output = isRecord(payload.output) ? payload.output : null;
        const filePath =
          (progress === null ? null : pickString(progress, "path"))
          ?? (output === null ? null : pickString(output, "path"))
          ?? (input === null ? null : pickString(input, "path"));
        if (
          toolName !== null &&
          toolCallId !== null &&
          filePath !== null &&
          isWriteToolName(toolName)
        ) {
          if (event.phase === "tool_started") {
            onWriteStreamEvent({
              kind: "started",
              sessionId: event.sessionId,
              turnId: event.turnId,
              toolCallId,
              toolName,
              filePath,
              timestamp: event.timestamp
            });
          }
          if (event.phase === "tool_progress" && progress !== null) {
            const stage = pickString(progress, "stage");
            if (stage === "baseline") {
              onWriteStreamEvent({
                kind: "started",
                sessionId: event.sessionId,
                turnId: event.turnId,
                toolCallId,
                toolName,
                filePath,
                timestamp: event.timestamp,
                ...(typeof progress.created === "boolean" ? { created: progress.created } : {}),
                ...(typeof progress.baselineContent === "string"
                  ? { baselineContent: progress.baselineContent }
                  : {})
              });
            }
            const chunkText = pickRawString(progress, "chunkText");
            if (stage === "writing" && chunkText !== null) {
              onWriteStreamEvent({
                kind: "delta",
                sessionId: event.sessionId,
                turnId: event.turnId,
                toolCallId,
                toolName,
                filePath,
                timestamp: event.timestamp,
                chunkText,
                ...(pickNumber(progress, "bytesWritten") === null
                  ? {}
                  : { bytesWritten: pickNumber(progress, "bytesWritten")! }),
                ...(pickNumber(progress, "bytesTotal") === null
                  ? {}
                  : { bytesTotal: pickNumber(progress, "bytesTotal")! }),
                ...(pickNumber(progress, "progress") === null
                  ? {}
                  : { progress: pickNumber(progress, "progress")! })
              });
            }
          }
          if (event.phase === "tool_finished") {
            const status = pickString(payload, "status") === "failed" ? "failed" : "completed";
            const errorObject = isRecord(payload.error) ? payload.error : null;
            onWriteStreamEvent({
              kind: "finished",
              sessionId: event.sessionId,
              turnId: event.turnId,
              toolCallId,
              toolName,
              filePath,
              timestamp: event.timestamp,
              status,
              ...(output !== null && typeof output.created === "boolean"
                ? { created: output.created }
                : {}),
              ...(output !== null && typeof output.baselineContent === "string"
                ? { baselineContent: output.baselineContent }
                : {}),
              ...(output !== null && pickNumber(output, "firstChangedLine") !== null
                ? { firstChangedLine: pickNumber(output, "firstChangedLine")! }
                : {}),
              ...(output !== null && pickNumber(output, "addedLines") !== null
                ? { addedLines: pickNumber(output, "addedLines")! }
                : {}),
              ...(output !== null && pickNumber(output, "removedLines") !== null
                ? { removedLines: pickNumber(output, "removedLines")! }
                : {}),
              ...(errorObject !== null && typeof errorObject.code === "string"
                ? { errorCode: errorObject.code }
                : {}),
              ...(errorObject !== null && typeof errorObject.message === "string"
                ? { errorMessage: errorObject.message }
                : {})
            });
          }
        }
      }

      // Fire terminal exec callback when tool starts
      if (event.phase === "tool_started") {
        const toolName = pickString(payload, "toolName");
        if (toolName === "terminal.exec") {
          const input = isRecord(payload.input) ? payload.input : null;
          const command = input !== null ? (pickString(input, "command") ?? "") : "";
          const cwd = input !== null ? (pickString(input, "cwd") || undefined) : undefined;
          const toolCallId = pickString(payload, "toolCallId") ?? "";
          if (onTerminalExecStarted !== undefined && command.length > 0) {
            onTerminalExecStarted(command, cwd, toolCallId, event.turnId, event.sessionId);
          }
        }
      }

      const feedItem = toRuntimeFeedItem(event, toolNameLabels, runtimeToolFallbackLabel);
      if (feedItem !== null) {
        // Capture terminal streaming output
        const isTerminal = isTerminalToolName(feedItem.toolName);
        const outputPayload = isRecord(payload.output) ? payload.output : null;
        const terminalOutput = isTerminal && progress !== null
          ? (pickRawString(progress, "stdoutChunk") ?? "")
          : isTerminal && outputPayload !== null && pickString(outputPayload, "kind") === "read"
            ? (pickRawString(outputPayload, "output") ?? "")
            : null;
        const terminalError = isTerminal && progress !== null
          ? (pickRawString(progress, "stderrChunk") ?? "")
          : null;

        setRuntimeFeed((current) => {
          const existingIndex = current.findIndex((item) => item.id === feedItem.id);
          if (existingIndex === -1) {
            return [...current, feedItem].slice(-FEED_ITEM_LIMIT);
          }
          const next = [...current];
          const previous = next[existingIndex];
          if (previous === undefined) {
            return [...current, feedItem].slice(-FEED_ITEM_LIMIT);
          }
          // Accumulate terminal output across progress events
          const accumulatedOutput = isTerminal && (terminalOutput !== null || terminalError !== null)
            ? `${previous.liveOutput ?? ""}${terminalOutput ?? ""}${terminalError !== null && terminalError.length > 0 ? terminalError : ""}`
            : previous.liveOutput;

          next[existingIndex] = {
            ...previous,
            ...feedItem,
            target: feedItem.target.length > 0 ? feedItem.target : previous.target,
            ...(feedItem.openPath !== undefined || previous.openPath !== undefined
              ? { openPath: feedItem.openPath ?? previous.openPath }
              : {}),
            ...(accumulatedOutput !== undefined && accumulatedOutput.length > 0
              ? { liveOutput: accumulatedOutput }
              : {})
          };
          return next;
        });
        if (
          feedItem.autoOpen === true &&
          typeof feedItem.openPath === "string" &&
          feedItem.openPath.trim().length > 0
        ) {
          const location =
            feedItem.firstChangedLine === undefined
              ? undefined
              : ({ line: feedItem.firstChangedLine } as FileEditorRevealLocation);
          void openRuntimeTargetPath(feedItem.openPath, {
            allowMissing: event.phase !== "tool_finished",
            forceReloadIfOpen:
              event.phase === "tool_progress" || feedItem.status === "completed",
            ...(location === undefined ? {} : { location })
          });
        }
      }

      if (event.phase === "command_approval_request") {
        const approvalPayload = isRecord(event.payload) ? event.payload : {};
        const inputPayload = isRecord(approvalPayload.input) ? approvalPayload.input : {};
        const metadataPayload = isRecord(approvalPayload.metadata) ? approvalPayload.metadata : {};
        const toolCallId =
          pickString(approvalPayload, "toolCallId") ?? `${event.turnId}-tool-call`;
        const riskLevelCandidate = pickString(metadataPayload, "riskLevel");
        const riskLevel: CommandApprovalRequest["riskLevel"] =
          riskLevelCandidate === "safe"
          || riskLevelCandidate === "low"
          || riskLevelCandidate === "medium"
          || riskLevelCandidate === "high"
          || riskLevelCandidate === "critical"
            ? riskLevelCandidate
            : "medium";

        const cwd = pickString(inputPayload, "cwd");
        const toolName = pickString(approvalPayload, "toolName") ?? "terminal.exec";
        void cwd;
        void toolName;
        void riskLevel;
        setIsSending(false);
        setIsStreamActive(false);
        setTransientInteractionPanel({
          kind: "commandApproval",
          request: {
            id: toolCallId,
            sessionId: event.sessionId,
            turnId: event.turnId,
            toolCallId,
            toolName,
            toolLabel: resolveCommandApprovalToolLabel(toolName, interactionTextLabels),
            command: resolveCommandApprovalCommandPreview({
              toolName,
              inputPayload,
              metadataPayload,
            }),
            riskLevel,
            riskDescription:
              pickString(approvalPayload, "message") ?? interactionTextLabels.commandNeedsApproval,
            ...(cwd === null ? {} : { cwd }),
            ...(pickString(metadataPayload, "mode") === "command"
              || pickString(metadataPayload, "mode") === "shell"
                ? { mode: pickString(metadataPayload, "mode") as "command" | "shell" }
                : {}),
            ...(pickString(metadataPayload, "interactiveCategory") === null
              ? {}
              : { interactiveCategory: pickString(metadataPayload, "interactiveCategory")! }),
            isRepeat: metadataPayload.wasPreApproved === true,
          }
        });
        setActiveInteractionId(toolCallId);
      }

      if (event.phase === "plan_question_requested") {
        const requestId = pickString(payload, "requestId") ?? `${event.turnId}-plan-question`;
        setIsSending(false);
        setIsStreamActive(false);
        const request: PlanQuestionRequest = {
          id: requestId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          questions: Array.isArray(payload.questions)
            ? payload.questions as PlanQuestionRequest["questions"]
            : [],
          ...(typeof payload.allowNote === "boolean" ? { allowNote: payload.allowNote } : {}),
        };
        if (request.questions.length > 0) {
          setTransientInteractionPanel({
            kind: "planQuestion",
            request
          });
        }
        setActiveInteractionId(requestId);
      }

      if (event.phase === "plan_approval_requested") {
        const requestId = pickString(payload, "requestId") ?? `${event.turnId}-plan-approval`;
        setIsSending(false);
        setIsStreamActive(false);
        const proposedMarkdown = pickRawString(payload, "proposedMarkdown");
        if (proposedMarkdown !== null) {
          setTransientInteractionPanel({
            kind: "planApproval",
            request: {
              id: requestId,
              sessionId: event.sessionId,
              turnId: event.turnId,
              version: pickNumber(payload, "version") ?? 0,
              status: "submitted",
              summary:
                pickString(payload, "summary")
                ?? proposedMarkdown.split("\n").find((line) => line.trim().length > 0)
                ?? interactionTextLabels.proposedPlanSummaryFallback,
              proposedMarkdown,
              ...(pickRawString(payload, "draftMarkdown") === null
                ? {}
                : { draftMarkdown: pickRawString(payload, "draftMarkdown")! }),
            }
          });
        }
        setActiveInteractionId(requestId);
      }

      if (event.phase === "interaction_pending") {
        const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
        const interactionId = interactionPayload === null ? null : pickString(interactionPayload, "id");
        setIsSending(false);
        setIsStreamActive(false);
        if (interactionPayload !== null) {
          const interactionPanel = toPendingInteractionPanel(
            interactionPayload as AgentPendingInteraction,
            interactionTextLabels
          );
          if (interactionPanel !== null) {
            setTransientInteractionPanel(interactionPanel);
          }
        }
        if (interactionId !== null) {
          setActiveInteractionId(interactionId);
        }
      }

      if (event.phase === "interaction_resolved") {
        const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
        const interactionId = interactionPayload === null ? null : pickString(interactionPayload, "id");
        if (interactionId !== null) {
          setActiveInteractionId((current) => (current === interactionId ? null : current));
          setTransientInteractionPanel((current) =>
            current !== null && current.request.id === interactionId ? null : current
          );
        }
      }

      if (event.phase === "plan_question_answered" || event.phase === "plan_approved" || event.phase === "plan_rejected") {
        setActiveInteractionId((current) => (current !== null ? current : null));
      }

      if (event.phase === "accepted") {
        setOptimisticUserMessages([]);
        setIsStreamActive(true);
        // Only clear streaming state if we haven't started streaming for this
        // turn yet. If assistant_delta already arrived for this turn, preserve
        // the accumulated text.
        if (streamingTurnIdRef.current !== event.turnId) {
          streamingTurnIdRef.current = event.turnId;
          setStreamingTurnId(event.turnId);
          setStreamingAssistantText("");
        }
      }
      if (
        event.phase === "completed"
        || event.phase === "failed"
        || event.phase === "paused"
      ) {
        setIsStreamActive(false);
        setTransientInteractionPanel(null);
        // Only clear streaming state if this is the turn we're currently streaming.
        // Using the ref (not state) avoids race conditions with React batching.
        if (streamingTurnIdRef.current === event.turnId) {
          setStreamingAssistantText("");
          streamingTurnIdRef.current = null;
          setStreamingTurnId(null);
        }
      }

      if (
        event.phase === "accepted" ||
        event.phase === "tool_started" ||
        event.phase === "tool_finished" ||
        event.phase === "interaction_pending" ||
        event.phase === "interaction_resolved" ||
        event.phase === "interaction_queue_updated" ||
        event.phase === "plan_mode_entered" ||
        event.phase === "plan_mode_reentered" ||
        event.phase === "plan_draft_updated" ||
        event.phase === "plan_question_answered" ||
        event.phase === "plan_approved" ||
        event.phase === "plan_rejected" ||
        event.phase === "plan_mode_exited" ||
        event.phase === "paused" ||
        event.phase === "completed" ||
        event.phase === "failed"
      ) {
        void loadSessionDetail(event.sessionId);
      }
      if (
        event.phase === "accepted" ||
        event.phase === "plan_mode_entered" ||
        event.phase === "plan_mode_reentered" ||
        event.phase === "plan_mode_exited" ||
        event.phase === "paused" ||
        event.phase === "completed" ||
        event.phase === "failed"
      ) {
        void loadSessions();
      }
    });
  }, [
    agentApi,
    loadSessionDetail,
    loadSessions,
    mergePendingInteractionsForSession,
    openRuntimeTargetPath,
    onWriteStreamEvent,
    onTerminalExecStarted,
    replacePendingInteractions,
    interactionTextLabels,
    runtimeToolFallbackLabel,
    toolNameLabels
  ]);

  const mergedPendingInteractions = useMemo<readonly AgentPendingInteraction[]>(
    () => {
      const persisted = activeDetail?.pendingInteractions ?? [];
      const live =
        activeSessionId === null
          ? []
          : (livePendingInteractionsBySession[activeSessionId] ?? []);
      return mergePendingInteractionLists(persisted, live);
    },
    [activeDetail?.pendingInteractions, activeSessionId, livePendingInteractionsBySession]
  );
  const pendingInteractionQueue = useMemo<readonly PendingInteractionPanel[]>(
    () =>
      mergedPendingInteractions
        .filter((interaction) => interaction.status === "pending")
        .map((interaction) => toPendingInteractionPanel(interaction, interactionTextLabels))
        .filter((interaction): interaction is PendingInteractionPanel => interaction !== null),
    [interactionTextLabels, mergedPendingInteractions]
  );
  const activeInteractionIndex = useMemo(
    () => pendingInteractionQueue.findIndex((interaction) => interaction.request.id === activeInteractionId),
    [activeInteractionId, pendingInteractionQueue]
  );
  const activePendingInteraction = useMemo<PendingInteractionPanel | null>(() => {
    if (pendingInteractionQueue.length === 0) {
      return null;
    }
    if (activeInteractionIndex >= 0) {
      return pendingInteractionQueue[activeInteractionIndex] ?? pendingInteractionQueue[0] ?? null;
    }
    return pendingInteractionQueue[0] ?? null;
  }, [activeInteractionIndex, pendingInteractionQueue]);
  const activeInteractionPanel = useMemo<ActiveInteractionPanel>(
    () =>
      activePendingInteraction
      ?? transientInteractionPanel,
    [activePendingInteraction, transientInteractionPanel]
  );
  const activeInteractionPosition = activePendingInteraction === null
    ? (transientInteractionPanel === null ? 0 : 1)
    : Math.max(
      1,
      pendingInteractionQueue.findIndex(
        (interaction) => interaction.request.id === activePendingInteraction.request.id
      ) + 1
    );

  useEffect(() => {
    if (activePendingInteraction === null || transientInteractionPanel === null) {
      return;
    }
    if (activePendingInteraction.request.id === transientInteractionPanel.request.id) {
      setTransientInteractionPanel(null);
    }
  }, [activePendingInteraction, transientInteractionPanel]);

  useEffect(() => {
    if (pendingInteractionQueue.length === 0) {
      setActiveInteractionId(null);
      return;
    }
    if (
      activeInteractionId !== null
      && pendingInteractionQueue.some((interaction) => interaction.request.id === activeInteractionId)
    ) {
      return;
    }
    setActiveInteractionId(pendingInteractionQueue[0]?.request.id ?? null);
  }, [activeInteractionId, pendingInteractionQueue]);

  const isPlanModeArmed = useMemo(() => {
    if (activeSessionId === null) {
      return false;
    }
    return planModeArmedBySession[activeSessionId] === true;
  }, [activeSessionId, planModeArmedBySession]);

  const isPlanModeActive = activeDetail?.session.collaborationMode === "plan";
  const isPlanModeLocked = isPlanModeActive || (isSending && isPlanModeArmed);
  const isPlanModeEnabled = isPlanModeActive || isPlanModeArmed;

  const sendTurn = useCallback(async (): Promise<void> => {
    if (agentApi === undefined || activeSessionId === null) {
      return;
    }
    const rawInput = draftInput.trim();
    const planCommandMatch = rawInput.match(/^\/plan(?:\s+([\s\S]+))?$/);
    const enteringPlanMode = planCommandMatch !== null || isPlanModeArmed;
    const input = (planCommandMatch?.[1] ?? rawInput).trim();
    const ensurePlanMode = async (sessionId: string): Promise<string> => {
      let targetSessionId = sessionId;
      let detail: AgentSessionDetail | null = null;
      try {
        detail = await agentApi.enterPlanMode({ sessionId: targetSessionId });
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          throw error;
        }
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(defaultProfileId === null || defaultProfileId === undefined
            ? {}
            : { profileId: defaultProfileId })
        });
        targetSessionId = created.id;
        detail = await agentApi.enterPlanMode({ sessionId: targetSessionId });
      }
      setActiveSessionId(detail.session.id);
      setActiveDetail(detail);
      await loadSessions();
      return detail.session.id;
    };
    if (input.length === 0 || isSending) {
      if (planCommandMatch !== null) {
        setIsSending(true);
        try {
          await ensurePlanMode(activeSessionId);
          setDraftInput("");
        } catch (error) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        } finally {
          setIsSending(false);
        }
      }
      return;
    }

    const boundProjectRoot =
      trimOptionalText(boundProjectPathBySession[activeSessionId])
      ?? trimOptionalText(activeDetail?.session.projectRoot);

    setIsSending(true);
    setRuntimeError(null);
    const optimisticMessage: OptimisticUserMessage = {
      id: `optimistic-user-${String(Date.now())}`,
      role: "user",
      content: input,
      createdAt: Date.now(),
      optimistic: true
    };
    setOptimisticUserMessages((current) => [...current, optimisticMessage].slice(-2));
    setDraftInput("");

    let stopPendingInteractionPolling = () => {};
    const restartPendingInteractionPolling = (sessionId: string): void => {
      stopPendingInteractionPolling();
      stopPendingInteractionPolling = startPendingInteractionPolling(sessionId);
    };

    try {
      let targetSessionId = activeSessionId;
      if (enteringPlanMode || activeDetail?.session.collaborationMode === "plan") {
        targetSessionId = await ensurePlanMode(targetSessionId);
      }
      restartPendingInteractionPolling(targetSessionId);
      const buildRequest = (sessionId: string) => ({
        sessionId,
        input,
        ...(boundProjectRoot === null ? {} : { projectRoot: boundProjectRoot }),
        ...(defaultProfileId === null || defaultProfileId === undefined
          ? {}
          : { profileId: defaultProfileId }),
        enablePlanning: true,
        planningMinChars: 100,
        enableReflection: false,
        reflectionMinToolCalls: 3,
        enableContextCollapse: true
      });
      try {
        await agentApi.sendTurn(buildRequest(targetSessionId));
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          stopPendingInteractionPolling();
          throw error;
        }
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(defaultProfileId === null || defaultProfileId === undefined
            ? {}
            : { profileId: defaultProfileId })
        });
        targetSessionId = created.id;
        setActiveSessionId(created.id);
        if (boundProjectRoot !== null) {
          setBoundProjectPathBySession((current) => ({
            ...current,
            [created.id]: boundProjectRoot
          }));
        }
        restartPendingInteractionPolling(targetSessionId);
        await agentApi.sendTurn(buildRequest(targetSessionId));
      }
      stopPendingInteractionPolling();
      await loadSessionDetail(targetSessionId);
      await loadSessions();
      setOptimisticUserMessages([]);
    } catch (error) {
      stopPendingInteractionPolling();
      setDraftInput(input);
      setOptimisticUserMessages([]);
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      stopPendingInteractionPolling();
      setIsSending(false);
    }
  }, [
    activeSessionId,
    activeDetail?.session.projectRoot,
    activeDetail?.session.collaborationMode,
    agentApi,
    boundProjectPathBySession,
    defaultProfileId,
    draftInput,
    isPlanModeArmed,
    isSending,
    loadSessionDetail,
    loadSessions,
    newSessionTitle,
    startPendingInteractionPolling
  ]);

  const handleApprovalDecision = useCallback(
    async (
      response: CommandApprovalResponse,
      requestOverride?: CommandApprovalRequest
    ) => {
      const request =
        requestOverride
        ?? (activeInteractionPanel?.kind === "commandApproval"
          ? activeInteractionPanel.request
          : null);
      if (
        desktopApi?.agent?.submitCommandApproval === undefined
        || request === null
      ) {
        return;
      }
      if (response.requestId !== request.id) {
        return;
      }
      try {
        await desktopApi.agent.submitCommandApproval({
          sessionId: request.sessionId,
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          decision: response.decision
        });
      } catch (error) {
        setRuntimeError(
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    [activeInteractionPanel, desktopApi]
  );

  const handlePlanQuestionSubmit = useCallback(
    async (
      payload: { readonly answers: Record<string, unknown>; readonly note?: string },
      requestOverride?: PlanQuestionRequest
    ) => {
      const request =
        requestOverride
        ?? (activeInteractionPanel?.kind === "planQuestion"
          ? activeInteractionPanel.request
          : null);
      if (
        request === null
        || (
          desktopApi?.agent?.answerQuestion === undefined
          && desktopApi?.agent?.answerPlanQuestion === undefined
        )
      ) {
        return;
      }
      try {
        const submit = desktopApi.agent.answerQuestion ?? desktopApi.agent.answerPlanQuestion;
        await submit({
          sessionId: request.sessionId,
          turnId: request.turnId,
          requestId: request.id,
          answers: payload.answers,
          ...(payload.note === undefined ? {} : { note: payload.note })
        });
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [activeInteractionPanel, desktopApi]
  );

  const handlePlanApprovalDecision = useCallback(
    async (
      response: PlanInteractionResponse,
      requestOverride?: PlanApprovalRequest
    ) => {
      const request =
        requestOverride
        ?? (activeInteractionPanel?.kind === "planApproval"
          ? activeInteractionPanel.request
          : null);
      if (
        desktopApi?.agent?.resolvePlanApproval === undefined
        || request === null
      ) {
        return;
      }
      if (response.requestId !== request.id) {
        return;
      }
      try {
        const result: AgentSendTurnResult | null = await desktopApi.agent.resolvePlanApproval({
          sessionId: request.sessionId,
          turnId: request.turnId,
          requestId: request.id,
          decision: response.decision,
          ...(response.feedback === undefined ? {} : { feedback: response.feedback })
        });
        if (result !== null) {
          await loadSessionDetail(result.session.id);
          await loadSessions();
        }
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [activeInteractionPanel, desktopApi, loadSessionDetail, loadSessions]
  );

  const persistedMessages = useMemo(
    () => sortByTime(activeDetail?.messages ?? []),
    [activeDetail?.messages]
  );

  const sortedMessages = useMemo<readonly DisplayMessage[]>(
    () => sortByTime([...persistedMessages, ...optimisticUserMessages]),
    [optimisticUserMessages, persistedMessages]
  );
  const assistantMessageOrderById = useMemo(() => {
    const map = new Map<string, number>();
    let assistantIndex = 0;
    for (const message of sortedMessages) {
      if (message.role !== "assistant") {
        continue;
      }
      assistantIndex += 1;
      map.set(message.id, assistantIndex);
    }
    return map;
  }, [sortedMessages]);

  const topbarTitle = useMemo(() => {
    const firstUserMessage = sortedMessages.find(
      (message) => message.role === "user" && message.content.trim().length > 0
    );
    if (firstUserMessage === undefined) {
      return null;
    }
    return truncateDisplayText(firstUserMessage.content, 6);
  }, [sortedMessages]);

  const composerPlanLabel = t("ai.planLabel");

  const turnsById = useMemo(() => {
    const map = new Map<string, AgentTurn>();
    for (const turn of activeDetail?.turns ?? []) {
      map.set(turn.id, turn);
    }
    return map;
  }, [activeDetail?.turns]);

  const toolCallsByTurn = useMemo(() => {
    const map = new Map<string, AgentToolCall[]>();
    for (const call of activeDetail?.toolCalls ?? []) {
      const current = map.get(call.turnId);
      if (current === undefined) {
        map.set(call.turnId, [call]);
      } else {
        current.push(call);
      }
    }
    for (const calls of map.values()) {
      calls.sort((left, right) => left.startedAt - right.startedAt);
    }
    return map;
  }, [activeDetail?.toolCalls]);

  const runtimeEventsByTurn = useMemo(() => {
    const map = new Map<string, AgentRuntimeEvent[]>();
    for (const event of activeDetail?.runtimeEvents ?? []) {
      const current = map.get(event.turnId);
      if (current === undefined) {
        map.set(event.turnId, [event]);
      } else {
        current.push(event);
      }
    }
    for (const events of map.values()) {
      events.sort((left, right) => left.timestamp - right.timestamp);
    }
    return map;
  }, [activeDetail?.runtimeEvents]);

  const persistedRuntimeFeed = useMemo<readonly AgentRuntimeFeedItem[]>(
    () => {
      const mergedById = new Map<string, AgentRuntimeFeedItem>();
      for (const call of activeDetail?.toolCalls ?? []) {
        const item = toPersistedRuntimeFeedItem(call, toolNameLabels, runtimeToolFallbackLabel);
        mergedById.set(item.id, mergeRuntimeFeedItem(mergedById.get(item.id), item));
      }
      for (const event of activeDetail?.runtimeEvents ?? []) {
        const item = toRuntimeFeedItem(event, toolNameLabels, runtimeToolFallbackLabel);
        if (item === null) {
          continue;
        }
        mergedById.set(item.id, mergeRuntimeFeedItem(mergedById.get(item.id), item));
      }
      return [...mergedById.values()]
        .sort((left, right) => left.timestamp - right.timestamp)
        .slice(-FEED_ITEM_LIMIT);
    },
    [activeDetail?.runtimeEvents, activeDetail?.toolCalls, runtimeToolFallbackLabel, toolNameLabels]
  );

  const displayRuntimeFeed = useMemo<readonly AgentRuntimeFeedItem[]>(
    () => {
      const mergedById = new Map<string, AgentRuntimeFeedItem>();
      for (const item of persistedRuntimeFeed) {
        mergedById.set(item.id, mergeRuntimeFeedItem(mergedById.get(item.id), item));
      }
      for (const item of runtimeFeed) {
        mergedById.set(item.id, mergeRuntimeFeedItem(mergedById.get(item.id), item));
      }
      return [...mergedById.values()]
        .sort((left, right) => left.timestamp - right.timestamp)
        .slice(-FEED_ITEM_LIMIT);
    },
    [persistedRuntimeFeed, runtimeFeed]
  );

  const runtimeFeedByTurn = useMemo(() => {
    const map = new Map<string, AgentRuntimeFeedItem[]>();
    for (const item of displayRuntimeFeed) {
      const current = map.get(item.turnId);
      if (current === undefined) {
        map.set(item.turnId, [item]);
      } else {
        current.push(item);
      }
    }
    for (const items of map.values()) {
      items.sort((left, right) => left.timestamp - right.timestamp);
    }
    return map;
  }, [displayRuntimeFeed]);

  const turnTimelineByTurn = useMemo(() => {
    const map = new Map<string, readonly AgentTurnTimelineItem[]>();
    for (const message of persistedMessages) {
      if (message.role !== "assistant" || typeof message.turnId !== "string") {
        continue;
      }
      if (map.has(message.turnId)) {
        continue;
      }
      map.set(
        message.turnId,
        buildTurnTimelineItems({
          turnId: message.turnId,
          messageContent: message.content,
          messageCreatedAt: message.createdAt,
          runtimeEvents: runtimeEventsByTurn.get(message.turnId) ?? [],
          runtimeFeedItems: runtimeFeedByTurn.get(message.turnId) ?? [],
          toolNameLabels,
          runtimeToolFallbackLabel
        })
      );
    }
    return map;
  }, [
    persistedMessages,
    runtimeEventsByTurn,
    runtimeFeedByTurn,
    runtimeToolFallbackLabel,
    toolNameLabels
  ]);

  const streamingTurnRuntimeFeed = useMemo<readonly AgentRuntimeFeedItem[]>(
    () =>
      streamingTurnId === null
        ? []
        : (runtimeFeedByTurn.get(streamingTurnId) ?? []),
    [runtimeFeedByTurn, streamingTurnId]
  );

  const streamingRuntimeEvent = useMemo<AgentRuntimeEvent | null>(
    () => {
      if (streamingTurnId === null) {
        return null;
      }
      const events = runtimeEventsByTurn.get(streamingTurnId) ?? [];
      const persistedLatest = events[events.length - 1] ?? null;
      const liveLatest = latestRuntimeEventByTurn[streamingTurnId] ?? null;
      return pickMostRecentRuntimeEvent(persistedLatest, liveLatest);
    },
    [latestRuntimeEventByTurn, runtimeEventsByTurn, streamingTurnId]
  );

  const streamingStatus = useMemo<StreamStatusItem | null>(
    () => {
      const runningTool = [...streamingTurnRuntimeFeed]
        .reverse()
        .find((item) => item.status === "running") ?? null;
      if (runningTool !== null) {
        return {
          label: normalizeStreamingStatusLabel(
            `${t("ai.runtimeRunningPrefix")} ${runningTool.toolLabel}`
          ),
          tone: "running"
        };
      }

      const hasWaitingInteraction =
        activeInteractionPanel !== null && (streamingTurnId !== null || isSending);
      if (hasWaitingInteraction) {
        return {
          label: normalizeStreamingStatusLabel(t("ai.pendingInteractions")),
          tone: "waiting"
        };
      }

      const phase = streamingRuntimeEvent?.phase ?? null;
      if (phase === "failed") {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimeFailedTurn")),
          tone: "failed"
        };
      }
      if (phase === "completed") {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimeCompletedTurn")),
          tone: "completed"
        };
      }
      if (
        phase === "paused"
        || phase === "interaction_pending"
        || phase === "command_approval_request"
        || phase === "plan_question_requested"
        || phase === "plan_approval_requested"
      ) {
        return {
          label: normalizeStreamingStatusLabel(t("ai.pendingInteractions")),
          tone: "waiting"
        };
      }

      if (phase === "accepted") {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimeQueued")),
          tone: "running"
        };
      }
      if (phase === "started") {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimeStarted")),
          tone: "running"
        };
      }
      if (phase === "tool_started" || phase === "tool_progress") {
        const payload = isRecord(streamingRuntimeEvent?.payload) ? streamingRuntimeEvent.payload : {};
        const phaseToolName = pickString(payload, "toolName");
        const phaseToolLabel =
          phaseToolName === null
            ? null
            : normalizeToolName(phaseToolName, toolNameLabels);
        return {
          label: normalizeStreamingStatusLabel(
            phaseToolLabel === null
              ? t("ai.runtimePhaseToolStarted")
              : `${t("ai.runtimeRunningPrefix")} ${phaseToolLabel}`
          ),
          tone: "running"
        };
      }
      if (phase === "tool_finished") {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimePhaseToolFinished")),
          tone: "running"
        };
      }

      if (
        streamingAssistantText.length > 0
        || isStreamActive
        || phase === "assistant_delta"
      ) {
        return {
          label: normalizeStreamingStatusLabel(t("ai.generatingReply")),
          tone: "running"
        };
      }
      if (isSending) {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimeQueued")),
          tone: "running"
        };
      }
      if (streamingTurnId !== null) {
        return {
          label: normalizeStreamingStatusLabel(t("ai.runtimeStarted")),
          tone: "running"
        };
      }
      return null;
    },
    [
      activeInteractionPanel,
      isSending,
      isStreamActive,
      streamingAssistantText.length,
      streamingRuntimeEvent,
      streamingTurnId,
      streamingTurnRuntimeFeed,
      t,
      toolNameLabels
    ]
  );

  const assistantTurnIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of sortedMessages) {
      if (message.role !== "assistant") {
        continue;
      }
      const turnId =
        "turnId" in message && typeof message.turnId === "string"
          ? message.turnId
          : null;
      if (turnId !== null) {
        ids.add(turnId);
      }
    }
    if (
      streamingTurnId !== null
      && (
        streamingAssistantText.length > 0
        || isStreamActive
        || streamingStatus !== null
      )
    ) {
      ids.add(streamingTurnId);
    }
    return ids;
  }, [
    isStreamActive,
    sortedMessages,
    streamingAssistantText.length,
    streamingStatus,
    streamingTurnId
  ]);

  const orphanRuntimeFeed = useMemo(
    () =>
      displayRuntimeFeed.filter(
        (item) =>
          !assistantTurnIds.has(item.turnId)
          && (streamingTurnId === null || item.turnId !== streamingTurnId)
      ),
    [assistantTurnIds, displayRuntimeFeed, streamingTurnId]
  );

  const activeBoundProjectPath = useMemo(() => {
    if (activeSessionId === null) {
      return null;
    }
    return (
      trimOptionalText(boundProjectPathBySession[activeSessionId])
      ?? trimOptionalText(activeDetail?.session.projectRoot)
    );
  }, [activeDetail?.session.projectRoot, activeSessionId, boundProjectPathBySession]);

  const activeBoundProjectName = useMemo(() => {
    if (activeBoundProjectPath === null) {
      return null;
    }
    return truncateDisplayText(extractFolderName(activeBoundProjectPath), 8);
  }, [activeBoundProjectPath]);

  const bindProject = useCallback(async (): Promise<void> => {
    if (onRequestProjectBind === undefined || isBindingProject) {
      return;
    }
    setIsBindingProject(true);
    try {
      let targetSessionId = activeSessionId;
      if (targetSessionId === null) {
        if (agentApi === undefined) {
          return;
        }
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(defaultProfileId === null || defaultProfileId === undefined
            ? {}
            : { profileId: defaultProfileId })
        });
        targetSessionId = created.id;
        setActiveSessionId(created.id);
        await loadSessions();
        await loadSessionDetail(created.id);
      }
      if (targetSessionId === null) {
        return;
      }
      const currentPath =
        trimOptionalText(boundProjectPathBySession[targetSessionId])
        ?? (
          activeDetail?.session.id === targetSessionId
            ? trimOptionalText(activeDetail.session.projectRoot)
            : null
        )
        ?? undefined;
      const nextPath = await onRequestProjectBind(currentPath);
      if (typeof nextPath !== "string" || nextPath.trim().length === 0) {
        return;
      }
      const normalizedPath = nextPath.trim();
      const persistedSession =
        agentApi === undefined
          ? null
          : await agentApi.bindSessionProject({
              sessionId: targetSessionId,
              projectRoot: normalizedPath
            });
      setBoundProjectPathBySession((current) => ({
        ...current,
        [targetSessionId]:
          persistedSession?.projectRoot !== undefined
            ? persistedSession.projectRoot
            : normalizedPath
      }));
      await loadSessionDetail(targetSessionId);
      await loadSessions();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBindingProject(false);
    }
  }, [
    activeDetail?.session.id,
    activeDetail?.session.projectRoot,
    activeSessionId,
    agentApi,
    boundProjectPathBySession,
    defaultProfileId,
    isBindingProject,
    loadSessionDetail,
    loadSessions,
    newSessionTitle,
    onRequestProjectBind
  ]);

  useEffect(() => {
    const node = threadRef.current;
    if (node === null) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [
    activeSessionId,
    displayRuntimeFeed.length,
    sortedMessages.length,
    streamingAssistantText.length,
    streamingStatus?.label
  ]);

  useEffect(() => {
    if (activeInteractionPanel === null) {
      return;
    }
    const node = interactionPanelRef.current;
    if (node === null) {
      return;
    }
    requestAnimationFrame(() => {
      node.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    });
  }, [activeInteractionId, activeInteractionPanel]);

  const hasPendingInteraction =
    pendingInteractionQueue.length > 0 || transientInteractionPanel !== null;
  const isComposerSurfaceDimmed = activeSessionId === null;
  const isComposerInputDisabled =
    isSending || activeSessionId === null || hasPendingInteraction;
  const isComposerSendDisabled =
    draftInput.trim().length === 0 || activeSessionId === null || hasPendingInteraction;
  const showEmptySessionScene =
    sortedMessages.length === 0
    && streamingAssistantText.length === 0
    && orphanRuntimeFeed.length === 0
    && streamingStatus === null
    && runtimeError === null
    && !isSending;

  const renderRuntimeFeedBlock = (items: readonly AgentRuntimeFeedItem[]) => (
    <div className="lyra-ai-agent-runtime-feed-shell">
      <div className="lyra-ai-agent-runtime-feed">
        {items.map((item) => {
          const openPath = item.openPath;
          const isOpenable = openPath !== undefined && onOpenFilePath !== undefined;
          const location =
            item.firstChangedLine === undefined
              ? undefined
              : ({ line: item.firstChangedLine } as FileEditorRevealLocation);
          const hasLiveOutput = item.liveOutput !== undefined && item.liveOutput.length > 0;
          const isTerminal = isTerminalToolName(item.toolName);
          const isRunning = item.status !== "completed" && item.status !== "failed";
          return (
            <div
              key={item.id}
              className={
                item.status === "failed"
                  ? "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-failed"
                  : item.status === "completed"
                    ? "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-completed"
                    : "lyra-ai-agent-runtime-feed-item lyra-ai-agent-runtime-feed-item-running"
              }
            >
              {isRunning ? (
                <span className="lyra-ai-agent-runtime-feed-spinner" />
              ) : (
                <span
                  className={
                    item.status === "failed"
                      ? "lyra-ai-agent-runtime-feed-dot lyra-ai-agent-runtime-feed-dot-failed"
                      : "lyra-ai-agent-runtime-feed-dot lyra-ai-agent-runtime-feed-dot-completed"
                  }
                />
              )}
              <span
                className="lyra-ai-agent-runtime-feed-icon"
                title={item.toolLabel}
                aria-label={item.toolLabel}
              >
                {renderRuntimeFeedIcon(item.icon)}
              </span>
              {isOpenable ? (
                <button
                  type="button"
                  className="lyra-ai-agent-runtime-feed-target lyra-ai-agent-runtime-feed-target-link"
                  onClick={() => {
                    void openRuntimeTargetPath(openPath, {
                      ...(location === undefined ? {} : { location })
                    });
                  }}
                  title={openPath}
                >
                  {item.target}
                </button>
              ) : (
                <span className="lyra-ai-agent-runtime-feed-target">{item.target}</span>
              )}
              {isTerminal && hasLiveOutput && (
                <pre className="lyra-ai-agent-runtime-feed-output">{item.liveOutput}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStreamStatusBlock = (status: StreamStatusItem) => {
    return (
      <div
        className={
          status.tone === "failed"
            ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-failed"
            : status.tone === "completed"
              ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-completed"
              : status.tone === "waiting"
                ? "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-waiting"
                : "lyra-ai-agent-message-content lyra-ai-stream-status lyra-ai-stream-status-running"
        }
      >
        <span className="lyra-ai-stream-status-label">{status.label}</span>
      </div>
    );
  };

  const topbarActions = (
    <div className="lyra-ai-panel-topbar-actions">
      {onOpenHistory === undefined || openHistoryLabel === undefined ? null : (
        <button
          type="button"
          className="lyra-ai-panel-topbar-action"
          onClick={onOpenHistory}
          aria-label={openHistoryLabel}
          title={openHistoryLabel}
        >
          {renderAiPanelTopbarIcon("history")}
        </button>
      )}
      {onOpenMcp === undefined || openMcpLabel === undefined ? null : (
        <button
          type="button"
          className="lyra-ai-panel-topbar-action"
          onClick={onOpenMcp}
          aria-label={openMcpLabel}
          title={openMcpLabel}
        >
          {renderAiPanelTopbarIcon("mcp")}
        </button>
      )}
      {onOpenSkills === undefined || openSkillsLabel === undefined ? null : (
        <button
          type="button"
          className="lyra-ai-panel-topbar-action"
          onClick={onOpenSkills}
          aria-label={openSkillsLabel}
          title={openSkillsLabel}
        >
          {renderAiPanelTopbarIcon("skills")}
        </button>
      )}
    </div>
  );

  if (agentApi === undefined) {
    return (
      <section className="lyra-ai-panel-surface lyra-ai-panel-surface-sidebar" aria-label={title}>
        <header className="lyra-ai-panel-topbar">
          <div className="lyra-ai-panel-topbar-start">
            {topbarTitle === null ? null : (
              <span className="lyra-ai-panel-history-title">{topbarTitle}</span>
            )}
          </div>
          {topbarActions}
        </header>

        <div className="lyra-ai-panel-content">
          <div className="lyra-ai-panel-static">
            <section className="lyra-ai-panel-static-card">
              <strong>{title}</strong>
              <p>{description}</p>
              {hasDefaultProfile || hasDefaultModels ? (
                <div className="lyra-ai-panel-static-summary">
                  {hasDefaultProfile ? (
                    <div className="lyra-ai-panel-static-summary-row">
                      <span>{profileLabel}</span>
                      <strong>{defaultProfileName}</strong>
                    </div>
                  ) : null}
                  {hasDefaultModels ? (
                    <div className="lyra-ai-panel-static-summary-row">
                      <span>{resolvedModelNames.length > 1 ? modelsLabel : modelLabel}</span>
                      <div className="lyra-ai-panel-static-model-list">
                        {resolvedModelNames.map((entry) => (
                          <span key={entry} className="lyra-ai-panel-static-model-chip">
                            {entry}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="lyra-ai-panel-static-empty">
                  <strong>{emptyStateTitle}</strong>
                  <span>{emptyStateDescription}</span>
                </div>
              )}
              <div className="lyra-ai-panel-static-composer">
                <textarea
                  aria-label={resolvedComposeAriaLabel}
                  placeholder={resolvedComposePlaceholder}
                  readOnly
                />
                <button type="button" disabled>
                  {resolvedComposeSendLabel}
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="lyra-ai-panel-surface lyra-ai-panel-surface-sidebar" aria-label={title}>
      <header className="lyra-ai-panel-topbar">
        <div className="lyra-ai-panel-topbar-start">
          {topbarTitle === null ? null : (
            <span className="lyra-ai-panel-history-title">{topbarTitle}</span>
          )}
        </div>
        {topbarActions}
      </header>

      <div className="lyra-ai-panel-content">
        <div className="lyra-ai-agent-shell">
          <section
            className={
              showEmptySessionScene
                ? "lyra-ai-agent-thread-shell lyra-ai-agent-thread-shell-empty"
                : "lyra-ai-agent-thread-shell"
            }
          >
            {showEmptySessionScene ? (
              <div className="lyra-ai-agent-empty-scene" aria-hidden="true">
                <div className="lyra-ai-agent-empty-hero">
                  <LyraBrandLogo
                    logoUrl={LOGO_URL}
                    className="lyra-ai-agent-empty-logo"
                  />
                  <span className="lyra-ai-agent-empty-copy">
                    {isLoading ? loadingSessionLabel : emptyThreadLabel}
                  </span>
                </div>
              </div>
            ) : null}
            <div
              ref={threadRef}
              className="lyra-ai-agent-thread"
              aria-label={title}
              style={threadStyle}
            >
              {sortedMessages.length === 0
                ? null
                : (
                sortedMessages.map((message) => {
                  const isUserMessage = message.role === "user";
                  const isOptimistic = isOptimisticUserMessage(message);
                  const turnId = "turnId" in message && typeof message.turnId === "string"
                    ? message.turnId
                    : null;
                  const turn = turnId === null ? null : (turnsById.get(turnId) ?? null);
                  const turnToolCalls = turnId === null ? [] : (toolCallsByTurn.get(turnId) ?? []);
                  const assistantOrder = assistantMessageOrderById.get(message.id) ?? null;
                  const turnDurationLabel =
                    turn === null ? null : resolveTurnDurationLabel(turn, turnWorkingLabel, turnWorkedForPrefix);
                  const turnToolSummaryLabel =
                    turn === null
                      ? null
                      : resolveTurnSecondaryLabel(
                          turn,
                          turnToolCalls,
                          toolNameLabels,
                          turnNoToolCallsLabel,
                          turnFailedLabel
                        );
                  const showToolSummary = turnToolCalls.length > 0 && turnToolSummaryLabel !== null;
                  const turnRuntimeFeed =
                    turnId !== null && message.role === "assistant"
                      ? (runtimeFeedByTurn.get(turnId) ?? [])
                      : [];
                  const turnTimeline =
                    turnId !== null && message.role === "assistant"
                      ? (turnTimelineByTurn.get(turnId) ?? [])
                      : [];
                  const fallbackTimeline =
                    turnTimeline.length === 0
                      ? [
                          {
                            kind: "assistant" as const,
                            id: `${message.id}-assistant-fallback`,
                            timestamp: message.createdAt,
                            content: message.content
                          },
                          ...turnRuntimeFeed.map((item) => ({
                            kind: "tool" as const,
                            id: `tool-${item.id}`,
                            timestamp: item.timestamp,
                            tool: item
                          }))
                        ]
                      : turnTimeline;
                  const displayTimeline: AgentTurnTimelineItem[] = [];
                  for (const entry of fallbackTimeline) {
                    if (entry.kind !== "assistant") {
                      displayTimeline.push(entry);
                      continue;
                    }
                    const content = sanitizeAssistantDisplayContent(entry.content);
                    if (content.length === 0) {
                      continue;
                    }
                    displayTimeline.push({
                      ...entry,
                      content
                    });
                  }
                  const lastAssistantTimelineIndex = displayTimeline.reduce(
                    (lastIndex, entry, index) => (entry.kind === "assistant" ? index : lastIndex),
                    -1
                  );
                  const displayMessageContent = isUserMessage
                    ? message.content
                    : sanitizeAssistantDisplayContent(message.content);
                  const messagePlanApprovalRequest =
                    turnId === null
                      ? null
                      : pendingInteractionQueue.find(
                        (interaction): interaction is Extract<PendingInteractionPanel, { kind: "planApproval" }> =>
                          interaction.kind === "planApproval" && interaction.request.turnId === turnId
                      )?.request
                      ?? null;
                  const hasPlanActions =
                    message.role === "assistant"
                    && proposedPlanPattern.test(message.content)
                    && messagePlanApprovalRequest !== null;
                  return (
                    <div
                      key={message.id}
                      className={
                        isUserMessage
                          ? (
                              isOptimistic
                                ? "lyra-ai-agent-message lyra-ai-agent-message-user lyra-ai-agent-message-pending"
                                : "lyra-ai-agent-message lyra-ai-agent-message-user"
                            )
                          : "lyra-ai-agent-message lyra-ai-agent-message-assistant"
                      }
                    >
                      {isUserMessage || !richRenderingEnabled ? (
                        <div className="lyra-ai-agent-message-content">{displayMessageContent}</div>
                      ) : (
                        <>
                          <div className="lyra-ai-agent-turn-timeline">
                            {(() => {
                              const nodes: JSX.Element[] = [];
                              for (let timelineIndex = 0; timelineIndex < displayTimeline.length; timelineIndex += 1) {
                                const timelineEntry = displayTimeline[timelineIndex];
                                if (timelineEntry === undefined) {
                                  continue;
                                }
                                if (timelineEntry.kind === "tool") {
                                  const groupedTools: AgentRuntimeFeedItem[] = [timelineEntry.tool];
                                  let groupEndIndex = timelineIndex;
                                  while (groupEndIndex + 1 < displayTimeline.length) {
                                    const nextEntry = displayTimeline[groupEndIndex + 1];
                                    if (nextEntry === undefined || nextEntry.kind !== "tool") {
                                      break;
                                    }
                                    groupedTools.push(nextEntry.tool);
                                    groupEndIndex += 1;
                                  }
                                  const firstToolId = groupedTools[0]?.id ?? `${message.id}-tool-group-${String(timelineIndex)}`;
                                  const lastToolId = groupedTools[groupedTools.length - 1]?.id ?? firstToolId;
                                  nodes.push(
                                    <div
                                      key={`tool-group-${firstToolId}-${lastToolId}`}
                                      className="lyra-ai-agent-turn-timeline-item lyra-ai-agent-turn-timeline-item-tool"
                                    >
                                      {renderRuntimeFeedBlock(groupedTools)}
                                    </div>
                                  );
                                  timelineIndex = groupEndIndex;
                                  continue;
                                }
                                const shouldAttachPlanActions =
                                  hasPlanActions
                                  && timelineIndex === lastAssistantTimelineIndex;
                                nodes.push(
                                  <div
                                    key={timelineEntry.id}
                                    className="lyra-ai-agent-turn-timeline-item lyra-ai-agent-turn-timeline-item-assistant"
                                  >
                                    {richRenderingEnabled ? (
                                      <AiPanelRichContent
                                        content={timelineEntry.content}
                                        locale={locale}
                                        {...(shouldAttachPlanActions
                                          ? {
                                              planActions: {
                                                onApprove: () => {
                                                  void handlePlanApprovalDecision({
                                                    requestId: messagePlanApprovalRequest!.id,
                                                    decision: "approve_and_implement",
                                                  }, messagePlanApprovalRequest!);
                                                },
                                                onKeepPlanning: () => {
                                                  void handlePlanApprovalDecision({
                                                    requestId: messagePlanApprovalRequest!.id,
                                                    decision: "keep_planning",
                                                  }, messagePlanApprovalRequest!);
                                                },
                                                onReject: () => {
                                                  void handlePlanApprovalDecision({
                                                    requestId: messagePlanApprovalRequest!.id,
                                                    decision: "reject",
                                                  }, messagePlanApprovalRequest!);
                                                },
                                                onOpenInPanel: () => {
                                                  setActiveInteractionId(messagePlanApprovalRequest!.id);
                                                }
                                              }
                                            }
                                          : {})}
                                        {...(themeSignature === undefined ? {} : { themeSignature })}
                                      />
                                    ) : (
                                      <div className="lyra-ai-agent-message-content">{timelineEntry.content}</div>
                                    )}
                                  </div>
                                );
                              }
                              return nodes;
                            })()}
                          </div>
                          {assistantOrder === null || turnDurationLabel === null ? null : (
                            <div className="lyra-ai-agent-turn-footer">
                              <span className="lyra-ai-agent-turn-footer-index">
                                {(isZhLocale ? "消息" : "Message")}
                                ·
                                {String(assistantOrder)}
                              </span>
                              <span className="lyra-ai-agent-turn-footer-duration">
                                {turnDurationLabel}
                              </span>
                            </div>
                          )}
                          {!showToolSummary ? null : (
                            <details className="lyra-ai-agent-turn-tools-details">
                              <summary className="lyra-ai-agent-turn-tools-summary">
                                {(isZhLocale ? "工具总结" : "Tool Summary")}
                              </summary>
                              <div className="lyra-ai-agent-turn-tools-content">
                                {turnToolSummaryLabel}
                              </div>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
                )}
              {typewriterText.length === 0 && streamingTurnRuntimeFeed.length === 0 && streamingStatus === null ? null : (
                <div className="lyra-ai-agent-message lyra-ai-agent-message-assistant">
                  {typewriterText.length > 0 || streamingStatus === null
                    ? null
                    : renderStreamStatusBlock(streamingStatus)}
                  {typewriterText.length === 0 ? null : (
                    richRenderingEnabled ? (
                      <AiPanelRichContent
                        content={typewriterText}
                        locale={locale}
                        {...(themeSignature === undefined ? {} : { themeSignature })}
                      />
                    ) : (
                      <div className="lyra-ai-agent-message-content">{typewriterText}</div>
                    )
                  )}
                  {streamingTurnRuntimeFeed.length === 0 ? null : renderRuntimeFeedBlock(streamingTurnRuntimeFeed)}
                </div>
              )}
              {orphanRuntimeFeed.length === 0 ? null : (
                <div className="lyra-ai-agent-runtime-block-orphan">
                  {renderRuntimeFeedBlock(orphanRuntimeFeed)}
                </div>
              )}
              {runtimeError === null ? null : (
                <div className="lyra-ai-agent-runtime-error">{runtimeError}</div>
              )}
              {activeInteractionPanel !== null ? (
                <div ref={interactionPanelRef} className="lyra-ai-interaction-shell">
                  <div className="lyra-ai-interaction-shell__header">
                    <span className="lyra-ai-interaction-shell__label">
                      {t("ai.pendingInteractions")} {activeInteractionPosition}/{
                        activePendingInteraction === null ? 1 : pendingInteractionQueue.length
                      }
                    </span>
                    <div className="lyra-ai-interaction-shell__actions">
                      {activePendingInteraction !== null && pendingInteractionQueue.length > 1 ? (
                        <>
                          <button
                            type="button"
                            className="lyra-ai-interaction-shell__button"
                            disabled={activeInteractionPosition <= 1}
                            onClick={() => {
                              const previous = pendingInteractionQueue[activeInteractionPosition - 2];
                              setActiveInteractionId(previous?.request.id ?? null);
                            }}
                          >
                            {t("ai.navPrevious")}
                          </button>
                          <button
                            type="button"
                            className="lyra-ai-interaction-shell__button"
                            disabled={activeInteractionPosition >= pendingInteractionQueue.length}
                            onClick={() => {
                              const next = pendingInteractionQueue[activeInteractionPosition];
                              setActiveInteractionId(next?.request.id ?? null);
                            }}
                          >
                            {t("ai.navNext")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {activeInteractionPanel?.kind === "commandApproval" ? (
                    <CommandApprovalBar
                      locale={locale}
                      request={activeInteractionPanel.request}
                      onDecision={(response) => {
                        void handleApprovalDecision(response);
                      }}
                    />
                  ) : null}
                  {activeInteractionPanel?.kind === "planQuestion" ? (
                    <PlanQuestionBar
                      locale={locale}
                      request={activeInteractionPanel.request}
                      onSubmit={(payload) => {
                        void handlePlanQuestionSubmit(payload);
                      }}
                    />
                  ) : null}
                  {activeInteractionPanel?.kind === "planApproval" ? (
                    <PlanApprovalBar
                      locale={locale}
                      request={activeInteractionPanel.request}
                      onDecision={(response) => {
                        void handlePlanApprovalDecision(response);
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <AgentComposer
              locale={locale}
              modelLabel={resolvedModelNames.length > 1 ? modelsLabel : modelLabel}
              modelNames={resolvedModelNames}
              value={draftInput}
              ariaLabel={resolvedComposeAriaLabel}
              placeholder={resolvedComposePlaceholder}
              sendLabel={resolvedComposeSendLabel}
              inputDisabled={isComposerInputDisabled}
              sendDisabled={isComposerSendDisabled}
              sending={isSending}
              surfaceDimmed={isComposerSurfaceDimmed}
              {...(bindProjectLabel === undefined ? {} : { bindProjectLabel })}
              boundProjectName={activeBoundProjectName}
              planModeEnabled={isPlanModeEnabled}
              planModeLocked={isPlanModeLocked}
              planModeLabel={composerPlanLabel}
              bindDisabled={onRequestProjectBind === undefined || isBindingProject}
              bindPending={isBindingProject}
              onPlanModeToggle={() => {
                if (activeSessionId === null || isPlanModeLocked) {
                  return;
                }
                setPlanModeArmedBySession((current) => ({
                  ...current,
                  [activeSessionId]: !(current[activeSessionId] === true)
                }));
              }}
              onBindProject={() => {
                void bindProject();
              }}
              onHeightChange={setComposerHeight}
              onValueChange={setDraftInput}
              onSend={() => {
                void sendTurn();
              }}
            />
          </section>
        </div>
      </div>
    </section>
  );
};
