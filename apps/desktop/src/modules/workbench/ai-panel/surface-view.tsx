import { AgentComposer } from "./agent-composer";
import type { AgentComposerFileAttachment } from "./agent-composer";
import { AgentTodoRail } from "./agent-todo-rail";
import { hasPendingClarification } from "./clarification-model";
import { resolveAiPanelEmptyGreetingCandidates } from "./empty-greeting";
import { RollbackMessageAction } from "./rollback-message-action";
import type { AiPanelSurfaceTextLabels } from "./surface-model";
import { AiPanelSurfaceFrame } from "./surface-frame";
import { AiPanelThreadTabs } from "./thread-tabs";
import { AiPanelThreadView } from "./thread-view";
import { AiPanelTopbarActions } from "./topbar-actions";
import type { AiPanelSide, AiPanelSurfaceProps } from "./types";
import type { AiPanelSurfaceRuntime } from "./use-ai-panel-surface-runtime";
import type { WorkbenchLocale } from "../i18n";

const LOGO_URL = new URL("../../../renderer/assets/logo.svg", import.meta.url).toString();
const LOGO_BLINK_URL = new URL("../../../renderer/assets/logo-blink.svg", import.meta.url).toString();

type AiPanelSurfaceViewProps = {
  readonly surfaceProps: AiPanelSurfaceProps;
  readonly locale: WorkbenchLocale;
  readonly aiPanelSide: AiPanelSide;
  readonly textLabels: AiPanelSurfaceTextLabels;
  readonly runtime: AiPanelSurfaceRuntime;
};

export const AiPanelSurfaceView = ({
  surfaceProps,
  locale,
  aiPanelSide,
  textLabels,
  runtime
}: AiPanelSurfaceViewProps) => {
  const {
    variant,
    desktopApi,
    title,
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
    onOpenHistory,
    onOpenMcp,
    onOpenSkills,
    onOpenPlugins,
    onOpenAgentVm,
    onRequestProjectBind
  } = surfaceProps;
  const { state, actions } = runtime;
  const previewMessageRollback = desktopApi?.ai?.previewMessageRollback;
  const executeMessageRollback = desktopApi?.ai?.executeMessageRollback;
  const waitingForClarification = hasPendingClarification(state.activeDetail);
  const emptyGreetingLabels = resolveAiPanelEmptyGreetingCandidates({
    locale,
    appMeta: desktopApi?.appMeta,
    boundProjectRoot: runtime.boundProjectRootForActiveThread,
    fileMentionSearchRoots: runtime.fileMentionSearchRoots,
    workbenchTabMentions: runtime.workbenchTabMentions,
    fallbackLabel: emptyThreadLabel,
    textLabels: textLabels.emptyGreeting
  });

  const topbarStart = (
    <AiPanelThreadTabs
      tabs={state.threadTabs}
      activeTabId={state.activeTabId}
      newThreadLabel={newSessionTitle}
      closeThreadLabel={textLabels.closeThread}
      draftTitle={newSessionTitle}
      tabProjectRootById={runtime.tabProjectRootById}
      isCreatePending={runtime.isCreatingThread}
      onActivateTab={actions.activateThreadTab}
      onCloseTab={actions.closeThreadTab}
      onCreateTab={() => {
        void actions.createThread();
      }}
      onReorderTab={actions.reorderThreadTab}
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
      openHistoryLabel={openHistoryLabel}
      openMcpLabel={openMcpLabel}
      openSkillsLabel={openSkillsLabel}
      openPluginsLabel={surfaceProps.openPluginsLabel}
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
        <AgentTodoRail detail={state.activeDetail} />

        <div className="lyra-ai-agent-thread-shell">
          <AiPanelThreadView
            logoUrl={LOGO_URL}
            blinkLogoUrl={LOGO_BLINK_URL}
            emptyThreadLabel={emptyThreadLabel}
            emptyGreetingLabels={emptyGreetingLabels}
            locale={locale}
            detail={state.activeDetail}
            optimisticUserMessages={state.optimisticUserMessages}
            streamingTurnId={state.streamingTurnId}
            streamingAssistantText={state.streamingAssistantText}
            isLoading={state.isLoadingThreads || state.isLoadingThread}
            runtimeError={state.runtimeError}
            expandedPatchKey={runtime.expandedPatchKey}
            onPatchExpandedChange={actions.setExpandedPatchKey}
            readArtifact={desktopApi?.ai?.readArtifact}
            applyPatch={desktopApi?.ai === undefined ? undefined : actions.applyPatch}
            resolveApproval={desktopApi?.ai === undefined ? undefined : actions.resolveApproval}
            resolveClarification={desktopApi?.ai?.resolveClarification}
            resolvePlanReview={desktopApi?.ai === undefined ? undefined : actions.resolvePlanReview}
            executeMessageRollback={executeMessageRollback}
            onClarificationResolved={actions.refreshActiveThread}
            onRollbackExecuted={actions.refreshActiveThread}
            renderMessageActions={(message) => (
              <RollbackMessageAction
                message={message}
                recoverySummary={state.activeDetail?.recoverySummary}
                previewMessageRollback={previewMessageRollback}
                onPreviewComplete={actions.refreshActiveThread}
              />
            )}
          />
        </div>

        <AgentComposer
          locale={locale}
          currentThreadId={state.activeThreadId}
          appendRequest={runtime.composerAppendRequest}
          modelOptions={runtime.modelOptions}
          selectedModelName={runtime.selectedModelOption?.value ?? null}
          modelAriaLabel={textLabels.model}
          onModelSelect={actions.selectModelOptionValue}
          modelSwitchDisabled={runtime.isBusy}
          reasoningEffortOptions={runtime.reasoningEffortOptions}
          selectedReasoningEffort={runtime.selectedReasoningEffort ?? null}
          onReasoningEffortSelect={actions.setSelectedReasoningEffort}
          verbosityOptions={runtime.verbosityOptions}
          selectedVerbosity={runtime.selectedVerbosity ?? null}
          onVerbositySelect={actions.setSelectedVerbosity}
          environment={{
            permissionMode: runtime.agentEnvironment.permissionMode,
            executionTarget: runtime.agentEnvironment.executionTarget,
            environmentLabel: textLabels.environment,
            permissionLabel: textLabels.permission,
            targetLabel: textLabels.executionTarget,
            agentVmLabel: textLabels.agentVmSection,
            openAgentVmLabel: textLabels.openAgentVm,
            permissionOptions: runtime.permissionModeOptions.map((option) => ({
              value: option.value,
              label: option.value === "full_access"
                ? textLabels.permissionFullAccess
                : textLabels.permissionSandbox,
            })),
            targetOptions: runtime.executionTargetOptions.map((option) => ({
              value: option.value,
              label: option.value === "agent_vm"
                ? textLabels.executionTargetAgentVm
                : textLabels.executionTargetHost,
            })),
            onPermissionModeSelect: actions.setPermissionMode,
            onExecutionTargetSelect: actions.setExecutionTarget,
            ...(onOpenAgentVm === undefined
              ? {}
              : {
                  onOpenAgentVm: () => {
                    onOpenAgentVm({ sessionId: state.activeThreadId });
                  },
                }),
          }}
          ariaLabel={composeAriaLabel ?? title}
          placeholder={waitingForClarification ? "等待澄清回复..." : composePlaceholder ?? ""}
          sendLabel={composeSendLabel ?? "Send"}
          followEnabled={state.followEnabled}
          onFollowToggle={actions.toggleFollow}
          onSendWithFollow={actions.enableFollow}
          inputDisabled={!runtime.isAgentAvailable || waitingForClarification}
          sendDisabled={!runtime.isAgentAvailable || waitingForClarification}
          sending={runtime.isBusy}
          stopDisabled={
            state.streamingTurnId === null
            || !runtime.isAgentAvailable
          }
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
          workbenchTabMentions={runtime.workbenchTabMentions}
          aiThreadMentions={runtime.aiThreadMentions}
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
          onHeightChange={actions.setComposerHeight}
          onStop={actions.interruptTurn}
        />
      </div>
    </AiPanelSurfaceFrame>
  );
};
