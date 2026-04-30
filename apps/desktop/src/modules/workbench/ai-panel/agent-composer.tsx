import { memo, useMemo } from "react";

import { createTranslator } from "../i18n";
import {
  createAgentComposerModelState,
  resolveAgentComposerClassName,
  resolveComposerSendVisualState
} from "./agent-composer-model";
import type { AgentComposerProps } from "./agent-composer-types";
import { AgentComposerView } from "./agent-composer-view";
import { useAgentComposerRuntime } from "./use-agent-composer-runtime";

export type {
  AgentComposerAppendRequest,
  AgentComposerFileAttachment,
  AgentComposerFileMentionSearchResult,
  AgentComposerModelControlOption,
  AgentComposerModelOption,
  AgentComposerReasoningEffort,
  AgentComposerVerbosity,
  AgentComposerProps,
  AgentComposerSubmitPayload,
  AgentPermissionMode
} from "./agent-composer-types";

export const AgentComposer = memo(({
  locale = "en-US",
  currentThreadId = null,
  modelNames = [],
  modelOptions,
  selectedModelName,
  modelAriaLabel,
  modelSwitchDisabled = false,
  onModelSelect,
  reasoningEffortOptions = [],
  selectedReasoningEffort = null,
  reasoningEffortLabel,
  onReasoningEffortSelect,
  verbosityOptions = [],
  selectedVerbosity = null,
  verbosityLabel,
  onVerbositySelect,
  initialValue = "",
  appendRequest = null,
  ariaLabel,
  placeholder,
  sendLabel,
  followLabel,
  followEnabled = false,
  inputDisabled,
  sendDisabled,
  sending,
  surfaceDimmed = false,
  planModeEnabled = false,
  planModeLocked = false,
  planModeLabel,
  onPlanModeToggle,
  permissionMode = "default",
  permissionModeDisabled = false,
  onPermissionModeSelect,
  onHeightChange,
  onSend,
  onSendWithFollow,
  onFollowToggle,
  onSteer,
  steerLabel,
  steerDisabled = false,
  onStop,
  stopDisabled = false,
  addFileLabel,
  removeAttachmentLabel,
  onRequestFileAttachments,
  fileMentionSearchRoots,
  fileMentionSearchResults,
  onFileMentionSearchStart,
  onFileMentionSearchUpdate,
  onFileMentionSearchStop
}: AgentComposerProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const runtime = useAgentComposerRuntime({
    currentThreadId,
    initialValue,
    appendRequest,
    inputDisabled,
    sendDisabled,
    sending,
    onHeightChange,
    onSend,
    onSendWithFollow,
    onSteer,
    fileMentionSearchRoots,
    fileMentionSearchResults,
    onFileMentionSearchStart,
    onFileMentionSearchUpdate,
    onFileMentionSearchStop
  });
  const modelState = useMemo(
    () => createAgentComposerModelState({
      t,
      modelNames,
      modelOptions,
      selectedModelName,
      modelAriaLabel,
      modelSwitchDisabled,
      onModelSelectAvailable: onModelSelect !== undefined,
      planModeLabel,
      steerLabel
    }),
    [
      modelAriaLabel,
      modelNames,
      modelOptions,
      modelSwitchDisabled,
      onModelSelect,
      planModeLabel,
      selectedModelName,
      steerLabel,
      t
    ]
  );
  const composerClassName = resolveAgentComposerClassName({
    surfaceDimmed,
    sending
  });
  const sendVisualState = resolveComposerSendVisualState({
    sending,
    sendDisabled,
    hasContent: runtime.hasContent
  });

  return (
    <AgentComposerView
      composerClassName={composerClassName}
      composerMenuLabel={t("ai.composerMenuLabel")}
      permissionModeLabel={t("ai.permissionModeLabel")}
      sendVisualState={sendVisualState}
      modelState={modelState}
      runtime={runtime}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      sendLabel={sendLabel}
      followLabel={followLabel ?? t("ai.followMode")}
      followEnabled={followEnabled}
      addFileLabel={addFileLabel ?? t("ai.addFileAttachment")}
      removeAttachmentLabel={removeAttachmentLabel ?? t("ai.removeFileAttachment")}
      fileMentionNoMatchesLabel={t("ai.fileMentionNoMatches")}
      inputDisabled={inputDisabled}
      sendDisabled={sendDisabled}
      sending={sending}
      modelSwitchDisabled={modelSwitchDisabled}
      planModeEnabled={planModeEnabled}
      planModeLocked={planModeLocked}
      onPlanModeToggle={onPlanModeToggle}
      permissionMode={permissionMode}
      permissionModeDisabled={permissionModeDisabled}
      onPermissionModeSelect={onPermissionModeSelect}
      onModelSelect={onModelSelect}
      reasoningEffortOptions={reasoningEffortOptions}
      selectedReasoningEffort={selectedReasoningEffort}
      reasoningEffortLabel={reasoningEffortLabel ?? t("ai.reasoningEffortLabel")}
      onReasoningEffortSelect={onReasoningEffortSelect}
      verbosityOptions={verbosityOptions}
      selectedVerbosity={selectedVerbosity}
      verbosityLabel={verbosityLabel ?? t("ai.verbosityLabel")}
      onVerbositySelect={onVerbositySelect}
      onFollowToggle={onFollowToggle}
      onRequestFileAttachments={onRequestFileAttachments}
      onSteer={onSteer}
      steerDisabled={steerDisabled}
      onStop={onStop}
      stopDisabled={stopDisabled}
    />
  );
});

AgentComposer.displayName = "AgentComposer";
