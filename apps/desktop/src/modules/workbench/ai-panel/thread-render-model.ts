import type { AgentRuntimeFeedItem } from "./runtime/feed-utils";
import type { LyraTurnPlanState } from "./use-lyra-thread-runtime";
import type { DisplayMessage, StreamStatusItem } from "./view-helpers";

export type AiPanelThreadRenderRow =
  | {
    readonly kind: "message";
    readonly key: string;
    readonly message: DisplayMessage;
    readonly messageIndex: number;
  }
  | {
    readonly kind: "plan";
    readonly key: string;
    readonly plan: LyraTurnPlanState;
    readonly sessionId: string;
  }
  | {
    readonly kind: "streaming";
    readonly key: string;
  }
  | {
    readonly kind: "orphanRuntimeFeed";
    readonly key: string;
  }
  | {
    readonly kind: "runtimeError";
    readonly key: string;
    readonly message: string;
  };

export type AiPanelThreadMessageMetadata = {
  readonly firstAssistantIndexByTurn: ReadonlyMap<string, number>;
  readonly lastAssistantIndexByTurn: ReadonlyMap<string, number>;
  readonly assistantTurnIds: ReadonlySet<string>;
  readonly messageSessionIdByTurn: ReadonlyMap<string, string>;
};

export const displayMessageTurnId = (message: DisplayMessage): string | null =>
  "turnId" in message && typeof message.turnId === "string" ? message.turnId : null;

export const displayMessageSessionId = (message: DisplayMessage): string | null =>
  "sessionId" in message && typeof message.sessionId === "string" ? message.sessionId : null;

export const shouldRenderPlanCard = (plan: LyraTurnPlanState): boolean =>
  plan.artifact.title.trim().length > 0 || plan.artifact.summary.trim().length > 0;

export const buildAiPanelThreadMessageMetadata = (
  sortedMessages: readonly DisplayMessage[]
): AiPanelThreadMessageMetadata => {
  const firstAssistantIndexByTurn = new Map<string, number>();
  const lastAssistantIndexByTurn = new Map<string, number>();
  const assistantTurnIds = new Set<string>();
  const messageSessionIdByTurn = new Map<string, string>();
  sortedMessages.forEach((message, index) => {
    const turnId = displayMessageTurnId(message);
    if (turnId === null) {
      return;
    }
    const sessionId = displayMessageSessionId(message);
    if (sessionId !== null) {
      messageSessionIdByTurn.set(turnId, sessionId);
    }
    if (message.role !== "assistant") {
      return;
    }
    assistantTurnIds.add(turnId);
    if (!firstAssistantIndexByTurn.has(turnId)) {
      firstAssistantIndexByTurn.set(turnId, index);
    }
    lastAssistantIndexByTurn.set(turnId, index);
  });
  return {
    firstAssistantIndexByTurn,
    lastAssistantIndexByTurn,
    assistantTurnIds,
    messageSessionIdByTurn,
  };
};

export const buildAiPanelThreadRenderRows = ({
  sortedMessages,
  planByTurn,
  typewriterText,
  streamingTurnRuntimeFeed,
  streamingStatus,
  orphanRuntimeFeed,
  runtimeError,
  messageMetadata,
}: {
  readonly sortedMessages: readonly DisplayMessage[];
  readonly planByTurn: Readonly<Record<string, LyraTurnPlanState>>;
  readonly typewriterText: string;
  readonly streamingTurnRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingStatus: StreamStatusItem | null;
  readonly orphanRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly runtimeError: string | null;
  readonly messageMetadata: AiPanelThreadMessageMetadata;
}): readonly AiPanelThreadRenderRow[] => {
  const rows: AiPanelThreadRenderRow[] = [];
  sortedMessages.forEach((message, messageIndex) => {
    const turnId = displayMessageTurnId(message);
    if (
      message.role === "assistant" &&
      turnId !== null &&
      messageMetadata.firstAssistantIndexByTurn.get(turnId) !== messageIndex
    ) {
      return;
    }
    rows.push({
      kind: "message",
      key: `message:${message.id}`,
      message,
      messageIndex,
    });
    const planForTurn = turnId === null ? undefined : planByTurn[turnId];
    if (
      planForTurn !== undefined &&
      shouldRenderPlanCard(planForTurn) &&
      message.role === "assistant" &&
      turnId !== null &&
      messageMetadata.firstAssistantIndexByTurn.get(turnId) === messageIndex
    ) {
      rows.push({
        kind: "plan",
        key: `plan:${turnId}`,
        plan: planForTurn,
        sessionId: displayMessageSessionId(message) ?? "",
      });
    }
  });
  for (const plan of Object.values(planByTurn)) {
    if (!shouldRenderPlanCard(plan) || messageMetadata.assistantTurnIds.has(plan.turnId)) {
      continue;
    }
    rows.push({
      kind: "plan",
      key: `plan:${plan.turnId}`,
      plan,
      sessionId: messageMetadata.messageSessionIdByTurn.get(plan.turnId) ?? "",
    });
  }
  if (typewriterText.length > 0 || streamingTurnRuntimeFeed.length > 0 || streamingStatus !== null) {
    rows.push({ kind: "streaming", key: "streaming" });
  }
  if (orphanRuntimeFeed.length > 0) {
    rows.push({ kind: "orphanRuntimeFeed", key: "orphan-runtime-feed" });
  }
  if (runtimeError !== null) {
    rows.push({ kind: "runtimeError", key: "runtime-error", message: runtimeError });
  }
  return rows;
};
