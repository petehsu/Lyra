import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useSettingsAiModel } from "../service";
import type { SettingsAiLabels } from "../types";

const labels: SettingsAiLabels = {
  categoryLabel: "AI",
  profilesTitle: "Profiles",
  modelsTitle: "Models",
  modelsSearchPlaceholder: "Add or search models",
  modelsEmptyTitle: "No models available",
  modelsEmptyDescription: "Connect a provider first.",
  modelsCurrentLabel: "Current model",
  modelsAddModel: "Add Model",
  modelsViewAll: "View All Models",
  modelsProviderTitle: "Choose a provider to discover models.",
  modelsDiscoverModels: "Discover Models",
  modelsCustomModel: "Custom Model",
  modelsCustomModelPlaceholder: "model-id",
  modelsAddCustomModel: "Add",
  modelsDisableAll: "Disable All",
  modelsEnableAll: "Enable All",
  modelsManualEntryTitle: "Model IDs",
  modelsManualEntryDescription: "Advanced manual model entry is only needed when discovery is unavailable.",
  modelsDiscoverEmptyDescription: "No models were discovered. Check the provider credentials, then try again.",
  modelsDeleteLabel: "Delete model",
  modelsDeleteConfirmTitle: "Delete model?",
  modelsDeleteConfirmDescription: "Remove {model} from this provider.",
  modelsDeleteConfirmAction: "Delete model",
  providerTitle: "Provider",
  connectionTitle: "Connection",
  additionalFieldsTitle: "Additional fields",
  addProfile: "Add profile",
  editProfile: "Edit profile",
  saveProfile: "Save profile",
  deleteProfile: "Delete profile",
  cancel: "Cancel",
  profileNameLabel: "Profile name",
  profileNamePlaceholder: "Team OpenAI",
  urlLabel: "Base URL",
  urlPlaceholder: "https://api.example.com/v1",
  keyLabel: "API key",
  keyPlaceholder: "Paste API key",
  modelLabel: "Model",
  mainModelLabel: "Main model",
  modelModeAllLabel: "All",
  modelModeCustomLabel: "Custom",
  modelPlaceholder: "gpt-5",
  modelsHelp: "Main model first, extra models below.",
  headersLabel: "Headers",
  headersPlaceholder: "X-Header: value",
  emptyTitle: "No AI profile yet",
  emptyDescription: "Create a profile to use runtime models.",
  recommendedSection: "Recommended",
  allSection: "Local",
  customSection: "Custom",
  secretConfigured: "Key configured",
  secretMissing: "Key missing",
  noDiscoveredModels: "No models found",
  advancedSettingsLabel: "Advanced settings",
  selectProviderLabel: "Select provider",
  deleteProfileConfirmTitle: "Delete profile",
  deleteProfileConfirmDescription: "Delete this profile?",
  configFileTitle: "Lyra Agent config file",
  configFileDescription: "Open the real Lyra Agent config.",
  openConfigFile: "Open Config",
  refreshAgent: "Refresh",
  agentConfigAriaLabel: "Lyra Agent config",
  providerAutoFallback: "auto",
  defaultModelFallback: "Lyra Agent default model",
  customProviderFallback: "custom provider",
  accountsTitle: "Lyra Agent Accounts",
  accountsAriaLabel: "Lyra Agent accounts",
  noDefaultProvider: "No default provider",
  noDefaultModel: "No default model",
  accountsEmptyTitle: "No Lyra Agent accounts configured",
  accountsEmptyDescription: "Use the provider profile editor below to add an API key.",
  accountConfigured: "configured",
  accountNotConfigured: "not configured",
  accountDefault: "default",
  loginProvidersTitle: "Provider Login",
  loginProvidersDescription: "Sign in with provider accounts.",
  startLogin: "Start login",
  completeLogin: "Complete login",
  callbackInputLabel: "Callback URL or code",
  callbackInputPlaceholder: "Paste callback",
  loginCallbackDescription: "Paste the callback from the browser.",
  gmailLoginTitle: "Google/Gmail Tool Access",
  gmailLoginDescription: "Configure Gmail tool access.",
  gmailClientIdLabel: "Google OAuth Client ID",
  gmailClientSecretLabel: "Google OAuth Client Secret",
  gmailAccessTierLabel: "Gmail Access",
  gmailAccessReadOnly: "Read and draft",
  gmailAccessFull: "Full Gmail access",
  apiKeyProviderTitle: "Add API Key Provider",
  apiKeyProviderDescription: "Save an API key provider.",
  localProviderTitle: "Local Models",
  localProviderDescription: "Connect to local model servers.",
  saveAndDiscoverModels: "Save & Discover Models",
  localModelsLabel: "Model IDs",
  localModelsPlaceholder: "llama3.2:latest",
  localCapabilitiesTitle: "Default model capabilities",
  localSupportsImageInput: "Image input",
  localSupportsToolCalling: "Tool calling",
  localSupportsStreaming: "Streaming",
  removeAccount: "Remove account",
  providerProfileTitle: "Lyra Agent Provider Profile",
  authHeaderLabel: "Auth Header",
  promptExperimentsTitle: "Prompt delivery",
  promptExperimentsDescription: "Experimental prompt token controls.",
  leanPromptDeliveryLabel: "Lean prompt delivery",
  statefulPromptContractLabel: "OpenAI Responses stateful prompt contract",
  runtimeUnavailable: "Lyra Agent runtime bridge is unavailable.",
  fileEditorUnavailable: "Workbench file editor is unavailable.",
  configPathUnavailable: "Lyra Agent config path is unavailable.",
  sectionAgent: "Lyra Agent",
  sectionSessions: "Sessions",
  memoryConfigTitle: "Memory",
  memoryConfigDescription: "Memory configuration",
  memoryConfigPlaceholder: "{}",
  memoryConfigLoad: "Load memory",
  memoryConfigSave: "Save memory",
  memoryConfigStatusIdle: "Idle",
  memoryConfigStatusLoaded: "Loaded",
  memoryConfigStatusSaved: "Saved",
  memoryConfigStatusInvalidJson: "Invalid JSON",
};

const agentConfigSnapshot = {
  agentHome: "/Users/petehsu/.lyra/modules/agent",
  configPath: "/Users/petehsu/.lyra/modules/agent/state.json",
  config: {
    provider: {
      defaultProvider: "mimo_token_plan",
      defaultModel: "mimo-v2.5-pro",
    },
    providers: {
      mimo_token_plan: {
        label: "MiMo Token Plan",
        routeId: "mimo_token_plan",
        protocolId: "openai_chat_completions",
        protocolFamily: "openai-compatible",
        baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
        defaultModel: "mimo-v2.5-pro",
        requiresApiKey: false,
        models: [{ id: "mimo-v2.5-pro" }],
      },
      "openai-compatible": {
        label: "Custom OpenAI-Compatible",
        routeId: "custom_openai_compatible",
        protocolId: "openai_chat_completions",
        protocolFamily: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        defaultModel: "gpt-5",
        requiresApiKey: false,
        models: [{ id: "gpt-5" }],
      },
    },
  },
  commands: [
    {
      name: "/account",
      help: "Manage accounts",
      autocomplete: true,
      remoteOnly: false,
    },
  ],
};

const agentProviderCatalog = {
  schemaVersion: "2026-06-14",
  defaultProvider: "mimo_token_plan",
  defaultModel: "mimo-v2.5-pro",
  protocols: [
    {
      id: "openai_chat_completions",
      family: "openai-compatible",
      label: "OpenAI Chat Completions",
      transport: "http",
      runtimeSupported: true,
      streamingSupported: true,
      toolCallingSupported: true,
    },
  ],
  routes: [
    {
      id: "openai",
      providerId: "openai",
      protocolId: "openai_chat_completions",
      protocolFamily: "openai-compatible",
      label: "OpenAI",
      description: "OpenAI hosted route.",
      defaultBaseUrl: "https://api.openai.com/v1",
      apiMethod: "chatCompletions",
      authKind: "bearer",
      runtimeSupported: true,
      modelDiscoverySupported: true,
      customHeadersSupported: false,
      localBackend: null,
      catalogSection: "hosted",
      quickSetupSupported: true,
    },
    {
      id: "custom_openai_compatible",
      providerId: "custom_openai_compatible",
      protocolId: "openai_chat_completions",
      protocolFamily: "openai-compatible",
      label: "Custom OpenAI-Compatible",
      description: "Manual OpenAI-compatible endpoint.",
      defaultBaseUrl: null,
      apiMethod: "chatCompletions",
      authKind: "bearer_or_header",
      runtimeSupported: true,
      modelDiscoverySupported: false,
      customHeadersSupported: true,
      localBackend: null,
      catalogSection: "custom",
      quickSetupSupported: true,
    },
    {
      id: "lmstudio",
      providerId: "lmstudio",
      protocolId: "openai_chat_completions",
      protocolFamily: "openai-compatible",
      label: "LM Studio",
      description: "Local LM Studio route.",
      defaultBaseUrl: "http://127.0.0.1:1234/v1",
      apiMethod: "chatCompletions",
      authKind: "none_or_header",
      runtimeSupported: true,
      modelDiscoverySupported: true,
      customHeadersSupported: true,
      localBackend: "lmstudio",
      catalogSection: "local",
      quickSetupSupported: false,
    },
    {
      id: "future_provider",
      providerId: "future_provider",
      protocolId: "openai_chat_completions",
      protocolFamily: "openai-compatible",
      label: "Future Provider",
      description: "Not runtime supported.",
      defaultBaseUrl: "https://future.example/v1",
      apiMethod: "chatCompletions",
      authKind: "bearer",
      runtimeSupported: false,
      modelDiscoverySupported: false,
      customHeadersSupported: false,
      localBackend: null,
      catalogSection: "hosted",
      quickSetupSupported: true,
    },
  ],
  profiles: [
    {
      id: "mimo_token_plan",
      label: "MiMo Token Plan",
      routeId: "mimo_token_plan",
      protocolId: "openai_chat_completions",
      protocolFamily: "openai-compatible",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      defaultModel: "mimo-v2.5-pro",
      configured: true,
      authHeader: "api-key",
      modelCount: 1,
      capabilities: {
        supportsImageInput: true,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    },
    {
      id: "openai-compatible",
      label: "Custom OpenAI-Compatible",
      routeId: "custom_openai_compatible",
      protocolId: "openai_chat_completions",
      protocolFamily: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      defaultModel: "gpt-5",
      configured: true,
      authHeader: null,
      modelCount: 1,
      capabilities: {
        supportsImageInput: true,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    },
    {
      id: "anthropic",
      label: "Anthropic",
      routeId: "anthropic",
      protocolId: "anthropic_messages",
      protocolFamily: "anthropic",
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-sonnet-4-6",
      configured: false,
      authHeader: null,
      modelCount: 1,
      capabilities: {
        supportsImageInput: true,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    },
  ],
};

const agentAccounts = {
  defaultProvider: "mimo_token_plan",
  defaultModel: "mimo-v2.5-pro",
  authStatus: {},
  accounts: [],
};

const agentLoginProviders = {
  authStatus: {},
  providers: [
    {
      id: "claude",
      displayName: "Anthropic/Claude",
      authKind: "OAuth",
      statusMethod: "OAuth",
      detail: "Claude login",
      recommended: true,
      configured: false,
      state: "notConfigured",
      requiresCallback: true,
      requiresApiKey: false,
    },
    {
      id: "google",
      displayName: "Google/Gmail",
      authKind: "OAuth",
      statusMethod: "OAuth",
      detail: "Gmail tool access",
      recommended: false,
      configured: false,
      state: "notConfigured",
      requiresCallback: true,
      requiresApiKey: false,
    },
  ],
};

const agentModelCatalog = {
  sessionId: null,
  currentModel: "mimo-v2.5-pro",
  currentProvider: "mimo_token_plan",
  defaultModel: "mimo-v2.5-pro",
  defaultProvider: "mimo_token_plan",
  models: [
    {
      id: "mimo_token_plan:mimo-v2.5-pro",
      label: "mimo-v2.5-pro",
      model: "mimo-v2.5-pro",
      provider: "mimo_token_plan",
      providerId: "mimo_token_plan",
      providerKey: "mimo_token_plan",
      providerLabel: "MiMo Token Plan",
      apiMethod: "chatCompletions",
      detail: "OpenAI-compatible",
      contextWindow: null,
      supportsImageInput: true,
      supportsToolCalling: true,
      available: true,
      enabled: true,
    },
  ],
  routes: [],
  reasoningEffort: { current: null, options: [], supported: true },
  verbosity: { current: null, options: [], supported: true },
  serviceTier: { current: null, options: [], supported: true },
};

const createDesktopApi = () => {
  const readAgentConfig = vi.fn(async () => agentConfigSnapshot);
  const readAgentProviderCatalog = vi.fn(async () => agentProviderCatalog);
  const listAccounts = vi.fn(async () => agentAccounts);
  const listLoginProviders = vi.fn(async () => agentLoginProviders);
  const listAgentModels = vi.fn(async () => agentModelCatalog);
  const switchAgentModel = vi.fn(async () => agentModelCatalog);
  const setAgentModelEnabled = vi.fn(async () => agentModelCatalog);
  const deleteAgentModel = vi.fn(async () => agentModelCatalog);
  const startAccountLogin = vi.fn(async () => ({
    provider: "claude",
    label: "claude-1",
    flowId: "flow",
    authUrl: "https://example.com/oauth",
    callbackHint: "Paste callback",
    authKind: "OAuth",
    instructions: "Open browser",
    requiresCallback: true,
    requiresApiKey: false,
  }));
  const completeAccountLogin = vi.fn(async () => ({
    accounts: agentAccounts,
    message: "ok",
  }));
  const updateAgentConfig = vi.fn(async () => agentConfigSnapshot);
  const saveAgentProviderProfile = vi.fn(async () => agentConfigSnapshot);
  const refreshAgentModels = vi.fn(async () => agentModelCatalog);
  const openExternal = vi.fn(async () => true);

  return {
    api: {
      openExternal,
      agent: {
        readAgentConfig,
        readAgentProviderCatalog,
        listAccounts,
        listLoginProviders,
        startAccountLogin,
        completeAccountLogin,
        updateAgentConfig,
        saveAgentProviderProfile,
        listAgentModels,
        switchAgentModel,
        setAgentModelEnabled,
        deleteAgentModel,
        refreshAgentModels,
      },
    } as unknown as LyraDesktopApi,
    readAgentConfig,
    readAgentProviderCatalog,
    listAccounts,
    listLoginProviders,
    listAgentModels,
    switchAgentModel,
    setAgentModelEnabled,
    deleteAgentModel,
    startAccountLogin,
    completeAccountLogin,
    openExternal,
    updateAgentConfig,
    saveAgentProviderProfile,
    refreshAgentModels,
  };
};

const createDesktopApiOverrides = (
  overrides: Partial<NonNullable<LyraDesktopApi["agent"]>>
) => {
  const base = createDesktopApi();
  return {
    ...base,
    api: {
      ...base.api,
      agent: {
        ...base.api.agent,
        ...overrides,
      },
    } as LyraDesktopApi,
  };
};

const renderModel = (
  desktopApi: LyraDesktopApi | null,
  onOpenAgentConfigFile?: (filePath: string) => void | Promise<void>,
) =>
  renderHook(() => useSettingsAiModel({
    desktopApi,
    labels,
    onOpenAgentConfigFile,
  }));

describe("useSettingsAiModel", () => {
  test("reports an unavailable bridge instead of creating local profiles", async () => {
    const { result } = renderModel(null);

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Lyra Agent runtime bridge is unavailable.");
    });
    expect(result.current.profiles).toEqual([]);
    expect(result.current.quickSetupRoutes).toEqual([]);
    expect(result.current.agentConfig).toBeNull();
  });

  test("loads Lyra Agent config and Rust-owned provider and model catalogs", async () => {
    const {
      api,
      listAgentModels,
      readAgentConfig,
      readAgentProviderCatalog,
    } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    expect(readAgentConfig).toHaveBeenCalledTimes(1);
    expect(readAgentProviderCatalog).toHaveBeenCalledTimes(1);
    expect(listAgentModels).toHaveBeenCalledTimes(1);
    expect(result.current.defaultProfileId).toBe("mimo_token_plan");
    expect(result.current.agentModelCatalog?.models[0]?.model).toBe("mimo-v2.5-pro");
    expect(result.current.profiles[0]).toMatchObject({
      id: "mimo_token_plan",
      routeId: "mimo_token_plan",
      defaultModel: "mimo-v2.5-pro",
    });
    expect(result.current.profiles.map((profile) => profile.id)).not.toContain("anthropic");
  });

  test("derives quick setup routes from the Rust catalog only", async () => {
    const { api } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.quickSetupRoutes).toHaveLength(2);
    });

    expect(result.current.quickSetupRoutes.map((route) => route.id)).toEqual([
      "openai",
      "custom_openai_compatible",
    ]);
    expect(result.current.localRoutes.map((route) => route.id)).toEqual([
      "lmstudio",
    ]);
  });

  test("refreshes local provider models through the Lyra Agent runtime bridge", async () => {
    const { api, refreshAgentModels } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.localRoutes).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refreshAgentModels?.("lmstudio");
    });

    expect(refreshAgentModels).toHaveBeenCalledWith({ provider: "lmstudio" });
  });

  test("switches the default model through the Lyra Agent runtime bridge", async () => {
    const { api, switchAgentModel } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.agentModelCatalog).not.toBeNull();
    });

    await act(async () => {
      await result.current.switchAgentModel?.({
        model: "gpt-5",
        provider: "openai-compatible",
      });
    });

    expect(switchAgentModel).toHaveBeenCalledWith({
      model: "gpt-5",
      provider: "openai-compatible",
    });
  });

  test("enables and disables models through the Lyra Agent runtime bridge", async () => {
    const { api, setAgentModelEnabled } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.agentModelCatalog).not.toBeNull();
    });

    await act(async () => {
      await result.current.setAgentModelEnabled?.({
        model: "gpt-5",
        provider: "openai-compatible",
        enabled: false,
      });
    });

    expect(setAgentModelEnabled).toHaveBeenCalledWith({
      model: "gpt-5",
      provider: "openai-compatible",
      enabled: false,
    });
  });

  test("deletes models through the Lyra Agent runtime bridge", async () => {
    const { api, deleteAgentModel } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.agentModelCatalog).not.toBeNull();
    });

    await act(async () => {
      await result.current.deleteAgentModel?.({
        model: "gpt-5",
        provider: "openai-compatible",
      });
    });

    expect(deleteAgentModel).toHaveBeenCalledWith({
      model: "gpt-5",
      provider: "openai-compatible",
    });
  });

  test("falls back to provider profile save when the running runtime does not know model delete", async () => {
    const deleteAgentModel = vi.fn(async () => {
      throw new Error("unknown agent runtime method: agent.models.delete");
    });
    const { api, saveAgentProviderProfile } = createDesktopApiOverrides({
      deleteAgentModel,
    });
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.agentConfig).not.toBeNull();
    });

    await act(async () => {
      await result.current.deleteAgentModel?.({
        model: "gpt-5",
        provider: "openai-compatible",
      });
    });

    expect(deleteAgentModel).toHaveBeenCalledWith({
      model: "gpt-5",
      provider: "openai-compatible",
    });
    expect(saveAgentProviderProfile).toHaveBeenCalledWith({
      profileName: "openai-compatible",
      routeId: "custom_openai_compatible",
      baseUrl: "https://api.example.com/v1",
      defaultModel: null,
      authHeader: null,
      models: [],
    });
    expect(result.current.errorMessage).toBeNull();
  });

  test("saves provider profiles through the Lyra Agent runtime bridge", async () => {
    const { api, saveAgentProviderProfile } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.agentProviderCatalog).not.toBeNull();
    });

    await act(async () => {
      await result.current.saveAgentProviderProfile?.({
        profileName: "xiaomi-mimo-api",
        routeId: "mimo_token_plan",
        baseUrl: "https://api.xiaomimimo.com/v1",
        apiKey: "sk-secret",
        defaultModel: "mimo-v2.5-pro",
        auth: "header",
        authHeader: "api-key",
        setDefault: true,
        models: [{ id: "mimo-v2.5-pro" }],
      });
    });

    expect(saveAgentProviderProfile).toHaveBeenCalledWith({
      profileName: "xiaomi-mimo-api",
      routeId: "mimo_token_plan",
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-secret",
      defaultModel: "mimo-v2.5-pro",
      auth: "header",
      authHeader: "api-key",
      setDefault: true,
      models: [{ id: "mimo-v2.5-pro" }],
    });
  });

  test("starts and completes OAuth account login through the Lyra Agent runtime bridge", async () => {
    const { api, startAccountLogin, completeAccountLogin, openExternal } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.agentLoginProviders?.providers).toHaveLength(2);
    });

    await act(async () => {
      await result.current.startAgentAccountLogin?.({ provider: "claude" });
    });

    expect(startAccountLogin).toHaveBeenCalledWith({ provider: "claude" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");

    await act(async () => {
      await result.current.completeAgentAccountLogin?.({
        provider: "claude",
        flowId: "flow",
        callbackInput: "https://callback.example/?code=abc",
        setDefault: true,
      });
    });

    expect(completeAccountLogin).toHaveBeenCalledWith({
      provider: "claude",
      flowId: "flow",
      callbackInput: "https://callback.example/?code=abc",
      setDefault: true,
    });
  });

  test("sets the Lyra Agent default provider through config update", async () => {
    const { api, updateAgentConfig } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    await act(async () => {
      await result.current.setDefaultProfile("openai-compatible");
    });

    expect(updateAgentConfig).toHaveBeenCalledWith({
      defaultProvider: "openai-compatible",
      defaultModel: "gpt-5",
    });
  });

  test("opens the persisted Lyra Agent config file through the workspace file editor", async () => {
    const { api } = createDesktopApi();
    const onOpenAgentConfigFile = vi.fn();
    const { result } = renderModel(api, onOpenAgentConfigFile);

    await waitFor(() => {
      expect(result.current.agentConfig).not.toBeNull();
    });

    await act(async () => {
      await result.current.openAgentConfigFile?.();
    });

    expect(onOpenAgentConfigFile).toHaveBeenCalledWith("/Users/petehsu/.lyra/modules/agent/state.json");
  });
});
