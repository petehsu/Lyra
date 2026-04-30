import { describe, expect, test } from "vitest";

import type { AiProviderProfile, AiProviderModelEntry } from "../../../../shared/ai";
import {
  MODEL_OPTION_DELIMITER,
  canOpenReviewChanges,
  createComposerReserveStyle,
  createRuntimeModelOptions,
  createRuntimeTurnOptions,
  gitMetadataProbePaths,
  isAiRuntimeBusy,
  permissionRuntimeOptions,
  resolveBoundProjectRoot,
  resolveSelectedRuntimeModelOption,
  shouldShowEmptySessionScene,
  uniqueModelIds
} from "../surface-model";

const createModelEntry = (
  id: string,
  source: AiProviderModelEntry["source"] = "custom"
): AiProviderModelEntry => ({
  id,
  name: id,
  source
});

const createProfile = (overrides: Partial<AiProviderProfile>): AiProviderProfile => ({
  id: "profile-openai",
  name: "OpenAI",
  providerId: "openai",
  protocolId: "openai_chat_completions",
  runtimeProviderId: "lp-openai",
  runtimeSupported: true,
  secretStatus: "configured",
  presetId: null,
  connectionConfig: {},
  authConfig: {},
  configuredSecretFields: [],
  headers: {},
  model: "gpt-5",
  customModels: [],
  discoveryState: {
    status: "idle",
    lastCheckedAt: null,
    models: []
  },
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
});

describe("ai panel surface model", () => {
  test("deduplicates model ids after trimming", () => {
    expect(uniqueModelIds([" gpt-5 ", "", "gpt-5", "claude", " claude "])).toEqual([
      "gpt-5",
      "claude"
    ]);
  });

  test("creates runtime model options from supported profiles with default profile first", () => {
    const options = createRuntimeModelOptions({
      configuredProfiles: [
        createProfile({
          id: "profile-anthropic",
          name: "Anthropic",
          providerId: "anthropic",
          protocolId: "anthropic_messages",
          runtimeProviderId: "lp-anthropic",
          model: "claude-sonnet"
        }),
        createProfile({
          id: "profile-disabled",
          runtimeSupported: false,
          model: "disabled-model"
        }),
        createProfile({
          id: "profile-openai",
          name: "OpenAI",
          model: "gpt-5",
          customModels: [
            createModelEntry("gpt-5"),
            createModelEntry("gpt-5-mini")
          ],
          discoveryState: {
            status: "ready",
            lastCheckedAt: 10,
            models: [
              createModelEntry("gpt-5-mini", "dynamic"),
              createModelEntry("gpt-5.1", "dynamic")
            ]
          }
        })
      ],
      defaultProfileId: "profile-openai",
      defaultProviderId: "lp-default",
      defaultModelNames: ["fallback-model"]
    });

    expect(options).toEqual([
      {
        value: `profile-openai${MODEL_OPTION_DELIMITER}gpt-5`,
        label: "gpt-5 · OpenAI",
        model: "gpt-5",
        modelProvider: "lp-openai"
      },
      {
        value: `profile-openai${MODEL_OPTION_DELIMITER}gpt-5-mini`,
        label: "gpt-5-mini · OpenAI",
        model: "gpt-5-mini",
        modelProvider: "lp-openai"
      },
      {
        value: `profile-openai${MODEL_OPTION_DELIMITER}gpt-5.1`,
        label: "gpt-5.1 · OpenAI",
        model: "gpt-5.1",
        modelProvider: "lp-openai"
      },
      {
        value: `profile-anthropic${MODEL_OPTION_DELIMITER}claude-sonnet`,
        label: "claude-sonnet · Anthropic",
        model: "claude-sonnet",
        modelProvider: "lp-anthropic"
      }
    ]);
  });

  test("uses primary profile model runtime metadata", () => {
    const options = createRuntimeModelOptions({
      configuredProfiles: [
        createProfile({
          model: "gpt-5.4",
          modelRuntimeMetadata: {
            supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
            defaultReasoningLevel: "medium",
            supportVerbosity: true,
            defaultVerbosity: "low"
          }
        })
      ],
      defaultProfileId: "profile-openai",
      defaultProviderId: "lp-default",
      defaultModelNames: ["fallback-model"]
    });

    expect(options[0]?.runtimeMetadata).toEqual({
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
      defaultReasoningLevel: "medium",
      supportVerbosity: true,
      defaultVerbosity: "low"
    });
  });

  test("falls back to default model names when profiles cannot run in the runtime", () => {
    const options = createRuntimeModelOptions({
      configuredProfiles: [
        createProfile({
          runtimeProviderId: "   ",
          model: "ignored"
        })
      ],
      defaultProfileId: null,
      defaultProviderId: "lp-default",
      defaultModelNames: [" gpt-5 ", "gpt-5", "gpt-4"]
    });

    expect(options).toEqual([
      {
        value: "gpt-5",
        label: "gpt-5",
        model: "gpt-5",
        modelProvider: "lp-default"
      },
      {
        value: "gpt-4",
        label: "gpt-4",
        model: "gpt-4",
        modelProvider: "lp-default"
      }
    ]);
  });

  test("resolves selected model options with first-option fallback", () => {
    const options = createRuntimeModelOptions({
      configuredProfiles: [],
      defaultModelNames: ["gpt-5", "gpt-4"],
      defaultProviderId: "lp-default"
    });

    expect(resolveSelectedRuntimeModelOption(options, "gpt-4")?.model).toBe("gpt-4");
    expect(resolveSelectedRuntimeModelOption(options, "missing")?.model).toBe("gpt-5");
    expect(resolveSelectedRuntimeModelOption([], "missing")).toBeNull();
  });

  test("maps permission modes into runtime turn options", () => {
    expect(permissionRuntimeOptions("default")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxMode: "workspace-write"
    });
    expect(permissionRuntimeOptions("auto_review")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxMode: "workspace-write"
    });
    expect(permissionRuntimeOptions("full_access")).toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxMode: "danger-full-access"
    });

    expect(createRuntimeTurnOptions({
      selectedModelOption: {
        value: "profile/gpt-5",
        label: "gpt-5",
        model: "gpt-5",
        modelProvider: "lp-openai"
      },
      defaultProviderId: "lp-default",
      boundProjectRoot: "/repo",
      permissionMode: "auto_review",
      collaborationMode: "plan"
    })).toEqual({
      model: "gpt-5",
      modelProvider: "lp-openai",
      cwd: "/repo",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxMode: "workspace-write",
      collaborationMode: "plan"
    });
  });

  test("resolves bound project roots by mapped, persisted, then pending priority", () => {
    expect(resolveBoundProjectRoot({
      activeThreadId: "thread-1",
      mappedRoots: new Map([["thread-1", "/mapped"]]),
      pendingRoot: "/pending",
      activeThread: {
        id: "thread-1",
        boundProjectRoot: "/persisted"
      }
    })).toBe("/mapped");

    expect(resolveBoundProjectRoot({
      activeThreadId: "thread-1",
      mappedRoots: new Map(),
      pendingRoot: "/pending",
      activeThread: {
        id: "thread-1",
        boundProjectRoot: "/persisted"
      }
    })).toBe("/persisted");

    expect(resolveBoundProjectRoot({
      activeThreadId: null,
      mappedRoots: new Map(),
      pendingRoot: "/pending",
      activeThread: null
    })).toBe("/pending");
  });

  test("builds git metadata probe paths from nested project roots", () => {
    expect(gitMetadataProbePaths("/Users/dev/project/src/")).toEqual([
      "/Users/dev/project/src/.git",
      "/Users/dev/project/.git",
      "/Users/dev/.git",
      "/Users/.git",
      "/.git"
    ]);
    expect(gitMetadataProbePaths("")).toEqual([]);
  });

  test("only opens review changes when the active thread has a usable git project", () => {
    expect(canOpenReviewChanges({
      activeThreadId: "thread-1",
      boundProjectRoot: "/repo",
      gitMetadataAvailable: true,
      isAgentAvailable: true,
      isBusy: false,
      isReviewStarting: false
    })).toBe(true);

    expect(canOpenReviewChanges({
      activeThreadId: null,
      boundProjectRoot: "/repo",
      gitMetadataAvailable: true,
      isAgentAvailable: true,
      isBusy: false,
      isReviewStarting: false
    })).toBe(false);
    expect(canOpenReviewChanges({
      activeThreadId: "thread-1",
      boundProjectRoot: null,
      gitMetadataAvailable: true,
      isAgentAvailable: true,
      isBusy: false,
      isReviewStarting: false
    })).toBe(false);
    expect(canOpenReviewChanges({
      activeThreadId: "thread-1",
      boundProjectRoot: "/repo",
      gitMetadataAvailable: false,
      isAgentAvailable: true,
      isBusy: false,
      isReviewStarting: false
    })).toBe(false);
    expect(canOpenReviewChanges({
      activeThreadId: "thread-1",
      boundProjectRoot: "/repo",
      gitMetadataAvailable: true,
      isAgentAvailable: true,
      isBusy: true,
      isReviewStarting: false
    })).toBe(false);
  });

  test("computes stable surface booleans and composer reserve style", () => {
    expect(shouldShowEmptySessionScene({
      messageCount: 0,
      optimisticMessageCount: 0,
      streamingAssistantText: "",
      isStreamActive: false
    })).toBe(true);
    expect(shouldShowEmptySessionScene({
      messageCount: 0,
      optimisticMessageCount: 1,
      streamingAssistantText: "",
      isStreamActive: false
    })).toBe(false);
    expect(isAiRuntimeBusy({ isSending: false, isStreamActive: true })).toBe(true);
    expect(isAiRuntimeBusy({ isSending: false, isStreamActive: false })).toBe(false);
    expect(createComposerReserveStyle(12)).toEqual({
      "--lyra-ai-composer-reserve": "96px"
    });
    expect(createComposerReserveStyle(124.2)).toEqual({
      "--lyra-ai-composer-reserve": "125px"
    });
  });
});
