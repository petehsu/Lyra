import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentAccountLoginCompleteRequest,
  AgentAccountLoginCompleteResponse,
  AgentAccountLoginStartRequest,
  AgentAccountLoginStartResponse,
  AgentAccountRequest,
  AgentAccountsSnapshot,
  AgentConfigSnapshot,
  AgentConfigUpdateRequest,
  AgentRolesUpdateRequest,
  AgentLoginProviderCatalogSnapshot,
  AgentProviderProfileSaveRequest,
} from "../../../shared/desktop-bridge";
import type { AiProviderModelEntry, AiProviderProfile } from "../../../shared/ai";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
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
  readonly onOpenAgentConfigFile?:
    | ((filePath: string) => void | Promise<void>)
    | undefined;
};

const emptyDraft = (): SettingsAiDraft => ({
  id: null,
  name: "lyra-agent-provider",
  providerId: "agent",
  protocolId: "openai_chat_completions",
  presetId: null,
  connectionConfig: {},
  authConfig: {},
  secretValues: {},
  configuredSecretFields: [],
  headersText: "",
  modelSelectionMode: "custom",
  modelsText: "",
  isDefault: true,
});

const emptySections = (labels: SettingsAiLabels): readonly SettingsAiPresetSection[] => [
  { id: "mainstream", label: labels.sectionAgent, presets: [] },
  { id: "local", label: labels.sectionSessions, presets: [] },
  { id: "custom", label: labels.customSection, presets: [] },
];

const profilesFromAgentConfig = (
  snapshot: AgentConfigSnapshot | null
): readonly AiProviderProfile[] => {
  const config = snapshot?.config as {
    provider?: {
      default_model?: string | null;
      default_provider?: string | null;
      defaultModel?: string | null;
      defaultProvider?: string | null;
    };
    providers?: Record<string, {
      base_url?: string;
      baseUrl?: string;
      default_model?: string | null;
      defaultModel?: string | null;
      models?: readonly { readonly id?: string }[];
    }>;
  } | null;
  const providers = config?.providers ?? {};
  const defaultProvider =
    config?.provider?.default_provider ?? config?.provider?.defaultProvider ?? null;
  const now = Date.now();
  return Object.entries(providers).map(([name, provider]) => {
    const defaultModel = provider.default_model ?? provider.defaultModel ?? "";
    const customModels: readonly AiProviderModelEntry[] = (provider.models ?? [])
      .map((model) => model.id?.trim() ?? "")
      .filter((id) => id.length > 0 && id !== defaultModel)
      .map((id) => ({ id, name: id, source: "custom" as const }));
    return {
      id: name,
      name,
      providerId: "custom_openai_compatible",
      protocolId: "custom_chat_completions",
      runtimeProviderId: name,
      runtimeSupported: true,
      secretStatus: "configured",
      presetId: null,
      connectionConfig: {
        baseUrl: provider.base_url ?? provider.baseUrl ?? "",
      },
      authConfig: {},
      configuredSecretFields: [],
      headers: {},
      model: defaultModel,
      customModels,
      discoveryState: { status: "idle", lastCheckedAt: null, models: [] },
      isDefault: defaultProvider === name,
      createdAt: now,
      updatedAt: now,
    };
  });
};

export const useSettingsAiModel = ({
  desktopApi,
  labels,
  onOpenAgentConfigFile,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [agentConfig, setAgentConfig] = useState<AgentConfigSnapshot | null>(null);
  const [agentAccounts, setAgentAccounts] = useState<AgentAccountsSnapshot | null>(null);
  const [agentLoginProviders, setAgentLoginProviders] =
    useState<AgentLoginProviderCatalogSnapshot | null>(null);
  const [draft, setDraft] = useState<SettingsAiDraft>(() => emptyDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshAgent = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    const config = await desktopApi.agent.readAgentConfig();
    setAgentConfig(config);
    const listAccounts = desktopApi.agent.listAccounts;
    if (typeof listAccounts === "function") {
      setAgentAccounts(await listAccounts());
    }
    const listLoginProviders = desktopApi.agent.listLoginProviders;
    if (typeof listLoginProviders === "function") {
      setAgentLoginProviders(await listLoginProviders());
    }
    setErrorMessage(null);
  }, [desktopApi, labels.runtimeUnavailable]);

  useEffect(() => {
    void refreshAgent().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, [refreshAgent]);

  const updateAgentConfig = useCallback(async (request: AgentConfigUpdateRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentConfig(await desktopApi.agent.updateAgentConfig(request));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const saveAgentProviderProfile = useCallback(async (
    request: AgentProviderProfileSaveRequest
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentConfig(await desktopApi.agent.saveAgentProviderProfile(request));
      setErrorMessage(null);
      await refreshAgent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const startAgentAccountLogin = useCallback(async (
    request: AgentAccountLoginStartRequest
  ): Promise<AgentAccountLoginStartResponse | null> => {
    if (desktopApi?.agent === undefined) return null;
    setIsSaving(true);
    try {
      const response = await desktopApi.agent.startAccountLogin(request);
      if (response.authUrl !== undefined && response.authUrl !== null && response.authUrl.length > 0) {
        await desktopApi.openExternal(response.authUrl);
      }
      setErrorMessage(null);
      return response;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const completeAgentAccountLogin = useCallback(async (
    request: AgentAccountLoginCompleteRequest
  ): Promise<AgentAccountLoginCompleteResponse | null> => {
    if (desktopApi?.agent === undefined) return null;
    setIsSaving(true);
    try {
      const response = await desktopApi.agent.completeAccountLogin(request);
      setAgentAccounts(response.accounts);
      await refreshAgent();
      setErrorMessage(null);
      return response;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const updateAgentRoles = useCallback(async (
    request: AgentRolesUpdateRequest
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentConfig(await desktopApi.agent.updateAgentRoles(request));
      setErrorMessage(null);
      await refreshAgent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const switchAgentAccount = useCallback(async (request: AgentAccountRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentAccounts(await desktopApi.agent.switchAccount(request));
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const removeAgentAccount = useCallback(async (request: AgentAccountRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentAccounts(await desktopApi.agent.removeAccount(request));
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const openAgentConfigFile = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }
    if (onOpenAgentConfigFile === undefined) {
      setErrorMessage(labels.fileEditorUnavailable);
      return;
    }
    try {
      const snapshot = agentConfig ?? await desktopApi.agent.readAgentConfig();
      setAgentConfig(snapshot);
      const configPath = snapshot.configPath?.trim() ?? "";
      if (configPath.length === 0) {
        setErrorMessage(labels.configPathUnavailable);
        return;
      }
      await onOpenAgentConfigFile(configPath);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    desktopApi,
    agentConfig,
    labels.configPathUnavailable,
    labels.fileEditorUnavailable,
    labels.runtimeUnavailable,
    onOpenAgentConfigFile
  ]);

  const profiles = useMemo(() => profilesFromAgentConfig(agentConfig), [agentConfig]);
  const defaultProfile = profiles.find((profile) => profile.isDefault) ?? null;

  const noopAsync = useCallback(async (): Promise<void> => undefined, []);
  const noop = useCallback((): void => undefined, []);

  return {
    isSaving,
    errorMessage,
    profiles,
    presetSections: emptySections(labels),
    selectedProfileId: defaultProfile?.id ?? null,
    defaultProfileId: defaultProfile?.id ?? null,
    defaultProviderId: defaultProfile?.providerId ?? null,
    defaultModelNames: defaultProfile?.model ? [defaultProfile.model] : [],
    selectedPresetId: null,
    selectedPreset: null,
    agentConfig,
    agentAccounts,
    agentLoginProviders,
    draft,
    modelSelectionMode: draft.modelSelectionMode,
    availableModels: [],
    selectProfile: noop,
    applyPreset: noop,
    updateDraftName: (value) => {
      setDraft((current) => ({ ...current, name: value }));
    },
    updateDraftModelSelectionMode: (value: SettingsAiModelSelectionMode) => {
      setDraft((current) => ({ ...current, modelSelectionMode: value }));
    },
    updateDraftHeadersText: (value) => {
      setDraft((current) => ({ ...current, headersText: value }));
    },
    updateDraftModelsText: (value) => {
      setDraft((current) => ({ ...current, modelsText: value }));
    },
    updateDraftField: (target, fieldId, value) => {
      setDraft((current) => {
        const next = { ...(target === "connection"
          ? current.connectionConfig
          : target === "auth"
            ? current.authConfig
            : current.secretValues) };
        if (value.trim().length === 0) {
          delete next[fieldId];
        } else {
          next[fieldId] = value;
        }
        if (target === "connection") return { ...current, connectionConfig: next };
        if (target === "auth") return { ...current, authConfig: next };
        return { ...current, secretValues: next };
      });
    },
    saveProfile: noopAsync,
    deleteProfile: noopAsync,
    deleteProviderModels: noopAsync,
    deleteConfiguredModel: noopAsync,
    setDefaultProfile: async (profileId: string) => {
      const profile = profiles.find((entry) => entry.id === profileId);
      await updateAgentConfig({
        defaultProvider: profileId,
        defaultModel: profile?.model ?? null,
      });
    },
    refreshAgent,
    openAgentConfigFile,
    updateAgentConfig,
    saveAgentProviderProfile,
    startAgentAccountLogin,
    completeAgentAccountLogin,
    updateAgentRoles,
    switchAgentAccount,
    removeAgentAccount,
  };
};
