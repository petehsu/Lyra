import { fireEvent, render, screen } from "@testing-library/react";
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

const draft: SettingsAiDraft = {
  id: null,
  name: "lyra-agent-provider",
  providerId: "jcode",
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
  jcodeConfig: {
    jcodeHome: "/Users/petehsu/.lyra/modules/agent",
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
  jcodeCommands: [
    {
      name: "/account",
      help: "Manage accounts",
      autocomplete: true,
      remoteOnly: false,
    },
  ],
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
  refreshJcode: vi.fn(),
  openJcodeConfigFile: vi.fn(),
  updateJcodeConfig: vi.fn(),
  saveJcodeProviderProfile: vi.fn(),
  updateJcodeAgentRoles: vi.fn(),
  ...overrides,
});

describe("SettingsAiView", () => {
  test("renders Lyra Agent-owned config and commands without session history", () => {
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
    expect(screen.getByText("/account")).toBeInTheDocument();
    expect(screen.queryByText("/model")).not.toBeInTheDocument();
    expect(screen.getByText("Agent Role Models")).toBeInTheDocument();
    expect(screen.queryByText("Fix agent storage")).not.toBeInTheDocument();
    expect(screen.queryByText("No AI profile yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add profile" })).not.toBeInTheDocument();
  });

  test("saves a provider profile through the Lyra Agent bridge", () => {
    const saveJcodeProviderProfile = vi.fn();
    const model = createModel({ saveJcodeProviderProfile });

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

    expect(saveJcodeProviderProfile).toHaveBeenCalledWith({
      profileName: "xiaomi-mimo-api",
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-secret-value",
      defaultModel: "mimo-v2.5-pro",
      auth: "header",
      authHeader: "api-key",
      setDefault: true,
      models: [{ id: "mimo-v2.5-pro" }],
    });
  });

  test("does not render stored provider secrets as visible text", () => {
    const model = createModel({
      jcodeConfig: {
        jcodeHome: "/Users/petehsu/.lyra/modules/agent",
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
      jcodeCommands: [],
    });

    const { container } = render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(container).not.toHaveTextContent("sk-secret-value");
    expect(container).not.toHaveTextContent("tp-secret-value");
  });

  test("updates the Lyra Agent default provider when a provider card is selected", () => {
    const updateJcodeConfig = vi.fn();
    const model = createModel({ updateJcodeConfig });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByRole("button", { name: /openai-compatible gpt-5/ }));

    expect(updateJcodeConfig).toHaveBeenCalledWith({
      defaultProvider: "openai-compatible",
      defaultModel: "gpt-5",
    });
  });

  test("opens the Lyra Agent config file from the settings surface", () => {
    const openJcodeConfigFile = vi.fn();
    const model = createModel({ openJcodeConfigFile });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Config" }));

    expect(openJcodeConfigFile).toHaveBeenCalledTimes(1);
  });

  test("saves agent role model overrides", () => {
    const updateJcodeAgentRoles = vi.fn();
    const model = createModel({ updateJcodeAgentRoles });

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

    expect(updateJcodeAgentRoles).toHaveBeenCalledWith({
      swarmModel: "claude-opus-4-6",
      reviewModel: "gpt-5-review",
      judgeModel: "gpt-5-judge",
      memoryModel: "mimo-v2.5-pro",
      ambientModel: "gpt-5-ambient",
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
