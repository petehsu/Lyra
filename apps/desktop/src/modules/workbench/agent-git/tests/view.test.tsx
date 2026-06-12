import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentGitStatusSnapshot,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import {
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../../shell/titlebar-context";
import type { AgentGitLabels } from "../types";
import { AgentGitSurface } from "../view";

const labels: AgentGitLabels = {
  title: "Source Control",
  open: "Open Source Control",
  refresh: "Refresh Git status",
  loading: "Loading...",
  notRepositoryTitle: "Not a Git repository",
  notRepositoryDescription: "No Git repository was found.",
  emptyTitle: "No changes",
  emptyDescription: "The working tree is clean.",
  changes: "changes",
  staged: "staged",
  unstaged: "unstaged",
  untracked: "untracked",
  conflicts: "conflicts",
  stage: "Stage",
  unstage: "Unstage",
  discard: "Discard changes",
  discardConfirm: "Discard {path}?",
  selectFileTitle: "Select a changed file",
  selectFileDescription: "Pick a file to preview its diff.",
  binaryDiff: "Binary diff unavailable",
  noDiff: "No diff",
  unavailable: "Agent Git API unavailable."
};

const statusSnapshot: AgentGitStatusSnapshot = {
  workingDir: "/project",
  isRepository: true,
  repositoryRoot: "/project",
  branch: "main",
  upstream: "origin/main",
  ahead: 1,
  behind: 2,
  summary: {
    changed: 2,
    staged: 1,
    unstaged: 1,
    untracked: 0,
    conflicts: 0
  },
  entries: [
    {
      path: "src/app.ts",
      absolutePath: "/project/src/app.ts",
      originalPath: null,
      status: "modified",
      indexStatus: " ",
      workingTreeStatus: "M",
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false
    },
    {
      path: "README.md",
      absolutePath: "/project/README.md",
      originalPath: null,
      status: "modified",
      indexStatus: "M",
      workingTreeStatus: " ",
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false
    }
  ],
  updatedAt: "2026-05-17T00:00:00.000Z",
  message: null
};

const emptyStatusSnapshot: AgentGitStatusSnapshot = {
  ...statusSnapshot,
  summary: {
    changed: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0
  },
  entries: []
};

const createDesktopApi = () => {
  const readGitStatus = vi.fn(async () => statusSnapshot);
  const readGitDiff = vi.fn(async () => ({
    workingDir: "/project",
    repositoryRoot: "/project",
    path: "src/app.ts",
    scope: "unstaged" as const,
    diff: "diff --git a/src/app.ts b/src/app.ts\n+const value = 1;\n",
    isBinary: false
  }));
  const stageGitFile = vi.fn(async () => ({
    snapshot: {
      ...statusSnapshot,
      summary: {
        changed: 1,
        staged: 1,
        unstaged: 0,
        untracked: 0,
        conflicts: 0
      },
      entries: [statusSnapshot.entries[1]]
    }
  }));
  const unstageGitFile = vi.fn(async () => ({
    snapshot: statusSnapshot
  }));
  const discardGitFile = vi.fn(async () => ({
    snapshot: emptyStatusSnapshot
  }));

  return {
    api: {
      agent: {
        readGitStatus,
        readGitDiff,
        stageGitFile,
        unstageGitFile,
        discardGitFile
      }
    } as unknown as LyraDesktopApi,
    readGitStatus,
    readGitDiff,
    stageGitFile,
    unstageGitFile,
    discardGitFile
  };
};

const renderGitSurface = (desktopApi: LyraDesktopApi) =>
  render(
    <WorkbenchTitlebarContextProvider activeScopeId="agent-git-scope">
      <WorkbenchTitlebarScopeProvider scopeId="agent-git-scope">
        <AgentGitSurface
          desktopApi={desktopApi}
          labels={labels}
          agentSessionId="session-1"
          rootPath="/project"
          title="Git: project"
        />
      </WorkbenchTitlebarScopeProvider>
      <WorkbenchTitlebarContextSlot />
    </WorkbenchTitlebarContextProvider>
  );

describe("AgentGitSurface", () => {
  test("loads Git status and previews the selected file diff", async () => {
    const { api, readGitStatus, readGitDiff } = createDesktopApi();
    renderGitSurface(api);

    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();
    expect(readGitStatus).toHaveBeenCalledWith({ workingDir: "/project" });

    fireEvent.click(screen.getByRole("button", { name: "src/app.ts" }));
    await waitFor(() => {
      expect(readGitDiff).toHaveBeenCalledWith({
        workingDir: "/project",
        path: "src/app.ts",
        scope: "unstaged"
      });
    });
    expect(await screen.findByText(/\+const value = 1;/u)).toBeInTheDocument();
  });

  test("stages, unstages, and discards through real agent Git APIs", async () => {
    const { api, stageGitFile, unstageGitFile, discardGitFile } = createDesktopApi();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGitSurface(api);

    await screen.findByText("src/app.ts");
    fireEvent.click(screen.getByRole("button", { name: "Stage: src/app.ts" }));
    await waitFor(() => {
      expect(stageGitFile).toHaveBeenCalledWith({
        workingDir: "/project",
        path: "src/app.ts"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Unstage: README.md" }));
    await waitFor(() => {
      expect(unstageGitFile).toHaveBeenCalledWith({
        workingDir: "/project",
        path: "README.md"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Discard changes: README.md" }));
    await waitFor(() => {
      expect(discardGitFile).toHaveBeenCalledWith({
        workingDir: "/project",
        path: "README.md"
      });
    });
    expect(confirm).toHaveBeenCalledWith("Discard README.md?");
    confirm.mockRestore();
  });
});
