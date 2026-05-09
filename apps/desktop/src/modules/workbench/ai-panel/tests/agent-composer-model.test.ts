import { describe, expect, test } from "vitest";

import { createTranslator } from "../../i18n";
import {
  createAgentComposerModelState,
  createComposerModelMenuStyle,
  groupComposerModelOptions,
  normalizeComposerModelOptions,
  resolveAgentComposerClassName,
  resolveComposerSendVisualState,
  resolveSelectedComposerModelName
} from "../agent-composer-model";

describe("agent composer model", () => {
  test("normalizes model options and falls back to model names", () => {
    expect(normalizeComposerModelOptions({
      modelOptions: [
        { value: " gpt-a ", label: " GPT A " },
        { value: "gpt-a", label: "Duplicate" },
        { value: "gpt-b", label: "   " },
        { value: "   ", label: "Ignored" }
      ],
      modelNames: ["fallback"]
    })).toEqual([
      { value: "gpt-a", label: "GPT A" },
      { value: "gpt-b", label: "gpt-b" }
    ]);

    expect(normalizeComposerModelOptions({
      modelNames: [" gpt-a ", "gpt-a", "gpt-b"]
    })).toEqual([
      { value: "gpt-a", label: "gpt-a" },
      { value: "gpt-b", label: "gpt-b" }
    ]);
  });

  test("resolves selected model and menu width style", () => {
    const options = [
      { value: "gpt-a", label: "GPT A" },
      { value: "gpt-b", label: "GPT B Long Label" }
    ];

    expect(resolveSelectedComposerModelName({
      selectedModelName: " gpt-b ",
      modelOptions: options
    })).toBe("gpt-b");
    expect(resolveSelectedComposerModelName({
      selectedModelName: "missing",
      modelOptions: options
    })).toBe("gpt-a");
    expect(resolveSelectedComposerModelName({
      selectedModelName: null,
      modelOptions: []
    })).toBeNull();
    expect(createComposerModelMenuStyle(options)).toEqual({
      "--lyra-ai-agent-model-menu-w": "clamp(var(--lyra-unit-160), calc(16ch + var(--lyra-unit-52)), min(58cqw, var(--lyra-unit-320)))",
      "--lyra-ai-agent-model-provider-menu-w": "clamp(var(--lyra-unit-112), calc(10ch + var(--lyra-unit-44)), var(--lyra-unit-184))"
    });
  });

  test("groups model options by provider", () => {
    expect(groupComposerModelOptions([
      { value: "openai:gpt-a", label: "GPT A", providerId: "openai", providerLabel: "OpenAI" },
      { value: "openai:gpt-b", label: "GPT B", providerId: "openai", providerLabel: "OpenAI" },
      { value: "anthropic:claude", label: "Claude", providerId: "anthropic", providerLabel: "Anthropic" },
    ])).toEqual([
      {
        providerId: "openai",
        providerLabel: "OpenAI",
        options: [
          { value: "openai:gpt-a", label: "GPT A", providerId: "openai", providerLabel: "OpenAI" },
          { value: "openai:gpt-b", label: "GPT B", providerId: "openai", providerLabel: "OpenAI" },
        ],
      },
      {
        providerId: "anthropic",
        providerLabel: "Anthropic",
        options: [
          { value: "anthropic:claude", label: "Claude", providerId: "anthropic", providerLabel: "Anthropic" },
        ],
      },
    ]);
  });

  test("computes composer labels and state", () => {
    const model = createAgentComposerModelState({
      t: createTranslator("en-US"),
      modelNames: ["gpt-a", "gpt-b"],
      selectedModelName: "missing",
      modelAriaLabel: "  ",
      modelSwitchDisabled: false,
      onModelSelectAvailable: true,
      planModeLabel: "Custom plan",
      steerLabel: undefined
    });

    expect(model.resolvedPlanModeLabel).toBe("Custom plan");
    expect(model.resolvedModelAriaLabel).toBe("Model");
    expect(model.resolvedSteerLabel).toBe("Steer");
    expect(model.resolvedSelectedModelName).toBe("gpt-a");
    expect(model.canOpenModelMenu).toBe(true);
    expect(model.selectedModelLabel).toBe("gpt-a");
  });

  test("computes visual state and class name", () => {
    expect(resolveComposerSendVisualState({
      sending: true,
      sendDisabled: false,
      hasContent: true
    })).toBe("sending");
    expect(resolveComposerSendVisualState({
      sending: false,
      sendDisabled: false,
      hasContent: true
    })).toBe("ready");
    expect(resolveComposerSendVisualState({
      sending: false,
      sendDisabled: true,
      hasContent: true
    })).toBe("idle");
    expect(resolveAgentComposerClassName({
      surfaceDimmed: true,
      sending: false
    })).toBe("lyra-ai-agent-composer lyra-ai-agent-composer-disabled");
    expect(resolveAgentComposerClassName({
      surfaceDimmed: true,
      sending: true
    })).toBe("lyra-ai-agent-composer");
  });
});
