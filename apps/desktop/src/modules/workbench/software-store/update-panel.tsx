import {
  AppButton,
  AppStatusMessage,
  AppSurfaceHeader,
  AppTabs,
  type AppTabOption
} from "@renderer/ui/components";
import { Download, X } from "lucide-react";
import { useMemo } from "react";

import type {
  ComponentUpdateChannel,
  ComponentUpdateProgress
} from "../../../shared/desktop-bridge";
import type { SoftwareStoreLabels } from "./types";

export const SoftwareStoreComponentUpdatePanel = ({
  labels,
  available,
  busy,
  channel,
  progress,
  onChannelChange,
  onStage,
  onCancel
}: {
  readonly labels: SoftwareStoreLabels;
  readonly available: boolean;
  readonly busy: boolean;
  readonly channel: ComponentUpdateChannel;
  readonly progress: ComponentUpdateProgress | null;
  readonly onChannelChange: (channel: ComponentUpdateChannel) => void;
  readonly onStage: () => void;
  readonly onCancel: () => void;
}) => {
  const options = useMemo<readonly AppTabOption<ComponentUpdateChannel>[]>(() => [
    { value: "stable", label: labels.stableChannel },
    { value: "preview", label: labels.previewChannel }
  ], [labels.previewChannel, labels.stableChannel]);
  return (
    <section className="lyra-software-store-update" aria-label={labels.updateTitle}>
      <AppSurfaceHeader
        title={labels.updateTitle}
        description={labels.updateDescription}
        actions={(
          <span className="lyra-software-store-update-actions">
            <AppButton
              variant="outline"
              size="sm"
              disabled={!available || busy}
              onClick={onStage}
            >
              <Download size={14} aria-hidden="true" />
              <span>{labels.checkAndStageUpdates}</span>
            </AppButton>
            {busy ? (
              <AppButton variant="outline" size="sm" onClick={onCancel}>
                <X size={14} aria-hidden="true" />
                <span>{labels.cancelUpdate}</span>
              </AppButton>
            ) : null}
          </span>
        )}
      />
      <div className="lyra-software-store-update-body">
        <span className="lyra-software-store-update-channel-label">
          {labels.updateChannelLabel}
        </span>
        <AppTabs
          ariaLabel={labels.updateChannelLabel}
          value={channel}
          options={options}
          onValueChange={onChannelChange}
        />
        {progress === null ? null : (
          <AppStatusMessage className="lyra-software-store-update-progress">
            {labels.updateProgressLabel}: {progress.phase}
            {" · "}
            {progress.completedComponents}/{progress.totalComponents}
          </AppStatusMessage>
        )}
      </div>
    </section>
  );
};
