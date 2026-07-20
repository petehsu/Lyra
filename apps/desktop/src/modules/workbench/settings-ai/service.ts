import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentAccountRequest,
  AgentAccountsSnapshot,
  AgentConfigSnapshot,
  AgentConfigUpdateRequest,
  AgentModelCatalogSnapshot,
  AgentModelDeleteRequest,
  AgentModelEnableRequest,
  AgentModelSwitchRequest,
  AgentMcpListResponse,
  AgentMcpServerRequest,
  AgentMcpServerUpsertRequest,
  AgentProviderCatalogSnapshot,
  AgentProviderProfileSaveRequest,
  AgentSkillActivationRequest,
  AgentSkillInstallFromGitRequest,
  AgentSkillInstallFromLocalRequest,
  AgentSkillInstallFromStoreRequest,
  AgentSkillRefreshStoreRequest,
  AgentSkillsListResponse,
  AgentSkillStoreResponse,
  AgentSkillUninstallRequest,
  LyraDesktopApi,
} from "../../../shared/desktop-bridge";
import type {
  SettingsAiLabels,
  SettingsAiModel,
} from "./types";

type UseSettingsAiModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsAiLabels;
  readonly onOpenAgentConfigFile?:
    | ((filePath: string) => void | Promise<void>)
    | undefined;
  readonly onOpenSite?: (url: string, title?: string) => void;
};

type AgentRefreshSnapshot = {
  readonly config: AgentConfigSnapshot;
  readonly catalog: AgentProviderCatalogSnapshot;
  readonly accounts: AgentAccountsSnapshot;
  readonly modelCatalog: AgentModelCatalogSnapshot;
  readonly skillCatalog: AgentSkillsListResponse;
  readonly mcpCatalog: AgentMcpListResponse;
};

type AgentConfigProviderShape = {
  readonly label?: string | null;
  readonly routeId?: string | null;
  readonly baseUrl?: string | null;
  readonly defaultModel?: string | null;
  readonly authHeader?: string | null;
  readonly models?: readonly {
    readonly id?: string | null;
    readonly contextWindow?: number | null;
    readonly supportsImageInput?: boolean;
    readonly supportsToolCalling?: boolean;
    readonly supportsStreaming?: boolean;
    readonly enabled?: boolean;
  }[];
};

type AgentConfigShape = {
  readonly providers?: Record<string, AgentConfigProviderShape>;
};

const asAgentConfig = (snapshot: AgentConfigSnapshot | null): AgentConfigShape =>
  (snapshot?.config ?? {}) as AgentConfigShape;

const isUnknownModelDeleteMethodError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("unknown agent runtime method")
    && message.includes("agent.models.delete");
};

export const useSettingsAiModel = ({
  desktopApi,
  labels,
  onOpenAgentConfigFile,
  onOpenSite,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [agentConfig, setAgentConfig] = useState<AgentConfigSnapshot | null>(null);
  const [agentProviderCatalog, setAgentProviderCatalog] =
    useState<AgentProviderCatalogSnapshot | null>(null);
  const [agentAccounts, setAgentAccounts] = useState<AgentAccountsSnapshot | null>(null);
  const [agentModelCatalog, setAgentModelCatalog] =
    useState<AgentModelCatalogSnapshot | null>(null);
  const [agentSkillCatalog, setAgentSkillCatalog] =
    useState<AgentSkillsListResponse | null>(null);
  const [agentMcpCatalog, setAgentMcpCatalog] =
    useState<AgentMcpListResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshAgent = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setErrorMessage(labels.runtimeUnavailable);
      return;
    }

    const [
      config,
      catalog,
      accounts,
      modelCatalog,
      skillCatalog,
      mcpCatalog,
    ]: [
      AgentConfigSnapshot,
      AgentProviderCatalogSnapshot,
      AgentAccountsSnapshot,
      AgentModelCatalogSnapshot,
      AgentSkillsListResponse,
      AgentMcpListResponse,
    ] = await Promise.all([
      desktopApi.agent.readAgentConfig(),
      desktopApi.agent.readAgentProviderCatalog(),
      desktopApi.agent.listAccounts(),
      desktopApi.agent.listAgentModels(),
      desktopApi.agent.listAgentSkills(),
      desktopApi.agent.listMcpServers(),
    ]);

    const snapshot: AgentRefreshSnapshot = {
      config,
      catalog,
      accounts,
      modelCatalog,
      skillCatalog,
      mcpCatalog,
    };

    setAgentConfig(snapshot.config);
    setAgentProviderCatalog(snapshot.catalog);
    setAgentAccounts(snapshot.accounts);
    setAgentModelCatalog(snapshot.modelCatalog);
    setAgentSkillCatalog(snapshot.skillCatalog);
    setAgentMcpCatalog(snapshot.mcpCatalog);
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
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const saveAgentProviderProfile = useCallback(async (
    request: AgentProviderProfileSaveRequest,
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentConfig(await desktopApi.agent.saveAgentProviderProfile(request));
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const refreshAgentModels = useCallback(async (providerId: string) => {
    if (desktopApi?.agent === undefined) return null;
    setIsSaving(true);
    try {
      const catalog = await desktopApi.agent.refreshAgentModels({ provider: providerId });
      setAgentModelCatalog(catalog);
      await refreshAgent();
      setErrorMessage(null);
      return catalog;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const refreshAgentModelCatalog = useCallback(async () => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentModelCatalog(await desktopApi.agent.refreshAgentModels());
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const switchAgentModel = useCallback(async (request: AgentModelSwitchRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentModelCatalog(await desktopApi.agent.switchAgentModel(request));
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const setAgentModelEnabled = useCallback(async (request: AgentModelEnableRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentModelCatalog(await desktopApi.agent.setAgentModelEnabled(request));
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const deleteAgentModel = useCallback(async (request: AgentModelDeleteRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentModelCatalog(await desktopApi.agent.deleteAgentModel(request));
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      if (isUnknownModelDeleteMethodError(error)) {
        const providerConfig = asAgentConfig(agentConfig).providers?.[request.provider] ?? null;
        if (providerConfig !== null && providerConfig.routeId !== undefined && providerConfig.routeId !== null) {
          const remainingModels = (providerConfig.models ?? [])
            .filter((entry) => entry.id !== undefined && entry.id !== null && entry.id !== request.model)
            .map((entry) => ({
              id: entry.id ?? "",
              ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
              ...(entry.supportsImageInput === undefined ? {} : { supportsImageInput: entry.supportsImageInput }),
              ...(entry.supportsToolCalling === undefined ? {} : { supportsToolCalling: entry.supportsToolCalling }),
              ...(entry.supportsStreaming === undefined ? {} : { supportsStreaming: entry.supportsStreaming }),
              ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
            }));
          const fallbackDefaultModel = providerConfig.defaultModel === request.model
            ? remainingModels[0]?.id ?? null
            : providerConfig.defaultModel ?? null;
          await desktopApi.agent.saveAgentProviderProfile({
            profileName: request.provider,
            routeId: providerConfig.routeId,
            baseUrl: providerConfig.baseUrl ?? "",
            defaultModel: fallbackDefaultModel,
            authHeader: providerConfig.authHeader ?? null,
            models: remainingModels,
          });
          await refreshAgent();
          setErrorMessage(null);
          return;
        }
      }
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [agentConfig, desktopApi, refreshAgent]);

  const refreshAgentSkills = useCallback(async () => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const refreshAgentSkillStore = useCallback(async (
    request?: AgentSkillRefreshStoreRequest,
  ): Promise<AgentSkillStoreResponse | null> => {
    if (desktopApi?.agent === undefined) return null;
    setIsSaving(true);
    try {
      const response = await desktopApi.agent.refreshAgentSkillStore(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
      return response;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const updateAgentSkillStoreConfig = useCallback(async (
    request: AgentSkillRefreshStoreRequest,
  ): Promise<AgentSkillStoreResponse | null> => {
    if (desktopApi?.agent === undefined) return null;
    setIsSaving(true);
    try {
      const response = await desktopApi.agent.updateAgentSkillStoreConfig(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
      return response;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const activateAgentSkill = useCallback(async (request: AgentSkillActivationRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.activateAgentSkill(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const deactivateAgentSkill = useCallback(async (request: AgentSkillActivationRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.deactivateAgentSkill(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const installAgentSkillFromLocal = useCallback(async (
    request: AgentSkillInstallFromLocalRequest,
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.installAgentSkillFromLocal(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const installAgentSkillFromGit = useCallback(async (
    request: AgentSkillInstallFromGitRequest,
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.installAgentSkillFromGit(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const installAgentSkillFromStore = useCallback(async (
    request: AgentSkillInstallFromStoreRequest,
  ) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.installAgentSkillFromStore(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const uninstallAgentSkill = useCallback(async (request: AgentSkillUninstallRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.uninstallAgentSkill(request);
      setAgentSkillCatalog(await desktopApi.agent.listAgentSkills());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const refreshAgentMcp = useCallback(async () => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentMcpCatalog(await desktopApi.agent.listMcpServers());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const upsertAgentMcpServer = useCallback(async (request: AgentMcpServerUpsertRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.upsertMcpServer(request);
      setAgentMcpCatalog(await desktopApi.agent.listMcpServers());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const removeAgentMcpServer = useCallback(async (request: AgentMcpServerRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.removeMcpServer(request);
      setAgentMcpCatalog(await desktopApi.agent.listMcpServers());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const connectAgentMcpServer = useCallback(async (request: AgentMcpServerRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.connectMcpServer(request);
      setAgentMcpCatalog(await desktopApi.agent.listMcpServers());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

  const disconnectAgentMcpServer = useCallback(async (request: AgentMcpServerRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.disconnectMcpServer(request);
      setAgentMcpCatalog(await desktopApi.agent.listMcpServers());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi]);

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
    onOpenAgentConfigFile,
  ]);

  const profiles = useMemo(
    () => (agentProviderCatalog?.profiles ?? []).filter((profile) => profile.configured),
    [agentProviderCatalog],
  );
  const quickSetupRoutes = useMemo(
    () =>
      (agentProviderCatalog?.routes ?? []).filter(
        (route) => route.runtimeSupported && route.quickSetupSupported,
      ),
    [agentProviderCatalog],
  );
  const localRoutes = useMemo(
    () =>
      (agentProviderCatalog?.routes ?? []).filter(
        (route) => route.runtimeSupported && route.catalogSection === "local",
      ),
    [agentProviderCatalog],
  );

  return {
    isSaving,
    errorMessage,
    profiles,
    quickSetupRoutes,
    localRoutes,
    defaultProfileId: agentProviderCatalog?.defaultProvider ?? null,
    agentConfig,
    agentAccounts,
    agentModelCatalog,
    agentSkillCatalog,
    agentMcpCatalog,
    agentProviderCatalog,
    setDefaultProfile: async (profileId: string) => {
      const profile = profiles.find((entry) => entry.id === profileId) ?? null;
      await updateAgentConfig({
        defaultProvider: profileId,
        defaultModel: profile?.defaultModel ?? null,
      });
    },
    refreshAgent,
    openAgentConfigFile,
    updateAgentConfig,
    saveAgentProviderProfile,
    refreshAgentModels,
    refreshAgentModelCatalog,
    setAgentModelEnabled,
    deleteAgentModel,
    switchAgentModel,
    refreshAgentSkills,
    refreshAgentSkillStore,
    updateAgentSkillStoreConfig,
    activateAgentSkill,
    deactivateAgentSkill,
    installAgentSkillFromLocal,
    installAgentSkillFromGit,
    installAgentSkillFromStore,
    uninstallAgentSkill,
    refreshAgentMcp,
    upsertAgentMcpServer,
    removeAgentMcpServer,
    connectAgentMcpServer,
    disconnectAgentMcpServer,
    switchAgentAccount,
    removeAgentAccount,
    ...(onOpenSite === undefined ? {} : { openPageInNewTab: onOpenSite }),
  };
};
