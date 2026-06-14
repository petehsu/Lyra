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
  AgentLoginProviderCatalogSnapshot,
  AgentProviderCatalogSnapshot,
  AgentProviderProfileSaveRequest,
  AgentRolesUpdateRequest,
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
};

type AgentRefreshSnapshot = {
  readonly config: AgentConfigSnapshot;
  readonly catalog: AgentProviderCatalogSnapshot;
  readonly accounts: AgentAccountsSnapshot;
  readonly loginProviders: AgentLoginProviderCatalogSnapshot;
};

export const useSettingsAiModel = ({
  desktopApi,
  labels,
  onOpenAgentConfigFile,
}: UseSettingsAiModelOptions): SettingsAiModel => {
  const [agentConfig, setAgentConfig] = useState<AgentConfigSnapshot | null>(null);
  const [agentProviderCatalog, setAgentProviderCatalog] =
    useState<AgentProviderCatalogSnapshot | null>(null);
  const [agentAccounts, setAgentAccounts] = useState<AgentAccountsSnapshot | null>(null);
  const [agentLoginProviders, setAgentLoginProviders] =
    useState<AgentLoginProviderCatalogSnapshot | null>(null);
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
      loginProviders,
    ]: [
      AgentConfigSnapshot,
      AgentProviderCatalogSnapshot,
      AgentAccountsSnapshot,
      AgentLoginProviderCatalogSnapshot,
    ] = await Promise.all([
      desktopApi.agent.readAgentConfig(),
      desktopApi.agent.readAgentProviderCatalog(),
      desktopApi.agent.listAccounts(),
      desktopApi.agent.listLoginProviders(),
    ]);

    const snapshot: AgentRefreshSnapshot = {
      config,
      catalog,
      accounts,
      loginProviders,
    };

    setAgentConfig(snapshot.config);
    setAgentProviderCatalog(snapshot.catalog);
    setAgentAccounts(snapshot.accounts);
    setAgentLoginProviders(snapshot.loginProviders);
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
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      await desktopApi.agent.refreshAgentModels({ provider: providerId });
      await refreshAgent();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [desktopApi, refreshAgent]);

  const startAgentAccountLogin = useCallback(async (
    request: AgentAccountLoginStartRequest,
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
    request: AgentAccountLoginCompleteRequest,
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

  const updateAgentRoles = useCallback(async (request: AgentRolesUpdateRequest) => {
    if (desktopApi?.agent === undefined) return;
    setIsSaving(true);
    try {
      setAgentConfig(await desktopApi.agent.updateAgentRoles(request));
      await refreshAgent();
      setErrorMessage(null);
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
    onOpenAgentConfigFile,
  ]);

  const profiles = useMemo(
    () => agentProviderCatalog?.profiles ?? [],
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
    agentLoginProviders,
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
    startAgentAccountLogin,
    completeAgentAccountLogin,
    updateAgentRoles,
    switchAgentAccount,
    removeAgentAccount,
  };
};
