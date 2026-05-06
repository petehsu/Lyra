import { AgentComposer } from "./agent-composer";
import type { AgentComposerFileAttachment } from "./agent-composer";
import { resolveAiPanelEmptyGreetingCandidates } from "./empty-greeting";
import { ExecutionTodoList } from "./execution-todo-list";
import { PendingApprovalList } from "./pending-approval-list";
import { PatchReviewStrip } from "./patch-review-strip";
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
    onRequestProjectBind
  } = surfaceProps;
  const { state, actions } = runtime;
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
        <div className="lyra-ai-agent-thread-shell">
          <AiPanelThreadView
            logoUrl={LOGO_URL}
            blinkLogoUrl={LOGO_BLINK_URL}
            emptyThreadLabel={emptyThreadLabel}
            emptyGreetingLabels={emptyGreetingLabels}
            locale={locale}
            detail={state.activeDetail}
            streamingTurnId={state.streamingTurnId}
            streamingAssistantText={state.streamingAssistantText}
            isLoading={state.isLoadingThreads || state.isLoadingThread}
            runtimeError={state.runtimeError}
            expandedPatchKey={runtime.expandedPatchKey}
            onPatchExpandedChange={actions.setExpandedPatchKey}
            readArtifact={desktopApi?.ai?.readArtifact}
            applyPatch={desktopApi?.ai === undefined ? undefined : actions.applyPatch}
            resolveApproval={desktopApi?.ai === undefined ? undefined : actions.resolveApproval}
          />
        </div>

        <ExecutionTodoList detail={state.activeDetail} />

        <PendingApprovalList
          detail={state.activeDetail}
          resolveApproval={desktopApi?.ai === undefined ? undefined : actions.resolveApproval}
        />

        <PatchReviewStrip
          detail={state.activeDetail}
          expandedPatchKey={runtime.expandedPatchKey}
          onSelectPatch={actions.setExpandedPatchKey}
        />

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
          ariaLabel={composeAriaLabel ?? title}
          placeholder={composePlaceholder ?? ""}
          sendLabel={composeSendLabel ?? "Send"}
          inputDisabled={!runtime.isAgentAvailable}
          sendDisabled={!runtime.isAgentAvailable}
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
