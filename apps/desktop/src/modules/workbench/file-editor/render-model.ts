import type {
  FileEditorAppState,
  FileEditorChangeReviewItem,
  FileEditorControlMode,
  FileEditorLabels,
  FileEditorSurfaceVariant
} from "./types";

export type FileEditorReviewDecisionState = "accepted" | "rejected" | "pending";

export type FileEditorReviewActionModel = {
  readonly item: FileEditorChangeReviewItem;
  readonly prevLabel: string;
  readonly nextLabel: string;
  readonly acceptAllLabel: string;
  readonly acceptLabel: string;
  readonly rejectLabel: string;
  readonly undoLabel: string;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly canAcceptAll: boolean;
  readonly decisionState: FileEditorReviewDecisionState;
};

export type FileEditorToolbarModel = {
  readonly title: string;
  readonly titleScanKey: string;
  readonly isEditorWorkRunning: boolean;
  readonly delta: {
    readonly ariaLabel: string;
    readonly addedText: string;
    readonly removedText: string;
  } | null;
  readonly diffToggle: {
    readonly label: string;
    readonly active: boolean;
  } | null;
  readonly reviewActions: FileEditorReviewActionModel | null;
  readonly readOnlyLabel: string | null;
  readonly conflictLabel: string | null;
  readonly saveButton: {
    readonly label: string;
    readonly disabled: boolean;
  } | null;
};

export type FileEditorBodyModel =
  | {
      readonly kind: "empty";
      readonly message: string;
      readonly retryLabel: string;
    }
  | {
      readonly kind: "editor";
      readonly showLoadingSkeleton: boolean;
      readonly hostClassName: string;
      readonly diffHostClassName: string;
    };

export type FileEditorRenderModel = {
  readonly surfaceClassName: string;
  readonly stateInstanceId: string;
  readonly filePath: string;
  readonly toolbar: FileEditorToolbarModel;
  readonly body: FileEditorBodyModel;
};

export type CreateFileEditorRenderModelInput = {
  readonly state: FileEditorAppState | null;
  readonly labels: FileEditorLabels;
  readonly surfaceVariant: FileEditorSurfaceVariant;
  readonly controlMode: FileEditorControlMode;
  readonly isDiffMode: boolean;
  readonly canToggleDiff: boolean;
  readonly showLoadingSkeleton: boolean;
  readonly activeEditorWorkItem?: FileEditorChangeReviewItem | undefined;
  readonly editorWorkAcceptLabel?: string | undefined;
  readonly editorWorkRejectLabel?: string | undefined;
  readonly editorWorkUndoLabel?: string | undefined;
  readonly editorWorkPrevLabel?: string | undefined;
  readonly editorWorkNextLabel?: string | undefined;
  readonly editorWorkAcceptAllLabel?: string | undefined;
  readonly canGoToPreviousEditorWorkItem: boolean;
  readonly canGoToNextEditorWorkItem: boolean;
  readonly canAcceptAllEditorWorkItems: boolean;
};

const createReviewActions = ({
  activeEditorWorkItem,
  editorWorkAcceptLabel,
  editorWorkRejectLabel,
  editorWorkUndoLabel,
  editorWorkPrevLabel,
  editorWorkNextLabel,
  editorWorkAcceptAllLabel,
  canGoToPreviousEditorWorkItem,
  canGoToNextEditorWorkItem,
  canAcceptAllEditorWorkItems
}: Pick<
  CreateFileEditorRenderModelInput,
  | "activeEditorWorkItem"
  | "canAcceptAllEditorWorkItems"
  | "canGoToNextEditorWorkItem"
  | "canGoToPreviousEditorWorkItem"
  | "editorWorkAcceptAllLabel"
  | "editorWorkAcceptLabel"
  | "editorWorkNextLabel"
  | "editorWorkPrevLabel"
  | "editorWorkRejectLabel"
  | "editorWorkUndoLabel"
>): FileEditorReviewActionModel | null => {
  if (
    activeEditorWorkItem === undefined ||
    activeEditorWorkItem.status !== "completed" ||
    editorWorkAcceptLabel === undefined ||
    editorWorkRejectLabel === undefined ||
    editorWorkUndoLabel === undefined ||
    editorWorkPrevLabel === undefined ||
    editorWorkNextLabel === undefined ||
    editorWorkAcceptAllLabel === undefined
  ) {
    return null;
  }

  return {
    item: activeEditorWorkItem,
    prevLabel: editorWorkPrevLabel,
    nextLabel: editorWorkNextLabel,
    acceptAllLabel: editorWorkAcceptAllLabel,
    acceptLabel: editorWorkAcceptLabel,
    rejectLabel: editorWorkRejectLabel,
    undoLabel: editorWorkUndoLabel,
    canGoPrevious: canGoToPreviousEditorWorkItem,
    canGoNext: canGoToNextEditorWorkItem,
    canAcceptAll: canAcceptAllEditorWorkItems,
    decisionState:
      activeEditorWorkItem.decision === "accepted"
        ? "accepted"
        : activeEditorWorkItem.decision === "rejected"
          ? "rejected"
          : "pending"
  };
};

export const createFileEditorRenderModel = ({
  state,
  labels,
  surfaceVariant,
  controlMode,
  isDiffMode,
  canToggleDiff,
  showLoadingSkeleton,
  activeEditorWorkItem,
  editorWorkAcceptLabel,
  editorWorkRejectLabel,
  editorWorkUndoLabel,
  editorWorkPrevLabel,
  editorWorkNextLabel,
  editorWorkAcceptAllLabel,
  canGoToPreviousEditorWorkItem,
  canGoToNextEditorWorkItem,
  canAcceptAllEditorWorkItems
}: CreateFileEditorRenderModelInput): FileEditorRenderModel | null => {
  if (state === null) {
    return null;
  }

  const isAiOnly = controlMode === "ai_only";
  const isEditorWorkRunning = activeEditorWorkItem?.status === "running";
  const reviewActions = createReviewActions({
    activeEditorWorkItem,
    editorWorkAcceptLabel,
    editorWorkRejectLabel,
    editorWorkUndoLabel,
    editorWorkPrevLabel,
    editorWorkNextLabel,
    editorWorkAcceptAllLabel,
    canGoToPreviousEditorWorkItem,
    canGoToNextEditorWorkItem,
    canAcceptAllEditorWorkItems
  });

  return {
    surfaceClassName: `lyra-file-editor-surface lyra-file-editor-surface-${surfaceVariant} lyra-file-editor-control-${controlMode}`,
    stateInstanceId: state.instanceId,
    filePath: state.filePath,
    toolbar: {
      title: state.title,
      titleScanKey: `${state.instanceId}-title`,
      isEditorWorkRunning,
      delta: activeEditorWorkItem === undefined
        ? null
        : {
            ariaLabel: `+${activeEditorWorkItem.addedLines} -${activeEditorWorkItem.removedLines}`,
            addedText: `+${activeEditorWorkItem.addedLines}`,
            removedText: `-${activeEditorWorkItem.removedLines}`
          },
      diffToggle: canToggleDiff
        ? {
            label: isDiffMode ? labels.closeDiff : labels.openDiff,
            active: isDiffMode
          }
        : null,
      reviewActions,
      readOnlyLabel: state.isReadOnly ? labels.readOnly : null,
      conflictLabel: state.status === "conflict" ? labels.conflict : null,
      saveButton: isAiOnly
        ? null
        : {
            label: labels.save,
            disabled: state.isReadOnly || state.isDirty === false || state.status === "loading"
          }
    },
    body: state.status === "unsupported" || state.status === "error"
      ? {
          kind: "empty",
          message: state.message ?? labels.unsupported,
          retryLabel: labels.retry
        }
      : {
          kind: "editor",
          showLoadingSkeleton,
          hostClassName:
            showLoadingSkeleton || isDiffMode
              ? "lyra-file-editor-host lyra-file-editor-host-hidden"
              : "lyra-file-editor-host",
          diffHostClassName: isDiffMode
            ? "lyra-file-editor-diff-host"
            : "lyra-file-editor-diff-host lyra-file-editor-diff-host-hidden"
        }
  };
};
