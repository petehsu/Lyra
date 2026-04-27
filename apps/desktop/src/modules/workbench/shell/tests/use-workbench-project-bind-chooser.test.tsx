import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { FileManagerAppState, FileManagerModel } from "../../file-manager";
import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchProjectBindChooser } from "../use-workbench-project-bind-chooser";

const createTabsModel = () => {
  let tabs: readonly WorkspaceTab[] = [];
  const openAppTab = vi.fn((request: Parameters<WorkspaceTabsModel["openAppTab"]>[0]) => {
    tabs = [
      {
        id: `tab-${request.appInstanceId}`,
        title: request.title,
        pageKind: "app",
        inputValue: "",
        displayAddress: "",
        faviconUrl: undefined,
        query: undefined,
        appId: request.appId,
        appInstanceId: request.appInstanceId,
        appIconKey: request.iconKey
      }
    ];
  });
  const closeTab = vi.fn((tabId: string) => {
    tabs = tabs.filter((tab) => tab.id !== tabId);
  });

  const model = {
    get tabs() {
      return tabs;
    },
    openAppTab,
    closeTab
  } as unknown as WorkspaceTabsModel;

  return {
    model,
    openAppTab,
    closeTab,
    setTabs: (nextTabs: readonly WorkspaceTab[]) => {
      tabs = nextTabs;
    }
  };
};

const createFileManagerModel = () => {
  const stateByInstanceId = new Map<string, FileManagerAppState>();
  const model = {
    createInstance: vi.fn(() => ({
      appId: "file-manager",
      appInstanceId: "fm-1",
      title: "Files",
      iconKey: "file-manager-home"
    })),
    getState: vi.fn((instanceId: string) => stateByInstanceId.get(instanceId) ?? null),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    openHome: vi.fn().mockResolvedValue(undefined)
  } as unknown as FileManagerModel;

  return {
    model,
    stateByInstanceId
  };
};

describe("useWorkbenchProjectBindChooser", () => {
  test("opens a file-manager chooser and resolves the selected directory", async () => {
    const tabs = createTabsModel();
    const fileManager = createFileManagerModel();
    const { result } = renderHook(() =>
      useWorkbenchProjectBindChooser({
        fileManagerModel: fileManager.model,
        tabsModel: tabs.model,
        confirmLabel: "Bind"
      })
    );

    let bindPromise!: Promise<string | null>;
    act(() => {
      bindPromise = result.current.requestProjectBind(" /project ");
    });

    expect(tabs.openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "file-manager",
      appInstanceId: "fm-1"
    }));
    expect(fileManager.model.openDirectory).toHaveBeenCalledWith(
      "fm-1",
      "/project",
      false
    );

    await waitFor(() => {
      expect(result.current.resolveFileManagerChooser("fm-1")).not.toBeNull();
    });

    fileManager.stateByInstanceId.set("fm-1", {
      viewKind: "directory",
      currentLocation: {
        path: " /selected "
      }
    } as FileManagerAppState);

    act(() => {
      result.current.resolveFileManagerChooser("fm-1")?.onConfirm();
    });

    await expect(bindPromise).resolves.toBe("/selected");
    expect(tabs.closeTab).toHaveBeenCalledWith("tab-fm-1");
  });

  test("resolves null when the chooser tab is closed", async () => {
    const tabs = createTabsModel();
    const fileManager = createFileManagerModel();
    const { result, rerender } = renderHook(() =>
      useWorkbenchProjectBindChooser({
        fileManagerModel: fileManager.model,
        tabsModel: tabs.model,
        confirmLabel: "Bind"
      })
    );

    let bindPromise!: Promise<string | null>;
    act(() => {
      bindPromise = result.current.requestProjectBind();
    });
    await waitFor(() => {
      expect(result.current.resolveFileManagerChooser("fm-1")).not.toBeNull();
    });

    tabs.setTabs([]);
    rerender();

    await expect(bindPromise).resolves.toBeNull();
  });
});
