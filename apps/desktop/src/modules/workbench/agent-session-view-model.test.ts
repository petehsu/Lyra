import { describe, expect, test } from "vitest";

import type { AgentSessionSnapshot } from "../../shared/agent";
import {
  agentSessionToChatMessages,
  applyAgentRuntimeEventToSnapshot
} from "./agent-session-view-model";

const baseSession = (overrides: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot => ({
  id: "session-1",
  title: "New session",
  sessionKind: "normal",
  workingDir: "/",
  projectBound: false,
  messages: [],
  tools: [],
  todos: [],
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-06-05T00:00:00.000Z",
  ...overrides
});

describe("agentSessionToChatMessages Tool-FS projection", () => {
  test("omits menu action turns marked uiHidden from the chat transcript", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [
        {
          id: "message-hidden",
          role: "user",
          text: "Improve the current work.",
          createdAt: "2026-06-05T00:00:01.000Z",
          metadata: { uiHidden: true }
        },
        {
          id: "message-visible",
          role: "assistant",
          text: "Here is the improvement plan.",
          createdAt: "2026-06-05T00:00:02.000Z"
        }
      ]
    }));

    expect(messages.map((message) => message.id)).toEqual(["message-visible"]);
  });

  test("renders an empty history after schema v3 destructive session cleanup", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [],
      tools: [],
      turnStatus: "idle",
      activeTurnId: null,
      follow: { running: false, activity: null }
    }));

    expect(messages).toEqual([]);
  });

  test("marks assistant messages with API error metadata", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "message-api-error",
        role: "assistant",
        text: "provider returned diagnostic detail",
        createdAt: "2026-06-05T00:00:02.000Z",
        metadata: { isApiError: true }
      }]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("message-api-error");
    expect(messages[0]?.isApiError).toBe(true);
  });

  test("uses target manifest title before meta or legacy tool titles", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }]
      }],
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

  test("uses target path title when Tool-FS run activity lacks manifest title", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }]
      }],
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: {
          path: "/tools/git/status",
          args: {}
        },
        output: {
          content: "Git status is clean.",
          toolPath: "/tools/git/status",
          domain: "git",
          operation: "status",
          traceId: "trace-1",
          trace: [{
            phase: "completed",
            status: "ok",
            traceId: "trace-1"
          }],
          artifactRefs: [{
            id: "artifact-1",
            kind: "raw_data",
            path: "/tmp/lyra/artifact-1.txt",
            mimeType: "text/plain; charset=utf-8",
            bytes: 24,
            preview: "{\"status\":\"clean\"}",
            previewTruncated: false
          }],
          changes: [{
            kind: "git",
            path: ".",
            diffRef: {
              id: "diff-1",
              kind: "diff",
              path: "/tmp/lyra/diff-1.log",
              mimeType: "text/plain; charset=utf-8",
              preview: "diff --git a/file b/file",
              previewTruncated: true
            }
          }]
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z",
        toolPath: "/tools/git/status",
        domain: "git",
        operation: "status",
        activityKind: "git",
        rendererHint: "git"
      }]
    }));

    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls[0]?.title).toBe("Status");
    expect(toolBlock.group.calls[0]?.title).not.toBe("Run tool");
    expect(toolBlock.group.calls[0]?.title).not.toBe("tool_fs_run");
    expect(toolBlock.group.calls[0]?.traceId).toBe("trace-1");
    expect(toolBlock.group.calls[0]?.trace).toHaveLength(1);
    expect(toolBlock.group.calls[0]?.artifactRefs).toHaveLength(1);
    expect(toolBlock.group.calls[0]?.changes).toHaveLength(1);
    expect(toolBlock.group.calls[0]?.artifactPreviews).toEqual([{
      label: "artifact-1",
      text: "{\"status\":\"clean\"}",
      kind: "raw_data",
      path: "/tmp/lyra/artifact-1.txt",
      bytes: 24,
      truncated: false
    }, {
      label: "diff-1",
      text: "diff --git a/file b/file",
      kind: "diff",
      path: "/tmp/lyra/diff-1.log",
      truncated: true
    }]);
    expect(toolBlock.group.calls[0]?.artifactTargets).toEqual([{
      kind: "file",
      label: "Open artifact 1",
      value: "/tmp/lyra/artifact-1.txt",
      mediaType: "text/plain; charset=utf-8"
    }, {
      kind: "file",
      label: "Open change 1 diff",
      value: "/tmp/lyra/diff-1.log",
      mediaType: "text/plain; charset=utf-8"
    }]);
  });

  test("does not revive legacy direct tool names without Tool-FS metadata", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }]
      }],
      tools: [{
        id: "tool-1",
        name: "lyra_lumen",
        label: "Used Lyra tool",
        status: "completed",
        input: { action: "read", path: "README.md" },
        output: { content: "Legacy browser output." },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z"
      }]
    }));

    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls[0]?.kind).toBe("thought");
    expect(toolBlock.group.calls[0]?.title).toBe("Tool activity");
    expect(toolBlock.group.calls[0]?.title).not.toBe("lyra_lumen");
    expect(toolBlock.group.calls[0]?.title).not.toBe("README.md");
    expect(toolBlock.group.calls[0]?.details).toEqual({
      type: "text",
      body: "Legacy browser output."
    });
  });

  test("projects Tool-FS not-run reasons for unified tool error UI", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }]
      }],
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "failed",
        input: { path: "/tools/shell/run_command", args: { command: "sleep 10" } },
        output: {
          status: "failed",
          content: "Command timed out.",
          toolPath: "/tools/shell/run_command",
          domain: "shell",
          operation: "run",
          notRunReason: "timeout"
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z"
      }]
    }));

    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls[0]?.status).toBe("error");
    expect(toolBlock.group.calls[0]?.failureReason).toBe("timeout");
  });

  test("treats follow events as process state and ToolResultEnvelope as final evidence", () => {
    const following = applyAgentRuntimeEventToSnapshot(baseSession(), {
      kind: "followStateChanged",
      sessionId: "session-1",
      follow: { running: true, activity: "Reading browser" }
    });

    expect(following.follow).toEqual({ running: true, activity: "Reading browser" });
    expect(following.tools).toHaveLength(0);
    expect(
      agentSessionToChatMessages(following)
        .flatMap((message) => message.blocks)
        .some((block) => block.type === "tools")
    ).toBe(false);

    const withMessage = applyAgentRuntimeEventToSnapshot(following, {
      kind: "messageCommitted",
      sessionId: "session-1",
      message: {
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:01.000Z",
        blocks: []
      }
    });
    const withToolStarted = applyAgentRuntimeEventToSnapshot(withMessage, {
      kind: "toolStarted",
      sessionId: "session-1",
      messageId: "assistant-1",
      tool: {
        id: "tool-browser-read",
        name: "tool_fs_run",
        label: "Run tool",
        status: "running",
        input: {
          path: "/tools/browser/read",
          args: {}
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        toolPath: "/tools/browser/read",
        domain: "browser",
        operation: "read",
        activityKind: "web",
        rendererHint: "lumen"
      }
    });
    const finished = applyAgentRuntimeEventToSnapshot(withToolStarted, {
      kind: "toolFinished",
      sessionId: "session-1",
      tool: {
        id: "tool-browser-read",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: {
          path: "/tools/browser/read",
          args: {}
        },
        output: {
          schemaVersion: 1,
          status: "completed",
          ok: true,
          content: "Browser text.",
          raw: { text: "Browser text." },
          toolPath: "/tools/browser/read",
          domain: "browser",
          operation: "read",
          manifestTitle: "Read browser page",
          traceId: "trace-browser-read"
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z",
        toolPath: "/tools/browser/read",
        domain: "browser",
        operation: "read",
        manifestTitle: "Read browser page",
        activityKind: "web",
        rendererHint: "lumen",
        traceId: "trace-browser-read"
      }
    });
    const messages = agentSessionToChatMessages(finished);
    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls).toHaveLength(1);
    expect(toolBlock.group.calls[0]?.title).toBe("Read browser page");
    expect(toolBlock.group.calls[0]?.traceId).toBe("trace-browser-read");
  });

  test("builds tool details from ToolResultEnvelope raw and args", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:04.000Z",
        blocks: [
          { type: "tool", id: "tool-tool-read", toolId: "tool-read" },
          { type: "tool", id: "tool-tool-shell", toolId: "tool-shell" }
        ]
      }],
      tools: [{
        id: "tool-read",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: {
          path: "/tools/filesystem/read_file",
          args: { path: "src/main.rs" }
        },
        output: {
          content: "fn main() {}",
          raw: { path: "src/main.rs" },
          toolPath: "/tools/filesystem/read_file",
          domain: "filesystem",
          operation: "read"
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z"
      }, {
        id: "tool-shell",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: {
          path: "/tools/shell/run_command",
          args: { command: "pwd" }
        },
        output: {
          content: "/tmp/project",
          raw: { command: "pwd", exitCode: 0 },
          toolPath: "/tools/shell/run_command",
          domain: "shell",
          operation: "run"
        },
        startedAt: "2026-06-05T00:00:03.000Z",
        finishedAt: "2026-06-05T00:00:04.000Z"
      }]
    }));

    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls[0]?.details).toMatchObject({
      type: "read",
      file: "src/main.rs"
    });
    expect(toolBlock.group.calls[1]?.details).toMatchObject({
      type: "shell",
      command: "pwd",
      exitCode: 0
    });
  });

  test("preserves text and tool interleaving inside assistant messages", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "Checking the page.\n\nHere is the result.",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [
          { type: "text", id: "text-0", text: "Checking the page." },
          { type: "tool", id: "tool-tool-1", toolId: "tool-1" },
          { type: "text", id: "text-1", text: "Here is the result." }
        ]
      }],
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: { path: "/tools/browser/read", args: {} },
        output: { content: "Browser text.", toolPath: "/tools/browser/read" },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z",
        toolPath: "/tools/browser/read",
        domain: "browser",
        operation: "read",
        activityKind: "web",
        rendererHint: "lumen"
      }]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.type)).toEqual([
      "text",
      "tools",
      "text"
    ]);
  });

  test("collapses consecutive orphan tools but keeps text between tool rounds", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "First step.",
          createdAt: "2026-06-05T00:00:02.000Z",
          blocks: [
            { type: "text", id: "text-0", text: "First step." },
            { type: "tool", id: "tool-tool-1", toolId: "tool-1" }
          ]
        },
        {
          id: "assistant-2",
          role: "assistant",
          text: "Second step.",
          createdAt: "2026-06-05T00:00:04.000Z",
          blocks: [
            { type: "text", id: "text-0", text: "Second step." },
            { type: "tool", id: "tool-tool-2", toolId: "tool-2" }
          ]
        }
      ],
      tools: [
        {
          id: "tool-1",
          name: "tool_fs_run",
          label: "Run tool",
          status: "completed",
          input: { path: "/tools/browser/read", args: {} },
          output: { content: "Read 1", toolPath: "/tools/browser/read" },
          startedAt: "2026-06-05T00:00:01.000Z",
          finishedAt: "2026-06-05T00:00:02.000Z",
          toolPath: "/tools/browser/read",
          domain: "browser",
          operation: "read",
          activityKind: "web",
          rendererHint: "lumen"
        },
        {
          id: "tool-2",
          name: "tool_fs_run",
          label: "Run tool",
          status: "completed",
          input: { path: "/tools/browser/read", args: {} },
          output: { content: "Read 2", toolPath: "/tools/browser/read" },
          startedAt: "2026-06-05T00:00:03.000Z",
          finishedAt: "2026-06-05T00:00:04.000Z",
          toolPath: "/tools/browser/read",
          domain: "browser",
          operation: "read",
          activityKind: "web",
          rendererHint: "lumen"
        }
      ]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks.map((block) => block.type)).toEqual([
      "text",
      "tools",
      "text",
      "tools"
    ]);
    const toolBlocks = messages[0]?.blocks.filter((block) => block.type === "tools") ?? [];
    expect(toolBlocks[0]?.group.calls).toHaveLength(1);
    expect(toolBlocks[1]?.group.calls).toHaveLength(1);
  });

  test("renders tools only from message blocks in committed order", () => {
    const messages = agentSessionToChatMessages(baseSession({
      turnStatus: "running",
      follow: { running: true, activity: "waiting_for_tool" },
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "Search Google for topics.",
          createdAt: "2026-06-05T00:00:00.000Z"
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "定位到Google然后搜索一些你感兴趣的话题",
          createdAt: "2026-06-05T00:00:04.000Z",
          blocks: [
            { type: "text", id: "text-0", text: "定位到Google然后搜索一些你感兴趣的话题" },
            { type: "tool", id: "tool-tool-1", toolId: "tool-1" }
          ]
        }
      ],
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "running",
        input: { path: "/tools/browser/navigate", args: {} },
        startedAt: "2026-06-05T00:00:01.000Z",
        toolPath: "/tools/browser/navigate",
        domain: "browser",
        operation: "navigate",
        activityKind: "web",
        rendererHint: "lumen"
      }]
    }));

    const agentMessage = messages.find((message) => message.id === "assistant-1");
    expect(agentMessage?.blocks.map((block) => block.type)).toEqual(["text", "tools"]);
    expect(agentMessage?.blocks[0]).toMatchObject({
      type: "text",
      body: "定位到Google然后搜索一些你感兴趣的话题"
    });
  });

  test("renders preamble text before tools when blocks are committed in order", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "Let me inspect the page first.",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [
          { type: "text", id: "text-0", text: "Let me inspect the page first." },
          { type: "tool", id: "tool-tool-1", toolId: "tool-1" }
        ]
      }],
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: { path: "/tools/browser/read", args: {} },
        output: { content: "Browser text.", toolPath: "/tools/browser/read" },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z",
        toolPath: "/tools/browser/read",
        domain: "browser",
        operation: "read",
        activityKind: "web",
        rendererHint: "lumen"
      }]
    }));

    expect(messages[0]?.blocks.map((block) => block.type)).toEqual(["text", "tools"]);
    expect(messages[0]?.blocks[0]).toMatchObject({
      type: "text",
      body: "Let me inspect the page first."
    });
  });

  test("classifies tool calls from Tool-FS activity and renderer hints", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }]
      }],
      tools: [{
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "completed",
        input: { args: { command: "pwd" } },
        output: { content: "/tmp/project", raw: { command: "pwd", exitCode: 0 } },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:02.000Z",
        activityKind: "shell",
        rendererHint: "shell"
      }]
    }));

    const toolBlock = messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "tools");

    expect(toolBlock?.type).toBe("tools");
    if (toolBlock?.type !== "tools") return;
    expect(toolBlock.group.calls[0]?.kind).toBe("shell");
    expect(toolBlock.group.calls[0]?.details?.type).toBe("shell");
  });

  test("hides legacy synthetic tool narration text from assistant tool rounds", () => {
    const messages = agentSessionToChatMessages(baseSession({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "browser.press · browser.read",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [
          { type: "text", id: "text-0", text: "browser.press · browser.read" },
          { type: "tool", id: "tool-tool-1", toolId: "tool-1" },
          { type: "tool", id: "tool-tool-2", toolId: "tool-2" }
        ]
      }],
      tools: [
        {
          id: "tool-1",
          name: "tool_fs_run",
          label: "Run tool",
          status: "completed",
          input: { path: "/tools/browser/press", args: {} },
          output: { content: "Pressed.", toolPath: "/tools/browser/press" },
          startedAt: "2026-06-05T00:00:01.000Z",
          finishedAt: "2026-06-05T00:00:02.000Z",
          toolPath: "/tools/browser/press",
          domain: "browser",
          operation: "press",
          activityKind: "web",
          rendererHint: "lumen"
        },
        {
          id: "tool-2",
          name: "tool_fs_run",
          label: "Run tool",
          status: "completed",
          input: { path: "/tools/browser/read", args: {} },
          output: { content: "Read.", toolPath: "/tools/browser/read" },
          startedAt: "2026-06-05T00:00:02.000Z",
          finishedAt: "2026-06-05T00:00:03.000Z",
          toolPath: "/tools/browser/read",
          domain: "browser",
          operation: "read",
          activityKind: "web",
          rendererHint: "lumen"
        }
      ]
    }));

    expect(messages[0]?.blocks.map((block) => block.type)).toEqual(["tools"]);
  });

  test("hides finished assistant shells that only contain protocol leak text", () => {
    const messages = agentSessionToChatMessages(baseSession({
      turnStatus: "idle",
      messages: [{
        id: "assistant-leak",
        role: "assistant",
        text: "[Tool result ref: call_abc]",
        createdAt: "2026-06-05T00:00:02.000Z",
        blocks: [{
          type: "text",
          id: "text-0",
          text: "[Tool result ref: call_abc]"
        }]
      }]
    }));

    expect(messages).toEqual([]);
  });

  test("hides legacy runtime fallback assistant bubbles from the transcript", () => {
    const messages = agentSessionToChatMessages(baseSession({
      turnStatus: "idle",
      messages: [{
        id: "assistant-fallback",
        role: "assistant",
        text: "Lyra native agent runtime is active, but the model call could not run: boom.",
        createdAt: "2026-06-05T00:00:02.000Z"
      }]
    }));

    expect(messages).toEqual([]);
  });

  test("keeps a pending assistant shell while the turn is running", () => {
    const messages = agentSessionToChatMessages(baseSession({
      turnStatus: "running",
      follow: { running: true, activity: "streaming_model" },
      messages: [{
        id: "assistant-pending",
        role: "assistant",
        text: "",
        createdAt: "2026-06-05T00:00:02.000Z"
      }]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks).toEqual([
      {
        type: "text",
        id: "assistant-pending-text",
        body: ""
      }
    ]);
  });
});
