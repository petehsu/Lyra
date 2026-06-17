import { Check } from "lucide-react";

import { AppButton } from "@renderer/ui/components";
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
          {chooserBar.promptLabel}
        </span>
        <span className="lyra-file-manager-chooser-path">
          {chooserBar.path ?? chooserBar.selectionPlaceholder}
        </span>
      </div>
      <AppButton
        variant="ghost"
        size="sm"
        className="lyra-file-manager-chooser-confirm"
        disabled={!chooserBar.canConfirm}
        onClick={() => {
          if (!chooserBar.canConfirm) {
            return;
          }
          actions.onConfirmChooser();
        }}
      >
        <Check size={14} aria-hidden="true" />
        <span>{chooserBar.confirmLabel}</span>
      </AppButton>
    </footer>
  );
};
