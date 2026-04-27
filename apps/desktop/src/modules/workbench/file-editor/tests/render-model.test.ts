import { describe, expect, test } from "vitest";

import { createFileEditorRenderModel } from "../render-model";
import { createFileEditorState, createReviewItem, labels } from "./test-helpers";

const createModel = (
  overrides: Partial<Parameters<typeof createFileEditorRenderModel>[0]> = {}
) =>
  createFileEditorRenderModel({
    state: createFileEditorState(),
    labels,
    surfaceVariant: "full",
    controlMode: "human_takeover",
    isDiffMode: false,
    canToggleDiff: false,
    showLoadingSkeleton: false,
    canGoToPreviousEditorWorkItem: false,
    canGoToNextEditorWorkItem: false,
    canAcceptAllEditorWorkItems: false,
    ...overrides
  });

describe("createFileEditorRenderModel", () => {
  test("returns null while no editor state is available", () => {
    expect(createModel({ state: null })).toBeNull();
  });

  test("describes unsupported and error states as retryable empty states", () => {
    const model = createModel({
      state: createFileEditorState({
        status: "unsupported",
        message: "Binary file"
      })
    });

    expect(model?.body).toEqual({
      kind: "empty",
      message: "Binary file",
      retryLabel: "Retry"
    });
  });

  test("hides human save controls in AI-only mode", () => {
    const humanModel = createModel({
      state: createFileEditorState({ isDirty: true })
    });
    const aiOnlyModel = createModel({
      state: createFileEditorState({ isDirty: true }),
      controlMode: "ai_only"
    });

    expect(humanModel?.toolbar.saveButton).toEqual({
      label: "Save",
      disabled: false
    });
    expect(aiOnlyModel?.toolbar.saveButton).toBeNull();
  });

  test("describes diff and review toolbar state without rendering JSX", () => {
    const reviewItem = createReviewItem({ decision: "rejected" });
    const model = createModel({
      activeEditorWorkItem: reviewItem,
      isDiffMode: true,
      canToggleDiff: true,
      editorWorkAcceptLabel: "Accept",
      editorWorkRejectLabel: "Reject",
      editorWorkUndoLabel: "Undo",
      editorWorkPrevLabel: "Previous",
      editorWorkNextLabel: "Next",
      editorWorkAcceptAllLabel: "Accept all",
      canGoToPreviousEditorWorkItem: true,
      canGoToNextEditorWorkItem: true,
      canAcceptAllEditorWorkItems: true
    });

    expect(model?.toolbar.delta).toEqual({
      ariaLabel: "+2 -1",
      addedText: "+2",
      removedText: "-1"
    });
    expect(model?.toolbar.diffToggle).toEqual({
      label: "Close diff",
      active: true
    });
    expect(model?.toolbar.reviewActions?.decisionState).toBe("rejected");
    expect(model?.toolbar.reviewActions?.canAcceptAll).toBe(true);
  });

  test("marks running editor work for animated toolbar rendering", () => {
    const model = createModel({
      activeEditorWorkItem: createReviewItem({ status: "running" })
    });

    expect(model?.toolbar.isEditorWorkRunning).toBe(true);
    expect(model?.toolbar.reviewActions).toBeNull();
  });
});
