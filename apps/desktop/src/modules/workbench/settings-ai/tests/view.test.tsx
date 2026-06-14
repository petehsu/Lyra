import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SettingsAiView } from "../view";
import type {
  SettingsAiLabels,
  SettingsAiModel,
} from "../types";

const labels: SettingsAiLabels = {
  categoryLabel: "AI",
  profilesTitle: "Profiles",
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
  roleModelsTitle: "Agent Role Models",
  roleSwarmSubagentLabel: "Swarm / subagent",
  roleReviewLabel: "Review",
  roleJudgeLabel: "Judge",
  roleMemoryLabel: "Memory",
  roleAmbientLabel: "Ambient",
  roleProviderDefaultPlaceholder: "provider default",
  roleMemoryDefaultPlaceholder: "sidecar auto-select",
  saveRoleModels: "Save role models",
  notificationsTitle: "Notifications",
  notificationsDescription: "Configure notifications.",
  desktopNotificationsLabel: "Desktop notifications",
  ntfyTopicLabel: "ntfy topic",
  ntfyServerLabel: "ntfy server",
  emailNotificationsLabel: "Email notifications",
  emailToLabel: "Email recipient",
  emailSmtpHostLabel: "SMTP host",
  emailSmtpPortLabel: "SMTP port",
  emailFromLabel: "Sender email",
  emailPasswordLabel: "SMTP password",
  emailImapHostLabel: "IMAP host",
  emailImapPortLabel: "IMAP port",
  emailReplyLabel: "Email replies control Agent",
  telegramNotificationsLabel: "Telegram notifications",
  telegramBotTokenLabel: "Telegram bot token",
  telegramChatIdLabel: "Telegram chat ID",
  telegramReplyLabel: "Telegram replies control Agent",
  discordNotificationsLabel: "Discord notifications",
  discordBotTokenLabel: "Discord bot token",
  discordChannelIdLabel: "Discord channel ID",
  discordBotUserIdLabel: "Discord bot user ID",
  discordReplyLabel: "Discord replies control Agent",
  saveNotifications: "Save notifications",
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
      roles: {
        swarmModel: "gpt-5",
        memoryModel: "mimo-v2.5-pro",
        reviewModel: "gpt-5-mini",
        judgeModel: "gpt-5",
        ambientModel: "mimo-v2.5-pro",
      },
      notifications: {
        desktopNotifications: true,
        ntfyTopic: "lyra-alerts",
        ntfyServer: "https://ntfy.sh",
        emailEnabled: false,
        emailSmtpPort: 587,
        emailImapPort: 993,
        telegramEnabled: false,
        discordEnabled: false,
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
  setDefaultProfile: vi.fn(),
  refreshAgent: vi.fn(),
  openAgentConfigFile: vi.fn(),
  updateAgentConfig: vi.fn(),
  saveAgentProviderProfile: vi.fn(),
  refreshAgentModels: vi.fn(),
  startAgentAccountLogin: vi.fn(),
  completeAgentAccountLogin: vi.fn(),
  updateAgentRoles: vi.fn(),
  switchAgentAccount: vi.fn(),
  removeAgentAccount: vi.fn(),
  ...overrides,
});

describe("SettingsAiView", () => {
  test("renders Rust-catalog profiles and local routes in the local section", () => {
    const model = createModel();

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("heading", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getAllByText("MiMo Token Plan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mimo-v2.5-pro").length).toBeGreaterThan(0);
    expect(screen.getByText("/Users/petehsu/.lyra/modules/agent/state.json")).toBeInTheDocument();
    expect(screen.getByText("/Users/petehsu/.lyra/modules/agent")).toBeInTheDocument();
    expect(screen.getByText("Provider Login")).toBeInTheDocument();
    expect(screen.getByText("Add API Key Provider")).toBeInTheDocument();
    expect(screen.getByText("Local Models")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getAllByText("Custom OpenAI-Compatible").length).toBeGreaterThan(0);
    expect(screen.getByText("LM Studio")).toBeInTheDocument();
    expect(model.quickSetupRoutes.map((route) => route.id)).not.toContain("lmstudio");
  });

  test("saves an API key provider through the provider profile bridge", () => {
    const saveAgentProviderProfile = vi.fn();
    const completeAgentAccountLogin = vi.fn();
    const model = createModel({
      saveAgentProviderProfile,
      completeAgentAccountLogin,
    });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Custom OpenAI-Compatible Manual OpenAI-compatible endpoint\./i })
    );
    fireEvent.change(screen.getAllByLabelText("Profile name")[1]!, {
      target: { value: "xiaomi-mimo-api" },
    });
    fireEvent.change(screen.getAllByLabelText("Base URL")[1]!, {
      target: { value: "https://api.xiaomimimo.com/v1" },
    });
    fireEvent.change(screen.getAllByLabelText("Main model")[1]!, {
      target: { value: "mimo-v2.5-pro" },
    });
    fireEvent.change(screen.getAllByLabelText("Auth Header")[1]!, {
      target: { value: "api-key" },
    });
    fireEvent.change(screen.getAllByLabelText("API key")[1]!, {
      target: { value: "sk-secret-value" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Save profile/ })[1]!);

    expect(saveAgentProviderProfile).toHaveBeenCalledWith({
      profileName: "xiaomi-mimo-api",
      routeId: "custom_openai_compatible",
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-secret-value",
      defaultModel: "mimo-v2.5-pro",
      auth: "header",
      authHeader: "api-key",
      setDefault: true,
    });
    expect(completeAgentAccountLogin).not.toHaveBeenCalled();
  });

  test("saves and refreshes a local provider profile with model capabilities", async () => {
    const saveAgentProviderProfile = vi.fn(async () => undefined);
    const refreshAgentModels = vi.fn(async () => undefined);
    const model = createModel({
      saveAgentProviderProfile,
      refreshAgentModels,
    });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.change(screen.getAllByLabelText("Profile name")[0]!, {
      target: { value: "local-dev" },
    });
    fireEvent.change(screen.getAllByLabelText("Base URL")[0]!, {
      target: { value: "http://127.0.0.1:1234/v1" },
    });
    fireEvent.change(screen.getAllByLabelText("Main model")[0]!, {
      target: { value: "local-qwen" },
    });
    fireEvent.change(screen.getByLabelText("Model IDs"), {
      target: { value: "local-qwen\nlocal-vision" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save & Discover Models/ }));

    await waitFor(() => {
      expect(refreshAgentModels).toHaveBeenCalledWith("local-dev");
    });
    expect(saveAgentProviderProfile).toHaveBeenCalledWith({
      profileName: "local-dev",
      routeId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null,
      defaultModel: "local-qwen",
      auth: "none",
      authHeader: null,
      setDefault: true,
      models: [
        {
          id: "local-qwen",
          supportsImageInput: true,
          supportsToolCalling: true,
          supportsStreaming: true,
        },
        {
          id: "local-vision",
          supportsImageInput: true,
          supportsToolCalling: true,
          supportsStreaming: true,
        },
      ],
    });
  });

  test("does not render stored provider secrets as visible text", () => {
    const model = createModel();

    const { container } = render(<SettingsAiView labels={labels} model={model} />);

    for (const input of screen.getAllByLabelText("API key")) {
      expect(input).toHaveValue("");
    }
    expect(container).not.toHaveTextContent("sk-secret-value");
    expect(container).not.toHaveTextContent("tp-secret-value");
  });

  test("updates the Lyra Agent default provider when a provider card is selected", () => {
    const setDefaultProfile = vi.fn();
    const model = createModel({ setDefaultProfile });

    render(<SettingsAiView labels={labels} model={model} />);

    const profileButton = screen
      .getAllByRole("button", { name: /openai-compatible/i })
      .find((element) => element.textContent?.includes("gpt-5"));
    expect(profileButton).toBeDefined();
    fireEvent.click(profileButton!);

    expect(setDefaultProfile).toHaveBeenCalledWith("openai-compatible");
  });

  test("opens the Lyra Agent config file from the settings surface", () => {
    const openAgentConfigFile = vi.fn();
    const model = createModel({ openAgentConfigFile });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Config" }));

    expect(openAgentConfigFile).toHaveBeenCalledTimes(1);
  });

  test("saves agent role model overrides", () => {
    const updateAgentRoles = vi.fn();
    const model = createModel({ updateAgentRoles });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.change(screen.getByLabelText("Swarm / subagent"), {
      target: { value: "claude-opus-4-6" },
    });
    fireEvent.change(screen.getByLabelText("Review"), {
      target: { value: "gpt-5-review" },
    });
    fireEvent.change(screen.getByLabelText("Judge"), {
      target: { value: "gpt-5-judge" },
    });
    fireEvent.change(screen.getByLabelText("Memory"), {
      target: { value: "mimo-v2.5-pro" },
    });
    fireEvent.change(screen.getByLabelText("Ambient"), {
      target: { value: "gpt-5-ambient" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save role models/ }));

    expect(updateAgentRoles).toHaveBeenCalledWith({
      swarmModel: "claude-opus-4-6",
      reviewModel: "gpt-5-review",
      judgeModel: "gpt-5-judge",
      memoryModel: "mimo-v2.5-pro",
      ambientModel: "gpt-5-ambient",
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

  test("saves notification config through the Lyra Agent config bridge", () => {
    const updateAgentConfig = vi.fn();
    const model = createModel({ updateAgentConfig });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.change(screen.getByLabelText("ntfy topic"), {
      target: { value: "agent-topic" },
    });
    fireEvent.click(screen.getByLabelText("Email notifications"));
    fireEvent.change(screen.getByLabelText("Email recipient"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SMTP host"), {
      target: { value: "smtp.example.com" },
    });
    fireEvent.change(screen.getByLabelText("SMTP password"), {
      target: { value: "smtp-secret" },
    });
    fireEvent.click(screen.getByLabelText("Telegram notifications"));
    fireEvent.change(screen.getByLabelText("Telegram chat ID"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save notifications/ }));

    expect(updateAgentConfig).toHaveBeenCalledWith(expect.objectContaining({
      ntfyTopic: "agent-topic",
      emailEnabled: true,
      emailTo: "ops@example.com",
      emailSmtpHost: "smtp.example.com",
      emailPassword: "smtp-secret",
      telegramEnabled: true,
      telegramChatId: "12345",
    }));
  });

  test("shows Lyra Agent bridge errors inline", () => {
    const model = createModel({
      errorMessage: "Lyra Agent runtime bridge is unavailable.",
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Lyra Agent runtime bridge is unavailable.");
  });
});
