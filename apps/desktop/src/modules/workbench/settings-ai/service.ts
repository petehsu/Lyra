import { useCallback, useMemo, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  AiModelDiscoveryState,
  AiProviderModelEntry,
  AiProviderProfile
} from "../../../shared/ai";
import {
  MODEL_SELECTION_MODE_AUTH_CONFIG_KEY,
  findSelectedProfile,
  resolveConfiguredModels,
  toDraft,
} from "./draft";
import { buildModelOptions } from "./model-options";
import { resolvePreset } from "./preset";
import { AI_PROVIDER_PRESETS } from "./providers";
import type {
  SettingsAiDraft,
  SettingsAiLabels,
  SettingsAiModel,
  SettingsAiModelSelectionMode,
  SettingsAiPresetSection,
} from "./types";

type UseSettingsAiModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsAiLabels;
};

const now = (): number => Date.now();

const emptyDiscoveryState = (): AiModelDiscoveryState => ({
  status: "idle",
  lastCheckedAt: null,
  models: []
});

const createDefaultDraft = (): SettingsAiDraft => toDraft(null, AI_PROVIDER_PRESETS);

const sectionLabel = (labels: SettingsAiLabels, section: SettingsAiPresetSection["id"]): string => {
  if (section === "mainstream") return labels.recommendedSection;
  if (section === "local") return labels.allSection;
  return labels.customSection;
};

const groupPresetSections = (labels: SettingsAiLabels): readonly SettingsAiPresetSection[] =>
  (["mainstream", "local", "custom"] as const).map((section) => ({
    id: section,
    label: sectionLabel(labels, section),
    presets: AI_PROVIDER_PRESETS.filter((preset) => preset.section === section)
  }));

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

const authConfigForDraft = (draft: SettingsAiDraft): Record<string, string> => ({
  ...draft.authConfig,
  ...Object.fromEntries(
    Object.entries(draft.secretValues).filter(([, value]) => value.trim().length > 0)
  ),
  [MODEL_SELECTION_MODE_AUTH_CONFIG_KEY]: draft.modelSelectionMode
});

const configuredSecretFieldsForDraft = (
  draft: SettingsAiDraft
): readonly string[] => {
  const configured = new Set(draft.configuredSecretFields);
  Object.entries(draft.secretValues).forEach(([fieldId, value]) => {
    if (value.trim().length > 0) {
      configured.add(fieldId);
    }
  });
  return [...configured];
};

const normalizeProfileModelId = (providerId: string, modelId: string): string => {
  const trimmed = modelId.trim();
  return providerId === "mimo" ? trimmed.toLowerCase() : trimmed;
};

const normalizeConfiguredModelsForProvider = (
  providerId: string,
  primaryModel: string,
  customModels: readonly AiProviderModelEntry[]
): {
  readonly primaryModel: string;
  readonly customModels: readonly AiProviderModelEntry[];
} => {
  const normalizedPrimary = normalizeProfileModelId(providerId, primaryModel);
  const seen = new Set([normalizedPrimary].filter((entry) => entry.length > 0));
  const normalizedCustomModels = customModels.flatMap((model) => {
    const id = normalizeProfileModelId(providerId, model.id);
    if (id.length === 0 || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [{
      ...model,
      id,
      name: model.name.trim() === model.id ? id : model.name
    }];
  });
  return {
    primaryModel: normalizedPrimary,
    customModels: normalizedCustomModels
  };
};

const profileFromDraft = (
  draft: SettingsAiDraft,
  existing: AiProviderProfile | null,
  makeDefault: boolean
): AiProviderProfile => {
  const preset = resolvePreset(
    AI_PROVIDER_PRESETS,
    draft.presetId,
    draft.providerId,
    draft.protocolId
  );
  const availableModels = buildModelOptions(preset, null, draft.modelsText);
  const configuredModels = resolveConfiguredModels(
    draft.modelsText,
    availableModels,
    preset?.defaultModel ?? ""
  );
  const normalizedModels = normalizeConfiguredModelsForProvider(
    draft.providerId,
    configuredModels.primaryModel,
    configuredModels.customModels
  );
  const timestamp = now();
  return {
    id: draft.id ?? `local-profile-${timestamp}`,
    name: draft.name.trim() || preset?.label || "Local AI Profile",
    providerId: draft.providerId as AiProviderProfile["providerId"],
    protocolId: draft.protocolId as AiProviderProfile["protocolId"],
    runtimeProviderId: `${draft.providerId}:${draft.id ?? timestamp}`,
    runtimeSupported: preset?.runtimeSupported ?? false,
    secretStatus: configuredSecretFieldsForDraft(draft).length > 0 ? "configured" : "missing",
    presetId: draft.presetId,
    connectionConfig: { ...draft.connectionConfig },
    authConfig: authConfigForDraft(draft),
    configuredSecretFields: configuredSecretFieldsForDraft(draft),
    headers: {},
    model: normalizedModels.primaryModel,
    customModels: normalizedModels.customModels,
    discoveryState: emptyDiscoveryState(),
    isDefault: makeDefault,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
};

export const useSettingsAiModel = ({
  labels: _labels
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [profiles, setProfiles] = useState<readonly AiProviderProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingsAiDraft>(() => createDefaultDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage] = useState<string | null>(null);

  const selectedPreset = useMemo(
    () => resolvePreset(AI_PROVIDER_PRESETS, draft.presetId, draft.providerId, draft.protocolId),
    [draft.presetId, draft.providerId, draft.protocolId]
  );
  const availableModels = useMemo<readonly AiProviderModelEntry[]>(
    () => buildModelOptions(selectedPreset, null, draft.modelsText),
    [draft.modelsText, selectedPreset]
  );
  const defaultProfile = profiles.find((profile) => profile.isDefault) ?? null;

  const selectProfile = useCallback((profileId: string | null): void => {
    const profile = findSelectedProfile(profiles, profileId);
    setSelectedProfileId(profile?.id ?? null);
    setDraft(toDraft(profile, AI_PROVIDER_PRESETS));
  }, [profiles]);

  const applyPreset = useCallback((presetId: string): void => {
    const preset = AI_PROVIDER_PRESETS.find((entry) => entry.id === presetId);
    if (preset === undefined) {
      return;
    }
    setSelectedProfileId(null);
    setDraft(toDraft({
      id: `draft-${preset.id}`,
      name: preset.label,
      providerId: preset.providerId,
      protocolId: preset.protocolId,
      runtimeProviderId: preset.providerId,
      runtimeSupported: preset.runtimeSupported,
      secretStatus: "missing",
      presetId: preset.id,
      connectionConfig: preset.defaultConnectionConfig,
      authConfig: preset.defaultAuthConfig,
      configuredSecretFields: [],
      headers: {},
      model: preset.defaultModel,
      customModels: [],
      discoveryState: emptyDiscoveryState(),
      isDefault: false,
      createdAt: now(),
      updatedAt: now()
    }, AI_PROVIDER_PRESETS));
  }, []);

  const updateDraftName = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, name: value }));
  }, []);

  const updateDraftModelSelectionMode = useCallback((value: SettingsAiModelSelectionMode): void => {
    setDraft((current) => ({ ...current, modelSelectionMode: value }));
  }, []);

  const updateDraftHeadersText = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, headersText: value }));
  }, []);

  const updateDraftModelsText = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, modelsText: value }));
  }, []);

  const updateDraftField = useCallback<SettingsAiModel["updateDraftField"]>((target, fieldId, value) => {
    setDraft((current) => {
      if (target === "connection") {
        return {
          ...current,
          connectionConfig: updateDraftMapField(current.connectionConfig, fieldId, value)
        };
      }
      if (target === "secret") {
        return {
          ...current,
          secretValues: updateDraftMapField(current.secretValues, fieldId, value)
        };
      }
      return {
        ...current,
        authConfig: updateDraftMapField(current.authConfig, fieldId, value)
      };
    });
  }, []);

  const saveProfile = useCallback(async (): Promise<void> => {
    setIsSaving(true);
    try {
      const savedId = draft.id ?? `local-profile-${Date.now()}`;
      const draftWithId = { ...draft, id: savedId };
      setProfiles((current) => {
        const existing = findSelectedProfile(current, savedId);
        const shouldDefault = draft.isDefault || current.length === 0;
        const saved = profileFromDraft(draftWithId, existing, shouldDefault);
        const next = current.filter((profile) => profile.id !== saved.id)
          .map((profile) => shouldDefault ? { ...profile, isDefault: false } : profile);
        return [...next, saved];
      });
      setSelectedProfileId(savedId);
      setDraft(draftWithId);
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  const deleteProfile = useCallback(async (profileId?: string): Promise<void> => {
    const targetId = profileId ?? selectedProfileId;
    if (targetId === null || targetId === undefined) {
      return;
    }
    setProfiles((current) => current.filter((profile) => profile.id !== targetId));
    if (selectedProfileId === targetId) {
      setSelectedProfileId(null);
      setDraft(createDefaultDraft());
    }
  }, [selectedProfileId]);

  const deleteProviderModels = useCallback(async (providerId: string): Promise<void> => {
    setProfiles((current) => current.filter((profile) => profile.providerId !== providerId));
    const selected = findSelectedProfile(profiles, selectedProfileId);
    if (selected?.providerId === providerId) {
      setSelectedProfileId(null);
      setDraft(createDefaultDraft());
    }
  }, [profiles, selectedProfileId]);

  const deleteConfiguredModel = useCallback(async (profileId: string, modelId: string): Promise<void> => {
    const normalizedModelId = modelId.trim();
    const selectedProfileWillBeDeleted = selectedProfileId === profileId
      && profiles.some((profile) => {
        if (profile.id !== profileId) {
          return false;
        }
        return [profile.model, ...profile.customModels.map((entry) => entry.id)]
          .filter((entry, index, all) => (
            entry !== normalizedModelId
            && entry.trim().length > 0
            && all.indexOf(entry) === index
          )).length === 0;
      });
    setProfiles((current) => current.flatMap((profile) => {
      if (profile.id !== profileId) {
        return [profile];
      }
      const entries = [
        { id: profile.model, name: profile.model, source: "custom" as const },
        ...profile.customModels
      ].filter((entry, index, all) => (
        entry.id !== normalizedModelId
        && entry.id.trim().length > 0
        && all.findIndex((candidate) => candidate.id === entry.id) === index
      ));
      if (entries.length === 0) {
        return [];
      }
      return {
        ...profile,
        model: entries[0]?.id ?? "",
        customModels: entries.slice(1),
        discoveryState: {
          ...profile.discoveryState,
          models: profile.discoveryState.models.filter((entry) => entry.id !== normalizedModelId)
        },
        updatedAt: now()
      };
    }));
    if (selectedProfileWillBeDeleted) {
      setSelectedProfileId(null);
      setDraft(createDefaultDraft());
    }
  }, [profiles, selectedProfileId]);

  const setDefaultProfile = useCallback(async (profileId: string): Promise<void> => {
    setProfiles((current) => current.map((profile) => ({
      ...profile,
      isDefault: profile.id === profileId
    })));
  }, []);

  return {
    isSaving,
    errorMessage,
    profiles,
    presetSections: groupPresetSections(_labels),
    selectedProfileId,
    defaultProfileId: defaultProfile?.id ?? null,
    defaultProviderId: defaultProfile?.providerId ?? null,
    defaultModelNames: defaultProfile === null ? [] : [defaultProfile.model],
    selectedPresetId: draft.presetId,
    selectedPreset,
    draft,
    modelSelectionMode: draft.modelSelectionMode,
    availableModels,
    selectProfile,
    applyPreset,
    updateDraftName,
    updateDraftModelSelectionMode,
    updateDraftHeadersText,
    updateDraftModelsText,
    updateDraftField,
    saveProfile,
    deleteProfile,
    deleteProviderModels,
    deleteConfiguredModel,
    setDefaultProfile,
  };
};
