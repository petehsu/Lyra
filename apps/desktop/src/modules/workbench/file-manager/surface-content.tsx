import { FileManagerDirectoryContent } from "./surface-directory";
import { FileManagerHomeContent } from "./surface-home";
import { FileManagerLoadingSkeleton } from "./surface-loading";
import { FileManagerTrashContent } from "./surface-trash";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerContent = ({
  renderModel,
  labels,
  actions
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
      <div className="lyra-file-manager-empty-state lyra-file-manager-empty-state-error">
        {renderModel.body.message ?? labels.unavailable}
      </div>
    ) : null}

    <FileManagerHomeContent
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
  </section>
);
