import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";

import type { PlanInteractionResponse } from "../../../shared/desktop-bridge";
import type { createTranslator, WorkbenchLocale } from "../i18n";
import { subscribeThreadSelected } from "../thread-selection-events";
import type { AgentPermissionMode } from "./agent-composer";
import {
  toPersistedRuntimeFeedItem,
  type ToolNameLabelMap
} from "./runtime/feed-utils";
import {
  createComposerReserveStyle,
  createInteractionTextLabels,
  createRequestPayload,
  createRuntimeModelOptions,
  createRuntimeTurnOptions,
  createToolNameLabels,
  isAiRuntimeBusy,
  resolveBoundProjectRoot,
  resolveSelectedRuntimeModelOption,
  shouldShowEmptySessionScene,
  type RuntimeModelOption
} from "./surface-model";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelThreadViewModel } from "./use-ai-panel-thread-view-model";
import {
  useLyraThreadRuntime,
  type LyraThreadRuntimeActions,
  type LyraThreadRuntimeState,
  type RuntimeThreadOptions
} from "./use-lyra-thread-runtime";
import { useTypewriter } from "./use-typewriter";

type Translator = ReturnType<typeof createTranslator>;

type OpenRuntimeTargetPath = (
  path: string,
  options?: {
    readonly forceReloadIfOpen?: boolean;
    readonly allowMissing?: boolean;
    readonly location?: { readonly line: number };
  }
) => Promise<void>;

type ComposerAppendRequest = {
  readonly id: number;
  readonly text: string;
};

type UseAiPanelSurfaceRuntimeInput = {
  readonly desktopApi: AiPanelSurfaceProps["desktopApi"];
  readonly locale: WorkbenchLocale;
  readonly t: Translator;
  readonly defaultProfileId?: string | null | undefined;
  readonly defaultProviderId?: string | null | undefined;
  readonly defaultModelNames: readonly string[];
  readonly configuredProfiles: NonNullable<AiPanelSurfaceProps["configuredProfiles"]>;
  readonly stopBehavior: NonNullable<AiPanelSurfaceProps["stopBehavior"]>;
  readonly runtimeQueuedLabel: string;
  readonly runtimeStartedLabel: string;
  readonly runtimeFailedTurnLabel: string;
  readonly runtimeCompletedTurnLabel: string;
  readonly runtimePhaseToolStartedLabel: string;
  readonly runtimePhaseToolFinishedLabel: string;
  readonly runtimeToolFallbackLabel: string;
  readonly toolNameSearchLabel: string;
  readonly toolNameReadRangeLabel: string;
  readonly toolNameListLabel: string;
  readonly toolNameGlobLabel: string;
  readonly toolNameWriteLabel: string;
  readonly toolNameEditLabel: string;
  readonly toolNameMultiEditLabel: string;
  readonly onOpenFilePath?: AiPanelSurfaceProps["onOpenFilePath"] | undefined;
  readonly onRequestProjectBind?: AiPanelSurfaceProps["onRequestProjectBind"] | undefined;
};

export type AiPanelSurfaceRuntimeActions = {
  readonly activateThreadTab: LyraThreadRuntimeActions["activateThreadTab"];
  readonly closeThreadTab: LyraThreadRuntimeActions["closeThreadTab"];
  readonly setActiveInteractionId: LyraThreadRuntimeActions["setActiveInteractionId"];
  readonly respondToCommandApproval: LyraThreadRuntimeActions["respondToCommandApproval"];
  readonly respondToPlanQuestion: LyraThreadRuntimeActions["respondToPlanQuestion"];
  readonly setSelectedModelOptionValue: Dispatch<SetStateAction<string>>;
  readonly setPermissionMode: Dispatch<SetStateAction<AgentPermissionMode>>;
  readonly setComposerHeight: Dispatch<SetStateAction<number>>;
  readonly setIsPermissionsPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly createThread: () => void;
  readonly bindProject: () => Promise<void>;
  readonly startReview: () => Promise<void>;
  readonly togglePlanMode: () => void;
  readonly interruptTurn: () => void;
  readonly sendTurn: (inputText: string) => Promise<void>;
  readonly steerActiveTurn: (inputText: string) => Promise<void>;
  readonly forkTurn: (turnId: string) => Promise<void>;
  readonly regenerateTurn: (turnId: string) => void;
  readonly editMessageTurn: (turnId: string, content: string) => void;
  readonly planApprovalDecision: (response: PlanInteractionResponse) => Promise<void>;
};

export type AiPanelSurfaceRuntime = {
  readonly state: LyraThreadRuntimeState;
  readonly viewModel: ReturnType<typeof useAiPanelThreadViewModel>;
  readonly actions: AiPanelSurfaceRuntimeActions;
  readonly threadViewportRef: RefObject<HTMLDivElement>;
  readonly interactionPanelRef: RefObject<HTMLDivElement>;
  readonly composerAppendRequest: ComposerAppendRequest | null;
  readonly composerReserveStyle: CSSProperties;
  readonly modelOptions: readonly RuntimeModelOption[];
  readonly selectedModelOption: RuntimeModelOption | null;
  readonly permissionMode: AgentPermissionMode;
  readonly toolNameLabels: ToolNameLabelMap;
  readonly typewriterText: string;
  readonly boundProjectRootForActiveThread: string | null;
  readonly isBindingProject: boolean;
  readonly isPermissionsPanelOpen: boolean;
  readonly showEmptySessionScene: boolean;
  readonly isBusy: boolean;
  readonly isAgentAvailable: boolean;
  readonly canOpenFilePath: boolean;
  readonly openRuntimeTargetPath: OpenRuntimeTargetPath;
};

export const useAiPanelSurfaceRuntime = ({
  desktopApi,
  locale: _locale,
  t,
  stopBehavior,
  defaultProfileId,
  defaultProviderId,
  defaultModelNames,
  configuredProfiles,
  runtimeQueuedLabel,
  runtimeStartedLabel,
  runtimeFailedTurnLabel,
  runtimeCompletedTurnLabel,
  runtimePhaseToolStartedLabel,
  runtimePhaseToolFinishedLabel,
  runtimeToolFallbackLabel,
  toolNameSearchLabel,
  toolNameReadRangeLabel,
  toolNameListLabel,
  toolNameGlobLabel,
  toolNameWriteLabel,
  toolNameEditLabel,
  toolNameMultiEditLabel,
  onOpenFilePath,
  onRequestProjectBind
}: UseAiPanelSurfaceRuntimeInput): AiPanelSurfaceRuntime => {
  const lyraApi = desktopApi?.lyra;
  const [selectedModelOptionValue, setSelectedModelOptionValue] = useState("");
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("default");
  const [composerHeight, setComposerHeight] = useState(96);
  const [composerAppendRequest, setComposerAppendRequest] =
    useState<ComposerAppendRequest | null>(null);
  const [boundProjectRootByThread, setBoundProjectRootByThread] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [pendingBoundProjectRoot, setPendingBoundProjectRoot] = useState<string | null>(null);
  const [isBindingProject, setIsBindingProject] = useState(false);
  const [isPermissionsPanelOpen, setIsPermissionsPanelOpen] = useState(false);
  const composerAppendRequestIdRef = useRef(0);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);

  const interactionTextLabels = useMemo(() => createInteractionTextLabels(t), [t]);

  const { state, actions } = useLyraThreadRuntime({
    desktopApi,
    interactionTextLabels
  });
  const {
    forkThreadFromTurn,
    interruptTurn,
    cleanBackgroundTerminals,
    loadThread,
    rollbackThread,
    respondToCommandApproval,
    respondToPlanQuestion,
    selectThread,
    activateThreadTab,
    closeThreadTab,
    sendTurn: sendRuntimeTurn,
    setActiveInteractionId,
    setPlanModeEnabled,
    startReview,
    steerTurn
  } = actions;

  const activeThreadId = state.activeThreadId;
  const boundProjectRootForActiveThread = useMemo(
    () => resolveBoundProjectRoot({
      activeThreadId,
      mappedRoots: boundProjectRootByThread,
      pendingRoot: pendingBoundProjectRoot,
      activeThread: state.activeThread
    }),
    [activeThreadId, boundProjectRootByThread, pendingBoundProjectRoot, state.activeThread]
  );

  const toolNameLabels = useMemo<ToolNameLabelMap>(
    () => createToolNameLabels({
      t,
      toolNameSearchLabel,
      toolNameReadRangeLabel,
      toolNameListLabel,
      toolNameGlobLabel,
      toolNameWriteLabel,
      toolNameEditLabel,
      toolNameMultiEditLabel
    }),
    [
      t,
      toolNameEditLabel,
      toolNameGlobLabel,
      toolNameListLabel,
      toolNameMultiEditLabel,
      toolNameReadRangeLabel,
      toolNameSearchLabel,
      toolNameWriteLabel
    ]
  );

  const modelOptions = useMemo<readonly RuntimeModelOption[]>(
    () => createRuntimeModelOptions({
      configuredProfiles,
      defaultModelNames,
      defaultProfileId,
      defaultProviderId
    }),
    [configuredProfiles, defaultModelNames, defaultProfileId, defaultProviderId]
  );

  const selectedModelOption = useMemo(
    () => resolveSelectedRuntimeModelOption(modelOptions, selectedModelOptionValue),
    [modelOptions, selectedModelOptionValue]
  );

  const liveRuntimeFeed = useMemo(
    () =>
      state.liveToolCalls.map((call) =>
        toPersistedRuntimeFeedItem(call, toolNameLabels, runtimeToolFallbackLabel)
      ),
    [runtimeToolFallbackLabel, state.liveToolCalls, toolNameLabels]
  );

  const typewriterText = useTypewriter(
    state.streamingAssistantText,
    state.isStreamActive,
    {
      charsPerSecond: 72,
      minChunkSize: 4,
      resetKey: state.streamingTurnId
    }
  );

  const viewModel = useAiPanelThreadViewModel({
    activeDetail: state.activeDetail,
    optimisticUserMessages: state.optimisticUserMessages,
    runtimeFeed: liveRuntimeFeed,
    streamingTurnId: state.streamingTurnId,
    latestRuntimeEventByTurn: state.latestRuntimeEventByTurn,
    activeInteractionPanel: state.activeInteractionPanel,
    isInteractionSubmitting: state.isInteractionSubmitting,
    isSending: state.isSending,
    isStreamActive: state.isStreamActive,
    streamingAssistantText: state.streamingAssistantText,
    finalizingTurnId: state.finalizingTurnId,
    toolNameLabels,
    runtimeToolFallbackLabel,
    labels: {
      runtimeQueued: runtimeQueuedLabel,
      runtimeStarted: runtimeStartedLabel,
      runtimeCompletedTurn: runtimeCompletedTurnLabel,
      runtimeFailedTurn: runtimeFailedTurnLabel,
      runtimePhaseToolStarted: runtimePhaseToolStartedLabel,
      runtimePhaseToolFinished: runtimePhaseToolFinishedLabel,
      generatingReply: t("ai.generatingReply"),
      pendingInteractions: t("ai.pendingInteractions")
    }
  });

  useEffect(() => {
    setSelectedModelOptionValue((current) =>
      modelOptions.some((option) => option.value === current)
        ? current
        : (modelOptions[0]?.value ?? "")
    );
  }, [modelOptions]);

  useEffect(() => {
    return subscribeThreadSelected((threadId) => {
      selectThread(threadId);
    });
  }, [selectThread]);

  const persistBoundProjectRoot = useCallback(
    async (threadId: string, projectRoot: string): Promise<void> => {
      const trimmed = projectRoot.trim();
      if (lyraApi === undefined || trimmed.length === 0) {
        return;
      }
      await lyraApi.request(
        createRequestPayload("thread/metadata/update", {
          threadId,
          boundProjectRoot: trimmed
        })
      );
      await loadThread(threadId);
    },
    [loadThread, lyraApi]
  );

  useEffect(() => {
    if (activeThreadId === null || pendingBoundProjectRoot === null) {
      return;
    }
    const trimmed = pendingBoundProjectRoot.trim();
    if (trimmed.length === 0) {
      setPendingBoundProjectRoot(null);
      return;
    }
    setBoundProjectRootByThread((current) => {
      if (current.get(activeThreadId) === trimmed) {
        return current;
      }
      const next = new Map(current);
      next.set(activeThreadId, trimmed);
      return next;
    });
    setPendingBoundProjectRoot(null);
    void persistBoundProjectRoot(activeThreadId, trimmed).catch((error: unknown) => {
      console.error("Failed to persist bound project root", error);
    });
  }, [activeThreadId, pendingBoundProjectRoot, persistBoundProjectRoot]);

  useEffect(() => {
    const viewport = threadViewportRef.current;
    if (viewport === null) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [
    state.activeDetail,
    state.optimisticUserMessages,
    state.pendingInteractions,
    state.streamingAssistantText,
    viewModel.sortedMessages
  ]);

  const openRuntimeTargetPath = useCallback<OpenRuntimeTargetPath>(
    async (path, options): Promise<void> => {
      onOpenFilePath?.(path, options);
    },
    [onOpenFilePath]
  );

  const handleBindProject = useCallback(async (): Promise<void> => {
    if (onRequestProjectBind === undefined || isBindingProject) {
      return;
    }
    setIsBindingProject(true);
    try {
      const nextPath = await onRequestProjectBind(boundProjectRootForActiveThread ?? undefined);
      if (typeof nextPath !== "string") {
        return;
      }
      const trimmed = nextPath.trim();
      if (trimmed.length === 0) {
        return;
      }
      if (activeThreadId === null) {
        setPendingBoundProjectRoot(trimmed);
        return;
      }
      setBoundProjectRootByThread((current) => {
        const next = new Map(current);
        next.set(activeThreadId, trimmed);
        return next;
      });
      await persistBoundProjectRoot(activeThreadId, trimmed);
    } finally {
      setIsBindingProject(false);
    }
  }, [
    activeThreadId,
    boundProjectRootForActiveThread,
    isBindingProject,
    onRequestProjectBind,
    persistBoundProjectRoot
  ]);

  const runtimeTurnOptions = useCallback((collaborationMode?: RuntimeThreadOptions["collaborationMode"]) =>
    createRuntimeTurnOptions({
      selectedModelOption,
      defaultProviderId,
      boundProjectRoot: boundProjectRootForActiveThread,
      permissionMode,
      collaborationMode
    }), [
    boundProjectRootForActiveThread,
    defaultProviderId,
    permissionMode,
    selectedModelOption
  ]);

  const sendTurn = useCallback(async (inputText: string): Promise<void> => {
    const text = inputText.trim();
    if (text.length === 0) {
      return;
    }
    const slashCommand = text.toLowerCase();
    if (slashCommand === "/approvals" || slashCommand === "/permissions") {
      setIsPermissionsPanelOpen(true);
      return;
    }
    await sendRuntimeTurn(
      text,
      runtimeTurnOptions(state.planModeEnabled ? "plan" : "default")
    );
  }, [
    runtimeTurnOptions,
    sendRuntimeTurn,
    state.planModeEnabled
  ]);

  const steerActiveTurn = useCallback(async (inputText: string): Promise<void> => {
    const text = inputText.trim();
    if (text.length === 0) {
      return;
    }
    await steerTurn(text);
  }, [steerTurn]);

  const handlePlanModeToggle = useCallback((): void => {
    setPlanModeEnabled(!state.planModeEnabled);
  }, [setPlanModeEnabled, state.planModeEnabled]);

  const handleInterruptTurn = useCallback((): void => {
    void (async () => {
      await interruptTurn();
      if (stopBehavior === "turn_and_background") {
        await cleanBackgroundTerminals();
      }
    })();
  }, [cleanBackgroundTerminals, interruptTurn, stopBehavior]);

  const createThread = useCallback((): void => {
    setPendingBoundProjectRoot(null);
    selectThread(null);
  }, [selectThread]);

  const appendToComposer = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    composerAppendRequestIdRef.current += 1;
    setComposerAppendRequest({
      id: composerAppendRequestIdRef.current,
      text: trimmed
    });
  }, []);

  const handlePlanApprovalDecision = useCallback(async (
    response: PlanInteractionResponse
  ): Promise<void> => {
    const feedback = response.feedback?.trim() ?? "";
    if (response.decision === "approve_and_implement") {
      setPlanModeEnabled(false);
      await sendRuntimeTurn(
        feedback.length === 0
          ? t("ai.planExecutePrompt")
          : `${t("ai.planExecutePrompt")}\n\n${feedback}`,
        runtimeTurnOptions("default")
      );
      return;
    }
    if (response.decision === "keep_planning") {
      setPlanModeEnabled(true);
      await sendRuntimeTurn(
        feedback.length === 0
          ? t("ai.planKeepPlanningPrompt")
          : `${t("ai.planKeepPlanningPrompt")}\n\n${feedback}`,
        runtimeTurnOptions("plan")
      );
      return;
    }
    if (feedback.length > 0) {
      setPlanModeEnabled(true);
      await sendRuntimeTurn(
        `${t("ai.planRejectPrompt")}\n\n${feedback}`,
        runtimeTurnOptions("plan")
      );
      return;
    }
    setPlanModeEnabled(false);
  }, [runtimeTurnOptions, sendRuntimeTurn, setPlanModeEnabled, t]);

  const handleForkTurn = useCallback(async (turnId: string): Promise<void> => {
    const activeThread = state.activeThread;
    if (activeThread === null) {
      return;
    }
    const turnIndex = activeThread.turns.findIndex((turn) => turn.id === turnId);
    if (turnIndex < 0) {
      return;
    }
    try {
      const forkedThreadId = await forkThreadFromTurn(
        turnId,
        activeThread.turns.length - turnIndex - 1,
        runtimeTurnOptions()
      );
      if (boundProjectRootForActiveThread !== null) {
        setBoundProjectRootByThread((current) => {
          const next = new Map(current);
          next.set(forkedThreadId, boundProjectRootForActiveThread);
          return next;
        });
        await persistBoundProjectRoot(forkedThreadId, boundProjectRootForActiveThread);
      }
    } catch {
      // Runtime hook owns the visible error state.
    }
  }, [
    boundProjectRootForActiveThread,
    forkThreadFromTurn,
    persistBoundProjectRoot,
    runtimeTurnOptions,
    state.activeThread
  ]);

  const handleStartReview = useCallback(async (): Promise<void> => {
    try {
      await startReview();
    } catch {
      // Runtime hook owns the visible error state.
    }
  }, [startReview]);

  const handleEditMessageTurn = useCallback((turnId: string, content: string): void => {
    void (async () => {
      try {
        const restoredInput = await rollbackThread(turnId);
        appendToComposer(restoredInput ?? content);
      } catch {
        // Runtime hook owns the visible error state.
      }
    })();
  }, [appendToComposer, rollbackThread]);

  const handleRegenerateTurn = useCallback((turnId: string): void => {
    const sourceUserMessage = viewModel.sortedMessages.find(
      (message) => message.role === "user"
        && "turnId" in message
        && message.turnId === turnId
    );
    const fallbackInput = sourceUserMessage?.content ?? "";
    void (async () => {
      try {
        const restoredInput = await rollbackThread(turnId);
        await sendTurn(restoredInput ?? fallbackInput);
      } catch {
        // Runtime hook owns the visible error state.
      }
    })();
  }, [rollbackThread, sendTurn, viewModel.sortedMessages]);

  const showEmptySessionScene = shouldShowEmptySessionScene({
    messageCount: state.activeDetail?.messages.length ?? 0,
    optimisticMessageCount: state.optimisticUserMessages.length,
    streamingAssistantText: state.streamingAssistantText,
    isStreamActive: state.isStreamActive
  });
  const isBusy = isAiRuntimeBusy({
    isSending: state.isSending,
    isStreamActive: state.isStreamActive
  });
  const composerReserveStyle = useMemo(
    () => createComposerReserveStyle(composerHeight) as CSSProperties,
    [composerHeight]
  );
  const isAgentAvailable = desktopApi?.lyra !== null && desktopApi?.lyra !== undefined;

  return {
    state,
    viewModel,
    actions: {
      activateThreadTab,
      closeThreadTab,
      setActiveInteractionId,
      respondToCommandApproval,
      respondToPlanQuestion,
      setSelectedModelOptionValue,
      setPermissionMode,
      setComposerHeight,
      setIsPermissionsPanelOpen,
      createThread,
      bindProject: handleBindProject,
      startReview: handleStartReview,
      togglePlanMode: handlePlanModeToggle,
      interruptTurn: handleInterruptTurn,
      sendTurn,
      steerActiveTurn,
      forkTurn: handleForkTurn,
      regenerateTurn: handleRegenerateTurn,
      editMessageTurn: handleEditMessageTurn,
      planApprovalDecision: handlePlanApprovalDecision
    },
    threadViewportRef,
    interactionPanelRef,
    composerAppendRequest,
    composerReserveStyle,
    modelOptions,
    selectedModelOption,
    permissionMode,
    toolNameLabels,
    typewriterText,
    boundProjectRootForActiveThread,
    isBindingProject,
    isPermissionsPanelOpen,
    showEmptySessionScene,
    isBusy,
    isAgentAvailable,
    canOpenFilePath: onOpenFilePath !== undefined,
    openRuntimeTargetPath
  };
};
