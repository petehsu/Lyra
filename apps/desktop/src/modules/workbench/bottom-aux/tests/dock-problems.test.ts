import { afterEach, describe, expect, test } from "vitest";

import {
  clearDockProblemsSelection,
  closeDockProblemsTab,
  dockProblemsTabId,
  getDockProblemsState,
  openDockProblemsTab,
  resetDockProblemsState,
  selectDockProblemsTab
} from "../dock-problems";
import {
  applyWorkspaceDiagnostics,
  collectBoundProjectRoots,
  filterDiagnosticsForRoot,
  flattenProblemsRows,
  getWorkspaceProblemsSnapshot,
  groupDiagnosticsByFile,
  diagnosticsSignature,
  isPathInsideRoot,
  resetWorkspaceProblemsStore,
  workspaceHasProblemsForRoot
} from "../problems";
import type { LspDiagnostic } from "../../../../shared/desktop-bridge";

afterEach(() => {
  resetDockProblemsState();
  resetWorkspaceProblemsStore();
});

const diagnostic = (filePath: string): LspDiagnostic => ({
  filePath,
  severity: 1,
  message: "err",
  startLine: 0,
  startCharacter: 0,
  endLine: 0,
  endCharacter: 1
});

describe("dock problems tabs", () => {
  test("opens one tab per project tree and focuses an existing tab on re-open", () => {
    openDockProblemsTab({
      instanceId: "tree-a",
      title: "Lyra",
      rootPath: "/work/Lyra"
    });
    openDockProblemsTab({
      instanceId: "tree-b",
      title: "Other",
      rootPath: "/work/Other"
    });
    expect(getDockProblemsState().tabs.map((tab) => tab.id)).toEqual([
      dockProblemsTabId("tree-a"),
      dockProblemsTabId("tree-b")
    ]);
    expect(getDockProblemsState().activeId).toBe(dockProblemsTabId("tree-b"));

    openDockProblemsTab({
      instanceId: "tree-a",
      title: "Lyra",
      rootPath: "/work/Lyra"
    });
    expect(getDockProblemsState().tabs).toHaveLength(2);
    expect(getDockProblemsState().activeId).toBe(dockProblemsTabId("tree-a"));
  });

  test("closing the active tab reveals the remaining project tab", () => {
    openDockProblemsTab({
      instanceId: "tree-a",
      title: "Lyra",
      rootPath: "/work/Lyra"
    });
    openDockProblemsTab({
      instanceId: "tree-b",
      title: "Other",
      rootPath: "/work/Other"
    });
    closeDockProblemsTab(dockProblemsTabId("tree-b"));
    expect(getDockProblemsState().activeId).toBe(dockProblemsTabId("tree-a"));
    closeDockProblemsTab(dockProblemsTabId("tree-a"));
    expect(getDockProblemsState()).toEqual({ tabs: [], activeId: null });
  });

  test("selecting a terminal clears the problems selection without dropping tabs", () => {
    openDockProblemsTab({
      instanceId: "tree-a",
      title: "Lyra",
      rootPath: "/work/Lyra"
    });
    clearDockProblemsSelection();
    expect(getDockProblemsState().activeId).toBeNull();
    expect(getDockProblemsState().tabs).toHaveLength(1);
    selectDockProblemsTab(dockProblemsTabId("tree-a"));
    expect(getDockProblemsState().activeId).toBe(dockProblemsTabId("tree-a"));
  });
});

describe("groupDiagnosticsByFile", () => {
  test("groups by file and keeps the directory label under the workspace root", () => {
    const groups = groupDiagnosticsByFile(
      [
        diagnostic("/work/Lyra/apps/desktop/tsconfig.json"),
        {
          ...diagnostic("/work/Lyra/apps/desktop/tsconfig.json"),
          startLine: 12,
          message: "baseUrl"
        },
        diagnostic("/work/Lyra/src/a.ts")
      ],
      "/work/Lyra"
    );
    expect(groups).toEqual([
      {
        filePath: "/work/Lyra/apps/desktop/tsconfig.json",
        fileName: "tsconfig.json",
        directoryLabel: "apps/desktop",
        items: [
          diagnostic("/work/Lyra/apps/desktop/tsconfig.json"),
          {
            ...diagnostic("/work/Lyra/apps/desktop/tsconfig.json"),
            startLine: 12,
            message: "baseUrl"
          }
        ]
      },
      {
        filePath: "/work/Lyra/src/a.ts",
        fileName: "a.ts",
        directoryLabel: "src",
        items: [diagnostic("/work/Lyra/src/a.ts")]
      }
    ]);
    expect(diagnosticsSignature(
      "/work/Lyra/src/a.ts",
      [diagnostic("/work/Lyra/src/a.ts")]
    )).not.toBe(diagnosticsSignature("/work/Lyra/src/a.ts", []));
  });
});

describe("flattenProblemsRows", () => {
  test("keeps file headers and skips collapsed item rows", () => {
    const groups = groupDiagnosticsByFile(
      [diagnostic("/work/Lyra/src/a.ts"), diagnostic("/work/Lyra/src/b.ts")],
      "/work/Lyra"
    );
    const expanded = flattenProblemsRows(groups, new Set());
    expect(expanded.map((row) => row.kind)).toEqual(["file", "item", "file", "item"]);
    const collapsed = flattenProblemsRows(groups, new Set(["/work/Lyra/src/a.ts"]));
    expect(collapsed.map((row) => row.kind)).toEqual(["file", "file", "item"]);
  });
});

describe("filterDiagnosticsForRoot", () => {
  test("keeps only diagnostics under that project root", () => {
    const items = [
      diagnostic("/work/Lyra/src/a.ts"),
      diagnostic("/work/Lyra-extra/src/b.ts"),
      diagnostic("/work/Other/src/c.ts")
    ];
    expect(filterDiagnosticsForRoot(items, "/work/Lyra").map((item) => item.filePath)).toEqual([
      "/work/Lyra/src/a.ts"
    ]);
    expect(isPathInsideRoot("/work/Lyra-extra/src/b.ts", "/work/Lyra")).toBe(false);
  });
});

describe("collectBoundProjectRoots", () => {
  test("uses bound sessions and project-tree tabs, skipping home and drafts", () => {
    expect(collectBoundProjectRoots(
      [
        { workingDir: "/work/Lyra", projectBound: true, workingDirIsHome: false },
        { workingDir: "/home/user", projectBound: true, workingDirIsHome: true },
        { projectBound: false, workingDirIsHome: false },
        { workingDir: "/work/Lyra/", projectBound: true, workingDirIsHome: false }
      ],
      [
        { pageKind: "app", appId: "agent-project-tree", filePath: "/work/Other" },
        { pageKind: "app", appId: "file-editor", filePath: "/work/Lyra/src/a.ts" }
      ]
    )).toEqual(["/work/Lyra", "/work/Other"]);
  });
});

describe("workspace problems store", () => {
  test("keeps diagnostics after the first listener is gone", () => {
    applyWorkspaceDiagnostics("/work/Lyra/tsconfig.json", [diagnostic("/work/Lyra/tsconfig.json")]);
    expect(getWorkspaceProblemsSnapshot()).toHaveLength(1);
    expect(workspaceHasProblemsForRoot("/work/Lyra")).toBe(true);
    expect(workspaceHasProblemsForRoot("/work/Other")).toBe(false);
    resetWorkspaceProblemsStore();
    expect(getWorkspaceProblemsSnapshot()).toHaveLength(0);
  });
});
