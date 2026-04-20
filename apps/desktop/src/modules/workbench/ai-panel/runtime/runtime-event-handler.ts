import { isRecord } from "../view-helpers";
import {
  type HandleAiPanelRuntimeEventParams,
  type RuntimeEventProcessingContext,
} from "./runtime-event-context";
import {
  applyRuntimeError,
  handleAssistantDelta,
  isActiveSessionEvent,
  syncPendingInteractionsFromEvent,
  updateLatestRuntimeEvent,
} from "./runtime-event-sync";
import {
  handleRuntimeFeed,
  handleTerminalExecStarted,
  handleWriteStreamEvent,
} from "./runtime-event-tools";
import {
  handleInteractionPanels,
} from "./runtime-interaction-panels";
import { handleTurnLifecycle } from "./runtime-turn-lifecycle";
import { triggerRuntimeRefreshes } from "./runtime-refresh-policy";

export const handleAiPanelRuntimeEvent = (
  params: HandleAiPanelRuntimeEventParams
): void => {
  const payload = isRecord(params.event.payload) ? params.event.payload : {};
  const context: RuntimeEventProcessingContext = {
    ...params,
    payload,
    progress: isRecord(payload.progress) ? payload.progress : null,
  };

  syncPendingInteractionsFromEvent(context);
  if (!isActiveSessionEvent(context)) {
    return;
  }

  updateLatestRuntimeEvent(context);
  if (handleAssistantDelta(context)) {
    return;
  }
  applyRuntimeError(context);
  handleWriteStreamEvent(context);
  handleTerminalExecStarted(context);
  handleRuntimeFeed(context);
  handleInteractionPanels(context);
  handleTurnLifecycle(context);
  triggerRuntimeRefreshes(context);
};
