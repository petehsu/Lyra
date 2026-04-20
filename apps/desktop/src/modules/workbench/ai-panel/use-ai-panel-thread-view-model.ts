import { useMemo } from "react";

import type {
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentToolCall,
  AgentTurn,
} from "../../../shared/desktop-bridge";
import type { ActiveInteractionPanel } from "./interaction/pending-interaction-mappers";
import {
  buildTurnTimelineItems,
  mergeRuntimeFeedItem,
  normalizeToolName,
  toPersistedRuntimeFeedItem,
  toRuntimeFeedItem,
  type AgentRuntimeFeedItem,
  type AgentTurnTimelineItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import {
  isRecord,
  normalizeStreamingStatusLabel,
  pickMostRecentRuntimeEvent,
  pickString,
  resolveAssistantDisplayContent,
  sortByTime,
  type DisplayMessage,
  type OptimisticUserMessage,
  type StreamStatusItem,
} from "./view-helpers";

const FEED_ITEM_LIMIT = 48;

type RuntimeStatusLabels = {
  readonly runtimeRunningPrefix: string;
  readonly pendingInteractions: string;
  readonly waitingPhraseFinalizingReply: string;
  readonly runtimeFailedTurn: string;
  readonly runtimeQueued: string;
  readonly runtimeStarted: string;
  readonly runtimePhaseToolStarted: string;
  readonly runtimePhaseToolFinished: string;
  readonly generatingReply: string;
};

type UseAiPanelThreadViewModelParams = {
  readonly activeDetail: AgentSessionDetail | null;
  readonly optimisticUserMessages: readonly OptimisticUserMessage[];
  readonly runtimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingTurnId: string | null;
  readonly latestRuntimeEventByTurn: Readonly<Record<string, AgentRuntimeEvent>>;
  readonly activeInteractionPanel: ActiveInteractionPanel;
  readonly isInteractionSubmitting: boolean;
  readonly isSending: boolean;
  readonly isStreamActive: boolean;
  readonly streamingAssistantText: string;
  readonly finalizingTurnId: string | null;
  readonly toolNameLabels: ToolNameLabelMap;
  readonly runtimeToolFallbackLabel: string;
  readonly labels: RuntimeStatusLabels;
};

type UseAiPanelThreadViewModelResult = {
  readonly persistedAssistantDisplayByTurn: ReadonlySet<string>;
  readonly sortedMessages: readonly DisplayMessage[];
  readonly assistantMessageOrderById: ReadonlyMap<string, number>;
  readonly turnsById: ReadonlyMap<string, AgentTurn>;
  readonly toolCallsByTurn: ReadonlyMap<string, AgentToolCall[]>;
  readonly runtimeFeedByTurn: ReadonlyMap<string, AgentRuntimeFeedItem[]>;
  readonly turnTimelineByTurn: ReadonlyMap<string, readonly AgentTurnTimelineItem[]>;
  readonly displayRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingTurnRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingStatus: StreamStatusItem | null;
  readonly orphanRuntimeFeed: readonly AgentRuntimeFeedItem[];
};

export const useAiPanelThreadViewModel = ({
  activeDetail,
  optimisticUserMessages,
  runtimeFeed,
  streamingTurnId,
  latestRuntimeEventByTurn,
  activeInteractionPanel,
  isInteractionSubmitting,
  isSending,
  isStreamActive,
  streamingAssistantText,
  finalizingTurnId,
  toolNameLabels,
  runtimeToolFallbackLabel,
  labels,
}: UseAiPanelThreadViewModelParams): UseAiPanelThreadViewModelResult => {
  const persistedMessages = useMemo(
    () => sortByTime(activeDetail?.messages ?? []),
    [activeDetail?.messages]
  );

  const persistedAssistantDisplayByTurn = useMemo(() => {
    const visible = new Set<string>();
    for (const message of persistedMessages) {
      if (message.role !== "assistant" || typeof message.turnId !== "string") {
        continue;
      }
      const content = resolveAssistantDisplayContent(message).trim();
      if (content.length > 0) {
        visible.add(message.turnId);
      }
    }
    return visible;
  }, [persistedMessages]);

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
          messageContent: resolveAssistantDisplayContent(message),
          messageCreatedAt: message.createdAt,
          runtimeEvents: runtimeEventsByTurn.get(message.turnId) ?? [],
          runtimeFeedItems: runtimeFeedByTurn.get(message.turnId) ?? [],
          toolNameLabels,
          runtimeToolFallbackLabel,
        })
      );
    }
    return map;
  }, [
    persistedMessages,
    runtimeEventsByTurn,
    runtimeFeedByTurn,
    runtimeToolFallbackLabel,
    toolNameLabels,
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
            `${labels.runtimeRunningPrefix} ${runningTool.toolLabel}`
          ),
          tone: "running",
        };
      }

      const hasWaitingInteraction = activeInteractionPanel !== null || isInteractionSubmitting;
      if (hasWaitingInteraction) {
        return {
          label: normalizeStreamingStatusLabel(labels.pendingInteractions),
          tone: "waiting",
        };
      }

      if (
        finalizingTurnId !== null
        && !persistedAssistantDisplayByTurn.has(finalizingTurnId)
      ) {
        return {
          label: normalizeStreamingStatusLabel(labels.waitingPhraseFinalizingReply),
          tone: "running",
        };
      }

      const phase = streamingRuntimeEvent?.phase ?? null;
      if (phase === "failed") {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimeFailedTurn),
          tone: "failed",
        };
      }
      if (phase === "completed") {
        return {
          label: normalizeStreamingStatusLabel(labels.waitingPhraseFinalizingReply),
          tone: "running",
        };
      }
      if (
        phase === "paused"
        || phase === "interaction_pending"
        || phase === "interaction_submitted"
        || phase === "command_approval_request"
        || phase === "plan_question_requested"
        || phase === "plan_approval_requested"
      ) {
        return {
          label: normalizeStreamingStatusLabel(labels.pendingInteractions),
          tone: "waiting",
        };
      }

      if (phase === "accepted") {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimeQueued),
          tone: "running",
        };
      }
      if (phase === "started") {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimeStarted),
          tone: "running",
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
              ? labels.runtimePhaseToolStarted
              : `${labels.runtimeRunningPrefix} ${phaseToolLabel}`
          ),
          tone: "running",
        };
      }
      if (phase === "tool_finished") {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimePhaseToolFinished),
          tone: "running",
        };
      }

      if (
        streamingAssistantText.length > 0
        || isStreamActive
        || phase === "assistant_delta"
      ) {
        return {
          label: normalizeStreamingStatusLabel(labels.generatingReply),
          tone: "running",
        };
      }
      if (isSending) {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimeQueued),
          tone: "running",
        };
      }
      if (streamingTurnId !== null) {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimeStarted),
          tone: "running",
        };
      }
      return null;
    },
    [
      activeInteractionPanel,
      finalizingTurnId,
      isInteractionSubmitting,
      isSending,
      isStreamActive,
      labels.generatingReply,
      labels.pendingInteractions,
      labels.runtimeFailedTurn,
      labels.runtimePhaseToolFinished,
      labels.runtimePhaseToolStarted,
      labels.runtimeQueued,
      labels.runtimeRunningPrefix,
      labels.runtimeStarted,
      labels.waitingPhraseFinalizingReply,
      persistedAssistantDisplayByTurn,
      streamingAssistantText.length,
      streamingRuntimeEvent,
      streamingTurnId,
      streamingTurnRuntimeFeed,
      toolNameLabels,
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
    streamingTurnId,
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

  return {
    persistedAssistantDisplayByTurn,
    sortedMessages,
    assistantMessageOrderById,
    turnsById,
    toolCallsByTurn,
    runtimeFeedByTurn,
    turnTimelineByTurn,
    displayRuntimeFeed,
    streamingTurnRuntimeFeed,
    streamingStatus,
    orphanRuntimeFeed,
  };
};
