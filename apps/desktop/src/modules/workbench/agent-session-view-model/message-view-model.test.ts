import { describe, expect, it } from "vitest";

import type { AgentSessionSnapshot } from "../../../shared/agent";
import { agentSessionToChatMessages, visibleAssistantText } from "./message-view-model";

const session = (
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot => ({
  id: "session-1",
  title: "Session",
  workingDir: "/project",
  projectBound: false,
  workingDirIsHome: false,
  turnStatus: "running",
  activeTurnId: "turn-1",
  follow: { running: true, activity: "Editing" },
  messages: [
    {
      id: "assistant-1",
      role: "assistant",
      text: "",
      blocks: [{ type: "text", id: "text-1", text: "" }],
      createdAt: "2026-06-20T00:00:00.000Z"
    }
  ],
  tools: [],
  todos: [],
  memory: null,
  updatedAt: "2026-06-20T00:00:00.000Z",
  ...overrides
});

describe("visibleAssistantText", () => {
  it("preserves markdown newlines so block structure survives rendering", () => {
    const input = "# 标题\n\n正文一段。\n\n## 小节\n\n- 项 1\n- 项 2";
    expect(visibleAssistantText(input)).toBe(input);
  });

  it("collapses runs of spaces/tabs within a line but keeps newlines", () => {
    const input = "这是一段   带多余空格的文本。\n\n## 列表";
    expect(visibleAssistantText(input)).toBe("这是一段 带多余空格的文本。\n\n## 列表");
  });

  it("strips internal protocol markers without flattening newlines", () => {
    const input = "# 标题\n\n正文。 [Tool result ref: call_abc]\n\n## 小节";
    expect(visibleAssistantText(input)).toBe("# 标题\n\n正文。\n\n## 小节");
  });

  it("trims trailing whitespace on each line", () => {
    const input = "行一   \n行二\t\n行三";
    expect(visibleAssistantText(input)).toBe("行一\n行二\n行三");
  });
});

describe("agentSessionToChatMessages", () => {
  it("surfaces running edit tools before assistant message tool blocks exist", () => {
    const messages = agentSessionToChatMessages(session({
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Write file",
        status: "running",
        activityKind: "edit",
        rendererHint: "edit",
        input: {
          path: "/tools/filesystem/write_file",
          args: { path: "src/main.ts", content: "export const x = 1;\n" }
        },
        output: {
          raw: {
            diff: [
              "--- src/main.ts",
              "+++ src/main.ts",
              "@@ -0,0 +1 @@",
              "+export const x = 1;"
            ].join("\n"),
            preview: true
          }
        },
        startedAt: "2026-06-20T00:00:01.000Z"
      }]
    }));

    expect(messages).toHaveLength(1);
    const toolBlock = messages[0]?.blocks.find((block) => block.type === "tools");
    expect(toolBlock?.type).toBe("tools");
    expect(toolBlock?.group.status).toBe("running");
    expect(toolBlock?.group.calls[0]?.details?.type).toBe("edit");
    expect(toolBlock?.group.calls[0]?.details?.hunks.length).toBeGreaterThan(0);
  });
});