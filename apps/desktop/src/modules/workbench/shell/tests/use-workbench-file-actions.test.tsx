import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { FileEditorModel } from "../../file-editor";
import type { FileManagerModel } from "../../file-manager";
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

    const { result } = renderHook(() =>
      useWorkbenchFileActions({
        activeTab: undefined,
        tabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel,
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
});
