import { AlertTriangle, Check, CheckCheck, ChevronDown, ChevronUp, GitCompareArrows, Lock, Save, Undo2, X } from "lucide-react";
import type { RefObject, ReactNode } from "react";

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

const renderToolbarScanText = (
  value: string,
  keyPrefix: string,
  tone: "title" | "path"
): ReactNode =>
  Array.from(value).map((char, index) => (
    <span
      key={`${keyPrefix}-char-${index}`}
      className={`lyra-file-editor-toolbar-scan-char lyra-file-editor-toolbar-scan-char-${tone}`}
      style={{ animationDelay: `${index * 24}ms` }}
    >
      {char === " " ? "\u00A0" : char}
    </span>
  ));

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
  const { toolbar, body } = renderModel;

  return (
    <section
      className={renderModel.surfaceClassName}
      aria-label="file-editor-surface"
    >
      <header className="lyra-file-editor-toolbar">
        <div
          className={
            toolbar.isEditorWorkRunning
              ? "lyra-file-editor-toolbar-main lyra-file-editor-toolbar-main-running"
              : "lyra-file-editor-toolbar-main"
          }
        >
          <strong>
            {toolbar.isEditorWorkRunning
              ? renderToolbarScanText(toolbar.title, toolbar.titleScanKey, "title")
              : toolbar.title}
          </strong>
        </div>
        <div className="lyra-file-editor-toolbar-actions">
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
            <button
              type="button"
              className={
                toolbar.diffToggle.active
                  ? "lyra-file-editor-diff-toggle lyra-file-editor-diff-toggle-active"
                  : "lyra-file-editor-diff-toggle"
              }
              aria-label={toolbar.diffToggle.label}
              aria-pressed={toolbar.diffToggle.active}
              onClick={onToggleDiff}
            >
              <GitCompareArrows size={13} />
            </button>
          )}
          {toolbar.reviewActions === null ? null : (
            <span className="lyra-file-editor-ai-work-actions">
              <button
                type="button"
                className="lyra-file-editor-ai-work-action"
                aria-label={toolbar.reviewActions.prevLabel}
                disabled={!toolbar.reviewActions.canGoPrevious}
                onClick={() => {
                  onGoToPreviousEditorWorkItem?.();
                }}
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                className="lyra-file-editor-ai-work-action"
                aria-label={toolbar.reviewActions.nextLabel}
                disabled={!toolbar.reviewActions.canGoNext}
                onClick={() => {
                  onGoToNextEditorWorkItem?.();
                }}
              >
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                className="lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-accept"
                aria-label={toolbar.reviewActions.acceptAllLabel}
                disabled={!toolbar.reviewActions.canAcceptAll}
                onClick={() => {
                  onAcceptAllEditorWorkItems?.();
                }}
              >
                <CheckCheck size={12} />
              </button>
              {toolbar.reviewActions.decisionState === "accepted" ? (
                <button
                  type="button"
                  className="lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-undo"
                  aria-label={toolbar.reviewActions.undoLabel}
                  onClick={() => {
                    onUndoEditorWorkItem?.(toolbar.reviewActions!.item);
                  }}
                >
                  <Undo2 size={12} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-accept"
                    aria-label={toolbar.reviewActions.acceptLabel}
                    onClick={() => {
                      onAcceptEditorWorkItem?.(toolbar.reviewActions!.item);
                    }}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    className={
                      toolbar.reviewActions.decisionState === "rejected"
                        ? "lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-reject lyra-file-editor-ai-work-action-rejected"
                        : "lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-reject"
                    }
                    aria-label={toolbar.reviewActions.rejectLabel}
                    onClick={() => {
                      onRejectEditorWorkItem?.(toolbar.reviewActions!.item);
                    }}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </span>
          )}
          {toolbar.readOnlyLabel === null ? null : (
            <span className="lyra-file-editor-chip">
              <Lock size={12} />
              {toolbar.readOnlyLabel}
            </span>
          )}
          {toolbar.conflictLabel === null ? null : (
            <span className="lyra-file-editor-chip lyra-file-editor-chip-warning">
              <AlertTriangle size={12} />
              {toolbar.conflictLabel}
            </span>
          )}
          {toolbar.saveButton === null ? null : (
            <button
              className="lyra-file-editor-save-button"
              aria-label={toolbar.saveButton.label}
              disabled={toolbar.saveButton.disabled}
              onClick={onSave}
            >
              <Save size={14} />
            </button>
          )}
        </div>
      </header>

      {body.kind === "empty" ? (
        <section className="lyra-file-editor-empty-state">
          <AlertTriangle size={16} />
          <p>{body.message}</p>
          <button
            type="button"
            className="lyra-file-editor-retry-button"
            onClick={onRetry}
          >
            {body.retryLabel}
          </button>
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
