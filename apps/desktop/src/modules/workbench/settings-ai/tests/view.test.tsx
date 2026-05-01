import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AiProviderPreset, AiProviderProfile } from "../../../../shared/ai";
import { SettingsAiView } from "../view";
import type { SettingsAiLabels, SettingsAiModel } from "../types";

const labels: SettingsAiLabels = {
  categoryLabel: "AI",
  profilesTitle: "Profiles",
  providerTitle: "Provider",
  connectionTitle: "Connection",
  additionalFieldsTitle: "Additional Provider Fields",
  statusTitle: "Status",
  addProfile: "New Profile",
  editProfile: "Edit Profile",
  addAllModels: "Add All Models",
  saveProfile: "Save Profile",
  deleteProfile: "Delete Profile",
  cancel: "Cancel",
  clearApiKey: "Clear API Key",
  testConnection: "Test Connection",
  discoverModels: "Discover Models",
  refreshModels: "Refresh Models",
  authorizeChatGpt: "Authorize Provider",
  authorizeChatGptDeviceCode: "Authorize via Device Code",
  profileNameLabel: "Profile Name",
  profileNamePlaceholder: "Production API",
  urlLabel: "URL",
  urlPlaceholder: "https://api.openai.com/v1",
  keyLabel: "API Key",
  keyPlaceholder: "sk-...",
  modelLabel: "Model IDs",
  mainModelLabel: "Primary Model",
  additionalModelsLabel: "Additional Models",
  modelPlaceholder: "gpt-5.4",
  modelsHelp: "Support one or many model ids.",
  headersLabel: "Request Headers",
  headersPlaceholder: "X-Title: Lyra",
  statusIdle: "No connection check has run yet.",
  statusSaved: "Profile saved.",
  statusDeleted: "Profile deleted.",
  statusDefaultUpdated: "Default profile updated.",
  statusChatGptAuthorized: "Provider authorization completed.",
  statusLastChecked: "Last Checked",
  emptyTitle: "No AI profile yet",
  emptyDescription: "Pick a provider preset, enter your API key, and save.",
  recommendedSection: "Mainstream",
  allSection: "Local",
  customSection: "Custom",
  secretConfigured: "A secret is already stored securely for this field.",
  secretMissing: "No secret stored for this field yet.",
  noDiscoveredModels: "No discovered models yet.",
  advancedSettingsLabel: "Advanced Settings",
  selectProviderLabel: "Choose Provider",
  connectionReady: "Ready",
  connectionError: "Error",
  connectionUnchecked: "Not Checked",
  deleteProfileConfirmTitle: "Delete Profile?",
  deleteProfileConfirmDescription: "This removes the saved profile and stored secret.",
  capabilityLabel: "Capability",
  capabilityFull: "Fully Supported",
  capabilityStatic: "Static Presets",
  capabilityPending: "Runtime Pending",
  modelSourceDynamic: "Dynamic",
  modelSourcePreset: "Preset",
  modelSourceCustom: "Custom",
  memoryConfigTitle: "Memory Config (JSON)",
  memoryConfigDescription: "Load or update agent memory runtime config directly.",
  memoryConfigPlaceholder: "{}",
  memoryConfigLoad: "Load Memory Config",
  memoryConfigSave: "Save Memory Config",
  memoryConfigStatusIdle: "Memory config not loaded yet.",
  memoryConfigStatusLoaded: "Memory config loaded.",
  memoryConfigStatusSaved: "Memory config saved.",
  memoryConfigStatusInvalidJson: "Invalid JSON."
};

const preset: AiProviderPreset = {
  id: "openai",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  label: "OpenAI",
  description: "OpenAI",
  section: "mainstream",
  iconKey: "openai",
  defaultModel: "gpt-5.4",
  discoveryMode: "dynamic",
  capability: "full",
  modelDiscoverySupported: true,
  customHeadersSupported: true,
  customModelsSupported: true,
  runtimeSupported: true,
  simpleFields: ["baseUrl", "apiKey"],
  connectionFields: [{
    id: "baseUrl",
    label: "URL",
    kind: "url",
    scope: "connection",
    placeholder: "https://api.openai.com/v1"
  }],
  authFields: [{
    id: "apiKey",
    label: "API Key",
    kind: "password",
    scope: "auth",
    secret: true,
    placeholder: "sk-..."
  }],
  defaultConnectionConfig: {
    baseUrl: "https://api.openai.com/v1"
  },
  defaultAuthConfig: {},
  recommendedModels: [{
    id: "gpt-5.4",
    name: "GPT-5.4",
    source: "preset"
  }]
};

const createProfile = (overrides: Partial<AiProviderProfile> = {}): AiProviderProfile => ({
  id: "profile-1",
  name: "Production API",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  runtimeProviderId: "lyra-profile-profile-1",
  runtimeSupported: true,
  secretStatus: "configured",
  presetId: "openai",
  connectionConfig: {
    baseUrl: "https://api.openai.com/v1"
  },
  authConfig: {},
  configuredSecretFields: ["apiKey"],
  headers: {},
  model: "gpt-5.4",
  customModels: [{
    id: "extra-one",
    name: "Extra One",
    source: "custom"
  }],
  discoveryState: {
    status: "ready",
    lastCheckedAt: 1,
    models: []
  },
  isDefault: false,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
});

const createModel = (overrides: Partial<SettingsAiModel> = {}): SettingsAiModel => {
  const profile = createProfile();
  return {
    isLoading: false,
    isSaving: false,
    isRefreshingModels: false,
    statusMessage: labels.statusIdle,
    statusTone: "neutral",
    runtimeHealth: {
      backend: "lyrad",
      transport: "stdio",
      version: "0.1.0"
    },
    profiles: [profile],
    presetSections: [{
      id: "mainstream",
      label: "Mainstream",
      presets: [preset]
    }],
    selectedProfileId: profile.id,
    defaultProfileId: profile.id,
    defaultProviderId: profile.runtimeProviderId,
    defaultProfileLabel: profile.name,
    defaultModelNames: [profile.model],
    selectedPresetId: preset.id,
    selectedPreset: preset,
    draft: {
      id: profile.id,
      name: profile.name,
      providerId: profile.providerId,
      protocolId: profile.protocolId,
      presetId: profile.presetId,
      connectionConfig: profile.connectionConfig,
      authConfig: profile.authConfig,
      secretValues: {},
      clearSecretFields: [],
      configuredSecretFields: profile.configuredSecretFields,
      headersText: "",
      modelsText: "gpt-5.4\nextra-one\nextra-two",
      isDefault: profile.isDefault
    },
    availableModels: [
      { id: "gpt-5.4", name: "GPT-5.4", source: "preset" },
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", source: "dynamic" },
      { id: "extra-one", name: "Extra One", source: "custom" },
      { id: "extra-two", name: "Extra Two", source: "custom" }
    ],
    selectedModelIds: ["gpt-5.4", "extra-one", "extra-two"],
    selectProfile: vi.fn(),
    applyPreset: vi.fn(),
    updateDraftName: vi.fn(),
    updateDraftHeadersText: vi.fn(),
    updateDraftModelsText: vi.fn(),
    updateDraftField: vi.fn(),
    clearSecretField: vi.fn(),
    toggleModelSelection: vi.fn(),
    refreshConfig: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
    validateProfile: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    setDefaultProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
};

const findProfileCard = (name: string): HTMLElement => {
  const card = screen
    .getAllByText(name)
    .map((element) => element.closest("article"))
    .find((element): element is HTMLElement => element !== null);
  if (card === undefined) {
    throw new Error(`Missing profile card: ${name}`);
  }
  return card;
};

describe("SettingsAiView", () => {
  test("renders saved profile cards and the add entry point", () => {
    render(<SettingsAiView labels={labels} model={createModel()} />);

    expect(screen.getByRole("button", { name: "New Profile" })).toBeInTheDocument();
    expect(findProfileCard("Production API")).toBeInTheDocument();
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-5.4").length).toBeGreaterThan(0);
    expect(screen.getByText("https://api.openai.com/v1")).toBeInTheDocument();
  });

  test("opens create editor inline and applies a selected provider preset", () => {
    const model = createModel();
    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));

    expect(model.selectProfile).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Mainstream")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose Provider" }));
    fireEvent.click(screen.getByRole("option", { name: /OpenAI/ }));

    expect(model.applyPreset).toHaveBeenCalledWith("openai");
  });

  test("opens edit editor inline for the selected profile draft", () => {
    const model = createModel();
    render(<SettingsAiView labels={labels} model={model} />);

    const card = findProfileCard("Production API");
    fireEvent.click(within(card).getByRole("button", { name: "Edit Profile" }));

    expect(model.selectProfile).toHaveBeenCalledWith("profile-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Production API")).toBeInTheDocument();
  });

  test("updates the primary model without dropping additional model lines", () => {
    const model = createModel();
    render(<SettingsAiView labels={labels} model={model} />);

    const card = findProfileCard("Production API");
    fireEvent.click(within(card).getByRole("button", { name: "Edit Profile" }));
    fireEvent.change(screen.getByDisplayValue("gpt-5.4"), {
      target: { value: "claude-sonnet-4-5" }
    });

    expect(model.updateDraftModelsText).toHaveBeenCalledWith(
      "claude-sonnet-4-5\nextra-one\nextra-two"
    );
  });

  test("adds every available additional model at once", () => {
    const model = createModel();
    render(<SettingsAiView labels={labels} model={model} />);

    const card = findProfileCard("Production API");
    fireEvent.click(within(card).getByRole("button", { name: "Edit Profile" }));
    fireEvent.click(screen.getByText("Advanced Settings"));
    fireEvent.click(screen.getByRole("button", { name: "Add All Models" }));

    expect(model.updateDraftModelsText).toHaveBeenCalledWith(
      "gpt-5.4\nextra-one\nextra-two\nclaude-sonnet-4-5"
    );
  });

  test("routes profile card and inline editor actions through the model callbacks", async () => {
    const model = createModel();
    render(<SettingsAiView labels={labels} model={model} />);

    const card = findProfileCard("Production API");
    fireEvent.click(within(card).getByRole("button", { name: "Test Connection" }));
    expect(within(card).queryByRole("button", { name: "Set as Default" })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Delete Profile" }));

    expect(model.validateProfile).toHaveBeenCalledWith("profile-1");

    const confirm = screen.getByLabelText("Delete Profile?");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete Profile" }));

    await waitFor(() => {
      expect(model.deleteProfile).toHaveBeenCalledWith("profile-1");
    });

    fireEvent.click(within(card).getByRole("button", { name: "Edit Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => {
      expect(model.saveProfile).toHaveBeenCalled();
    });
  });
});
