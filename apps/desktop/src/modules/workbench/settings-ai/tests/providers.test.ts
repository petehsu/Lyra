import { describe, expect, test } from "vitest";

import { AI_PROVIDER_PRESETS } from "../providers";

describe("settings-ai provider presets", () => {
  test("exposes only high-level Xiaomi MiMo choices", () => {
    const mimoPresets = AI_PROVIDER_PRESETS.filter((preset) => preset.providerId === "mimo");

    expect(mimoPresets.map((preset) => preset.id)).toEqual([
      "mimo_api",
      "mimo_token_plan"
    ]);
    expect(mimoPresets.every((preset) => preset.connectionFields.length === 0)).toBe(true);
    expect(mimoPresets.every((preset) => preset.authFields.some((field) => field.id === "apiKey"))).toBe(true);
  });

  test("keeps hosted provider URLs internal and leaves local/custom URLs editable", () => {
    const hostedProviderIds = new Set(["openai", "anthropic", "google_ai", "mimo"]);
    const hostedPresets = AI_PROVIDER_PRESETS.filter((preset) => hostedProviderIds.has(preset.providerId));
    const editablePresets = AI_PROVIDER_PRESETS.filter((preset) =>
      preset.section === "local" || preset.section === "custom"
    );

    expect(hostedPresets.every((preset) => preset.connectionFields.length === 0)).toBe(true);
    expect(editablePresets.every((preset) =>
      preset.connectionFields.some((field) => field.id === "baseUrl")
    )).toBe(true);
  });

  test("does not ship preset model ids", () => {
    expect(AI_PROVIDER_PRESETS.every((preset) => preset.defaultModel === "")).toBe(true);
    expect(AI_PROVIDER_PRESETS.every((preset) => preset.recommendedModels.length === 0)).toBe(true);
  });
});
