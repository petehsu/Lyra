import type { RuntimeEventProcessingContext } from "./runtime-event-context";

export const handleTurnLifecycle = ({
  event,
  setIsInteractionSubmitting,
  setOptimisticUserMessages,
  setIsStreamActive,
  setFinalizingTurnId,
  streamingTurnIdRef,
  setStreamingTurnId,
  setStreamingAssistantText,
  setTransientInteractionPanel,
}: RuntimeEventProcessingContext): void => {
  if (event.phase === "accepted") {
    setIsInteractionSubmitting(false);
    setOptimisticUserMessages([]);
    setIsStreamActive(true);
    setFinalizingTurnId(null);
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
    setIsInteractionSubmitting(false);
    setIsStreamActive(false);
    setTransientInteractionPanel(null);
    if (streamingTurnIdRef.current === event.turnId) {
      setFinalizingTurnId(event.turnId);
      setStreamingAssistantText("");
      streamingTurnIdRef.current = null;
      setStreamingTurnId(null);
    }
  }
};
