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

const createDesktopApi = (snapshot: AgentGitStatusSnapshot = statusSnapshot) => {
  const readGitStatus = vi.fn(async () => snapshot);
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

    expect(await screen.findByText("app.ts")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(readGitStatus).toHaveBeenCalledWith({ workingDir: "/project" });
    await waitFor(() => {
      expect(document.querySelector(".lyra-titlebar-context")).toHaveTextContent("2 changes · 1 staged · 0 untracked");
    });
    expect(document.querySelector(".lyra-agent-git-summary")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "src/app.ts" }));
    await waitFor(() => {
      expect(readGitDiff).toHaveBeenCalledWith({
        workingDir: "/project",
        path: "src/app.ts",
        scope: "unstaged"
      });
    });
    await waitFor(() => {
      expect(screen.getByText("const value = 1;")).toBeTruthy();
    });
  });

  test("stages, unstages, and discards through real agent Git APIs", async () => {
    const { api, stageGitFile, unstageGitFile, discardGitFile } = createDesktopApi();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGitSurface(api);

    await screen.findByText("app.ts");
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

  test("shows the centered loading state until Git status arrives", async () => {
    let resolveStatus: (value: AgentGitStatusSnapshot) => void = () => undefined;
    const readGitStatus = vi.fn(
      () => new Promise<AgentGitStatusSnapshot>((resolve) => {
        resolveStatus = resolve;
      })
    );
    const api = {
      agent: {
        readGitStatus,
        readGitDiff: vi.fn(),
        stageGitFile: vi.fn(),
        unstageGitFile: vi.fn(),
        discardGitFile: vi.fn()
      }
    } as unknown as LyraDesktopApi;
    renderGitSurface(api);
    const loading = await screen.findByText("Loading...");
    expect(loading.closest(".lyra-app-state-loading")).not.toBeNull();
    expect(loading.closest(".lyra-agent-git-inline-state")).toBeNull();
    expect(loading.closest(".lyra-app-state-density-compact")).toBeNull();
    resolveStatus(statusSnapshot);
    expect(await screen.findByText("app.ts")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("windows a large change list instead of mounting every row", async () => {
    const entries = Array.from({ length: 200 }, (_, index) => ({
      path: `src/file-${String(index).padStart(3, "0")}.ts`,
      absolutePath: `/project/src/file-${String(index).padStart(3, "0")}.ts`,
      originalPath: null,
      status: "modified" as const,
      indexStatus: " ",
      workingTreeStatus: "M",
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false
    }));
    const { api } = createDesktopApi({
      ...statusSnapshot,
      summary: {
        ...statusSnapshot.summary,
        changed: entries.length,
        unstaged: entries.length
      },
      entries
    });
    renderGitSurface(api);
    expect(await screen.findByText("file-000.ts")).toBeInTheDocument();
    const mounted = document.querySelectorAll(".lyra-agent-git-row").length;
    expect(mounted).toBeGreaterThan(20);
    expect(mounted).toBeLessThan(200);
    expect(screen.queryByText("file-199.ts")).toBeNull();
  });
});
