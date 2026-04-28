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
  toPersistedRuntimeFeedItem,
  toRuntimeFeedItem,
  type AgentRuntimeFeedItem,
  type AgentTurnTimelineItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import {
  normalizeStreamingStatusLabel,
  pickMostRecentRuntimeEvent,
  resolveAssistantDisplayContent,
  sortByTime,
  type DisplayMessage,
  type OptimisticUserMessage,
  type StreamStatusItem,
} from "./view-helpers";

const FEED_ITEM_LIMIT = 48;

type RuntimeStatusLabels = {
  readonly runtimeQueued: string;
  readonly runtimeStarted: string;
  readonly runtimeCompletedTurn: string;
  readonly runtimeFailedTurn: string;
  readonly runtimePhaseToolStarted: string;
  readonly runtimePhaseToolFinished: string;
  readonly generatingReply: string;
  readonly pendingInteractions: string;
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
  const persistedMessages = useMemo(() => {
    const optimisticByTurn = new Map<string, OptimisticUserMessage>();
    for (const message of optimisticUserMessages) {
      if (
        typeof message.turnId === "string" &&
        message.contentParts !== undefined &&
        message.contentParts.some((part) => part.type === "attachment")
      ) {
        optimisticByTurn.set(message.turnId, message);
      }
    }
    return sortByTime((activeDetail?.messages ?? []).map((message) => {
      if (
        message.role !== "user" ||
        typeof message.turnId !== "string" ||
        (message.contentParts !== undefined && message.contentParts.length > 0)
      ) {
        return message;
      }
      const optimistic = optimisticByTurn.get(message.turnId);
      if (optimistic === undefined || optimistic.contentParts === undefined) {
        return message;
      }
      return {
        ...message,
        content: optimistic.content,
        contentParts: optimistic.contentParts,
      };
    }));
  }, [activeDetail?.messages, optimisticUserMessages]);

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

  const displayOptimisticUserMessages = useMemo(() => {
    const persistedUserTurnIds = new Set<string>();
    for (const message of persistedMessages) {
      if (message.role === "user" && typeof message.turnId === "string") {
        persistedUserTurnIds.add(message.turnId);
      }
    }
    if (persistedUserTurnIds.size === 0) {
      return optimisticUserMessages;
    }
    return optimisticUserMessages.filter(
      (message) => message.turnId === undefined || !persistedUserTurnIds.has(message.turnId)
    );
  }, [optimisticUserMessages, persistedMessages]);

  const sortedMessages = useMemo<readonly DisplayMessage[]>(
    () => sortByTime([...persistedMessages, ...displayOptimisticUserMessages]),
    [displayOptimisticUserMessages, persistedMessages]
  );

  const assistantMessageOrderById = useMemo(() => {
    const map = new Map<string, number>();
    const countedTurns = new Set<string>();
    let assistantIndex = 0;
    for (const message of sortedMessages) {
      if (message.role !== "assistant") {
        continue;
      }
      const turnId =
        "turnId" in message && typeof message.turnId === "string"
          ? message.turnId
          : null;
      if (turnId !== null) {
        if (countedTurns.has(turnId)) {
          continue;
        }
        countedTurns.add(turnId);
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
    const assistantMessagesByTurn = new Map<string, DisplayMessage[]>();
    for (const message of persistedMessages) {
      if (message.role !== "assistant" || typeof message.turnId !== "string") {
        continue;
      }
      const current = assistantMessagesByTurn.get(message.turnId);
      if (current === undefined) {
        assistantMessagesByTurn.set(message.turnId, [message]);
      } else {
        current.push(message);
      }
    }
    for (const [turnId, messages] of assistantMessagesByTurn.entries()) {
      const runtimeEvents = runtimeEventsByTurn.get(turnId) ?? [];
      const runtimeFeedItems = runtimeFeedByTurn.get(turnId) ?? [];
      const hasAssistantDeltaEvents = runtimeEvents.some((event) => event.phase === "assistant_delta");
      const sortedAssistantMessages = sortByTime(messages);

      if (hasAssistantDeltaEvents) {
        const finalMessage = sortedAssistantMessages.at(-1);
        map.set(
          turnId,
          buildTurnTimelineItems({
            turnId,
            messageContent: finalMessage === undefined ? "" : resolveAssistantDisplayContent(finalMessage),
            messageCreatedAt: finalMessage?.createdAt ?? Date.now(),
            runtimeEvents,
            runtimeFeedItems,
            toolNameLabels,
            runtimeToolFallbackLabel,
          })
        );
        continue;
      }

      const timelineItems: AgentTurnTimelineItem[] = [];
      for (const message of sortedAssistantMessages) {
        const content = resolveAssistantDisplayContent(message);
        if (content.trim().length === 0) {
          continue;
        }
        timelineItems.push({
          kind: "assistant",
          id: message.id,
          timestamp: message.createdAt,
          content,
        });
      }
      for (const item of runtimeFeedItems) {
        timelineItems.push({
          kind: "tool",
          id: `tool-${item.id}`,
          timestamp: item.timestamp,
          tool: item,
        });
      }
      timelineItems.sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }
        if (left.kind === right.kind) {
          return left.id.localeCompare(right.id);
        }
        return left.kind === "assistant" ? -1 : 1;
      });
      map.set(turnId, timelineItems);
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
    () => {
      if (streamingTurnId === null) {
        return [];
      }
      if (
        streamingAssistantText.length === 0
        && persistedAssistantDisplayByTurn.has(streamingTurnId)
      ) {
        return [];
      }
      return runtimeFeedByTurn.get(streamingTurnId) ?? [];
    },
    [persistedAssistantDisplayByTurn, runtimeFeedByTurn, streamingAssistantText.length, streamingTurnId]
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
      if (
        streamingTurnId !== null
        && streamingAssistantText.length === 0
        && persistedAssistantDisplayByTurn.has(streamingTurnId)
      ) {
        return null;
      }
      const runningTool = [...streamingTurnRuntimeFeed]
        .reverse()
        .find((item) => item.status === "running") ?? null;
      if (runningTool !== null) {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimePhaseToolStarted),
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
          label: normalizeStreamingStatusLabel(labels.generatingReply),
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
          label: normalizeStreamingStatusLabel(labels.runtimeCompletedTurn),
          tone: "completed",
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
          tone: "waiting",
        };
      }
      if (phase === "started") {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimeStarted),
          tone: "running",
        };
      }
      if (phase === "tool_started" || phase === "tool_progress") {
        return {
          label: normalizeStreamingStatusLabel(labels.runtimePhaseToolStarted),
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
          tone: "waiting",
        };
      }
      if (streamingTurnId !== null) {
        return {
          label: normalizeStreamingStatusLabel(labels.generatingReply),
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
      labels.runtimeCompletedTurn,
      labels.runtimePhaseToolFinished,
      labels.runtimePhaseToolStarted,
      labels.runtimeQueued,
      labels.runtimeFailedTurn,
      labels.runtimeStarted,
      persistedAssistantDisplayByTurn,
      streamingAssistantText.length,
      streamingRuntimeEvent,
      streamingTurnId,
      streamingTurnRuntimeFeed,
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
