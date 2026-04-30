import { useEffect, useMemo, useRef, type RefObject } from "react";

import type { AgentRuntimeFeedItem } from "./runtime/feed-utils";
import {
  buildAiPanelThreadMessageMetadata,
  buildAiPanelThreadRenderRows,
  type AiPanelThreadMessageMetadata,
  type AiPanelThreadRenderRow,
} from "./thread-render-model";
import {
  useAiPanelThreadVirtualRows,
  type AiPanelThreadVirtualRow,
} from "./use-ai-panel-thread-virtual-rows-model";
import type { LyraTurnPlanState } from "./use-lyra-thread-runtime";
import type { DisplayMessage, StreamStatusItem } from "./view-helpers";

type UseAiPanelThreadRenderingParams = {
  readonly sortedMessages: readonly DisplayMessage[];
  readonly planByTurn: Readonly<Record<string, LyraTurnPlanState>>;
  readonly typewriterText: string;
  readonly streamingTurnRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly streamingStatus: StreamStatusItem | null;
  readonly orphanRuntimeFeed: readonly AgentRuntimeFeedItem[];
  readonly runtimeError: string | null;
  readonly activeThreadId: string | null;
  readonly optimisticUserMessages: readonly unknown[];
  readonly pendingInteractions: readonly unknown[];
  readonly streamingAssistantText: string;
};

export type AiPanelThreadRendering = {
  readonly threadViewportRef: RefObject<HTMLDivElement>;
  readonly messageMetadata: AiPanelThreadMessageMetadata;
  readonly renderRows: readonly AiPanelThreadRenderRow[];
  readonly virtualRows: readonly AiPanelThreadVirtualRow[];
  readonly topSpacerHeight: number;
  readonly bottomSpacerHeight: number;
  readonly measureThreadRow: (rowKey: string, node: HTMLDivElement | null) => void;
};

export const useAiPanelThreadRendering = ({
  sortedMessages,
  planByTurn,
  typewriterText,
  streamingTurnRuntimeFeed,
  streamingStatus,
  orphanRuntimeFeed,
  runtimeError,
  activeThreadId,
  optimisticUserMessages,
  pendingInteractions,
  streamingAssistantText,
}: UseAiPanelThreadRenderingParams): AiPanelThreadRendering => {
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToThreadBottomRef = useRef(true);

  const messageMetadata = useMemo(
    () => buildAiPanelThreadMessageMetadata(sortedMessages),
    [sortedMessages]
  );

  const renderRows = useMemo(
    () => buildAiPanelThreadRenderRows({
      sortedMessages,
      planByTurn,
      typewriterText,
      streamingTurnRuntimeFeed,
      streamingStatus,
      orphanRuntimeFeed,
      runtimeError,
      messageMetadata,
    }),
    [
      messageMetadata,
      orphanRuntimeFeed,
      planByTurn,
      runtimeError,
      sortedMessages,
      streamingStatus,
      streamingTurnRuntimeFeed,
      typewriterText,
    ]
  );

  const {
    virtualRows,
    topSpacerHeight,
    bottomSpacerHeight,
    measureRow: measureThreadRow,
  } = useAiPanelThreadVirtualRows(threadViewportRef, renderRows);

  useEffect(() => {
    const viewport = threadViewportRef.current;
    if (viewport === null) {
      return;
    }
    const updateStickiness = (): void => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldStickToThreadBottomRef.current = distanceFromBottom <= 96;
    };
    updateStickiness();
    viewport.addEventListener("scroll", updateStickiness, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", updateStickiness);
    };
  }, []);

  useEffect(() => {
    shouldStickToThreadBottomRef.current = true;
  }, [activeThreadId]);

  useEffect(() => {
    const viewport = threadViewportRef.current;
    if (viewport === null || !shouldStickToThreadBottomRef.current) {
      return;
    }
    const frame = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(() => {
          viewport.scrollTop = viewport.scrollHeight;
        })
      : globalThis.setTimeout(() => {
          viewport.scrollTop = viewport.scrollHeight;
        }, 16) as unknown as number;
    return () => {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
        return;
      }
      globalThis.clearTimeout(frame as unknown as ReturnType<typeof setTimeout>);
    };
  }, [
    activeThreadId,
    optimisticUserMessages,
    pendingInteractions,
    renderRows,
    sortedMessages,
    streamingAssistantText,
    typewriterText,
  ]);

  return {
    threadViewportRef,
    messageMetadata,
    renderRows,
    virtualRows,
    topSpacerHeight,
    bottomSpacerHeight,
    measureThreadRow,
  };
};
