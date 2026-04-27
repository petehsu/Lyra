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
  AgentComposerModelOption,
  AgentComposerProps,
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
  initialValue = "",
  appendRequest = null,
  ariaLabel,
  placeholder,
  sendLabel,
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
  onSteer,
  steerLabel,
  steerDisabled = false,
  onStop,
  stopDisabled = false
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
    onSteer
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
      inputDisabled={inputDisabled}
      sendDisabled={sendDisabled}
      sending={sending}
      planModeEnabled={planModeEnabled}
      planModeLocked={planModeLocked}
      onPlanModeToggle={onPlanModeToggle}
      permissionMode={permissionMode}
      permissionModeDisabled={permissionModeDisabled}
      onPermissionModeSelect={onPermissionModeSelect}
      onModelSelect={onModelSelect}
      onSteer={onSteer}
      steerDisabled={steerDisabled}
      onStop={onStop}
      stopDisabled={stopDisabled}
    />
  );
});

AgentComposer.displayName = "AgentComposer";
