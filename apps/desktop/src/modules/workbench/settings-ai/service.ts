import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  AiDiscoverModelsRequest,
  AiModelRuntimeMetadata,
  AiModelDiscoveryResult,
  AiModelDiscoveryState,
  AiProviderModelEntry,
  AiRuntimeConfigSnapshot,
  AiUpsertProfileRequest
} from "../../../shared/ai";
import {
  findSelectedProfile,
  MODEL_SELECTION_MODE_AUTH_CONFIG_KEY,
  resolveConfiguredModels,
  serializeConfiguredModels,
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

type SettingsAiModelPayload = {
  readonly primaryModel: string;
  readonly customModels: readonly AiProviderModelEntry[];
  readonly discoveryState: AiModelDiscoveryState;
};

const createEmptySnapshot = (): AiRuntimeConfigSnapshot => ({
  schemaVersion: "v1",
  profiles: [],
  defaultProfileId: null,
  defaultProviderId: null,
  defaultModelNames: [],
  runtimeHealth: {
    backend: "desktop",
    transport: "unavailable",
    version: "0"
  }
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

const discoveryStateFromResult = (
  result: AiModelDiscoveryResult | null,
  fallback: AiModelDiscoveryState | undefined
): AiModelDiscoveryState => {
  if (result === null) {
    return fallback ?? {
      status: "idle",
      lastCheckedAt: null,
      models: []
    };
  }
  return {
    status: result.status,
    lastCheckedAt: result.checkedAt,
    ...(result.status === "error" ? { errorMessage: result.message } : {}),
    models: result.models
  };
};

const emptyDiscoveryState = (): AiModelDiscoveryState => ({
  status: "idle",
  lastCheckedAt: null,
  models: []
});

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const authConfigForDraft = (draft: SettingsAiDraft): Record<string, string> => ({
  ...draft.authConfig,
  [MODEL_SELECTION_MODE_AUTH_CONFIG_KEY]: draft.modelSelectionMode
});

const stableAuthConfig = (
  value: Readonly<Record<string, string>>
): Record<string, string> => {
  const result = { ...value };
  delete result[MODEL_SELECTION_MODE_AUTH_CONFIG_KEY];
  return result;
};

const normalizedRecordEntries = (
  value: Readonly<Record<string, string>>
): readonly string[] => Object.entries(value)
  .map(([key, entry]) => [key.trim(), entry.trim()] as const)
  .filter(([key, entry]) => key.length > 0 && entry.length > 0)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, entry]) => `${key}\u001F${entry}`);

const recordsEqual = (
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean => {
  const leftEntries = normalizedRecordEntries(left);
  const rightEntries = normalizedRecordEntries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every((entry, index) => entry === rightEntries[index]);
};

const hasEnteredSecretValues = (
  value: Readonly<Record<string, string>>
): boolean => Object.values(value).some((entry) => entry.trim().length > 0);

const normalizeDiscoveredModelEntries = (
  models: readonly AiProviderModelEntry[]
): readonly AiProviderModelEntry[] => {
  const seen = new Set<string>();
  const result: AiProviderModelEntry[] = [];
  models.forEach((entry) => {
    const id = entry.id.trim();
    if (id.length === 0 || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push({
      ...entry,
      id,
      name: entry.name.trim().length > 0 ? entry.name : id
    });
  });
  return result;
};

const configuredModelIdsForProfile = (profile: SettingsAiModel["profiles"][number]): readonly string[] => {
  const ids: string[] = [];
  [
    profile.model,
    ...profile.customModels.map((entry) => entry.id),
    ...profile.discoveryState.models.map((entry) => entry.id)
  ].forEach((entry) => {
    const id = entry.trim();
    if (id.length > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  });
  return ids;
};

const configuredModelIdsForPayload = (payload: SettingsAiModelPayload): readonly string[] => {
  const ids: string[] = [];
  [
    payload.primaryModel,
    ...payload.customModels.map((entry) => entry.id),
    ...payload.discoveryState.models.map((entry) => entry.id)
  ].forEach((entry) => {
    const id = entry.trim();
    if (id.length > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  });
  return ids;
};

const modelEntryFromSources = (
  modelId: string,
  sources: readonly AiProviderModelEntry[]
): AiProviderModelEntry => {
  const entry = sources.find((source) => source.id.trim() === modelId);
  return entry === undefined
    ? {
        id: modelId,
        name: modelId,
        source: "custom"
      }
    : {
        ...entry,
        id: modelId,
        name: entry.name.trim().length > 0 ? entry.name : modelId
      };
};

const modelEntryForProfile = (
  profile: SettingsAiModel["profiles"][number],
  modelId: string
): AiProviderModelEntry => {
  return modelEntryFromSources(modelId, [...profile.customModels, ...profile.discoveryState.models]);
};

const modelEntryForPayloadAndProfile = (
  payload: SettingsAiModelPayload,
  profile: SettingsAiModel["profiles"][number],
  modelId: string
): AiProviderModelEntry => {
  const payloadSources = [...payload.customModels, ...payload.discoveryState.models];
  const payloadEntry = payloadSources.find((entry) => entry.id.trim() === modelId);
  if (payloadEntry !== undefined) {
    return modelEntryFromSources(modelId, [payloadEntry]);
  }
  return modelEntryForProfile(profile, modelId);
};

const discoveryStateWithModels = (
  profile: SettingsAiModel["profiles"][number],
  modelIds: readonly string[]
): AiModelDiscoveryState => {
  const remainingIds = new Set(modelIds);
  const models = normalizeDiscoveredModelEntries(
    profile.discoveryState.models.filter((entry) => remainingIds.has(entry.id.trim()))
  );
  return {
    status: profile.discoveryState.status,
    lastCheckedAt: profile.discoveryState.lastCheckedAt,
    ...(profile.discoveryState.errorMessage === undefined
      ? {}
      : { errorMessage: profile.discoveryState.errorMessage }),
    models
  };
};

const mergeDiscoveryStateForProfile = (
  profile: SettingsAiModel["profiles"][number],
  payload: SettingsAiModelPayload,
  modelIds: readonly string[]
): AiModelDiscoveryState => {
  const remainingIds = new Set(modelIds);
  const payloadHasDiscoveryState =
    payload.discoveryState.status !== "idle"
    || payload.discoveryState.lastCheckedAt !== null
    || payload.discoveryState.models.length > 0
    || payload.discoveryState.errorMessage !== undefined;
  const sourceState = payloadHasDiscoveryState ? payload.discoveryState : profile.discoveryState;
  const models = normalizeDiscoveredModelEntries(
    [...payload.discoveryState.models, ...profile.discoveryState.models]
      .filter((entry) => remainingIds.has(entry.id.trim()))
  );
  return {
    status: sourceState.status,
    lastCheckedAt: sourceState.lastCheckedAt,
    ...(sourceState.errorMessage === undefined ? {} : { errorMessage: sourceState.errorMessage }),
    models
  };
};

const mergeModelPayloadWithProfile = (
  profile: SettingsAiModel["profiles"][number],
  payload: SettingsAiModelPayload
): SettingsAiModelPayload => {
  const modelIds = [
    ...configuredModelIdsForPayload(payload),
    ...configuredModelIdsForProfile(profile)
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  const primaryModel = modelIds[0] ?? payload.primaryModel;
  return {
    primaryModel,
    customModels: modelIds.slice(1).map((modelId) =>
      modelEntryForPayloadAndProfile(payload, profile, modelId)
    ),
    discoveryState: mergeDiscoveryStateForProfile(profile, payload, modelIds)
  };
};

const canSaveDraftIntoProfile = (
  draft: SettingsAiDraft,
  profile: SettingsAiModel["profiles"][number] | null
): profile is SettingsAiModel["profiles"][number] => {
  if (profile === null) {
    return false;
  }
  const draftName = draft.name.trim();
  return profile.providerId === draft.providerId
    && profile.protocolId === draft.protocolId
    && (profile.presetId ?? null) === (draft.presetId ?? null)
    && profile.name.trim() === draftName
    && recordsEqual(profile.connectionConfig, draft.connectionConfig)
    && recordsEqual(stableAuthConfig(profile.authConfig), stableAuthConfig(draft.authConfig))
    && !hasEnteredSecretValues(draft.secretValues);
};

const requestFromExistingProfile = (
  profile: SettingsAiModel["profiles"][number],
  modelIds: readonly string[]
): AiUpsertProfileRequest => {
  const modelRuntimeMetadata = profile.modelRuntimeMetadata;
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId as AiUpsertProfileRequest["providerId"],
    protocolId: profile.protocolId as AiUpsertProfileRequest["protocolId"],
    presetId: profile.presetId,
    connectionConfig: { ...profile.connectionConfig },
    authConfig: { ...profile.authConfig },
    headers: { ...profile.headers },
    model: modelIds[0] ?? "",
    ...(modelRuntimeMetadata === undefined ? {} : { modelRuntimeMetadata }),
    customModels: modelIds.slice(1).map((modelId) => modelEntryForProfile(profile, modelId)),
    discoveryState: discoveryStateWithModels(profile, modelIds)
  };
};

export const useSettingsAiModel = ({
  desktopApi,
  labels,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [snapshot, setSnapshot] = useState<AiRuntimeConfigSnapshot>(() => createEmptySnapshot());
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const selectedProfileIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<SettingsAiDraft>(() => createDefaultDraft());
  const [discoveryResult, setDiscoveryResult] = useState<AiModelDiscoveryResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedPreset = useMemo(
    () => resolvePreset(
      AI_PROVIDER_PRESETS,
      draft.presetId,
      draft.providerId,
      draft.protocolId
    ),
    [draft.presetId, draft.providerId, draft.protocolId]
  );
  const availableModels = useMemo(
    () => normalizeDiscoveredModelEntries(buildModelOptions(
      selectedPreset,
      discoveryResult,
      draft.modelsText
    )),
    [discoveryResult, draft.modelsText, selectedPreset]
  );
  const targetProfileForDraft = useMemo(
    () => {
      const profile = draft.id === null
        ? null
        : findSelectedProfile(snapshot.profiles, draft.id);
      return canSaveDraftIntoProfile(draft, profile) ? profile : null;
    },
    [draft, snapshot.profiles]
  );

  const applySnapshot = useCallback((
    nextSnapshot: AiRuntimeConfigSnapshot,
    preferredProfileId?: string | null
  ): void => {
    setSnapshot(nextSnapshot);
    const targetProfileId = preferredProfileId === undefined
      ? selectedProfileIdRef.current
      : preferredProfileId;
    const nextProfile =
      findSelectedProfile(nextSnapshot.profiles, targetProfileId)
      ?? nextSnapshot.profiles[0]
      ?? null;
    const nextProfileId = nextProfile?.id ?? null;
    selectedProfileIdRef.current = nextProfileId;
    setSelectedProfileId(nextProfileId);
    setDraft(toDraft(nextProfile, AI_PROVIDER_PRESETS));
    setDiscoveryResult(null);
    setErrorMessage(null);
  }, []);

  const refreshConfig = useCallback(async (): Promise<void> => {
    try {
      const api = desktopApi?.ai;
      const nextSnapshot = api === undefined ? createEmptySnapshot() : await api.readConfig();
      applySnapshot(nextSnapshot);
    } catch (error) {
      console.error("Failed to load AI profiles", error);
    }
  }, [applySnapshot, desktopApi?.ai]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const selectProfile = useCallback((profileId: string | null): void => {
    const profile = findSelectedProfile(snapshot.profiles, profileId);
    const nextProfileId = profile?.id ?? null;
    selectedProfileIdRef.current = nextProfileId;
    setSelectedProfileId(nextProfileId);
    setDraft(toDraft(profile, AI_PROVIDER_PRESETS));
    setDiscoveryResult(null);
    setErrorMessage(null);
  }, [snapshot.profiles]);

  const applyPreset = useCallback((presetId: string): void => {
    const preset = resolvePreset(AI_PROVIDER_PRESETS, presetId, draft.providerId, draft.protocolId);
    if (preset === null) {
      return;
    }
    setDraft((current) => ({
      ...current,
      providerId: preset.providerId,
      protocolId: preset.protocolId,
      presetId: preset.id,
      connectionConfig: { ...preset.defaultConnectionConfig },
      authConfig: { ...preset.defaultAuthConfig },
      secretValues: {},
      configuredSecretFields: [],
      modelSelectionMode: "all",
      modelsText: serializeConfiguredModels("", []),
      name: current.name.trim().length === 0 ? preset.label : current.name
    }));
    setDiscoveryResult(null);
    setErrorMessage(null);
  }, [draft.providerId, draft.protocolId]);

  const updateDraftName = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, name: value }));
    setErrorMessage(null);
  }, []);

  const updateDraftModelSelectionMode = useCallback((value: SettingsAiModelSelectionMode): void => {
    setDraft((current) => ({
      ...current,
      modelSelectionMode: value,
    }));
    setDiscoveryResult(null);
    setErrorMessage(null);
  }, []);

  const updateDraftHeadersText = useCallback((value: string): void => {
    setDraft((current) => ({
      ...current,
      headersText: value,
    }));
    setErrorMessage(null);
  }, []);

  const updateDraftModelsText = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, modelsText: value }));
    setErrorMessage(null);
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
    setErrorMessage(null);
  }, []);

  const runtimeMetadataForPayload = useCallback((
    modelPayload: SettingsAiModelPayload
  ): AiModelRuntimeMetadata | null => {
    const entry = availableModels.find((model) => model.id === modelPayload.primaryModel);
    return entry?.runtimeMetadata ?? selectedPreset?.runtimeMetadata ?? null;
  }, [availableModels, selectedPreset?.runtimeMetadata]);

  const requestFromDraft = useCallback((
    modelPayload: SettingsAiModelPayload,
    targetProfile: SettingsAiModel["profiles"][number] | null
  ): AiUpsertProfileRequest => ({
    ...(targetProfile === null ? {} : { id: targetProfile.id }),
    name: draft.name.trim() || selectedPreset?.label || "AI Provider",
    providerId: draft.providerId as AiUpsertProfileRequest["providerId"],
    protocolId: draft.protocolId as AiUpsertProfileRequest["protocolId"],
    presetId: draft.presetId,
    connectionConfig: { ...draft.connectionConfig },
    authConfig: authConfigForDraft(draft),
    secretValues: { ...draft.secretValues },
    headers: {},
    model: modelPayload.primaryModel,
    modelRuntimeMetadata: runtimeMetadataForPayload(modelPayload),
    customModels: modelPayload.customModels,
    discoveryState: modelPayload.discoveryState,
    isDefault: snapshot.profiles.length === 0
  }), [
    draft.authConfig,
    draft.connectionConfig,
    draft.modelSelectionMode,
    draft.name,
    draft.presetId,
    draft.providerId,
    draft.protocolId,
    draft.secretValues,
    runtimeMetadataForPayload,
    selectedPreset?.label,
    snapshot.profiles.length,
  ]);

  const discoverRequestFromDraft = useCallback((): AiDiscoverModelsRequest => ({
    ...(targetProfileForDraft === null ? {} : { id: targetProfileForDraft.id }),
    providerId: draft.providerId as AiDiscoverModelsRequest["providerId"],
    protocolId: draft.protocolId as AiDiscoverModelsRequest["protocolId"],
    presetId: draft.presetId,
    connectionConfig: { ...draft.connectionConfig },
    authConfig: authConfigForDraft(draft),
    secretValues: { ...draft.secretValues },
    headers: {},
    forceRefresh: true
  }), [
    draft.authConfig,
    draft.connectionConfig,
    draft.modelSelectionMode,
    draft.presetId,
    draft.providerId,
    draft.protocolId,
    draft.secretValues,
    targetProfileForDraft
  ]);

  const discoverAllModelPayload = useCallback(async (): Promise<SettingsAiModelPayload> => {
    if (desktopApi?.ai === undefined) {
      throw new Error("AI runtime is not connected");
    }
    const result = await desktopApi.ai.discoverModels(discoverRequestFromDraft());
    setDiscoveryResult(result);
    if (result.status !== "ready") {
      throw new Error(result.message);
    }
    const models = normalizeDiscoveredModelEntries(result.models);
    const primary = models[0];
    if (primary === undefined) {
      throw new Error(labels.noDiscoveredModels);
    }
    return {
      primaryModel: primary.id,
      customModels: models.slice(1),
      discoveryState: discoveryStateFromResult({ ...result, models }, undefined)
    };
  }, [desktopApi?.ai, discoverRequestFromDraft, labels.noDiscoveredModels]);

  const configuredModelPayloadFromDraft = useCallback((
    discoveryState: AiModelDiscoveryState = emptyDiscoveryState()
  ): SettingsAiModelPayload => {
    const resolved = resolveConfiguredModels(
      draft.modelsText,
      availableModels,
      selectedPreset?.defaultModel ?? ""
    );
    return {
      primaryModel: resolved.primaryModel,
      customModels: resolved.customModels,
      discoveryState
    };
  }, [
    availableModels,
    draft.modelsText,
    selectedPreset?.defaultModel
  ]);

  const modelPayloadFromDraft = useCallback(async (): Promise<SettingsAiModelPayload> => {
    if (draft.modelSelectionMode !== "all") {
      const payload = configuredModelPayloadFromDraft();
      if (payload.primaryModel.trim().length === 0) {
        throw new Error(labels.noDiscoveredModels);
      }
      return payload;
    }
    return discoverAllModelPayload();
  }, [
    configuredModelPayloadFromDraft,
    discoverAllModelPayload,
    draft.modelSelectionMode,
    labels.noDiscoveredModels
  ]);

  const saveProfile = useCallback(async (): Promise<void> => {
    if (desktopApi?.ai === undefined) {
      const message = "AI runtime is not connected";
      setErrorMessage(message);
      console.error(message);
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const rawModelPayload = await modelPayloadFromDraft();
      const modelPayload = targetProfileForDraft === null
        ? rawModelPayload
        : mergeModelPayloadWithProfile(targetProfileForDraft, rawModelPayload);
      const saved = await desktopApi.ai.upsertProfile(requestFromDraft(modelPayload, targetProfileForDraft));
      const nextSnapshot = await desktopApi.ai.readConfig();
      applySnapshot(nextSnapshot, saved.id);
    } catch (error) {
      setErrorMessage(messageFromError(error));
      console.error("Failed to save AI profile", error);
    } finally {
      setIsSaving(false);
    }
  }, [
    applySnapshot,
    desktopApi?.ai,
    modelPayloadFromDraft,
    requestFromDraft,
    targetProfileForDraft
  ]);

  const deleteProfile = useCallback(async (profileId?: string): Promise<void> => {
    const id = profileId ?? draft.id;
    if (id === null || id === undefined) {
      setDraft(createDefaultDraft());
      selectedProfileIdRef.current = null;
      setSelectedProfileId(null);
      return;
    }
    if (desktopApi?.ai === undefined) {
      console.error("AI runtime is not connected");
      return;
    }
    try {
      await desktopApi.ai.deleteProfile({ id });
      const nextSnapshot = await desktopApi.ai.readConfig();
      applySnapshot(nextSnapshot);
    } catch (error) {
      console.error("Failed to delete AI profile", error);
    }
  }, [applySnapshot, desktopApi?.ai, draft.id]);

  const deleteProviderModels = useCallback(async (providerId: string): Promise<void> => {
    const normalizedProviderId = providerId.trim();
    if (normalizedProviderId.length === 0) {
      return;
    }
    if (desktopApi?.ai === undefined) {
      console.error("AI runtime is not connected");
      return;
    }
    const profileIds = snapshot.profiles
      .filter((profile) => profile.providerId === normalizedProviderId)
      .map((profile) => profile.id);
    if (profileIds.length === 0) {
      return;
    }
    try {
      for (const profileId of profileIds) {
        await desktopApi.ai.deleteProfile({ id: profileId });
      }
      const nextSnapshot = await desktopApi.ai.readConfig();
      applySnapshot(nextSnapshot, selectedProfileId);
    } catch (error) {
      console.error("Failed to delete AI provider models", error);
    }
  }, [applySnapshot, desktopApi?.ai, selectedProfileId, snapshot.profiles]);

  const deleteConfiguredModel = useCallback(async (
    profileId: string,
    modelId: string
  ): Promise<void> => {
    const normalizedModelId = modelId.trim();
    if (normalizedModelId.length === 0) {
      return;
    }
    if (desktopApi?.ai === undefined) {
      console.error("AI runtime is not connected");
      return;
    }
    const profile = findSelectedProfile(snapshot.profiles, profileId);
    if (profile === null) {
      return;
    }
    const remainingModelIds = configuredModelIdsForProfile(profile)
      .filter((entry) => entry !== normalizedModelId);
    try {
      if (remainingModelIds.length === 0) {
        await desktopApi.ai.deleteProfile({ id: profile.id });
        const nextSnapshot = await desktopApi.ai.readConfig();
        applySnapshot(nextSnapshot, selectedProfileId);
        return;
      }
      const saved = await desktopApi.ai.upsertProfile(requestFromExistingProfile(profile, remainingModelIds));
      const nextSnapshot = await desktopApi.ai.readConfig();
      applySnapshot(nextSnapshot, profile.id === selectedProfileId ? saved.id : selectedProfileId);
    } catch (error) {
      console.error("Failed to delete AI model", error);
    }
  }, [applySnapshot, desktopApi?.ai, selectedProfileId, snapshot.profiles]);

  const setDefaultProfile = useCallback(async (profileId: string): Promise<void> => {
    if (desktopApi?.ai === undefined) {
      return;
    }
    const profile = findSelectedProfile(snapshot.profiles, profileId);
    if (profile === null) {
      return;
    }
    try {
      const modelRuntimeMetadata = profile.modelRuntimeMetadata;
      const saved = await desktopApi.ai.upsertProfile({
        id: profile.id,
        name: profile.name,
        providerId: profile.providerId,
        protocolId: profile.protocolId,
        presetId: profile.presetId,
        connectionConfig: { ...profile.connectionConfig },
        authConfig: { ...profile.authConfig },
        headers: { ...profile.headers },
        model: profile.model,
        ...(modelRuntimeMetadata === undefined ? {} : { modelRuntimeMetadata }),
        customModels: profile.customModels,
        discoveryState: profile.discoveryState,
        isDefault: true
      });
      const nextSnapshot = await desktopApi.ai.readConfig();
      applySnapshot(nextSnapshot, saved.id);
    } catch (error) {
      console.error("Failed to set default AI profile", error);
    }
  }, [applySnapshot, desktopApi?.ai, snapshot.profiles]);

  return {
    isSaving,
    errorMessage,
    profiles: snapshot.profiles,
    presetSections: groupPresetSections(labels),
    selectedProfileId,
    defaultProfileId: snapshot.defaultProfileId,
    defaultProviderId: snapshot.defaultProviderId,
    defaultModelNames: snapshot.defaultModelNames,
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
