import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentPendingInteraction,
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentToolCall,
  CapabilityRuntimeEvent,
  LyraClientRequestPayload,
  LyraDesktopApi,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import type {
  CommandApprovalResponse,
} from "../command-approval-bar";
import {
  mergePendingInteractionLists,
  sortPendingInteractions,
  toPendingInteractionPanel,
  type ActiveInteractionPanel,
  type InteractionTextBundle,
  type PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";
import {
  attachThreadAiPanelViewModel,
  lyraThreadToAgentDetail,
  readThreadAiPanelViewModel,
  readLyraThread,
  threadItemToToolCall,
  type LyraThread,
  type LyraThreadItem,
  type LyraTurn,
} from "./lyra-thread-adapter";
import {
  EMPTY_RUNTIME_BUCKET,
  useLyraThreadRuntimeBuckets,
  type LyraPlanStep,
  type LyraPlanStepStatus,
  type LyraTurnPlanState,
} from "./use-lyra-thread-runtime-buckets";
import type {
  OptimisticUserMessage,
} from "./view-helpers";
import {
  readWorkbenchStateSync,
  writeWorkbenchStateSync,
} from "../state-storage";
import { isWriteToolName } from "./runtime/feed-utils";
import type { AiPanelWriteStreamEvent } from "./types";

type JsonRecord = Record<string, unknown>;

export type LyraCollaborationMode = "default" | "plan";

export type {
  LyraPlanStep,
  LyraPlanStepStatus,
  LyraTurnPlanState,
} from "./use-lyra-thread-runtime-buckets";

export type LyraThreadTabStatus = "draft" | "idle" | "running" | "error";

export type LyraThreadTab = {
  readonly tabId: string;
  readonly threadId: string | null;
  readonly title: string;
  readonly openedAt: number;
  readonly updatedAt: number;
  readonly status: LyraThreadTabStatus;
};

export type LyraThreadRuntimeState = {
  readonly threads: readonly LyraThread[];
  readonly threadTabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
  readonly activeThreadId: string | null;
  readonly activeThread: LyraThread | null;
  readonly activeDetail: AgentSessionDetail | null;
  readonly planModeEnabled: boolean;
  readonly followEnabled: boolean;
  readonly planByTurn: Readonly<Record<string, LyraTurnPlanState>>;
  readonly latestPlanTurnId: string | null;
  readonly optimisticUserMessages: readonly OptimisticUserMessage[];
  readonly liveToolCalls: readonly AgentToolCall[];
  readonly latestRuntimeEventByTurn: Readonly<Record<string, AgentRuntimeEvent>>;
  readonly pendingInteractions: readonly AgentPendingInteraction[];
  readonly pendingInteractionQueue: readonly PendingInteractionPanel[];
  readonly activeInteractionPanel: ActiveInteractionPanel;
  readonly activePendingInteraction: PendingInteractionPanel | null;
  readonly activeInteractionPosition: number;
  readonly activeInteractionId: string | null;
  readonly isLoadingThreads: boolean;
  readonly isLoadingThread: boolean;
  readonly isSending: boolean;
  readonly isStreamActive: boolean;
  readonly isInteractionSubmitting: boolean;
  readonly streamingTurnId: string | null;
  readonly streamingAssistantText: string;
  readonly finalizingTurnId: string | null;
  readonly runtimeError: string | null;
};

export type LyraThreadRuntimeActions = {
  readonly loadThreads: () => Promise<void>;
  readonly loadThread: (threadId: string) => Promise<void>;
  readonly createThread: (options?: RuntimeThreadOptions) => Promise<string>;
  readonly sendTurn: (input: RuntimeTurnInput, options?: RuntimeThreadOptions) => Promise<void>;
  readonly steerTurn: (input: RuntimeTurnInput) => Promise<void>;
  readonly interruptTurn: () => Promise<void>;
  readonly cleanBackgroundTerminals: () => Promise<void>;
  readonly forkThread: (options?: RuntimeThreadOptions) => Promise<string>;
  readonly forkThreadFromTurn: (
    turnId: string,
    numTurnsAfter: number,
    options?: RuntimeThreadOptions
  ) => Promise<string>;
  readonly rollbackThread: (turnId: string) => Promise<string | null>;
  readonly startReview: (target: ReviewTarget, options?: RuntimeReviewOptions) => Promise<void>;
  readonly selectThread: (threadId: string | null) => void;
  readonly activateThreadTab: (tabId: string) => void;
  readonly closeThreadTab: (tabId: string) => void;
  readonly reorderThreadTab: (tabId: string, targetIndex: number) => void;
  readonly openThreadTab: (threadId: string) => void;
  readonly setPlanModeEnabled: (enabled: boolean) => void;
  readonly setFollowEnabled: (enabled: boolean) => void;
  readonly setActiveInteractionId: (interactionId: string | null) => void;
  readonly respondToCommandApproval: (response: CommandApprovalResponse) => Promise<void>;
  readonly respondToPlanQuestion: (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string }
  ) => Promise<void>;
  readonly resolvePlanApproval: (input: ResolvePlanApprovalInput) => Promise<void>;
};

export type ReviewTarget =
  | { readonly type: "uncommittedChanges" }
  | { readonly type: "baseBranch"; readonly branch: string }
  | { readonly type: "commit"; readonly sha: string; readonly title: string | null }
  | { readonly type: "custom"; readonly instructions: string };

export type RuntimeThreadOptions = {
  readonly model?: string | undefined;
  readonly modelProvider?: string | null | undefined;
  readonly cwd?: string | null | undefined;
  readonly collaborationMode?: LyraCollaborationMode | undefined;
  readonly effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
  readonly verbosity?: "low" | "medium" | "high" | undefined;
  readonly approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never" | undefined;
  readonly approvalsReviewer?: "user" | "auto_review" | undefined;
  readonly sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
};

export type RuntimeReviewOptions = {
  readonly cwd?: string | null | undefined;
};

export type RuntimeTurnAttachment = {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "local_image" | "image" | "workbench_tab" | "ai_thread";
  readonly contextText?: string | undefined;
};

export type RuntimeTurnInputPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "attachment";
    readonly attachment: RuntimeTurnAttachment;
  };

export type RuntimeTurnInput = {
  readonly text: string;
  readonly attachments: readonly RuntimeTurnAttachment[];
  readonly parts?: readonly RuntimeTurnInputPart[];
};

export type ResolvePlanApprovalInput = {
  readonly threadId: string;
  readonly planTurnId: string;
  readonly requestId: string;
  readonly decision: PlanInteractionResponse["decision"];
  readonly feedback?: string | undefined;
  readonly proposedMarkdown?: string | undefined;
};

type UseLyraThreadRuntimeOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly interactionTextLabels: InteractionTextBundle;
  readonly onFollowOpenFilePath?: (filePath: string, options?: {
    readonly forceReloadIfOpen?: boolean;
    readonly allowMissing?: boolean;
    readonly location?: { readonly line: number };
  }) => void;
  readonly onWriteStreamEvent?: (event: AiPanelWriteStreamEvent) => void;
};

type LyraThreadTabState = {
  readonly tabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
};

type PersistedThreadTab = {
  readonly tabId?: unknown;
  readonly threadId?: unknown;
  readonly title?: unknown;
  readonly openedAt?: unknown;
  readonly updatedAt?: unknown;
};

type PersistedThreadTabState = {
  readonly version?: unknown;
  readonly activeTabId?: unknown;
  readonly tabs?: unknown;
};

const AI_PANEL_TABS_STATE_KEY = "ai-panel-tabs" as const;
const DRAFT_TAB_PREFIX = "draft:";
const DEFAULT_DRAFT_TITLE = "New thread";

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

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

const readPathString = (value: unknown): string | null =>
  typeof value === "string" ? normalizeRuntimePath(value) : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readRawString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readTimestamp = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
};

const readPathLike = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  return readPathString(value.path)
    ?? readPathString(value.rootPath)
    ?? readPathString(value.root)
    ?? readPathString(value.relativePath);
};

const readFirstChangePath = (value: unknown): string | null => {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    return null;
  }
  for (const change of value.changes) {
    const path = readPathLike(change);
    if (path !== null) {
      return path;
    }
  }
  return null;
};

const readFirstChangeLineFromDiff = (diff: unknown): number | null => {
  const text = readRawString(diff);
  if (text === null) {
    return null;
  }
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m.exec(text);
  if (match === null) {
    return null;
  }
  const line = Number.parseInt(match[1]!, 10);
  return Number.isFinite(line) ? Math.max(1, line) : null;
};

const unquoteDiffPath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return trimmed;
};

const stripDiffPathPrefix = (value: string): string | null => {
  const path = normalizeRuntimePath(unquoteDiffPath(value));
  if (path === null) {
    return null;
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return normalizeRuntimePath(path.slice(2));
  }
  return path;
};

const isAbsolutePathLike = (value: string): boolean =>
  value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);

const resolveDiffPath = (filePath: string, cwd?: string | null): string => {
  if (isAbsolutePathLike(filePath) || cwd === undefined || cwd === null || cwd.trim().length === 0) {
    return filePath;
  }
  const trimmedCwd = cwd.trim();
  const separator = trimmedCwd.includes("\\") && !trimmedCwd.includes("/") ? "\\" : "/";
  return `${trimmedCwd.replace(/[\\/]+$/, "")}${separator}${filePath}`;
};

const readFirstPathFromUnifiedDiff = (
  diff: unknown,
  cwd?: string | null
): string | null => {
  const text = readRawString(diff);
  if (text === null) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const fallback = lines
    .filter((line) => line.startsWith("--- "))
    .map((line) => stripDiffPathPrefix(line.slice(4)))
    .find((path): path is string => path !== null) ?? null;
  const preferred = lines
    .filter((line) => line.startsWith("+++ "))
    .map((line) => stripDiffPathPrefix(line.slice(4)))
    .find((path): path is string => path !== null) ?? null;
  const filePath = preferred ?? fallback;
  return filePath === null ? null : resolveDiffPath(filePath, cwd);
};

const readFirstChangeLineFromChanges = (value: unknown): number | null => {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    return null;
  }
  for (const change of value.changes) {
    if (!isRecord(change)) {
      continue;
    }
    const line = readFirstChangeLineFromDiff(change.diff);
    if (line !== null) {
      return line;
    }
  }
  return null;
};

const readFirstApplyPatchApprovalTarget = (
  params: JsonRecord,
  cwd?: string | null
): { readonly path: string; readonly line?: number } | null => {
  const fileChanges = isRecord(params.fileChanges) ? params.fileChanges : null;
  if (fileChanges === null) {
    return null;
  }
  for (const [filePath, change] of Object.entries(fileChanges)) {
    const normalizedPath = normalizeRuntimePath(filePath);
    if (normalizedPath === null || !isRecord(change)) {
      continue;
    }
    return {
      path: resolveDiffPath(normalizedPath, cwd),
      ...(readFirstChangeLineFromDiff(change.unified_diff) === null
        ? {}
        : { line: readFirstChangeLineFromDiff(change.unified_diff)! }),
    };
  }
  return null;
};

const readCreatedFromChanges = (value: unknown): boolean | undefined => {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    return undefined;
  }
  const firstChange = value.changes.find(isRecord);
  const kind = isRecord(firstChange?.kind) ? readString(firstChange.kind.type) : null;
  return kind === null ? undefined : kind === "add";
};

const readOptionalLine = (...values: readonly unknown[]): number | undefined => {
  for (const value of values) {
    const line = readNumber(value);
    if (line !== null) {
      return Math.max(1, Math.round(line));
    }
  }
  return undefined;
};

const readOptionalCount = (...values: readonly unknown[]): number | undefined => {
  for (const value of values) {
    const count = readNumber(value);
    if (count !== null) {
      return Math.max(0, Math.round(count));
    }
  }
  return undefined;
};

const readOptionalBoolean = (...values: readonly unknown[]): boolean | undefined => {
  for (const value of values) {
    const next = readBoolean(value);
    if (next !== null) {
      return next;
    }
  }
  return undefined;
};

const readOptionalRawString = (...values: readonly unknown[]): string | undefined => {
  for (const value of values) {
    const next = readRawString(value);
    if (next !== null) {
      return next;
    }
  }
  return undefined;
};

type WriteStreamCallMetadata = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly filePath: string;
  readonly timestamp: number;
  readonly created?: boolean;
  readonly baselineContent?: string;
  readonly firstChangedLine?: number;
  readonly addedLines?: number;
  readonly removedLines?: number;
};

const readFileCapabilityPreview = (payload: unknown): {
  readonly filePath: string;
  readonly created?: boolean;
  readonly baselineContent?: string;
  readonly firstChangedLine?: number;
  readonly addedLines?: number;
  readonly removedLines?: number;
} | null => {
  if (!isRecord(payload) || !isRecord(payload.preview)) {
    return null;
  }
  const kind = readString(payload.preview.kind);
  if (kind !== "file-edit" && kind !== "file-create") {
    return null;
  }
  const filePath = readPathString(payload.preview.filePath);
  if (filePath === null) {
    return null;
  }
  return {
    filePath,
    ...(kind === "file-create" ? { created: true } : {}),
    ...(readRawString(payload.preview.baselineContent) === null
      ? kind === "file-create" ? { baselineContent: "" } : {}
      : { baselineContent: readRawString(payload.preview.baselineContent)! }),
    ...(readOptionalLine(payload.preview.firstChangedLine) === undefined
      ? {}
      : { firstChangedLine: readOptionalLine(payload.preview.firstChangedLine)! }),
    ...(readOptionalCount(payload.preview.addedLines) === undefined
      ? {}
      : { addedLines: readOptionalCount(payload.preview.addedLines)! }),
    ...(readOptionalCount(payload.preview.removedLines) === undefined
      ? {}
      : { removedLines: readOptionalCount(payload.preview.removedLines)! }),
  };
};

const readTerminalTranscriptChunks = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];

const normalizeTerminalOutputStream = (value: unknown): "stdout" | "stderr" =>
  value === "stderr" ? "stderr" : "stdout";

const createTabId = (): string =>
  `${DRAFT_TAB_PREFIX}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

const buildRuntimeThreadTitle = (thread: LyraThread, fallback: string): string => {
  const name = thread.name?.trim();
  if (name !== undefined && name.length > 0) {
    return name;
  }
  const preview = thread.preview.trim();
  return preview.length > 0 ? preview : fallback;
};

const createDraftThreadTab = (): LyraThreadTab => {
  const now = Date.now();
  return {
    tabId: createTabId(),
    threadId: null,
    title: DEFAULT_DRAFT_TITLE,
    openedAt: now,
    updatedAt: now,
    status: "draft",
  };
};

const createThreadTabFromThreadId = (threadId: string, title: string): LyraThreadTab => {
  const now = Date.now();
  return {
    tabId: `thread:${threadId}`,
    threadId,
    title,
    openedAt: now,
    updatedAt: now,
    status: "idle",
  };
};

const tabRuntimeKey = (tab: LyraThreadTab): string => tab.threadId ?? tab.tabId;

const normalizeTabState = (state: LyraThreadTabState): LyraThreadTabState => {
  const seenTabIds = new Set<string>();
  const seenThreadIds = new Set<string>();
  const tabs = state.tabs.filter((tab) => {
    if (tab.tabId.trim().length === 0 || seenTabIds.has(tab.tabId)) {
      return false;
    }
    if (tab.threadId !== null) {
      if (seenThreadIds.has(tab.threadId)) {
        return false;
      }
      seenThreadIds.add(tab.threadId);
    }
    seenTabIds.add(tab.tabId);
    return true;
  });
  const normalizedTabs = tabs.length > 0 ? tabs : [createDraftThreadTab()];
  const activeTabId = normalizedTabs.some((tab) => tab.tabId === state.activeTabId)
    ? state.activeTabId
    : normalizedTabs[0]?.tabId ?? null;
  return {
    tabs: normalizedTabs,
    activeTabId,
  };
};

const activeTabFromTabState = (state: LyraThreadTabState): LyraThreadTab | null =>
  state.tabs.find((tab) => tab.tabId === state.activeTabId) ?? state.tabs[0] ?? null;

const activeThreadIdFromTabState = (state: LyraThreadTabState): string | null =>
  activeTabFromTabState(state)?.threadId ?? null;

const activeRuntimeKeyFromTabState = (state: LyraThreadTabState): string | null => {
  const tab = activeTabFromTabState(state);
  return tab === null ? null : tabRuntimeKey(tab);
};

const closeTabState = (state: LyraThreadTabState, tabId: string): LyraThreadTabState => {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (index < 0) {
    return normalizeTabState(state);
  }
  const nextTabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  if (state.activeTabId !== tabId) {
    return normalizeTabState({ ...state, tabs: nextTabs });
  }
  const nextActiveTab = nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs[0] ?? null;
  return normalizeTabState({
    tabs: nextTabs,
    activeTabId: nextActiveTab?.tabId ?? null,
  });
};

const insertThreadTabAfterActive = (
  state: LyraThreadTabState,
  tab: LyraThreadTab
): readonly LyraThreadTab[] => {
  const activeIndex = state.tabs.findIndex((candidate) => candidate.tabId === state.activeTabId);
  const insertIndex = activeIndex < 0 ? state.tabs.length : activeIndex + 1;
  return [
    ...state.tabs.slice(0, insertIndex),
    tab,
    ...state.tabs.slice(insertIndex),
  ];
};

const reorderTabState = (
  state: LyraThreadTabState,
  tabId: string,
  targetIndex: number
): LyraThreadTabState => {
  if (!Number.isFinite(targetIndex)) {
    return normalizeTabState(state);
  }
  const fromIndex = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (fromIndex < 0) {
    return normalizeTabState(state);
  }
  const movingTab = state.tabs[fromIndex];
  if (movingTab === undefined) {
    return normalizeTabState(state);
  }
  const clampedTargetIndex = Math.max(0, Math.min(state.tabs.length, Math.round(targetIndex)));
  const tabsWithoutMovingTab = state.tabs.filter((tab) => tab.tabId !== tabId);
  const adjustedTargetIndex = fromIndex < clampedTargetIndex
    ? clampedTargetIndex - 1
    : clampedTargetIndex;
  return normalizeTabState({
    ...state,
    tabs: [
      ...tabsWithoutMovingTab.slice(0, adjustedTargetIndex),
      movingTab,
      ...tabsWithoutMovingTab.slice(adjustedTargetIndex),
    ],
  });
};

const readPersistedTab = (value: unknown): LyraThreadTab | null => {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value as PersistedThreadTab;
  const tabId = readString(raw.tabId);
  if (tabId === null) {
    return null;
  }
  const openedAt = readNumber(raw.openedAt) ?? Date.now();
  const updatedAt = readNumber(raw.updatedAt) ?? openedAt;
  const threadId = readString(raw.threadId);
  return {
    tabId,
    threadId,
    title: readString(raw.title) ?? DEFAULT_DRAFT_TITLE,
    openedAt,
    updatedAt,
    status: threadId === null ? "draft" : "idle",
  };
};

const readInitialTabState = (): LyraThreadTabState => {
  const raw = readWorkbenchStateSync(AI_PANEL_TABS_STATE_KEY);
  if (raw === null) {
    return normalizeTabState({ tabs: [createDraftThreadTab()], activeTabId: null });
  }
  try {
    const parsed = JSON.parse(raw) as PersistedThreadTabState;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.map(readPersistedTab).filter((tab): tab is LyraThreadTab => tab !== null)
      : [];
    return normalizeTabState({
      tabs,
      activeTabId: readString(parsed.activeTabId),
    });
  } catch (_error) {
    return normalizeTabState({ tabs: [createDraftThreadTab()], activeTabId: null });
  }
};

const writeTabSnapshot = (state: LyraThreadTabState): void => {
  writeWorkbenchStateSync(
    AI_PANEL_TABS_STATE_KEY,
    JSON.stringify({
      version: 1,
      activeTabId: state.activeTabId,
      tabs: state.tabs
        .filter((tab) => tab.threadId !== null)
        .map((tab) => ({
          tabId: tab.tabId,
          threadId: tab.threadId,
          title: tab.title,
          openedAt: tab.openedAt,
          updatedAt: tab.updatedAt,
        })),
    })
  );
};

const normalizeStatus = (value: unknown): string =>
  readString(value)?.replace(/[_\s-]+/g, "").toLowerCase() ?? "";

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isThreadUnavailableError = (error: unknown, threadId: string): boolean => {
  const message = errorMessageOf(error).toLowerCase();
  return (
    message.includes(threadId.toLowerCase())
    && (
      message.includes("thread not found")
      || message.includes("thread not loaded")
      || message.includes("unknown thread")
    )
  );
};

const normalizePlanStepStatus = (value: unknown): LyraPlanStepStatus => {
  const normalized = normalizeStatus(value);
  if (normalized === "inprogress" || normalized === "running") {
    return "inProgress";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "completed";
  }
  return "pending";
};

const requestKeyOf = (requestId: string | number): string => String(requestId);

const createRequestPayload = (
  method: string,
  params: JsonRecord = {}
): LyraClientRequestPayload => ({ method, params });

const toRuntimeEvent = ({
  sessionId,
  turnId,
  phase,
  payload,
}: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly phase: string;
  readonly payload: unknown;
}): AgentRuntimeEvent => ({
  sessionId,
  turnId,
  phase,
  payload,
  timestamp: Date.now(),
  toolOwner: "agent_core",
});

const firstNonEmptyLine = (text: string): string | null =>
  text.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length > 0) ?? null;

const planApprovalPayload = (
  turnId: string,
  planText: string,
  draftText: string
): JsonRecord => ({
  requestId: `plan:${turnId}`,
  version: 0,
  status: "submitted",
  summary: firstNonEmptyLine(planText) ?? "Proposed plan",
  proposedMarkdown: planText,
  ...(draftText.length === 0 ? {} : { draftMarkdown: draftText }),
});

const planApprovalInteraction = (
  threadId: string,
  turnId: string,
  planText: string,
  draftText: string,
  timestamp: number
): AgentPendingInteraction => {
  const requestId = `plan:${turnId}`;
  return {
    id: requestId,
    sessionId: threadId,
    turnId,
    kind: "plan_approval",
    status: "pending",
    payload: {
      requestId,
      agentCoreMethod: "turn/planApproval/resolve",
      raw: planApprovalPayload(turnId, planText, draftText),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const toolCallFollowTarget = (
  call: AgentToolCall
): { readonly path: string; readonly line?: number } | null => {
  const input = isRecord(call.input) ? call.input : {};
  const output = isRecord(call.output) ? call.output : {};
  if (call.toolName === "filesystem.read_range") {
    const path = readPathLike(input) ?? readPathLike(output);
    if (path === null) {
      return null;
    }
    const startLine =
      readNumber(input.startLine)
      ?? readNumber(input.start_line)
      ?? readNumber(output.startLine)
      ?? readNumber(output.start_line);
    return {
      path,
      ...(startLine === null ? {} : { line: Math.max(1, Math.round(startLine)) }),
    };
  }
  if (!isWriteToolName(call.toolName)) {
    return null;
  }
  const path = readFirstChangePath(output)
    ?? readPathLike(output)
    ?? readPathLike(input);
  if (path === null) {
    return null;
  }
  const firstChangedLine =
    readNumber(output.firstChangedLine)
    ?? readNumber(output.first_changed_line)
    ?? readNumber(input.firstChangedLine)
    ?? readNumber(input.first_changed_line);
  return {
    path,
    ...(firstChangedLine === null ? {} : { line: Math.max(1, Math.round(firstChangedLine)) }),
  };
};

const requestKindFromMethod = (method: string): AgentPendingInteraction["kind"] | null => {
  if (method === "item/commandExecution/requestApproval") {
    return "command_execution_approval";
  }
  if (method === "item/fileChange/requestApproval") {
    return "file_change_approval";
  }
  if (method === "item/permissions/requestApproval") {
    return "permissions_approval";
  }
  if (method === "item/tool/requestUserInput") {
    return "tool_user_input";
  }
  if (method === "mcpServer/elicitation/request") {
    return "mcp_elicitation";
  }
  return null;
};

const normalizeRequestPayload = (
  method: string,
  params: JsonRecord
): JsonRecord => {
  if (method === "item/commandExecution/requestApproval") {
    return {
      ...params,
      toolName: "terminal.exec",
      input: {
        command: readString(params.command) ?? "",
        cwd: readString(params.cwd) ?? undefined,
      },
      metadata: {
        command: readString(params.command) ?? "",
        riskLevel: "medium",
      },
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      ...params,
      toolName: "filesystem.write",
      input: {
        path: readString(params.grantRoot) ?? "",
      },
      metadata: {
        riskLevel: "medium",
      },
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      ...params,
      toolName: "permissions.request",
      input: {
        permissions: params.permissions,
      },
      metadata: {
        riskLevel: "medium",
      },
    };
  }
  return params;
};

const interactionFromServerRequest = (
  requestId: string | number,
  method: string,
  params: JsonRecord
): AgentPendingInteraction | null => {
  const kind = requestKindFromMethod(method);
  if (kind === null) {
    return null;
  }
  const key = requestKeyOf(requestId);
  const now = Date.now();
  const sessionId = readString(params.threadId) ?? "unknown-thread";
  const turnId = readString(params.turnId) ?? "unknown-turn";
  return {
    id: key,
    sessionId,
    turnId,
    kind,
    status: "pending",
    payload: {
      requestId: key,
      agentCoreMethod: method,
      raw: normalizeRequestPayload(method, params),
    },
    createdAt: now,
    updatedAt: now,
  };
};

const findThreadTurn = (
  thread: LyraThread | null,
  turnId: string
): LyraTurn | null =>
  thread?.turns.find((turn) => turn.id === turnId) ?? null;

const assistantTextFromThreadItem = (item: LyraThreadItem): string =>
  item.type === "agentMessage" ? readString(item.text) ?? "" : "";

const shouldUpsertLiveThreadItem = (item: LyraThreadItem): boolean =>
  item.type === "agentMessage" || item.type === "plan";

const upsertLiveThreadItem = (
  thread: LyraThread | undefined,
  threadId: string,
  turnId: string,
  item: LyraThreadItem
): LyraThread => {
  const now = Date.now();
  const currentThread: LyraThread = thread ?? {
    id: threadId,
    preview: assistantTextFromThreadItem(item),
    modelProvider: "lyra",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  const existingTurn = findThreadTurn(currentThread, turnId);
  const baseTurn: LyraTurn = existingTurn ?? {
    id: turnId,
    status: "inProgress",
    items: [],
    startedAt: now,
  };
  const itemId = item.id ?? `${turnId}:${item.type}`;
  const nextItems = [
    ...baseTurn.items.filter((entry) => (entry.id ?? `${turnId}:${entry.type}`) !== itemId),
    item,
  ];
  const nextTurn: LyraTurn = {
    ...baseTurn,
    items: nextItems,
  };
  return {
    ...currentThread,
    preview: currentThread.preview || assistantTextFromThreadItem(item),
    updatedAt: Math.max(currentThread.updatedAt, now),
    turns: existingTurn === null
      ? [...currentThread.turns, nextTurn]
      : currentThread.turns.map((turn) => turn.id === turnId ? nextTurn : turn),
  };
};

const consumeCompletedAssistantStreamingText = (
  current: string,
  completedText: string
): string => {
  if (current.length === 0 || completedText.length === 0) {
    return current;
  }
  if (current.startsWith(completedText)) {
    return current.slice(completedText.length);
  }
  const trimmedStart = current.trimStart();
  if (trimmedStart !== current && trimmedStart.startsWith(completedText)) {
    return trimmedStart.slice(completedText.length);
  }
  return current;
};

const extractPlanStatesFromThread = (
  thread: LyraThread,
): Readonly<Record<string, LyraTurnPlanState>> => {
  const next: Record<string, LyraTurnPlanState> = {};
  for (const plan of thread.aiPanelViewModel?.plans ?? []) {
    const finalText = plan.finalText?.trim() ?? "";
    const draftText = plan.draftText.trim();
    if (finalText.length === 0 && draftText.length === 0) {
      continue;
    }
    next[plan.turnId] = {
      turnId: plan.turnId,
      draftText,
      finalText: finalText.length === 0 ? null : finalText,
      explanation: plan.explanation ?? null,
      steps: plan.steps,
      updatedAt: plan.updatedAtMs,
    };
  }
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type !== "plan") {
        continue;
      }
      const text = readString(item.text) ?? "";
      if (text.length === 0) {
        continue;
      }
      next[turn.id] = {
        turnId: turn.id,
        draftText: "",
        finalText: text,
        explanation: null,
        steps: [],
        updatedAt: thread.updatedAt,
      };
    }
  }
  return next;
};

const mergePlanStates = (
  current: Readonly<Record<string, LyraTurnPlanState>>,
  incoming: Readonly<Record<string, LyraTurnPlanState>>,
): Readonly<Record<string, LyraTurnPlanState>> => {
  const next: Record<string, LyraTurnPlanState> = { ...current };
  for (const [turnId, state] of Object.entries(incoming)) {
    const existing = next[turnId];
    next[turnId] = existing === undefined
      ? state
      : {
          ...existing,
          ...state,
          draftText: existing.draftText.length > 0 ? existing.draftText : state.draftText,
          finalText: state.finalText ?? existing.finalText,
          steps: state.steps.length > 0 ? state.steps : existing.steps,
          updatedAt: Math.max(existing.updatedAt, state.updatedAt),
        };
  }
  return next;
};

const latestPlanTurnIdOf = (
  planByTurn: Readonly<Record<string, LyraTurnPlanState>>
): string | null => {
  let latest: LyraTurnPlanState | null = null;
  for (const state of Object.values(planByTurn)) {
    if ((state.finalText ?? state.draftText).trim().length === 0) {
      continue;
    }
    if (latest === null || state.updatedAt >= latest.updatedAt) {
      latest = state;
    }
  }
  return latest?.turnId ?? null;
};

const createTextInput = (text: string): JsonRecord => ({
  type: "text",
  text,
  textElements: [],
});

const createMentionInput = (attachment: RuntimeTurnAttachment): JsonRecord => ({
  type: "mention",
  name: attachment.name,
  path: attachment.path,
  ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
});

const createAttachmentInput = (attachment: RuntimeTurnAttachment): JsonRecord => {
  if (attachment.kind === "local_image") {
    return {
      type: "localImage",
      path: attachment.path,
    };
  }
  if (attachment.kind === "image") {
    return {
      type: "image",
      url: attachment.path,
    };
  }
  return createMentionInput(attachment);
};

const normalizeRuntimeTurnParts = (input: RuntimeTurnInput): readonly RuntimeTurnInputPart[] => {
  if (input.parts !== undefined) {
    return input.parts
      .map((part): RuntimeTurnInputPart | null => {
        if (part.type === "text") {
          return part.text.length === 0 ? null : { type: "text", text: part.text };
        }
        const attachment = {
          name: part.attachment.name.trim(),
          path: part.attachment.path.trim(),
          kind: part.attachment.kind,
          ...(part.attachment.contextText === undefined ? {} : { contextText: part.attachment.contextText }),
        };
        return attachment.name.length === 0 || attachment.path.length === 0
          ? null
          : { type: "attachment", attachment };
      })
      .filter((part): part is RuntimeTurnInputPart => part !== null);
  }
  const text = input.text.trim();
  return [
    ...(text.length === 0 ? [] : [{ type: "text" as const, text }]),
    ...input.attachments.map((attachment) => ({
      type: "attachment" as const,
      attachment,
    })),
  ];
};

const createTurnInputParts = (input: RuntimeTurnInput): readonly JsonRecord[] => {
  return normalizeRuntimeTurnParts(input).map((part) =>
    part.type === "text"
      ? createTextInput(part.text)
      : createAttachmentInput(part.attachment)
  );
};

const formatOptimisticUserContent = (input: RuntimeTurnInput): string => {
  return normalizeRuntimeTurnParts(input)
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.attachment.kind === "local_image") {
        return `[local image] ${part.attachment.name}`;
      }
      if (part.attachment.kind === "image") {
        return `[image] ${part.attachment.name}`;
      }
      return `[mention] ${part.attachment.name}`;
    })
    .join("")
    .trim();
};

const optimisticAttachmentKind = (
  kind: RuntimeTurnAttachment["kind"]
): "file" | "directory" | "local_image" | "image" =>
  kind === "workbench_tab" || kind === "ai_thread" ? "file" : kind;

const optimisticContentPartsFromInput = (input: RuntimeTurnInput) =>
  normalizeRuntimeTurnParts(input).map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "attachment" as const,
          name: part.attachment.name,
          path: part.attachment.path,
          kind: optimisticAttachmentKind(part.attachment.kind),
        }
  );

const createCollaborationModePayload = (
  mode: LyraCollaborationMode,
  model: string,
  effort?: RuntimeThreadOptions["effort"]
): JsonRecord => ({
  mode,
  settings: {
    model,
    reasoning_effort: effort ?? null,
    developer_instructions: null,
  },
});

const collaborationModeRequestPart = (
  options: RuntimeThreadOptions
): JsonRecord => {
  if (options.collaborationMode === undefined) {
    return {};
  }
  const model = options.model?.trim() ?? "";
  if (model.length === 0) {
    throw new Error("A selected model is required before changing Agent mode.");
  }
  return {
    collaborationMode: createCollaborationModePayload(options.collaborationMode, model, options.effort),
  };
};

const sandboxPolicyFromMode = (
  sandboxMode: RuntimeThreadOptions["sandboxMode"]
): JsonRecord | null => {
  if (sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (sandboxMode === "workspace-write") {
    return { type: "workspaceWrite" };
  }
  if (sandboxMode === "read-only") {
    return { type: "readOnly" };
  }
  return null;
};

const threadPermissionRequestPart = (options: RuntimeThreadOptions): JsonRecord => ({
  ...(options.approvalPolicy === undefined ? {} : { approvalPolicy: options.approvalPolicy }),
  ...(options.approvalsReviewer === undefined ? {} : { approvalsReviewer: options.approvalsReviewer }),
  ...(options.sandboxMode === undefined ? {} : { sandbox: options.sandboxMode }),
});

const turnPermissionRequestPart = (options: RuntimeThreadOptions): JsonRecord => {
  const sandboxPolicy = sandboxPolicyFromMode(options.sandboxMode);
  return {
    ...(options.approvalPolicy === undefined ? {} : { approvalPolicy: options.approvalPolicy }),
    ...(options.approvalsReviewer === undefined ? {} : { approvalsReviewer: options.approvalsReviewer }),
    ...(sandboxPolicy === null ? {} : { sandboxPolicy }),
  };
};

const persistedUserTurnIds = (thread: LyraThread): ReadonlySet<string> => {
  const turnIds = new Set<string>();
  for (const message of thread.aiPanelViewModel?.messages ?? []) {
    if (message.role === "user" && typeof message.turnId === "string") {
      turnIds.add(message.turnId);
    }
  }
  for (const turn of thread.turns) {
    if (turn.items.some((item) => item.type === "userMessage")) {
      turnIds.add(turn.id);
    }
  }
  return turnIds;
};

const persistedUserAttachmentTurnIds = (thread: LyraThread): ReadonlySet<string> => {
  const turnIds = new Set<string>();
  for (const message of thread.aiPanelViewModel?.messages ?? []) {
    if (
      message.role === "user" &&
      typeof message.turnId === "string" &&
      message.contentParts?.some((part) => part.type === "attachment") === true
    ) {
      turnIds.add(message.turnId);
    }
  }
  for (const turn of thread.turns) {
    if (
      turn.items.some((item) =>
        item.type === "userMessage" &&
        Array.isArray(item.content) &&
        item.content.some((contentItem) =>
          isRecord(contentItem) &&
          (
            readString(contentItem.type) === "mention" ||
            readString(contentItem.type) === "localImage" ||
            readString(contentItem.type) === "image"
          )
        )
      )
    ) {
      turnIds.add(turn.id);
    }
  }
  return turnIds;
};

const optimisticMessageHasAttachment = (message: OptimisticUserMessage): boolean =>
  message.contentParts?.some((part) => part.type === "attachment") ?? false;

const dropPersistedOptimisticMessages = (
  optimisticMessages: readonly OptimisticUserMessage[],
  thread: LyraThread
): readonly OptimisticUserMessage[] => {
  const userTurnIds = persistedUserTurnIds(thread);
  if (userTurnIds.size === 0) {
    return optimisticMessages;
  }
  const userAttachmentTurnIds = persistedUserAttachmentTurnIds(thread);
  return optimisticMessages.filter((message) => {
    if (message.sessionId !== undefined && message.sessionId !== thread.id) {
      return true;
    }
    if (message.turnId === undefined || !userTurnIds.has(message.turnId)) {
      return true;
    }
    return optimisticMessageHasAttachment(message) && !userAttachmentTurnIds.has(message.turnId);
  });
};

const mergeThreadListSummary = (
  existing: LyraThread | undefined,
  summary: LyraThread
): LyraThread => {
  if (existing === undefined) {
    return summary;
  }
  return {
    ...existing,
    ...summary,
    aiPanelViewModel: summary.aiPanelViewModel ?? existing.aiPanelViewModel ?? null,
    turns:
      summary.turns.length === 0 && existing.turns.length > 0
        ? existing.turns
        : summary.turns,
  };
};

const responseValueToAnswerStrings = (value: unknown): readonly string[] => {
  if (isRecord(value)) {
    const optionLabel = readString(value.label);
    const freeValue = readString(value.value);
    return [freeValue ?? optionLabel].filter((entry): entry is string => entry !== null);
  }
  const direct = readString(value);
  return direct === null ? [] : [direct];
};

const commandDecisionToAgentCore = (decision: CommandApprovalResponse["decision"]): string => {
  if (decision === "allow_always") {
    return "acceptForSession";
  }
  if (decision === "deny") {
    return "decline";
  }
  return "accept";
};

export const useLyraThreadRuntime = ({
  desktopApi,
  interactionTextLabels,
  onFollowOpenFilePath,
  onWriteStreamEvent,
}: UseLyraThreadRuntimeOptions): {
  readonly state: LyraThreadRuntimeState;
  readonly actions: LyraThreadRuntimeActions;
} => {
  const lyraApi = desktopApi?.lyra ?? null;
  const [threadById, setThreadById] = useState<Readonly<Record<string, LyraThread>>>({});
  const [tabState, setTabState] = useState<LyraThreadTabState>(readInitialTabState);
  const restoredThreadIdsRef = useRef<Set<string>>(
    new Set(tabState.tabs.map((tab) => tab.threadId).filter((threadId): threadId is string => threadId !== null))
  );
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const {
    runtimeByKey,
    runtimeByKeyRef,
    patchRuntimeBucket,
    queueRuntimeBucketPatch,
    flushQueuedRuntimeBucketPatches,
    resetRuntimeBucket,
    forgetRuntimeBucket,
    bindRuntimeBucketToThread,
    stopAllRuntimeBuckets,
  } = useLyraThreadRuntimeBuckets();
  const [pendingInteractions, setPendingInteractions] = useState<readonly AgentPendingInteraction[]>([]);
  const [serverRequestIds, setServerRequestIds] = useState<Readonly<Record<string, string | number>>>({});
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [hasLoadedThreadList, setHasLoadedThreadList] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isInteractionSubmitting, setIsInteractionSubmitting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const activeTabIdRef = useRef<string | null>(tabState.activeTabId);
  const activeThreadIdRef = useRef<string | null>(activeThreadIdFromTabState(tabState));
  const activeRuntimeKeyRef = useRef<string | null>(activeRuntimeKeyFromTabState(tabState));
  const activeThreadRef = useRef<LyraThread | null>(null);
  const threadByIdRef = useRef<Readonly<Record<string, LyraThread>>>({});
  const streamingTurnIdRef = useRef<string | null>(null);
  const loadThreadRef = useRef<((threadId: string) => Promise<void>) | null>(null);
  const threadReadRequestedForIdRef = useRef<Set<string>>(new Set());
  const capabilityWriteMetadataByCallRef = useRef<Record<string, WriteStreamCallMetadata>>({});
  const openedDiffTargetsRef = useRef<Set<string>>(new Set());

  const rawThreadTabs = tabState.tabs;
  const activeTab = rawThreadTabs.find((tab) => tab.tabId === tabState.activeTabId) ?? rawThreadTabs[0] ?? null;
  const activeThreadId = activeTab?.threadId ?? null;
  const activeThread = activeThreadId === null ? null : (threadById[activeThreadId] ?? null);
  const activeRuntimeKey = activeTab === null ? null : tabRuntimeKey(activeTab);
  const activeBucket = activeRuntimeKey === null
    ? EMPTY_RUNTIME_BUCKET
    : (runtimeByKey[activeRuntimeKey] ?? EMPTY_RUNTIME_BUCKET);
  const threads = useMemo(
    () => Object.values(threadById).sort((left, right) => right.updatedAt - left.updatedAt),
    [threadById]
  );
  const threadTabs = useMemo(
    () => rawThreadTabs.map((tab) => {
      const runtimeKey = tabRuntimeKey(tab);
      const bucket = runtimeByKey[runtimeKey] ?? EMPTY_RUNTIME_BUCKET;
      const thread = tab.threadId === null ? null : (threadById[tab.threadId] ?? null);
      const title = thread === null ? tab.title : buildRuntimeThreadTitle(thread, tab.title);
      return {
        ...tab,
        title,
        status: bucket.isStreamActive || bucket.isSending ? "running" : tab.status,
        updatedAt: Math.max(tab.updatedAt, thread?.updatedAt ?? 0),
      } satisfies LyraThreadTab;
    }),
    [rawThreadTabs, runtimeByKey, threadById]
  );

  const activeDetail = useMemo(
    () => activeThread === null ? null : lyraThreadToAgentDetail(activeThread),
    [activeThread]
  );
  const latestPlanTurnId = useMemo(
    () => latestPlanTurnIdOf(activeBucket.planByTurn),
    [activeBucket.planByTurn]
  );

  useEffect(() => {
    activeTabIdRef.current = tabState.activeTabId;
  }, [tabState.activeTabId]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    activeRuntimeKeyRef.current = activeRuntimeKey;
  }, [activeRuntimeKey]);

  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  useEffect(() => {
    threadByIdRef.current = threadById;
  }, [threadById]);

  useEffect(() => {
    streamingTurnIdRef.current = activeBucket.streamingTurnId;
  }, [activeBucket.streamingTurnId]);

  useEffect(() => {
    writeTabSnapshot(tabState);
  }, [tabState]);

  const patchTabState = useCallback((updater: (current: LyraThreadTabState) => LyraThreadTabState): void => {
    setTabState((current) => {
      const next = normalizeTabState(updater(current));
      activeTabIdRef.current = next.activeTabId;
      activeThreadIdRef.current = activeThreadIdFromTabState(next);
      activeRuntimeKeyRef.current = activeRuntimeKeyFromTabState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    flushQueuedRuntimeBucketPatches();
  }, [activeThreadId, flushQueuedRuntimeBucketPatches]);

  const setFollowEnabled = useCallback((enabled: boolean): void => {
    const key = activeRuntimeKeyRef.current;
    if (key === null) {
      return;
    }
    patchRuntimeBucket(key, (current) => ({
      ...current,
      followEnabled: enabled,
    }));
  }, [patchRuntimeBucket]);

  const emitWriteToolCallInWorkspace = useCallback((call: AgentToolCall): void => {
    if (onWriteStreamEvent === undefined || !isWriteToolName(call.toolName)) {
      return;
    }
    const target = toolCallFollowTarget(call);
    if (target === null) {
      return;
    }
    const input = isRecord(call.input) ? call.input : {};
    const output = isRecord(call.output) ? call.output : {};
    const baselineContent = readOptionalRawString(output.baselineContent, input.baselineContent);
    const created = readOptionalBoolean(
      output.created,
      input.created,
      readCreatedFromChanges(output),
      readCreatedFromChanges(input)
    );
    const firstChangedLine = readOptionalLine(
      output.firstChangedLine,
      output.first_changed_line,
      input.firstChangedLine,
      input.first_changed_line,
      readFirstChangeLineFromChanges(output),
      readFirstChangeLineFromChanges(input),
      target.line
    );
    const addedLines = readOptionalCount(output.addedLines, output.added_lines, input.addedLines, input.added_lines);
    const removedLines = readOptionalCount(
      output.removedLines,
      output.removed_lines,
      input.removedLines,
      input.removed_lines
    );

    if (call.status === "running") {
      onWriteStreamEvent({
        kind: "started",
        sessionId: call.sessionId,
        turnId: call.turnId,
        toolCallId: call.id,
        toolName: call.toolName,
        filePath: target.path,
        timestamp: call.startedAt,
        ...(created === undefined ? {} : { created }),
        ...(baselineContent === undefined ? {} : { baselineContent }),
      });
      return;
    }

    onWriteStreamEvent({
      kind: "finished",
      sessionId: call.sessionId,
      turnId: call.turnId,
      toolCallId: call.id,
      toolName: call.toolName,
      filePath: target.path,
      timestamp: call.finishedAt ?? Date.now(),
      status: call.status === "failed" ? "failed" : "completed",
      ...(created === undefined ? {} : { created }),
      ...(baselineContent === undefined ? {} : { baselineContent }),
      ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
      ...(addedLines === undefined ? {} : { addedLines }),
      ...(removedLines === undefined ? {} : { removedLines }),
      ...(call.errorCode === undefined ? {} : { errorCode: call.errorCode }),
      ...(call.errorMessage === undefined ? {} : { errorMessage: call.errorMessage }),
    });
  }, [onWriteStreamEvent]);

  const emitCapabilityWriteEvent = useCallback((event: CapabilityRuntimeEvent): void => {
    if (onWriteStreamEvent === undefined || !isWriteToolName(event.capabilityId)) {
      return;
    }
    const payload = isRecord(event.payload) ? event.payload : {};
    const preview = readFileCapabilityPreview(payload);
    const previous = capabilityWriteMetadataByCallRef.current[event.callId];
    const context = isRecord(payload.context) ? payload.context : {};
    const sessionId =
      readString(context.aiSessionId)
      ?? previous?.sessionId
      ?? activeThreadIdRef.current
      ?? "capability";
    const turnId =
      readString(context.aiTurnId)
      ?? previous?.turnId
      ?? streamingTurnIdRef.current
      ?? `${event.callId}:turn`;
    const filePath =
      preview?.filePath
      ?? readPathLike(payload)
      ?? previous?.filePath
      ?? null;
    if (filePath === null) {
      return;
    }

    const timestamp = readTimestamp(event.timestamp);
    const baselineContent = readOptionalRawString(payload.baselineContent, preview?.baselineContent, previous?.baselineContent);
    const created = readOptionalBoolean(payload.created, preview?.created, previous?.created);
    const firstChangedLine = readOptionalLine(payload.firstChangedLine, preview?.firstChangedLine, previous?.firstChangedLine);
    const addedLines = readOptionalCount(payload.addedLines, preview?.addedLines, previous?.addedLines);
    const removedLines = readOptionalCount(payload.removedLines, preview?.removedLines, previous?.removedLines);
    const metadata: WriteStreamCallMetadata = {
      sessionId,
      turnId,
      toolCallId: event.callId,
      toolName: event.capabilityId,
      filePath,
      timestamp,
      ...(created === undefined ? {} : { created }),
      ...(baselineContent === undefined ? {} : { baselineContent }),
      ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
      ...(addedLines === undefined ? {} : { addedLines }),
      ...(removedLines === undefined ? {} : { removedLines }),
    };

    if (event.phase === "approval_requested") {
      capabilityWriteMetadataByCallRef.current[event.callId] = metadata;
      onWriteStreamEvent({
        kind: "started",
        sessionId,
        turnId,
        toolCallId: event.callId,
        toolName: event.capabilityId,
        filePath,
        timestamp,
        ...(created === undefined ? {} : { created }),
        ...(baselineContent === undefined ? {} : { baselineContent }),
      });
      return;
    }

    if (event.phase !== "completed" && event.phase !== "failed") {
      return;
    }

    onWriteStreamEvent({
      kind: "finished",
      sessionId,
      turnId,
      toolCallId: event.callId,
      toolName: event.capabilityId,
      filePath,
      timestamp,
      status: event.phase === "failed" ? "failed" : "completed",
      ...(created === undefined ? {} : { created }),
      ...(baselineContent === undefined ? {} : { baselineContent }),
      ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
      ...(addedLines === undefined ? {} : { addedLines }),
      ...(removedLines === undefined ? {} : { removedLines }),
      ...(event.error?.code === undefined ? {} : { errorCode: event.error.code }),
      ...(event.error?.message === undefined ? {} : { errorMessage: event.error.message }),
    });
    delete capabilityWriteMetadataByCallRef.current[event.callId];
  }, [onWriteStreamEvent]);

  const openDiffTargetInWorkspace = useCallback((
    threadId: string,
    turnId: string,
    diff: unknown
  ): void => {
    if (onFollowOpenFilePath === undefined) {
      return;
    }
    const cwd = threadByIdRef.current[threadId]?.cwd ?? activeThreadRef.current?.cwd ?? null;
    const path = readFirstPathFromUnifiedDiff(diff, cwd);
    if (path === null) {
      return;
    }
    const key = `${threadId}:${turnId}:${path}`;
    if (openedDiffTargetsRef.current.has(key)) {
      return;
    }
    openedDiffTargetsRef.current.add(key);
    const firstChangedLine = readFirstChangeLineFromDiff(diff);
    onFollowOpenFilePath(path, {
      allowMissing: true,
      forceReloadIfOpen: false,
      ...(firstChangedLine === null ? {} : { location: { line: firstChangedLine } }),
    });
  }, [onFollowOpenFilePath]);

  const followToolCallInWorkspace = useCallback((
    threadId: string,
    call: AgentToolCall
  ): void => {
    if (
      onFollowOpenFilePath === undefined
      || runtimeByKeyRef.current[threadId]?.followEnabled !== true
    ) {
      return;
    }
    const target = toolCallFollowTarget(call);
    if (target === null) {
      return;
    }
    onFollowOpenFilePath(target.path, {
      allowMissing: call.status === "running",
      forceReloadIfOpen: call.status !== "running",
      ...(target.line === undefined ? {} : { location: { line: target.line } }),
    });
  }, [onFollowOpenFilePath]);

  const appendTerminalTranscriptChunk = useCallback((
    threadId: string,
    turnId: string,
    itemId: string,
    chunk: {
      readonly stream: "stdin" | "stdout" | "stderr";
      readonly text: string;
      readonly timestamp: number;
      readonly processId?: string;
    }
  ): void => {
    if (chunk.text.length === 0) {
      return;
    }
    queueRuntimeBucketPatch(threadId, (current) => {
      const existing = current.liveToolCalls.find((entry) => entry.id === itemId);
      const baseCall: AgentToolCall = existing ?? {
        id: itemId,
        sessionId: threadId,
        turnId,
        toolName: "terminal.exec",
        input: {},
        status: "running",
        startedAt: chunk.timestamp,
      };
      const output = isRecord(baseCall.output) ? baseCall.output : {};
      const terminalChunks = [
        ...readTerminalTranscriptChunks(output.terminalChunks),
        {
          stream: chunk.stream,
          text: chunk.text,
          timestamp: chunk.timestamp,
        },
      ];
      const liveOutput = `${typeof output.liveOutput === "string" ? output.liveOutput : ""}${chunk.text}`;
      const nextCall: AgentToolCall = {
        ...baseCall,
        status: baseCall.status === "completed" || baseCall.status === "failed"
          ? baseCall.status
          : "running",
        output: {
          ...output,
          terminalChunks,
          liveOutput,
          ...(chunk.processId === undefined ? {} : { processId: chunk.processId }),
        },
      };
      return {
        ...current,
        liveToolCalls: [
          ...current.liveToolCalls.filter((entry) => entry.id !== itemId),
          nextCall,
        ].slice(-48),
      };
    });
  }, [queueRuntimeBucketPatch]);

  const upsertThread = useCallback((thread: LyraThread): void => {
    setThreadById((current) => ({ ...current, [thread.id]: thread }));
    patchTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.threadId === thread.id
          ? {
              ...tab,
              title: buildRuntimeThreadTitle(thread, tab.title),
              updatedAt: Math.max(tab.updatedAt, thread.updatedAt),
              status: tab.status === "draft" ? "idle" : tab.status,
            }
          : tab
      ),
    }));
  }, [patchTabState]);

  const createDraftTab = useCallback((): string => {
    const tab = createDraftThreadTab();
    patchTabState((current) => ({
      activeTabId: tab.tabId,
      tabs: insertThreadTabAfterActive(current, tab),
    }));
    return tab.tabId;
  }, [patchTabState]);

  const bindTabToThread = useCallback((tabId: string, thread: LyraThread): void => {
    const title = buildRuntimeThreadTitle(thread, "New thread");
    patchTabState((current) => ({
      activeTabId: tabId,
      tabs: current.tabs.map((tab) =>
        tab.tabId === tabId
          ? {
              ...tab,
              threadId: thread.id,
              title,
              status: "idle",
              updatedAt: Math.max(tab.updatedAt, thread.updatedAt),
            }
          : tab
      ),
    }));
    bindRuntimeBucketToThread(tabId, thread.id);
  }, [bindRuntimeBucketToThread, patchTabState]);

  const openThreadTab = useCallback((threadId: string): void => {
    const normalized = threadId.trim();
    if (normalized.length === 0) {
      return;
    }
    patchTabState((current) => {
      const existing = current.tabs.find((tab) => tab.threadId === normalized);
      if (existing !== undefined) {
        return { ...current, activeTabId: existing.tabId };
      }
      const thread = threadByIdRef.current[normalized] ?? null;
      const tab = createThreadTabFromThreadId(
        normalized,
        thread === null ? "Thread" : buildRuntimeThreadTitle(thread, "Thread")
      );
      return {
        activeTabId: tab.tabId,
        tabs: insertThreadTabAfterActive(current, tab),
      };
    });
    void Promise.resolve().then(() => loadThreadRef.current?.(normalized));
  }, [patchTabState]);

  const activateThreadTab = useCallback((tabId: string): void => {
    patchTabState((current) => ({ ...current, activeTabId: tabId }));
  }, [patchTabState]);

  const closeThreadTab = useCallback((tabId: string): void => {
    patchTabState((current) => closeTabState(current, tabId));
  }, [patchTabState]);

  const reorderThreadTab = useCallback((tabId: string, targetIndex: number): void => {
    patchTabState((current) => reorderTabState(current, tabId, targetIndex));
  }, [patchTabState]);

  const forgetThread = useCallback((threadId: string): void => {
    restoredThreadIdsRef.current.delete(threadId);
    threadReadRequestedForIdRef.current.delete(threadId);
    setThreadById((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    forgetRuntimeBucket(threadId);
    patchTabState((current) => ({
      ...current,
      tabs: current.tabs.filter((tab) => tab.threadId !== threadId),
    }));
    setRuntimeError(null);
  }, [forgetRuntimeBucket, patchTabState]);

  const loadThreads = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      setThreadById({});
      setHasLoadedThreadList(false);
      return;
    }
    setIsLoadingThreads(true);
    try {
      const response = await lyraApi.request<{ data?: readonly unknown[] }>(createRequestPayload("thread/list", {
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        modelProviders: [],
      }));
      const nextThreads = Array.isArray(response.data)
        ? response.data.map(readLyraThread).filter((thread): thread is LyraThread => thread !== null)
        : [];
      setThreadById((current) => {
        const next = { ...current };
        for (const thread of nextThreads) {
          next[thread.id] = mergeThreadListSummary(next[thread.id], thread);
        }
        return next;
      });
      setHasLoadedThreadList(true);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingThreads(false);
    }
  }, [lyraApi]);

  const loadThread = useCallback(async (threadId: string): Promise<void> => {
    if (lyraApi === null || threadId.trim().length === 0) {
      return;
    }
    setIsLoadingThread(true);
    try {
      const response = await lyraApi.request<{ thread?: unknown; viewModel?: unknown }>(createRequestPayload("thread/read", {
        threadId,
        includeTurns: false,
        viewModel: {
          kind: "aiPanel",
          runtimeFeedLimit: 48,
        },
      }));
      const rawThread = readLyraThread(response.thread);
      const viewModel = readThreadAiPanelViewModel(response.viewModel);
      const nextThread = rawThread === null ? null : attachThreadAiPanelViewModel(rawThread, viewModel);
      if (nextThread !== null) {
        restoredThreadIdsRef.current.delete(nextThread.id);
        threadReadRequestedForIdRef.current.add(nextThread.id);
        upsertThread(nextThread);
        const hydratedDetail = lyraThreadToAgentDetail(nextThread);
        const hydratedPlanInteractions = hydratedDetail.pendingInteractions.filter(
          (interaction) => interaction.kind === "plan_approval"
        );
        setPendingInteractions((current) => {
          const withoutHydratedPlanApprovals = current.filter(
            (interaction) =>
              interaction.sessionId !== nextThread.id || interaction.kind !== "plan_approval"
          );
          return mergePendingInteractionLists(
            withoutHydratedPlanApprovals,
            hydratedPlanInteractions
          );
        });
        if (hydratedPlanInteractions.length > 0) {
          setActiveInteractionId((current) => current ?? hydratedPlanInteractions[0]!.id);
        }
        patchRuntimeBucket(nextThread.id, (current) => ({
          ...current,
          optimisticUserMessages: dropPersistedOptimisticMessages(current.optimisticUserMessages, nextThread),
          planByTurn: mergePlanStates(current.planByTurn, extractPlanStatesFromThread(nextThread)),
        }));
      }
      setRuntimeError(null);
    } catch (error) {
      if (isThreadUnavailableError(error, threadId)) {
        restoredThreadIdsRef.current.delete(threadId);
        forgetThread(threadId);
        void loadThreads();
        return;
      }
      threadReadRequestedForIdRef.current.delete(threadId);
      setRuntimeError(errorMessageOf(error));
    } finally {
      setIsLoadingThread(false);
    }
  }, [forgetThread, loadThreads, lyraApi, patchRuntimeBucket, upsertThread]);

  const resumeThread = useCallback(async (
    threadId: string,
    options: RuntimeThreadOptions = {}
  ): Promise<LyraThread> => {
    if (lyraApi === null) {
      throw new Error("Lyra runtime unavailable");
    }
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId.length === 0) {
      throw new Error("threadId is required");
    }
    const response = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/resume", {
      threadId: normalizedThreadId,
      ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
      ...(options.modelProvider === null || options.modelProvider === undefined || options.modelProvider.trim().length === 0
        ? {}
        : { modelProvider: options.modelProvider.trim() }),
      ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
        ? {}
        : { cwd: options.cwd.trim() }),
      ...threadPermissionRequestPart(options),
      persistExtendedHistory: true,
    }));
    const thread = readLyraThread(response.thread);
    if (thread === null) {
      throw new Error("thread/resume did not return a thread");
    }
    upsertThread(thread);
    patchRuntimeBucket(thread.id, (current) => ({
      ...current,
      optimisticUserMessages: dropPersistedOptimisticMessages(current.optimisticUserMessages, thread),
      planByTurn: mergePlanStates(current.planByTurn, extractPlanStatesFromThread(thread)),
    }));
    setRuntimeError(null);
    return thread;
  }, [lyraApi, patchRuntimeBucket, upsertThread]);

  useEffect(() => {
    loadThreadRef.current = loadThread;
  }, [loadThread]);

  const selectThread = useCallback((threadId: string | null): void => {
    if (threadId === null) {
      createDraftTab();
      return;
    }
    openThreadTab(threadId);
  }, [createDraftTab, openThreadTab]);

  const startThread = useCallback(async (
    options: RuntimeThreadOptions = {},
    resetRuntime = true,
    targetTabId?: string | null
  ): Promise<string> => {
    if (lyraApi === null) {
      throw new Error("Lyra runtime unavailable");
    }
    const tabId = targetTabId ?? activeTabIdRef.current ?? createDraftTab();
    const response = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/start", {
      ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
      ...(options.modelProvider === null || options.modelProvider === undefined || options.modelProvider.trim().length === 0
        ? {}
        : { modelProvider: options.modelProvider.trim() }),
      ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
        ? {}
        : { cwd: options.cwd.trim() }),
      ...threadPermissionRequestPart(options),
      persistExtendedHistory: true,
    }));
    const thread = readLyraThread(response.thread);
    if (thread === null) {
      throw new Error("thread/start did not return a thread");
    }
    upsertThread(thread);
    bindTabToThread(tabId, thread);
    if (resetRuntime) {
      resetRuntimeBucket(thread.id);
    }
    setRuntimeError(null);
    return thread.id;
  }, [bindTabToThread, createDraftTab, lyraApi, resetRuntimeBucket, upsertThread]);

  const createThread = useCallback(async (): Promise<string> => createDraftTab(), [createDraftTab]);

  const sendTurn = useCallback(async (
    input: RuntimeTurnInput,
    options: RuntimeThreadOptions = {}
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const normalizedInput: RuntimeTurnInput = {
      text: input.text.trim(),
      attachments: input.attachments
        .map((attachment) => ({
          name: attachment.name.trim(),
          path: attachment.path.trim(),
          kind: attachment.kind,
          ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
        }))
        .filter((attachment) => attachment.name.length > 0 && attachment.path.length > 0),
      ...(input.parts === undefined ? {} : { parts: input.parts }),
    };
    const inputParts = createTurnInputParts(normalizedInput);
    if (inputParts.length === 0) {
      return;
    }
    const optimisticContent = formatOptimisticUserContent(normalizedInput);
    const optimisticContentParts = optimisticContentPartsFromInput(normalizedInput);
    const tabId = activeTabIdRef.current ?? createDraftTab();
    const initialThreadId = activeThreadIdRef.current;
    const initialRuntimeKey = initialThreadId ?? tabId;
    const createdAt = Date.now();
    const optimisticId = `optimistic:${createdAt.toString()}`;
    const addOptimisticMessage = (
      runtimeKey: string,
      messageId: string,
      messageCreatedAt: number,
      sessionId: string | null
    ): void => {
      patchRuntimeBucket(runtimeKey, (current) => ({
        ...current,
        isSending: true,
        isStreamActive: current.isStreamActive,
        streamingAssistantText: "",
        finalizingTurnId: null,
        optimisticUserMessages: [
          ...current.optimisticUserMessages,
          {
            id: messageId,
            role: "user",
            content: optimisticContent,
            contentParts: optimisticContentParts,
            createdAt: messageCreatedAt,
            optimistic: true,
            ...(sessionId === null ? {} : { sessionId }),
          },
        ],
      }));
    };
    const removeOptimisticMessage = (runtimeKey: string, messageId: string): void => {
      patchRuntimeBucket(runtimeKey, (current) => ({
        ...current,
        isSending: false,
        isStreamActive: false,
        optimisticUserMessages: current.optimisticUserMessages.filter((message) => message.id !== messageId),
      }));
    };
    const markOptimisticThread = (threadId: string, messageId: string): void => {
      patchRuntimeBucket(threadId, (current) => ({
        ...current,
        optimisticUserMessages: current.optimisticUserMessages.map((message) =>
          message.id === messageId
            ? { ...message, sessionId: threadId }
            : message
        ),
      }));
    };
    const submitTurn = async (threadId: string, messageId: string): Promise<void> => {
      const response = await lyraApi.request<{ turn?: unknown }>(createRequestPayload("turn/start", {
        threadId,
        input: inputParts,
        ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
        ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
          ? {}
          : { cwd: options.cwd.trim() }),
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        ...(options.verbosity === undefined ? {} : { verbosity: options.verbosity }),
        ...turnPermissionRequestPart(options),
        ...collaborationModeRequestPart(options),
      }));
      const turnId = isRecord(response.turn) ? readString(response.turn.id) : null;
      if (turnId === null) {
        return;
      }
      const event = toRuntimeEvent({
        sessionId: threadId,
        turnId,
        phase: "accepted",
        payload: { threadId, turnId },
      });
      patchRuntimeBucket(threadId, (current) => ({
        ...current,
        isSending: false,
        isStreamActive: true,
        streamingAssistantText: "",
        streamingTurnId: turnId,
        finalizingTurnId: null,
        optimisticUserMessages: current.optimisticUserMessages.map((message) =>
          message.id === messageId
            ? { ...message, sessionId: threadId, turnId }
            : message
        ),
        latestRuntimeEventByTurn: {
          ...current.latestRuntimeEventByTurn,
          [turnId]: event,
        },
      }));
    };
    addOptimisticMessage(initialRuntimeKey, optimisticId, createdAt, initialThreadId);
    setRuntimeError(null);
    try {
      const threadId = initialThreadId ?? await startThread(options, false, tabId);
      markOptimisticThread(threadId, optimisticId);
      await submitTurn(threadId, optimisticId);
    } catch (error) {
      if (initialThreadId !== null && isThreadUnavailableError(error, initialThreadId)) {
        try {
          await resumeThread(initialThreadId, options);
          markOptimisticThread(initialThreadId, optimisticId);
          await submitTurn(initialThreadId, optimisticId);
          setRuntimeError(null);
          return;
        } catch (resumeError) {
          removeOptimisticMessage(initialRuntimeKey, optimisticId);
          if (isThreadUnavailableError(resumeError, initialThreadId)) {
            forgetThread(initialThreadId);
          }
          setRuntimeError(errorMessageOf(resumeError));
          throw resumeError;
        }
      }
      removeOptimisticMessage(initialRuntimeKey, optimisticId);
      if (initialThreadId !== null && isThreadUnavailableError(error, initialThreadId)) {
        forgetThread(initialThreadId);
      }
      setRuntimeError(errorMessageOf(error));
      throw error;
    }
  }, [createDraftTab, forgetThread, lyraApi, patchRuntimeBucket, resumeThread, startThread]);

  const steerTurn = useCallback(async (input: RuntimeTurnInput): Promise<void> => {
    if (lyraApi === null || activeThreadIdRef.current === null || streamingTurnIdRef.current === null) {
      return;
    }
    const normalizedInput: RuntimeTurnInput = {
      text: input.text.trim(),
      attachments: input.attachments
        .map((attachment) => ({
          name: attachment.name.trim(),
          path: attachment.path.trim(),
          kind: attachment.kind,
          ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
        }))
        .filter((attachment) => attachment.name.length > 0 && attachment.path.length > 0),
      ...(input.parts === undefined ? {} : { parts: input.parts }),
    };
    const inputParts = createTurnInputParts(normalizedInput);
    if (inputParts.length === 0) {
      return;
    }
    const threadId = activeThreadIdRef.current;
    const turnId = streamingTurnIdRef.current;
    try {
      await lyraApi.request(createRequestPayload("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: inputParts,
      }));
      patchRuntimeBucket(threadId, (current) => ({
        ...current,
        latestRuntimeEventByTurn: {
          ...current.latestRuntimeEventByTurn,
          [turnId]: toRuntimeEvent({
            sessionId: threadId,
            turnId,
            phase: "steer_submitted",
            payload: { text: normalizedInput.text },
          }),
        },
      }));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [lyraApi, patchRuntimeBucket]);

  const interruptTurn = useCallback(async (): Promise<void> => {
    if (lyraApi === null || activeThreadIdRef.current === null || streamingTurnIdRef.current === null) {
      return;
    }
    const threadId = activeThreadIdRef.current;
    try {
      await lyraApi.request(createRequestPayload("turn/interrupt", {
        threadId,
        turnId: streamingTurnIdRef.current,
      }));
      patchRuntimeBucket(threadId, (current) => ({
        ...current,
        isStreamActive: false,
        isSending: false,
      }));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [lyraApi, patchRuntimeBucket]);

  const cleanBackgroundTerminals = useCallback(async (): Promise<void> => {
    if (lyraApi === null || activeThreadIdRef.current === null) {
      return;
    }
    try {
      await lyraApi.request(createRequestPayload("thread/backgroundTerminals/clean", {
        threadId: activeThreadIdRef.current,
      }));
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [lyraApi]);

  const activateForkedThread = useCallback((thread: LyraThread): void => {
    upsertThread(thread);
    const tab = createThreadTabFromThreadId(thread.id, buildRuntimeThreadTitle(thread, "Thread"));
    patchTabState((current) => ({
      activeTabId: tab.tabId,
      tabs: current.tabs.some((entry) => entry.threadId === thread.id)
        ? current.tabs.map((entry) => entry.threadId === thread.id ? { ...entry, title: tab.title, updatedAt: tab.updatedAt } : entry)
        : insertThreadTabAfterActive(current, tab),
    }));
    resetRuntimeBucket(thread.id);
    patchRuntimeBucket(thread.id, (current) => ({
      ...current,
      planByTurn: extractPlanStatesFromThread(thread),
    }));
  }, [patchRuntimeBucket, patchTabState, resetRuntimeBucket, upsertThread]);

  const forkThread = useCallback(async (options: RuntimeThreadOptions = {}): Promise<string> => {
    if (lyraApi === null || activeThreadIdRef.current === null) {
      throw new Error("No active thread to fork.");
    }
    const response = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/fork", {
      threadId: activeThreadIdRef.current,
      ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
      ...(options.modelProvider === null || options.modelProvider === undefined || options.modelProvider.trim().length === 0
        ? {}
        : { modelProvider: options.modelProvider.trim() }),
      ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
        ? {}
        : { cwd: options.cwd.trim() }),
      ...threadPermissionRequestPart(options),
      persistExtendedHistory: true,
    }));
    const thread = readLyraThread(response.thread);
    if (thread === null) {
      throw new Error("thread/fork did not return a thread");
    }
    activateForkedThread(thread);
    setRuntimeError(null);
    return thread.id;
  }, [activateForkedThread, lyraApi]);

  const forkThreadFromTurn = useCallback(async (
    turnId: string,
    numTurnsAfter: number,
    options: RuntimeThreadOptions = {}
  ): Promise<string> => {
    if (lyraApi === null || activeThreadIdRef.current === null) {
      throw new Error("No active thread to fork.");
    }
    const forkResponse = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/fork", {
      threadId: activeThreadIdRef.current,
      ...(options.model !== undefined && options.model.trim().length > 0 ? { model: options.model.trim() } : {}),
      ...(options.modelProvider === null || options.modelProvider === undefined || options.modelProvider.trim().length === 0
        ? {}
        : { modelProvider: options.modelProvider.trim() }),
      ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
        ? {}
        : { cwd: options.cwd.trim() }),
      ...threadPermissionRequestPart(options),
      persistExtendedHistory: true,
    }));
    let thread = readLyraThread(forkResponse.thread);
    if (thread === null) {
      throw new Error("thread/fork did not return a thread");
    }
    const safeRollbackTurns = Math.max(0, Math.floor(numTurnsAfter));
    if (safeRollbackTurns > 0) {
      const turnIndex = thread.turns.findIndex((turn) => turn.id === turnId);
      const rollbackTargetTurnId = turnIndex < 0
        ? null
        : thread.turns[turnIndex + 1]?.id ?? null;
      if (rollbackTargetTurnId === null) {
        throw new Error("Could not find a fork rollback target turn.");
      }
      const rollbackResponse = await lyraApi.request<{ thread?: unknown }>(createRequestPayload("thread/rollback", {
        threadId: thread.id,
        turnId: rollbackTargetTurnId,
        restoreFiles: false,
      }));
      thread = readLyraThread(rollbackResponse.thread) ?? thread;
    }
    activateForkedThread(thread);
    patchRuntimeBucket(thread.id, (current) => ({
      ...current,
      latestRuntimeEventByTurn: {
        ...current.latestRuntimeEventByTurn,
        [turnId]: toRuntimeEvent({
          sessionId: thread.id,
          turnId,
          phase: "forked_from_turn",
          payload: { numTurnsAfter: safeRollbackTurns },
        }),
      },
    }));
    setRuntimeError(null);
    return thread.id;
  }, [activateForkedThread, lyraApi, patchRuntimeBucket]);

  const rollbackThread = useCallback(async (
    turnId: string
  ): Promise<string | null> => {
    if (lyraApi === null || activeThreadIdRef.current === null) {
      return null;
    }
    const threadId = activeThreadIdRef.current;
    try {
      const response = await lyraApi.request<{ thread?: unknown; restoredInput?: unknown }>(createRequestPayload("thread/rollback", {
        threadId,
        turnId,
        restoreFiles: true,
      }));
      const thread = readLyraThread(response.thread);
      if (thread !== null) {
        upsertThread(thread);
        resetRuntimeBucket(thread.id);
        patchRuntimeBucket(thread.id, (current) => ({
          ...current,
          planByTurn: extractPlanStatesFromThread(thread),
        }));
      }
      patchRuntimeBucket(threadId, (current) => ({
        ...current,
        latestRuntimeEventByTurn: {
          ...current.latestRuntimeEventByTurn,
          [turnId]: toRuntimeEvent({
            sessionId: threadId,
            turnId,
            phase: "rolled_back",
            payload: { turnId },
          }),
        },
      }));
      void loadThreads();
      return typeof response.restoredInput === "string" ? response.restoredInput : null;
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [loadThreads, lyraApi, patchRuntimeBucket, resetRuntimeBucket, upsertThread]);

  const startReview = useCallback(async (
    target: ReviewTarget,
    options: RuntimeReviewOptions = {}
  ): Promise<void> => {
    if (lyraApi === null || activeThreadIdRef.current === null) {
      return;
    }
    const threadId = activeThreadIdRef.current;
    try {
      const response = await lyraApi.request<{ turn?: unknown; reviewThreadId?: unknown }>(createRequestPayload("review/start", {
        threadId,
        target,
        ...(options.cwd === null || options.cwd === undefined || options.cwd.trim().length === 0
          ? {}
          : { cwd: options.cwd.trim() }),
        delivery: "inline",
      }));
      const turnId = isRecord(response.turn) ? readString(response.turn.id) : null;
      if (turnId !== null) {
        patchRuntimeBucket(threadId, (current) => ({
          ...current,
          streamingTurnId: turnId,
          isStreamActive: true,
          isSending: false,
          latestRuntimeEventByTurn: {
            ...current.latestRuntimeEventByTurn,
            [turnId]: toRuntimeEvent({
              sessionId: threadId,
              turnId,
              phase: "review_started",
              payload: response,
            }),
          },
        }));
      }
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [lyraApi, patchRuntimeBucket]);

  const resolveInteraction = useCallback(async (
    interactionId: string,
    result: unknown
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const requestId = serverRequestIds[interactionId] ?? interactionId;
    setIsInteractionSubmitting(true);
    try {
      await lyraApi.resolveServerRequest({ requestId, result });
      setPendingInteractions((current) => current.filter((interaction) => interaction.id !== interactionId));
      setServerRequestIds((current) => {
        const next = { ...current };
        delete next[interactionId];
        return next;
      });
      setActiveInteractionId((current) => current === interactionId ? null : current);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInteractionSubmitting(false);
    }
  }, [lyraApi, serverRequestIds]);

  const rejectInteraction = useCallback(async (
    interactionId: string,
    message = "Rejected by Lyra desktop"
  ): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const requestId = serverRequestIds[interactionId] ?? interactionId;
    setIsInteractionSubmitting(true);
    try {
      await lyraApi.rejectServerRequest({
        requestId,
        error: {
          code: -32000,
          message,
        },
      });
      setPendingInteractions((current) => current.filter((interaction) => interaction.id !== interactionId));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInteractionSubmitting(false);
    }
  }, [lyraApi, serverRequestIds]);

  const respondToCommandApproval = useCallback(async (
    response: CommandApprovalResponse
  ): Promise<void> => {
    const interaction = pendingInteractions.find((entry) => entry.id === response.requestId) ?? null;
    if (interaction === null) {
      return;
    }
    if (response.decision === "deny" && interaction.kind === "mcp_elicitation") {
      await rejectInteraction(interaction.id);
      return;
    }
    if (interaction.kind === "file_change_approval") {
      await resolveInteraction(interaction.id, { decision: commandDecisionToAgentCore(response.decision) });
      return;
    }
    if (interaction.kind === "permissions_approval") {
      const raw = isRecord(interaction.payload.raw) ? interaction.payload.raw : {};
      if (response.decision === "deny") {
        await rejectInteraction(interaction.id);
        return;
      }
      await resolveInteraction(interaction.id, {
        permissions: raw.permissions ?? {},
        scope: response.decision === "allow_always" ? "session" : "turn",
      });
      return;
    }
    await resolveInteraction(interaction.id, { decision: commandDecisionToAgentCore(response.decision) });
  }, [pendingInteractions, rejectInteraction, resolveInteraction]);

  const respondToPlanQuestion = useCallback(async (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string }
  ): Promise<void> => {
    const activeId = activeInteractionId ?? pendingInteractions[0]?.id ?? null;
    if (activeId === null) {
      return;
    }
    const interaction = pendingInteractions.find((entry) => entry.id === activeId) ?? null;
    if (interaction === null) {
      return;
    }
    if (interaction.kind === "mcp_elicitation") {
      await resolveInteraction(interaction.id, {
        action: "accept",
        content: payload.answers,
      });
      return;
    }
    const answers = Object.fromEntries(
      Object.entries(payload.answers).map(([id, value]) => [
        id,
        { answers: responseValueToAnswerStrings(value) },
      ])
    );
    await resolveInteraction(interaction.id, { answers });
  }, [activeInteractionId, pendingInteractions, resolveInteraction]);

  const resolvePlanApproval = useCallback(async ({
    threadId,
    planTurnId,
    requestId,
    decision,
    feedback,
    proposedMarkdown,
  }: ResolvePlanApprovalInput): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    const normalizedThreadId = threadId.trim();
    const normalizedPlanTurnId = planTurnId.trim();
    const normalizedRequestId = requestId.trim();
    if (
      normalizedThreadId.length === 0
      || normalizedPlanTurnId.length === 0
      || normalizedRequestId.length === 0
    ) {
      return;
    }
    const trimmedFeedback = feedback?.trim() ?? "";
    setIsInteractionSubmitting(true);
    try {
      const response = await lyraApi.request<{ turn?: unknown }>(
        createRequestPayload("turn/planApproval/resolve", {
          threadId: normalizedThreadId,
          planTurnId: normalizedPlanTurnId,
          requestId: normalizedRequestId,
          decision,
          ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
          ...(proposedMarkdown === undefined ? {} : { proposedMarkdown }),
        })
      );
      const nextTurnId = isRecord(response.turn) ? readString(response.turn.id) : null;
      const planPhase =
        decision === "approve_and_implement"
          ? "plan_approved"
          : decision === "keep_planning"
            ? "plan_revision_requested"
            : "plan_rejected";
      setPendingInteractions((current) => current.filter((interaction) => interaction.id !== normalizedRequestId));
      setServerRequestIds((current) => {
        const next = { ...current };
        delete next[normalizedRequestId];
        return next;
      });
      setActiveInteractionId((current) => current === normalizedRequestId ? null : current);
      patchRuntimeBucket(normalizedThreadId, (current) => {
        const existingPlan = current.planByTurn[normalizedPlanTurnId];
        const nextPlanByTurn = existingPlan === undefined
          ? current.planByTurn
          : {
              ...current.planByTurn,
              [normalizedPlanTurnId]: {
                ...existingPlan,
                ...(proposedMarkdown === undefined || proposedMarkdown.trim().length === 0
                  ? {}
                  : { finalText: proposedMarkdown.trim() }),
                updatedAt: Date.now(),
              },
            };
        return {
          ...current,
          isSending: false,
          isStreamActive: nextTurnId !== null,
          streamingAssistantText: "",
          streamingTurnId: nextTurnId,
          finalizingTurnId: null,
          planByTurn: nextPlanByTurn,
          latestRuntimeEventByTurn: {
            ...current.latestRuntimeEventByTurn,
            [normalizedPlanTurnId]: toRuntimeEvent({
              sessionId: normalizedThreadId,
              turnId: normalizedPlanTurnId,
              phase: planPhase,
              payload: {
                requestId: normalizedRequestId,
                decision,
                ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
              },
            }),
            ...(nextTurnId === null
              ? {}
              : {
                  [nextTurnId]: toRuntimeEvent({
                    sessionId: normalizedThreadId,
                    turnId: nextTurnId,
                    phase: "accepted",
                    payload: {
                      threadId: normalizedThreadId,
                      turnId: nextTurnId,
                      planTurnId: normalizedPlanTurnId,
                      requestId: normalizedRequestId,
                      decision,
                    },
                  }),
                }),
          },
        };
      });
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(errorMessageOf(error));
      throw error;
    } finally {
      setIsInteractionSubmitting(false);
    }
  }, [lyraApi, patchRuntimeBucket]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeThreadId === null) {
      return;
    }
    const isRestoredThread = restoredThreadIdsRef.current.has(activeThreadId);
    if (isRestoredThread && !hasLoadedThreadList) {
      return;
    }
    if (isRestoredThread && activeThread === null) {
      forgetThread(activeThreadId);
      return;
    }
    const needsHydratedThread =
      activeThread === null
      || (
        activeThread.turns.length === 0
        && !threadReadRequestedForIdRef.current.has(activeThreadId)
      );
    if (needsHydratedThread) {
      threadReadRequestedForIdRef.current.add(activeThreadId);
      void loadThread(activeThreadId);
    }
  }, [activeThread, activeThreadId, forgetThread, hasLoadedThreadList, loadThread]);

  useEffect(() => {
    if (activeThreadId === null || latestPlanTurnId === null) {
      return;
    }
    const requestId = `plan:${latestPlanTurnId}`;
    if (pendingInteractions.some((interaction) => interaction.id === requestId)) {
      return;
    }
    const latestPlan = activeBucket.planByTurn[latestPlanTurnId];
    if (latestPlan === undefined) {
      return;
    }
    const latestPlanText = latestPlan.finalText ?? latestPlan.draftText.trim();
    if (latestPlanText.trim().length === 0) {
      return;
    }
    const latestEvent = activeBucket.latestRuntimeEventByTurn[latestPlanTurnId] ?? null;
    const planTurn = activeThread?.turns.find((turn) => turn.id === latestPlanTurnId) ?? null;
    const shouldRestorePendingApproval =
      latestEvent?.phase === "plan_approval_requested"
      || (latestEvent === null && normalizeStatus(planTurn?.status) === "waiting");
    if (!shouldRestorePendingApproval) {
      return;
    }
    const interaction = planApprovalInteraction(
      activeThreadId,
      latestPlanTurnId,
      latestPlanText,
      latestPlan.draftText,
      Date.now()
    );
    setPendingInteractions((current) => mergePendingInteractionLists(current, [interaction]));
    setActiveInteractionId((current) => current ?? interaction.id);
    setIsInteractionSubmitting(false);
  }, [
    activeBucket.latestRuntimeEventByTurn,
    activeBucket.planByTurn,
    activeThread,
    activeThreadId,
    latestPlanTurnId,
    pendingInteractions,
  ]);

  useEffect(() => {
    if (lyraApi === null) {
      return;
    }
    return lyraApi.onEvent((event) => {
      if (event.kind === "startup_failed") {
        setRuntimeError(event.error.message);
        return;
      }
      if (event.kind === "disconnected") {
        setRuntimeError(event.message ?? event.error?.message ?? "Lyra runtime disconnected");
        stopAllRuntimeBuckets();
        return;
      }
      if (event.kind === "ready") {
        setRuntimeError(null);
        return;
      }
      if (event.kind === "request") {
        flushQueuedRuntimeBucketPatches();
        const request = isRecord(event.request) ? event.request : null;
        const requestId = request?.id;
        const method = readString(request?.method);
        const params = isRecord(request?.params) ? request.params : {};
        if ((typeof requestId !== "string" && typeof requestId !== "number") || method === null) {
          return;
        }
        if (method === "applyPatchApproval") {
          const threadId = readString(params.conversationId) ?? activeThreadIdRef.current;
          const turnId = streamingTurnIdRef.current ?? `${String(requestId)}:turn`;
          const target = readFirstApplyPatchApprovalTarget(
            params,
            threadId === null ? activeThreadRef.current?.cwd : threadByIdRef.current[threadId]?.cwd
          );
          if (threadId !== null && target !== null && onFollowOpenFilePath !== undefined) {
            onFollowOpenFilePath(target.path, {
              allowMissing: true,
              forceReloadIfOpen: false,
              ...(target.line === undefined ? {} : { location: { line: target.line } }),
            });
            openedDiffTargetsRef.current.add(`${threadId}:${turnId}:${target.path}`);
          }
        }
        const interaction = interactionFromServerRequest(requestId, method, params);
        if (interaction === null) {
          return;
        }
        setPendingInteractions((current) => mergePendingInteractionLists(current, [interaction]));
        setServerRequestIds((current) => ({ ...current, [interaction.id]: requestId }));
        setActiveInteractionId((current) => current ?? interaction.id);
        setIsInteractionSubmitting(false);
        if (interaction.sessionId !== "unknown-thread") {
          patchRuntimeBucket(interaction.sessionId, (current) => ({ ...current, isStreamActive: true }));
        }
        return;
      }
      if (event.kind !== "notification") {
        return;
      }
      const notification = isRecord(event.notification) ? event.notification : null;
      const method = readString(notification?.method);
      const params = isRecord(notification?.params) ? notification.params : {};
      if (method === null) {
        return;
      }
      if (method === "thread/started") {
        const thread = readLyraThread(params.thread);
        if (thread !== null) {
          upsertThread(thread);
        }
        return;
      }
      if (method === "thread/archived" || method === "thread/deleted") {
        const threadId = readString(params.threadId);
        if (threadId === null) {
          void loadThreads();
          return;
        }
        forgetThread(threadId);
        void loadThreads();
        return;
      }
      if (method === "turn/started") {
        const threadId = readString(params.threadId);
        const turn = isRecord(params.turn) ? params.turn : null;
        const turnId = turn === null ? null : readString(turn.id);
        if (threadId !== null && turnId !== null) {
          patchRuntimeBucket(threadId, (current) => ({
            ...current,
            streamingTurnId: turnId,
            streamingAssistantText: "",
            isSending: false,
            isStreamActive: true,
            finalizingTurnId: null,
            latestRuntimeEventByTurn: {
              ...current.latestRuntimeEventByTurn,
              [turnId]: toRuntimeEvent({
                sessionId: threadId,
                turnId,
                phase: "started",
                payload: params,
              }),
            },
          }));
        }
        return;
      }
      if (method === "item/agentMessage/delta") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (threadId !== null && turnId !== null) {
          queueRuntimeBucketPatch(threadId, (current) => ({
            ...current,
            streamingTurnId: turnId,
            isStreamActive: true,
            streamingAssistantText: current.streamingAssistantText + delta,
            latestRuntimeEventByTurn: {
              ...current.latestRuntimeEventByTurn,
              [turnId]: toRuntimeEvent({
                sessionId: threadId,
                turnId,
                phase: "assistant_delta",
                payload: { delta },
              }),
            },
          }));
        }
        return;
      }
      if (method === "item/plan/delta") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (threadId !== null && turnId !== null) {
          const updatedAt = Date.now();
          queueRuntimeBucketPatch(threadId, (current) => {
            const existing = current.planByTurn[turnId];
            return {
              ...current,
              streamingTurnId: turnId,
              isStreamActive: true,
              planByTurn: {
                ...current.planByTurn,
                [turnId]: {
                  turnId,
                  draftText: `${existing?.draftText ?? ""}${delta}`,
                  finalText: existing?.finalText ?? null,
                  explanation: existing?.explanation ?? null,
                  steps: existing?.steps ?? [],
                  updatedAt,
                },
              },
              latestRuntimeEventByTurn: {
                ...current.latestRuntimeEventByTurn,
                [turnId]: toRuntimeEvent({
                  sessionId: threadId,
                  turnId,
                  phase: "plan_delta",
                  payload: { delta },
                }),
              },
            };
          });
        }
        return;
      }
      if (method === "turn/plan/updated") {
        flushQueuedRuntimeBucketPatches();
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        if (threadId !== null && turnId !== null) {
          const steps = Array.isArray(params.plan)
            ? params.plan
                .filter(isRecord)
                .map((entry) => ({
                  step: readString(entry.step) ?? "",
                  status: normalizePlanStepStatus(entry.status),
                }))
                .filter((entry) => entry.step.length > 0)
            : [];
          const explanation = readString(params.explanation);
          const updatedAt = Date.now();
          patchRuntimeBucket(threadId, (current) => {
            const existing = current.planByTurn[turnId];
            return {
              ...current,
              planByTurn: {
                ...current.planByTurn,
                [turnId]: {
                  turnId,
                  draftText: existing?.draftText ?? "",
                  finalText: existing?.finalText ?? null,
                  explanation,
                  steps,
                  updatedAt,
                },
              },
              latestRuntimeEventByTurn: {
                ...current.latestRuntimeEventByTurn,
                [turnId]: toRuntimeEvent({
                  sessionId: threadId,
                  turnId,
                  phase: "plan_updated",
                  payload: params,
                }),
              },
            };
          });
        }
        return;
      }
      if (method === "item/commandExecution/outputDelta") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const itemId = readString(params.itemId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (threadId !== null && turnId !== null && itemId !== null) {
          appendTerminalTranscriptChunk(threadId, turnId, itemId, {
            stream: normalizeTerminalOutputStream(params.stream),
            text: delta,
            timestamp: Date.now(),
          });
          queueRuntimeBucketPatch(threadId, (current) => ({
            ...current,
            streamingTurnId: turnId,
            isStreamActive: true,
            latestRuntimeEventByTurn: {
              ...current.latestRuntimeEventByTurn,
              [turnId]: toRuntimeEvent({
                sessionId: threadId,
                turnId,
                phase: "tool_progress",
                payload: {
                  toolCallId: itemId,
                  toolName: "terminal.exec",
                  progress: {
                    stream: normalizeTerminalOutputStream(params.stream),
                    stdoutChunk: normalizeTerminalOutputStream(params.stream) === "stdout" ? delta : "",
                    stderrChunk: normalizeTerminalOutputStream(params.stream) === "stderr" ? delta : "",
                  },
                },
              }),
            },
          }));
        }
        return;
      }
      if (method === "item/commandExecution/terminalInteraction") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const itemId = readString(params.itemId);
        const stdin = typeof params.stdin === "string" ? params.stdin : "";
        const processId = readString(params.processId) ?? undefined;
        if (threadId !== null && turnId !== null && itemId !== null) {
          appendTerminalTranscriptChunk(threadId, turnId, itemId, {
            stream: "stdin",
            text: stdin,
            timestamp: Date.now(),
            ...(processId === undefined ? {} : { processId }),
          });
        }
        return;
      }
      if (method === "item/fileChange/outputDelta") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const itemId = readString(params.itemId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (threadId !== null && turnId !== null && itemId !== null) {
          queueRuntimeBucketPatch(threadId, (current) => ({
            ...current,
            streamingTurnId: turnId,
            isStreamActive: true,
            latestRuntimeEventByTurn: {
              ...current.latestRuntimeEventByTurn,
              [turnId]: toRuntimeEvent({
                sessionId: threadId,
                turnId,
                phase: "tool_progress",
                payload: {
                  toolCallId: itemId,
                  toolName: "filesystem.write",
                  progress: {
                    stage: "output",
                    delta,
                  },
                },
              }),
            },
          }));
        }
        return;
      }
      if (method === "turn/diff/updated") {
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        if (threadId !== null && turnId !== null) {
          openDiffTargetInWorkspace(threadId, turnId, params.diff);
          queueRuntimeBucketPatch(threadId, (current) => ({
            ...current,
            latestRuntimeEventByTurn: {
              ...current.latestRuntimeEventByTurn,
              [turnId]: toRuntimeEvent({
                sessionId: threadId,
                turnId,
                phase: "tool_progress",
                payload: {
                  toolName: "filesystem.write",
                  progress: {
                    stage: "diff_updated",
                    diff: params,
                  },
                },
              }),
            },
          }));
        }
        return;
      }
      if (method === "item/started" || method === "item/completed") {
        if (method === "item/completed") {
          flushQueuedRuntimeBucketPatches();
        }
        const threadId = readString(params.threadId);
        const turnId = readString(params.turnId);
        const item = isRecord(params.item) && readString(params.item.type) !== null
          ? params.item as LyraThreadItem
          : null;
        if (threadId !== null && turnId !== null && item !== null) {
          if (shouldUpsertLiveThreadItem(item)) {
            setThreadById((current) => ({
              ...current,
              [threadId]: upsertLiveThreadItem(current[threadId], threadId, turnId, item),
            }));
          }
          if (method === "item/completed" && item.type === "agentMessage") {
            const completedText = assistantTextFromThreadItem(item);
            patchRuntimeBucket(threadId, (current) => ({
              ...current,
              streamingAssistantText: consumeCompletedAssistantStreamingText(
                current.streamingAssistantText,
                completedText
              ),
            }));
          }
          if (method === "item/completed" && item.type === "plan") {
            const planText = readRawString(item.text) ?? "";
            if (planText.trim().length > 0) {
              const updatedAt = Date.now();
              const draftText = runtimeByKeyRef.current[threadId]?.planByTurn[turnId]?.draftText ?? "";
              const finalText = planText.trim();
              patchRuntimeBucket(threadId, (current) => {
                const existing = current.planByTurn[turnId];
                return {
                  ...current,
                  streamingTurnId: turnId,
                  isSending: false,
                  isStreamActive: false,
                  finalizingTurnId: null,
                  planByTurn: {
                    ...current.planByTurn,
                    [turnId]: {
                      turnId,
                      draftText,
                      finalText,
                      explanation: existing?.explanation ?? null,
                      steps: existing?.steps ?? [],
                      updatedAt,
                    },
                  },
                  latestRuntimeEventByTurn: {
                    ...current.latestRuntimeEventByTurn,
                    [turnId]: toRuntimeEvent({
                      sessionId: threadId,
                      turnId,
                      phase: "plan_approval_requested",
                      payload: planApprovalPayload(turnId, finalText, draftText),
                    }),
                  },
                };
              });
              const interaction = planApprovalInteraction(threadId, turnId, finalText, draftText, updatedAt);
              setPendingInteractions((current) => mergePendingInteractionLists(current, [interaction]));
              setActiveInteractionId((current) => current ?? interaction.id);
              setIsInteractionSubmitting(false);
            }
          }
          const thread = threadByIdRef.current[threadId] ?? {
            id: threadId,
            preview: "",
            modelProvider: "lyra",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            turns: [],
          };
          const turn = findThreadTurn(thread, turnId) ?? {
            id: turnId,
            status: method === "item/started" ? "inProgress" : "completed",
            items: [],
          };
          const call = threadItemToToolCall(thread, turn, item, 0);
          if (call !== null) {
            patchRuntimeBucket(threadId, (current) => {
              const nextCalls = current.liveToolCalls.filter((entry) => entry.id !== call.id);
              return { ...current, liveToolCalls: [...nextCalls, call].slice(-48) };
            });
            if (item.type === "fileChange") {
              emitWriteToolCallInWorkspace(call);
            }
            followToolCallInWorkspace(threadId, call);
          }
        }
        return;
      }
      if (method === "turn/completed") {
        flushQueuedRuntimeBucketPatches();
        const threadId = readString(params.threadId);
        const turn = isRecord(params.turn) ? params.turn : null;
        const turnId = turn === null ? null : readString(turn.id);
        if (threadId !== null) {
          if (turnId !== null) {
            for (const key of Array.from(openedDiffTargetsRef.current)) {
              if (key.startsWith(`${threadId}:${turnId}:`)) {
                openedDiffTargetsRef.current.delete(key);
              }
            }
          }
          const bucketBeforeCompletion = runtimeByKeyRef.current[threadId] ?? null;
          const resolvedTurnIdForApproval = turnId ?? bucketBeforeCompletion?.streamingTurnId ?? null;
          const turnStatusForApproval = normalizeStatus(turn?.status);
          const existingPlanForApproval = resolvedTurnIdForApproval === null
            ? undefined
            : bucketBeforeCompletion?.planByTurn[resolvedTurnIdForApproval];
          const currentLatestEventForApproval = resolvedTurnIdForApproval === null
            ? null
            : bucketBeforeCompletion?.latestRuntimeEventByTurn[resolvedTurnIdForApproval] ?? null;
          const promotedPlanTextForApproval =
            existingPlanForApproval?.finalText ?? existingPlanForApproval?.draftText.trim() ?? "";
          const shouldEnqueuePlanApproval =
            resolvedTurnIdForApproval !== null
            && turnStatusForApproval !== "failed"
            && existingPlanForApproval !== undefined
            && promotedPlanTextForApproval.trim().length > 0
            && (
              currentLatestEventForApproval?.phase === "plan_approval_requested"
              || (
                turnStatusForApproval === "waiting"
                && existingPlanForApproval.finalText === null
                && existingPlanForApproval.draftText.trim().length > 0
              )
            );
          const pendingPlanApprovalInteraction = shouldEnqueuePlanApproval && resolvedTurnIdForApproval !== null
            ? planApprovalInteraction(
                threadId,
                resolvedTurnIdForApproval,
                promotedPlanTextForApproval,
                existingPlanForApproval?.draftText ?? "",
                Date.now()
              )
            : null;
          patchRuntimeBucket(threadId, (current) => {
            const resolvedTurnId = turnId ?? current.streamingTurnId;
            const currentLatestEvent = resolvedTurnId === null
              ? null
              : current.latestRuntimeEventByTurn[resolvedTurnId] ?? null;
            const turnStatus = normalizeStatus(turn?.status);
            const existingPlan = resolvedTurnId === null
              ? undefined
              : current.planByTurn[resolvedTurnId];
            const promotedPlanText =
              existingPlan?.finalText ?? existingPlan?.draftText.trim() ?? "";
            const shouldPromotePlanDraft =
              resolvedTurnId !== null
              && turnStatus === "waiting"
              && currentLatestEvent?.phase !== "plan_approval_requested"
              && existingPlan !== undefined
              && existingPlan.finalText === null
              && existingPlan.draftText.trim().length > 0;
            const planApprovalEvent = shouldPromotePlanDraft && resolvedTurnId !== null
              ? toRuntimeEvent({
                  sessionId: threadId,
                  turnId: resolvedTurnId,
                  phase: "plan_approval_requested",
                  payload: planApprovalPayload(
                    resolvedTurnId,
                    promotedPlanText,
                    existingPlan?.draftText ?? ""
                  ),
                })
              : currentLatestEvent?.phase === "plan_approval_requested"
                ? currentLatestEvent
                : null;
            const keepPlanApprovalWaiting = planApprovalEvent !== null && turnStatus !== "failed";
            return {
              ...current,
              isSending: false,
              isStreamActive: false,
              streamingAssistantText: "",
              streamingTurnId: keepPlanApprovalWaiting ? resolvedTurnId : null,
              finalizingTurnId: keepPlanApprovalWaiting ? null : resolvedTurnId,
              planByTurn: shouldPromotePlanDraft && resolvedTurnId !== null && existingPlan !== undefined
                ? {
                    ...current.planByTurn,
                    [resolvedTurnId]: {
                      ...existingPlan,
                      finalText: promotedPlanText,
                      updatedAt: Date.now(),
                    },
                  }
                : current.planByTurn,
              latestRuntimeEventByTurn: resolvedTurnId === null
                ? current.latestRuntimeEventByTurn
                : {
                    ...current.latestRuntimeEventByTurn,
                    [resolvedTurnId]: keepPlanApprovalWaiting
                      ? planApprovalEvent
                      : toRuntimeEvent({
                          sessionId: threadId,
                          turnId: resolvedTurnId,
                          phase: turnStatus === "failed"
                            ? "failed"
                            : turnStatus === "waiting"
                              ? "paused"
                              : "completed",
                          payload: params,
                        }),
                  },
            };
          });
          if (pendingPlanApprovalInteraction !== null) {
            setPendingInteractions((current) =>
              mergePendingInteractionLists(current, [pendingPlanApprovalInteraction])
            );
            setActiveInteractionId((current) => current ?? pendingPlanApprovalInteraction.id);
            setIsInteractionSubmitting(false);
          }
          void loadThread(threadId);
          void loadThreads();
        }
        return;
      }
      if (method === "serverRequest/resolved") {
        const requestId = readString(params.requestId) ?? readNumber(params.requestId)?.toString() ?? null;
        if (requestId !== null) {
          setPendingInteractions((current) => current.filter((interaction) => interaction.id !== requestId));
          setActiveInteractionId((current) => current === requestId ? null : current);
        }
        return;
      }
      if (
        method === "thread/name/updated"
        || method === "thread/status/changed"
        || method === "memory/trimmed"
        || method === "memory/shared/updated"
        || method === "memory/frozen/updated"
        || method === "memory/promptCache/updated"
      ) {
        const threadId = readString(params.threadId);
        if (threadId !== null) {
          void loadThread(threadId);
        }
        void loadThreads();
      }
    });
  }, [
    appendTerminalTranscriptChunk,
    emitWriteToolCallInWorkspace,
    flushQueuedRuntimeBucketPatches,
    followToolCallInWorkspace,
    forgetThread,
    loadThread,
    loadThreads,
    lyraApi,
    onFollowOpenFilePath,
    openDiffTargetInWorkspace,
    patchRuntimeBucket,
    queueRuntimeBucketPatch,
    runtimeByKeyRef,
    stopAllRuntimeBuckets,
    upsertThread,
  ]);

  useEffect(() => {
    const capabilitiesApi = desktopApi?.capabilities;
    if (capabilitiesApi === undefined) {
      return;
    }
    return capabilitiesApi.onEvent((event) => {
      emitCapabilityWriteEvent(event);
    });
  }, [desktopApi, emitCapabilityWriteEvent]);

  const pendingInteractionQueue = useMemo(
    () =>
      sortPendingInteractions(pendingInteractions)
        .map((interaction) => toPendingInteractionPanel(interaction, interactionTextLabels))
        .filter((panel): panel is PendingInteractionPanel => panel !== null),
    [interactionTextLabels, pendingInteractions]
  );
  const activePendingInteraction = useMemo(
    () =>
      activeInteractionId === null
        ? pendingInteractionQueue[0] ?? null
        : pendingInteractionQueue.find((panel) => panel.request.id === activeInteractionId) ?? pendingInteractionQueue[0] ?? null,
    [activeInteractionId, pendingInteractionQueue]
  );
  const activeInteractionPanel = activePendingInteraction;
  const activeInteractionPosition = activePendingInteraction === null
    ? 0
    : pendingInteractionQueue.findIndex((panel) => panel.request.id === activePendingInteraction.request.id) + 1;

  return {
    state: {
      threads,
      threadTabs,
      activeTabId: tabState.activeTabId,
      activeThreadId,
      activeThread,
      activeDetail,
      optimisticUserMessages: activeBucket.optimisticUserMessages,
      liveToolCalls: activeBucket.liveToolCalls,
      latestRuntimeEventByTurn: activeBucket.latestRuntimeEventByTurn,
      followEnabled: activeBucket.followEnabled,
      latestPlanTurnId,
      pendingInteractions,
      pendingInteractionQueue,
      activeInteractionPanel,
      activePendingInteraction,
      activeInteractionPosition,
      activeInteractionId,
      isLoadingThreads,
      isLoadingThread,
      isSending: activeBucket.isSending,
      planByTurn: activeBucket.planByTurn,
      planModeEnabled,
      isStreamActive: activeBucket.isStreamActive,
      isInteractionSubmitting,
      streamingTurnId: activeBucket.streamingTurnId,
      streamingAssistantText: activeBucket.streamingAssistantText,
      finalizingTurnId: activeBucket.finalizingTurnId,
      runtimeError,
    },
    actions: {
      loadThreads,
      loadThread,
      createThread,
      sendTurn,
      steerTurn,
      interruptTurn,
      cleanBackgroundTerminals,
      forkThread,
      forkThreadFromTurn,
      rollbackThread,
      startReview,
      selectThread,
      activateThreadTab,
      closeThreadTab,
      reorderThreadTab,
      openThreadTab,
      setPlanModeEnabled,
      setFollowEnabled,
      setActiveInteractionId,
      respondToCommandApproval,
      respondToPlanQuestion,
      resolvePlanApproval,
    },
  };
};
