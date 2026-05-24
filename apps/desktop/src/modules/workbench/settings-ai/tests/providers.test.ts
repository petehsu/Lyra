import { describe, expect, test } from "vitest";

import { AI_PROVIDER_PRESETS } from "../providers";

describe("settings-ai provider presets", () => {
  test("exposes only high-level Xiaomi MiMo choices", () => {
    const mimoPresets = AI_PROVIDER_PRESETS.filter((preset) => preset.providerId === "mimo");

    expect(mimoPresets.map((preset) => preset.id)).toEqual([
      "mimo_api",
      "mimo_token_plan"
    ]);
    expect(mimoPresets.every((preset) =>
      preset.connectionFields.some((field) => field.id === "mimoProtocol")
    )).toBe(true);
    expect(mimoPresets.find((preset) => preset.id === "mimo_token_plan")?.connectionFields.some((field) =>
      field.id === "mimoRegion"
    )).toBe(true);
    expect(mimoPresets.every((preset) => preset.authFields.some((field) => field.id === "apiKey"))).toBe(true);
    expect(mimoPresets.every((preset) => preset.runtimeSupported)).toBe(true);
  });

  test("keeps hosted provider URLs internal and exposes local/custom connection fields", () => {
    const hostedProviderIds = new Set(["openai", "anthropic", "google_ai"]);
    const hostedPresets = AI_PROVIDER_PRESETS.filter((preset) => hostedProviderIds.has(preset.providerId));
    const editablePresets = AI_PROVIDER_PRESETS.filter((preset) =>
      preset.section === "local" || preset.section === "custom"
    );

    expect(hostedPresets.every((preset) => preset.connectionFields.length === 0)).toBe(true);
    expect(editablePresets.every((preset) =>
      preset.connectionFields.some((field) => field.id === "baseUrl" || field.id === "modelPath")
    )).toBe(true);
  });

  test("does not ship hardcoded model ids", () => {
    const presetsWithModels = AI_PROVIDER_PRESETS.filter((preset) =>
      preset.defaultModel !== "" || preset.recommendedModels.length > 0
    );

    expect(presetsWithModels).toEqual([]);
  });

  test("exposes Responses and embedded local model protocols", () => {
    expect(AI_PROVIDER_PRESETS.map((preset) => preset.protocolId)).toEqual(expect.arrayContaining([
      "openai_responses",
      "llama_cpp_server",
      "vllm_chat_completions",
      "llama_cpp_ffi",
      "mlx_ffi"
    ]));

    const embeddedPresets = AI_PROVIDER_PRESETS.filter((preset) =>
      preset.protocolId === "llama_cpp_ffi" || preset.protocolId === "mlx_ffi"
    );
    expect(embeddedPresets.every((preset) =>
      preset.connectionFields.some((field) => field.id === "modelPath" && field.kind === "file")
    )).toBe(true);
    expect(embeddedPresets.every((preset) =>
      preset.runtimeMetadata?.localRuntimeKind === "ffi"
    )).toBe(true);
    expect(embeddedPresets.every((preset) => preset.runtimeSupported === false)).toBe(true);
  });

  test("exposes Lyra Agent provider routes while marking unwired backends explicitly", () => {
    expect(AI_PROVIDER_PRESETS.map((preset) => preset.providerId)).toEqual(expect.arrayContaining([
      "openrouter",
      "copilot",
      "antigravity",
      "cursor",
      "aws_bedrock"
    ]));

    const openRouter = AI_PROVIDER_PRESETS.find((preset) => preset.providerId === "openrouter");
    expect(openRouter?.runtimeSupported).toBe(true);

    const unwired = AI_PROVIDER_PRESETS.filter((preset) =>
      ["copilot", "antigravity", "cursor", "aws_bedrock"].includes(preset.providerId)
    );
    expect(unwired.every((preset) => preset.runtimeSupported === false)).toBe(true);
  });
});
