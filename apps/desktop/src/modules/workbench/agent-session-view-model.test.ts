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

  test("uses target path title when Tool-FS run activity lacks manifest title", () => {
    const messages = agentSessionToChatMessages(baseSession({
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

    const finished = applyAgentRuntimeEventToSnapshot(following, {
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

  test("classifies tool calls from Tool-FS activity and renderer hints", () => {
    const messages = agentSessionToChatMessages(baseSession({
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
});
