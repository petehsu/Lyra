import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { FileEditorModel } from "../../file-editor";
import {
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../../shell/titlebar-context";
import type { AgentProjectTreeAppState, AgentProjectTreeLabels } from "../types";
import { useAgentProjectTreeModel } from "../service";
import { AgentProjectTreeSurface } from "../view";

const labels: AgentProjectTreeLabels = {
  title: "Project Tree",
  open: "Open Project Tree",
  openSourceControl: "Open Source Control",
  refresh: "Refresh tree",
  loading: "Loading...",
  emptyDirectory: "Empty directory",
  unavailable: "File system API unavailable",
  selectFileTitle: "Select a file",
  selectFileDescription: "Choose a file"
};

const fileEditorLabels = {
  loading: "Loading",
  unsupported: "Unsupported",
  unavailable: "Unavailable",
  readOnly: "Read only",
  conflict: "Conflict",
  retry: "Retry",
  save: "Save",
  openDiff: "Open diff",
  closeDiff: "Close diff"
};

const createState = (overrides: Partial<AgentProjectTreeAppState> = {}): AgentProjectTreeAppState => ({
  instanceId: "agent-project-tree-session-1",
  agentSessionId: "session-1",
  rootPath: "/Users/petehsu/Documents/Lyra",
  title: "Lyra",
  selectedFilePath: null,
  editorInstanceId: null,
  expandedPaths: ["/Users/petehsu/Documents/Lyra"],
  ...overrides
});

const createFileEditorModel = (): FileEditorModel => ({
  createInstance: vi.fn(),
  findInstanceByPath: vi.fn(() => null),
  getState: vi.fn(() => null),
  ensureInstance: vi.fn(),
  syncExternalInstances: vi.fn(),
  syncTabInstances: vi.fn(),
  openFile: vi.fn().mockResolvedValue(undefined),
  hydrateIfNeeded: vi.fn().mockResolvedValue(undefined),
  touchInstance: vi.fn(),
  revealLocation: vi.fn(),
  clearRevealLocation: vi.fn(),
  setContent: vi.fn(),
  applyExternalContent: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  statFile: vi.fn().mockResolvedValue(null),
  requestCompletion: vi.fn().mockResolvedValue([])
});

const createDesktopApi = () => {
  const readDirectory = vi.fn(async () => ({
    location: {
      id: "root",
      title: "Lyra",
      kind: "directory" as const,
      path: "/Users/petehsu/Documents/Lyra"
    },
    entries: [
      {
        id: "src",
        name: "src",
        path: "/Users/petehsu/Documents/Lyra/src",
        kind: "directory" as const,
        isHidden: false,
        folderState: "non-empty" as const
      },
      {
        id: "package",
        name: "package.json",
        path: "/Users/petehsu/Documents/Lyra/package.json",
        kind: "file" as const,
        extension: "json",
        isHidden: false
      }
    ]
  }));
  return {
    api: {
      files: { readDirectory }
    } as unknown as LyraDesktopApi,
    readDirectory
  };
};

describe("AgentProjectTreeSurface", () => {
  test("loads the bound project root and opens files through the embedded editor model", async () => {
    const { api, readDirectory } = createDesktopApi();
    const onOpenGitPanel = vi.fn();
    const model = {
      getState: vi.fn(() => createState()),
      ensureInstance: vi.fn(),
      syncTabInstances: vi.fn(),
      openFile: vi.fn().mockResolvedValue(undefined),
      toggleDirectory: vi.fn(),
      updateRoot: vi.fn()
    };
    const { container } = render(
      <WorkbenchTitlebarContextProvider activeScopeId="agent-project-tree-scope">
        <WorkbenchTitlebarScopeProvider scopeId="agent-project-tree-scope">
          <AgentProjectTreeSurface
            desktopApi={api}
            labels={labels}
            state={createState()}
            model={model}
            fileEditorModel={createFileEditorModel()}
            fileEditorLabels={fileEditorLabels}
            themeSignature="test"
            onOpenGitPanel={onOpenGitPanel}
          />
        </WorkbenchTitlebarScopeProvider>
        <WorkbenchTitlebarContextSlot />
      </WorkbenchTitlebarContextProvider>
    );

    expect(screen.getByRole("button", { name: "Refresh tree" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Source Control" }));
    expect(onOpenGitPanel).toHaveBeenCalledWith({
      sessionId: "session-1",
      workingDir: "/Users/petehsu/Documents/Lyra"
    });
    expect(container.querySelectorAll(".lyra-agent-project-tree-root-row")).toHaveLength(1);
    expect(container.querySelector(".lyra-agent-project-tree-root-refresh")).toBeNull();
    expect(container.querySelector(".lyra-agent-project-tree-header")).toBeNull();
    expect(await screen.findByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(readDirectory).toHaveBeenCalledWith({ path: "/Users/petehsu/Documents/Lyra" });

    fireEvent.click(screen.getByRole("button", { name: /package\.json/u }));
    await waitFor(() => {
      expect(model.openFile).toHaveBeenCalledWith(
        "agent-project-tree-session-1",
        "/Users/petehsu/Documents/Lyra/package.json"
      );
    });
  });

  test("does not expose project rebinding inside the session project tree", async () => {
    const { api } = createDesktopApi();
    const model = {
      getState: vi.fn(() => createState()),
      ensureInstance: vi.fn(),
      syncTabInstances: vi.fn(),
      openFile: vi.fn().mockResolvedValue(undefined),
      toggleDirectory: vi.fn(),
      updateRoot: vi.fn()
    };
    render(
      <AgentProjectTreeSurface
        desktopApi={api}
        labels={labels}
        state={createState()}
        model={model}
        fileEditorModel={createFileEditorModel()}
        fileEditorLabels={fileEditorLabels}
        themeSignature="test"
      />
    );

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change bound project" })).not.toBeInTheDocument();
    expect(model.updateRoot).not.toHaveBeenCalled();
  });
});

describe("useAgentProjectTreeModel", () => {
  test("keeps embedded file editor instances outside normal file-editor tabs", async () => {
    const fileEditorModel = createFileEditorModel();
    const onMetaChange = vi.fn();
    const { result } = renderHook(() =>
      useAgentProjectTreeModel({ fileEditorModel, onMetaChange })
    );

    act(() => {
      result.current.ensureInstance("tree-1", {
        agentSessionId: "session-1",
        rootPath: "/project",
        title: "project"
      });
    });

    await act(async () => {
      await result.current.openFile("tree-1", "/project/package.json");
    });

    expect(fileEditorModel.ensureInstance).toHaveBeenCalledWith(
      "agent-project-tree-editor-tree-1",
      {
        filePath: "/project/package.json",
        fileSessionId: "agent-project-tree:session-1"
      }
    );
    expect(fileEditorModel.openFile).toHaveBeenCalledWith(
      "agent-project-tree-editor-tree-1",
      "/project/package.json"
    );
    expect(fileEditorModel.syncExternalInstances).toHaveBeenLastCalledWith([
      "agent-project-tree-editor-tree-1"
    ]);

    act(() => {
      result.current.syncTabInstances([]);
    });
    expect(fileEditorModel.syncExternalInstances).toHaveBeenLastCalledWith([]);
  });
});
