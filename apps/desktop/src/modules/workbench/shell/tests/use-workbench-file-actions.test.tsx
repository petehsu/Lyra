import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { FileEditorModel } from "../../file-editor";
import type { FileManagerModel } from "../../file-manager";
import type { ImageViewerModel } from "../../image-viewer";
import type { WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchFileActions } from "../use-workbench-file-actions";

describe("useWorkbenchFileActions", () => {
  test("opens allowMissing file editor placeholders without reading the missing file", () => {
    const fileEditorModel = {
      findInstanceByPath: vi.fn(() => null),
      createInstance: vi.fn(() => ({
        appId: "file-editor" as const,
        appInstanceId: "editor-1",
        title: "style.css",
        iconKey: "file-editor-code" as const,
        filePath: "/missing/style.css",
        fileSessionId: "file-session-1",
        isDirty: false,
      })),
      ensureInstance: vi.fn(),
      getState: vi.fn(() => ({
        instanceId: "editor-1",
        filePath: "/missing/style.css",
        content: "",
        isHydrated: false,
      })),
      applyExternalContent: vi.fn(),
      openFile: vi.fn(),
      hydrateIfNeeded: vi.fn(),
      revealLocation: vi.fn(),
    } as unknown as FileEditorModel;
    const tabsModel = {
      tabs: [],
      openAppTab: vi.fn(),
      setActiveTab: vi.fn(),
    } as unknown as WorkspaceTabsModel;
    const imageViewerModel = {
      findInstanceByPath: vi.fn(() => null),
      createInstance: vi.fn(),
      openImage: vi.fn(),
    } as unknown as ImageViewerModel;

    const { result } = renderHook(() =>
      useWorkbenchFileActions({
        desktopApi: null,
        activeTab: undefined,
        tabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel,
        imageViewerModel,
      })
    );

    act(() => {
      result.current.onOpenFileFromManager("/missing/style.css", undefined, {
        allowMissing: true,
      });
    });

    expect(fileEditorModel.openFile).not.toHaveBeenCalled();
    expect(fileEditorModel.hydrateIfNeeded).not.toHaveBeenCalled();
    expect(fileEditorModel.applyExternalContent).toHaveBeenCalledWith("editor-1", "", {
      markHydrated: true,
    });
  });

  test("routes image files to the image viewer instead of the file editor", () => {
    const fileEditorModel = {
      findInstanceByPath: vi.fn(),
      createInstance: vi.fn(),
      openFile: vi.fn(),
    } as unknown as FileEditorModel;
    const imageViewerModel = {
      findInstanceByPath: vi.fn(() => null),
      createInstance: vi.fn(() => ({
        appId: "image-viewer" as const,
        appInstanceId: "image-1",
        title: "cat.png",
        iconKey: "image-viewer-default" as const,
        filePath: "/tmp/cat.png",
        isDirty: false,
      })),
      openImage: vi.fn(),
    } as unknown as ImageViewerModel;
    const tabsModel = {
      tabs: [],
      openAppTab: vi.fn(),
      setActiveTab: vi.fn(),
    } as unknown as WorkspaceTabsModel;

    const { result } = renderHook(() =>
      useWorkbenchFileActions({
        desktopApi: null,
        activeTab: undefined,
        tabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel,
        imageViewerModel,
      })
    );

    act(() => {
      result.current.onOpenFileFromManager("/tmp/cat.png");
    });

    expect(fileEditorModel.createInstance).not.toHaveBeenCalled();
    expect(tabsModel.openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "image-viewer",
      appInstanceId: "image-1",
    }));
    expect(imageViewerModel.openImage).toHaveBeenCalledWith("image-1", "/tmp/cat.png");
  });

  test("reveals directories by opening the directory in a reusable file manager tab", async () => {
    const fileManagerModel = {
      createInstance: vi.fn(() => ({
        appId: "file-manager" as const,
        appInstanceId: "files-1",
        title: "Files",
        iconKey: "file-manager-home" as const,
      })),
      ensureInstance: vi.fn(),
      openDirectory: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn(),
      selectEntry: vi.fn(),
    } as unknown as FileManagerModel;
    const tabsModel = {
      tabs: [],
      openAppTab: vi.fn(),
      setActiveTab: vi.fn(),
    } as unknown as WorkspaceTabsModel;
    const desktopApi = {
      files: {
        statFile: vi.fn().mockResolvedValue({
          path: "/project/src",
          exists: true,
          isDirectory: true,
          readOnly: false,
          sizeBytes: 0,
        }),
      },
    };

    const { result } = renderHook(() =>
      useWorkbenchFileActions({
        desktopApi: desktopApi as never,
        activeTab: undefined,
        tabsModel,
        fileManagerModel,
        fileEditorModel: {} as FileEditorModel,
        imageViewerModel: {} as ImageViewerModel,
      })
    );

    await act(async () => {
      await result.current.onRevealPathInFileManager("/project/src");
    });

    expect(fileManagerModel.openDirectory).toHaveBeenCalledWith("files-1", "/project/src", false);
    expect(fileManagerModel.selectEntry).not.toHaveBeenCalled();
  });

  test("reveals files by opening the parent directory and selecting the entry", async () => {
    const fileManagerModel = {
      createInstance: vi.fn(() => ({
        appId: "file-manager" as const,
        appInstanceId: "files-1",
        title: "Files",
        iconKey: "file-manager-home" as const,
      })),
      ensureInstance: vi.fn(),
      openDirectory: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn(() => ({
        entries: [
          {
            id: "entry-1",
            path: "/project/src/App.tsx",
          },
        ],
      })),
      selectEntry: vi.fn(),
    } as unknown as FileManagerModel;
    const tabsModel = {
      tabs: [],
      openAppTab: vi.fn(),
      setActiveTab: vi.fn(),
    } as unknown as WorkspaceTabsModel;
    const desktopApi = {
      files: {
        statFile: vi.fn().mockResolvedValue({
          path: "/project/src/App.tsx",
          exists: true,
          isDirectory: false,
          readOnly: false,
          sizeBytes: 32,
        }),
      },
    };

    const { result } = renderHook(() =>
      useWorkbenchFileActions({
        desktopApi: desktopApi as never,
        activeTab: undefined,
        tabsModel,
        fileManagerModel,
        fileEditorModel: {} as FileEditorModel,
        imageViewerModel: {} as ImageViewerModel,
      })
    );

    await act(async () => {
      await result.current.onRevealPathInFileManager("/project/src/App.tsx");
    });

    expect(fileManagerModel.openDirectory).toHaveBeenCalledWith("files-1", "/project/src", false);
    expect(fileManagerModel.selectEntry).toHaveBeenCalledWith("files-1", "entry-1");
  });
});
