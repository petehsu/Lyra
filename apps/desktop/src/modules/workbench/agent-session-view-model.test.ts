import { describe, expect, test } from "vitest";

import type { AgentSessionSnapshot } from "../../shared/agent";
import { agentSessionToChatMessages } from "./agent-session-view-model";

const baseSession = (overrides: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot => ({
  id: "session-1",
  title: "New session",
  sessionKind: "normal",
  workingDir: "/",
  projectBound: false,
  messages: [],
  tools: [],
  todos: [],
  automation: {
    subagentModel: null,
    autoreviewEnabled: null,
    autojudgeEnabled: null
  },
  sidePanel: {
    focusedPageId: null,
    pages: []
  },
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-06-05T00:00:00.000Z",
  ...overrides
});

describe("agentSessionToChatMessages Tool-FS projection", () => {
  test("uses target manifest title before meta or legacy tool titles", () => {
    const messages = agentSessionToChatMessages(baseSession({
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: {
          toolPath: "/tools/browser/read",
          domain: "browser",
          operation: "read"
        },
        output: {
          content: "Read the page.",
          manifestTitle: "Read browser page"
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z",
        toolPath: "/tools/browser/read",
        domain: "browser",
        operation: "read",
        manifestTitle: "Read browser page",
        activityKind: "web",
        rendererHint: "lumen"
      }]
    }));

    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls[0]?.title).toBe("Read browser page");
    expect(toolBlock.group.calls[0]?.title).not.toBe("Run tool");
  });
});
