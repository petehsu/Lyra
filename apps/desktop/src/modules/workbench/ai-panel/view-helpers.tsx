import {
  Asterisk,
  BookText,
  Bot,
  FileCode,
  Files,
  FolderTree,
  Pencil,
  Search,
  Wrench
} from "lucide-react";

import type { AiProviderProfile } from "../../../shared/ai";
import type {
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentTurn,
} from "../../../shared/desktop-bridge";
import {
  type AgentRuntimeFeedIconKind,
} from "./runtime/feed-utils";

export type OptimisticUserMessage = {
  readonly id: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly role: "user";
  readonly content: string;
  readonly contentParts?: AgentSessionDetail["messages"][number]["contentParts"];
  readonly createdAt: number;
  readonly optimistic: true;
};

export type DisplayMessage = AgentSessionDetail["messages"][number] | OptimisticUserMessage;

export type StreamStatusTone = "running" | "waiting" | "completed" | "failed";

export type StreamStatusItem = {
  readonly label: string;
  readonly tone: StreamStatusTone;
};

const internalReflectionHeadingPattern = /(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:reflection|反思)[\s\S]*$/i;

export const sortByTime = <T extends { readonly createdAt: number }>(
  entries: readonly T[]
): readonly T[] => [...entries].sort((left, right) => left.createdAt - right.createdAt);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

export const pickString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" && next.trim().length > 0 ? next : null;
};

export const pickRawString = (value: Record<string, unknown>, key: string): string | null => {
  const next = value[key];
  return typeof next === "string" ? next : null;
};

export const pickNumber = (value: Record<string, unknown>, key: string): number | null => {
  const next = value[key];
  return typeof next === "number" ? next : null;
};

export const resolveEventError = (event: AgentRuntimeEvent): string | null => {
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

export const isSessionNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /session not found/i.test(message);
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

export const truncateDisplayText = (value: string, maxLength: number): string => {
  const chars = [...value.trim()];
  if (chars.length <= maxLength) {
    return chars.join("");
  }
  return `${chars.slice(0, maxLength).join("")}…`;
};

export const normalizeStreamingStatusLabel = (label: string): string =>
  label.replace(/(?:\.\.\.|…)+\s*$/g, "").trim();

export const sanitizeAssistantDisplayContent = (content: string): string => {
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

export const resolveAssistantDisplayContent = (
  message: Pick<AgentSessionDetail["messages"][number], "content"> & { readonly displayContent?: string }
): string => {
  if (typeof message.displayContent === "string" && message.displayContent.trim().length > 0) {
    return message.displayContent;
  }
  return sanitizeAssistantDisplayContent(message.content);
};

export const runtimeEventPhasePriority = (phase: string): number => {
  if (phase === "failed") {
    return 8;
  }
  if (phase === "plan_proposed" || phase === "plan_approval_requested" || phase === "plan_question_requested") {
    return 8;
  }
  if (phase === "completed") {
    return 7;
  }
  if (phase === "rolled_back") {
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
  if (phase === "started" || phase === "review_started") {
    return 3;
  }
  if (phase === "accepted" || phase === "steer_submitted") {
    return 2;
  }
  if (
    phase === "assistant_delta"
    || phase === "plan_delta"
    || phase === "plan_updated"
    || phase === "reasoning_delta"
    || phase === "token_usage_updated"
  ) {
    return 1;
  }
  return 0;
};

export const pickMostRecentRuntimeEvent = (
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

export const extractFolderName = (pathText: string): string => {
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

export const resolveTurnDurationLabel = (
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

export const isOptimisticUserMessage = (message: DisplayMessage): message is OptimisticUserMessage =>
  "optimistic" in message && message.optimistic === true;

export const renderRuntimeFeedIcon = (kind: AgentRuntimeFeedIconKind) => {
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
  if (kind === "agent") {
    return <Bot size={11} />;
  }
  if (kind === "tool") {
    return <Wrench size={11} />;
  }
  return <FileCode size={11} />;
};

export const trimOptionalText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveProfileModels = (
  profile: AiProviderProfile | null | undefined
): readonly string[] => {
  if (profile === null || profile === undefined) {
    return [];
  }
  return [profile.model, ...profile.customModels.map((entry) => entry.id)]
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
};
