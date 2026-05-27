import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useSettingsAiModel } from "../service";
import type { SettingsAiLabels } from "../types";

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
  refreshJcode: "Refresh",
  jcodeConfigAriaLabel: "Lyra Agent config",
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
  sectionJcode: "Lyra Agent",
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

const jcodeConfigSnapshot = {
  jcodeHome: "/Users/petehsu/.lyra/modules/agent",
  configPath: "/Users/petehsu/.lyra/modules/agent/config.toml",
  config: {
    provider: {
      default_provider: "mimo-token-plan",
      default_model: "mimo-v2.5-pro",
    },
    providers: {
      "mimo-token-plan": {
        base_url: "https://token-plan-cn.xiaomimimo.com/v1",
        default_model: "mimo-v2.5-pro",
        models: [
          { id: "mimo-v2.5-pro" },
          { id: "mimo-v2.5-pro-plus" },
        ],
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
  ],
};

const jcodeSessions = {
  sessionsDir: "/Users/petehsu/.lyra/modules/agent/sessions",
  sessions: [
    {
      id: "session-1",
      title: "Saved Lyra Agent session",
      customTitle: null,
      shortName: "saved",
      status: "saved",
      providerKey: "mimo-token-plan",
      model: "mimo-v2.5-pro",
      messageCount: 4,
      createdAt: "2026-05-15T00:00:00Z",
      updatedAt: "2026-05-15T00:05:00Z",
      lastActiveAt: "2026-05-15T00:05:00Z",
      saved: true,
      saveLabel: "saved",
      archived: false,
      workingDir: "/Users/petehsu/Documents/Lyra",
    },
  ],
};

const jcodeAccounts = {
  defaultProvider: "mimo-token-plan",
  defaultModel: "mimo-v2.5-pro",
  authStatus: {},
  accounts: [],
};

const jcodeLoginProviders = {
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
      detail: "Custom endpoint",
      recommended: false,
      configured: false,
      state: "notConfigured",
      requiresCallback: false,
      requiresApiKey: true,
    },
  ],
};

const createDesktopApi = () => {
  const readJcodeConfig = vi.fn(async () => jcodeConfigSnapshot);
  const listSessions = vi.fn(async () => jcodeSessions);
  const listAccounts = vi.fn(async () => jcodeAccounts);
  const listLoginProviders = vi.fn(async () => jcodeLoginProviders);
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
    accounts: jcodeAccounts,
    message: "ok",
  }));
  const updateJcodeConfig = vi.fn(async () => jcodeConfigSnapshot);
  const saveJcodeProviderProfile = vi.fn(async () => jcodeConfigSnapshot);
  const updateJcodeAgentRoles = vi.fn(async () => jcodeConfigSnapshot);
  const openExternal = vi.fn(async () => true);

  return {
    api: {
      openExternal,
      agent: {
        readJcodeConfig,
        listSessions,
        listAccounts,
        listLoginProviders,
        startAccountLogin,
        completeAccountLogin,
        updateJcodeConfig,
        saveJcodeProviderProfile,
        updateJcodeAgentRoles,
      },
    } as unknown as LyraDesktopApi,
    readJcodeConfig,
    listSessions,
    listAccounts,
    listLoginProviders,
    startAccountLogin,
    completeAccountLogin,
    openExternal,
    updateJcodeConfig,
    saveJcodeProviderProfile,
    updateJcodeAgentRoles,
  };
};

const renderModel = (
  desktopApi: LyraDesktopApi | null,
  onOpenJcodeConfigFile?: (filePath: string) => void | Promise<void>
) =>
  renderHook(() => useSettingsAiModel({
    desktopApi,
    labels,
    onOpenJcodeConfigFile
  }));

describe("useSettingsAiModel", () => {
  test("reports an unavailable bridge instead of creating local profiles", async () => {
    const { result } = renderModel(null);

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Lyra Agent runtime bridge is unavailable.");
    });
    expect(result.current.profiles).toEqual([]);
    expect(result.current.jcodeConfig).toBeNull();
    expect(result.current.availableModels).toEqual([]);
  });

  test("loads Lyra Agent config, commands, and derived provider rows", async () => {
    const { api, readJcodeConfig, listSessions } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    expect(readJcodeConfig).toHaveBeenCalledTimes(1);
    expect(listSessions).not.toHaveBeenCalled();
    expect(result.current.selectedProfileId).toBe("mimo-token-plan");
    expect(result.current.defaultProfileId).toBe("mimo-token-plan");
    expect(result.current.defaultModelNames).toEqual(["mimo-v2.5-pro"]);
    expect(result.current.profiles[0]).toMatchObject({
      id: "mimo-token-plan",
      name: "mimo-token-plan",
      runtimeProviderId: "mimo-token-plan",
      runtimeSupported: true,
      model: "mimo-v2.5-pro",
      isDefault: true,
    });
    expect(result.current.profiles[0]?.customModels.map((entry) => entry.id)).toEqual([
      "mimo-v2.5-pro-plus",
    ]);
  });

  test("saves provider profiles through the Lyra Agent runtime bridge", async () => {
    const { api, saveJcodeProviderProfile } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.jcodeConfig).not.toBeNull();
    });

    await act(async () => {
      await result.current.saveJcodeProviderProfile?.({
        profileName: "xiaomi-mimo-api",
        baseUrl: "https://api.xiaomimimo.com/v1",
        apiKey: "sk-secret",
        defaultModel: "mimo-v2.5-pro",
        auth: "header",
        authHeader: "api-key",
        setDefault: true,
        models: [{ id: "mimo-v2.5-pro" }],
      });
    });

    expect(saveJcodeProviderProfile).toHaveBeenCalledWith({
      profileName: "xiaomi-mimo-api",
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-secret",
      defaultModel: "mimo-v2.5-pro",
      auth: "header",
      authHeader: "api-key",
      setDefault: true,
      models: [{ id: "mimo-v2.5-pro" }],
    });
  });

  test("starts and completes provider login through the Lyra Agent runtime bridge", async () => {
    const { api, startAccountLogin, completeAccountLogin, openExternal } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.jcodeLoginProviders?.providers).toHaveLength(3);
    });

    await act(async () => {
      await result.current.startJcodeAccountLogin?.({ provider: "claude" });
    });

    expect(startAccountLogin).toHaveBeenCalledWith({ provider: "claude" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");

    await act(async () => {
      await result.current.completeJcodeAccountLogin?.({
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
    const { api, updateJcodeConfig } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    await act(async () => {
      await result.current.setDefaultProfile("openai-compatible");
    });

    expect(updateJcodeConfig).toHaveBeenCalledWith({
      defaultProvider: "openai-compatible",
      defaultModel: "gpt-5",
    });
  });

  test("saves notification config through the Lyra Agent runtime bridge", async () => {
    const { api, updateJcodeConfig } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.jcodeConfig).not.toBeNull();
    });

    await act(async () => {
      await result.current.updateJcodeConfig?.({
        desktopNotifications: false,
        ntfyTopic: "agent-topic",
        emailEnabled: true,
        emailTo: "ops@example.com",
        telegramEnabled: true,
        telegramChatId: "12345",
      });
    });

    expect(updateJcodeConfig).toHaveBeenCalledWith({
      desktopNotifications: false,
      ntfyTopic: "agent-topic",
      emailEnabled: true,
      emailTo: "ops@example.com",
      telegramEnabled: true,
      telegramChatId: "12345",
    });
  });

  test("saves agent role model overrides through the Lyra Agent bridge", async () => {
    const { api, updateJcodeAgentRoles } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.jcodeConfig).not.toBeNull();
    });

    await act(async () => {
      await result.current.updateJcodeAgentRoles?.({
        swarmModel: "gpt-5",
        reviewModel: "gpt-5-mini",
        judgeModel: "gpt-5",
        memoryModel: "mimo-v2.5-pro",
        ambientModel: "mimo-v2.5-pro",
      });
    });

    expect(updateJcodeAgentRoles).toHaveBeenCalledWith({
      swarmModel: "gpt-5",
      reviewModel: "gpt-5-mini",
      judgeModel: "gpt-5",
      memoryModel: "mimo-v2.5-pro",
      ambientModel: "mimo-v2.5-pro",
    });
  });

  test("opens the persisted Lyra Agent config file through the workspace file editor", async () => {
    const { api } = createDesktopApi();
    const onOpenJcodeConfigFile = vi.fn();
    const { result } = renderModel(api, onOpenJcodeConfigFile);

    await waitFor(() => {
      expect(result.current.jcodeConfig).not.toBeNull();
    });

    await act(async () => {
      await result.current.openJcodeConfigFile?.();
    });

    expect(onOpenJcodeConfigFile).toHaveBeenCalledWith("/Users/petehsu/.lyra/modules/agent/config.toml");
  });

  test("keeps draft field edits local until explicit Lyra Agent save", async () => {
    const { api, saveJcodeProviderProfile } = createDesktopApi();
    const { result } = renderModel(api);

    await waitFor(() => {
      expect(result.current.jcodeConfig).not.toBeNull();
    });

    act(() => {
      result.current.updateDraftName("Local edit only");
      result.current.updateDraftField("connection", "baseUrl", "https://local.example/v1");
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("custom-model");
    });

    expect(result.current.draft.name).toBe("Local edit only");
    expect(result.current.draft.connectionConfig).toEqual({
      baseUrl: "https://local.example/v1",
    });
    expect(result.current.modelSelectionMode).toBe("custom");
    expect(result.current.draft.modelsText).toBe("custom-model");
    expect(saveJcodeProviderProfile).not.toHaveBeenCalled();
  });
});
