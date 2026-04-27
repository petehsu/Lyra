import { Check } from "lucide-react";

import type { FileManagerSurfaceViewProps } from "./surface-view-types";

export const FileManagerChooserBar = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  const chooserBar = renderModel.chooserBar;
  if (chooserBar === null) {
    return null;
  }
  return (
    <footer className="lyra-file-manager-chooser-bar">
      <div className="lyra-file-manager-chooser-copy">
        <span className="lyra-file-manager-chooser-label">
          {labels.chooserBindProjectLabel}
        </span>
        <span className="lyra-file-manager-chooser-path">
          {chooserBar.path ?? labels.unavailable}
        </span>
      </div>
      <button
        type="button"
        className="lyra-file-manager-chooser-confirm"
        disabled={!chooserBar.canConfirm}
        onClick={() => {
          if (!chooserBar.canConfirm) {
            return;
          }
          actions.onConfirmChooser();
        }}
      >
        <Check size={14} />
        <span>{chooserBar.confirmLabel}</span>
      </button>
    </footer>
  );
};
