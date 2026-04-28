import { AgentComposer } from "./agent-composer";
import type { AgentComposerFileAttachment } from "./agent-composer";
import { AiPanelInteractionShell } from "./interaction-shell";
import { AiPermissionsPanel } from "./permissions-panel";
import { ReviewStartPanel } from "./review-start-panel";
import { EMPTY_THREAD_STYLE, type AiPanelSurfaceTextLabels } from "./surface-model";
import { AiPanelSurfaceFrame } from "./surface-frame";
import { AiPanelThreadTabs } from "./thread-tabs";
import { AiPanelThreadView } from "./thread-view";
import { AiPanelTopbarActions } from "./topbar-actions";
import type { AiPanelSide, AiPanelSurfaceProps } from "./types";
import type { AiPanelSurfaceRuntime } from "./use-ai-panel-surface-runtime";
import type { WorkbenchLocale } from "../i18n";
import { useState } from "react";

const LOGO_URL = new URL("../../../renderer/assets/logo.svg", import.meta.url).toString();

type AiPanelSurfaceViewProps = {
  readonly surfaceProps: AiPanelSurfaceProps;
  readonly locale: WorkbenchLocale;
  readonly richRenderingEnabled: boolean;
  readonly aiPanelSide: AiPanelSide;
  readonly textLabels: AiPanelSurfaceTextLabels;
  readonly runtime: AiPanelSurfaceRuntime;
};

export const AiPanelSurfaceView = ({
  surfaceProps,
  locale,
  richRenderingEnabled,
  aiPanelSide,
  textLabels,
  runtime
}: AiPanelSurfaceViewProps) => {
  const {
    variant,
    desktopApi,
    title,
    themeSignature,
    newSessionTitle,
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
    toolStatusRunningLabel,
    toolStatusCompletedLabel,
    toolStatusFailedLabel,
    onOpenHistory,
    onOpenMcp,
    onOpenSkills,
    onOpenPlugins,
    onRequestProjectBind
  } = surfaceProps;
  const { state, viewModel, actions } = runtime;
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
  const [isReviewStarting, setIsReviewStarting] = useState(false);

  const topbarStart = (
    <AiPanelThreadTabs
      tabs={state.threadTabs}
      activeTabId={state.activeTabId}
      newThreadLabel={newSessionTitle}
      closeThreadLabel={textLabels.closeThread}
      draftTitle={newSessionTitle}
      onActivateTab={actions.activateThreadTab}
      onCloseTab={actions.closeThreadTab}
      onCreateTab={() => {
        actions.createThread();
      }}
    />
  );

  const topbarActions = (
    <AiPanelTopbarActions
      onRequestProjectBind={onRequestProjectBind === undefined || bindProjectLabel === undefined
        ? undefined
        : () => {
            void actions.bindProject();
          }}
      activeBoundProjectName={runtime.boundProjectRootForActiveThread}
      isBindingProject={runtime.isBindingProject}
      bindProjectLabel={bindProjectLabel ?? ""}
      isAgentAvailable={runtime.isAgentAvailable}
      onOpenHistory={onOpenHistory}
      onOpenMcp={onOpenMcp}
      onOpenSkills={onOpenSkills}
      onOpenPlugins={onOpenPlugins}
      onOpenPermissions={() => {
        actions.setIsPermissionsPanelOpen(true);
      }}
      openHistoryLabel={openHistoryLabel}
      openMcpLabel={openMcpLabel}
      openSkillsLabel={openSkillsLabel}
      openPluginsLabel={surfaceProps.openPluginsLabel}
      openPermissionsLabel={textLabels.permissions}
      onStartReview={state.activeThreadId === null ? undefined : () => {
        setIsReviewPanelOpen(true);
      }}
      reviewChangesLabel={textLabels.reviewChanges}
      aiPanelSide={aiPanelSide}
      onToggleAiPanelSide={onToggleAiPanelSide}
      movePanelToLeftLabel={movePanelToLeftLabel}
      movePanelToRightLabel={movePanelToRightLabel}
      moreActionsLabel={textLabels.moreActions}
    />
  );

  return (
    <AiPanelSurfaceFrame
      variant={variant}
      ariaLabel={title}
      topbarStart={topbarStart}
      topbarActions={topbarActions}
    >
      <div className="lyra-ai-agent-shell" style={runtime.composerReserveStyle}>
        <div className="lyra-ai-agent-thread-shell">
          <AiPanelThreadView
            logoUrl={LOGO_URL}
            locale={locale}
            isZhLocale={locale === "zh-CN"}
            title={title}
            richRenderingEnabled={richRenderingEnabled}
            {...(themeSignature === undefined ? {} : { themeSignature })}
            showEmptySessionScene={runtime.showEmptySessionScene}
            isLoading={state.isLoadingThread || state.isLoadingThreads}
            loadingSessionLabel={loadingSessionLabel}
            emptyThreadLabel={emptyThreadLabel}
            threadRef={runtime.threadViewportRef}
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
            toolNameLabels={runtime.toolNameLabels}
            toolStatusRunningLabel={toolStatusRunningLabel}
            toolStatusCompletedLabel={toolStatusCompletedLabel}
            toolStatusFailedLabel={toolStatusFailedLabel}
            pendingInteractionQueue={state.pendingInteractionQueue}
            canOpenFilePath={runtime.canOpenFilePath}
            openRuntimeTargetPath={runtime.openRuntimeTargetPath}
            typewriterText={runtime.typewriterText}
            streamingTurnRuntimeFeed={viewModel.streamingTurnRuntimeFeed}
            streamingStatus={viewModel.streamingStatus}
            orphanRuntimeFeed={viewModel.orphanRuntimeFeed}
            runtimeError={state.runtimeError}
            planByTurn={state.planByTurn}
            latestPlanTurnId={state.latestPlanTurnId}
            planActionsEnabled={!state.isSending && !state.isStreamActive}
            copyMessageLabel={textLabels.copyMessage}
            copiedMessageLabel={textLabels.copiedMessage}
            forkResponseLabel={textLabels.forkResponse}
            regenerateResponseLabel={textLabels.regenerateResponse}
            editMessageLabel={textLabels.editMessage}
            onForkTurn={(turnId) => {
              void actions.forkTurn(turnId);
            }}
            onRegenerateTurn={actions.regenerateTurn}
            onEditMessageTurn={actions.editMessageTurn}
            onPlanApprovalDecision={actions.planApprovalDecision}
            onOpenPlanApprovalInPanel={actions.setActiveInteractionId}
            onOpenThread={actions.openThreadTab}
          />
        </div>

        <AiPanelInteractionShell
          locale={locale}
          panelRef={runtime.interactionPanelRef}
          activeInteractionPanel={state.activeInteractionPanel}
          activePendingInteraction={state.activePendingInteraction}
          pendingInteractionQueue={state.pendingInteractionQueue}
          activeInteractionPosition={state.activeInteractionPosition}
          pendingInteractionsLabel={textLabels.pendingInteractions}
          navPreviousLabel={textLabels.navPrevious}
          navNextLabel={textLabels.navNext}
          onSelectInteractionId={actions.setActiveInteractionId}
          onCommandApprovalDecision={actions.respondToCommandApproval}
          onPlanQuestionSubmit={actions.respondToPlanQuestion}
          onPlanApprovalDecision={actions.planApprovalDecision}
        />

        {runtime.isPermissionsPanelOpen ? (
          <AiPermissionsPanel
            desktopApi={desktopApi}
            locale={locale}
            onClose={() => {
              actions.setIsPermissionsPanelOpen(false);
            }}
          />
        ) : null}

        {isReviewPanelOpen ? (
          <ReviewStartPanel
            locale={locale}
            isStarting={isReviewStarting}
            onClose={() => {
              setIsReviewPanelOpen(false);
            }}
            onStart={async (target) => {
              setIsReviewStarting(true);
              try {
                await actions.startReview(target);
                setIsReviewPanelOpen(false);
              } finally {
                setIsReviewStarting(false);
              }
            }}
          />
        ) : null}

        <AgentComposer
          locale={locale}
          currentThreadId={state.activeThreadId}
          appendRequest={runtime.composerAppendRequest}
          modelOptions={runtime.modelOptions}
          selectedModelName={runtime.selectedModelOption?.value ?? null}
          modelAriaLabel={textLabels.model}
          onModelSelect={actions.setSelectedModelOptionValue}
          modelSwitchDisabled={runtime.isBusy}
          reasoningEffortOptions={runtime.reasoningEffortOptions}
          selectedReasoningEffort={runtime.selectedReasoningEffort ?? null}
          onReasoningEffortSelect={actions.setSelectedReasoningEffort}
          verbosityOptions={runtime.verbosityOptions}
          selectedVerbosity={runtime.selectedVerbosity ?? null}
          onVerbositySelect={actions.setSelectedVerbosity}
          permissionMode={runtime.permissionMode}
          permissionModeDisabled={runtime.isBusy}
          onPermissionModeSelect={actions.setPermissionMode}
          ariaLabel={composeAriaLabel ?? title}
          placeholder={composePlaceholder ?? ""}
          sendLabel={composeSendLabel ?? "Send"}
          followEnabled={state.followEnabled}
          followLabel={textLabels.followMode}
          onFollowToggle={actions.toggleFollow}
          onSendWithFollow={actions.enableFollow}
          inputDisabled={!runtime.isAgentAvailable}
          sendDisabled={!runtime.isAgentAvailable}
          sending={runtime.isBusy}
          stopDisabled={
            state.streamingTurnId === null
            || !runtime.isAgentAvailable
          }
          planModeEnabled={state.planModeEnabled}
          planModeLocked={runtime.selectedModelOption === null || runtime.isBusy}
          planModeLabel={state.planModeEnabled ? textLabels.planModeArmed : textLabels.planMode}
          onPlanModeToggle={actions.togglePlanMode}
          onRequestFileAttachments={
            desktopApi?.files === undefined
              ? undefined
              : async (): Promise<readonly AgentComposerFileAttachment[]> =>
                (await desktopApi.files.selectAttachments()).map((attachment) => ({
                  ...attachment,
                  id: `system-picker:${attachment.kind}:${attachment.path}`,
                  source: "system-picker" as const,
                }))
          }
          fileMentionSearchRoots={runtime.fileMentionSearchRoots}
          fileMentionSearchResults={runtime.fileMentionSearchResults}
          onFileMentionSearchStart={actions.startFileMentionSearch}
          onFileMentionSearchUpdate={actions.updateFileMentionSearch}
          onFileMentionSearchStop={actions.stopFileMentionSearch}
          onSend={actions.sendTurn}
          onSteer={actions.steerActiveTurn}
          steerLabel={textLabels.steerTurn}
          steerDisabled={
            state.streamingTurnId === null
            || !runtime.isAgentAvailable
          }
          onHeightChange={(height) => {
            actions.setComposerHeight(height);
          }}
          onStop={actions.interruptTurn}
        />
      </div>
    </AiPanelSurfaceFrame>
  );
};
