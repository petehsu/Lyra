import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { FileEditorChangeReviewItem } from "../../file-editor";
import { useWorkbenchEditorReviewModel } from "../use-workbench-editor-review-model";

const createReviewItem = (
  overrides: Partial<FileEditorChangeReviewItem> = {}
): FileEditorChangeReviewItem => ({
  id: "review-1",
  status: "completed",
  filePath: "/tmp/example.ts",
  addedLines: 2,
  removedLines: 1,
  createdAt: 1000,
  ...overrides
});

describe("useWorkbenchEditorReviewModel", () => {
  test("records, resolves, accepts, and undoes editor work items", () => {
    const onOpenFileFromManager = vi.fn(() => "editor-1");
    const { result } = renderHook(() =>
      useWorkbenchEditorReviewModel({
        desktopApi: null,
        onOpenFileFromManager
      })
    );

    const item = createReviewItem({ firstChangedLine: 12 });

    act(() => {
      result.current.recordCompletedEditorWorkItem(item);
    });

    expect(result.current.editorReviewItems).toHaveLength(1);
    expect(result.current.activeEditorReviewIndex).toBe(0);
    expect(result.current.resolveActiveEditorWorkItem(item.filePath)).toEqual(item);

    act(() => {
      result.current.onAcceptEditorWorkItem(item);
    });

    expect(result.current.editorReviewItems[0]?.decision).toBe("accepted");

    act(() => {
      result.current.onUndoEditorWorkItem(item);
    });

    expect(result.current.editorReviewItems[0]?.decision).toBeUndefined();
  });

  test("rejects existing files by restoring baseline content and reopening the editor", async () => {
    const onOpenFileFromManager = vi.fn(() => "editor-1");
    const desktopApi = {
      files: {
        moveToTrash: vi.fn(),
        writeTextFile: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useWorkbenchEditorReviewModel({
        desktopApi,
        onOpenFileFromManager
      })
    );
    const item = createReviewItem({
      baselineContent: "before",
      firstChangedLine: 4
    });

    act(() => {
      result.current.recordCompletedEditorWorkItem(item);
      result.current.onRejectEditorWorkItem(item);
    });

    expect(result.current.editorReviewItems[0]?.decision).toBe("rejected");
    await waitFor(() => {
      expect(desktopApi.files.writeTextFile).toHaveBeenCalledWith({
        path: item.filePath,
        content: "before",
        encoding: "utf8"
      });
    });
    expect(onOpenFileFromManager).toHaveBeenCalledWith(
      item.filePath,
      { line: 4 },
      { forceReloadIfOpen: true }
    );
  });
});
