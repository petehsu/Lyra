import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

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

const renderModel = () =>
  renderHook(() => useSettingsAiModel({ desktopApi: null, labels }));

describe("useSettingsAiModel", () => {
  test("starts as a local-only settings model without runtime state", () => {
    const { result } = renderModel();

    expect(result.current.profiles).toEqual([]);
    expect(result.current.selectedProfileId).toBeNull();
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.presetSections.length).toBeGreaterThan(0);
  });

  test("saves custom models into local memory only", async () => {
    const { result } = renderModel();

    act(() => {
      result.current.updateDraftName("Local test profile");
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("user-model-a\nuser-model-b");
    });
    await act(async () => {
      await result.current.saveProfile();
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });
    expect(result.current.profiles[0]).toMatchObject({
      name: "Local test profile",
      model: "user-model-a",
      runtimeSupported: false,
      isDefault: true,
      discoveryState: {
        status: "idle",
        models: []
      }
    });
    expect(result.current.profiles[0]?.customModels.map((entry) => entry.id)).toEqual(["user-model-b"]);
    expect(result.current.selectedProfileId).toBe(result.current.profiles[0]?.id);
  });

  test("saves a different preset as a separate local profile", async () => {
    const { result } = renderModel();

    await act(async () => {
      await result.current.saveProfile();
    });
    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });
    const firstProfileId = result.current.profiles[0]?.id;

    act(() => {
      result.current.applyPreset("mimo_api");
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("mimo-model");
    });
    await act(async () => {
      await result.current.saveProfile();
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });
    expect(result.current.profiles.map((profile) => profile.id)).toContain(firstProfileId);
    expect(result.current.profiles.find((profile) => profile.providerId === "mimo")).toMatchObject({
      protocolId: "mimo_openai_chat_completions",
      model: "mimo-model"
    });
  });

  test("updates a selected local profile in memory", async () => {
    const { result } = renderModel();

    act(() => {
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("model-a\nmodel-b");
    });
    await act(async () => {
      await result.current.saveProfile();
    });
    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });
    const profileId = result.current.profiles[0]?.id ?? "";

    act(() => {
      result.current.selectProfile(profileId);
      result.current.updateDraftModelsText("model-c\nmodel-d");
    });
    await act(async () => {
      await result.current.saveProfile();
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });
    expect(result.current.profiles[0]).toMatchObject({
      id: profileId,
      model: "model-c"
    });
    expect(result.current.profiles[0]?.customModels.map((entry) => entry.id)).toEqual(["model-d"]);
  });

  test("deletes provider profiles from local memory", async () => {
    const { result } = renderModel();

    await act(async () => {
      await result.current.saveProfile();
    });
    act(() => {
      result.current.applyPreset("anthropic");
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("claude-test");
    });
    await act(async () => {
      await result.current.saveProfile();
    });
    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    await act(async () => {
      await result.current.deleteProviderModels("lmstudio");
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });
    expect(result.current.profiles[0]?.providerId).toBe("anthropic");
  });

  test("removes configured models and deletes the profile when none remain", async () => {
    const { result } = renderModel();

    act(() => {
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("model-a\nmodel-b\nmodel-c");
    });
    await act(async () => {
      await result.current.saveProfile();
    });
    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });
    const profileId = result.current.profiles[0]?.id ?? "";

    await act(async () => {
      await result.current.deleteConfiguredModel(profileId, "model-b");
    });

    expect(result.current.profiles[0]).toMatchObject({
      model: "model-a"
    });
    expect(result.current.profiles[0]?.customModels.map((entry) => entry.id)).toEqual(["model-c"]);

    await act(async () => {
      await result.current.deleteConfiguredModel(profileId, "model-a");
    });
    expect(result.current.profiles[0]).toMatchObject({
      model: "model-c"
    });
    expect(result.current.profiles[0]?.customModels).toEqual([]);

    await act(async () => {
      await result.current.deleteConfiguredModel(profileId, "model-c");
    });

    await waitFor(() => {
      expect(result.current.profiles).toEqual([]);
    });
    expect(result.current.selectedProfileId).toBeNull();
  });

  test("sets the default profile locally", async () => {
    const { result } = renderModel();

    await act(async () => {
      await result.current.saveProfile();
    });
    act(() => {
      result.current.applyPreset("openai");
      result.current.updateDraftModelSelectionMode("custom");
      result.current.updateDraftModelsText("gpt-test");
    });
    await act(async () => {
      await result.current.saveProfile();
    });
    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });
    const openAiProfileId = result.current.profiles.find((profile) => profile.providerId === "openai")?.id ?? "";

    await act(async () => {
      await result.current.setDefaultProfile(openAiProfileId);
    });

    expect(result.current.defaultProfileId).toBe(openAiProfileId);
    expect(result.current.defaultProviderId).toBe("openai");
    expect(result.current.defaultModelNames).toEqual(["gpt-test"]);
  });
});
