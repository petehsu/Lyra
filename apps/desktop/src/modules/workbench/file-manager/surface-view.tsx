import { FileManagerChooserBar } from "./surface-chooser-bar";
import { FileManagerContent } from "./surface-content";
import { FileManagerSidebar } from "./surface-sidebar";
import { FileManagerToolbar } from "./surface-toolbar";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export type { FileManagerSurfaceActions } from "./surface-view-types";

export const FileManagerSurfaceView = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => (
  <section className="lyra-file-manager-surface" aria-label="file-manager-surface">
    <FileManagerToolbar
      renderModel={renderModel}
      labels={labels}
      actions={actions}
    />
    <section className="lyra-file-manager-layout">
      <FileManagerSidebar
        renderModel={renderModel}
        labels={labels}
        actions={actions}
      />
      <FileManagerContent
        renderModel={renderModel}
        labels={labels}
        actions={actions}
      />
    </section>
    <FileManagerChooserBar
      renderModel={renderModel}
      labels={labels}
      actions={actions}
    />
  </section>
);
