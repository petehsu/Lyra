import { describe, expect, it } from "vitest";

import type { AgentSessionSnapshot } from "../../../shared/agent";
import { agentSessionToChatMessages, visibleAssistantText } from "./message-view-model";

const session = (
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot => ({
  id: "session-1",
  title: "Session",
  sessionKind: "normal",
  agentMode: "solo",
  oma: null,
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
    const details = toolBlock?.group.calls[0]?.details;
    expect(details?.type).toBe("edit");
    if (details?.type !== "edit") {
      throw new Error("expected edit tool details");
    }
    expect(details.hunks.length).toBeGreaterThan(0);
  });

  it("renders a single card when the same tool id is both linked and running", () => {
    // The streaming preview and the final execution share one tool_call_id. If the
    // message already links the tool block AND it is still reported as running, the
    // merge must dedup by id so the diff card never appears twice.
    const messages = agentSessionToChatMessages(session({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "HTML 搞定，现在写 CSS。",
          blocks: [
            { type: "text", id: "text-1", text: "HTML 搞定，现在写 CSS。" },
            { type: "tool", id: "tool-block-1", toolId: "call_css" }
          ],
          createdAt: "2026-06-20T00:00:00.000Z"
        }
      ],
      tools: [{
        id: "call_css",
        name: "write_file",
        label: "Write file",
        status: "running",
        activityKind: "edit",
        rendererHint: "edit",
        input: { path: "styles.css", content: ".nav { position: fixed; }\n" },
        output: {
          raw: {
            diff: [
              "--- styles.css",
              "+++ styles.css",
              "@@ -0,0 +1 @@",
              "+.nav { position: fixed; }"
            ].join("\n"),
            preview: true
          }
        },
        startedAt: "2026-06-20T00:00:01.000Z"
      }]
    }));

    const toolBlocks = messages.flatMap((message) =>
      message.blocks.filter((block) => block.type === "tools")
    );
    const cssCalls = toolBlocks.flatMap((block) =>
      block.type === "tools" ? block.group.calls.filter((call) => call.id === "call_css") : []
    );
    expect(cssCalls).toHaveLength(1);
  });

  it("keeps clarification tools out of the message timeline", () => {
    const messages = agentSessionToChatMessages(session({
      messages: [{
        id: "assistant-clarification",
        role: "assistant",
        text: "",
        blocks: [{ type: "tool", id: "tool-clarification", toolId: "clarification-1" }],
        createdAt: "2026-06-20T00:00:00.000Z"
      }],
      tools: [{
        id: "clarification-1",
        name: "clarification",
        label: "Asked for clarification",
        status: "running",
        input: { question: "Which style?" },
        startedAt: "2026-06-20T00:00:01.000Z"
      }]
    }));

    expect(messages).toEqual([]);
  });

  it("carries real assistant work duration from message and tool timestamps", () => {
    const messages = agentSessionToChatMessages(session({
      turnStatus: "idle",
      follow: { running: false, activity: null },
      messages: [
        {
          id: "assistant-narration",
          role: "assistant",
          text: "我先检查项目。",
          blocks: [{ type: "text", id: "text-1", text: "我先检查项目。" }],
          createdAt: "2026-06-20T00:00:00.000Z"
        },
        {
          id: "assistant-tool",
          role: "assistant",
          text: "",
          blocks: [{ type: "tool", id: "tool-block-1", toolId: "call_search" }],
          createdAt: "2026-06-20T00:00:01.000Z"
        },
        {
          id: "assistant-summary",
          role: "assistant",
          text: "已完成。",
          blocks: [{ type: "text", id: "text-2", text: "已完成。" }],
          createdAt: "2026-06-20T00:00:05.000Z"
        }
      ],
      tools: [{
        id: "call_search",
        name: "search",
        label: "Search",
        status: "completed",
        input: { query: "Agent" },
        output: { content: "done" },
        startedAt: "2026-06-20T00:00:02.000Z",
        finishedAt: "2026-06-20T00:00:04.000Z"
      }]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.workDurationMs).toBe(5_000);
  });

  it("filters out compressed-context-block system messages", () => {
    const messages = agentSessionToChatMessages(session({
      turnStatus: "idle",
      follow: { running: false, activity: null },
      messages: [
        {
          id: "compress-block-1",
          role: "system",
          text: '{"summary":"checkpoint","compressedMessageIds":["msg-a"]}',
          metadata: { kind: "compressed-context-block" },
          createdAt: "2026-06-20T00:00:00.000Z"
        },
        {
          id: "user-1",
          role: "user",
          text: "你好",
          createdAt: "2026-06-20T00:00:01.000Z"
        }
      ]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("user-1");
  });

  it("renders thinking blocks in their factual block order", () => {
    const messages = agentSessionToChatMessages(session({
      turnStatus: "idle",
      follow: { running: false, activity: null },
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "先说一句。再说一句。",
        blocks: [
          { type: "text", id: "text-0", text: "先说一句。" },
          { type: "thinking", id: "thinking-1", text: "中间思考。", status: "done" },
          { type: "text", id: "text-2", text: "再说一句。" }
        ],
        createdAt: "2026-06-20T00:00:00.000Z",
        reasoningContent: "旧字段不应重复显示",
        reasoningStatus: "done"
      }]
    }));

    expect(messages[0]?.blocks).toEqual([
      { type: "text", id: "assistant-1-text-0", body: "先说一句。" },
      { type: "thinking", id: "assistant-1-thinking-1", body: "中间思考。", status: "done" },
      { type: "text", id: "assistant-1-text-2", body: "再说一句。" }
    ]);
  });
});
