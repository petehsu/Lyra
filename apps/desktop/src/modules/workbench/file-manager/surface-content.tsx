import { AppErrorState, AppLoadingState } from "@renderer/ui/components";

import { FileManagerDirectoryContent } from "./surface-directory";
import { FileManagerDownloadsSlot } from "./downloads-slot";
import { FileManagerFavoritesContent, FileManagerHomeContent } from "./surface-home";
import { FileManagerLoadingSkeleton } from "./surface-loading";
import { FileManagerTrashContent } from "./surface-trash";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerContent = ({
  renderModel,
  labels,
  actions,
  instanceId,
  downloadsSlot
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
    <div className="lyra-file-manager-content-scroll">
      {renderModel.body.kind === "loading" ? (
        <>
          <AppLoadingState
            className="lyra-file-manager-empty-state"
            density="compact"
            title={labels.loading}
          />
          <FileManagerLoadingSkeleton
            viewKind={renderModel.viewKind}
            presentationMode={renderModel.presentationMode}
            slots={renderModel.body.skeletonSlots}
          />
        </>
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
      />
      <FileManagerFavoritesContent
        renderModel={renderModel}
        labels={labels}
        actions={actions}
      />
      <FileManagerDirectoryContent
        renderModel={renderModel}
        labels={labels}
        actions={actions}
      />
      <FileManagerTrashContent
        renderModel={renderModel}
        labels={labels}
        actions={actions}
      />
      {renderModel.body.kind === "downloads" ? (
        <FileManagerDownloadsSlot
          fileManagerInstanceId={instanceId}
          title={downloadsSlot.title}
          repairLabel={downloadsSlot.repairLabel}
          description={downloadsSlot.description}
          startFailedDescription={downloadsSlot.startFailedDescription}
          onRepair={downloadsSlot.onRepair}
        />
      ) : null}
    </div>
    {renderModel.osBrandUrl === null ? null : (
      <img
        className="lyra-file-manager-os-watermark"
        src={renderModel.osBrandUrl}
        alt=""
        aria-hidden="true"
      />
    )}
  </section>
);
