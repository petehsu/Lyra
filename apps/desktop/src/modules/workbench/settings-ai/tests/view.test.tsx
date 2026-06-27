import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SettingsAiModelsView, SettingsAiView } from "../view";
import type { GlobalDialogOpenRequest } from "../../global-dialog";
import type {
  SettingsAiLabels,
  SettingsAiModel,
} from "../types";

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

const mimoRoute = (
  id: string,
  label: string,
  description: string,
  defaultBaseUrl: string,
  protocol: "openai" | "anthropic"
) => ({
  id,
  providerId: "mimo",
  protocolId: protocol === "openai" ? "openai_chat_completions" : "anthropic_messages",
  protocolFamily: protocol === "openai" ? "openai-compatible" : "anthropic_messages",
  label,
  description,
  defaultBaseUrl,
  apiMethod: protocol === "openai" ? "chatCompletions" : "messages",
  authKind: protocol === "openai" ? "bearer_or_header" : "api-key",
  runtimeSupported: true,
  modelDiscoverySupported: true,
  customHeadersSupported: true,
  localBackend: null,
  catalogSection: "hosted",
  quickSetupSupported: id === "mimo" || id === "mimo_anthropic",
} as const);

const mimoRoutes = [
  mimoRoute("mimo", "MiMo OpenAI", "MiMo pay-as-you-go OpenAI-compatible endpoint.", "https://api.xiaomimimo.com/v1", "openai"),
  mimoRoute("mimo_anthropic", "MiMo Anthropic", "MiMo pay-as-you-go Anthropic-compatible endpoint.", "https://api.xiaomimimo.com/anthropic/v1", "anthropic"),
  mimoRoute("mimo_token_plan_cn", "MiMo Token Plan (CN, OpenAI)", "MiMo Token Plan China OpenAI-compatible endpoint.", "https://token-plan-cn.xiaomimimo.com/v1", "openai"),
  mimoRoute("mimo_anthropic_token_plan_cn", "MiMo Token Plan (CN, Anthropic)", "MiMo Token Plan China Anthropic-compatible endpoint.", "https://token-plan-cn.xiaomimimo.com/anthropic/v1", "anthropic"),
  mimoRoute("mimo_token_plan_sgp", "MiMo Token Plan (SGP, OpenAI)", "MiMo Token Plan Singapore OpenAI-compatible endpoint.", "https://token-plan-sgp.xiaomimimo.com/v1", "openai"),
  mimoRoute("mimo_anthropic_token_plan_sgp", "MiMo Token Plan (SGP, Anthropic)", "MiMo Token Plan Singapore Anthropic-compatible endpoint.", "https://token-plan-sgp.xiaomimimo.com/anthropic/v1", "anthropic"),
  mimoRoute("mimo_token_plan_ams", "MiMo Token Plan (AMS, OpenAI)", "MiMo Token Plan Europe OpenAI-compatible endpoint.", "https://token-plan-ams.xiaomimimo.com/v1", "openai"),
  mimoRoute("mimo_anthropic_token_plan_ams", "MiMo Token Plan (AMS, Anthropic)", "MiMo Token Plan Europe Anthropic-compatible endpoint.", "https://token-plan-ams.xiaomimimo.com/anthropic/v1", "anthropic"),
] as const;

const createModel = (overrides: Partial<SettingsAiModel> = {}): SettingsAiModel => ({
  isSaving: false,
  errorMessage: null,
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
  ],
  quickSetupRoutes: [
    ...mimoRoutes,
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
  ],
  localRoutes: [
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
  ],
  defaultProfileId: "mimo_token_plan",
  agentConfig: {
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
          authHeader: "api-key",
          defaultModel: "mimo-v2.5-pro",
          models: [{ id: "mimo-v2.5-pro" }],
        },
        "openai-compatible": {
          label: "Custom OpenAI-Compatible",
          routeId: "custom_openai_compatible",
          protocolId: "openai_chat_completions",
          protocolFamily: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "gpt-5",
          models: [{ id: "gpt-5" }],
        },
      },
      promptDelivery: {
        mode: "full",
        leanExperimental: false,
        openaiResponsesStatefulPromptContract: false,
      },
    },
    commands: [
      {
        name: "/account",
        help: "Manage accounts",
        autocomplete: true,
        remoteOnly: false,
      },
      {
        name: "/model",
        help: "Switch model",
        autocomplete: true,
        remoteOnly: false,
      },
    ],
  },
  agentAccounts: {
    defaultProvider: "mimo_token_plan",
    defaultModel: "mimo-v2.5-pro",
    authStatus: {},
    accounts: [],
  },
  agentLoginProviders: {
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
  },
  agentProviderCatalog: {
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
      ...mimoRoutes,
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
    ],
    profiles: [],
  },
  agentModelCatalog: {
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
      {
        id: "openai-compatible:gpt-5",
        label: "gpt-5",
        model: "gpt-5",
        provider: "custom_openai_compatible",
        providerId: "custom_openai_compatible",
        providerKey: "openai-compatible",
        providerLabel: "Custom OpenAI-Compatible",
        apiMethod: "chatCompletions",
        detail: "Manual endpoint",
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
  },
  setDefaultProfile: vi.fn(),
  refreshAgent: vi.fn(),
  openAgentConfigFile: vi.fn(),
  updateAgentConfig: vi.fn(),
  saveAgentProviderProfile: vi.fn(),
  refreshAgentModels: vi.fn(),
  refreshAgentModelCatalog: vi.fn(),
  setAgentModelEnabled: vi.fn(),
  deleteAgentModel: vi.fn(),
  switchAgentModel: vi.fn(),
  startAgentAccountLogin: vi.fn(),
  completeAgentAccountLogin: vi.fn(),
  switchAgentAccount: vi.fn(),
  removeAgentAccount: vi.fn(),
  ...overrides,
});

describe("SettingsAiView", () => {
  test("renders agent configuration without provider/model setup blocks", () => {
    const model = createModel();

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.queryByRole("heading", { name: "Profiles" })).not.toBeInTheDocument();
    expect(screen.queryByText("/Users/petehsu/.lyra/modules/agent/state.json")).not.toBeInTheDocument();
    expect(screen.queryByText("/Users/petehsu/.lyra/modules/agent")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Config" })).not.toBeInTheDocument();
    expect(screen.getByText("Provider Login")).toBeInTheDocument();
    expect(screen.queryByText("Add API Key Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Local Models")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("LM Studio")).not.toBeInTheDocument();
  });

  test("renders models as a separate settings page and toggles model enablement", () => {
    const setAgentModelEnabled = vi.fn();
    const refreshAgentModelCatalog = vi.fn();
    const model = createModel({
      setAgentModelEnabled,
      refreshAgentModelCatalog,
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    expect(screen.getByLabelText("Models")).toHaveValue("");
    expect(screen.getByText("mimo-v2.5-pro")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("Current model")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Models"), {
      target: { value: "gpt" },
    });

    expect(screen.queryByText("mimo-v2.5-pro")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "gpt-5" }));

    expect(setAgentModelEnabled).toHaveBeenCalledWith({
      model: "gpt-5",
      provider: "openai-compatible",
      enabled: false,
    });

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(refreshAgentModelCatalog).toHaveBeenCalledTimes(1);
  });

  test("confirms before deleting a configured model", () => {
    const deleteAgentModel = vi.fn();
    const openDialog = vi.fn((request: GlobalDialogOpenRequest) => {
      void request;
    });
    const model = createModel({ deleteAgentModel });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={openDialog} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete model: gpt-5" }));

    expect(deleteAgentModel).not.toHaveBeenCalled();
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: "Delete model?",
      description: "Remove gpt-5 from this provider.",
    }));

    const request = openDialog.mock.calls[0]?.[0];
    const deleteAction = request?.actions?.find((action) => action.id === "delete");
    expect(deleteAction).toMatchObject({
      label: "Delete model",
      tone: "danger",
    });

    deleteAction?.onSelect?.({});

    expect(deleteAgentModel).toHaveBeenCalledWith({
      provider: "openai-compatible",
      model: "gpt-5",
    });
  });

  test("adds a preset provider from the Models page without exposing base URL", async () => {
    const discoveredCatalog = {
      ...createModel().agentModelCatalog!,
      models: [
        ...createModel().agentModelCatalog!.models,
        {
          id: "openai:gpt-5.1",
          label: "gpt-5.1",
          model: "gpt-5.1",
          provider: "openai",
          providerId: "openai",
          providerKey: "openai",
          providerLabel: "OpenAI",
          apiMethod: "chatCompletions",
          detail: "OpenAI",
          contextWindow: null,
          supportsImageInput: true,
          supportsToolCalling: true,
          available: true,
          enabled: true,
        },
      ],
    };
    const saveAgentProviderProfile = vi.fn(async () => undefined);
    const refreshAgentModels = vi.fn(async () => discoveredCatalog);
    const model = createModel({
      saveAgentProviderProfile,
      refreshAgentModels,
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));

    expect(screen.getByRole("textbox", { name: "Select provider" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Models" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^OpenAI\b/u })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "opena" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^OpenAI\b/u }));
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-openai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Discover Models/ }));

    await waitFor(() => {
      expect(refreshAgentModels).toHaveBeenCalledWith("openai");
    });
    expect(saveAgentProviderProfile).toHaveBeenCalledWith({
      profileName: "openai",
      routeId: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      defaultModel: null,
      auth: "bearer",
      authHeader: null,
      setDefault: false,
    });
    expect(await screen.findByText("gpt-5.1")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "gpt-5.1" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Disable All" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save profile/ }));

    await waitFor(() => {
      expect(saveAgentProviderProfile).toHaveBeenCalledWith(expect.objectContaining({
        profileName: "openai",
        routeId: "openai",
        models: [
          {
            id: "gpt-5.1",
            enabled: true,
          },
        ],
      }));
    });
  });

  test("searches providers with Chinese aliases and cancels from the Add Model button", () => {
    const model = createModel();

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));
    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "自定义搜索" },
    });

    expect(screen.getByRole("button", { name: /Custom OpenAI-Compatible/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Select provider")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Model/ })).toBeInTheDocument();
  });

  test("shows every MiMo protocol and region when searching Xiaomi", () => {
    const model = createModel();

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));
    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "xiaomi" },
    });

    expect(screen.getByRole("button", { name: /^MiMo OpenAI\b/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^MiMo Anthropic\b/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MiMo Token Plan \(CN, OpenAI\)/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MiMo Token Plan \(CN, Anthropic\)/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MiMo Token Plan \(SGP, OpenAI\)/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MiMo Token Plan \(SGP, Anthropic\)/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MiMo Token Plan \(AMS, OpenAI\)/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MiMo Token Plan \(AMS, Anthropic\)/u })).toBeInTheDocument();
  });

  test("shows custom provider connection fields and saves discovered model enablement", async () => {
    const discoveredCatalog = {
      ...createModel().agentModelCatalog!,
      models: [
        {
          id: "openai-compatible:mimo-v2.5-pro",
          label: "mimo-v2.5-pro",
          model: "mimo-v2.5-pro",
          provider: "custom_openai_compatible",
          providerId: "custom_openai_compatible",
          providerKey: "openai-compatible",
          providerLabel: "Custom OpenAI-Compatible",
          apiMethod: "chatCompletions",
          detail: "Manual endpoint",
          contextWindow: null,
          supportsImageInput: true,
          supportsToolCalling: true,
          available: true,
          enabled: true,
        },
        {
          id: "openai-compatible:mimo-v2.5-vision",
          label: "mimo-v2.5-vision",
          model: "mimo-v2.5-vision",
          provider: "custom_openai_compatible",
          providerId: "custom_openai_compatible",
          providerKey: "openai-compatible",
          providerLabel: "Custom OpenAI-Compatible",
          apiMethod: "chatCompletions",
          detail: "Manual endpoint",
          contextWindow: null,
          supportsImageInput: true,
          supportsToolCalling: true,
          available: true,
          enabled: true,
        },
      ],
    };
    const saveAgentProviderProfile = vi.fn(async () => undefined);
    const refreshAgentModels = vi.fn(async () => discoveredCatalog);
    const model = createModel({
      saveAgentProviderProfile,
      refreshAgentModels,
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));
    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Custom OpenAI-Compatible/ }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.xiaomimimo.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-secret-value" },
    });
    expect(screen.queryByLabelText("Auth Header")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model IDs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Image input")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Discover Models/ }));

    expect(await screen.findByText("mimo-v2.5-pro")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "mimo-v2.5-vision" })).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "mimo-v2.5-vision" }));
    fireEvent.click(screen.getByRole("button", { name: /Save profile/ }));

    await waitFor(() => {
      expect(saveAgentProviderProfile).toHaveBeenCalledWith(expect.objectContaining({
        profileName: "openai-compatible",
        routeId: "custom_openai_compatible",
        baseUrl: "https://api.xiaomimimo.com/v1",
        apiKey: "sk-secret-value",
        defaultModel: "mimo-v2.5-pro",
        auth: "bearer",
        authHeader: null,
        setDefault: false,
        models: [
          {
            id: "mimo-v2.5-pro",
            enabled: true,
          },
          {
            id: "mimo-v2.5-vision",
            enabled: false,
          },
        ],
      }));
    });
    expect(refreshAgentModels).toHaveBeenCalledWith("openai-compatible");
  });

  test("adds a custom model beside discovery and saves it as enabled", async () => {
    const saveAgentProviderProfile = vi.fn(async () => undefined);
    const model = createModel({
      saveAgentProviderProfile,
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));
    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Custom OpenAI-Compatible/ }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.pioneer.ai" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-secret-value" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Custom Model" }));
    fireEvent.change(screen.getByLabelText("Custom Model"), {
      target: { value: "claude-sonnet-4-6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "claude-sonnet-4-6" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /Save profile/ }));

    await waitFor(() => {
      expect(saveAgentProviderProfile).toHaveBeenCalledWith(expect.objectContaining({
        profileName: "openai-compatible",
        routeId: "custom_openai_compatible",
        baseUrl: "https://api.pioneer.ai",
        apiKey: "sk-secret-value",
        defaultModel: "claude-sonnet-4-6",
        models: [
          {
            id: "claude-sonnet-4-6",
            enabled: true,
          },
        ],
      }));
    });
  });

  test("shows a disable-all action only after discovering more than three models", async () => {
    const discoveredCatalog = {
      ...createModel().agentModelCatalog!,
      models: Array.from({ length: 4 }, (_, index) => ({
        id: `openai:gpt-test-${index + 1}`,
        label: `gpt-test-${index + 1}`,
        model: `gpt-test-${index + 1}`,
        provider: "openai",
        providerId: "openai",
        providerKey: "openai",
        providerLabel: "OpenAI",
        apiMethod: "chatCompletions",
        detail: "OpenAI",
        contextWindow: null,
        supportsImageInput: true,
        supportsToolCalling: true,
        available: true,
        enabled: true,
      })),
    };
    const refreshAgentModels = vi.fn(async () => discoveredCatalog);
    const model = createModel({
      refreshAgentModels,
      saveAgentProviderProfile: vi.fn(async () => undefined),
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));
    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "openai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^OpenAI\b/u }));
    fireEvent.click(screen.getByRole("button", { name: /Discover Models/ }));

    expect(await screen.findByText("gpt-test-4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disable All" }));

    expect(screen.getByRole("switch", { name: "gpt-test-1" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "gpt-test-4" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Enable All" })).toBeInTheDocument();
  });

  test("does not render stored provider secrets as visible text", () => {
    const model = createModel();

    const { container } = render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("sk-secret-value");
    expect(container).not.toHaveTextContent("tp-secret-value");
  });

  test("models page starts in provider search mode and stays quiet when no models are configured", () => {
    const model = createModel({
      profiles: [],
      agentModelCatalog: {
        sessionId: null,
        currentModel: "gpt-5-mini",
        currentProvider: "openai",
        defaultModel: "gpt-5-mini",
        defaultProvider: "openai",
        models: [],
        routes: [],
        reasoningEffort: { current: null, options: [], supported: true },
        verbosity: { current: null, options: [], supported: true },
        serviceTier: { current: null, options: [], supported: true },
      },
      defaultProfileId: "openai",
      agentConfig: {
        agentHome: "/Users/petehsu/.lyra/modules/agent",
        configPath: "/Users/petehsu/.lyra/modules/agent/state.json",
        config: {
          provider: {
            defaultProvider: "openai",
            defaultModel: "gpt-5-mini",
          },
          providers: {},
          roles: {},
          promptDelivery: {
            mode: "full",
            leanExperimental: false,
            openaiResponsesStatefulPromptContract: false,
          },
        },
        commands: [],
      },
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    expect(screen.getByLabelText("Select provider")).toBeInTheDocument();
    expect(screen.queryByLabelText("Models")).not.toBeInTheDocument();
    expect(screen.queryByText("No models available")).not.toBeInTheDocument();
    expect(screen.queryByText("Connect a provider first.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "definitely-not-a-provider" },
    });

    expect(screen.queryByText("No AI profile yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Create a profile to use runtime models.")).not.toBeInTheDocument();
  });

  test("add model mode does not render an empty list before provider results exist", () => {
    const model = createModel();

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add Model/ }));

    expect(screen.getByLabelText("Select provider")).toBeInTheDocument();
    expect(screen.queryByText("No AI profile yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Create a profile to use runtime models.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Select provider"), {
      target: { value: "definitely-not-a-provider" },
    });

    expect(screen.queryByText("No AI profile yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Create a profile to use runtime models.")).not.toBeInTheDocument();
  });

  test("models page shows the first nine models before expanding all", () => {
    const model = createModel({
      agentModelCatalog: {
        ...createModel().agentModelCatalog!,
        models: Array.from({ length: 12 }, (_, index) => ({
          id: `openai:model-${index + 1}`,
          label: `model-${index + 1}`,
          model: `model-${index + 1}`,
          provider: "openai",
          providerId: "openai",
          providerKey: "openai",
          providerLabel: "OpenAI",
          apiMethod: "chatCompletions",
          detail: "OpenAI",
          contextWindow: null,
          supportsImageInput: true,
          supportsToolCalling: true,
          available: true,
          enabled: true,
        })),
      },
    });

    render(<SettingsAiModelsView labels={labels} model={model} openDialog={vi.fn()} />);

    expect(screen.getByText("model-1")).toBeInTheDocument();
    expect(screen.getByText("model-9")).toBeInTheDocument();
    expect(screen.queryByText("model-10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View All Models" }));

    expect(screen.getByText("model-10")).toBeInTheDocument();
    expect(screen.getByText("model-12")).toBeInTheDocument();
  });

  test("does not expose the Lyra Agent config file from the settings surface", () => {
    const openAgentConfigFile = vi.fn();
    const model = createModel({ openAgentConfigFile });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.queryByRole("button", { name: "Open Config" })).not.toBeInTheDocument();
    expect(openAgentConfigFile).not.toHaveBeenCalled();
  });

  test("toggles prompt delivery experiments through the Lyra Agent config bridge", () => {
    const updateAgentConfig = vi.fn();
    const model = createModel({ updateAgentConfig });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByLabelText("Lean prompt delivery"));
    fireEvent.click(screen.getByLabelText("OpenAI Responses stateful prompt contract"));

    expect(updateAgentConfig).toHaveBeenCalledWith({
      promptDeliveryMode: "lean-experimental",
    });
    expect(updateAgentConfig).toHaveBeenCalledWith({
      openaiResponsesStatefulPromptContract: true,
    });
  });

  test("starts Google Gmail login with OAuth credentials and access tier", async () => {
    const startAgentAccountLogin = vi.fn(async () => ({
      provider: "google",
      label: "gmail",
      flowId: "flow-google",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      callbackHint: "Paste callback",
      authKind: "OAuth",
      instructions: "Open Google",
      requiresCallback: true,
      requiresApiKey: false,
    }));
    const model = createModel({ startAgentAccountLogin });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.change(screen.getByLabelText("Google OAuth Client ID"), {
      target: { value: "client-id.apps.googleusercontent.com" },
    });
    fireEvent.change(screen.getByLabelText("Google OAuth Client Secret"), {
      target: { value: "client-secret" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Gmail Access" }));
    fireEvent.click(screen.getByRole("option", { name: "Full Gmail access" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start login/ }));
    });

    expect(startAgentAccountLogin).toHaveBeenCalledWith({
      provider: "google",
      googleClientId: "client-id.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      gmailAccessTier: "full",
    });
  });

  test("shows Lyra Agent bridge errors inline", () => {
    const model = createModel({
      errorMessage: "Lyra Agent runtime bridge is unavailable.",
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Lyra Agent runtime bridge is unavailable.");
  });
});
