import { AppButton, AppEmptyState, AppLoadingState, AppToolbarButton } from "@renderer/ui/components";
import { t } from "@workbench/i18n";
import { AlertTriangle, Check, CheckCheck, ChevronDown, ChevronUp, GitCompareArrows, Lock, Save, Undo2, X } from "@lyra/icons";
import { lazy, Suspense, type RefObject } from "react";

import { FilePreviewModeButton } from "../file-preview/view-mode-button";
import { FilePreviewSplit } from "../file-preview/split-pane";
import { previewKindFromPath } from "../file-preview/kinds";
import { useFilePreviewLayout } from "../file-preview/layout-store";

const FilePreviewPane = lazy(async () => {
  const module = await import("../file-preview/preview-pane");
  return { default: module.FilePreviewPane };
});
import type { FileEditorRenderModel } from "./render-model";
import type { FileEditorChangeReviewItem } from "./types";

type FileEditorSurfaceViewProps = {
  readonly renderModel: FileEditorRenderModel;
  readonly attachHost: (node: HTMLDivElement | null) => void;
  readonly diffHostRef: RefObject<HTMLDivElement>;
  readonly previewEnabled: boolean;
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
}: Omit<FileEditorSurfaceViewProps, "attachHost" | "diffHostRef" | "onRetry" | "previewEnabled">) => {
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
      <FilePreviewModeButton filePath={renderModel.filePath} />
    </div>
  );
};

export const FileEditorSurfaceView = ({
  renderModel,
  attachHost,
  diffHostRef,
  previewEnabled,
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
  const kind = previewEnabled ? previewKindFromPath(renderModel.filePath) : null;
  const layout = useFilePreviewLayout(renderModel.filePath);
  const source = body.kind === "empty"
    ? (
      <AppEmptyState
        className="lyra-file-editor-empty-state"
        title={body.message}
        actions={(
          <AppButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRetry}
          >
            {body.retryLabel}
          </AppButton>
        )}
      />
    )
    : (
      <section className="lyra-file-editor-body">
        <div
          ref={attachHost}
          className={body.hostClassName}
        />
        <div
          ref={diffHostRef}
          className={body.diffHostClassName}
        />
      </section>
    );

  return (
    <section
      className={renderModel.surfaceClassName}
      aria-label="file-editor-surface"
    >
      {kind === null ? source : (
        <FilePreviewSplit
          layout={layout}
          source={source}
          preview={(
            <Suspense fallback={<AppLoadingState title={t("editor.viewPreview")} />}>
              <FilePreviewPane
                kind={kind}
                filePath={renderModel.filePath}
                content={renderModel.content}
              />
            </Suspense>
          )}
          resizerLabel={t("editor.viewMode")}
        />
      )}
    </section>
  );
};
