import { createFileEditorRenderModel } from "./render-model";
import { FileEditorSurfaceView } from "./surface-view";
import type { FileEditorSurfaceProps } from "./surface-types";
import { useFileEditorRuntime } from "./use-file-editor-runtime";

export type { FileEditorSurfaceProps } from "./surface-types";

export const FileEditorSurface = ({
  state,
  labels,
  themeSignature,
  model,
  surfaceVariant = "full",
  controlMode = "human_takeover",
  editorWorkAcceptLabel,
  editorWorkRejectLabel,
  editorWorkUndoLabel,
  editorWorkPrevLabel,
  editorWorkNextLabel,
  editorWorkAcceptAllLabel,
  canGoToPreviousEditorWorkItem = false,
  canGoToNextEditorWorkItem = false,
  canAcceptAllEditorWorkItems = false,
  activeEditorWorkItem,
  onGoToPreviousEditorWorkItem,
  onGoToNextEditorWorkItem,
  onAcceptAllEditorWorkItems,
  onAcceptEditorWorkItem,
  onRejectEditorWorkItem,
  onUndoEditorWorkItem
}: FileEditorSurfaceProps) => {
  const runtime = useFileEditorRuntime({
    state,
    themeSignature,
    model,
    controlMode,
    activeEditorWorkItem
  });
  const renderModel = createFileEditorRenderModel({
    state,
    labels,
    surfaceVariant,
    controlMode,
    isDiffMode: runtime.isDiffMode,
    canToggleDiff: runtime.canToggleDiff,
    showLoadingSkeleton: runtime.showLoadingSkeleton,
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

  if (renderModel === null) {
    return null;
  }

  return (
    <FileEditorSurfaceView
      renderModel={renderModel}
      hostRef={runtime.hostRef}
      diffHostRef={runtime.diffHostRef}
      onToggleDiff={() => {
        runtime.setIsDiffMode((current) => !current);
      }}
      onSave={() => {
        void model.save(renderModel.stateInstanceId, "manual");
      }}
      onRetry={() => {
        void model.openFile(renderModel.stateInstanceId, renderModel.filePath);
      }}
      onGoToPreviousEditorWorkItem={onGoToPreviousEditorWorkItem}
      onGoToNextEditorWorkItem={onGoToNextEditorWorkItem}
      onAcceptAllEditorWorkItems={onAcceptAllEditorWorkItems}
      onAcceptEditorWorkItem={onAcceptEditorWorkItem}
      onRejectEditorWorkItem={onRejectEditorWorkItem}
      onUndoEditorWorkItem={onUndoEditorWorkItem}
    />
  );
};
