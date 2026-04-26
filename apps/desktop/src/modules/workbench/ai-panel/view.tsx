import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { PlanInteractionResponse } from "../../../shared/agent";
import type { LyraClientRequestPayload } from "../../../shared/desktop-bridge";
import { createTranslator } from "../i18n";
import { subscribeThreadSelected } from "../thread-selection-events";
import {
  AgentComposer,
  type AgentComposerModelOption,
  type AgentPermissionMode,
} from "./agent-composer";
import { AiPanelInteractionShell } from "./interaction-shell";
import { AiPermissionsPanel } from "./permissions-panel";
import {
  toPersistedRuntimeFeedItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import { AiPanelSurfaceFrame } from "./surface-frame";
import { AiPanelThreadTabs } from "./thread-tabs";
import { AiPanelThreadView } from "./thread-view";
import { AiPanelTopbarActions } from "./topbar-actions";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelThreadViewModel } from "./use-ai-panel-thread-view-model";
import { useLyraThreadRuntime } from "./use-lyra-thread-runtime";
import { useTypewriter } from "./use-typewriter";

const LOGO_URL = new URL("../../../renderer/assets/logo.svg", import.meta.url).toString();

type RuntimeModelOption = AgentComposerModelOption & {
  readonly model: string;
  readonly modelProvider: string | null;
};

const permissionRuntimeOptions = (mode: AgentPermissionMode) => {
  if (mode === "auto_review") {
    return {
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "auto_review" as const,
      sandboxMode: "workspace-write" as const,
    };
  }
  if (mode === "full_access") {
    return {
      approvalPolicy: "never" as const,
      approvalsReviewer: "user" as const,
      sandboxMode: "danger-full-access" as const,
    };
  }
  return {
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    sandboxMode: "workspace-write" as const,
  };
};

const MODEL_OPTION_DELIMITER = "\u001F";
const EMPTY_THREAD_STYLE = {};

type JsonRecord = Record<string, unknown>;

const createRequestPayload = (
  method: string,
  params: JsonRecord = {}
): LyraClientRequestPayload => ({ method, params });

const uniqueModelIds = (entries: readonly string[]): readonly string[] =>
  entries
    .map((entry) => entry.trim())
    .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);

export const AiPanelSurface = ({
  variant,
  desktopApi,
  locale = "en-US",
  title,
  themeSignature,
  richRenderingEnabled = true,
  stopBehavior = "turn_only",
  newSessionTitle,
  defaultProfileId,
  defaultProviderId,
  defaultModelNames,
  configuredProfiles = [],
  aiPanelSide = "left",
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel,
  openHistoryLabel,
  openMcpLabel,
  openSkillsLabel,
  bindProjectLabel,
  composeAriaLabel,
  composePlaceholder,
  composeSendLabel,
  emptyThreadLabel,
  loadingSessionLabel,
  turnNoToolCallsLabel,
  turnWorkingLabel,
  turnFailedLabel,
  turnWorkedForPrefix,
  runtimeQueuedLabel,
  runtimeStartedLabel,
  runtimeRunningPrefix: _runtimeRunningPrefix,
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
  toolStatusRunningLabel,
  toolStatusCompletedLabel,
  toolStatusFailedLabel,
  onOpenFilePath,
  onWriteStreamEvent: _onWriteStreamEvent,
  onTerminalExecStarted: _onTerminalExecStarted,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onRequestProjectBind,
}: AiPanelSurfaceProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const lyraApi = desktopApi?.lyra;
  const [selectedModelOptionValue, setSelectedModelOptionValue] = useState("");
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("default");
  const [composerHeight, setComposerHeight] = useState(96);
  const [composerAppendRequest, setComposerAppendRequest] = useState<{
    readonly id: number;
    readonly text: string;
  } | null>(null);
  const [boundProjectRootByThread, setBoundProjectRootByThread] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [pendingBoundProjectRoot, setPendingBoundProjectRoot] = useState<string | null>(null);
  const [isBindingProject, setIsBindingProject] = useState(false);
  const [isPermissionsPanelOpen, setIsPermissionsPanelOpen] = useState(false);
  const composerAppendRequestIdRef = useRef(0);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);

  const interactionTextLabels = useMemo(
    () => ({
      toolTerminalSession: t("ai.toolNameTerminalSession"),
      toolTerminalInput: t("ai.toolNameTerminalInput"),
      toolTerminalExec: t("ai.toolNameTerminalExec"),
      commandNeedsApproval: t("ai.commandNeedsApproval"),
      proposedPlanSummaryFallback: t("ai.proposedPlanSummaryFallback"),
    }),
    [t]
  );

  const { state, actions } = useLyraThreadRuntime({
    desktopApi,
    interactionTextLabels,
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
    steerTurn,
  } = actions;
  const activeThreadId = state.activeThreadId;
  const boundProjectRootForActiveThread = useMemo(() => {
    if (activeThreadId !== null) {
      const mapped = boundProjectRootByThread.get(activeThreadId);
      if (mapped !== undefined && mapped.length > 0) {
        return mapped;
      }
      const persisted = state.activeThread?.id === activeThreadId
        ? state.activeThread.boundProjectRoot
        : null;
      if (persisted !== null && persisted !== undefined && persisted.length > 0) {
        return persisted;
      }
    }
    if (pendingBoundProjectRoot !== null && pendingBoundProjectRoot.length > 0) {
      return pendingBoundProjectRoot;
    }
    return null;
  }, [activeThreadId, boundProjectRootByThread, pendingBoundProjectRoot, state.activeThread]);

  const toolNameLabels = useMemo<ToolNameLabelMap>(
    () => ({
      search: toolNameSearchLabel,
      readRange: toolNameReadRangeLabel,
      list: toolNameListLabel,
      glob: toolNameGlobLabel,
      write: toolNameWriteLabel,
      edit: toolNameEditLabel,
      multiEdit: toolNameMultiEditLabel,
      terminalSession: t("ai.toolNameTerminalSession"),
      terminalRead: t("ai.toolNameTerminalRead"),
      terminalInput: t("ai.toolNameTerminalInput"),
      terminalClose: t("ai.toolNameTerminalClose"),
      terminalExec: t("ai.toolNameTerminalExec"),
    }),
    [
      t,
      toolNameEditLabel,
      toolNameGlobLabel,
      toolNameListLabel,
      toolNameMultiEditLabel,
      toolNameReadRangeLabel,
      toolNameSearchLabel,
      toolNameWriteLabel,
    ]
  );

  const modelOptions = useMemo<readonly RuntimeModelOption[]>(() => {
    const nextOptions: RuntimeModelOption[] = [];
    const multipleProfiles = configuredProfiles.filter((profile) => profile.runtimeSupported).length > 1;
    const orderedProfiles = [...configuredProfiles].sort((left, right) => {
      if (left.id === defaultProfileId) {
        return -1;
      }
      if (right.id === defaultProfileId) {
        return 1;
      }
      return 0;
    });
    for (const profile of orderedProfiles) {
      if (!profile.runtimeSupported) {
        continue;
      }
      const models = uniqueModelIds([
        profile.model,
        ...profile.customModels.map((entry) => entry.id),
        ...profile.discoveryState.models.map((entry) => entry.id),
      ]);
      const providerId = profile.runtimeProviderId.trim();
      if (providerId.length === 0) {
        continue;
      }
      for (const model of models) {
        nextOptions.push({
          value: `${profile.id}${MODEL_OPTION_DELIMITER}${model}`,
          label: multipleProfiles ? `${model} · ${profile.name}` : model,
          model,
          modelProvider: providerId,
        });
      }
    }
    if (nextOptions.length > 0) {
      return nextOptions;
    }
    return uniqueModelIds(defaultModelNames).map((model) => ({
      value: model,
      label: model,
      model,
      modelProvider: defaultProviderId ?? null,
    }));
  }, [configuredProfiles, defaultModelNames, defaultProfileId, defaultProviderId]);

  const selectedModelOption = useMemo(
    () =>
      modelOptions.find((option) => option.value === selectedModelOptionValue)
      ?? modelOptions[0]
      ?? null,
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
      resetKey: state.streamingTurnId,
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
      pendingInteractions: t("ai.pendingInteractions"),
    },
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
          boundProjectRoot: trimmed,
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
    viewModel.sortedMessages,
  ]);

  const openRuntimeTargetPath = useCallback(
    async (
      path: string,
      options?: {
        readonly forceReloadIfOpen?: boolean;
        readonly allowMissing?: boolean;
        readonly location?: { readonly line: number };
      }
    ): Promise<void> => {
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
    persistBoundProjectRoot,
  ]);

  const runtimeTurnOptions = useCallback((collaborationMode?: "default" | "plan") => ({
    model: selectedModelOption?.model,
    modelProvider: selectedModelOption?.modelProvider ?? defaultProviderId,
    cwd: boundProjectRootForActiveThread,
    ...permissionRuntimeOptions(permissionMode),
    ...(collaborationMode === undefined || selectedModelOption?.model === undefined
      ? {}
      : { collaborationMode }),
  }), [boundProjectRootForActiveThread, defaultProviderId, permissionMode, selectedModelOption]);

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
    state.planModeEnabled,
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
      text: trimmed,
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
    state.activeThread,
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

  const topbarStart = (
    <AiPanelThreadTabs
      tabs={state.threadTabs}
      activeTabId={state.activeTabId}
      newThreadLabel={newSessionTitle}
      closeThreadLabel={t("menu.close")}
      draftTitle={newSessionTitle}
      onActivateTab={activateThreadTab}
      onCloseTab={closeThreadTab}
      onCreateTab={() => {
        void createThread();
      }}
    />
  );

  const topbarActions = (
    <AiPanelTopbarActions
      onRequestProjectBind={onRequestProjectBind === undefined || bindProjectLabel === undefined
        ? undefined
        : () => {
            void handleBindProject();
          }}
      activeBoundProjectName={boundProjectRootForActiveThread}
      isBindingProject={isBindingProject}
      bindProjectLabel={bindProjectLabel ?? ""}
      isAgentAvailable={desktopApi?.lyra !== null && desktopApi?.lyra !== undefined}
      onOpenHistory={onOpenHistory}
      onOpenMcp={onOpenMcp}
      onOpenSkills={onOpenSkills}
      onOpenPermissions={() => {
        setIsPermissionsPanelOpen(true);
      }}
      openHistoryLabel={openHistoryLabel}
      openMcpLabel={openMcpLabel}
      openSkillsLabel={openSkillsLabel}
      openPermissionsLabel={t("ai.permissionsLabel")}
      onStartReview={state.activeThreadId === null ? undefined : () => {
        void handleStartReview();
      }}
      reviewChangesLabel={t("ai.reviewChanges")}
      aiPanelSide={aiPanelSide}
      onToggleAiPanelSide={onToggleAiPanelSide}
      movePanelToLeftLabel={movePanelToLeftLabel}
      movePanelToRightLabel={movePanelToRightLabel}
      moreActionsLabel={t("ai.moreActions")}
    />
  );

  const showEmptySessionScene =
    (state.activeDetail?.messages.length ?? 0) === 0
    && state.optimisticUserMessages.length === 0
    && state.streamingAssistantText.length === 0
    && !state.isStreamActive;
  const isBusy = state.isSending || state.isStreamActive;
  const shellStyle = useMemo(
    () => ({
      "--lyra-ai-composer-reserve": `${String(Math.max(96, Math.ceil(composerHeight)))}px`,
    }) as CSSProperties,
    [composerHeight]
  );

  return (
    <AiPanelSurfaceFrame
      variant={variant}
      ariaLabel={title}
      topbarStart={topbarStart}
      topbarActions={topbarActions}
    >
      <div className="lyra-ai-agent-shell" style={shellStyle}>
        <div className="lyra-ai-agent-thread-shell">
          <AiPanelThreadView
            logoUrl={LOGO_URL}
            locale={locale}
            isZhLocale={locale === "zh-CN"}
            title={title}
            richRenderingEnabled={richRenderingEnabled}
            {...(themeSignature === undefined ? {} : { themeSignature })}
            showEmptySessionScene={showEmptySessionScene}
            isLoading={state.isLoadingThread || state.isLoadingThreads}
            loadingSessionLabel={loadingSessionLabel}
            emptyThreadLabel={emptyThreadLabel}
            threadRef={threadViewportRef}
            threadStyle={EMPTY_THREAD_STYLE}
            sortedMessages={viewModel.sortedMessages}
            turnsById={viewModel.turnsById}
            toolCallsByTurn={viewModel.toolCallsByTurn}
            runtimeFeedByTurn={viewModel.runtimeFeedByTurn}
            turnTimelineByTurn={viewModel.turnTimelineByTurn}
            assistantMessageOrderById={viewModel.assistantMessageOrderById}
            turnWorkingLabel={turnWorkingLabel}
            turnWorkedForPrefix={turnWorkedForPrefix}
            turnNoToolCallsLabel={turnNoToolCallsLabel}
            turnFailedLabel={turnFailedLabel}
            toolNameLabels={toolNameLabels}
            toolStatusRunningLabel={toolStatusRunningLabel}
            toolStatusCompletedLabel={toolStatusCompletedLabel}
            toolStatusFailedLabel={toolStatusFailedLabel}
            pendingInteractionQueue={state.pendingInteractionQueue}
            canOpenFilePath={onOpenFilePath !== undefined}
            openRuntimeTargetPath={openRuntimeTargetPath}
            typewriterText={typewriterText}
            streamingTurnRuntimeFeed={viewModel.streamingTurnRuntimeFeed}
            streamingStatus={viewModel.streamingStatus}
            orphanRuntimeFeed={viewModel.orphanRuntimeFeed}
            runtimeError={state.runtimeError}
            planByTurn={state.planByTurn}
            latestPlanTurnId={state.latestPlanTurnId}
            planActionsEnabled={!state.isSending && !state.isStreamActive}
            copyMessageLabel={t("ai.actionCopy")}
            copiedMessageLabel={t("dialog.copiedAction")}
            forkResponseLabel={t("ai.forkFromResponse")}
            regenerateResponseLabel={t("ai.regenerateResponse")}
            editMessageLabel={t("ai.editMessage")}
            onForkTurn={(turnId) => {
              void handleForkTurn(turnId);
            }}
            onRegenerateTurn={handleRegenerateTurn}
            onEditMessageTurn={handleEditMessageTurn}
            onPlanApprovalDecision={handlePlanApprovalDecision}
            onOpenPlanApprovalInPanel={setActiveInteractionId}
          />
        </div>

        <AiPanelInteractionShell
          locale={locale}
          panelRef={interactionPanelRef}
          activeInteractionPanel={state.activeInteractionPanel}
          activePendingInteraction={state.activePendingInteraction}
          pendingInteractionQueue={state.pendingInteractionQueue}
          activeInteractionPosition={state.activeInteractionPosition}
          pendingInteractionsLabel={t("ai.pendingInteractions")}
          navPreviousLabel={t("ai.navPrevious")}
          navNextLabel={t("ai.navNext")}
          onSelectInteractionId={setActiveInteractionId}
          onCommandApprovalDecision={respondToCommandApproval}
          onPlanQuestionSubmit={respondToPlanQuestion}
          onPlanApprovalDecision={handlePlanApprovalDecision}
        />

        {isPermissionsPanelOpen ? (
          <AiPermissionsPanel
            desktopApi={desktopApi}
            locale={locale}
            onClose={() => {
              setIsPermissionsPanelOpen(false);
            }}
          />
        ) : null}

        <AgentComposer
          locale={locale}
          currentThreadId={activeThreadId}
          appendRequest={composerAppendRequest}
          modelOptions={modelOptions}
          selectedModelName={selectedModelOption?.value ?? null}
          modelAriaLabel={t("ai.modelLabel")}
          onModelSelect={setSelectedModelOptionValue}
          modelSwitchDisabled={isBusy}
          permissionMode={permissionMode}
          permissionModeDisabled={isBusy}
          onPermissionModeSelect={setPermissionMode}
          ariaLabel={composeAriaLabel ?? title}
          placeholder={composePlaceholder ?? ""}
          sendLabel={composeSendLabel ?? "Send"}
          inputDisabled={desktopApi?.lyra === null || desktopApi?.lyra === undefined}
          sendDisabled={desktopApi?.lyra === null || desktopApi?.lyra === undefined}
          sending={isBusy}
          stopDisabled={
            state.streamingTurnId === null
            || desktopApi?.lyra === null
            || desktopApi?.lyra === undefined
          }
          planModeEnabled={state.planModeEnabled}
          planModeLocked={selectedModelOption === null || isBusy}
          planModeLabel={state.planModeEnabled ? t("ai.planModeArmed") : t("ai.planMode")}
          onPlanModeToggle={handlePlanModeToggle}
          onSend={sendTurn}
          onSteer={steerActiveTurn}
          steerLabel={t("ai.steerTurn")}
          steerDisabled={
            state.streamingTurnId === null
            || desktopApi?.lyra === null
            || desktopApi?.lyra === undefined
          }
          onHeightChange={(height) => {
            setComposerHeight(height);
          }}
          onStop={handleInterruptTurn}
        />
      </div>
    </AiPanelSurfaceFrame>
  );
};
