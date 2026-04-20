import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";

import type { AgentApi, LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  AgentPendingInteraction,
  AgentRuntimeEvent,
} from "../../../shared/desktop-bridge";
import {
  type InteractionTextBundle,
  type PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";
import {
  type AgentRuntimeFeedItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import {
  type OptimisticUserMessage,
} from "./view-helpers";
import type { AiPanelSurfaceProps } from "./types";
import type { FileEditorRevealLocation } from "../file-editor";
import { handleAiPanelRuntimeEvent } from "./runtime/runtime-event-handler";

type UseAiPanelRuntimeEventsParams = {
  readonly agentApi: AgentApi | undefined;
  readonly desktopApi: LyraDesktopApi | null;
  readonly onOpenFilePath?: AiPanelSurfaceProps["onOpenFilePath"];
  readonly onWriteStreamEvent?: AiPanelSurfaceProps["onWriteStreamEvent"];
  readonly onTerminalExecStarted?: AiPanelSurfaceProps["onTerminalExecStarted"];
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly loadSessions: () => Promise<void>;
  readonly replacePendingInteractions: (
    sessionId: string,
    interactions: readonly AgentPendingInteraction[]
  ) => void;
  readonly mergePendingInteractionsForSession: (
    sessionId: string,
    interactions: readonly AgentPendingInteraction[]
  ) => void;
  readonly livePendingInteractionsRef: MutableRefObject<Readonly<Record<string, readonly AgentPendingInteraction[]>>>;
  readonly activeSessionIdRef: MutableRefObject<string | null>;
  readonly interactionTextLabels: InteractionTextBundle;
  readonly runtimeToolFallbackLabel: string;
  readonly toolNameLabels: ToolNameLabelMap;
  readonly setLatestRuntimeEventByTurn: Dispatch<SetStateAction<Readonly<Record<string, AgentRuntimeEvent>>>>;
  readonly setFinalizingTurnId: Dispatch<SetStateAction<string | null>>;
  readonly streamingTurnIdRef: MutableRefObject<string | null>;
  readonly setStreamingAssistantText: Dispatch<SetStateAction<string>>;
  readonly setIsStreamActive: Dispatch<SetStateAction<boolean>>;
  readonly setStreamingTurnId: Dispatch<SetStateAction<string | null>>;
  readonly setRuntimeError: Dispatch<SetStateAction<string | null>>;
  readonly setRuntimeFeed: Dispatch<SetStateAction<readonly AgentRuntimeFeedItem[]>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
  readonly setIsInteractionSubmitting: Dispatch<SetStateAction<boolean>>;
  readonly setTransientInteractionPanel: Dispatch<SetStateAction<PendingInteractionPanel | null>>;
  readonly setActiveInteractionId: Dispatch<SetStateAction<string | null>>;
  readonly setOptimisticUserMessages: Dispatch<SetStateAction<readonly OptimisticUserMessage[]>>;
};

export const useAiPanelRuntimeEvents = ({
  agentApi,
  desktopApi,
  onOpenFilePath,
  onWriteStreamEvent,
  onTerminalExecStarted,
  loadSessionDetail,
  loadSessions,
  replacePendingInteractions,
  mergePendingInteractionsForSession,
  livePendingInteractionsRef,
  activeSessionIdRef,
  interactionTextLabels,
  runtimeToolFallbackLabel,
  toolNameLabels,
  setLatestRuntimeEventByTurn,
  setFinalizingTurnId,
  streamingTurnIdRef,
  setStreamingAssistantText,
  setIsStreamActive,
  setStreamingTurnId,
  setRuntimeError,
  setRuntimeFeed,
  setIsSending,
  setIsInteractionSubmitting,
  setTransientInteractionPanel,
  setActiveInteractionId,
  setOptimisticUserMessages,
}: UseAiPanelRuntimeEventsParams) => {
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
      handleAiPanelRuntimeEvent({
        event,
        replacePendingInteractions,
        mergePendingInteractionsForSession,
        livePendingInteractionsRef,
        activeSessionIdRef,
        interactionTextLabels,
        runtimeToolFallbackLabel,
        toolNameLabels,
        setLatestRuntimeEventByTurn,
        setFinalizingTurnId,
        streamingTurnIdRef,
        setStreamingAssistantText,
        setIsStreamActive,
        setStreamingTurnId,
        setRuntimeError,
        setRuntimeFeed,
        setIsSending,
        setIsInteractionSubmitting,
        setTransientInteractionPanel,
        setActiveInteractionId,
        setOptimisticUserMessages,
        ...(onWriteStreamEvent === undefined ? {} : { onWriteStreamEvent }),
        ...(onTerminalExecStarted === undefined ? {} : { onTerminalExecStarted }),
        openRuntimeTargetPath,
        loadSessionDetail,
        loadSessions,
      });
    });
  }, [
    activeSessionIdRef,
    agentApi,
    interactionTextLabels,
    livePendingInteractionsRef,
    loadSessionDetail,
    loadSessions,
    mergePendingInteractionsForSession,
    onTerminalExecStarted,
    onWriteStreamEvent,
    openRuntimeTargetPath,
    replacePendingInteractions,
    runtimeToolFallbackLabel,
    setActiveInteractionId,
    setFinalizingTurnId,
    setIsInteractionSubmitting,
    setIsSending,
    setIsStreamActive,
    setLatestRuntimeEventByTurn,
    setOptimisticUserMessages,
    setRuntimeError,
    setRuntimeFeed,
    setStreamingAssistantText,
    setStreamingTurnId,
    setTransientInteractionPanel,
    streamingTurnIdRef,
    toolNameLabels,
  ]);

  return {
    openRuntimeTargetPath,
  };
};
