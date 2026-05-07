import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction
} from "react";

import type { createTranslator, I18nKey } from "../i18n";
import {
  normalizeProjectRoot,
} from "../project-identity";
import { subscribeThreadSelected } from "../thread-selection-events";
import type { LyraThread } from "./lyra-thread-adapter";
import type {
  AgentComposerAiThreadMention,
  AgentComposerModelControlOption,
  AgentComposerReasoningEffort,
  AgentComposerSubmitPayload,
  AgentComposerVerbosity,
  AgentComposerWorkbenchTabMention
} from "./agent-composer";
import { runtimeInputFromComposerReferenceParts } from "./agent-composer-reference-parts";
import {
  createComposerReserveStyle,
  createRuntimeModelOptions,
  createRuntimeTurnOptions,
  isAiRuntimeBusy,
  resolveBoundProjectRoot,
  resolveSelectedRuntimeModelOption,
  resolveSyncedSelectedModelOptionValue,
  type RuntimeModelOption
} from "./surface-model";
import type { AiPanelSurfaceProps } from "./types";
import {
  useLyraThreadRuntime,
  type LyraThreadRuntimeActions,
  type LyraThreadRuntimeState,
  type RuntimeThreadOptions
} from "./use-lyra-thread-runtime";

type Translator = ReturnType<typeof createTranslator>;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

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

const readThreadRecentMessages = (thread: LyraThread): readonly string[] => {
  const viewModelMessages = thread.aiPanelViewModel?.messages;
  if (viewModelMessages !== undefined && viewModelMessages.length > 0) {
    return viewModelMessages
      .slice(-3)
      .map((message) => `${message.role}: ${(message.displayContent ?? message.content).trim()}`)
      .filter((message) => message.trim().length > 0);
  }
  return thread.turns
    .slice(-2)
    .flatMap((turn) => turn.items)
    .map((item) => {
      const type = readString(item.type) ?? "item";
      const text = readString(item.text) ?? readString(item.content) ?? "";
      return text.length === 0 ? type : `${type}: ${text}`;
    })
    .filter((message) => message.trim().length > 0)
    .slice(-3);
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

const REASONING_EFFORT_RANK: Record<AgentComposerReasoningEffort, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5
};

const isReasoningEffortValue = (value: unknown): value is AgentComposerReasoningEffort =>
  typeof value === "string" && (REASONING_EFFORT_VALUES as readonly string[]).includes(value);

const isVerbosityValue = (value: unknown): value is AgentComposerVerbosity =>
  typeof value === "string" && (VERBOSITY_VALUES as readonly string[]).includes(value);

const strongestReasoningEffort = (
  values: readonly AgentComposerReasoningEffort[]
): AgentComposerReasoningEffort | null =>
  values.reduce<AgentComposerReasoningEffort | null>((strongest, value) => {
    if (strongest === null) {
      return value;
    }
    return REASONING_EFFORT_RANK[value] > REASONING_EFFORT_RANK[strongest]
      ? value
      : strongest;
  }, null);

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
  readonly t: Translator;
  readonly defaultProfileId?: string | null | undefined;
  readonly defaultProviderId?: string | null | undefined;
  readonly defaultModelNames: readonly string[];
  readonly configuredProfiles: NonNullable<AiPanelSurfaceProps["configuredProfiles"]>;
  readonly stopBehavior: NonNullable<AiPanelSurfaceProps["stopBehavior"]>;
  readonly fileMentionFallbackRoots?: readonly string[] | undefined;
  readonly workbenchTabMentions?: readonly AgentComposerWorkbenchTabMention[] | undefined;
  readonly onRequestProjectBind?: AiPanelSurfaceProps["onRequestProjectBind"] | undefined;
  readonly onDefaultProfileSelect?: AiPanelSurfaceProps["onDefaultProfileSelect"] | undefined;
};

export type AiPanelSurfaceRuntimeActions = {
  readonly activateThreadTab: LyraThreadRuntimeActions["activateThreadTab"];
  readonly closeThreadTab: LyraThreadRuntimeActions["closeThreadTab"];
  readonly reorderThreadTab: LyraThreadRuntimeActions["reorderThreadTab"];
  readonly openThreadTab: LyraThreadRuntimeActions["openThreadTab"];
  readonly selectModelOptionValue: (value: string) => void;
  readonly setSelectedReasoningEffort: Dispatch<SetStateAction<RuntimeThreadOptions["effort"] | null>>;
  readonly setSelectedVerbosity: Dispatch<SetStateAction<RuntimeThreadOptions["verbosity"] | null>>;
  readonly setComposerHeight: Dispatch<SetStateAction<number>>;
  readonly createThread: () => Promise<void>;
  readonly bindProject: () => Promise<void>;
  readonly togglePlanMode: () => void;
  readonly toggleFollow: () => void;
  readonly enableFollow: () => void;
  readonly interruptTurn: () => void;
  readonly applyPatch: LyraThreadRuntimeActions["applyPatch"];
  readonly resolveApproval: LyraThreadRuntimeActions["resolveApproval"];
  readonly resolvePlanReview: LyraThreadRuntimeActions["resolvePlanReview"];
  readonly pauseFollow: LyraThreadRuntimeActions["pauseFollow"];
  readonly resumeFollow: LyraThreadRuntimeActions["resumeFollow"];
  readonly refreshActiveThread: LyraThreadRuntimeActions["refreshActiveThread"];
  readonly sendTurn: (payload: AgentComposerSubmitPayload) => Promise<void>;
  readonly steerActiveTurn: (payload: AgentComposerSubmitPayload) => Promise<void>;
  readonly startFileMentionSearch: (sessionId: string, roots: readonly string[]) => Promise<void>;
  readonly updateFileMentionSearch: (sessionId: string, query: string) => Promise<void>;
  readonly stopFileMentionSearch: (sessionId: string) => Promise<void>;
  readonly setExpandedPatchKey: Dispatch<SetStateAction<string | null>>;
};

export type AiPanelSurfaceRuntime = {
  readonly state: LyraThreadRuntimeState;
  readonly actions: AiPanelSurfaceRuntimeActions;
  readonly composerAppendRequest: ComposerAppendRequest | null;
  readonly composerReserveStyle: CSSProperties;
  readonly expandedPatchKey: string | null;
  readonly modelOptions: readonly RuntimeModelOption[];
  readonly selectedModelOption: RuntimeModelOption | null;
  readonly reasoningEffortOptions: readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[];
  readonly selectedReasoningEffort: RuntimeThreadOptions["effort"] | null;
  readonly verbosityOptions: readonly AgentComposerModelControlOption<AgentComposerVerbosity>[];
  readonly selectedVerbosity: RuntimeThreadOptions["verbosity"] | null;
  readonly fileMentionSearchRoots: readonly string[];
  readonly fileMentionSearchResults: readonly FuzzyFileSearchResult[];
  readonly workbenchTabMentions: readonly AgentComposerWorkbenchTabMention[];
  readonly aiThreadMentions: readonly AgentComposerAiThreadMention[];
  readonly boundProjectRootForActiveThread: string | null;
  readonly tabProjectRootById: ReadonlyMap<string, string | null>;
  readonly isBindingProject: boolean;
  readonly isCreatingThread: boolean;
  readonly isBusy: boolean;
  readonly isAgentAvailable: boolean;
};

export const useAiPanelSurfaceRuntime = ({
  desktopApi,
  t,
  stopBehavior,
  defaultProfileId,
  defaultProviderId,
  defaultModelNames,
  configuredProfiles,
  fileMentionFallbackRoots,
  workbenchTabMentions,
  onRequestProjectBind,
  onDefaultProfileSelect
}: UseAiPanelSurfaceRuntimeInput): AiPanelSurfaceRuntime => {
  const [selectedModelOptionValue, setSelectedModelOptionValue] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState<RuntimeThreadOptions["effort"] | null>(null);
  const [selectedVerbosity, setSelectedVerbosity] =
    useState<RuntimeThreadOptions["verbosity"] | null>(null);
  const [composerHeight, setComposerHeight] = useState(96);
  const [expandedPatchKey, setExpandedPatchKey] = useState<string | null>(null);
  const [boundProjectRootByThread, setBoundProjectRootByThread] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [pendingBoundProjectRoot, setPendingBoundProjectRoot] = useState<string | null>(null);
  const [isBindingProject, setIsBindingProject] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [fileMentionSearchResults, setFileMentionSearchResults] =
    useState<readonly FuzzyFileSearchResult[]>([]);
  const activeFileMentionSearchSessionIdRef = useRef<string | null>(null);

  const { state, actions } = useLyraThreadRuntime({ desktopApi });
  const {
    interruptTurn,
    cleanBackgroundTerminals,
    selectThread,
    createThread: createRuntimeThread,
    activateThreadTab,
    closeThreadTab,
    reorderThreadTab,
    openThreadTab,
    sendTurn: sendRuntimeTurn,
    applyPatch,
    resolveApproval,
    resolvePlanReview,
    pauseFollow,
    resumeFollow,
    refreshActiveThread,
    setFollowEnabled,
    setPlanModeEnabled,
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
        ? [
            state.activeThread?.cwd ?? null,
            ...(fileMentionFallbackRoots ?? []),
          ]
        : [boundProjectRootForActiveThread];
      return roots
        .map((root) => root?.trim() ?? "")
        .filter((root, index, values) => root.length > 0 && values.indexOf(root) === index);
    },
    [boundProjectRootForActiveThread, fileMentionFallbackRoots, state.activeThread?.cwd]
  );

  const threadProjectRootById = useMemo(() => {
    const next = new Map<string, string>();
    for (const thread of state.threads) {
      const root = normalizeProjectRoot(thread.boundProjectRoot);
      if (root !== null) {
        next.set(thread.id, root);
      }
    }
    return next;
  }, [state.threads]);

  const tabProjectRootById = useMemo(() => {
    const next = new Map<string, string | null>();
    for (const tab of state.threadTabs) {
      const activeRoot =
        tab.tabId === state.activeTabId
          ? normalizeProjectRoot(boundProjectRootForActiveThread)
          : null;
      const threadRoot =
        tab.threadId === null
          ? null
          : (
              normalizeProjectRoot(boundProjectRootByThread.get(tab.threadId))
              ?? threadProjectRootById.get(tab.threadId)
              ?? null
            );
      next.set(tab.tabId, activeRoot ?? threadRoot);
    }
    return next;
  }, [
    boundProjectRootByThread,
    boundProjectRootForActiveThread,
    state.activeTabId,
    state.threadTabs,
    threadProjectRootById
  ]);

  const aiThreadMentions = useMemo<readonly AgentComposerAiThreadMention[]>(() => {
    const threadById = new Map(state.threads.map((thread) => [thread.id, thread]));
    return state.threadTabs
      .filter((tab) => tab.threadId !== null)
      .map((tab) => {
        const threadId = tab.threadId!;
        const thread = threadById.get(threadId);
        const projectRoot = tabProjectRootById.get(tab.tabId) ?? undefined;
        return {
          tabId: tab.tabId,
          threadId,
          title: tab.title,
          status: tab.status,
          active: tab.tabId === state.activeTabId,
          ...(thread?.preview === undefined || thread.preview.trim().length === 0
            ? {}
            : { preview: thread.preview.trim() }),
          ...(projectRoot === undefined || projectRoot === null ? {} : { projectRoot }),
          ...(thread === undefined ? {} : { recentMessages: readThreadRecentMessages(thread) }),
        };
      });
  }, [state.activeTabId, state.threadTabs, state.threads, tabProjectRootById]);

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

  useEffect(() => {
    setSelectedModelOptionValue((current) =>
      resolveSyncedSelectedModelOptionValue({
        modelOptions,
        selectedModelOptionValue: current,
        defaultProfileId
      })
    );
  }, [defaultProfileId, modelOptions]);

  const persistDefaultProfileSelection = useCallback(async (profileId: string): Promise<void> => {
    if (onDefaultProfileSelect !== undefined) {
      await onDefaultProfileSelect(profileId);
    }
  }, [onDefaultProfileSelect]);

  const selectModelOptionValue = useCallback((value: string): void => {
    setSelectedModelOptionValue(value);
    const profileId = modelOptions.find((option) => option.value === value)?.profileId;
    if (profileId === undefined || profileId === defaultProfileId) {
      return;
    }
    void persistDefaultProfileSelection(profileId).catch((error: unknown) => {
      console.warn("[lyra-ai] failed to persist default profile selection", error);
    });
  }, [defaultProfileId, modelOptions, persistDefaultProfileSelection]);

  const modelMetadata = selectedModelOption?.runtimeMetadata;
  const supportedReasoningLevels = useMemo<readonly AgentComposerReasoningEffort[]>(
    () => {
      const values = modelMetadata?.supportedReasoningLevels ?? [];
      const seen = new Set<AgentComposerReasoningEffort>();
      const supported: AgentComposerReasoningEffort[] = [];
      for (const value of values) {
        if (isReasoningEffortValue(value) && !seen.has(value)) {
          seen.add(value);
          supported.push(value);
        }
      }
      return supported;
    },
    [modelMetadata]
  );
  const strongestSupportedReasoningEffort = useMemo(
    () => strongestReasoningEffort(supportedReasoningLevels),
    [supportedReasoningLevels]
  );
  const supportedVerbosityLevels = useMemo<readonly AgentComposerVerbosity[]>(
    () => modelMetadata?.supportVerbosity === true ? VERBOSITY_VALUES : [],
    [modelMetadata?.supportVerbosity]
  );
  const defaultSupportedVerbosity = useMemo<AgentComposerVerbosity | null>(
    () => {
      if (supportedVerbosityLevels.length === 0) {
        return null;
      }
      const defaultVerbosity = modelMetadata?.defaultVerbosity;
      if (defaultVerbosity !== undefined && isVerbosityValue(defaultVerbosity)) {
        return defaultVerbosity;
      }
      return supportedVerbosityLevels.includes("medium")
        ? "medium"
        : supportedVerbosityLevels[0] ?? null;
    },
    [modelMetadata?.defaultVerbosity, supportedVerbosityLevels]
  );

  const reasoningEffortOptions = useMemo<
    readonly AgentComposerModelControlOption<AgentComposerReasoningEffort>[]
  >(
    () => supportedReasoningLevels.map((value) => ({
      value,
      label: t(reasoningEffortLabelKey(value)),
    })),
    [supportedReasoningLevels, t]
  );
  const verbosityOptions = useMemo<
    readonly AgentComposerModelControlOption<AgentComposerVerbosity>[]
  >(
    () => supportedVerbosityLevels.map((value) => ({
      value,
      label: t(verbosityLabelKey(value)),
    })),
    [supportedVerbosityLevels, t]
  );

  const selectedModelValueRef = useRef<string | null>(null);
  useEffect(() => {
    const selectedModelValue = selectedModelOption?.value ?? null;
    const modelChanged = selectedModelValueRef.current !== selectedModelValue;
    selectedModelValueRef.current = selectedModelValue;

    if (strongestSupportedReasoningEffort === null) {
      if (selectedReasoningEffort !== null) {
        setSelectedReasoningEffort(null);
      }
    } else if (
      modelChanged
      || selectedReasoningEffort === null
      || !isReasoningEffortValue(selectedReasoningEffort)
      || !supportedReasoningLevels.includes(selectedReasoningEffort)
    ) {
      setSelectedReasoningEffort(strongestSupportedReasoningEffort);
    }

    if (defaultSupportedVerbosity === null) {
      if (selectedVerbosity !== null) {
        setSelectedVerbosity(null);
      }
    } else if (
      modelChanged
      || selectedVerbosity === null
      || !isVerbosityValue(selectedVerbosity)
      || !supportedVerbosityLevels.includes(selectedVerbosity)
    ) {
      setSelectedVerbosity(defaultSupportedVerbosity);
    }
  }, [
    defaultSupportedVerbosity,
    selectedModelOption?.value,
    selectedReasoningEffort,
    selectedVerbosity,
    strongestSupportedReasoningEffort,
    supportedReasoningLevels,
    supportedVerbosityLevels
  ]);

  useEffect(() => {
    setSelectedModelOptionValue((current) =>
      modelOptions.some((option) => option.value === current)
        ? current
        : (modelOptions[0]?.value ?? "")
    );
  }, [modelOptions]);

  useEffect(() => subscribeThreadSelected((threadId) => {
    selectThread(threadId);
  }), [selectThread]);

  const persistBoundProjectRoot = useCallback(
    async (threadId: string, projectRoot: string): Promise<void> => {
      void threadId;
      void projectRoot;
    },
    []
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
      void persistBoundProjectRoot(activeThreadId, trimmed).catch((error: unknown) => {
        console.error("Failed to persist bound project root", error);
      });
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
    activeFileMentionSearchSessionIdRef.current = sessionId;
    setFileMentionSearchResults([]);
    void roots;
  }, []);

  const updateFileMentionSearch = useCallback(async (
    sessionId: string,
    query: string
  ): Promise<void> => {
    void sessionId;
    void query;
  }, []);

  const stopFileMentionSearch = useCallback(async (sessionId: string): Promise<void> => {
    if (activeFileMentionSearchSessionIdRef.current === sessionId) {
      activeFileMentionSearchSessionIdRef.current = null;
      setFileMentionSearchResults([]);
    }
  }, []);

  const runtimeTurnOptions = useCallback((collaborationMode?: RuntimeThreadOptions["collaborationMode"]) =>
    createRuntimeTurnOptions({
      selectedModelOption,
      defaultProviderId,
      boundProjectRoot: boundProjectRootForActiveThread,
      collaborationMode,
      effort: selectedReasoningEffort,
      verbosity: selectedVerbosity,
      followEnabled: state.followEnabled
    }), [
    boundProjectRootForActiveThread,
    defaultProviderId,
    selectedModelOption,
    selectedReasoningEffort,
    selectedVerbosity,
    state.followEnabled
  ]);

  const newThreadOptions = useCallback(() =>
    createRuntimeTurnOptions({
      selectedModelOption,
      defaultProviderId,
      boundProjectRoot: null,
      effort: selectedReasoningEffort,
      verbosity: selectedVerbosity
    }), [
    defaultProviderId,
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
      runtimeInputFromComposerReferenceParts(payload),
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
    await steerTurn(runtimeInputFromComposerReferenceParts(payload));
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

  const createThread = useCallback(async (): Promise<void> => {
    if (isCreatingThread) {
      return;
    }
    setIsCreatingThread(true);
    setPendingBoundProjectRoot(null);
    try {
      await createRuntimeThread(newThreadOptions());
    } catch {
      // The runtime hook owns the visible error state.
    } finally {
      setIsCreatingThread(false);
    }
  }, [createRuntimeThread, isCreatingThread, newThreadOptions]);

  const isBusy = isAiRuntimeBusy({
    isSending: state.isSending,
    isStreamActive: state.isStreamActive
  });
  const composerReserveStyle = useMemo(
    () => createComposerReserveStyle(composerHeight) as CSSProperties,
    [composerHeight]
  );
  const isAgentAvailable = desktopApi?.ai !== undefined && modelOptions.length > 0;

  return {
    state,
    actions: {
      activateThreadTab,
      closeThreadTab,
      reorderThreadTab,
      openThreadTab,
      selectModelOptionValue,
      setSelectedReasoningEffort,
      setSelectedVerbosity,
      setComposerHeight,
      createThread,
      bindProject: handleBindProject,
      togglePlanMode: handlePlanModeToggle,
      toggleFollow: handleFollowToggle,
      enableFollow,
      interruptTurn: handleInterruptTurn,
      applyPatch,
      resolveApproval,
      resolvePlanReview,
      pauseFollow,
      resumeFollow,
      refreshActiveThread,
      sendTurn,
      steerActiveTurn,
      startFileMentionSearch,
      updateFileMentionSearch,
      stopFileMentionSearch,
      setExpandedPatchKey,
    },
    composerAppendRequest: null,
    composerReserveStyle,
    expandedPatchKey,
    modelOptions,
    selectedModelOption,
    reasoningEffortOptions,
    selectedReasoningEffort,
    verbosityOptions,
    selectedVerbosity,
    fileMentionSearchRoots,
    fileMentionSearchResults,
    workbenchTabMentions: workbenchTabMentions ?? [],
    aiThreadMentions,
    boundProjectRootForActiveThread,
    tabProjectRootById,
    isBindingProject,
    isCreatingThread,
    isBusy,
    isAgentAvailable,
  };
};
