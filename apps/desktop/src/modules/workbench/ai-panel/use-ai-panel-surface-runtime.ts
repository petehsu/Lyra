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
import type { createTranslator, I18nKey, WorkbenchLocale } from "../i18n";
import { subscribeThreadSelected } from "../thread-selection-events";
import type {
  AgentComposerModelControlOption,
  AgentComposerReasoningEffort,
  AgentComposerSubmitPayload,
  AgentComposerVerbosity,
  AgentPermissionMode
} from "./agent-composer";
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
  type ReviewTarget,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readFuzzyFileSearchResult = (value: unknown): FuzzyFileSearchResult | null => {
  if (!isRecord(value)) {
    return null;
  }
  const path = readString(value.path);
  const name = readString(value.file_name) ?? readString(value.fileName) ?? readString(value.name);
  const matchType = readString(value.match_type) ?? readString(value.matchType);
  if (path === null || name === null) {
    return null;
  }
  const kind = matchType === "directory" ? "directory" : "file";
  const indices = Array.isArray(value.indices)
    ? value.indices.filter((entry): entry is number => typeof entry === "number")
    : null;
  return {
    id: `${kind}:${path}`,
    name,
    path,
    kind,
    ...(readString(value.root) === null ? {} : { root: readString(value.root)! }),
    ...(readNumber(value.score) === null ? {} : { score: readNumber(value.score)! }),
    indices,
  };
};

const runtimeAttachmentFromComposer = (
  attachment: AgentComposerSubmitPayload["attachments"][number]
) => ({
  name: attachment.name,
  path: attachment.path,
  kind: attachment.kind,
});

const runtimeInputFromComposerPayload = (payload: AgentComposerSubmitPayload) => ({
  text: payload.text.trim(),
  attachments: payload.attachments.map(runtimeAttachmentFromComposer),
  parts: payload.parts.map((part) => part.type === "text"
    ? { type: "text" as const, text: part.text }
    : {
        type: "attachment" as const,
        attachment: runtimeAttachmentFromComposer(part.attachment),
      }),
});

type ComposerAppendRequest = {
  readonly id: number;
  readonly text: string;
};

type FuzzyFileSearchResult = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly root?: string;
  readonly score?: number;
  readonly indices?: readonly number[] | null;
};

const REASONING_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const satisfies readonly AgentComposerReasoningEffort[];

const VERBOSITY_VALUES = [
  "low",
  "medium",
  "high"
] as const satisfies readonly AgentComposerVerbosity[];

const reasoningEffortLabelKey = (
  value: AgentComposerReasoningEffort
): I18nKey => {
  switch (value) {
    case "none":
      return "ai.reasoningEffortNone";
    case "minimal":
      return "ai.reasoningEffortMinimal";
    case "low":
      return "ai.reasoningEffortLow";
    case "medium":
      return "ai.reasoningEffortMedium";
    case "high":
      return "ai.reasoningEffortHigh";
    case "xhigh":
      return "ai.reasoningEffortXHigh";
  }
};

const verbosityLabelKey = (value: AgentComposerVerbosity): I18nKey => {
  switch (value) {
    case "low":
      return "ai.verbosityLow";
    case "medium":
      return "ai.verbosityMedium";
    case "high":
      return "ai.verbosityHigh";
  }
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
  readonly fileMentionFallbackRoots?: readonly string[] | undefined;
  readonly onOpenFilePath?: AiPanelSurfaceProps["onOpenFilePath"] | undefined;
  readonly onRequestProjectBind?: AiPanelSurfaceProps["onRequestProjectBind"] | undefined;
};

export type AiPanelSurfaceRuntimeActions = {
  readonly activateThreadTab: LyraThreadRuntimeActions["activateThreadTab"];
  readonly closeThreadTab: LyraThreadRuntimeActions["closeThreadTab"];
  readonly openThreadTab: LyraThreadRuntimeActions["openThreadTab"];
  readonly setActiveInteractionId: LyraThreadRuntimeActions["setActiveInteractionId"];
  readonly respondToCommandApproval: LyraThreadRuntimeActions["respondToCommandApproval"];
  readonly respondToPlanQuestion: LyraThreadRuntimeActions["respondToPlanQuestion"];
  readonly setSelectedModelOptionValue: Dispatch<SetStateAction<string>>;
  readonly setSelectedReasoningEffort: Dispatch<SetStateAction<RuntimeThreadOptions["effort"] | null>>;
  readonly setSelectedVerbosity: Dispatch<SetStateAction<RuntimeThreadOptions["verbosity"] | null>>;
  readonly setPermissionMode: Dispatch<SetStateAction<AgentPermissionMode>>;
  readonly setComposerHeight: Dispatch<SetStateAction<number>>;
  readonly setIsPermissionsPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly createThread: () => void;
  readonly bindProject: () => Promise<void>;
  readonly startReview: (target: ReviewTarget) => Promise<void>;
  readonly togglePlanMode: () => void;
  readonly toggleFollow: () => void;
  readonly enableFollow: () => void;
  readonly interruptTurn: () => void;
  readonly sendTurn: (payload: AgentComposerSubmitPayload) => Promise<void>;
  readonly steerActiveTurn: (payload: AgentComposerSubmitPayload) => Promise<void>;
  readonly startFileMentionSearch: (sessionId: string, roots: readonly string[]) => Promise<void>;
  readonly updateFileMentionSearch: (sessionId: string, query: string) => Promise<void>;
  readonly stopFileMentionSearch: (sessionId: string) => Promise<void>;
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
  readonly reasoningEffortOptions: readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[];
  readonly selectedReasoningEffort: RuntimeThreadOptions["effort"] | null;
  readonly verbosityOptions: readonly AgentComposerModelControlOption<AgentComposerVerbosity>[];
  readonly selectedVerbosity: RuntimeThreadOptions["verbosity"] | null;
  readonly fileMentionSearchRoots: readonly string[];
  readonly fileMentionSearchResults: readonly FuzzyFileSearchResult[];
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
  fileMentionFallbackRoots,
  onOpenFilePath,
  onRequestProjectBind
}: UseAiPanelSurfaceRuntimeInput): AiPanelSurfaceRuntime => {
  const lyraApi = desktopApi?.lyra;
  const [selectedModelOptionValue, setSelectedModelOptionValue] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState<RuntimeThreadOptions["effort"] | null>(null);
  const [selectedVerbosity, setSelectedVerbosity] =
    useState<RuntimeThreadOptions["verbosity"] | null>(null);
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
  const [fileMentionSearchResults, setFileMentionSearchResults] =
    useState<readonly FuzzyFileSearchResult[]>([]);
  const composerAppendRequestIdRef = useRef(0);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);

  const interactionTextLabels = useMemo(() => createInteractionTextLabels(t), [t]);

  const { state, actions } = useLyraThreadRuntime({
    desktopApi,
    interactionTextLabels,
    ...(onOpenFilePath === undefined ? {} : { onFollowOpenFilePath: onOpenFilePath })
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
    openThreadTab,
    sendTurn: sendRuntimeTurn,
    setActiveInteractionId,
    setFollowEnabled,
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
  const fileMentionSearchRoots = useMemo(
    () => {
      const roots = boundProjectRootForActiveThread === null
        ? (fileMentionFallbackRoots ?? [])
        : [boundProjectRootForActiveThread];
      return roots
        .map((root) => root.trim())
        .filter((root, index, values) => root.length > 0 && values.indexOf(root) === index);
    },
    [boundProjectRootForActiveThread, fileMentionFallbackRoots]
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

  const modelMetadata = selectedModelOption?.runtimeMetadata;
  const reasoningControlDisabledReason =
    selectedModelOption === null
      ? t("ai.modelControlNoMetadata")
      : modelMetadata === undefined
        ? t("ai.modelControlNoMetadata")
        : modelMetadata.supportsReasoningSummaries === true
          ? null
          : t("ai.modelControlUnsupported");
  const verbosityControlDisabledReason =
    selectedModelOption === null
      ? t("ai.modelControlNoMetadata")
      : modelMetadata === undefined
        ? t("ai.modelControlNoMetadata")
        : modelMetadata.supportVerbosity === true
          ? null
          : t("ai.modelControlUnsupported");
  const reasoningEffortOptions = useMemo<
    readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[]
  >(
    () => REASONING_EFFORT_VALUES.map((value) => ({
      value,
      label: t(reasoningEffortLabelKey(value)),
      ...(reasoningControlDisabledReason === null
        ? {}
        : {
            disabled: true,
            disabledReason: reasoningControlDisabledReason,
          }),
    })),
    [reasoningControlDisabledReason, t]
  );
  const verbosityOptions = useMemo<
    readonly AgentComposerModelControlOption<AgentComposerVerbosity>[]
  >(
    () => VERBOSITY_VALUES.map((value) => ({
      value,
      label: t(verbosityLabelKey(value)),
      ...(verbosityControlDisabledReason === null
        ? {}
        : {
            disabled: true,
            disabledReason: verbosityControlDisabledReason,
          }),
    })),
    [t, verbosityControlDisabledReason]
  );

  useEffect(() => {
    if (reasoningControlDisabledReason !== null && selectedReasoningEffort !== null) {
      setSelectedReasoningEffort(null);
    }
    if (verbosityControlDisabledReason !== null && selectedVerbosity !== null) {
      setSelectedVerbosity(null);
    }
  }, [
    reasoningControlDisabledReason,
    selectedReasoningEffort,
    selectedVerbosity,
    verbosityControlDisabledReason
  ]);

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

  useEffect(() => {
    if (lyraApi === undefined) {
      return;
    }
    return lyraApi.onEvent((event) => {
      if (event.kind !== "notification" || !isRecord(event.notification)) {
        return;
      }
      const method = readString(event.notification.method);
      const params = isRecord(event.notification.params) ? event.notification.params : {};
      if (method === "fuzzyFileSearch/sessionUpdated") {
        const files = Array.isArray(params.files)
          ? params.files.map(readFuzzyFileSearchResult).filter((entry): entry is FuzzyFileSearchResult => entry !== null)
          : [];
        setFileMentionSearchResults(files);
        return;
      }
      if (method === "fuzzyFileSearch/sessionCompleted") {
        setFileMentionSearchResults([]);
      }
    });
  }, [lyraApi]);

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

  const startFileMentionSearch = useCallback(async (
    sessionId: string,
    roots: readonly string[]
  ): Promise<void> => {
    if (lyraApi === undefined || roots.length === 0) {
      setFileMentionSearchResults([]);
      return;
    }
    await lyraApi.request(createRequestPayload("fuzzyFileSearch/sessionStart", {
      sessionId,
      roots,
    }));
  }, [lyraApi]);

  const updateFileMentionSearch = useCallback(async (
    sessionId: string,
    query: string
  ): Promise<void> => {
    if (lyraApi === undefined) {
      return;
    }
    await lyraApi.request(createRequestPayload("fuzzyFileSearch/sessionUpdate", {
      sessionId,
      query,
    }));
  }, [lyraApi]);

  const stopFileMentionSearch = useCallback(async (sessionId: string): Promise<void> => {
    setFileMentionSearchResults([]);
    if (lyraApi === undefined) {
      return;
    }
    await lyraApi.request(createRequestPayload("fuzzyFileSearch/sessionStop", {
      sessionId,
    }));
  }, [lyraApi]);

  const runtimeTurnOptions = useCallback((collaborationMode?: RuntimeThreadOptions["collaborationMode"]) =>
    createRuntimeTurnOptions({
      selectedModelOption,
      defaultProviderId,
      boundProjectRoot: boundProjectRootForActiveThread,
      permissionMode,
      collaborationMode,
      effort: selectedReasoningEffort,
      verbosity: selectedVerbosity
    }), [
    boundProjectRootForActiveThread,
    defaultProviderId,
    permissionMode,
    selectedModelOption,
    selectedReasoningEffort,
    selectedVerbosity
  ]);

  const sendTurn = useCallback(async (payload: AgentComposerSubmitPayload): Promise<void> => {
    const text = payload.text.trim();
    if (text.length === 0 && payload.attachments.length === 0) {
      return;
    }
    await sendRuntimeTurn(
      runtimeInputFromComposerPayload(payload),
      runtimeTurnOptions(state.planModeEnabled ? "plan" : "default")
    );
  }, [
    runtimeTurnOptions,
    sendRuntimeTurn,
    state.planModeEnabled
  ]);

  const steerActiveTurn = useCallback(async (payload: AgentComposerSubmitPayload): Promise<void> => {
    const text = payload.text.trim();
    if (text.length === 0 && payload.attachments.length === 0) {
      return;
    }
    await steerTurn(runtimeInputFromComposerPayload(payload));
  }, [steerTurn]);

  const handlePlanModeToggle = useCallback((): void => {
    setPlanModeEnabled(!state.planModeEnabled);
  }, [setPlanModeEnabled, state.planModeEnabled]);

  const handleFollowToggle = useCallback((): void => {
    setFollowEnabled(!state.followEnabled);
  }, [setFollowEnabled, state.followEnabled]);

  const enableFollow = useCallback((): void => {
    setFollowEnabled(true);
  }, [setFollowEnabled]);

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
        {
          text: feedback.length === 0
            ? t("ai.planExecutePrompt")
            : `${t("ai.planExecutePrompt")}\n\n${feedback}`,
          attachments: [],
        },
        runtimeTurnOptions("default")
      );
      return;
    }
    if (response.decision === "keep_planning") {
      setPlanModeEnabled(true);
      await sendRuntimeTurn(
        {
          text: feedback.length === 0
            ? t("ai.planKeepPlanningPrompt")
            : `${t("ai.planKeepPlanningPrompt")}\n\n${feedback}`,
          attachments: [],
        },
        runtimeTurnOptions("plan")
      );
      return;
    }
    if (feedback.length > 0) {
      setPlanModeEnabled(true);
      await sendRuntimeTurn(
        {
          text: `${t("ai.planRejectPrompt")}\n\n${feedback}`,
          attachments: [],
        },
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

  const handleStartReview = useCallback(async (target: ReviewTarget): Promise<void> => {
    try {
      await startReview(target);
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
        const text = restoredInput ?? fallbackInput;
        await sendTurn({
          text,
          attachments: [],
          parts: text.trim().length === 0 ? [] : [{ type: "text", text }],
        });
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
      openThreadTab,
      setActiveInteractionId,
      respondToCommandApproval,
      respondToPlanQuestion,
      setSelectedModelOptionValue,
      setSelectedReasoningEffort,
      setSelectedVerbosity,
      setPermissionMode,
      setComposerHeight,
      setIsPermissionsPanelOpen,
      createThread,
      bindProject: handleBindProject,
      startReview: handleStartReview,
      togglePlanMode: handlePlanModeToggle,
      toggleFollow: handleFollowToggle,
      enableFollow,
      interruptTurn: handleInterruptTurn,
      sendTurn,
      steerActiveTurn,
      startFileMentionSearch,
      updateFileMentionSearch,
      stopFileMentionSearch,
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
    reasoningEffortOptions,
    selectedReasoningEffort,
    verbosityOptions,
    selectedVerbosity,
    fileMentionSearchRoots,
    fileMentionSearchResults,
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
