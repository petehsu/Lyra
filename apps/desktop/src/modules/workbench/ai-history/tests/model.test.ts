import { describe, expect, test } from "vitest";

import type { AgentSessionDetail } from "../../../../shared/desktop-bridge";
import {
  buildPreviewDisplayMessages,
  groupThreadsByProject,
  toThreadSummary,
  type LyraThreadSummary
} from "../model";

const createThread = (
  overrides: Partial<LyraThreadSummary>
): LyraThreadSummary => ({
  id: "thread",
  name: null,
  preview: "",
  updatedAt: null,
  modelProvider: null,
  boundProjectRoot: null,
  ...overrides
});

const createPreviewDetail = (): AgentSessionDetail => ({
  session: {
    id: "thread-a",
    title: "Thread A",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 4
  },
  pendingInteractions: [],
  turns: [],
  messages: [
    {
      id: "message-newer",
      sessionId: "thread-a",
      turnId: "turn-newer",
      role: "assistant",
      content: "newer",
      createdAt: 3
    },
    {
      id: "message-older",
      sessionId: "thread-a",
      turnId: "turn-older",
      role: "user",
      content: "older",
      createdAt: 2
    }
  ],
  toolCalls: [],
  runtimeEvents: []
});

describe("ai history model", () => {
  test("normalizes thread summaries from Lyra payloads", () => {
    expect(toThreadSummary({ id: "" })).toBeNull();
    expect(toThreadSummary({
      id: "thread-a",
      name: "  Build UI  ",
      preview: "  first line  ",
      updatedAt: 1_700_000_000,
      modelProvider: " lp-openai ",
      boundProjectRoot: {
        path: "/Users/dev/project-a/"
      }
    })).toEqual({
      id: "thread-a",
      name: "Build UI",
      preview: "first line",
      updatedAt: 1_700_000_000_000,
      modelProvider: "lp-openai",
      boundProjectRoot: "/Users/dev/project-a/"
    });
  });

  test("groups project threads by normalized root and recency", () => {
    const groups = groupThreadsByProject([
      createThread({
        id: "older-a",
        updatedAt: 10,
        boundProjectRoot: "/Users/dev/project-a/"
      }),
      createThread({
        id: "newer-a",
        updatedAt: 30,
        boundProjectRoot: "\\Users\\dev\\project-a"
      }),
      createThread({
        id: "project-b",
        updatedAt: 40,
        boundProjectRoot: "/Users/dev/project-b"
      }),
      createThread({
        id: "global",
        updatedAt: 50,
        boundProjectRoot: null
      })
    ]);

    expect(groups.map((group) => group.projectRoot)).toEqual([
      "/Users/dev/project-b",
      "/Users/dev/project-a"
    ]);
    expect(groups[1]?.displayName).toBe("project-a");
    expect(groups[1]?.threads.map((thread) => thread.id)).toEqual([
      "newer-a",
      "older-a"
    ]);
  });

  test("adds live preview messages only until the persisted assistant message exists", () => {
    const detail = createPreviewDetail();

    expect(
      buildPreviewDisplayMessages(detail, {
        threadId: "thread-a",
        turnId: "turn-live",
        text: "streaming",
        updatedAt: 5
      }).map((message) => message.id)
    ).toEqual([
      "message-older",
      "message-newer",
      "live-preview:thread-a:turn-live"
    ]);

    expect(
      buildPreviewDisplayMessages(detail, {
        threadId: "thread-a",
        turnId: "turn-newer",
        text: "already persisted",
        updatedAt: 5
      }).map((message) => message.id)
    ).toEqual([
      "message-older",
      "message-newer"
    ]);
  });
});
