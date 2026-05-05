import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AiModelDiscoveryResult,
  AiProviderModelEntry,
  AiProviderProfile,
  AiRuntimeConfigSnapshot,
  AiUpsertProfileRequest,
} from "../../../../shared/ai";
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

const emptySnapshot: AiRuntimeConfigSnapshot = {
  schemaVersion: "v1",
  profiles: [],
  defaultProfileId: null,
  defaultProviderId: null,
  defaultModelNames: [],
  runtimeHealth: {
    backend: "lyrad",
    transport: "test",
    version: "0"
  }
};

const discoveryResult: AiModelDiscoveryResult = {
  providerId: "openai",
  protocolId: "openai_chat_completions",
  status: "ready",
  message: "Models discovered.",
  checkedAt: 1,
  models: [
    {
      id: "model-a",
      name: "model-a",
      source: "dynamic"
    },
    {
      id: "model-b",
      name: "model-b",
      source: "dynamic"
    }
  ]
};

const savedProfile = (model: string): AiProviderProfile => ({
  id: "profile-openai",
  name: "OpenAI",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  runtimeProviderId: "openai",
  runtimeSupported: true,
  secretStatus: "configured",
  presetId: "openai",
  connectionConfig: {
    baseUrl: "https://api.openai.com/v1"
  },
  authConfig: {
    modelSelectionMode: "all"
  },
  configuredSecretFields: ["apiKey"],
  headers: {},
  model,
  customModels: [],
  discoveryState: {
    status: "idle",
    lastCheckedAt: null,
    models: []
  },
  isDefault: true,
  createdAt: 1,
  updatedAt: 1
});

const modelEntry = (
  id: string,
  overrides: Partial<AiProviderModelEntry> = {}
): AiProviderModelEntry => ({
  id,
  name: id,
  source: "dynamic",
  ...overrides
});

describe("useSettingsAiModel", () => {
  test("discovers and stores all models when the all mode is selected", async () => {
    const readConfig = vi.fn().mockResolvedValue(emptySnapshot);
    const upsertProfile = vi.fn().mockImplementation(async (request: AiUpsertProfileRequest) => savedProfile(request.model));
    const discoverModels = vi.fn().mockResolvedValue(discoveryResult);
    const desktopApi = {
      ai: {
        readConfig,
        upsertProfile,
        deleteProfile: vi.fn(),
        discoverModels
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useSettingsAiModel({ desktopApi, labels }));

    await waitFor(() => {
      expect(readConfig).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.saveProfile();
    });

    expect(discoverModels).toHaveBeenCalledTimes(1);
    expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({
      authConfig: expect.objectContaining({
        modelSelectionMode: "all"
      }),
      model: "model-a",
      customModels: [
        expect.objectContaining({
          id: "model-b"
        })
      ],
      discoveryState: expect.objectContaining({
        models: discoveryResult.models
      })
    }));
  });

  test("deletes every profile for a configured provider", async () => {
    const openaiProfile = savedProfile("model-a");
    const secondOpenaiProfile: AiProviderProfile = {
      ...savedProfile("model-b"),
      id: "profile-openai-secondary",
      name: "OpenAI secondary",
      runtimeProviderId: "openai-secondary"
    };
    const anthropicProfile: AiProviderProfile = {
      ...savedProfile("claude-a"),
      id: "profile-anthropic",
      name: "Anthropic",
      providerId: "anthropic",
      protocolId: "anthropic_messages",
      runtimeProviderId: "anthropic"
    };
    const readConfig = vi.fn()
      .mockResolvedValueOnce({
        ...emptySnapshot,
        profiles: [openaiProfile, secondOpenaiProfile, anthropicProfile]
      })
      .mockResolvedValueOnce({
        ...emptySnapshot,
        profiles: [anthropicProfile]
      });
    const deleteProfile = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      ai: {
        readConfig,
        upsertProfile: vi.fn(),
        deleteProfile,
        discoverModels: vi.fn()
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useSettingsAiModel({ desktopApi, labels }));

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(3);
    });

    await act(async () => {
      await result.current.deleteProviderModels("openai");
    });

    expect(deleteProfile).toHaveBeenNthCalledWith(1, { id: "profile-openai" });
    expect(deleteProfile).toHaveBeenNthCalledWith(2, { id: "profile-openai-secondary" });
    expect(readConfig).toHaveBeenCalledTimes(2);
  });

  test("removes one configured model by rewriting the saved profile", async () => {
    const profile: AiProviderProfile = {
      ...savedProfile("model-a"),
      customModels: [
        modelEntry("model-b", { name: "Model B" }),
        modelEntry("model-c", { name: "Model C" })
      ],
      discoveryState: {
        status: "ready",
        lastCheckedAt: 2,
        models: [
          modelEntry("model-a"),
          modelEntry("model-b", { name: "Model B" }),
          modelEntry("model-c", { name: "Model C" })
        ]
      }
    };
    const readConfig = vi.fn()
      .mockResolvedValueOnce({
        ...emptySnapshot,
        profiles: [profile]
      })
      .mockResolvedValueOnce({
        ...emptySnapshot,
        profiles: [profile]
      });
    const upsertProfile = vi.fn().mockImplementation(async (request: AiUpsertProfileRequest) => ({
      ...profile,
      model: request.model,
      customModels: request.customModels ?? [],
      discoveryState: request.discoveryState ?? profile.discoveryState
    }));
    const deleteProfile = vi.fn();
    const desktopApi = {
      ai: {
        readConfig,
        upsertProfile,
        deleteProfile,
        discoverModels: vi.fn()
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useSettingsAiModel({ desktopApi, labels }));

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteConfiguredModel("profile-openai", "model-b");
    });

    const request = upsertProfile.mock.calls[0]?.[0] as AiUpsertProfileRequest;
    expect(request).toMatchObject({
      id: "profile-openai",
      model: "model-a",
      customModels: [
        expect.objectContaining({
          id: "model-c",
          name: "Model C"
        })
      ]
    });
    expect(request.discoveryState?.models.map((entry) => entry.id)).toEqual(["model-a", "model-c"]);
    expect(request).not.toHaveProperty("secretValues");
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  test("deletes the profile when removing its last configured model", async () => {
    const profile = savedProfile("model-a");
    const readConfig = vi.fn()
      .mockResolvedValueOnce({
        ...emptySnapshot,
        profiles: [profile]
      })
      .mockResolvedValueOnce(emptySnapshot);
    const upsertProfile = vi.fn();
    const deleteProfile = vi.fn().mockResolvedValue(undefined);
    const desktopApi = {
      ai: {
        readConfig,
        upsertProfile,
        deleteProfile,
        discoverModels: vi.fn()
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useSettingsAiModel({ desktopApi, labels }));

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteConfiguredModel("profile-openai", "model-a");
    });

    expect(deleteProfile).toHaveBeenCalledWith({ id: "profile-openai" });
    expect(upsertProfile).not.toHaveBeenCalled();
  });
});
