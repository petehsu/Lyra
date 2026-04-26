import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BrowserUseRuntimeStatus } from "../../../shared/browser-use";
import type { LyraRuntimeHealth } from "../../../shared/lyra-runtime";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  AiDiscoverModelsRequest,
  AiModelDiscoveryState,
  AiModelDiscoveryResult,
  AiProfileValidationResult,
  AiProviderModelEntry,
  AiProviderPreset,
  AiProviderProfile,
  AiUpsertProfileRequest,
  AiValidateProfileRequest,
} from "../../../shared/ai";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import type {
  WorkbenchBrowserAutomationEngine,
  WorkbenchLyraDirectMicroExecutorBudget,
} from "../preferences";
import {
  findSelectedProfile,
  parseMap,
  readPrimaryConnectionValue,
  resolveConfiguredModels,
  resolvePrimarySecretFieldId,
  serializeConfiguredModels,
  toDraft,
} from "./draft";
import { buildModelOptions } from "./model-options";
import { resolvePreset } from "./preset";
import type {
  SettingsAiDraft,
  SettingsAiLabels,
  SettingsAiModel,
  SettingsAiPresetSection,
} from "./types";

type UseSettingsAiModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsAiLabels;
};

type ProfilesListResponse = {
  readonly profiles?: readonly AiProviderProfile[];
  readonly defaultProfileId?: string | null;
};

type ProviderCatalogResponse = {
  readonly presets?: readonly AiProviderPreset[];
};

type ProfileUpsertResponse = {
  readonly profile: AiProviderProfile;
};

type PreferencesRecord = Record<string, unknown>;

const DEFAULT_BROWSER_AUTOMATION_ENGINE: WorkbenchBrowserAutomationEngine = "lyra_direct";
const DEFAULT_LYRA_DIRECT_BUDGET: WorkbenchLyraDirectMicroExecutorBudget = "3-5";
const DEFAULT_PROVIDER_ID = "lmstudio";
const DEFAULT_PROTOCOL_ID = "lmstudio_chat_completions";

const createRequestPayload = (
  method: string,
  params: Record<string, unknown> = {}
): Record<string, unknown> => ({
  method,
  params,
});

const createUnavailableBrowserUseStatus = (detail: string): BrowserUseRuntimeStatus => ({
  state: "unavailable",
  checkedAt: Date.now(),
  reason: "unsupported_platform",
  detail,
});

const readPreferencesRecord = (): PreferencesRecord => {
  const raw = readWorkbenchStateSync("preferences");
  if (raw === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as PreferencesRecord
      : {};
  } catch {
    return {};
  }
};

const writePreferencesField = (field: string, value: string): void => {
  const next = {
    ...readPreferencesRecord(),
    [field]: value,
  };
  writeWorkbenchStateSync("preferences", JSON.stringify(next));
};

const readBrowserAutomationEnginePreference = (): WorkbenchBrowserAutomationEngine => {
  const value = readPreferencesRecord().browserAutomationEngine;
  return value === "browser_use" || value === "smart" || value === "lyra_direct"
    ? value
    : DEFAULT_BROWSER_AUTOMATION_ENGINE;
};

const readLyraDirectBudgetPreference = (): WorkbenchLyraDirectMicroExecutorBudget => {
  const value = readPreferencesRecord().lyraDirectMicroExecutorBudget;
  return value === "1-2" || value === "3-5" || value === "6-8"
    ? value
    : DEFAULT_LYRA_DIRECT_BUDGET;
};

const createDraftFromPreset = (
  preset: AiProviderPreset | null,
  previous?: SettingsAiDraft | null
): SettingsAiDraft => ({
  id: null,
  name: previous?.name ?? "",
  providerId: preset?.providerId ?? DEFAULT_PROVIDER_ID,
  protocolId: preset?.protocolId ?? DEFAULT_PROTOCOL_ID,
  presetId: preset?.id ?? null,
  connectionConfig: { ...(preset?.defaultConnectionConfig ?? {}) },
  authConfig: { ...(preset?.defaultAuthConfig ?? {}) },
  secretValues: {},
  clearSecretFields: [],
  configuredSecretFields: [],
  headersText: previous?.headersText ?? "",
  modelsText: serializeConfiguredModels(preset?.defaultModel ?? "", []),
  isDefault: false,
});

const createDefaultDraft = (presets: readonly AiProviderPreset[]): SettingsAiDraft =>
  createDraftFromPreset(presets[0] ?? null);

const toneFromStatus = (status: "ready" | "error"): SettingsAiModel["statusTone"] =>
  status === "ready" ? "success" : "error";

const validationTone = (
  result: AiProfileValidationResult
): SettingsAiModel["statusTone"] => (result.ok ? "success" : "error");

const discoveryStateToResult = (
  profile: AiProviderProfile | null
): AiModelDiscoveryResult | null => {
  if (
    profile === null
    || profile.discoveryState.status === "idle"
    || profile.discoveryState.lastCheckedAt === null
  ) {
    return null;
  }
  return {
    providerId: profile.providerId,
    protocolId: profile.protocolId,
    status: profile.discoveryState.status,
    message: profile.discoveryState.errorMessage
      ?? (profile.discoveryState.models.length > 0 ? "Models discovered" : "No models returned"),
    checkedAt: profile.discoveryState.lastCheckedAt,
    models: profile.discoveryState.models,
  };
};

const discoveryResultToState = (
  result: AiModelDiscoveryResult | null
): AiModelDiscoveryState | undefined => {
  if (result === null) {
    return undefined;
  }
  return {
    status: result.status,
    lastCheckedAt: result.checkedAt,
    ...(result.status === "error" ? { errorMessage: result.message } : {}),
    models: result.models,
  };
};

const presetSectionsFromCatalog = (
  presets: readonly AiProviderPreset[],
  labels: SettingsAiLabels
): readonly SettingsAiPresetSection[] => {
  const mainstream = presets.filter((preset) => preset.section === "mainstream");
  const local = presets.filter((preset) => preset.section === "local");
  const custom = presets.filter((preset) => preset.section === "custom");
  const sections: SettingsAiPresetSection[] = [
    { id: "mainstream" as const, label: labels.recommendedSection, presets: mainstream },
    { id: "local" as const, label: labels.allSection, presets: local },
    { id: "custom" as const, label: labels.customSection, presets: custom },
  ];
  return sections.filter((section) => section.presets.length > 0);
};

const mergeSecretFieldList = (
  current: readonly string[],
  fieldId: string,
  configured: boolean
): readonly string[] => {
  const set = new Set(current);
  if (configured) {
    set.add(fieldId);
  } else {
    set.delete(fieldId);
  }
  return [...set].sort((left, right) => left.localeCompare(right));
};

const hasDraftSecretMutations = (draft: SettingsAiDraft): boolean =>
  Object.values(draft.secretValues).some((value) => value.trim().length > 0)
  || draft.clearSecretFields.length > 0;

export const useSettingsAiModel = ({
  desktopApi,
  labels,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const lyraApi = desktopApi?.lyra ?? null;
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [statusMessage, setStatusMessage] = useState(labels.statusIdle);
  const [statusTone, setStatusTone] = useState<SettingsAiModel["statusTone"]>("neutral");
  const [runtimeHealth, setRuntimeHealth] = useState<LyraRuntimeHealth | null>(null);
  const [profiles, setProfiles] = useState<readonly AiProviderProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [presets, setPresets] = useState<readonly AiProviderPreset[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const selectedProfileIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<SettingsAiDraft>(createDefaultDraft([]));
  const [draftDiscoveryResult, setDraftDiscoveryResult] = useState<AiModelDiscoveryResult | null>(null);
  const [browserAutomationEngine, setBrowserAutomationEngineState] = useState<WorkbenchBrowserAutomationEngine>(() =>
    readBrowserAutomationEnginePreference()
  );
  const [lyraDirectMicroExecutorBudget, setLyraDirectMicroExecutorBudgetState] = useState<WorkbenchLyraDirectMicroExecutorBudget>(() =>
    readLyraDirectBudgetPreference()
  );
  const [browserUseRuntimeStatus, setBrowserUseRuntimeStatus] = useState<BrowserUseRuntimeStatus>({
    state: "checking",
    checkedAt: Date.now(),
  });

  const resetDraftForSelection = useCallback((
    nextProfiles: readonly AiProviderProfile[],
    nextPresets: readonly AiProviderPreset[],
    nextSelectedProfileId: string | null,
    previousDraft?: SettingsAiDraft
  ): SettingsAiDraft => {
    const selectedProfile = findSelectedProfile(nextProfiles, nextSelectedProfileId);
    if (selectedProfile !== null) {
      return toDraft(selectedProfile, nextPresets);
    }
    const currentPreset = previousDraft === undefined
      ? null
      : resolvePreset(
          nextPresets,
          previousDraft.presetId,
          previousDraft.providerId,
          previousDraft.protocolId
        );
    return createDraftFromPreset(currentPreset ?? nextPresets[0] ?? null, previousDraft);
  }, []);

  const syncConfig = useCallback(async (
    preferredProfileId?: string | null
  ): Promise<void> => {
    if (lyraApi === null) {
      setRuntimeHealth(null);
      setProfiles([]);
      setDefaultProfileId(null);
      setPresets([]);
      setSelectedProfileId(null);
      selectedProfileIdRef.current = null;
      setDraft(createDefaultDraft([]));
      setDraftDiscoveryResult(null);
      setStatusMessage(labels.statusIdle);
      setStatusTone("neutral");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [health, profilesResponse, catalogResponse] = await Promise.all([
        lyraApi.health(),
        lyraApi.request<ProfilesListResponse>(createRequestPayload("lyra/config/profiles/list")),
        lyraApi.request<ProviderCatalogResponse>(createRequestPayload("lyra/config/providers/catalog/read")),
      ]);

      const nextProfiles = Array.isArray(profilesResponse.profiles) ? profilesResponse.profiles : [];
      const nextPresets = Array.isArray(catalogResponse.presets) ? catalogResponse.presets : [];
      const nextDefaultProfileId = typeof profilesResponse.defaultProfileId === "string"
        ? profilesResponse.defaultProfileId
        : null;
      const nextSelectedProfileId = preferredProfileId !== undefined
        ? (nextProfiles.some((profile) => profile.id === preferredProfileId) ? preferredProfileId : null)
        : (selectedProfileIdRef.current !== null && nextProfiles.some((profile) => profile.id === selectedProfileIdRef.current)
          ? selectedProfileIdRef.current
          : nextDefaultProfileId ?? nextProfiles[0]?.id ?? null);
      setRuntimeHealth(health);
      setProfiles(nextProfiles);
      setDefaultProfileId(nextDefaultProfileId);
      setPresets(nextPresets);
      setSelectedProfileId(nextSelectedProfileId);
      selectedProfileIdRef.current = nextSelectedProfileId;
      setDraft((current) =>
        resetDraftForSelection(nextProfiles, nextPresets, nextSelectedProfileId, current)
      );
      setDraftDiscoveryResult(null);
      setStatusMessage(labels.statusIdle);
      setStatusTone("neutral");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsLoading(false);
    }
  }, [lyraApi, labels.statusIdle, resetDraftForSelection]);

  useEffect(() => {
    void syncConfig();
  }, [syncConfig]);

  useEffect(() => {
    if (desktopApi?.browserUse === undefined) {
      setBrowserUseRuntimeStatus(createUnavailableBrowserUseStatus("browser-use runtime status unavailable"));
      return;
    }

    let cancelled = false;
    void desktopApi.browserUse.readRuntimeStatus().then((status) => {
      if (!cancelled) {
        setBrowserUseRuntimeStatus(status);
      }
    }).catch(() => {
      if (!cancelled) {
        setBrowserUseRuntimeStatus(createUnavailableBrowserUseStatus("browser-use runtime status unavailable"));
      }
    });

    const unsubscribe = desktopApi.browserUse.onRuntimeStatus((status) => {
      setBrowserUseRuntimeStatus(status);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [desktopApi]);

  const selectedProfile = useMemo(
    () => findSelectedProfile(profiles, selectedProfileId),
    [profiles, selectedProfileId]
  );

  const selectedPreset = useMemo(
    () => resolvePreset(presets, draft.presetId, draft.providerId, draft.protocolId),
    [draft.presetId, draft.providerId, draft.protocolId, presets]
  );

  const presetSections = useMemo(
    () => presetSectionsFromCatalog(presets, labels),
    [labels, presets]
  );

  const activeDiscoveryResult = useMemo(
    () => draftDiscoveryResult ?? discoveryStateToResult(selectedProfile),
    [draftDiscoveryResult, selectedProfile]
  );

  const availableModels = useMemo(
    () => buildModelOptions(selectedPreset, activeDiscoveryResult, draft.modelsText),
    [activeDiscoveryResult, draft.modelsText, selectedPreset]
  );

  const selectedModelIds = useMemo(
    () => resolveConfiguredModels(
      draft.modelsText,
      availableModels,
      selectedPreset?.defaultModel ?? selectedProfile?.model ?? ""
    ).modelIds,
    [availableModels, draft.modelsText, selectedPreset, selectedProfile]
  );

  const defaultProfileLabel = useMemo(
    () => profiles.find((profile) => profile.id === defaultProfileId)?.name ?? null,
    [defaultProfileId, profiles]
  );

  const defaultProviderId = useMemo(() => {
    const defaultProfile = profiles.find((profile) => profile.id === defaultProfileId) ?? null;
    const providerId = (defaultProfile?.runtimeProviderId ?? DEFAULT_PROVIDER_ID).trim();
    return providerId.length > 0 ? providerId : DEFAULT_PROVIDER_ID;
  }, [defaultProfileId, profiles]);

  const defaultModelNames = useMemo(() => {
    const defaultProfile = profiles.find((profile) => profile.id === defaultProfileId) ?? null;
    if (defaultProfile !== null) {
      return [
        defaultProfile.model,
        ...defaultProfile.customModels.map((entry) => entry.id),
        ...defaultProfile.discoveryState.models.map((entry) => entry.id),
      ]
        .map((entry) => entry.trim())
        .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
    }
    const fallbackModel = selectedPreset?.defaultModel?.trim() ?? "";
    return fallbackModel.length > 0 ? [fallbackModel] : [];
  }, [defaultProfileId, profiles, selectedPreset]);

  const buildValidateRequest = useCallback((): AiValidateProfileRequest => {
    const { primaryModel } = resolveConfiguredModels(
      draft.modelsText,
      availableModels,
      selectedPreset?.defaultModel ?? ""
    );
    return {
      ...(draft.id === null ? {} : { id: draft.id }),
      name: draft.name.trim(),
      providerId: draft.providerId as AiValidateProfileRequest["providerId"],
      protocolId: draft.protocolId as AiValidateProfileRequest["protocolId"],
      presetId: draft.presetId,
      connectionConfig: { ...draft.connectionConfig },
      authConfig: { ...draft.authConfig },
      secretValues: { ...draft.secretValues },
      headers: parseMap(draft.headersText),
      model: primaryModel,
    };
  }, [availableModels, draft, selectedPreset?.defaultModel]);

  const buildUpsertRequest = useCallback((): AiUpsertProfileRequest => {
    const { primaryModel, customModels } = resolveConfiguredModels(
      draft.modelsText,
      availableModels,
      selectedPreset?.defaultModel ?? ""
    );
    const discoveryState = discoveryResultToState(
      draftDiscoveryResult
      ?? (selectedProfile === null ? null : discoveryStateToResult(selectedProfile))
    );
    return {
      ...(draft.id === null ? {} : { id: draft.id }),
      name: draft.name.trim(),
      providerId: draft.providerId as AiUpsertProfileRequest["providerId"],
      protocolId: draft.protocolId as AiUpsertProfileRequest["protocolId"],
      presetId: draft.presetId,
      connectionConfig: { ...draft.connectionConfig },
      authConfig: { ...draft.authConfig },
      secretValues: { ...draft.secretValues },
      clearSecretFields: [...draft.clearSecretFields],
      headers: parseMap(draft.headersText),
      model: primaryModel,
      customModels,
      ...(discoveryState === undefined ? {} : { discoveryState }),
    };
  }, [availableModels, draft, draftDiscoveryResult, selectedPreset?.defaultModel, selectedProfile]);

  const buildDiscoverRequest = useCallback((): AiDiscoverModelsRequest => ({
    ...(draft.id === null ? {} : { id: draft.id }),
    providerId: draft.providerId as AiDiscoverModelsRequest["providerId"],
    protocolId: draft.protocolId as AiDiscoverModelsRequest["protocolId"],
    presetId: draft.presetId,
    connectionConfig: { ...draft.connectionConfig },
    authConfig: { ...draft.authConfig },
    secretValues: { ...draft.secretValues },
    headers: parseMap(draft.headersText),
    forceRefresh: true,
  }), [draft]);

  const persistDraftSecrets = useCallback(async (): Promise<void> => {
    if (lyraApi === null || !hasDraftSecretMutations(draft)) {
      return;
    }

    const secretFieldId = resolvePrimarySecretFieldId(selectedPreset);
    if (secretFieldId === null) {
      return;
    }

    const baseUrl = readPrimaryConnectionValue(selectedPreset, {
      ...draft.connectionConfig,
    }).trim();
    if (baseUrl.length === 0) {
      return;
    }

    const nextSecretValue = (draft.secretValues[secretFieldId] ?? "").trim();
    const shouldDelete = draft.clearSecretFields.includes(secretFieldId) || nextSecretValue.length === 0;
    if (shouldDelete) {
      await lyraApi.request(createRequestPayload("lyra/secrets.ai.delete", { baseUrl }));
      return;
    }

    await lyraApi.request(createRequestPayload("lyra/secrets.ai.write", {
      baseUrl,
      value: nextSecretValue,
    }));
  }, [lyraApi, draft, selectedPreset]);

  const refreshModels = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      return;
    }

    setIsRefreshingModels(true);
    try {
      const result = await lyraApi.request<AiModelDiscoveryResult>(
        createRequestPayload("lyra/config/models/discover", buildDiscoverRequest() as Record<string, unknown>)
      );
      setDraftDiscoveryResult(result);
      setStatusMessage(result.message);
      setStatusTone(toneFromStatus(result.status));
      if (draft.id !== null) {
        const { primaryModel, customModels } = resolveConfiguredModels(
          draft.modelsText,
          buildModelOptions(selectedPreset, result, draft.modelsText),
          selectedPreset?.defaultModel ?? ""
        );
        const discoveryState = discoveryResultToState(result);
        await lyraApi.request<ProfileUpsertResponse>(
          createRequestPayload("lyra/config/profiles/upsert", {
            id: draft.id,
            name: draft.name.trim(),
            providerId: draft.providerId as AiUpsertProfileRequest["providerId"],
            protocolId: draft.protocolId as AiUpsertProfileRequest["protocolId"],
            presetId: draft.presetId,
            connectionConfig: { ...draft.connectionConfig },
            authConfig: { ...draft.authConfig },
            headers: parseMap(draft.headersText),
            model: primaryModel,
            customModels,
            ...(discoveryState === undefined ? {} : { discoveryState }),
          } satisfies AiUpsertProfileRequest as Record<string, unknown>)
        );
        await syncConfig(draft.id);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsRefreshingModels(false);
    }
  }, [buildDiscoverRequest, lyraApi, draft, selectedPreset, syncConfig]);

  const validateProfile = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      return;
    }
    try {
      const result = await lyraApi.request<AiProfileValidationResult>(
        createRequestPayload("lyra/config/profiles/validate", buildValidateRequest() as Record<string, unknown>)
      );
      setStatusMessage(result.message);
      setStatusTone(validationTone(result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    }
  }, [buildValidateRequest, lyraApi]);

  const saveProfile = useCallback(async (): Promise<void> => {
    if (lyraApi === null) {
      return;
    }

    setIsSaving(true);
    let savedProfile: AiProviderProfile | null = null;
    try {
      const response = await lyraApi.request<ProfileUpsertResponse>(
        createRequestPayload("lyra/config/profiles/upsert", buildUpsertRequest() as Record<string, unknown>)
      );
      savedProfile = response.profile;
      await persistDraftSecrets();
      setStatusMessage(labels.statusSaved);
      setStatusTone("success");
      await syncConfig(savedProfile.id);
    } catch (error) {
      if (savedProfile !== null) {
        await syncConfig(savedProfile.id);
      }
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [buildUpsertRequest, lyraApi, labels.statusSaved, persistDraftSecrets, syncConfig]);

  const deleteProfile = useCallback(async (): Promise<void> => {
    if (lyraApi === null || draft.id === null) {
      return;
    }

    setIsSaving(true);
    let deleted = false;
    try {
      await lyraApi.request(
        createRequestPayload("lyra/config/profiles/delete", { id: draft.id })
      );
      deleted = true;
      const baseUrl = readPrimaryConnectionValue(selectedPreset, {
        ...draft.connectionConfig,
      }).trim();
      if (baseUrl.length > 0) {
        await lyraApi.request(createRequestPayload("lyra/secrets.ai.delete", { baseUrl }));
      }
      setStatusMessage(labels.statusDeleted);
      setStatusTone("success");
      await syncConfig(null);
    } catch (error) {
      if (deleted) {
        await syncConfig(null);
      }
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [lyraApi, draft.connectionConfig, draft.id, labels.statusDeleted, selectedPreset, syncConfig]);

  const setDefaultProfile = useCallback(async (): Promise<void> => {
    if (lyraApi === null || draft.id === null) {
      return;
    }

    setIsSaving(true);
    try {
      await lyraApi.request(
        createRequestPayload("lyra/config/profiles/setDefault", { id: draft.id })
      );
      setStatusMessage(labels.statusDefaultUpdated);
      setStatusTone("success");
      await syncConfig(draft.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [lyraApi, draft.id, labels.statusDefaultUpdated, syncConfig]);

  const selectProfile = useCallback((profileId: string | null): void => {
    selectedProfileIdRef.current = profileId;
    setSelectedProfileId(profileId);
    setDraftDiscoveryResult(null);
    setDraft((current) => resetDraftForSelection(profiles, presets, profileId, current));
  }, [presets, profiles, resetDraftForSelection]);

  const applyPreset = useCallback((presetId: string): void => {
    const preset = presets.find((entry) => entry.id === presetId) ?? null;
    setDraftDiscoveryResult(null);
    selectedProfileIdRef.current = null;
    setSelectedProfileId(null);
    setDraft((current) => ({
      ...createDraftFromPreset(preset, current),
      name: current.name,
    }));
  }, [presets]);

  const updateDraftName = useCallback((value: string): void => {
    setDraft((current) => ({
      ...current,
      name: value,
    }));
  }, []);

  const updateDraftHeadersText = useCallback((value: string): void => {
    setDraft((current) => ({
      ...current,
      headersText: value,
    }));
  }, []);

  const updateDraftModelsText = useCallback((value: string): void => {
    setDraftDiscoveryResult(null);
    setDraft((current) => ({
      ...current,
      modelsText: value,
    }));
  }, []);

  const updateDraftField = useCallback((
    target: "connection" | "auth" | "secret",
    fieldId: string,
    value: string
  ): void => {
    setDraftDiscoveryResult(null);
    setDraft((current) => {
      if (target === "connection") {
        return {
          ...current,
          connectionConfig: {
            ...current.connectionConfig,
            [fieldId]: value,
          },
        };
      }
      if (target === "auth") {
        return {
          ...current,
          authConfig: {
            ...current.authConfig,
            [fieldId]: value,
          },
        };
      }

      return {
        ...current,
        secretValues: {
          ...current.secretValues,
          [fieldId]: value,
        },
        clearSecretFields: current.clearSecretFields.filter((entry) => entry !== fieldId),
        configuredSecretFields: mergeSecretFieldList(
          current.configuredSecretFields,
          fieldId,
          value.trim().length > 0
        ),
      };
    });
  }, []);

  const clearSecretField = useCallback((fieldId: string): void => {
    setDraftDiscoveryResult(null);
    setDraft((current) => ({
      ...current,
      secretValues: {
        ...current.secretValues,
        [fieldId]: "",
      },
      clearSecretFields: current.clearSecretFields.includes(fieldId)
        ? current.clearSecretFields
        : [...current.clearSecretFields, fieldId],
      configuredSecretFields: current.configuredSecretFields.filter((entry) => entry !== fieldId),
    }));
  }, []);

  const toggleModelSelection = useCallback((modelId: string): void => {
    const nextIds = selectedModelIds.includes(modelId)
      ? selectedModelIds.filter((entry) => entry !== modelId)
      : [...selectedModelIds, modelId];
    updateDraftModelsText(nextIds.join("\n"));
  }, [selectedModelIds, updateDraftModelsText]);

  const updateBrowserAutomationEngine = useCallback((value: WorkbenchBrowserAutomationEngine): void => {
    writePreferencesField("browserAutomationEngine", value);
    setBrowserAutomationEngineState(value);
  }, []);

  const updateLyraDirectMicroExecutorBudget = useCallback((value: WorkbenchLyraDirectMicroExecutorBudget): void => {
    writePreferencesField("lyraDirectMicroExecutorBudget", value);
    setLyraDirectMicroExecutorBudgetState(value);
  }, []);

  return {
    isLoading,
    isSaving,
    isRefreshingModels,
    statusMessage,
    statusTone,
    runtimeHealth,
    profiles,
    presetSections,
    selectedProfileId,
    defaultProfileId,
    defaultProviderId,
    defaultProfileLabel,
    defaultModelNames,
    selectedPresetId: selectedPreset?.id ?? null,
    selectedPreset,
    draft,
    availableModels,
    selectedModelIds,
    browserAutomationEngine,
    lyraDirectMicroExecutorBudget,
    browserUseRuntimeStatus,
    selectProfile,
    applyPreset,
    updateDraftName,
    updateDraftHeadersText,
    updateDraftModelsText,
    updateDraftField,
    clearSecretField,
    toggleModelSelection,
    refreshConfig: syncConfig,
    refreshModels,
    validateProfile,
    saveProfile,
    deleteProfile,
    setDefaultProfile,
    setBrowserAutomationEngine: updateBrowserAutomationEngine,
    setLyraDirectMicroExecutorBudget: updateLyraDirectMicroExecutorBudget,
  };
};
