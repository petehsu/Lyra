import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTypewriter } from "./use-typewriter";

import type { AiProviderProfile } from "../../../shared/ai";
import type {
  AgentRuntimeEvent,
  AgentSessionDetail,
} from "../../../shared/desktop-bridge";
import { subscribeAgentSessionSelected } from "../agent-session-events";
import { createTranslator } from "../i18n";
import { AgentComposer } from "./agent-composer";
import {
  type InteractionTextBundle,
} from "./interaction/pending-interaction-mappers";
import {
  type AgentRuntimeFeedItem,
  type ToolNameLabelMap,
} from "./runtime/feed-utils";
import { AiPanelSurfaceFrame } from "./surface-frame";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelPendingInteractions } from "./use-ai-panel-pending-interactions";
import { useAiPanelRuntimeEvents } from "./use-ai-panel-runtime-events";
import { useAiPanelSessionState } from "./use-ai-panel-session-state";
import { useAiPanelSessionActions } from "./use-ai-panel-session-actions";
import { useAiPanelThreadViewModel } from "./use-ai-panel-thread-view-model";
import { AiPanelTopbarActions } from "./topbar-actions";
import { AiPanelStaticReadonlyPanel } from "./static-readonly-panel";
import { AiPanelThreadView } from "./thread-view";
import { AiPanelInteractionShell } from "./interaction-shell";
import {
  extractFolderName,
  sanitizeAssistantDisplayContent,
  trimOptionalText,
  truncateDisplayText,
  type OptimisticUserMessage,
} from "./view-helpers";
const LOGO_URL = new URL("../../../renderer/assets/logo.svg", import.meta.url).toString();

export const AiPanelSurface = ({
  variant,
  desktopApi,
  locale = "en-US",
  title,
  description,
  themeSignature,
  richRenderingEnabled = false,
  newSessionTitle,
  defaultProfileId,
  defaultProfileName,
  defaultModelNames,
  profileLabel,
  modelLabel,
  modelsLabel,
  openHistoryLabel,
  openMcpLabel,
  openSkillsLabel,
  bindProjectLabel,
  composeAriaLabel,
  composePlaceholder,
  composeSendLabel,
  emptyStateTitle,
  emptyStateDescription,
  loadingSessionLabel,
  emptyThreadLabel,
  turnNoToolCallsLabel,
  turnWorkingLabel,
  turnFailedLabel,
  turnWorkedForPrefix,
  runtimeToolFallbackLabel,
  toolNameSearchLabel,
  toolNameReadRangeLabel,
  toolNameListLabel,
  toolNameGlobLabel,
  toolNameWriteLabel,
  toolNameEditLabel,
  toolNameMultiEditLabel,
  onOpenFilePath,
  onWriteStreamEvent,
  onTerminalExecStarted,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onRequestProjectBind
}: AiPanelSurfaceProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const isZhLocale = (locale ?? "en-US").startsWith("zh");
  const hasDefaultProfile = defaultProfileName !== null && defaultProfileName.trim().length > 0;
  const agentApi = desktopApi?.agent;
  const resolvedComposeAriaLabel =
    composeAriaLabel !== undefined && composeAriaLabel.trim().length > 0
      ? composeAriaLabel
      : title;
  const resolvedComposePlaceholder =
    composePlaceholder !== undefined && composePlaceholder.trim().length > 0
      ? composePlaceholder
      : "";
  const resolvedComposeSendLabel =
    composeSendLabel !== undefined && composeSendLabel.trim().length > 0
      ? composeSendLabel
      : "";
  const resolvedBindProjectLabel =
    bindProjectLabel !== undefined && bindProjectLabel.trim().length > 0
      ? bindProjectLabel
      : t("ai.bindProjectLabel");

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
      terminalExec: t("ai.toolNameTerminalExec")
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
  const interactionTextLabels = useMemo<InteractionTextBundle>(
    () => ({
      toolTerminalSession: t("ai.commandToolTerminalSession"),
      toolTerminalInput: t("ai.commandToolTerminalInput"),
      toolTerminalExec: t("ai.commandToolTerminalExec"),
      commandNeedsApproval: t("ai.commandNeedsApproval"),
      proposedPlanSummaryFallback: t("ai.proposedPlanSummaryFallback")
    }),
    [t]
  );

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<AgentSessionDetail | null>(null);
  const [draftInput, setDraftInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isInteractionSubmitting, setIsInteractionSubmitting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const streamingTurnIdRef = useRef<string | null>(null);
  const [finalizingTurnId, setFinalizingTurnId] = useState<string | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState("");
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [latestRuntimeEventByTurn, setLatestRuntimeEventByTurn] =
    useState<Readonly<Record<string, AgentRuntimeEvent>>>({});
  const sanitizedStreamingAssistantText = useMemo(
    () => sanitizeAssistantDisplayContent(streamingAssistantText),
    [streamingAssistantText]
  );
  // During active streaming, show text directly — deltas already provide
  // incremental appearance. Typewriter effect is only used after streaming
  // ends (isStreamActive = false) to animate any remaining buffered text.
  // We always call the hook to respect Rules of Hooks, but pass instant=true
  // during streaming to bypass buffering.
  const typewriterText = useTypewriter(sanitizedStreamingAssistantText, isStreamActive, {
    charsPerSecond: 45,
    minChunkSize: 4,
    instant: isStreamActive
  });
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<readonly OptimisticUserMessage[]>([]);
  const [runtimeFeed, setRuntimeFeed] = useState<readonly AgentRuntimeFeedItem[]>([]);
  const [boundProjectPathBySession, setBoundProjectPathBySession] =
    useState<Readonly<Record<string, string>>>({});
  const [planModeArmedBySession, setPlanModeArmedBySession] =
    useState<Readonly<Record<string, boolean>>>({});
  const [isBindingProject, setIsBindingProject] = useState(false);
  const [composerHeight, setComposerHeight] = useState(96);
  const [interactionPanelHeight, setInteractionPanelHeight] = useState(0);
  const [profiles, setProfiles] = useState<readonly AiProviderProfile[]>([]);
  const [selectedModelBySession, setSelectedModelBySession] =
    useState<Readonly<Record<string, string>>>({});
  const threadRef = useRef<HTMLDivElement>(null);
  const interactionPanelRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  const {
    activeInteractionId,
    setActiveInteractionId,
    transientInteractionPanel,
    setTransientInteractionPanel,
    livePendingInteractionsRef,
    replacePendingInteractions,
    mergePendingInteractionsForSession,
    startPendingInteractionPolling,
    pendingInteractionQueue,
    activePendingInteraction,
    activeInteractionPanel,
    activeInteractionPosition,
  } = useAiPanelPendingInteractions({
    agentApi,
    activeSessionId,
    activeDetail,
    interactionTextLabels,
    setActiveDetail,
    setIsSending,
    setIsStreamActive,
  });
  const threadStyle = useMemo<CSSProperties>(
    () => {
      const composerReserve = Math.max(72, composerHeight);
      const interactionReserve =
        activeInteractionPanel === null ? 0 : Math.max(0, interactionPanelHeight + 16);
      return {
        "--lyra-ai-composer-reserve": `${String(composerReserve)}px`,
        "--lyra-ai-interaction-reserve": `${String(interactionReserve)}px`,
        "--lyra-ai-thread-bottom-reserve": `${String(composerReserve + interactionReserve)}px`,
      } as CSSProperties;
    },
    [activeInteractionPanel, composerHeight, interactionPanelHeight]
  );

  const {
    fallbackModelNames,
    composerModelNames,
    activeComposerModel,
    activeComposerModelOption,
    selectedComposerProfileId,
    isPlanModeArmed,
  } = useAiPanelSessionState({
    profiles,
    activeDetail,
    defaultProfileId,
    defaultModelNames,
    selectedModelBySession,
    setSelectedModelBySession,
    activeSessionId,
    planModeArmedBySession,
    setPlanModeArmedBySession,
  });
  const hasDefaultModels = fallbackModelNames.length > 0;
  const {
    loadProfiles,
    loadSessions,
    loadSessionDetail,
    invalidateSessionDetailRequests,
    sendTurn,
    handleApprovalDecision,
    handlePlanQuestionSubmit,
    handlePlanApprovalDecision,
    bindProject,
  } = useAiPanelSessionActions({
    agentApi,
    desktopApi,
    defaultProfileId,
    newSessionTitle,
    activeSessionId,
    setActiveSessionId,
    activeDetail,
    setActiveDetail,
    activeInteractionPanel,
    draftInput,
    setDraftInput,
    isSending,
    isPlanModeArmed,
    activeComposerModel,
    activeComposerModelOption,
    selectedComposerProfileId,
    setSelectedModelBySession,
    boundProjectPathBySession,
    setBoundProjectPathBySession,
    setProfiles,
    setIsLoading,
    setIsSending,
    setIsInteractionSubmitting,
    setRuntimeError,
    setFinalizingTurnId,
    setOptimisticUserMessages,
    mergePendingInteractionsForSession,
    startPendingInteractionPolling,
    ...(onRequestProjectBind === undefined ? {} : { onRequestProjectBind }),
    isBindingProject,
    setIsBindingProject,
  });

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (agentApi === undefined) {
      return;
    }
    void loadSessions();
  }, [agentApi, loadSessions]);

  useEffect(() => {
    if (agentApi === undefined || activeSessionId === null) {
      setActiveDetail(null);
      return;
    }
    void loadSessionDetail(activeSessionId);
  }, [activeSessionId, agentApi, loadSessionDetail]);

  useEffect(() => {
    setActiveInteractionId(null);
    setTransientInteractionPanel(null);
    setLatestRuntimeEventByTurn({});
    setFinalizingTurnId(null);
    invalidateSessionDetailRequests();
  }, [activeSessionId, invalidateSessionDetailRequests]);

  useEffect(
    () =>
      subscribeAgentSessionSelected((sessionId) => {
        setActiveSessionId(sessionId);
        setRuntimeError(null);
        setRuntimeFeed([]);
        setLatestRuntimeEventByTurn({});
        setIsStreamActive(false);
        setIsInteractionSubmitting(false);
        setStreamingAssistantText("");
        setFinalizingTurnId(null);
        streamingTurnIdRef.current = null;
        setStreamingTurnId(null);
        setOptimisticUserMessages([]);
        if (agentApi !== undefined) {
          void loadSessionDetail(sessionId);
          void loadSessions();
        }
      }),
    [agentApi, loadSessionDetail, loadSessions]
  );

  const { openRuntimeTargetPath } = useAiPanelRuntimeEvents({
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
  });

  const isPlanModeActive = activeDetail?.session.collaborationMode === "plan";
  const isPlanModeLocked = isPlanModeActive || (isSending && isPlanModeArmed);
  const isPlanModeEnabled = isPlanModeActive || isPlanModeArmed;

  const runtimeStatusLabels = useMemo(
    () => ({
      runtimeRunningPrefix: t("ai.runtimeRunningPrefix"),
      pendingInteractions: t("ai.pendingInteractions"),
      waitingPhraseFinalizingReply: t("ai.waitingPhraseFinalizingReply"),
      runtimeFailedTurn: t("ai.runtimeFailedTurn"),
      runtimeQueued: t("ai.runtimeQueued"),
      runtimeStarted: t("ai.runtimeStarted"),
      runtimePhaseToolStarted: t("ai.runtimePhaseToolStarted"),
      runtimePhaseToolFinished: t("ai.runtimePhaseToolFinished"),
      generatingReply: t("ai.generatingReply"),
    }),
    [t]
  );

  const {
    persistedAssistantDisplayByTurn,
    sortedMessages,
    assistantMessageOrderById,
    turnsById,
    toolCallsByTurn,
    runtimeFeedByTurn,
    turnTimelineByTurn,
    displayRuntimeFeed,
    streamingTurnRuntimeFeed,
    streamingStatus,
    orphanRuntimeFeed,
  } = useAiPanelThreadViewModel({
    activeDetail,
    optimisticUserMessages,
    runtimeFeed,
    streamingTurnId,
    latestRuntimeEventByTurn,
    activeInteractionPanel,
    isInteractionSubmitting,
    isSending,
    isStreamActive,
    streamingAssistantText,
    finalizingTurnId,
    toolNameLabels,
    runtimeToolFallbackLabel,
    labels: runtimeStatusLabels,
  });

  useEffect(() => {
    if (finalizingTurnId === null) {
      return;
    }
    if (!persistedAssistantDisplayByTurn.has(finalizingTurnId)) {
      return;
    }
    setFinalizingTurnId(null);
  }, [finalizingTurnId, persistedAssistantDisplayByTurn]);

  const topbarTitle = useMemo(() => {
    const firstUserMessage = sortedMessages.find(
      (message) => message.role === "user" && message.content.trim().length > 0
    );
    if (firstUserMessage === undefined) {
      return null;
    }
    return truncateDisplayText(firstUserMessage.content, 6);
  }, [sortedMessages]);

  const composerPlanLabel = t("ai.planLabel");

  const activeBoundProjectPath = useMemo(() => {
    if (activeSessionId === null) {
      return null;
    }
    return (
      trimOptionalText(boundProjectPathBySession[activeSessionId])
      ?? trimOptionalText(activeDetail?.session.projectRoot)
    );
  }, [activeDetail?.session.projectRoot, activeSessionId, boundProjectPathBySession]);

  const activeBoundProjectName = useMemo(() => {
    if (activeBoundProjectPath === null) {
      return null;
    }
    return truncateDisplayText(extractFolderName(activeBoundProjectPath), 8);
  }, [activeBoundProjectPath]);

  useEffect(() => {
    const node = threadRef.current;
    if (node === null) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [
    activeSessionId,
    displayRuntimeFeed.length,
    sortedMessages.length,
    streamingAssistantText.length,
    streamingStatus?.label
  ]);

  useEffect(() => {
    if (activeInteractionPanel === null) {
      setInteractionPanelHeight(0);
      return;
    }
    const node = interactionPanelRef.current;
    if (node === null) {
      return;
    }
    const reportHeight = (): void => {
      setInteractionPanelHeight(node.offsetHeight);
    };
    reportHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      reportHeight();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [activeInteractionPanel]);

  useEffect(() => {
    if (activeInteractionPanel === null) {
      return;
    }
    const node = interactionPanelRef.current;
    if (node === null) {
      return;
    }
    requestAnimationFrame(() => {
      node.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    });
  }, [activeInteractionId, activeInteractionPanel]);

  const hasPendingInteraction =
    pendingInteractionQueue.length > 0 || transientInteractionPanel !== null;
  const isComposerSurfaceDimmed = activeSessionId === null;
  const isComposerInputDisabled =
    isSending || activeSessionId === null || hasPendingInteraction;
  const isComposerSendDisabled =
    draftInput.trim().length === 0 || activeSessionId === null || hasPendingInteraction;
  const showEmptySessionScene =
    sortedMessages.length === 0
    && streamingAssistantText.length === 0
    && orphanRuntimeFeed.length === 0
    && streamingStatus === null
    && runtimeError === null
    && !isSending;

  const topbarActions = (
    <AiPanelTopbarActions
      activeBoundProjectName={activeBoundProjectName}
      isBindingProject={isBindingProject}
      bindProjectLabel={resolvedBindProjectLabel}
      isAgentAvailable={agentApi !== undefined}
      onRequestProjectBind={onRequestProjectBind === undefined
        ? undefined
        : () => {
            void bindProject();
          }}
      onOpenHistory={onOpenHistory}
      onOpenMcp={onOpenMcp}
      onOpenSkills={onOpenSkills}
      openHistoryLabel={openHistoryLabel}
      openMcpLabel={openMcpLabel}
      openSkillsLabel={openSkillsLabel}
    />
  );

  if (agentApi === undefined) {
    return (
      <AiPanelSurfaceFrame
        variant={variant}
        ariaLabel={title}
        topbarTitle={topbarTitle}
        topbarActions={topbarActions}
      >
        <AiPanelStaticReadonlyPanel
          title={title}
          description={description}
          hasDefaultProfile={hasDefaultProfile}
          hasDefaultModels={hasDefaultModels}
          profileLabel={profileLabel}
          defaultProfileName={defaultProfileName}
          fallbackModelNames={fallbackModelNames}
          modelsLabel={modelsLabel}
          modelLabel={modelLabel}
          emptyStateTitle={emptyStateTitle}
          emptyStateDescription={emptyStateDescription}
          composeAriaLabel={resolvedComposeAriaLabel}
          composePlaceholder={resolvedComposePlaceholder}
          composeSendLabel={resolvedComposeSendLabel}
        />
      </AiPanelSurfaceFrame>
    );
  }

  return (
    <AiPanelSurfaceFrame
      variant={variant}
      ariaLabel={title}
      topbarTitle={topbarTitle}
      topbarActions={topbarActions}
    >
      <div className="lyra-ai-agent-shell">
        <section
          className={
            showEmptySessionScene
              ? "lyra-ai-agent-thread-shell lyra-ai-agent-thread-shell-empty"
              : "lyra-ai-agent-thread-shell"
          }
        >
          <AiPanelThreadView
            logoUrl={LOGO_URL}
            locale={locale}
            isZhLocale={isZhLocale}
            title={title}
            richRenderingEnabled={richRenderingEnabled}
            {...(themeSignature === undefined ? {} : { themeSignature })}
            showEmptySessionScene={showEmptySessionScene}
            isLoading={isLoading}
            loadingSessionLabel={loadingSessionLabel}
            emptyThreadLabel={emptyThreadLabel}
            threadRef={threadRef}
            threadStyle={threadStyle}
            sortedMessages={sortedMessages}
            turnsById={turnsById}
            toolCallsByTurn={toolCallsByTurn}
            runtimeFeedByTurn={runtimeFeedByTurn}
            turnTimelineByTurn={turnTimelineByTurn}
            assistantMessageOrderById={assistantMessageOrderById}
            turnWorkingLabel={turnWorkingLabel}
            turnWorkedForPrefix={turnWorkedForPrefix}
            turnNoToolCallsLabel={turnNoToolCallsLabel}
            turnFailedLabel={turnFailedLabel}
            toolNameLabels={toolNameLabels}
            pendingInteractionQueue={pendingInteractionQueue}
            canOpenFilePath={onOpenFilePath !== undefined}
            openRuntimeTargetPath={openRuntimeTargetPath}
            typewriterText={typewriterText}
            streamingTurnRuntimeFeed={streamingTurnRuntimeFeed}
            streamingStatus={streamingStatus}
            orphanRuntimeFeed={orphanRuntimeFeed}
            runtimeError={runtimeError}
            onPlanApprovalDecision={handlePlanApprovalDecision}
            onOpenPlanApprovalInPanel={(requestId) => {
              setActiveInteractionId(requestId);
            }}
          />
          <AiPanelInteractionShell
            locale={locale}
            panelRef={interactionPanelRef}
            activeInteractionPanel={activeInteractionPanel}
            activePendingInteraction={activePendingInteraction}
            pendingInteractionQueue={pendingInteractionQueue}
            activeInteractionPosition={activeInteractionPosition}
            pendingInteractionsLabel={t("ai.pendingInteractions")}
            navPreviousLabel={t("ai.navPrevious")}
            navNextLabel={t("ai.navNext")}
            onSelectInteractionId={setActiveInteractionId}
            onCommandApprovalDecision={handleApprovalDecision}
            onPlanQuestionSubmit={handlePlanQuestionSubmit}
            onPlanApprovalDecision={handlePlanApprovalDecision}
          />
          <AgentComposer
            locale={locale}
            modelNames={composerModelNames}
            selectedModelName={activeComposerModel}
            modelAriaLabel={modelLabel}
            modelSwitchDisabled={isSending}
            onModelSelect={(modelName) => {
              if (activeSessionId === null) {
                return;
              }
              const normalizedModel = trimOptionalText(modelName);
              if (normalizedModel === null) {
                return;
              }
              setSelectedModelBySession((current) => ({
                ...current,
                [activeSessionId]: normalizedModel
              }));
            }}
            value={draftInput}
            ariaLabel={resolvedComposeAriaLabel}
            placeholder={resolvedComposePlaceholder}
            sendLabel={resolvedComposeSendLabel}
            inputDisabled={isComposerInputDisabled}
            sendDisabled={isComposerSendDisabled}
            sending={isSending}
            surfaceDimmed={isComposerSurfaceDimmed}
            planModeEnabled={isPlanModeEnabled}
            planModeLocked={isPlanModeLocked}
            planModeLabel={composerPlanLabel}
            onPlanModeToggle={() => {
              if (activeSessionId === null || isPlanModeLocked) {
                return;
              }
              setPlanModeArmedBySession((current) => ({
                ...current,
                [activeSessionId]: !(current[activeSessionId] === true)
              }));
            }}
            onHeightChange={setComposerHeight}
            onValueChange={setDraftInput}
            onSend={() => {
              void sendTurn();
            }}
          />
        </section>
      </div>
    </AiPanelSurfaceFrame>
  );
};
