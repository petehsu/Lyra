import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List,
  RefreshCw,
  RotateCcw,
  Star,
  StarOff,
  Trash2
} from "lucide-react";
import { Fragment } from "react";

import type { FileManagerSurfaceRenderModel } from "./surface-model";
import type { FileManagerSurfaceLabels } from "./types";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

const FileManagerBreadcrumbs = ({
  renderModel,
  labels,
  onOpenBreadcrumb
}: {
  readonly renderModel: FileManagerSurfaceRenderModel;
  readonly labels: FileManagerSurfaceLabels;
  readonly onOpenBreadcrumb: (path: string) => void;
}) => {
  const breadcrumb = renderModel.breadcrumb;
  return (
    <div className="lyra-file-manager-breadcrumbs" aria-label="file-manager-breadcrumbs">
      {breadcrumb.kind === "home" ? (
        <span className="lyra-file-manager-breadcrumb-current">{labels.title}</span>
      ) : breadcrumb.kind === "trash" ? (
        <span className="lyra-file-manager-breadcrumb-current">
          {breadcrumb.title || labels.title}
        </span>
      ) : breadcrumb.kind === "path" ? (
        breadcrumb.parts.map((part, index) => (
          <Fragment key={part.id}>
            <button
              className={
                index === breadcrumb.parts.length - 1
                  ? "lyra-file-manager-breadcrumb lyra-file-manager-breadcrumb-active"
                  : "lyra-file-manager-breadcrumb"
              }
              onClick={() => {
                onOpenBreadcrumb(part.path);
              }}
            >
              {part.title}
            </button>
            {index < breadcrumb.parts.length - 1 ? <i aria-hidden="true">/</i> : null}
          </Fragment>
        ))
      ) : (
        <span className="lyra-file-manager-breadcrumb-current">
          {breadcrumb.title || labels.title}
        </span>
      )}
    </div>
  );
};

export const FileManagerToolbar = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  const toolbar = renderModel.toolbar;
  return (
    <header className="lyra-file-manager-toolbar">
      <div className="lyra-file-manager-toolbar-group">
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.navigationBack}
          disabled={!toolbar.canGoBack}
          onClick={actions.onGoBack}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.navigationForward}
          disabled={!toolbar.canGoForward}
          onClick={actions.onGoForward}
        >
          <ChevronRight size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.navigationUp}
          disabled={!toolbar.canGoUp}
          onClick={actions.onGoUp}
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.refresh}
          onClick={actions.onRefresh}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <FileManagerBreadcrumbs
        renderModel={renderModel}
        labels={labels}
        onOpenBreadcrumb={actions.onOpenBreadcrumb}
      />

      <div className="lyra-file-manager-toolbar-group">
        <button
          className={
            toolbar.isLargeMode
              ? "lyra-file-manager-tool-button"
              : "lyra-file-manager-tool-button lyra-file-manager-tool-button-active"
          }
          aria-label={labels.viewList}
          onClick={() => {
            actions.onSetPresentationMode("list");
          }}
        >
          <List size={14} />
        </button>
        <button
          className={
            toolbar.isLargeMode
              ? "lyra-file-manager-tool-button lyra-file-manager-tool-button-active"
              : "lyra-file-manager-tool-button"
          }
          aria-label={labels.viewLarge}
          onClick={() => {
            actions.onSetPresentationMode("large");
          }}
        >
          <LayoutGrid size={14} />
        </button>
        <button
          className={toolbar.favoriteActive ? "lyra-file-manager-tool-button lyra-file-manager-tool-button-active" : "lyra-file-manager-tool-button"}
          aria-label={toolbar.favoriteActive ? labels.removeFavorite : labels.addFavorite}
          disabled={toolbar.favoriteDisabled}
          onClick={actions.onToggleFavorite}
        >
          {toolbar.favoriteActive ? <StarOff size={14} /> : <Star size={14} />}
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.newFolder}
          disabled={!toolbar.canCreateDraft}
          onClick={() => {
            actions.onBeginCreateDraft("directory");
          }}
        >
          <FolderPlus size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.newFile}
          disabled={!toolbar.canCreateDraft}
          onClick={() => {
            actions.onBeginCreateDraft("file");
          }}
        >
          <FilePlus2 size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.delete}
          disabled={!toolbar.canMoveSelectionToTrash}
          onClick={actions.onMoveSelectionToTrash}
        >
          <Trash2 size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button"
          aria-label={labels.restore}
          disabled={!toolbar.canRestoreSelectionFromTrash}
          onClick={actions.onRestoreSelectionFromTrash}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="lyra-file-manager-tool-button lyra-file-manager-tool-button-danger"
          aria-label={labels.emptyTrash}
          disabled={!toolbar.canEmptyTrash}
          onClick={actions.onEmptyTrash}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </header>
  );
};
