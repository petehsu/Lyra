import { FileManagerChooserBar } from "./surface-chooser-bar";
import { FileManagerContent } from "./surface-content";
import { FileManagerSidebar } from "./surface-sidebar";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export type { FileManagerSurfaceActions } from "./surface-view-types";

export const FileManagerSurfaceView = ({
  renderModel,
  labels,
  actions,
  searchIndex
}: FileManagerSurfaceViewProps) => (
  <section className="lyra-file-manager-surface" aria-label="file-manager-surface">
    <section className="lyra-file-manager-layout">
      <FileManagerSidebar
        renderModel={renderModel}
        labels={labels}
        actions={actions}
        searchIndex={searchIndex}
      />
      <FileManagerContent
        renderModel={renderModel}
        labels={labels}
        actions={actions}
        searchIndex={searchIndex}
      />
    </section>
    <FileManagerChooserBar
      renderModel={renderModel}
      labels={labels}
      actions={actions}
      searchIndex={searchIndex}
    />
  </section>
);
