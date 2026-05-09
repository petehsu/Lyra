import type { CSSProperties } from "react";

import type { createTranslator } from "../i18n";
import type { AgentComposerModelOption } from "./agent-composer-types";

export const AGENT_COMPOSER_MIN_HEIGHT = 44;
export const AGENT_COMPOSER_MAX_HEIGHT = 184;

type Translator = ReturnType<typeof createTranslator>;

export type AgentComposerSendVisualState = "idle" | "ready" | "sending";

export type AgentComposerModelGroup = {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly options: readonly AgentComposerModelOption[];
};

export type AgentComposerModelState = {
  readonly resolvedPlanModeLabel: string;
  readonly resolvedModelAriaLabel: string;
  readonly resolvedSteerLabel: string;
  readonly resolvedModelOptions: readonly AgentComposerModelOption[];
  readonly modelProviderGroups: readonly AgentComposerModelGroup[];
  readonly resolvedSelectedModelName: string | null;
  readonly resolvedSelectedProviderId: string | null;
  readonly canOpenModelMenu: boolean;
  readonly selectedModelLabel: string;
  readonly modelMenuStyle: CSSProperties;
};

const DEFAULT_MODEL_PROVIDER_ID = "default";
const DEFAULT_MODEL_PROVIDER_LABEL = "Default";

export const normalizeComposerModelOptions = ({
  modelOptions,
  modelNames
}: {
  readonly modelOptions?: readonly AgentComposerModelOption[] | undefined;
  readonly modelNames: readonly string[];
}): readonly AgentComposerModelOption[] => {
  const sourceOptions: readonly AgentComposerModelOption[] =
    modelOptions ?? modelNames.map((entry) => ({ value: entry, label: entry }));
  return sourceOptions
    .map((entry) => {
      const value = entry.value.trim();
      const providerId = (entry.providerId ?? entry.modelProvider ?? "").trim();
      const providerLabel = (entry.providerLabel ?? providerId).trim();
      return {
        value,
        label: entry.label.trim().length > 0 ? entry.label.trim() : value,
        ...(providerId.length === 0 ? {} : { providerId }),
        ...(providerLabel.length === 0 ? {} : { providerLabel }),
        ...(entry.modelProvider === undefined ? {} : { modelProvider: entry.modelProvider })
      };
    })
    .filter((entry, index, entries) =>
      entry.value.length > 0 && entries.findIndex((candidate) => candidate.value === entry.value) === index
    );
};

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
  const longestProviderLength = Math.max(
    0,
    ...modelOptions.map((option) =>
      (option.providerLabel ?? option.providerId ?? option.modelProvider ?? DEFAULT_MODEL_PROVIDER_LABEL).length
    )
  );
  const safeCharacterWidth = Math.min(36, Math.max(12, longestLabelLength));
  const safeProviderWidth = Math.min(22, Math.max(10, longestProviderLength));
  return {
    "--lyra-ai-agent-model-menu-w": `clamp(var(--lyra-unit-160), calc(${String(safeCharacterWidth)}ch + var(--lyra-unit-52)), min(58cqw, var(--lyra-unit-320)))`,
    "--lyra-ai-agent-model-provider-menu-w": `clamp(var(--lyra-unit-112), calc(${String(safeProviderWidth)}ch + var(--lyra-unit-44)), var(--lyra-unit-184))`
  } as CSSProperties;
};

const resolveLabel = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim().length > 0 ? value : fallback;

export const groupComposerModelOptions = (
  modelOptions: readonly AgentComposerModelOption[]
): readonly AgentComposerModelGroup[] => {
  const groups = new Map<string, AgentComposerModelGroup>();
  for (const option of modelOptions) {
    const providerId = (option.providerId ?? option.modelProvider ?? DEFAULT_MODEL_PROVIDER_ID).trim()
      || DEFAULT_MODEL_PROVIDER_ID;
    const providerLabel = (option.providerLabel ?? providerId).trim() || DEFAULT_MODEL_PROVIDER_LABEL;
    const existing = groups.get(providerId);
    if (existing === undefined) {
      groups.set(providerId, {
        providerId,
        providerLabel,
        options: [option],
      });
      continue;
    }
    groups.set(providerId, {
      ...existing,
      options: [...existing.options, option],
    });
  }
  return [...groups.values()];
};

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
  const modelProviderGroups = groupComposerModelOptions(resolvedModelOptions);
  const selectedModelOption = resolvedModelOptions.find((option) => option.value === resolvedSelectedModelName);
  const selectedProviderId = (selectedModelOption?.providerId ?? selectedModelOption?.modelProvider ?? "").trim();
  const resolvedSelectedProviderId = selectedProviderId.length > 0
    ? selectedProviderId
    : selectedModelOption === undefined
      ? modelProviderGroups[0]?.providerId ?? null
      : DEFAULT_MODEL_PROVIDER_ID;

  return {
    resolvedPlanModeLabel: resolveLabel(planModeLabel, t("ai.planMode")),
    resolvedModelAriaLabel: resolveLabel(modelAriaLabel, t("ai.modelLabel")),
    resolvedSteerLabel: resolveLabel(steerLabel, t("ai.steerTurn")),
    resolvedModelOptions,
    modelProviderGroups,
    resolvedSelectedModelName,
    resolvedSelectedProviderId,
    canOpenModelMenu:
      resolvedModelOptions.length > 1 && !modelSwitchDisabled && onModelSelectAvailable,
    selectedModelLabel,
    modelMenuStyle: createComposerModelMenuStyle(resolvedModelOptions)
  };
};
