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
  commandsAriaLabel: "Lyra Agent commands",
  runtimeUnavailable: "Lyra Agent runtime bridge is unavailable.",
  fileEditorUnavailable: "Workbench file editor is unavailable.",
  configPathUnavailable: "Lyra Agent config path is unavailable.",
  sectionJcode: "Lyra Agent",
  sectionSessions: "Sessions",
  sectionCommands: "Commands",
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

const createDesktopApi = () => {
  const readJcodeConfig = vi.fn(async () => jcodeConfigSnapshot);
  const listSessions = vi.fn(async () => jcodeSessions);
  const updateJcodeConfig = vi.fn(async () => jcodeConfigSnapshot);
  const saveJcodeProviderProfile = vi.fn(async () => jcodeConfigSnapshot);
  const updateJcodeAgentRoles = vi.fn(async () => jcodeConfigSnapshot);

  return {
    api: {
      agent: {
        readJcodeConfig,
        listSessions,
        updateJcodeConfig,
        saveJcodeProviderProfile,
        updateJcodeAgentRoles,
      },
    } as unknown as LyraDesktopApi,
    readJcodeConfig,
    listSessions,
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
    expect(result.current.jcodeCommands?.map((command) => command.name)).toEqual([
      "/account",
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
