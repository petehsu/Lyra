import { ArrowUpRightSquare } from "lucide-react";
import { useMemo } from "react";

import { LyraBrandLogo } from "../../brand";
import { FileEditorSurface } from "../../file-editor";
import { renderRuntimeKindIcon, renderRuntimeStatusIcon } from "./icon";
import { mapRuntimeItemToFileChangeReviewItem } from "./review-item";
import type { AiPanelRuntimeItem, AiPanelRuntimeWorkspaceStageProps } from "./types";

const LOGO_URL = new URL(
  "../../../../renderer/assets/logo.svg",
  import.meta.url
).toString();

const renderPlaceholderSurface = (
  item: AiPanelRuntimeItem,
  label: string
) => (
  <section className="lyra-ai-runtime-stage-placeholder" aria-label="ai-runtime-placeholder">
    <header className="lyra-ai-runtime-stage-placeholder-head">
      <span className="lyra-ai-runtime-stage-placeholder-icon" aria-hidden="true">
        {renderRuntimeKindIcon(item.kind, 15)}
      </span>
      <strong>{item.title}</strong>
      <span>{label}</span>
    </header>
    <p>{item.summary}</p>
  </section>
);

const renderFileStageLoading = (item: AiPanelRuntimeItem) => (
  <section className="lyra-ai-runtime-stage-placeholder lyra-ai-runtime-stage-placeholder-file" aria-label="ai-runtime-file-loading">
    <header className="lyra-ai-runtime-stage-placeholder-head">
      <span className="lyra-ai-runtime-stage-placeholder-icon" aria-hidden="true">
        {renderRuntimeKindIcon("file", 15)}
      </span>
      <strong>{item.title}</strong>
      <span>{item.filePath ?? item.summary}</span>
    </header>
    <div className="lyra-ai-runtime-stage-placeholder-file-skeleton" aria-hidden="true">
      <span className="lyra-skeleton-block lyra-ai-runtime-stage-placeholder-file-skeleton-title" />
      <span className="lyra-skeleton-block lyra-ai-runtime-stage-placeholder-file-skeleton-line" />
      <span className="lyra-skeleton-block lyra-ai-runtime-stage-placeholder-file-skeleton-line lyra-ai-runtime-stage-placeholder-file-skeleton-line-short" />
      <span className="lyra-skeleton-block lyra-ai-runtime-stage-placeholder-file-skeleton-line" />
    </div>
  </section>
);

export const AiPanelRuntimeWorkspaceStage = ({
  items,
  activeItemId,
  labels,
  fileEditorModel,
  fileEditorLabels,
  taskCardAcceptLabel,
  taskCardRejectLabel,
  taskCardUndoLabel,
  themeSignature,
  onActivateItem,
  onOpenFileInWorkspaceTab,
  onAcceptItem,
  onRejectItem,
  onUndoItem
}: AiPanelRuntimeWorkspaceStageProps) => {
  const activeItem = useMemo(() => {
    if (items.length === 0) {
      return null;
    }
    if (activeItemId !== null) {
      const matched = items.find((item) => item.id === activeItemId);
      if (matched !== undefined) {
        return matched;
      }
    }
    return [...items].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }, [activeItemId, items]);

  const activeEditorState =
    activeItem?.editorInstanceId === undefined
      ? null
      : fileEditorModel.getState(activeItem.editorInstanceId);
  const activeEditorWorkItem =
    activeItem === null ? undefined : mapRuntimeItemToFileChangeReviewItem(activeItem) ?? undefined;
  const runtimeStatusLabel =
    activeItem === null
      ? labels.emptyState
      : activeItem.status === "queued"
        ? labels.statusQueued
        : activeItem.status === "running"
          ? labels.statusRunning
          : activeItem.status === "error"
            ? labels.statusError
            : labels.statusCompleted;

  return (
    <section className="lyra-ai-runtime-workspace-stage" aria-label="ai-runtime-workspace-stage">
      <header className="lyra-ai-runtime-workspace-stage-head">
        <div className="lyra-ai-runtime-workspace-stage-head-main">
          <span className="lyra-ai-runtime-workspace-stage-head-title">{labels.workspaceTitle}</span>
          {activeItem === null ? (
            <span className="lyra-ai-runtime-workspace-stage-head-status lyra-ai-runtime-workspace-stage-head-status-idle">
              {labels.emptyState}
            </span>
          ) : (
            <button
              type="button"
              className="lyra-ai-runtime-workspace-stage-head-status"
              onClick={() => {
                onActivateItem(activeItem.id);
              }}
            >
              <span className="lyra-ai-runtime-workspace-stage-head-status-icon" aria-hidden="true">
                {renderRuntimeStatusIcon(activeItem.status, 11)}
              </span>
              <span>{runtimeStatusLabel}</span>
              <span className="lyra-ai-runtime-workspace-stage-head-separator" aria-hidden="true">
                ·
              </span>
              <span className="lyra-ai-runtime-workspace-stage-head-kind" aria-hidden="true">
                {renderRuntimeKindIcon(activeItem.kind, 12)}
              </span>
              <span className="lyra-ai-runtime-workspace-stage-head-label">{activeItem.title}</span>
            </button>
          )}
        </div>
        {activeItem?.kind === "file" && activeItem.filePath !== undefined ? (
          <button
            type="button"
            className="lyra-ai-runtime-workspace-stage-open-global"
            aria-label={labels.openInWorkspaceTab}
            onClick={() => {
              onOpenFileInWorkspaceTab(activeItem.filePath!);
            }}
          >
            <ArrowUpRightSquare size={13} />
          </button>
        ) : null}
      </header>

      <section className="lyra-ai-runtime-workspace-stage-body">
        {activeItem === null ? (
          <div className="lyra-ai-runtime-workspace-stage-idle">
            <div className="lyra-ai-runtime-workspace-stage-idle-logo" aria-hidden="true">
              <LyraBrandLogo logoUrl={LOGO_URL} className="lyra-ai-runtime-workspace-stage-idle-logo-mark" />
            </div>
            <strong>{labels.workspaceTitle}</strong>
            <span>{labels.emptyState}</span>
          </div>
        ) : activeItem.kind === "file" && activeItem.filePath !== undefined ? (
          <div className="lyra-ai-runtime-workspace-stage-file-shell">
            {activeEditorState === null
              ? renderFileStageLoading(activeItem)
              : (
                <FileEditorSurface
                  state={activeEditorState}
                  labels={fileEditorLabels}
                  model={fileEditorModel}
                  themeSignature={themeSignature}
                  surfaceVariant="ai-workspace"
                  controlMode="ai_only"
                  editorWorkAcceptLabel={taskCardAcceptLabel}
                  editorWorkRejectLabel={taskCardRejectLabel}
                  editorWorkUndoLabel={taskCardUndoLabel}
                  {...(activeEditorWorkItem === undefined
                    ? {}
                    : { activeEditorWorkItem })}
                  {...(onAcceptItem === undefined || activeEditorWorkItem === undefined
                    ? {}
                    : { onAcceptEditorWorkItem: () => onAcceptItem(activeItem.id) })}
                  {...(onRejectItem === undefined || activeEditorWorkItem === undefined
                    ? {}
                    : { onRejectEditorWorkItem: () => onRejectItem(activeItem.id) })}
                  {...(onUndoItem === undefined || activeEditorWorkItem === undefined
                    ? {}
                    : { onUndoEditorWorkItem: () => onUndoItem(activeItem.id) })}
                />
              )}
          </div>
        ) : activeItem.kind === "file" ? (
          renderFileStageLoading(activeItem)
        ) : activeItem.kind === "web" ? (
          renderPlaceholderSurface(activeItem, labels.kindWeb)
        ) : (
          renderPlaceholderSurface(activeItem, labels.kindApp)
        )}
      </section>
    </section>
  );
};
