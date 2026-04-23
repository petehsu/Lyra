import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PlanInteractionResponse } from "../../../shared/agent";
import { createTranslator } from "../i18n";
import { subscribeThreadSelected } from "../thread-selection-events";
import { AgentComposer } from "./agent-composer";
import { AiPanelInteractionShell } from "./interaction-shell";
import { buildThreadTitle } from "./lyra-thread-adapter";
import {
  toPersistedRuntimeFeedItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import { AiPanelSurfaceFrame } from "./surface-frame";
import { AiPanelThreadView } from "./thread-view";
import { AiPanelTopbarActions } from "./topbar-actions";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelThreadViewModel } from "./use-ai-panel-thread-view-model";
import { useLyraThreadRuntime } from "./use-lyra-thread-runtime";
import { useTypewriter } from "./use-typewriter";

const LOGO_URL = new URL("../../../renderer/assets/logo.svg", import.meta.url).toString();

export const AiPanelSurface = ({
  variant,
  desktopApi,
  locale = "en-US",
  title,
  themeSignature,
  richRenderingEnabled = true,
  newSessionTitle,
  defaultProviderId,
  defaultProfileName,
  defaultModelNames,
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
  runtimeRunningPrefix,
  runtimeFailedTurnLabel,
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
  onWriteStreamEvent: _onWriteStreamEvent,
  onTerminalExecStarted: _onTerminalExecStarted,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onRequestProjectBind,
}: AiPanelSurfaceProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [draftInput, setDraftInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(defaultModelNames[0] ?? "");
  const [availableModels, setAvailableModels] = useState<readonly string[]>(defaultModelNames);
  const [cwdOverride, setCwdOverride] = useState<string | null>(null);
  const [isBindingProject, setIsBindingProject] = useState(false);
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
    createThread: createRuntimeThread,
    interruptTurn,
    respondToCommandApproval,
    respondToPlanQuestion,
    selectThread,
    sendTurn: sendRuntimeTurn,
    setActiveInteractionId,
  } = actions;

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
    { charsPerSecond: 72, minChunkSize: 4 }
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
      runtimeRunningPrefix,
      pendingInteractions: t("ai.pendingInteractions"),
      waitingPhraseFinalizingReply: t("ai.waitingPhraseFinalizingReply"),
      runtimeFailedTurn: runtimeFailedTurnLabel,
      runtimeQueued: runtimeQueuedLabel,
      runtimeStarted: runtimeStartedLabel,
      runtimePhaseToolStarted: runtimePhaseToolStartedLabel,
      runtimePhaseToolFinished: runtimePhaseToolFinishedLabel,
      generatingReply: t("ai.generatingReply"),
    },
  });

  useEffect(() => {
    setAvailableModels(defaultModelNames);
    setSelectedModel((current) => current.trim().length > 0 ? current : (defaultModelNames[0] ?? ""));
  }, [defaultModelNames]);

  useEffect(() => {
    return subscribeThreadSelected((threadId) => {
      selectThread(threadId);
    });
  }, [selectThread]);

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
      const nextPath = await onRequestProjectBind(cwdOverride ?? state.activeThread?.cwd ?? undefined);
      if (typeof nextPath === "string" && nextPath.trim().length > 0) {
        setCwdOverride(nextPath.trim());
      }
    } finally {
      setIsBindingProject(false);
    }
  }, [cwdOverride, isBindingProject, onRequestProjectBind, state.activeThread?.cwd]);

  const sendTurn = useCallback(async (): Promise<void> => {
    const text = draftInput.trim();
    if (text.length === 0) {
      return;
    }
    setDraftInput("");
    try {
      await sendRuntimeTurn(text, {
        model: selectedModel,
        modelProvider: defaultProviderId,
        cwd: cwdOverride,
      });
    } catch {
      setDraftInput(text);
    }
  }, [cwdOverride, defaultProviderId, draftInput, selectedModel, sendRuntimeTurn]);

  const createThread = useCallback(async (): Promise<void> => {
    await createRuntimeThread({
      model: selectedModel,
      modelProvider: defaultProviderId,
      cwd: cwdOverride,
    });
  }, [createRuntimeThread, cwdOverride, defaultProviderId, selectedModel]);

  const handlePlanApprovalDecision = useCallback(async (
    _response: PlanInteractionResponse
  ): Promise<void> => {
    return;
  }, []);

  const topbarActions = (
    <AiPanelTopbarActions
      onCreateThread={() => {
        void createThread();
      }}
      createThreadLabel={newSessionTitle}
      onRequestProjectBind={onRequestProjectBind === undefined || bindProjectLabel === undefined
        ? undefined
        : () => {
            void handleBindProject();
          }}
      activeBoundProjectName={cwdOverride ?? state.activeThread?.cwd ?? null}
      isBindingProject={isBindingProject}
      bindProjectLabel={bindProjectLabel ?? ""}
      isAgentAvailable={desktopApi?.lyra !== null && desktopApi?.lyra !== undefined}
      onOpenHistory={onOpenHistory}
      onOpenMcp={onOpenMcp}
      onOpenSkills={onOpenSkills}
      openHistoryLabel={openHistoryLabel}
      openMcpLabel={openMcpLabel}
      openSkillsLabel={openSkillsLabel}
    />
  );

  const topbarTitle = state.activeThread === null
    ? defaultProfileName ?? null
    : buildThreadTitle(state.activeThread, defaultProfileName ?? title);
  const showEmptySessionScene =
    (state.activeDetail?.messages.length ?? 0) === 0
    && state.optimisticUserMessages.length === 0
    && state.streamingAssistantText.length === 0
    && !state.isStreamActive;
  const isBusy = state.isSending || state.isStreamActive;

  return (
    <AiPanelSurfaceFrame
      variant={variant}
      ariaLabel={title}
      topbarTitle={topbarTitle}
      topbarActions={topbarActions}
    >
      <div className="lyra-ai-agent-shell">
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
            threadStyle={{}}
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
            pendingInteractionQueue={state.pendingInteractionQueue}
            canOpenFilePath={onOpenFilePath !== undefined}
            openRuntimeTargetPath={openRuntimeTargetPath}
            typewriterText={typewriterText}
            streamingTurnRuntimeFeed={viewModel.streamingTurnRuntimeFeed}
            streamingStatus={viewModel.streamingStatus}
            orphanRuntimeFeed={viewModel.orphanRuntimeFeed}
            runtimeError={state.runtimeError}
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

        <AgentComposer
          locale={locale}
          modelNames={availableModels}
          selectedModelName={selectedModel}
          modelAriaLabel={t("ai.modelLabel")}
          onModelSelect={setSelectedModel}
          value={draftInput}
          ariaLabel={composeAriaLabel ?? title}
          placeholder={composePlaceholder ?? ""}
          sendLabel={composeSendLabel ?? "Send"}
          inputDisabled={desktopApi?.lyra === null || desktopApi?.lyra === undefined}
          sendDisabled={
            draftInput.trim().length === 0
            || desktopApi?.lyra === null
            || desktopApi?.lyra === undefined
          }
          sending={isBusy}
          stopDisabled={
            state.streamingTurnId === null
            || desktopApi?.lyra === null
            || desktopApi?.lyra === undefined
          }
          planModeEnabled={false}
          planModeLocked
          onValueChange={setDraftInput}
          onSend={() => {
            void sendTurn();
          }}
          onStop={() => {
            void interruptTurn();
          }}
        />
      </div>
    </AiPanelSurfaceFrame>
  );
};
