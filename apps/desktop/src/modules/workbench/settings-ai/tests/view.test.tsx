import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AiProviderPreset,
  AiProviderProfile
} from "../../../../shared/ai";
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

const openAiPreset: AiProviderPreset = {
  id: "openai",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  label: "OpenAI",
  description: "OpenAI hosted models.",
  section: "mainstream",
  iconKey: "openai",
  defaultModel: "",
  discoveryMode: "dynamic",
  modelDiscoverySupported: true,
  customHeadersSupported: false,
  customModelsSupported: false,
  runtimeSupported: true,
  simpleFields: ["apiKey"],
  connectionFields: [],
  authFields: [
    {
      id: "apiKey",
      label: "API Key",
      kind: "password",
      scope: "auth",
      placeholder: "sk-...",
      required: true,
      secret: true
    }
  ],
  defaultConnectionConfig: {
    baseUrl: "https://api.openai.com/v1"
  },
  defaultAuthConfig: {},
  recommendedModels: []
};

const draft: SettingsAiDraft = {
  id: null,
  name: "",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  presetId: "openai",
  connectionConfig: {
    baseUrl: "https://api.openai.com/v1"
  },
  authConfig: {},
  secretValues: {},
  configuredSecretFields: [],
  headersText: "",
  modelSelectionMode: "all",
  modelsText: "",
  isDefault: false
};

const createModel = (overrides: Partial<SettingsAiModel> = {}): SettingsAiModel => ({
  isSaving: false,
  errorMessage: null,
  profiles: [],
  presetSections: [
    {
      id: "mainstream",
      label: "Recommended",
      presets: [openAiPreset]
    }
  ],
  selectedProfileId: null,
  defaultProfileId: null,
  defaultProviderId: null,
  defaultModelNames: [],
  selectedPresetId: "openai",
  selectedPreset: openAiPreset,
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
  ...overrides
});

const createProfile = (overrides: Partial<AiProviderProfile> = {}): AiProviderProfile => ({
  id: "profile-openai",
  name: "OpenAI",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  runtimeProviderId: "openai:profile-openai",
  runtimeSupported: true,
  secretStatus: "configured",
  presetId: "openai",
  connectionConfig: {
    baseUrl: "https://api.openai.com/v1"
  },
  authConfig: {},
  configuredSecretFields: ["apiKey"],
  headers: {},
  model: "gpt-5",
  customModels: [],
  discoveryState: {
    status: "idle",
    lastCheckedAt: null,
    models: []
  },
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
});

describe("SettingsAiView", () => {
  test("renders the Settings-owned AI profile editor", () => {
    const model = createModel();

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("heading", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByText("No AI profile yet")).toBeInTheDocument();
    expect(screen.getByText("Create a profile to use runtime models.")).toBeInTheDocument();
    expect(screen.queryByText("Reserved for the next Agent runtime.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).toHaveValue("");
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Main model" })).toHaveTextContent("All");
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discover models" })).not.toBeInTheDocument();
    expect(screen.queryByText("Key missing")).not.toBeInTheDocument();
    expect(screen.queryByText("Additional models")).not.toBeInTheDocument();
    expect(screen.queryByText("Headers")).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete profile" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(model.saveProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear key" })).not.toBeInTheDocument();
  });

  test("shows profile save errors inline", () => {
    const model = createModel({
      errorMessage: "Could not resolve host"
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not resolve host");
  });

  test("shows the custom model id input only in custom mode", () => {
    const model = createModel({
      draft: {
        ...draft,
        modelSelectionMode: "custom",
        modelsText: "custom-model"
      },
      modelSelectionMode: "custom"
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getByRole("button", { name: "Main model" })).toHaveTextContent("Custom");
    expect(screen.getByLabelText("Model")).toHaveValue("custom-model");
  });

  test("shows configured models one by one instead of every available model", () => {
    const selectProfile = vi.fn();
    const model = createModel({
      selectProfile,
      profiles: [
        createProfile({
          model: "saved-model-a",
          customModels: [
            {
              id: "saved-model-b",
              name: "Saved B",
              description: "configured alias",
              source: "custom"
            }
          ]
        }),
        createProfile({
          id: "profile-anthropic",
          name: "Anthropic",
          providerId: "anthropic",
          protocolId: "anthropic_messages",
          runtimeProviderId: "anthropic:profile-anthropic",
          presetId: "anthropic",
          model: "claude-a",
          customModels: [
            {
              id: "claude-b",
              name: "Claude B",
              description: "anthropic alias",
              source: "custom"
            }
          ]
        })
      ],
      availableModels: [
        {
          id: "provider-model-x",
          name: "Provider model x",
          source: "dynamic"
        }
      ]
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.queryByRole("button", { name: "Add profile" })).not.toBeInTheDocument();
    expect(screen.getByText("saved-model-a")).toBeInTheDocument();
    expect(screen.getByText("Saved B")).toBeInTheDocument();
    expect(screen.queryByText("claude-a")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude B")).not.toBeInTheDocument();
    expect(screen.getByText("configured alias")).toBeInTheDocument();
    expect(screen.queryByText("Provider model x")).not.toBeInTheDocument();
    expect(screen.queryByText("provider-model-x")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "anthropic Anthropic" }));

    expect(screen.getByText("claude-a")).toBeInTheDocument();
    expect(screen.getByText("Claude B")).toBeInTheDocument();
    expect(screen.queryByText("saved-model-a")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Claude B anthropic alias" }));
    expect(selectProfile).toHaveBeenCalledWith("profile-anthropic");
  });

  test("deletes configured providers and models from their saved rows", () => {
    const deleteProviderModels = vi.fn();
    const deleteConfiguredModel = vi.fn();
    const model = createModel({
      deleteProviderModels,
      deleteConfiguredModel,
      profiles: [
        createProfile({
          model: "saved-model-a",
          customModels: [
            {
              id: "saved-model-b",
              name: "Saved B",
              source: "custom"
            }
          ]
        }),
        createProfile({
          id: "profile-anthropic",
          name: "Anthropic",
          providerId: "anthropic",
          protocolId: "anthropic_messages",
          runtimeProviderId: "anthropic:profile-anthropic",
          presetId: "anthropic",
          model: "claude-a",
          customModels: [
            {
              id: "claude-b",
              name: "Claude B",
              description: "anthropic alias",
              source: "custom"
            }
          ]
        })
      ]
    });

    render(<SettingsAiView labels={labels} model={model} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete profile: openai" }));
    expect(deleteProviderModels).toHaveBeenCalledWith("openai");

    fireEvent.click(screen.getByRole("button", { name: "anthropic Anthropic" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete profile: Claude B" }));
    expect(deleteConfiguredModel).toHaveBeenCalledWith("profile-anthropic", "claude-b");
  });

  test("shows saved profile metadata without exposing secret values", () => {
    const model = createModel({
      profiles: [createProfile()],
      selectedProfileId: "profile-openai",
      draft: {
        ...draft,
        id: "profile-openai",
        name: "OpenAI",
        configuredSecretFields: ["apiKey"],
        isDefault: true
      }
    });

    render(<SettingsAiView labels={labels} model={model} />);

    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(screen.queryByText("Key configured")).not.toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Set default" })).not.toBeInTheDocument();
  });
});
