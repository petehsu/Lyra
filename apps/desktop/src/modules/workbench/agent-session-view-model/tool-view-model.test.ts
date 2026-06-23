import { describe, expect, test } from "vitest";

import type { AgentToolActivity } from "../../../shared/agent";
import { toToolCall } from "./tool-view-model";

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

  test("projects Terminal screen and Render table details", () => {
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
    const render = toToolCall(tool({
      toolPath: "/tools/render/create",
      domain: "render",
      operation: "create",
      input: {
        kind: "table",
        title: "Results",
        columns: ["name"],
        rows: [{ name: "Lyra" }]
      },
      output: { raw: { format: "table", surfaceId: "surface-1" } }
    }));

    expect(terminal.details).toMatchObject({
      type: "terminal",
      target: "ui",
      running: true
    });
    expect(render.details).toMatchObject({
      type: "render",
      format: "table",
      surfaceId: "surface-1",
      title: "Results"
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
});
