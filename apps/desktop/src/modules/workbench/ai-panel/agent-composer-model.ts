import type { CSSProperties } from "react";

import type { createTranslator } from "../i18n";
import type { AgentComposerModelOption, AgentPermissionMode } from "./agent-composer-types";

export const AGENT_COMPOSER_MIN_HEIGHT = 44;
export const AGENT_COMPOSER_MAX_HEIGHT = 184;

type Translator = ReturnType<typeof createTranslator>;

export type AgentComposerSendVisualState = "idle" | "ready" | "sending";

export type AgentComposerPermissionModeOption = {
  readonly value: AgentPermissionMode;
  readonly label: string;
};

export type AgentComposerModelState = {
  readonly resolvedPlanModeLabel: string;
  readonly resolvedModelAriaLabel: string;
  readonly resolvedSteerLabel: string;
  readonly resolvedModelOptions: readonly AgentComposerModelOption[];
  readonly resolvedSelectedModelName: string | null;
  readonly canOpenModelMenu: boolean;
  readonly selectedModelLabel: string;
  readonly modelMenuStyle: CSSProperties;
  readonly permissionModeOptions: readonly AgentComposerPermissionModeOption[];
};

export const normalizeComposerModelOptions = ({
  modelOptions,
  modelNames
}: {
  readonly modelOptions?: readonly AgentComposerModelOption[] | undefined;
  readonly modelNames: readonly string[];
}): readonly AgentComposerModelOption[] =>
  (modelOptions ?? modelNames.map((entry) => ({ value: entry, label: entry })))
    .map((entry) => ({
      value: entry.value.trim(),
      label: entry.label.trim().length > 0 ? entry.label.trim() : entry.value.trim()
    }))
    .filter((entry, index, entries) =>
      entry.value.length > 0 && entries.findIndex((candidate) => candidate.value === entry.value) === index
    );

export const resolveSelectedComposerModelName = ({
  selectedModelName,
  modelOptions
}: {
  readonly selectedModelName?: string | null | undefined;
  readonly modelOptions: readonly AgentComposerModelOption[];
}): string | null =>
  selectedModelName !== undefined
    && selectedModelName !== null
    && modelOptions.some((option) => option.value === selectedModelName.trim())
    ? selectedModelName.trim()
    : (modelOptions[0]?.value ?? null);

export const resolveComposerSendVisualState = ({
  sending,
  sendDisabled,
  hasContent
}: {
  readonly sending: boolean;
  readonly sendDisabled: boolean;
  readonly hasContent: boolean;
}): AgentComposerSendVisualState =>
  sending
    ? "sending"
    : !sendDisabled && hasContent
      ? "ready"
      : "idle";

export const resolveAgentComposerClassName = ({
  surfaceDimmed,
  sending
}: {
  readonly surfaceDimmed: boolean;
  readonly sending: boolean;
}): string =>
  surfaceDimmed && !sending
    ? "lyra-ai-agent-composer lyra-ai-agent-composer-disabled"
    : "lyra-ai-agent-composer";

export const createComposerModelMenuStyle = (
  modelOptions: readonly AgentComposerModelOption[]
): CSSProperties => {
  const longestLabelLength = Math.max(
    0,
    ...modelOptions.map((option) => option.label.length)
  );
  const safeCharacterWidth = Math.min(36, Math.max(12, longestLabelLength));
  return {
    "--lyra-ai-agent-model-menu-w": `clamp(var(--lyra-unit-160), calc(${String(safeCharacterWidth)}ch + var(--lyra-unit-52)), min(58cqw, var(--lyra-unit-320)))`
  } as CSSProperties;
};

export const createComposerPermissionModeOptions = (
  t: Translator
): readonly AgentComposerPermissionModeOption[] => [
  { value: "default", label: t("ai.permissionModeDefault") },
  { value: "auto_review", label: t("ai.permissionModeAutoReview") },
  { value: "full_access", label: t("ai.permissionModeFullAccess") }
];

const resolveLabel = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim().length > 0 ? value : fallback;

export const createAgentComposerModelState = ({
  t,
  modelNames,
  modelOptions,
  selectedModelName,
  modelAriaLabel,
  modelSwitchDisabled,
  onModelSelectAvailable,
  planModeLabel,
  steerLabel
}: {
  readonly t: Translator;
  readonly modelNames: readonly string[];
  readonly modelOptions?: readonly AgentComposerModelOption[] | undefined;
  readonly selectedModelName?: string | null | undefined;
  readonly modelAriaLabel?: string | undefined;
  readonly modelSwitchDisabled: boolean;
  readonly onModelSelectAvailable: boolean;
  readonly planModeLabel?: string | undefined;
  readonly steerLabel?: string | undefined;
}): AgentComposerModelState => {
  const resolvedModelOptions = normalizeComposerModelOptions({
    modelOptions,
    modelNames
  });
  const resolvedSelectedModelName = resolveSelectedComposerModelName({
    selectedModelName,
    modelOptions: resolvedModelOptions
  });
  const selectedModelLabel =
    resolvedModelOptions.find((option) => option.value === resolvedSelectedModelName)?.label
    ?? resolvedSelectedModelName
    ?? t("ai.modelLabel");

  return {
    resolvedPlanModeLabel: resolveLabel(planModeLabel, t("ai.planMode")),
    resolvedModelAriaLabel: resolveLabel(modelAriaLabel, t("ai.modelLabel")),
    resolvedSteerLabel: resolveLabel(steerLabel, t("ai.steerTurn")),
    resolvedModelOptions,
    resolvedSelectedModelName,
    canOpenModelMenu:
      resolvedModelOptions.length > 1 && !modelSwitchDisabled && onModelSelectAvailable,
    selectedModelLabel,
    modelMenuStyle: createComposerModelMenuStyle(resolvedModelOptions),
    permissionModeOptions: createComposerPermissionModeOptions(t)
  };
};
