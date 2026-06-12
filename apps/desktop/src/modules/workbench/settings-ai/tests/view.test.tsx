import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SettingsAiView } from "../view";
import type {
  SettingsAiDraft,
  SettingsAiLabels,
  SettingsAiModel
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
  memoryConfigStatusInvalidJson: "Invalid JSON"
};

const draft: SettingsAiDraft = {
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
  isDefault: true
};

const createModel = (overrides: Partial<SettingsAiModel> = {}): SettingsAiModel => ({
  isSaving: false,
  errorMessage: null,
  profiles: [],
  presetSections: [],
  selectedProfileId: null,
  defaultProfileId: null,
  defaultProviderId: null,
  defaultModelNames: [],
  selectedPresetId: null,
  selectedPreset: null,
  agentConfig: {
    agentHome: "/Users/petehsu/.lyra/modules/agent",
    configPath: "/Users/petehsu/.lyra/modules/agent/config.toml",
    config: {
      provider: {
        default_provider: "mimo-token-plan",
        default_model: "mimo-v2.5-pro",
      },
      features: {
        memory: true,
        swarm: false,
      },
      providers: {
        "mimo-token-plan": {
          base_url: "https://token-plan-cn.xiaomimimo.com/v1",
          auth: "header",
          auth_header: "api-key",
          default_model: "mimo-v2.5-pro",
          models: [{ id: "mimo-v2.5-pro" }],
        },
        "openai-compatible": {
          base_url: "https://api.example.com/v1",
          default_model: "gpt-5",
          models: [{ id: "gpt-5" }],
        },
      },
      agents: {
        swarm_model: "gpt-5",
        memory_model: "mimo-v2.5-pro",
      },
      autoreview: {
        model: "gpt-5-mini",
      },
      autojudge: {
        model: "gpt-5",
      },
      ambient: {
        model: "mimo-v2.5-pro",
      },
      safety: {
        desktop_notifications: true,
        ntfy_topic: "lyra-alerts",
        ntfy_server: "https://ntfy.sh",
        email_enabled: false,
        email_smtp_port: 587,
        email_imap_port: 993,
        telegram_enabled: false,
        discord_enabled: false,
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
      {
        id: "openai-compatible",
        displayName: "OpenAI-compatible",
        authKind: "API key",
        statusMethod: "API key",
        detail: "custom endpoint",
        recommended: false,
        configured: false,
        state: "notConfigured",
        requiresCallback: false,
        requiresApiKey: true,
      },
    ],
  },
  draft,
  modelSelectionMode: draft.modelSelectionMode,
  availableModels: [],
  selectProfile: vi.fn(),
  applyPreset: vi.fn(),
  updateDraftName: vi.fn(),
  updateDraftModelSelectionMode: vi.fn(),
  updateDraftHeadersText: vi.fn(),
  updateDraftModelsText: vi.fn(),
  updateDraftField: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  deleteProviderModels: vi.fn(),
  deleteConfiguredModel: vi.fn(),
  setDefaultProfile: vi.fn(),
  refreshAgent: vi.fn(),
  openAgentConfigFile: vi.fn(),
  updateAgentConfig: vi.fn(),
  saveAgentProviderProfile: vi.fn(),
  startAgentAccountLogin: vi.fn(),
  completeAgentAccountLogin: vi.fn(),
  updateAgentRoles: vi.fn(),
  ...overrides,
});

describe("SettingsAiView", () => {
  test("renders Lyra Agent-owned config and account login without session history", () => {
    const model = createModel();

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("heading", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getAllByText("mimo-token-plan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mimo-v2.5-pro").length).toBeGreaterThan(0);
    expect(screen.queryByText("Swarm Off")).not.toBeInTheDocument();
    expect(screen.queryByText("Swarm On")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory On")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory Off")).not.toBeInTheDocument();
    expect(screen.getByText("/Users/petehsu/.lyra/modules/agent/config.toml")).toBeInTheDocument();
    expect(screen.getByText("/Users/petehsu/.lyra/modules/agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Config" })).toBeInTheDocument();
    expect(screen.queryByText("/resume")).not.toBeInTheDocument();
    expect(screen.queryByText("/account")).not.toBeInTheDocument();
    expect(screen.queryByText("/model")).not.toBeInTheDocument();
    expect(screen.getByText("Provider Login")).toBeInTheDocument();
    expect(screen.getByText("Add API Key Provider")).toBeInTheDocument();
    expect(screen.getByText("Agent Role Models")).toBeInTheDocument();
    expect(screen.queryByText("Fix agent storage")).not.toBeInTheDocument();
    expect(screen.queryByText("No AI profile yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add profile" })).not.toBeInTheDocument();
  });

  test("saves an API key provider through the Lyra Agent login bridge", () => {
    const completeAgentAccountLogin = vi.fn();
    const model = createModel({ completeAgentAccountLogin });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.change(screen.getByLabelText("Profile name"), {
      target: { value: "xiaomi-mimo-api" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.xiaomimimo.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("Main model"), {
      target: { value: "mimo-v2.5-pro" },
    });
    fireEvent.change(screen.getByLabelText("Auth Header"), {
      target: { value: "api-key" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-secret-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save profile/ }));

    expect(completeAgentAccountLogin).toHaveBeenCalledWith({
      provider: "openai-compatible",
      profileName: "xiaomi-mimo-api",
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-secret-value",
      defaultModel: "mimo-v2.5-pro",
      authHeader: "api-key",
      setDefault: true,
    });
  });

  test("does not render stored provider secrets as visible text", () => {
    const model = createModel({
      agentConfig: {
        agentHome: "/Users/petehsu/.lyra/modules/agent",
        configPath: "/Users/petehsu/.lyra/modules/agent/config.toml",
        config: {
          providers: {
            "mimo-token-plan": {
              base_url: "https://token-plan-cn.xiaomimimo.com/v1",
              auth: "header",
              auth_header: "api-key",
              api_key_env: "MIMO_API_KEY",
              default_model: "mimo-v2.5-pro",
            },
          },
        },
        commands: [],
      },
    });

    const { container } = render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(container).not.toHaveTextContent("sk-secret-value");
    expect(container).not.toHaveTextContent("tp-secret-value");
  });

  test("updates the Lyra Agent default provider when a provider card is selected", () => {
    const updateAgentConfig = vi.fn();
    const model = createModel({ updateAgentConfig });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByRole("button", { name: /openai-compatible gpt-5/ }));

    expect(updateAgentConfig).toHaveBeenCalledWith({
      defaultProvider: "openai-compatible",
      defaultModel: "gpt-5",
    });
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

  test("does not render stored notification secrets as visible text", () => {
    const model = createModel({
      agentConfig: {
        agentHome: "/Users/petehsu/.lyra/modules/agent",
        configPath: "/Users/petehsu/.lyra/modules/agent/config.toml",
        config: {
          safety: {
            email_password: "smtp-secret-value",
            telegram_bot_token: "telegram-secret-value",
            discord_bot_token: "discord-secret-value",
          },
        },
        commands: [],
      },
    });

    const { container } = render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByLabelText("SMTP password")).toHaveValue("");
    expect(screen.getByLabelText("Telegram bot token")).toHaveValue("");
    expect(screen.getByLabelText("Discord bot token")).toHaveValue("");
    expect(container).not.toHaveTextContent("smtp-secret-value");
    expect(container).not.toHaveTextContent("telegram-secret-value");
    expect(container).not.toHaveTextContent("discord-secret-value");
  });

  test("shows Lyra Agent bridge errors inline", () => {
    const model = createModel({
      errorMessage: "Lyra Agent runtime bridge is unavailable.",
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Lyra Agent runtime bridge is unavailable.");
  });
});
