import { describe, expect, test } from "vitest";

import type { AgentToolActivity } from "../../../shared/agent";
import { toToolCall, toToolGroup } from "./tool-view-model";

const tool = (
  overrides: Partial<AgentToolActivity>
): AgentToolActivity => ({
  id: "tool-1",
  name: "tool_fs_run",
  label: "Run tool",
  status: "completed",
  input: {},
  output: {},
  startedAt: "2026-06-05T00:00:01.000Z",
  finishedAt: "2026-06-05T00:00:02.000Z",
  ...overrides
});

describe("agent tool family projection", () => {
  test("keeps tools waiting for user action visibly suspended", () => {
    const group = toToolGroup([tool({ status: "suspended_user_action" })]);

    expect(group).toMatchObject({
      status: "suspended",
      currentCallId: "tool-1",
      calls: [{ id: "tool-1", status: "suspended" }]
    });
  });

  test("projects Lumen structured map output", () => {
    const call = toToolCall(tool({
      toolPath: "/tools/browser/map",
      domain: "browser",
      operation: "map",
      input: { action: "map", target: "live" },
      output: {
        raw: {
          url: "https://example.com/docs",
          elements: [{ id: "12", role: "button", label: "Continue" }]
        }
      }
    }));

    expect(call.kind).toBe("web");
    const details = call.details;
    expect(details?.type).toBe("lumen");
    if (details?.type !== "lumen") return;
    expect(details.action).toBe("map");
    expect(details.targetMode).toBe("live");
  });

  test("projects Workbench and Software capability output", () => {
    const workbench = toToolCall(tool({
      toolPath: "/tools/workbench/list_tabs",
      domain: "workbench",
      operation: "list_tabs",
      input: { action: "list_tabs" },
      output: {
        raw: {
          tabs: [{ tabId: "tab-1", title: "README", kind: "editor" }]
        }
      }
    }));
    const software = toToolCall(tool({
      toolPath: "/tools/software/invoke",
      domain: "software",
      operation: "invoke",
      input: {
        action: "invoke_capability",
        softwareId: "terminal",
        actionId: "terminal.write"
      },
      output: { raw: { softwareId: "terminal", actionId: "terminal.write" } }
    }));

    expect(workbench.details?.type).toBe("workbench");
    expect(software.details).toMatchObject({
      type: "software",
      softwareId: "terminal",
      actionId: "terminal.write"
    });
  });

  test("projects Terminal screen details", () => {
    const terminal = toToolCall(tool({
      toolPath: "/tools/terminal/read",
      domain: "terminal",
      operation: "read",
      input: { action: "read" },
      output: {
        raw: {
          target: { type: "ui" },
          running: true,
          screen: { visibleText: "pnpm test", rows: [] }
        }
      }
    }));

    expect(terminal.details).toMatchObject({
      type: "terminal",
      target: "ui",
      running: true
    });
  });

  test("keeps generic shell fallback in the dispatcher", () => {
    const call = toToolCall(tool({
      toolPath: "/tools/shell/run_command",
      domain: "shell",
      operation: "run",
      input: { command: "pwd" },
      output: { raw: { command: "pwd", exitCode: 0 }, content: "/tmp" }
    }));

    expect(call.kind).toBe("shell");
    expect(call.details).toEqual({
      type: "shell",
      command: "pwd",
      output: "/tmp",
      exitCode: 0
    });
  });

  test("shell dump uses stdout instead of the model content blob", () => {
    const call = toToolCall(tool({
      toolPath: "/tools/shell/run_command",
      domain: "shell",
      operation: "run",
      input: { command: "pwd" },
      artifactRefs: [{
        id: "stdout-1",
        kind: "stdout",
        path: "/tmp/lyra/stdout-1.log",
        preview: "/tmp"
      }],
      output: {
        content: "command: pwd\ncwd: /tmp\n\nstdout:\n/tmp\n\nstderr:\n",
        raw: {
          command: "pwd",
          exitCode: 0,
          stdout: "/tmp",
          stderr: ""
        }
      }
    }));

    expect(call.details).toEqual({
      type: "shell",
      command: "pwd",
      output: "/tmp",
      exitCode: 0
    });
    expect(call.artifactPreviews).toBeUndefined();
  });

  test("terminal dump prefers screen text over the model content blob", () => {
    const call = toToolCall(tool({
      toolPath: "/tools/terminal/read",
      domain: "terminal",
      operation: "read",
      input: { action: "read", command: "pnpm test" },
      output: {
        content: "ui terminal session-1: running=false exitCode=0\npnpm test\nFAIL",
        raw: {
          command: "pnpm test",
          exitCode: 0,
          running: false,
          screen: { visibleText: "pnpm test\nFAIL" }
        }
      }
    }));

    expect(call.details).toMatchObject({
      type: "terminal",
      command: "pnpm test",
      output: "pnpm test\nFAIL"
    });
  });

  test("projects native todo tools with task titles", () => {
    const call = toToolCall(tool({
      name: "todo",
      label: "Used Lyra tool",
      input: { action: "update", id: "todo-1", status: "in_progress" },
      output: { content: "Updated todo." }
    }));

    expect(call.kind).toBe("task");
    expect(call.title).toBe("Update todo");
  });

  test("hides ToolSearch activity from the tool group", () => {
    const group = toToolGroup([
      tool({
        name: "ToolSearch",
        label: "",
        input: { query: "select:web_search" },
        output: { content: "Loaded deferred tools: web_search." }
      })
    ]);
    expect(group).toBeNull();
  });

  test("projects legacy named browser and shell tools", () => {
    const lumen = toToolCall(tool({
      name: "lyra_lumen",
      label: "Ran",
      input: { action: "map", target: "isolated" },
      output: { content: "Observation" }
    }));
    const shell = toToolCall(tool({
      name: "shell",
      label: "Ran",
      input: { command: "pwd" },
      output: { content: "/tmp" }
    }));

    expect(lumen.kind).toBe("web");
    expect(lumen.title).toBe("Mapped browser elements");
    expect(lumen.details?.type).toBe("lumen");
    expect(shell.kind).toBe("shell");
    expect(shell.title).toBe("shell");
    expect(shell.details).toMatchObject({
      type: "shell",
      command: "pwd",
      output: "/tmp"
    });
  });

  test("projects legacy web search and Workbench text output", () => {
    const webSearch = toToolCall(tool({
      name: "websearch",
      label: "Web search",
      input: { query: "Lyra release" },
      output: {
        content: [
          "Search results for: Lyra release",
          "",
          "1. **Lyra Docs**",
          "   https://example.com/lyra",
          "   Documentation excerpt."
        ].join("\n")
      }
    }));
    const workbench = toToolCall(tool({
      name: "workbench",
      label: "Ran",
      input: { action: "list_tabs" },
      output: {
        content: "- Docs [browser-tab-1] page (page) flags=active,visible | https://example.com/docs"
      }
    }));

    expect(webSearch.kind).toBe("web");
    expect(webSearch.details).toMatchObject({
      type: "web",
      query: "Lyra release",
      results: [{
        title: "Lyra Docs",
        url: "https://example.com/lyra",
        snippet: "Documentation excerpt."
      }]
    });
    expect(workbench.kind).toBe("workbench");
    expect(workbench.details).toMatchObject({
      type: "workbench",
      tabs: [{
        title: "Docs",
        tabId: "browser-tab-1",
        kind: "page",
        observationKind: "page",
        flags: ["active", "visible"],
        url: "https://example.com/docs"
      }]
    });
  });

  test("projects direct apply_patch output into edit diff details", () => {
    const call = toToolCall(tool({
      name: "apply_patch",
      label: "Apply patch",
      rendererHint: "edit",
      status: "running",
      output: {
        raw: {
          changedFiles: [{ path: "src/main.ts" }],
          diff: [
            "--- src/main.ts",
            "+++ src/main.ts",
            "@@ -1 +1,2 @@",
            "-old",
            "+new",
            "+line"
          ].join("\n")
        }
      }
    }));

    expect(call.kind).toBe("edit");
    expect(call.details).toMatchObject({
      type: "edit",
      file: "src/main.ts",
      additions: 2,
      deletions: 1
    });

    if (call.details?.type !== "edit") return;
    expect(call.details.hunks[0]?.lines.some((line) => line.kind === "add")).toBe(true);
  });

  test("projects plan tools into plan cards", () => {
    const call = toToolCall(tool({
      id: "plan-tool-1",
      name: "plan_write",
      label: "Writing plan",
      activityKind: "plan",
      rendererHint: "plan",
      input: { action: "write" },
      output: {
        raw: {
          markdown: "# Plan\n\n- Build runtime support",
          phase: "planning"
        }
      }
    }));

    expect(call.kind).toBe("plan");
    expect(call.title).toBe("Writing plan");
    expect(call.details).toEqual({
      type: "text",
      body: "# Plan\n\n- Build runtime support"
    });
  });

  test("projects native file write content diff into edit details", () => {
    const call = toToolCall(tool({
      name: "file",
      label: "Wrote file",
      operation: "write",
      output: {
        content: [
          "Wrote 测试/column-site/index.html",
          "--- 测试/column-site/index.html",
          "+++ 测试/column-site/index.html",
          "@@ -0,0 +1 @@",
          "+<!DOCTYPE html>"
        ].join("\n")
      }
    }));

    expect(call.kind).toBe("edit");
    expect(call.details).toMatchObject({
      type: "edit",
      file: "测试/column-site/index.html",
      additions: 1,
      deletions: 0
    });
  });

  test("projects write_file output into edit diff details", () => {
    const call = toToolCall(tool({
      name: "write_file",
      label: "Write file",
      status: "completed",
      output: {
        raw: {
          changedFiles: [{ path: "index.html" }],
          diff: ["--- index.html", "+++ index.html", "@@ -0,0 +1 @@", "+<!DOCTYPE html>"].join("\n")
        }
      }
    }));
    expect(call.kind).toBe("edit");
    expect(call.details?.type).toBe("edit");
  });

  test("uses structured edit stats when final diff is artifacted", () => {
    const call = toToolCall(tool({
      name: "write_file",
      label: "Write file",
      status: "completed",
      output: {
        raw: {
          kind: "tool_raw_ref",
          changedFiles: [{
            path: "column-site/index.html",
            additions: 715,
            deletions: 0
          }],
          diffArtifactRef: { artifactId: "diff-1" }
        }
      }
    }));

    expect(call.kind).toBe("edit");
    expect(call.details).toMatchObject({
      type: "edit",
      file: "column-site/index.html",
      additions: 715,
      deletions: 0
    });
  });

  test("classifies a streaming edit_file preview activity as an edit", () => {
    // Preview activities arrive under /tools/runtime/edit_file with no domain.
    const call = toToolCall(tool({
      name: "edit_file",
      label: "Edit file",
      status: "running",
      input: { path: "/tools/runtime/edit_file", args: { path: "a.ts" } },
      output: {
        raw: {
          changedFiles: [{ path: "a.ts" }],
          diff: ["--- a.ts", "+++ a.ts", "@@ -1 +1 @@", "-let x = 1;", "+let x = 2;"].join("\n"),
          preview: true
        }
      }
    }));
    expect(call.kind).toBe("edit");
    expect(call.details?.type).toBe("edit");
  });

  test("does not attach the same unified diff as a second artifact dump", () => {
    const diff = ["--- a.ts", "+++ a.ts", "@@ -1 +1 @@", "-let x = 1;", "+let x = 2;"].join("\n");
    const call = toToolCall(tool({
      name: "write_file",
      label: "Wrote file",
      status: "completed",
      output: {
        raw: {
          changedFiles: [{ path: "a.ts" }],
          diff
        }
      },
      changes: [{
        diffRef: {
          id: "artifact-chatcmpl-diff",
          path: "/tmp/artifacts/artifact-chatcmpl-diff",
          preview: diff
        }
      }]
    }));
    expect(call.details?.type).toBe("edit");
    expect(call.artifactPreviews).toBeUndefined();
    expect(call.artifactTargets).toBeUndefined();
  });

  test("paints command result failures yellow and Lyra tool failures red", () => {
    const command = toToolCall(tool({
      status: "failed",
      output: {
        content: "cargo test failed",
        error: { code: "command_failed", message: "Command exited with status 1." },
        raw: { ok: false, exitCode: 1 }
      }
    }));
    const reported = toToolCall(tool({
      status: "failed",
      output: {
        content: "Native tool reported an unsuccessful result.",
        error: { code: "tool_reported_failure", message: "Native tool reported an unsuccessful result." }
      }
    }));
    const lyra = toToolCall(tool({
      status: "failed",
      output: {
        content: "Lyra tool failed: Tool Filesystem target was not found: /tools/browser/click",
        error: { code: "tool_target_required", message: "Tool Filesystem target was not found: /tools/browser/click" }
      }
    }));

    expect(command.status).toBe("warning");
    expect(reported.status).toBe("warning");
    expect(lyra.status).toBe("error");
  });

  test("does not paint the literal null string for a running Agent tool", () => {
    const call = toToolCall(tool({
      name: "agent",
      label: "Agent",
      status: "running",
      input: { description: "Explore docs", prompt: "Look around." },
      output: null
    }));

    expect(call.title).toBe("Explore docs");
    expect(call.details).toMatchObject({ type: "text", body: "" });
    expect(JSON.stringify(call.details)).not.toContain("null");
  });

  test("exposes subagentId from running Agent tool output", () => {
    const call = toToolCall(tool({
      name: "agent",
      label: "Agent",
      status: "running",
      input: { description: "Explore docs", prompt: "Look around." },
      output: {
        content: "",
        raw: { subagentId: "worker-1", status: "running" }
      }
    }));

    expect(call.subagentId).toBe("worker-1");
    expect(call.title).toBe("Explore docs");
  });

  test("stops shimmer when the turn is idle unless a live background agent remains", () => {
    const idle = { turnStatus: "idle" as const };
    const web = toToolGroup([tool({
      name: "web_search",
      label: "Searched web",
      status: "running"
    })], "web", idle);
    const shell = toToolGroup([tool({
      name: "shell",
      label: "Ran shell",
      status: "running"
    })], "shell", idle);
    const failed = toToolGroup([tool({
      name: "web_research",
      label: "Web research",
      status: "failed",
      output: { content: "Lyra tool failed: blocked", error: { code: "search_blocked" } }
    })], "failed", idle);
    const cancelledTurn = toToolGroup([tool({
      name: "web_fetch",
      label: "Fetched",
      status: "running"
    })], "cancelled", { turnStatus: "cancelled" });
    const liveAgent = toToolGroup([tool({
      name: "agent",
      label: "Agent",
      status: "running",
      output: {
        raw: { subagentId: "child-live", background: true }
      }
    })], "live-agent", {
      turnStatus: "idle",
      subagents: [{ id: "child-live", description: "news", type: "generalPurpose", origin: "spawn", status: "running" }]
    });
    const deadAgent = toToolGroup([tool({
      name: "agent",
      label: "Agent",
      status: "running",
      output: {
        raw: { subagentId: "child-dead", background: true }
      }
    })], "dead-agent", {
      turnStatus: "idle",
      subagents: [{ id: "child-dead", description: "news", type: "generalPurpose", origin: "spawn", status: "interrupted" }]
    });

    expect(web?.status).toBe("done");
    expect(shell?.status).toBe("done");
    expect(failed?.status).toBe("done");
    expect(cancelledTurn?.status).toBe("done");
    expect(liveAgent?.status).toBe("running");
    expect(deadAgent?.status).toBe("done");
    expect(web?.calls[0]?.status).not.toBe("running");
    expect(deadAgent?.calls[0]?.status).not.toBe("running");
  });

  test("uses the spawn description instead of the Agent catalog title", () => {
    const fromInput = toToolCall(tool({
      name: "Agent",
      label: "Agent",
      manifestTitle: "Spawn a worker agent",
      input: { description: "调查 ZCode 主题系统", prompt: "Look around." }
    }));
    const fromFinishedLabel = toToolCall(tool({
      name: "Agent",
      label: "调查 ZCode 主题系统",
      manifestTitle: "Spawn a worker agent",
      input: { turnId: "turn-1" },
      output: {
        content: "Started 调查 ZCode 主题系统 (explore) in the background. subagent_id=session-1",
        raw: { subagentId: "session-1", background: true }
      }
    }));
    const fromChild = toToolCall(tool({
      name: "Agent",
      label: "Agent",
      input: { turnId: "turn-1" },
      output: { raw: { subagentId: "child-1" } }
    }), {
      subagents: [{
        id: "child-1",
        description: "Explore docs",
        type: "explore",
        origin: "spawn",
        status: "running"
      }]
    });

    expect(fromInput.title).toBe("调查 ZCode 主题系统");
    expect(fromFinishedLabel.title).toBe("调查 ZCode 主题系统");
    expect(fromChild.title).toBe("Explore docs");
  });

  test("counts spawn calls on the tool group label", () => {
    const group = toToolGroup([
      tool({
        id: "agent-1",
        name: "Agent",
        label: "Agent",
        input: { description: "Explore theme", prompt: "Look around." },
        output: { raw: { subagentId: "child-1" } }
      }),
      tool({
        id: "agent-2",
        name: "Agent",
        label: "Agent",
        input: { description: "Inspect runtime", prompt: "Look around." },
        output: { raw: { subagentId: "child-2" } }
      }),
      tool({
        id: "read-1",
        name: "file",
        label: "Read file",
        operation: "read",
        input: { path: "src/main.rs" },
        output: { content: "fn main() {}" }
      })
    ]);

    expect(group?.label).toBe("1 read, 2 agents");
    expect(group?.calls.map((call) => call.title)).toEqual([
      "Explore theme",
      "Inspect runtime",
      "Read file"
    ]);
  });

  test("summarizes mixed tools on the group label", () => {
    const group = toToolGroup([
      tool({
        id: "read-1",
        name: "file",
        label: "Read file",
        operation: "read",
        input: { path: "a.ts" },
        output: { content: "a" }
      }),
      tool({
        id: "read-2",
        name: "file",
        label: "Read file",
        operation: "read",
        input: { path: "b.ts" },
        output: { content: "b" }
      }),
      tool({
        id: "shell-1",
        name: "shell",
        label: "Ran",
        input: { command: "pwd" },
        output: { content: "/tmp" }
      })
    ]);

    expect(group?.label).toBe("2 reads, 1 command");
  });

  test("projects clarification as an ask card", () => {
    const call = toToolCall(tool({
      name: "clarification",
      label: "Asked for clarification",
      input: { question: "Which style?" },
      output: { content: "User answered clarification: dark", answer: "dark" }
    }));

    expect(call.details).toEqual({
      type: "ask",
      question: "Which style?",
      answer: "dark"
    });
  });

  test("uses the project file path instead of the Tool-FS catalog path", () => {
    const call = toToolCall(tool({
      name: "file",
      label: "Read file",
      operation: "read",
      toolPath: "/tools/filesystem/read_file",
      input: { path: "/tools/filesystem/read_file", args: { path: "apps/desktop/src/theme/semantic.ts" } },
      output: {
        content: "export {}",
        raw: { path: "apps/desktop/src/theme/semantic.ts" }
      }
    }));

    expect(call.details).toMatchObject({
      type: "read",
      file: "apps/desktop/src/theme/semantic.ts"
    });
  });
});
