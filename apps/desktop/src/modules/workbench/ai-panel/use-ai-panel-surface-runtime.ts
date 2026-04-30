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

import type {
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import type { createTranslator, I18nKey, WorkbenchLocale } from "../i18n";
import {
  normalizeProjectRoot,
  useProjectLogoMap
} from "../project-identity";
import { subscribeThreadSelected } from "../thread-selection-events";
import type { LyraThread } from "./lyra-thread-adapter";
import type {
  AgentComposerModelControlOption,
  AgentComposerReasoningEffort,
  AgentComposerSubmitPayload,
  AgentComposerVerbosity,
  AgentComposerAiThreadMention,
  AgentComposerWorkbenchTabMention,
  AgentPermissionMode
} from "./agent-composer";
import {
  toPersistedRuntimeFeedItem,
  type ToolNameLabelMap
} from "./runtime/feed-utils";
import {
  canOpenReviewChanges,
  createComposerReserveStyle,
  createInteractionTextLabels,
  createRequestPayload,
  createRuntimeModelOptions,
  createRuntimeTurnOptions,
  createToolNameLabels,
  gitMetadataProbePaths,
  isAiRuntimeBusy,
  resolveBoundProjectRoot,
  resolveSelectedRuntimeModelOption,
  shouldShowEmptySessionScene,
  type RuntimeModelOption
} from "./surface-model";
import type {
  AiPanelThreadMessageMetadata,
  AiPanelThreadRenderRow
} from "./thread-render-model";
import {
  useAiPanelThreadRendering,
} from "./use-ai-panel-thread-rendering";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelThreadViewModel } from "./use-ai-panel-thread-view-model";
import type { AiPanelThreadVirtualRow } from "./use-ai-panel-thread-virtual-rows-model";
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

const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || path.startsWith("\\\\") || /^[a-z]:[\\/]/iu.test(path);

const joinRootPath = (root: string, path: string): string => {
  if (isAbsolutePath(path)) {
    return path;
  }
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/u, "")}${separator}${path.replace(/^[\\/]+/u, "")}`;
};

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
  const root = readString(value.root);
  const resolvedPath = root === null ? path : joinRootPath(root, path);
  const kind = matchType === "directory" ? "directory" : "file";
  const indices = Array.isArray(value.indices)
    ? value.indices.filter((entry): entry is number => typeof entry === "number")
    : null;
  return {
    id: `${kind}:${resolvedPath}`,
    name,
    path: resolvedPath,
    kind,
    ...(root === null ? {} : { root }),
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
  ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
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
  readonly workbenchTabMentions?: readonly AgentComposerWorkbenchTabMention[] | undefined;
  readonly onOpenFilePath?: AiPanelSurfaceProps["onOpenFilePath"] | undefined;
  readonly onWriteStreamEvent?: AiPanelSurfaceProps["onWriteStreamEvent"] | undefined;
  readonly onRequestProjectBind?: AiPanelSurfaceProps["onRequestProjectBind"] | undefined;
  readonly onOpenPlanApprovalWorkspace?: AiPanelSurfaceProps["onOpenPlanApprovalWorkspace"] | undefined;
};

export type AiPanelSurfaceRuntimeActions = {
  readonly activateThreadTab: LyraThreadRuntimeActions["activateThreadTab"];
  readonly closeThreadTab: LyraThreadRuntimeActions["closeThreadTab"];
  readonly reorderThreadTab: LyraThreadRuntimeActions["reorderThreadTab"];
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
  readonly openReviewPanel: () => void;
  readonly closeReviewPanel: () => void;
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
  readonly planApprovalDecision: (
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ) => Promise<void>;
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
  readonly workbenchTabMentions: readonly AgentComposerWorkbenchTabMention[];
  readonly aiThreadMentions: readonly AgentComposerAiThreadMention[];
  readonly permissionMode: AgentPermissionMode;
  readonly toolNameLabels: ToolNameLabelMap;
  readonly typewriterText: string;
  readonly messageMetadata: AiPanelThreadMessageMetadata;
  readonly renderRows: readonly AiPanelThreadRenderRow[];
  readonly virtualRows: readonly AiPanelThreadVirtualRow[];
  readonly topSpacerHeight: number;
  readonly bottomSpacerHeight: number;
  readonly measureThreadRow: (rowKey: string, node: HTMLDivElement | null) => void;
  readonly boundProjectRootForActiveThread: string | null;
  readonly boundProjectRootByThreadId: ReadonlyMap<string, string>;
  readonly tabProjectRootById: ReadonlyMap<string, string | null>;
  readonly projectLogoByRoot: ReadonlyMap<string, string | null>;
  readonly isBindingProject: boolean;
  readonly isPermissionsPanelOpen: boolean;
  readonly isReviewPanelOpen: boolean;
  readonly isReviewStarting: boolean;
  readonly canOpenReviewChanges: boolean;
  readonly showEmptySessionScene: boolean;
  readonly isBusy: boolean;
  readonly isAgentAvailable: boolean;
  readonly canOpenFilePath: boolean;
  readonly openRuntimeTargetPath: OpenRuntimeTargetPath;
  readonly openPlanApprovalInWorkspace?: (request: PlanApprovalRequest) => void;
};

export const useAiPanelSurfaceRuntime = ({
  desktopApi,
  locale,
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
  workbenchTabMentions,
  onOpenFilePath,
  onWriteStreamEvent,
  onRequestProjectBind,
  onOpenPlanApprovalWorkspace
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
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
  const [isReviewStarting, setIsReviewStarting] = useState(false);
  const [gitMetadataAvailableForReview, setGitMetadataAvailableForReview] = useState(false);
  const composerAppendRequestIdRef = useRef(0);
  const activeFileMentionSearchSessionIdRef = useRef<string | null>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);
  const lastAutoOpenedPlanReviewIdRef = useRef<string | null>(null);

  const interactionTextLabels = useMemo(() => createInteractionTextLabels(t), [t]);

  const { state, actions } = useLyraThreadRuntime({
    desktopApi,
    interactionTextLabels,
    ...(onWriteStreamEvent === undefined ? {} : { onWriteStreamEvent }),
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
    reorderThreadTab,
    openThreadTab,
    resolvePlanApproval,
    sendTurn: sendRuntimeTurn,
    setActiveInteractionId,
    setFollowEnabled,
    setPlanModeEnabled,
    startReview: startRuntimeReview,
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
  const tabProjectRoots = useMemo(
    () => [...tabProjectRootById.values()].filter((root): root is string => root !== null),
    [tabProjectRootById]
  );
  const projectLogoByRoot = useProjectLogoMap(desktopApi?.files, tabProjectRoots);

  useEffect(() => {
    const filesApi = desktopApi?.files;
    const probePaths =
      boundProjectRootForActiveThread === null
        ? []
        : gitMetadataProbePaths(boundProjectRootForActiveThread);
    if (filesApi === undefined || probePaths.length === 0) {
      setGitMetadataAvailableForReview(false);
      return;
    }
    let cancelled = false;
    setGitMetadataAvailableForReview(false);
    void (async () => {
      for (const path of probePaths) {
        try {
          const stat = await filesApi.statFile({ path });
          if (cancelled) {
            return;
          }
          if (stat.exists) {
            setGitMetadataAvailableForReview(true);
            return;
          }
        } catch {
          if (cancelled) {
            return;
          }
        }
      }
      if (!cancelled) {
        setGitMetadataAvailableForReview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boundProjectRootForActiveThread, desktopApi?.files]);

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

  const {
    threadViewportRef,
    messageMetadata,
    renderRows,
    virtualRows,
    topSpacerHeight,
    bottomSpacerHeight,
    measureThreadRow,
  } = useAiPanelThreadRendering({
    sortedMessages: viewModel.sortedMessages,
    planByTurn: state.planByTurn,
    typewriterText,
    streamingTurnRuntimeFeed: viewModel.streamingTurnRuntimeFeed,
    streamingStatus: viewModel.streamingStatus,
    orphanRuntimeFeed: viewModel.orphanRuntimeFeed,
    runtimeError: state.runtimeError,
    activeThreadId: state.activeThreadId,
    optimisticUserMessages: state.optimisticUserMessages,
    pendingInteractions: state.pendingInteractions,
    streamingAssistantText: state.streamingAssistantText,
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
        const sessionId = readString(params.sessionId);
        if (sessionId !== null && sessionId !== activeFileMentionSearchSessionIdRef.current) {
          return;
        }
        const files = Array.isArray(params.files)
          ? params.files.map(readFuzzyFileSearchResult).filter((entry): entry is FuzzyFileSearchResult => entry !== null)
          : [];
        setFileMentionSearchResults(files);
        return;
      }
      if (method === "fuzzyFileSearch/sessionCompleted") {
        return;
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
    activeFileMentionSearchSessionIdRef.current = sessionId;
    setFileMentionSearchResults([]);
    if (lyraApi === undefined || roots.length === 0) {
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
    if (activeFileMentionSearchSessionIdRef.current === sessionId) {
      activeFileMentionSearchSessionIdRef.current = null;
      setFileMentionSearchResults([]);
    }
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
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ): Promise<void> => {
    const feedback = response.feedback?.trim() ?? "";
    const activeThreadId = state.activeThreadId;
    const planTurnId = requestOverride?.turnId
      ?? response.requestId.replace(/^plan:/u, "").trim();
    const threadId = requestOverride?.sessionId ?? activeThreadId;
    if (threadId === null || threadId.trim().length === 0 || planTurnId.length === 0) {
      return;
    }
    if (response.decision === "approve_and_implement") {
      setPlanModeEnabled(false);
      await resolvePlanApproval({
        threadId,
        planTurnId,
        requestId: response.requestId,
        decision: response.decision,
        ...(feedback.length === 0 ? {} : { feedback }),
        ...(requestOverride?.proposedMarkdown === undefined
          ? {}
          : { proposedMarkdown: requestOverride.proposedMarkdown }),
      });
      return;
    }
    if (response.decision === "keep_planning") {
      setPlanModeEnabled(true);
      await resolvePlanApproval({
        threadId,
        planTurnId,
        requestId: response.requestId,
        decision: response.decision,
        ...(feedback.length === 0 ? {} : { feedback }),
        ...(requestOverride?.proposedMarkdown === undefined
          ? {}
          : { proposedMarkdown: requestOverride.proposedMarkdown }),
      });
      return;
    }
    setPlanModeEnabled(false);
    await resolvePlanApproval({
      threadId,
      planTurnId,
      requestId: response.requestId,
      decision: response.decision,
      ...(feedback.length === 0 ? {} : { feedback }),
      ...(requestOverride?.proposedMarkdown === undefined
        ? {}
        : { proposedMarkdown: requestOverride.proposedMarkdown }),
    });
  }, [resolvePlanApproval, setPlanModeEnabled, state.activeThreadId]);

  const openPlanApprovalInWorkspace = useMemo(
    () =>
      onOpenPlanApprovalWorkspace === undefined
        ? undefined
        : (request: PlanApprovalRequest): void => {
            onOpenPlanApprovalWorkspace({
              locale,
              request,
              onDecision: handlePlanApprovalDecision,
            });
          },
    [handlePlanApprovalDecision, locale, onOpenPlanApprovalWorkspace]
  );

  useEffect(() => {
    if (
      state.followEnabled !== true
      || openPlanApprovalInWorkspace === undefined
      || state.activeInteractionPanel?.kind !== "planApproval"
    ) {
      return;
    }
    const request = state.activeInteractionPanel.request;
    if (lastAutoOpenedPlanReviewIdRef.current === request.id) {
      return;
    }
    lastAutoOpenedPlanReviewIdRef.current = request.id;
    openPlanApprovalInWorkspace(request);
  }, [openPlanApprovalInWorkspace, state.activeInteractionPanel, state.followEnabled]);

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
    setIsReviewStarting(true);
    try {
      await startRuntimeReview(target, { cwd: boundProjectRootForActiveThread });
      setIsReviewPanelOpen(false);
    } catch {
      // Runtime hook owns the visible error state.
    } finally {
      setIsReviewStarting(false);
    }
  }, [boundProjectRootForActiveThread, startRuntimeReview]);

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
  const canOpenReviewPanel = canOpenReviewChanges({
    activeThreadId: state.activeThreadId,
    boundProjectRoot: boundProjectRootForActiveThread,
    gitMetadataAvailable: gitMetadataAvailableForReview,
    isAgentAvailable,
    isBusy,
    isReviewStarting
  });

  useEffect(() => {
    if (!isReviewPanelOpen) {
      return;
    }
    if (
      state.activeThreadId === null
      || !isAgentAvailable
      || boundProjectRootForActiveThread === null
      || !gitMetadataAvailableForReview
    ) {
      setIsReviewPanelOpen(false);
    }
  }, [
    boundProjectRootForActiveThread,
    gitMetadataAvailableForReview,
    isAgentAvailable,
    isReviewPanelOpen,
    state.activeThreadId
  ]);

  return {
    state,
    viewModel,
    actions: {
      activateThreadTab,
      closeThreadTab,
      reorderThreadTab,
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
      openReviewPanel: () => {
        if (canOpenReviewPanel) {
          setIsReviewPanelOpen(true);
        }
      },
      closeReviewPanel: () => {
        setIsReviewPanelOpen(false);
      },
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
    workbenchTabMentions: workbenchTabMentions ?? [],
    aiThreadMentions,
    permissionMode,
    toolNameLabels,
    typewriterText,
    messageMetadata,
    renderRows,
    virtualRows,
    topSpacerHeight,
    bottomSpacerHeight,
    measureThreadRow,
    boundProjectRootForActiveThread,
    boundProjectRootByThreadId: boundProjectRootByThread,
    tabProjectRootById,
    projectLogoByRoot,
    isBindingProject,
    isPermissionsPanelOpen,
    isReviewPanelOpen,
    isReviewStarting,
    canOpenReviewChanges: canOpenReviewPanel,
    showEmptySessionScene,
    isBusy,
    isAgentAvailable,
    canOpenFilePath: onOpenFilePath !== undefined,
    openRuntimeTargetPath,
    ...(openPlanApprovalInWorkspace === undefined ? {} : { openPlanApprovalInWorkspace })
  };
};
