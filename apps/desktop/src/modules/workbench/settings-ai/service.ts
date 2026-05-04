import { useCallback, useMemo, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  AiProviderProfile,
} from "../../../shared/ai";
import {
  parseMap,
  resolveConfiguredModels,
  serializeConfiguredModels,
} from "./draft";
import type {
  SettingsAiDraft,
  SettingsAiLabels,
  SettingsAiModel,
} from "./types";

type UseSettingsAiModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsAiLabels;
};

const DEFAULT_PROVIDER_ID = "lmstudio";
const DEFAULT_PROTOCOL_ID = "lmstudio_chat_completions";

const createDefaultDraft = (): SettingsAiDraft => ({
  id: null,
  name: "",
  providerId: DEFAULT_PROVIDER_ID,
  protocolId: DEFAULT_PROTOCOL_ID,
  presetId: null,
  connectionConfig: {},
  authConfig: {},
  secretValues: {},
  clearSecretFields: [],
  configuredSecretFields: [],
  headersText: "",
  modelsText: serializeConfiguredModels("", []),
  isDefault: false,
});

const updateDraftMapField = (
  source: Readonly<Record<string, string>>,
  fieldId: string,
  value: string
): Readonly<Record<string, string>> => {
  const trimmedId = fieldId.trim();
  if (trimmedId.length === 0) {
    return source;
  }
  const next = { ...source };
  if (value.length === 0) {
    delete next[trimmedId];
    return next;
  }
  next[trimmedId] = value;
  return next;
};

export const useSettingsAiModel = ({
  desktopApi,
  labels,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  void desktopApi;
  const [draft, setDraft] = useState<SettingsAiDraft>(() => createDefaultDraft());
  const [statusMessage, setStatusMessage] = useState(labels.statusIdle);
  const [statusTone, setStatusTone] = useState<SettingsAiModel["statusTone"]>("neutral");

  const configuredModels = useMemo(
    () => resolveConfiguredModels(draft.modelsText, [], ""),
    [draft.modelsText]
  );

  const selectProfile = useCallback((profileId: string | null): void => {
    void profileId;
    setDraft(createDefaultDraft());
    setStatusMessage(labels.statusIdle);
    setStatusTone("neutral");
  }, [labels.statusIdle]);

  const applyPreset = useCallback((presetId: string): void => {
    void presetId;
    setDraft((current) => ({ ...current, presetId: null }));
  }, []);

  const updateDraftName = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, name: value }));
  }, []);

  const updateDraftHeadersText = useCallback((value: string): void => {
    setDraft((current) => ({
      ...current,
      headersText: value,
      connectionConfig: {
        ...current.connectionConfig,
        ...parseMap(value),
      },
    }));
  }, []);

  const updateDraftModelsText = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, modelsText: value }));
  }, []);

  const updateDraftField = useCallback<SettingsAiModel["updateDraftField"]>((target, fieldId, value) => {
    setDraft((current) => {
      if (target === "connection") {
        return {
          ...current,
          connectionConfig: updateDraftMapField(current.connectionConfig, fieldId, value),
        };
      }
      if (target === "auth") {
        return {
          ...current,
          authConfig: updateDraftMapField(current.authConfig, fieldId, value),
        };
      }
      return {
        ...current,
        secretValues: updateDraftMapField(current.secretValues, fieldId, value),
      };
    });
  }, []);

  const clearSecretField = useCallback((fieldId: string): void => {
    setDraft((current) => ({
      ...current,
      secretValues: updateDraftMapField(current.secretValues, fieldId, ""),
      clearSecretFields: fieldId.trim().length === 0
        ? current.clearSecretFields
        : [...new Set([...current.clearSecretFields, fieldId.trim()])],
      configuredSecretFields: current.configuredSecretFields.filter((entry) => entry !== fieldId.trim()),
    }));
  }, []);

  const toggleModelSelection = useCallback((modelId: string): void => {
    const trimmed = modelId.trim();
    if (trimmed.length === 0) {
      return;
    }
    setDraft((current) => {
      const currentModels = resolveConfiguredModels(current.modelsText, [], "").modelIds;
      const nextModels = currentModels.includes(trimmed)
        ? currentModels.filter((entry) => entry !== trimmed)
        : [...currentModels, trimmed];
      return {
        ...current,
        modelsText: nextModels.join("\n"),
      };
    });
  }, []);

  const refreshConfig = useCallback(async (): Promise<void> => {
    setStatusMessage(labels.statusIdle);
    setStatusTone("neutral");
  }, [labels.statusIdle]);

  const refreshModels = useCallback(async (): Promise<void> => {
    setStatusMessage(labels.statusIdle);
    setStatusTone("neutral");
  }, [labels.statusIdle]);

  const validateProfile = useCallback(async (): Promise<void> => {
    setStatusMessage("AI runtime is not connected");
    setStatusTone("error");
  }, []);

  const saveProfile = useCallback(async (): Promise<void> => {
    setStatusMessage("AI runtime is not connected");
    setStatusTone("error");
  }, []);

  const deleteProfile = useCallback(async (): Promise<void> => {
    setDraft(createDefaultDraft());
    setStatusMessage(labels.statusIdle);
    setStatusTone("neutral");
  }, [labels.statusIdle]);

  const setDefaultProfile = useCallback(async (): Promise<void> => {
    setStatusMessage("AI runtime is not connected");
    setStatusTone("error");
  }, []);

  return {
    isLoading: false,
    isSaving: false,
    isRefreshingModels: false,
    statusMessage,
    statusTone,
    runtimeHealth: null,
    profiles: [] as readonly AiProviderProfile[],
    presetSections: [],
    selectedProfileId: null,
    defaultProfileId: null,
    defaultProviderId: null,
    defaultProfileLabel: null,
    defaultModelNames: [],
    selectedPresetId: draft.presetId,
    selectedPreset: null,
    draft,
    availableModels: configuredModels.customModels,
    selectedModelIds: configuredModels.modelIds,
    selectProfile,
    applyPreset,
    updateDraftName,
    updateDraftHeadersText,
    updateDraftModelsText,
    updateDraftField,
    clearSecretField,
    toggleModelSelection,
    refreshConfig,
    refreshModels,
    validateProfile,
    saveProfile,
    deleteProfile,
    setDefaultProfile,
  };
};
