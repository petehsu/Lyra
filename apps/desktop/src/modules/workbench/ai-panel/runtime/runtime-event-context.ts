import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";

import type {
  AgentPendingInteraction,
  AgentRuntimeEvent,
} from "../../../../shared/desktop-bridge";
import type { FileEditorRevealLocation } from "../../file-editor";
import type { AiPanelSurfaceProps } from "../types";
import type {
  InteractionTextBundle,
  PendingInteractionPanel,
} from "../interaction/pending-interaction-mappers";
import type {
  AgentRuntimeFeedItem,
  ToolNameLabelMap,
} from "./feed-utils";
import type { OptimisticUserMessage } from "../view-helpers";

export const RUNTIME_FEED_ITEM_LIMIT = 48;

export type HandleAiPanelRuntimeEventParams = {
  readonly event: AgentRuntimeEvent;
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
  readonly onWriteStreamEvent?: AiPanelSurfaceProps["onWriteStreamEvent"];
  readonly onTerminalExecStarted?: AiPanelSurfaceProps["onTerminalExecStarted"];
  readonly openRuntimeTargetPath: (
    path: string,
    options?: {
      readonly forceReloadIfOpen?: boolean;
      readonly allowMissing?: boolean;
      readonly location?: FileEditorRevealLocation;
    }
  ) => Promise<void>;
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly loadSessions: () => Promise<void>;
};

export type RuntimeEventProcessingContext = HandleAiPanelRuntimeEventParams & {
  readonly payload: Record<string, unknown>;
  readonly progress: Record<string, unknown> | null;
};
