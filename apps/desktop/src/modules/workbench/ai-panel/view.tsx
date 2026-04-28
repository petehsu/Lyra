import { useMemo } from "react";

import { createTranslator } from "../i18n";
import { createSurfaceTextLabels } from "./surface-model";
import { AiPanelSurfaceView } from "./surface-view";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelSurfaceRuntime } from "./use-ai-panel-surface-runtime";

export const AiPanelSurface = (surfaceProps: AiPanelSurfaceProps) => {
  const {
    locale = "en-US",
    richRenderingEnabled = true,
    stopBehavior = "turn_only",
    configuredProfiles = [],
    aiPanelSide = "left"
  } = surfaceProps;
  const t = useMemo(() => createTranslator(locale), [locale]);
  const textLabels = useMemo(() => createSurfaceTextLabels(t), [t]);
  const runtime = useAiPanelSurfaceRuntime({
    desktopApi: surfaceProps.desktopApi,
    locale,
    t,
    stopBehavior,
    defaultProfileId: surfaceProps.defaultProfileId,
    defaultProviderId: surfaceProps.defaultProviderId,
    defaultModelNames: surfaceProps.defaultModelNames,
    configuredProfiles,
    runtimeQueuedLabel: surfaceProps.runtimeQueuedLabel,
    runtimeStartedLabel: surfaceProps.runtimeStartedLabel,
    runtimeFailedTurnLabel: surfaceProps.runtimeFailedTurnLabel,
    runtimeCompletedTurnLabel: surfaceProps.runtimeCompletedTurnLabel,
    runtimePhaseToolStartedLabel: surfaceProps.runtimePhaseToolStartedLabel,
    runtimePhaseToolFinishedLabel: surfaceProps.runtimePhaseToolFinishedLabel,
    runtimeToolFallbackLabel: surfaceProps.runtimeToolFallbackLabel,
    toolNameSearchLabel: surfaceProps.toolNameSearchLabel,
    toolNameReadRangeLabel: surfaceProps.toolNameReadRangeLabel,
    toolNameListLabel: surfaceProps.toolNameListLabel,
    toolNameGlobLabel: surfaceProps.toolNameGlobLabel,
    toolNameWriteLabel: surfaceProps.toolNameWriteLabel,
    toolNameEditLabel: surfaceProps.toolNameEditLabel,
    toolNameMultiEditLabel: surfaceProps.toolNameMultiEditLabel,
    fileMentionFallbackRoots: surfaceProps.fileMentionFallbackRoots,
    onOpenFilePath: surfaceProps.onOpenFilePath,
    onRequestProjectBind: surfaceProps.onRequestProjectBind
  });

  return (
    <AiPanelSurfaceView
      surfaceProps={surfaceProps}
      locale={locale}
      richRenderingEnabled={richRenderingEnabled}
      aiPanelSide={aiPanelSide}
      textLabels={textLabels}
      runtime={runtime}
    />
  );
};
