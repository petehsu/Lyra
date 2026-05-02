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
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

const FileManagerBreadcrumbs = ({
  renderModel,
  onOpenBreadcrumb
}: {
  readonly renderModel: FileManagerSurfaceRenderModel;
  readonly onOpenBreadcrumb: (path: string) => void;
}) => {
  const breadcrumb = renderModel.breadcrumb;
  if (breadcrumb.kind === "home") {
    return null;
  }
  if (breadcrumb.kind === "favorites") {
    return null;
  }

  return (
    <div className="lyra-titlebar-context-group lyra-file-manager-titlebar-breadcrumbs" aria-label="file-manager-breadcrumbs">
      {breadcrumb.kind === "trash" && breadcrumb.title.length > 0 ? (
        <span className="lyra-titlebar-context-text">
          {breadcrumb.title}
        </span>
      ) : breadcrumb.kind === "path" ? (
        breadcrumb.parts.map((part, index) => (
          <Fragment key={part.id}>
            {index === breadcrumb.parts.length - 1 ? (
              <span className="lyra-titlebar-context-text lyra-file-manager-titlebar-breadcrumb-current">
                {part.title}
              </span>
            ) : (
              <button
                className="lyra-titlebar-context-text-button"
                title={part.path}
                onClick={() => {
                  onOpenBreadcrumb(part.path);
                }}
              >
                {part.title}
              </button>
            )}
            {index < breadcrumb.parts.length - 1 && part.title !== "/" ? (
              <span className="lyra-file-manager-titlebar-breadcrumb-separator" aria-hidden="true">/</span>
            ) : null}
          </Fragment>
        ))
      ) : breadcrumb.title.length > 0 ? (
        <span className="lyra-titlebar-context-text">
          {breadcrumb.title}
        </span>
      ) : (
        null
      )}
    </div>
  );
};

export const FileManagerToolbarContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  const toolbar = renderModel.toolbar;
  return (
    <>
      <div className="lyra-titlebar-context-group">
        <button
          className="lyra-titlebar-context-icon-button"
          aria-label={labels.navigationBack}
          title={labels.navigationBack}
          disabled={!toolbar.canGoBack}
          onClick={actions.onGoBack}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          className="lyra-titlebar-context-icon-button"
          aria-label={labels.navigationForward}
          title={labels.navigationForward}
          disabled={!toolbar.canGoForward}
          onClick={actions.onGoForward}
        >
          <ChevronRight size={14} />
        </button>
        <button
          className="lyra-titlebar-context-icon-button"
          aria-label={labels.navigationUp}
          title={labels.navigationUp}
          disabled={!toolbar.canGoUp}
          onClick={actions.onGoUp}
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="lyra-titlebar-context-icon-button"
          aria-label={labels.refresh}
          title={labels.refresh}
          onClick={actions.onRefresh}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <FileManagerBreadcrumbs
        renderModel={renderModel}
        onOpenBreadcrumb={actions.onOpenBreadcrumb}
      />

      <div className="lyra-titlebar-context-group">
        {toolbar.isLargeMode ? (
          <button
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.viewList}
            title={labels.viewList}
            onClick={() => {
              actions.onSetPresentationMode("list");
            }}
          >
            <List size={14} />
          </button>
        ) : (
          <button
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.viewLarge}
            title={labels.viewLarge}
            onClick={() => {
              actions.onSetPresentationMode("large");
            }}
          >
            <LayoutGrid size={14} />
          </button>
        )}
        {toolbar.favoriteDisabled ? null : (
          <button
            className={toolbar.favoriteActive ? "lyra-titlebar-context-icon-button lyra-titlebar-context-button-active" : "lyra-titlebar-context-icon-button"}
            aria-label={toolbar.favoriteActive ? labels.removeFavorite : labels.addFavorite}
            title={toolbar.favoriteActive ? labels.removeFavorite : labels.addFavorite}
            onClick={actions.onToggleFavorite}
          >
            {toolbar.favoriteActive ? <StarOff size={14} /> : <Star size={14} />}
          </button>
        )}
        {toolbar.canCreateDraft ? (
          <>
            <button
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.newFolder}
              title={labels.newFolder}
              onClick={() => {
                actions.onBeginCreateDraft("directory");
              }}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="lyra-titlebar-context-icon-button"
              aria-label={labels.newFile}
              title={labels.newFile}
              onClick={() => {
                actions.onBeginCreateDraft("file");
              }}
            >
              <FilePlus2 size={14} />
            </button>
          </>
        ) : null}
        {toolbar.canMoveSelectionToTrash ? (
          <button
            className="lyra-titlebar-context-icon-button lyra-titlebar-context-danger"
            aria-label={labels.delete}
            title={labels.delete}
            onClick={actions.onMoveSelectionToTrash}
          >
            <Trash2 size={14} />
          </button>
        ) : null}
        {toolbar.canRestoreSelectionFromTrash ? (
          <button
            className="lyra-titlebar-context-icon-button"
            aria-label={labels.restore}
            title={labels.restore}
            onClick={actions.onRestoreSelectionFromTrash}
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
        {toolbar.canEmptyTrash ? (
          <button
            className="lyra-titlebar-context-icon-button lyra-titlebar-context-danger"
            aria-label={labels.emptyTrash}
            title={labels.emptyTrash}
            onClick={actions.onEmptyTrash}
          >
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
    </>
  );
};
