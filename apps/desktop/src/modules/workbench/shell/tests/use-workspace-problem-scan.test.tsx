import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetWorkspaceProblemsStore } from "../../bottom-aux/problems";
import { useWorkspaceProblemScan } from "../use-workspace-problem-scan";

afterEach(() => {
  resetWorkspaceProblemsStore();
});

describe("useWorkspaceProblemScan", () => {
  it("inspects bound project roots and open project trees once, skipping home", () => {
    const inspectProjectProblems = vi.fn(async () => undefined);
    const desktopApi = {
      lsp: {
        inspectProjectProblems,
        onEvent: () => () => undefined
      }
    };

    const { rerender } = renderHook(
      (props: {
        readonly workingDir: string;
        readonly projectBound: boolean;
        readonly workingDirIsHome: boolean;
        readonly treePath: string | undefined;
      }) =>
        useWorkspaceProblemScan({
          desktopApi: desktopApi as never,
          sessionTabs: [{
            tabId: "s1",
            sessionId: "session-1",
            title: "Session",
            lastKnownStatus: null,
            workingDir: props.workingDir,
            projectBound: props.projectBound,
            workingDirIsHome: props.workingDirIsHome
          }],
          workspaceTabs: props.treePath === undefined
            ? []
            : [{
              id: "tree-1",
              title: "Lyra",
              pageKind: "app",
              inputValue: "",
              displayAddress: "",
              faviconUrl: undefined,
              query: undefined,
              appId: "agent-project-tree",
              filePath: props.treePath
            }]
        }),
      {
        initialProps: {
          workingDir: "/work/Lyra",
          projectBound: true,
          workingDirIsHome: false,
          treePath: undefined as string | undefined
        }
      }
    );

    expect(inspectProjectProblems).toHaveBeenCalledTimes(1);
    expect(inspectProjectProblems).toHaveBeenCalledWith({ rootPath: "/work/Lyra" });

    rerender({
      workingDir: "/work/Lyra",
      projectBound: true,
      workingDirIsHome: false,
      treePath: undefined
    });
    expect(inspectProjectProblems).toHaveBeenCalledTimes(1);

    rerender({
      workingDir: "/home/user",
      projectBound: true,
      workingDirIsHome: true,
      treePath: "/work/Other"
    });
    expect(inspectProjectProblems).toHaveBeenCalledTimes(2);
    expect(inspectProjectProblems).toHaveBeenLastCalledWith({ rootPath: "/work/Other" });
  });
});
