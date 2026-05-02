import { describe, expect, test } from "vitest";

import { mapAgentRuntimeNotificationToWorkbenchNotification } from "../agent-runtime-notification-adapter";

describe("agent runtime notification adapter", () => {
  test("maps config warnings to unified workbench notifications", () => {
    const notification = mapAgentRuntimeNotificationToWorkbenchNotification({
      method: "configWarning",
      params: {
        summary: "Invalid model provider",
        details: "Unknown provider in config.toml",
        path: "/repo/.lyra/config.toml",
      },
    });

    expect(notification).toMatchObject({
      title: "Agent config warning",
      preview: "Invalid model provider",
      level: "warning",
      source: {
        id: "lyra-agent-runtime",
        title: "Lyra Agent",
        iconKey: "ai",
      },
      target: {
        kind: "app-tab",
        appId: "file-editor",
        filePath: "/repo/.lyra/config.toml",
      },
    });
    expect(notification.body).toContain("Unknown provider");
  });

  test("dedupes high frequency token usage notifications with a silent preview", () => {
    const first = mapAgentRuntimeNotificationToWorkbenchNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 200,
            inputTokens: 150,
            cachedInputTokens: 25,
            outputTokens: 50,
            reasoningOutputTokens: 9,
          },
          last: {
            totalTokens: 20,
            inputTokens: 13,
            cachedInputTokens: 5,
            outputTokens: 7,
            reasoningOutputTokens: 1,
          },
          modelContextWindow: 4096,
        },
      },
    });
    const second = mapAgentRuntimeNotificationToWorkbenchNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 250,
            inputTokens: 180,
            cachedInputTokens: 25,
            outputTokens: 70,
            reasoningOutputTokens: 12,
          },
          last: {
            totalTokens: 50,
            inputTokens: 30,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningOutputTokens: 3,
          },
          modelContextWindow: 4096,
        },
      },
    });

    expect(second.id).toBe(first.id);
    expect(second.preview).toBe("Total tokens: 250");
    expect(second.previewBehavior).toBe("silent");
    expect(second.target).toMatchObject({
      kind: "app-tab",
      appId: "ai-history",
      appInstanceId: "ai-history-center",
    });
  });

  test("maps lagged runtime events to warning notifications", () => {
    const notification = mapAgentRuntimeNotificationToWorkbenchNotification({
      method: "runtime/lagged",
      params: {
        threadId: "thread-1",
        skipped: 7,
      },
    });

    expect(notification).toMatchObject({
      id: "agent-runtime:runtime-lagged:thread-1:Skipped-7-runtime-events.-The-thread-will-be-refreshed.",
      title: "Agent event stream lagged",
      level: "warning",
    });
  });
});
