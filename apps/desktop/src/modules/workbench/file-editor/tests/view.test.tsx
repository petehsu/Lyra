import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { FileEditorSurface } from "../view";
import type { FileEditorModel } from "../types";
import { createFileEditorState, createReviewItem, labels } from "./test-helpers";

const createModel = (): FileEditorModel => ({
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

const flushEditorRuntime = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("FileEditorSurface", () => {
  test("routes save and retry actions through the file editor model", async () => {
    const model = createModel();
    const dirtyState = createFileEditorState({ isDirty: true });
    const { rerender } = render(
      <FileEditorSurface
        state={dirtyState}
        labels={labels}
        themeSignature="test-theme"
        model={model}
      />
    );
    await flushEditorRuntime();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(model.save).toHaveBeenCalledWith("editor-1", "manual");

    rerender(
      <FileEditorSurface
        state={createFileEditorState({ status: "unsupported", message: "Binary file" })}
        labels={labels}
        themeSignature="test-theme"
        model={model}
      />
    );
    await flushEditorRuntime();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(model.openFile).toHaveBeenCalledWith("editor-1", "/workspace/app.ts");
  });

  test("does not auto-hydrate a failed missing-file state", async () => {
    const model = createModel();
    render(
      <FileEditorSurface
        state={createFileEditorState({
          status: "error",
          isHydrated: false,
          message: "No such file or directory"
        })}
        labels={labels}
        themeSignature="test-theme"
        model={model}
      />
    );
    await flushEditorRuntime();

    expect(model.hydrateIfNeeded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(model.openFile).toHaveBeenCalledWith("editor-1", "/workspace/app.ts");
  });

  test("routes review actions through the supplied callbacks", async () => {
    const reviewItem = createReviewItem();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onAcceptAll = vi.fn();
    const onAccept = vi.fn();
    const onReject = vi.fn();

    render(
      <FileEditorSurface
        state={createFileEditorState()}
        labels={labels}
        themeSignature="test-theme"
        model={createModel()}
        activeEditorWorkItem={reviewItem}
        editorWorkAcceptLabel="Accept"
        editorWorkRejectLabel="Reject"
        editorWorkUndoLabel="Undo"
        editorWorkPrevLabel="Previous"
        editorWorkNextLabel="Next"
        editorWorkAcceptAllLabel="Accept all"
        canGoToPreviousEditorWorkItem
        canGoToNextEditorWorkItem
        canAcceptAllEditorWorkItems
        onGoToPreviousEditorWorkItem={onPrevious}
        onGoToNextEditorWorkItem={onNext}
        onAcceptAllEditorWorkItems={onAcceptAll}
        onAcceptEditorWorkItem={onAccept}
        onRejectEditorWorkItem={onReject}
      />
    );
    await flushEditorRuntime();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(reviewItem);
    expect(onReject).toHaveBeenCalledWith(reviewItem);
  });

  test("toggles diff mode from the toolbar", async () => {
    render(
      <FileEditorSurface
        state={createFileEditorState({
          content: "const value = 2;\n",
          lastSavedContent: "const value = 1;\n"
        })}
        labels={labels}
        themeSignature="test-theme"
        model={createModel()}
        activeEditorWorkItem={createReviewItem({ baselineContent: undefined })}
      />
    );
    await flushEditorRuntime();

    const diffToggle = await screen.findByRole("button", { name: "Open diff" });
    fireEvent.click(diffToggle);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close diff" })).toHaveAttribute("aria-pressed", "true");
    });
  });
});
