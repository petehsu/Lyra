import { Check, Copy, Undo2, X } from "lucide-react";

import type {
  AiComputerSessionState,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import { AiComputerAppSurface } from "../computer/app-surface";
import { AiComputerWindowFrame as AiComputerPreviewWindow } from "../computer/window-frame";
import type { AiComputerLabels } from "../computer/types";
import { FileEditorSurface, type FileEditorLabels, type FileEditorModel } from "../../file-editor";
import type { FileManagerModel, FileManagerSurfaceLabels } from "../../file-manager";
import type { TerminalDockLabels } from "../../terminal-dock";
import type { TerminalThemePresetId } from "../../terminal-theme";
import { toTaskCardItem, useTaskCardRenderer } from "../task-card";
import { renderRuntimeKindIcon, renderRuntimeStatusIcon } from "./icon";
import { mapRuntimeItemToFileChangeReviewItem } from "./review-item";
import type { AiPanelRuntimeItem, AiPanelRuntimeLabels, AiPanelRuntimePresentation } from "./types";

type AiPanelRuntimeTimelineEntryProps = {
  readonly item: AiPanelRuntimeItem;
  readonly presentation: AiPanelRuntimePresentation;
  readonly labels: AiPanelRuntimeLabels;
  readonly computerLabels?: AiComputerLabels;
  readonly computerState?: AiComputerSessionState | null;
  readonly desktopApi?: LyraDesktopApi | null;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly acceptLabel: string;
  readonly rejectLabel: string;
  readonly undoLabel: string;
  readonly openLabel: string;
  readonly openInWorkspaceLabel: string;
  readonly isCopied: boolean;
  readonly onCopy: (item: AiPanelRuntimeItem) => void;
  readonly onActivate: (itemId: string) => void;
  readonly onOpenInWorkspaceTab?: (filePath: string) => void;
  readonly onAccept?: (itemId: string) => void;
  readonly onReject?: (itemId: string) => void;
  readonly onUndo?: (itemId: string) => void;
  readonly fileEditorModel?: FileEditorModel;
  readonly fileEditorLabels?: FileEditorLabels;
  readonly fileManagerModel?: FileManagerModel;
  readonly fileManagerLabels?: FileManagerSurfaceLabels;
  readonly terminalLabels?: TerminalDockLabels;
  readonly terminalThemeSignature?: string;
  readonly terminalThemePreset?: TerminalThemePresetId;
  readonly uiThemeId?: string;
};

const resolveStatusLabel = (item: AiPanelRuntimeItem, labels: AiPanelRuntimeLabels): string => {
  if (item.status === "queued") {
    return labels.statusQueued;
  }
  if (item.status === "running") {
    return labels.statusRunning;
  }
  if (item.status === "error") {
    return labels.statusError;
  }
  return labels.statusCompleted;
};

const shouldShowReviewActions = (item: AiPanelRuntimeItem): boolean =>
  item.kind === "file" &&
  (item.status === "completed" || item.status === "collapsing" || item.status === "collapsed");

const isWorkingTaskCardStatus = (status: AiPanelRuntimeItem["status"]): boolean =>
  status === "queued" || status === "running" || status === "collapsing";

const renderTaskCardScanText = (
  text: string,
  keyPrefix: string
) =>
  Array.from(text).map((char, index) => (
    <span
      key={`${keyPrefix}-char-${index}`}
      className="lyra-ai-task-card-scan-char"
      style={{ animationDelay: `${index * 26}ms` }}
    >
      {char === " " ? "\u00A0" : char}
    </span>
  ));

export const AiPanelRuntimeTimelineEntry = ({
  item,
  presentation,
  labels,
  computerLabels,
  computerState,
  desktopApi,
  copyLabel,
  copiedLabel,
  acceptLabel,
  rejectLabel,
  undoLabel,
  openLabel,
  openInWorkspaceLabel,
  isCopied,
  onCopy,
  onActivate,
  onOpenInWorkspaceTab,
  onAccept,
  onReject,
  onUndo,
  fileEditorModel,
  fileEditorLabels,
  fileManagerModel,
  fileManagerLabels,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  uiThemeId
}: AiPanelRuntimeTimelineEntryProps) => {
  const taskCardItem = toTaskCardItem(item, presentation);
  const taskCardRenderer = useTaskCardRenderer(taskCardItem.kind);
  const isWindow = presentation === "window";
  const isWorking = isWorkingTaskCardStatus(item.status);
  const computerApp =
    item.computerAppInstanceId === undefined
      ? null
      : computerState?.openApps.find((entry) => entry.id === item.computerAppInstanceId) ?? null;
  const runtimeEditorState =
    item.editorInstanceId === undefined || fileEditorModel === undefined
      ? null
      : fileEditorModel.getState(item.editorInstanceId);
  const runtimeReviewItem = mapRuntimeItemToFileChangeReviewItem(item) ?? undefined;
  const canRenderMiniEditor =
    isWindow
    && item.kind === "file"
    && runtimeEditorState !== null
    && fileEditorLabels !== undefined
    && uiThemeId !== undefined
    && runtimeReviewItem !== undefined;
  const canRenderComputerPreview =
    isWindow
    && computerApp !== null
    && computerLabels !== undefined
    && fileManagerModel !== undefined
    && fileManagerLabels !== undefined
    && fileEditorModel !== undefined
    && fileEditorLabels !== undefined
    && terminalLabels !== undefined
    && terminalThemeSignature !== undefined
    && terminalThemePreset !== undefined
    && uiThemeId !== undefined;

  const itemClassName = [
    "lyra-ai-runtime-item",
    isWindow
      ? "lyra-ai-runtime-item-window"
      : "lyra-ai-runtime-item-capsule",
    `lyra-ai-runtime-item-status-${item.status}`,
    item.decision === "accepted" ? "lyra-ai-runtime-item-accepted" : "",
    item.decision === "rejected" ? "lyra-ai-runtime-item-rejected" : ""
  ]
    .filter((entry) => entry.length > 0)
    .join(" ");

  const openFilePath = item.filePath;

  return (
    <article className="lyra-ai-message-row lyra-ai-message-row-assistant lyra-ai-runtime-row">
      {isWindow ? (
        <div
          className={itemClassName}
          role="button"
          tabIndex={0}
          aria-label={`${openLabel} ${item.title}`}
          onClick={() => {
            onActivate(item.id);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            onActivate(item.id);
          }}
        >
          <div className="lyra-ai-runtime-item-head">
            <span className="lyra-ai-runtime-item-kind-icon" aria-hidden="true">
              {renderRuntimeKindIcon(item.kind, 13)}
            </span>
            <strong className="lyra-ai-runtime-item-title">{item.title}</strong>
            <span className={`lyra-ai-runtime-item-status lyra-ai-runtime-item-status-${item.status}`}>
              {renderRuntimeStatusIcon(item.status, 11)}
              <span>{resolveStatusLabel(item, labels)}</span>
            </span>
          </div>

          <div className="lyra-ai-runtime-item-window-body">
            {openFilePath !== undefined ? (
              <div className="lyra-ai-runtime-item-file-row">
                <span className="lyra-ai-runtime-item-file-path" title={openFilePath}>
                  {openFilePath}
                </span>
                {onOpenInWorkspaceTab !== undefined ? (
                  <button
                    type="button"
                    className="lyra-ai-runtime-item-action"
                    aria-label={openInWorkspaceLabel}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenInWorkspaceTab(openFilePath);
                    }}
                  >
                    {renderRuntimeKindIcon("file", 12)}
                  </button>
                ) : null}
              </div>
            ) : null}
            {canRenderComputerPreview ? (
              <div className="lyra-ai-runtime-item-window-preview lyra-ai-runtime-item-window-preview-computer">
                <AiComputerPreviewWindow
                  app={computerApp!}
                  variant="timeline"
                  isActive
                  title={computerApp!.title}
                  statusText={
                    item.status === "queued" || item.status === "running" || item.status === "collapsing"
                      ? item.summary
                      : resolveStatusLabel(item, labels)
                  }
                  minimizeLabel={acceptLabel}
                  maximizeLabel={rejectLabel}
                  restoreLabel={undoLabel}
                  closeLabel={copyLabel}
                >
                  <div className="lyra-ai-runtime-item-window-preview-surface">
                    <AiComputerAppSurface
                      app={computerApp}
                      variant="timeline"
                      labels={computerLabels!}
                      desktopApi={desktopApi ?? null}
                      fileManagerModel={fileManagerModel!}
                      fileManagerLabels={fileManagerLabels!}
                      fileEditorModel={fileEditorModel!}
                      fileEditorLabels={fileEditorLabels!}
                      terminalLabels={terminalLabels!}
                      terminalThemeSignature={terminalThemeSignature!}
                      terminalThemePreset={terminalThemePreset!}
                      uiThemeId={uiThemeId!}
                    />
                  </div>
                </AiComputerPreviewWindow>
              </div>
            ) : canRenderMiniEditor ? (
              <div className="lyra-ai-runtime-item-window-preview">
                <FileEditorSurface
                  state={runtimeEditorState}
                  labels={fileEditorLabels}
                  model={fileEditorModel!}
                  themeSignature={uiThemeId!}
                  surfaceVariant="ai-miniature"
                  controlMode="ai_only"
                  activeEditorWorkItem={runtimeReviewItem}
                  editorWorkAcceptLabel={acceptLabel}
                  editorWorkRejectLabel={rejectLabel}
                  editorWorkUndoLabel={undoLabel}
                  {...(onAccept === undefined
                    ? {}
                    : { onAcceptEditorWorkItem: () => onAccept(item.id) })}
                  {...(onReject === undefined
                    ? {}
                    : { onRejectEditorWorkItem: () => onReject(item.id) })}
                  {...(onUndo === undefined
                    ? {}
                    : { onUndoEditorWorkItem: () => onUndo(item.id) })}
                />
              </div>
            ) : (
              <div className="lyra-ai-runtime-item-placeholder">{item.summary}</div>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`${itemClassName} lyra-ai-task-card lyra-ai-task-card-capsule`}
          role="button"
          tabIndex={0}
          aria-label={`${openLabel} ${item.title}`}
          onClick={() => {
            onActivate(item.id);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            onActivate(item.id);
          }}
        >
          <span className="lyra-ai-task-card-status-icon" aria-hidden="true">
            {renderRuntimeStatusIcon(item.status, 12)}
          </span>
          <span className="lyra-ai-task-card-kind-icon" aria-hidden="true">
            {renderRuntimeKindIcon(item.kind, 13)}
          </span>
          {taskCardRenderer({
            item: taskCardItem,
            isWorking,
            renderScanText: renderTaskCardScanText
          })}
          <span className="lyra-ai-task-card-state">{resolveStatusLabel(item, labels)}</span>
          <span className="lyra-ai-task-card-actions">
            {shouldShowReviewActions(item) ? (
              item.decision === "accepted" ? (
                <button
                  type="button"
                  className="lyra-ai-task-card-action lyra-ai-task-card-action-undo"
                  aria-label={undoLabel}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onUndo?.(item.id);
                  }}
                >
                  <Undo2 size={12} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="lyra-ai-task-card-action lyra-ai-task-card-action-accept"
                    aria-label={acceptLabel}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onAccept?.(item.id);
                    }}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    className={
                      item.decision === "rejected"
                        ? "lyra-ai-task-card-action lyra-ai-task-card-action-reject lyra-ai-task-card-action-rejected"
                        : "lyra-ai-task-card-action lyra-ai-task-card-action-reject"
                    }
                    aria-label={rejectLabel}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onReject?.(item.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </>
              )
            ) : null}
            <button
              type="button"
              className="lyra-ai-task-card-copy"
              aria-label={isCopied ? copiedLabel : copyLabel}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCopy(item);
              }}
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </span>
        </div>
      )}
    </article>
  );
};
