import { describe, expect, test } from "vitest";

import {
  appendAdditionalConfiguredModelLines,
  parseConfiguredModelEntries,
  replacePrimaryConfiguredModelLine,
  resolveConfiguredModels,
  toDraft
} from "../draft";
import type { AiProviderModelEntry, AiProviderProfile } from "../../../../shared/ai";

const createModelEntry = (
  id: string,
  source: AiProviderModelEntry["source"] = "custom"
): AiProviderModelEntry => ({
  id,
  name: id,
  source
});

describe("settings-ai draft model parsing", () => {
  test("accepts multiple delimiter styles for model ids", () => {
    const parsed = parseConfiguredModelEntries(
      "gpt-5.4, gpt-5.4-mini，deepseek-chat、claude-sonnet-4-5; qwen2.5-coder\ncustom-model"
    );

    expect(parsed.map((entry) => entry.id)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "deepseek-chat",
      "claude-sonnet-4-5",
      "qwen2.5-coder",
      "custom-model"
    ]);
  });

  test("preserves rich custom entries while resolving primary and custom models", () => {
    const knownModels: readonly AiProviderModelEntry[] = [
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        source: "dynamic"
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        source: "dynamic"
      }
    ];

    const resolved = resolveConfiguredModels(
      "gpt-5.4\nmy-model | My Model | Internal alias\ngpt-5.4-mini",
      knownModels,
      "fallback-model"
    );

    expect(resolved.primaryModel).toBe("gpt-5.4");
    expect(resolved.customModels).toEqual([
      {
        id: "my-model",
        name: "My Model",
        description: "Internal alias",
        source: "custom"
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        source: "dynamic"
      }
    ]);
  });

  test("replaces only the primary model line", () => {
    expect(replacePrimaryConfiguredModelLine(
      "gpt-5.4\nmy-model | My Model | Internal alias\ngpt-5.4-mini",
      "claude-sonnet-4-5"
    )).toBe("claude-sonnet-4-5\nmy-model | My Model | Internal alias\ngpt-5.4-mini");
  });

  test("appends all additional model ids without duplicating primary or existing entries", () => {
    expect(appendAdditionalConfiguredModelLines(
      "gpt-5.4\nextra-one",
      ["extra-one", "extra-two", "gpt-5.4", "extra-three"]
    )).toBe("gpt-5.4\nextra-one\nextra-two\nextra-three");
  });

  test("keeps every saved profile model in the settings draft", () => {
    const profile: AiProviderProfile = {
      id: "profile-openai",
      name: "OpenAI",
      providerId: "openai",
      protocolId: "openai_chat_completions",
      runtimeProviderId: "lp-openai",
      runtimeSupported: true,
      secretStatus: "configured",
      presetId: "openai",
      connectionConfig: {},
      authConfig: {},
      configuredSecretFields: [],
      headers: {},
      model: "gpt-5",
      customModels: [createModelEntry("gpt-5-mini")],
      discoveryState: {
        status: "ready",
        lastCheckedAt: 1,
        models: [createModelEntry("gpt-5-mini", "dynamic"), createModelEntry("gpt-4.1", "dynamic")]
      },
      isDefault: false,
      createdAt: 1,
      updatedAt: 1
    };

    expect(toDraft(profile, []).modelsText).toBe("gpt-5\ngpt-5-mini\ngpt-4.1");
  });
});
