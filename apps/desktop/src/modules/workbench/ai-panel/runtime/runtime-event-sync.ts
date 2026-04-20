import type { RuntimeEventProcessingContext } from "./runtime-event-context";
import type { AgentPendingInteraction } from "../../../../shared/desktop-bridge";
import {
  isRecord,
  pickRawString,
  pickString,
  resolveEventError,
  runtimeEventPhasePriority,
} from "../view-helpers";

export const syncPendingInteractionsFromEvent = ({
  event,
  payload,
  replacePendingInteractions,
  mergePendingInteractionsForSession,
  livePendingInteractionsRef,
}: RuntimeEventProcessingContext): void => {
  if (event.phase === "interaction_queue_updated") {
    const interactions = Array.isArray(payload.pendingInteractions)
      ? payload.pendingInteractions
      : [];
    replacePendingInteractions(event.sessionId, interactions as readonly AgentPendingInteraction[]);
  }
  if (event.phase === "interaction_pending") {
    const interactionPayload = isRecord(payload.interaction) ? payload.interaction : null;
    if (interactionPayload !== null) {
      mergePendingInteractionsForSession(event.sessionId, [interactionPayload as AgentPendingInteraction]);
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
};

export const isActiveSessionEvent = ({
  event,
  activeSessionIdRef,
}: RuntimeEventProcessingContext): boolean => event.sessionId === activeSessionIdRef.current;

export const updateLatestRuntimeEvent = ({
  event,
  setLatestRuntimeEventByTurn,
}: RuntimeEventProcessingContext): void => {
  if (event.phase === "assistant_delta" || event.phase === "reasoning_thought") {
    return;
  }
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
      [event.turnId]: event,
    };
  });
};

export const handleAssistantDelta = ({
  event,
  payload,
  setFinalizingTurnId,
  streamingTurnIdRef,
  setStreamingAssistantText,
  setIsStreamActive,
  setStreamingTurnId,
}: RuntimeEventProcessingContext): boolean => {
  if (event.phase !== "assistant_delta") {
    return false;
  }
  const delta = pickRawString(payload, "delta") ?? "";
  if (delta.length > 0) {
    setFinalizingTurnId(null);
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
  return true;
};

export const applyRuntimeError = ({
  event,
  setRuntimeError,
}: RuntimeEventProcessingContext): void => {
  const error = resolveEventError(event);
  if (error !== null) {
    setRuntimeError(error);
  }
};
