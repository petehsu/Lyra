import { AppButton, AppEmptyState, AppToolbarButton } from "@renderer/ui/components";
import { AlertTriangle, Check, CheckCheck, ChevronDown, ChevronUp, GitCompareArrows, Lock, Save, Undo2, X } from "lucide-react";
import type { RefObject } from "react";

import type { FileEditorRenderModel } from "./render-model";
import type { FileEditorChangeReviewItem } from "./types";

type FileEditorSurfaceViewProps = {
  readonly renderModel: FileEditorRenderModel;
  readonly hostRef: RefObject<HTMLDivElement>;
  readonly diffHostRef: RefObject<HTMLDivElement>;
  readonly onToggleDiff: () => void;
  readonly onSave: () => void;
  readonly onRetry: () => void;
  readonly onGoToPreviousEditorWorkItem?: (() => void) | undefined;
  readonly onGoToNextEditorWorkItem?: (() => void) | undefined;
  readonly onAcceptAllEditorWorkItems?: (() => void) | undefined;
  readonly onAcceptEditorWorkItem?: ((item: FileEditorChangeReviewItem) => void) | undefined;
  readonly onRejectEditorWorkItem?: ((item: FileEditorChangeReviewItem) => void) | undefined;
  readonly onUndoEditorWorkItem?: ((item: FileEditorChangeReviewItem) => void) | undefined;
};

export const FileEditorTitlebarContent = ({
  renderModel,
  onToggleDiff,
  onSave,
  onGoToPreviousEditorWorkItem,
  onGoToNextEditorWorkItem,
  onAcceptAllEditorWorkItems,
  onAcceptEditorWorkItem,
  onRejectEditorWorkItem,
  onUndoEditorWorkItem
}: Omit<FileEditorSurfaceViewProps, "hostRef" | "diffHostRef" | "onRetry">) => {
  const { toolbar } = renderModel;
  return (
    <div className="lyra-titlebar-context-controls">
      {toolbar.delta === null ? null : (
        <span className="lyra-file-editor-ai-work-delta" aria-label={toolbar.delta.ariaLabel}>
          <span className="lyra-file-editor-ai-work-delta-added">
            {toolbar.delta.addedText}
          </span>
          <span className="lyra-file-editor-ai-work-delta-removed">
            {toolbar.delta.removedText}
          </span>
        </span>
      )}
      {toolbar.diffToggle === null ? null : (
        <AppToolbarButton
          type="button"
          className={
            toolbar.diffToggle.active
              ? "lyra-titlebar-context-icon-button lyra-titlebar-context-button-active"
              : "lyra-titlebar-context-icon-button"
          }
          active={toolbar.diffToggle.active}
          aria-label={toolbar.diffToggle.label}
          aria-pressed={toolbar.diffToggle.active}
          onClick={onToggleDiff}
        >
          <GitCompareArrows size={13} />
        </AppToolbarButton>
      )}
      {toolbar.reviewActions === null ? null : (
        <span className="lyra-titlebar-context-group">
          <AppToolbarButton
            type="button"
            className="lyra-titlebar-context-icon-button"
            aria-label={toolbar.reviewActions.prevLabel}
            disabled={!toolbar.reviewActions.canGoPrevious}
            onClick={() => {
              onGoToPreviousEditorWorkItem?.();
            }}
          >
            <ChevronUp size={12} />
          </AppToolbarButton>
          <AppToolbarButton
            type="button"
            className="lyra-titlebar-context-icon-button"
            aria-label={toolbar.reviewActions.nextLabel}
            disabled={!toolbar.reviewActions.canGoNext}
            onClick={() => {
              onGoToNextEditorWorkItem?.();
            }}
          >
            <ChevronDown size={12} />
          </AppToolbarButton>
          <AppToolbarButton
            type="button"
            className="lyra-titlebar-context-icon-button"
            aria-label={toolbar.reviewActions.acceptAllLabel}
            disabled={!toolbar.reviewActions.canAcceptAll}
            onClick={() => {
              onAcceptAllEditorWorkItems?.();
            }}
          >
            <CheckCheck size={12} />
          </AppToolbarButton>
          {toolbar.reviewActions.decisionState === "accepted" ? (
            <AppToolbarButton
              type="button"
              className="lyra-titlebar-context-icon-button"
              aria-label={toolbar.reviewActions.undoLabel}
              onClick={() => {
                onUndoEditorWorkItem?.(toolbar.reviewActions!.item);
              }}
            >
              <Undo2 size={12} />
            </AppToolbarButton>
          ) : (
            <>
              <AppToolbarButton
                type="button"
                className="lyra-titlebar-context-icon-button"
                aria-label={toolbar.reviewActions.acceptLabel}
                onClick={() => {
                  onAcceptEditorWorkItem?.(toolbar.reviewActions!.item);
                }}
              >
                <Check size={12} />
              </AppToolbarButton>
              <AppToolbarButton
                type="button"
                className={
                  toolbar.reviewActions.decisionState === "rejected"
                    ? "lyra-titlebar-context-icon-button lyra-titlebar-context-danger lyra-titlebar-context-button-active"
                    : "lyra-titlebar-context-icon-button lyra-titlebar-context-danger"
                }
                tone="danger"
                active={toolbar.reviewActions.decisionState === "rejected"}
                aria-label={toolbar.reviewActions.rejectLabel}
                onClick={() => {
                  onRejectEditorWorkItem?.(toolbar.reviewActions!.item);
                }}
              >
                <X size={12} />
              </AppToolbarButton>
            </>
          )}
        </span>
      )}
      {toolbar.readOnlyLabel === null ? null : (
        <span className="lyra-titlebar-context-chip">
          <Lock size={12} />
          {toolbar.readOnlyLabel}
        </span>
      )}
      {toolbar.conflictLabel === null ? null : (
        <span className="lyra-titlebar-context-chip">
          <AlertTriangle size={12} />
          {toolbar.conflictLabel}
        </span>
      )}
      {toolbar.saveButton === null ? null : (
        <AppToolbarButton
          type="button"
          className="lyra-titlebar-context-icon-button"
          aria-label={toolbar.saveButton.label}
          disabled={toolbar.saveButton.disabled}
          onClick={onSave}
        >
          <Save size={14} />
        </AppToolbarButton>
      )}
    </div>
  );
};

export const FileEditorSurfaceView = ({
  renderModel,
  hostRef,
  diffHostRef,
  onToggleDiff,
  onSave,
  onRetry,
  onGoToPreviousEditorWorkItem,
  onGoToNextEditorWorkItem,
  onAcceptAllEditorWorkItems,
  onAcceptEditorWorkItem,
  onRejectEditorWorkItem,
  onUndoEditorWorkItem
}: FileEditorSurfaceViewProps) => {
  const { body } = renderModel;

  return (
    <section
      className={renderModel.surfaceClassName}
      aria-label="file-editor-surface"
    >
      {body.kind === "empty" ? (
        <section className="lyra-file-editor-empty-state">
          <AppEmptyState
            density="compact"
            icon={<AlertTriangle size={16} />}
            title={body.message}
            actions={(
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
              >
                {body.retryLabel}
              </AppButton>
            )}
          />
        </section>
      ) : (
        <section className="lyra-file-editor-body">
          {body.showLoadingSkeleton ? (
            <div className="lyra-file-editor-loading" aria-label="file-editor-loading-skeleton">
              <div className="lyra-file-editor-loading-skeleton">
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-title" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line lyra-file-editor-skeleton-line-short" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line lyra-file-editor-skeleton-line-short" />
              </div>
            </div>
          ) : null}
          <div
            ref={hostRef}
            className={body.hostClassName}
          />
          <div
            ref={diffHostRef}
            className={body.diffHostClassName}
          />
        </section>
      )}
    </section>
  );
};
