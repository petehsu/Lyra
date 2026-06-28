import { AppErrorState } from "@renderer/ui/components";

import { FileManagerDirectoryContent } from "./surface-directory";
import { FileManagerDownloadsContent } from "./surface-downloads";
import { FileManagerFavoritesContent, FileManagerHomeContent } from "./surface-home";
import { FileManagerLoadingSkeleton } from "./surface-loading";
import { FileManagerTrashContent } from "./surface-trash";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerContent = ({
  renderModel,
  labels,
  actions,
  searchIndex
}: FileManagerSurfaceViewProps) => (
  <section
    className="lyra-file-manager-content"
    onContextMenu={(event) => {
      if (renderModel.viewKind !== "directory" && renderModel.viewKind !== "trash") {
        return;
      }
      event.preventDefault();
      actions.onContentContextMenu(event.clientX, event.clientY);
    }}
  >
    {renderModel.body.kind === "loading" ? (
      <FileManagerLoadingSkeleton
        viewKind={renderModel.viewKind}
        presentationMode={renderModel.presentationMode}
        slots={renderModel.body.skeletonSlots}
      />
    ) : null}

    {renderModel.body.kind === "error" ? (
      <AppErrorState
        className="lyra-file-manager-empty-state"
        title={renderModel.body.message ?? labels.unavailable}
      />
    ) : null}

    <FileManagerHomeContent
      renderModel={renderModel}
      labels={labels}
      actions={actions}
      searchIndex={searchIndex}
    />
    <FileManagerFavoritesContent
      renderModel={renderModel}
      labels={labels}
      actions={actions}
      searchIndex={searchIndex}
    />
    <FileManagerDirectoryContent
      renderModel={renderModel}
      labels={labels}
      actions={actions}
      searchIndex={searchIndex}
    />
    <FileManagerTrashContent
      renderModel={renderModel}
      labels={labels}
      actions={actions}
      searchIndex={searchIndex}
    />
    <FileManagerDownloadsContent
      renderModel={renderModel}
      labels={labels}
      actions={actions}
      searchIndex={searchIndex}
    />
  </section>
);
