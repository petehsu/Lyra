import { useMemo } from "react";

import { createFileEditorRenderModel } from "./render-model";
import {
  FileEditorSurfaceView,
  FileEditorTitlebarContent
} from "./surface-view";
import type { FileEditorSurfaceProps } from "./surface-types";
import { useFileEditorRuntime } from "./use-file-editor-runtime";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type { FileEditorSurfaceProps } from "./surface-types";

const FileEditorTitlebarBridge = ({
  renderModel,
  onToggleDiff,
  onSave,
  onGoToPreviousEditorWorkItem,
  onGoToNextEditorWorkItem,
  onAcceptAllEditorWorkItems,
  onAcceptEditorWorkItem,
  onRejectEditorWorkItem,
  onUndoEditorWorkItem
}: Pick<
  Parameters<typeof FileEditorTitlebarContent>[0],
  | "renderModel"
  | "onToggleDiff"
  | "onSave"
  | "onGoToPreviousEditorWorkItem"
  | "onGoToNextEditorWorkItem"
  | "onAcceptAllEditorWorkItems"
  | "onAcceptEditorWorkItem"
  | "onRejectEditorWorkItem"
  | "onUndoEditorWorkItem"
>) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: renderModel.toolbar.title,
      content: (
        <FileEditorTitlebarContent
          renderModel={renderModel}
          onToggleDiff={onToggleDiff}
          onSave={onSave}
          onGoToPreviousEditorWorkItem={onGoToPreviousEditorWorkItem}
          onGoToNextEditorWorkItem={onGoToNextEditorWorkItem}
          onAcceptAllEditorWorkItems={onAcceptAllEditorWorkItems}
          onAcceptEditorWorkItem={onAcceptEditorWorkItem}
          onRejectEditorWorkItem={onRejectEditorWorkItem}
          onUndoEditorWorkItem={onUndoEditorWorkItem}
        />
      )
    }),
    [
      onAcceptAllEditorWorkItems,
      onAcceptEditorWorkItem,
      onGoToNextEditorWorkItem,
      onGoToPreviousEditorWorkItem,
      onRejectEditorWorkItem,
      onSave,
      onToggleDiff,
      onUndoEditorWorkItem,
      renderModel
    ]
  );
  useWorkbenchTitlebarContribution(contribution);
  return null;
};

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

  const onToggleDiff = () => {
    runtime.setIsDiffMode((current) => !current);
  };
  const onSave = () => {
    void model.save(renderModel.stateInstanceId, "manual");
  };

  return (
    <>
      <FileEditorTitlebarBridge
        renderModel={renderModel}
        onToggleDiff={onToggleDiff}
        onSave={onSave}
        onGoToPreviousEditorWorkItem={onGoToPreviousEditorWorkItem}
        onGoToNextEditorWorkItem={onGoToNextEditorWorkItem}
        onAcceptAllEditorWorkItems={onAcceptAllEditorWorkItems}
        onAcceptEditorWorkItem={onAcceptEditorWorkItem}
        onRejectEditorWorkItem={onRejectEditorWorkItem}
        onUndoEditorWorkItem={onUndoEditorWorkItem}
      />
    <FileEditorSurfaceView
      renderModel={renderModel}
      hostRef={runtime.hostRef}
      diffHostRef={runtime.diffHostRef}
      onToggleDiff={onToggleDiff}
      onSave={onSave}
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
    </>
  );
};
