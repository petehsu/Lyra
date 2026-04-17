import { useCallback, useEffect, useState } from "react";

import type {
  AiDiscoverModelsRequest,
  AiModelDiscoveryResult,
  AiProviderCatalogItem,
  AiProviderPreset,
  AiProviderProfile,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "../../../shared/ai";
import type { AiMemoryConfig } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  findSelectedProfile,
  parseMap,
  resolveConfiguredModels,
  resolvePrimarySecretFieldId,
  resolvePrimaryUrlFieldId,
  serializeConfiguredModels,
  toDraft
} from "./draft";
import { buildModelOptions } from "./model-options";
import { resolvePreset } from "./preset";
import type { SettingsAiDraft, SettingsAiLabels, SettingsAiModel } from "./types";

type UseSettingsAiModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsAiLabels;
};

export const useSettingsAiModel = ({
  desktopApi,
  labels
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [profiles, setProfiles] = useState<readonly AiProviderProfile[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<readonly AiProviderCatalogItem[]>([]);
  const [presetCatalog, setPresetCatalog] = useState<readonly AiProviderPreset[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingsAiDraft>(() => toDraft(null, []));
  const [discoveryResult, setDiscoveryResult] = useState<AiModelDiscoveryResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [statusMessage, setStatusMessage] = useState(labels.statusIdle);
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [memoryConfigText, setMemoryConfigText] = useState("");
  const [memoryConfigStatus, setMemoryConfigStatus] = useState(labels.memoryConfigStatusIdle);
  const [memoryConfigStatusTone, setMemoryConfigStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [isMemoryConfigLoading, setIsMemoryConfigLoading] = useState(false);
  const [isMemoryConfigSaving, setIsMemoryConfigSaving] = useState(false);

  const syncProfiles = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      setProfiles([]);
      setProviderCatalog([]);
      setPresetCatalog([]);
      setSelectedProfileId(null);
      setDraft(toDraft(null, []));
      setDiscoveryResult(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [nextProfiles, nextProviderCatalog, nextPresetCatalog] = await Promise.all([
        desktopApi.ai.readProfiles(),
        desktopApi.ai.readProviderCatalog(),
        desktopApi.ai.readPresetCatalog()
      ]);
      setProfiles(nextProfiles);
      setProviderCatalog(nextProviderCatalog);
      setPresetCatalog(nextPresetCatalog);
      setSelectedProfileId((currentId) => {
        const fallbackId =
          nextProfiles.find((profile) => profile.isDefault)?.id
          ?? nextProfiles[0]?.id
          ?? null;
        const nextId =
          currentId !== null && nextProfiles.some((profile) => profile.id === currentId)
            ? currentId
            : fallbackId;
        setDraft(toDraft(findSelectedProfile(nextProfiles, nextId), nextPresetCatalog));
        return nextId;
      });
    } finally {
      setIsLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    setStatusMessage(labels.statusIdle);
  }, [labels.statusIdle]);

  useEffect(() => {
    setMemoryConfigStatus(labels.memoryConfigStatusIdle);
  }, [labels.memoryConfigStatusIdle]);

  useEffect(() => {
    void syncProfiles();
  }, [syncProfiles]);

  const selectProfile = useCallback((profileId: string): void => {
    const nextProfile = findSelectedProfile(profiles, profileId);
    setSelectedProfileId(profileId);
    setDraft(toDraft(nextProfile, presetCatalog));
    setDiscoveryResult(nextProfile?.discoveryState.status === "ready"
      ? {
          providerId: nextProfile.providerId,
          protocolId: nextProfile.protocolId,
          status: "ready",
          message: labels.statusIdle,
          checkedAt: nextProfile.discoveryState.lastCheckedAt ?? Date.now(),
          models: nextProfile.discoveryState.models
        }
      : null);
  }, [labels.statusIdle, presetCatalog, profiles]);

  const createProfileDraft = useCallback((): void => {
    setSelectedProfileId(null);
    setDraft(toDraft(null, presetCatalog));
    setDiscoveryResult(null);
  }, [presetCatalog]);

  const selectPreset = useCallback((presetId: string): void => {
    const preset = resolvePreset(presetCatalog, presetId, draft.providerId, draft.protocolId);
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
      clearSecretFields: [],
      configuredSecretFields: [],
      headersText: preset.customHeadersSupported ? current.headersText : "",
      modelsText: serializeConfiguredModels(preset.defaultModel, [])
    }));
    setDiscoveryResult(null);
  }, [draft.protocolId, draft.providerId, presetCatalog]);

  const updateDraftField = useCallback((
    target: "connection" | "auth" | "secret",
    fieldId: string,
    value: string
  ): void => {
    setDraft((current) => {
      if (target === "connection") {
        return {
          ...current,
          connectionConfig: {
            ...current.connectionConfig,
            [fieldId]: value
          }
        };
      }
      if (target === "auth") {
        return {
          ...current,
          authConfig: {
            ...current.authConfig,
            [fieldId]: value
          }
        };
      }
      return {
        ...current,
        secretValues: {
          ...current.secretValues,
          [fieldId]: value
        },
        clearSecretFields: current.clearSecretFields.filter((entry) => entry !== fieldId)
      };
    });
  }, []);

  const updateName = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, name: value }));
  }, []);

  const updateUrl = useCallback((value: string): void => {
    setDraft((current) => {
      const preset = resolvePreset(presetCatalog, current.presetId, current.providerId, current.protocolId);
      const fieldId = resolvePrimaryUrlFieldId(preset);
      if (fieldId === null) {
        return current;
      }
      return {
        ...current,
        connectionConfig: {
          ...current.connectionConfig,
          [fieldId]: value
        }
      };
    });
  }, [presetCatalog]);

  const updateKey = useCallback((value: string): void => {
    setDraft((current) => {
      const preset = resolvePreset(presetCatalog, current.presetId, current.providerId, current.protocolId);
      const fieldId = resolvePrimarySecretFieldId(preset);
      if (fieldId === null) {
        return current;
      }
      return {
        ...current,
        secretValues: {
          ...current.secretValues,
          [fieldId]: value
        },
        clearSecretFields: current.clearSecretFields.filter((entry) => entry !== fieldId)
      };
    });
  }, [presetCatalog]);

  const updateModelsText = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, modelsText: value }));
  }, []);

  const toggleModelOption = useCallback((modelId: string): void => {
    setDraft((current) => {
      const preset = resolvePreset(presetCatalog, current.presetId, current.providerId, current.protocolId);
      const knownModels = buildModelOptions(preset, discoveryResult, current.modelsText);
      const resolved = resolveConfiguredModels(current.modelsText, knownModels, preset?.defaultModel ?? "");
      const alreadyIncluded = resolved.modelIds.includes(modelId);
      const nextIds = alreadyIncluded
        ? resolved.modelIds.filter((entry) => entry !== modelId)
        : [...resolved.modelIds, modelId];
      return {
        ...current,
        modelsText: nextIds.join("\n")
      };
    });
  }, [discoveryResult, presetCatalog]);

  const updateHeadersText = useCallback((value: string): void => {
    setDraft((current) => ({ ...current, headersText: value }));
  }, []);

  const clearSecretField = useCallback((fieldId: string): void => {
    setDraft((current) => ({
      ...current,
      secretValues: {
        ...current.secretValues,
        [fieldId]: ""
      },
      configuredSecretFields: current.configuredSecretFields.filter((entry) => entry !== fieldId),
      clearSecretFields: current.clearSecretFields.includes(fieldId)
        ? current.clearSecretFields
        : [...current.clearSecretFields, fieldId]
    }));
  }, []);

  const buildResolvedModels = useCallback(() => {
    const preset = resolvePreset(presetCatalog, draft.presetId, draft.providerId, draft.protocolId);
    const knownModels = buildModelOptions(preset, discoveryResult, draft.modelsText);
    return resolveConfiguredModels(draft.modelsText, knownModels, preset?.defaultModel ?? "");
  }, [
    discoveryResult,
    draft.modelsText,
    draft.presetId,
    draft.protocolId,
    draft.providerId,
    presetCatalog
  ]);

  const authorizeOpenAiChatGpt = useCallback(async (): Promise<void> => {
    if (desktopApi === null || draft.providerId !== "openai") {
      return;
    }

    setIsSaving(true);
    setStatusTone("neutral");
    try {
      const result = await desktopApi.ai.authorizeOpenAiChatGpt();
      const normalizedName = draft.name.trim().length > 0
        ? draft.name.trim()
        : "OpenAI ChatGPT OAuth";
      const resolvedModels = buildResolvedModels();
      const normalizedModel = resolvedModels.primaryModel.trim().length > 0
        ? resolvedModels.primaryModel.trim()
        : "gpt-5.4";
      const saved = await desktopApi.ai.upsertProfile({
        ...(draft.id === null ? {} : { id: draft.id }),
        name: normalizedName,
        providerId: draft.providerId,
        protocolId: draft.protocolId,
        presetId: draft.presetId,
        connectionConfig: draft.connectionConfig,
        authConfig: {
          ...draft.authConfig,
          authMode: "chatgpt_oauth",
          ...(result.accountId === undefined ? {} : { chatgptAccountId: result.accountId })
        },
        headers: parseMap(draft.headersText),
        model: normalizedModel,
        customModels: resolvedModels.customModels,
        secretValues: { refreshToken: result.refreshToken },
        clearSecretFields: draft.clearSecretFields.filter((entry) => entry !== "refreshToken")
      });
      setSelectedProfileId(saved.id);
      await syncProfiles();
      setStatusMessage(labels.statusChatGptAuthorized);
      setStatusTone("success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [
    desktopApi,
    draft.authConfig,
    buildResolvedModels,
    draft.clearSecretFields,
    draft.connectionConfig,
    draft.headersText,
    draft.id,
    draft.name,
    draft.presetId,
    draft.protocolId,
    draft.providerId,
    labels.statusChatGptAuthorized,
    syncProfiles
  ]);

  const authorizeOpenAiChatGptDeviceCode = useCallback(async (): Promise<void> => {
    if (desktopApi === null || draft.providerId !== "openai") {
      return;
    }

    setIsSaving(true);
    setStatusTone("neutral");
    try {
      const result = await desktopApi.ai.authorizeOpenAiChatGptDeviceCode();
      const normalizedName = draft.name.trim().length > 0
        ? draft.name.trim()
        : "OpenAI ChatGPT OAuth";
      const resolvedModels = buildResolvedModels();
      const normalizedModel = resolvedModels.primaryModel.trim().length > 0
        ? resolvedModels.primaryModel.trim()
        : "gpt-5.4";
      const saved = await desktopApi.ai.upsertProfile({
        ...(draft.id === null ? {} : { id: draft.id }),
        name: normalizedName,
        providerId: draft.providerId,
        protocolId: draft.protocolId,
        presetId: draft.presetId,
        connectionConfig: draft.connectionConfig,
        authConfig: {
          ...draft.authConfig,
          authMode: "chatgpt_oauth",
          ...(result.accountId === undefined ? {} : { chatgptAccountId: result.accountId })
        },
        headers: parseMap(draft.headersText),
        model: normalizedModel,
        customModels: resolvedModels.customModels,
        secretValues: { refreshToken: result.refreshToken },
        clearSecretFields: draft.clearSecretFields.filter((entry) => entry !== "refreshToken")
      });
      setSelectedProfileId(saved.id);
      await syncProfiles();
      setStatusMessage(labels.statusChatGptAuthorized);
      setStatusTone("success");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [
    desktopApi,
    draft.authConfig,
    buildResolvedModels,
    draft.clearSecretFields,
    draft.connectionConfig,
    draft.headersText,
    draft.id,
    draft.name,
    draft.presetId,
    draft.protocolId,
    draft.providerId,
    labels.statusChatGptAuthorized,
    syncProfiles
  ]);

  const buildSecretValues = useCallback((): Record<string, string | null> | null => {
    const secretEntries = Object.entries(draft.secretValues)
      .filter(([, value]) => value.trim().length > 0);
    return secretEntries.length > 0 ? Object.fromEntries(secretEntries) : null;
  }, [draft.secretValues]);

  const buildUpsertPayload = useCallback((): AiUpsertProfileRequest => {
    const secretValues = buildSecretValues();
    const resolvedModels = buildResolvedModels();
    return {
      ...(draft.id === null ? {} : { id: draft.id }),
      name: draft.name,
      providerId: draft.providerId,
      protocolId: draft.protocolId,
      presetId: draft.presetId,
      connectionConfig: draft.connectionConfig,
      authConfig: draft.authConfig,
      headers: parseMap(draft.headersText),
      model: resolvedModels.primaryModel,
      customModels: resolvedModels.customModels,
      ...(secretValues === null ? {} : { secretValues }),
      ...(draft.clearSecretFields.length === 0 ? {} : { clearSecretFields: draft.clearSecretFields })
    };
  }, [buildResolvedModels, buildSecretValues, draft]);

  const buildValidatePayload = useCallback((): AiValidateProfileRequest => {
    const secretValues = buildSecretValues();
    const resolvedModels = buildResolvedModels();
    return {
      ...(draft.id === null ? {} : { id: draft.id }),
      providerId: draft.providerId,
      protocolId: draft.protocolId,
      presetId: draft.presetId,
      connectionConfig: draft.connectionConfig,
      authConfig: draft.authConfig,
      headers: parseMap(draft.headersText),
      model: resolvedModels.primaryModel,
      ...(secretValues === null ? {} : { secretValues })
    };
  }, [buildResolvedModels, buildSecretValues, draft]);

  const buildDiscoveryPayload = useCallback((forceRefresh: boolean): AiDiscoverModelsRequest => {
    const secretValues = buildSecretValues();
    return {
      ...(draft.id === null ? {} : { id: draft.id }),
      providerId: draft.providerId,
      protocolId: draft.protocolId,
      presetId: draft.presetId,
      connectionConfig: draft.connectionConfig,
      authConfig: draft.authConfig,
      headers: parseMap(draft.headersText),
      ...(secretValues === null ? {} : { secretValues }),
      ...(forceRefresh ? { forceRefresh: true } : {})
    };
  }, [buildSecretValues, draft]);

  const saveProfile = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      return;
    }

    setIsSaving(true);
    setStatusTone("neutral");
    try {
      const saved = await desktopApi.ai.upsertProfile(buildUpsertPayload());
      setStatusMessage(labels.statusSaved);
      setStatusTone("success");
      setSelectedProfileId(saved.id);
      await syncProfiles();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [buildUpsertPayload, desktopApi, labels.statusSaved, syncProfiles]);

  const deleteProfile = useCallback(async (): Promise<void> => {
    if (desktopApi === null || selectedProfileId === null) {
      return;
    }

    setIsSaving(true);
    setStatusTone("neutral");
    try {
      await desktopApi.ai.deleteProfile({ id: selectedProfileId });
      setStatusMessage(labels.statusDeleted);
      setStatusTone("success");
      await syncProfiles();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, labels.statusDeleted, selectedProfileId, syncProfiles]);

  const setDefaultProfile = useCallback(async (): Promise<void> => {
    if (desktopApi === null || selectedProfileId === null) {
      return;
    }

    setIsSaving(true);
    setStatusTone("neutral");
    try {
      await desktopApi.ai.setDefaultProfile({ id: selectedProfileId });
      setStatusMessage(labels.statusDefaultUpdated);
      setStatusTone("success");
      await syncProfiles();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, labels.statusDefaultUpdated, selectedProfileId, syncProfiles]);

  const testConnection = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      return;
    }

    setIsTesting(true);
    setStatusTone("neutral");
    try {
      const validation = await desktopApi.ai.validateProfile(buildValidatePayload());
      setStatusMessage(validation.message);
      setStatusTone(validation.ok ? "success" : "error");
      setLastCheckedAt(validation.checkedAt);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
      setLastCheckedAt(Date.now());
    } finally {
      setIsTesting(false);
    }
  }, [buildValidatePayload, desktopApi]);

  const runDiscovery = useCallback(async (forceRefresh: boolean): Promise<void> => {
    if (desktopApi === null) {
      return;
    }

    setIsDiscovering(true);
    setStatusTone("neutral");
    try {
      const payload = buildDiscoveryPayload(forceRefresh);
      const result = forceRefresh
        ? await desktopApi.ai.refreshDiscoveredModels(payload)
        : await desktopApi.ai.discoverModels(payload);
      setDiscoveryResult(result);
      setStatusMessage(result.message);
      setStatusTone(result.status === "ready" ? "success" : "error");
      setLastCheckedAt(result.checkedAt);
      setDraft((current) => result.models.length === 0
        ? current
        : {
            ...current,
            modelsText: serializeConfiguredModels(result.models[0]?.id ?? "", result.models.slice(1))
          });
    } catch (error) {
      setDiscoveryResult(null);
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
      setLastCheckedAt(Date.now());
    } finally {
      setIsDiscovering(false);
    }
  }, [buildDiscoveryPayload, desktopApi]);

  const discoverModels = useCallback(async (): Promise<void> => {
    await runDiscovery(false);
  }, [runDiscovery]);

  const refreshDiscoveredModels = useCallback(async (): Promise<void> => {
    await runDiscovery(true);
  }, [runDiscovery]);

  const loadMemoryConfig = useCallback(async (): Promise<void> => {
    if (desktopApi === null || desktopApi.agent === undefined) {
      return;
    }
    setIsMemoryConfigLoading(true);
    setMemoryConfigStatusTone("neutral");
    try {
      const config = await desktopApi.agent.getMemoryConfig();
      setMemoryConfigText(JSON.stringify(config, null, 2));
      setMemoryConfigStatus(labels.memoryConfigStatusLoaded);
      setMemoryConfigStatusTone("success");
    } catch (error) {
      setMemoryConfigStatus(error instanceof Error ? error.message : String(error));
      setMemoryConfigStatusTone("error");
    } finally {
      setIsMemoryConfigLoading(false);
    }
  }, [desktopApi, labels.memoryConfigStatusLoaded]);

  const saveMemoryConfig = useCallback(async (): Promise<void> => {
    if (desktopApi === null || desktopApi.agent === undefined) {
      return;
    }
    let parsed: AiMemoryConfig;
    try {
      parsed = JSON.parse(memoryConfigText) as AiMemoryConfig;
    } catch {
      setMemoryConfigStatus(labels.memoryConfigStatusInvalidJson);
      setMemoryConfigStatusTone("error");
      return;
    }

    setIsMemoryConfigSaving(true);
    setMemoryConfigStatusTone("neutral");
    try {
      const updated = await desktopApi.agent.updateMemoryConfig(parsed);
      setMemoryConfigText(JSON.stringify(updated, null, 2));
      setMemoryConfigStatus(labels.memoryConfigStatusSaved);
      setMemoryConfigStatusTone("success");
    } catch (error) {
      setMemoryConfigStatus(error instanceof Error ? error.message : String(error));
      setMemoryConfigStatusTone("error");
    } finally {
      setIsMemoryConfigSaving(false);
    }
  }, [
    desktopApi,
    labels.memoryConfigStatusInvalidJson,
    labels.memoryConfigStatusSaved,
    memoryConfigText
  ]);

  return {
    profiles,
    providerCatalog,
    presetCatalog,
    selectedProfileId,
    draft,
    discoveryResult,
    isLoading,
    isSaving,
    isTesting,
    isDiscovering,
    isMemoryConfigLoading,
    isMemoryConfigSaving,
    statusMessage,
    statusTone,
    lastCheckedAt,
    memoryConfigText,
    memoryConfigStatus,
    memoryConfigStatusTone,
    browserAutomationEngine: "lyra_direct",
    lyraDirectMicroExecutorBudget: "3-5",
    browserUseRuntimeStatus: {
      state: "checking",
      checkedAt: Date.now()
    },
    selectProfile,
    createProfileDraft,
    selectPreset,
    updateName,
    updateUrl,
    updateKey,
    updateModelsText,
    toggleModelOption,
    updateDraftField,
    updateHeadersText,
    clearSecretField,
    authorizeOpenAiChatGpt,
    authorizeOpenAiChatGptDeviceCode,
    saveProfile,
    deleteProfile,
    setDefaultProfile,
    testConnection,
    discoverModels,
    refreshDiscoveredModels,
    loadMemoryConfig,
    saveMemoryConfig,
    updateMemoryConfigText: setMemoryConfigText,
    setBrowserAutomationEngine: () => {},
    setLyraDirectMicroExecutorBudget: () => {}
  };
};
