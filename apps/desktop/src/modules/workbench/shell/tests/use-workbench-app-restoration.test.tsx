import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { FileEditorModel } from "../../file-editor";
import type { FileManagerModel } from "../../file-manager";
import type { ImageViewerModel } from "../../image-viewer";
import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchAppRestoration } from "../use-workbench-app-restoration";

const createTabsModel = (tabs: readonly WorkspaceTab[]): WorkspaceTabsModel => ({
  tabs
} as unknown as WorkspaceTabsModel);

const createImageViewerModel = (): ImageViewerModel => ({
  syncTabInstances: vi.fn(),
  getState: vi.fn(() => null),
  ensureInstance: vi.fn(),
  openImage: vi.fn().mockResolvedValue(undefined),
  touchInstance: vi.fn()
} as unknown as ImageViewerModel);

describe("useWorkbenchAppRestoration", () => {
  test("restores file manager tabs into model instances", async () => {
    const tab = {
      id: "tab-fm",
      title: "Files",
      pageKind: "app",
      appId: "file-manager",
      appInstanceId: "fm-1",
      filePath: "/tmp",
      inputValue: "",
      displayAddress: ""
    } as WorkspaceTab;
    const fileManagerModel = {
      syncTabInstances: vi.fn(),
      getState: vi.fn(() => null),
      ensureInstance: vi.fn(),
      openDirectory: vi.fn().mockResolvedValue(undefined),
      openHome: vi.fn().mockResolvedValue(undefined)
    } as unknown as FileManagerModel;
    const fileEditorModel = {
      syncTabInstances: vi.fn(),
      getState: vi.fn(() => null),
      ensureInstance: vi.fn(),
      hydrateIfNeeded: vi.fn().mockResolvedValue(undefined),
      touchInstance: vi.fn()
    } as unknown as FileEditorModel;
    const imageViewerModel = createImageViewerModel();

    renderHook(() =>
      useWorkbenchAppRestoration({
        activeTab: tab,
        tabsModel: createTabsModel([tab]),
        fileManagerModel,
        fileEditorModel,
        imageViewerModel
      })
    );

    await waitFor(() => {
      expect(fileManagerModel.syncTabInstances).toHaveBeenCalledWith(["fm-1"]);
    });
    expect(fileManagerModel.ensureInstance).toHaveBeenCalledWith("fm-1");
    expect(fileManagerModel.openDirectory).toHaveBeenCalledWith("fm-1", "/tmp", false);
  });

  test("touches and hydrates the active file editor tab", async () => {
    const tab = {
      id: "tab-editor",
      title: "Editor",
      pageKind: "app",
      appId: "file-editor",
      appInstanceId: "editor-1",
      filePath: "/tmp/app.ts",
      inputValue: "",
      displayAddress: ""
    } as WorkspaceTab;
    const fileManagerModel = {
      syncTabInstances: vi.fn(),
      getState: vi.fn(() => null),
      ensureInstance: vi.fn(),
      openDirectory: vi.fn().mockResolvedValue(undefined),
      openHome: vi.fn().mockResolvedValue(undefined)
    } as unknown as FileManagerModel;
    const fileEditorModel = {
      syncTabInstances: vi.fn(),
      getState: vi.fn(() => null),
      ensureInstance: vi.fn(),
      hydrateIfNeeded: vi.fn().mockResolvedValue(undefined),
      touchInstance: vi.fn()
    } as unknown as FileEditorModel;
    const imageViewerModel = createImageViewerModel();

    renderHook(() =>
      useWorkbenchAppRestoration({
        activeTab: tab,
        tabsModel: createTabsModel([tab]),
        fileManagerModel,
        fileEditorModel,
        imageViewerModel
      })
    );

    await waitFor(() => {
      expect(fileEditorModel.ensureInstance).toHaveBeenCalledWith("editor-1", {
        filePath: "/tmp/app.ts"
      });
    });
    expect(fileEditorModel.touchInstance).toHaveBeenCalledWith("editor-1");
    expect(fileEditorModel.hydrateIfNeeded).toHaveBeenCalledWith("editor-1");
  });
});
