import { describe, expect, test } from "vitest";

import {
  parseConfiguredModelEntries,
  resolveConfiguredModels
} from "../draft";
import type { AiProviderModelEntry } from "../../../../shared/ai";

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
});
