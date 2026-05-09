import { useMemo } from "react";

import { createTranslator } from "../i18n";
import { createSurfaceTextLabels } from "./surface-model";
import { AiPanelSurfaceView } from "./surface-view";
import type { AiPanelSurfaceProps } from "./types";
import { useAiPanelSurfaceRuntime } from "./use-ai-panel-surface-runtime";
import { useAgentWorkspaceFollow } from "./use-agent-workspace-follow";

export const AiPanelSurface = (surfaceProps: AiPanelSurfaceProps) => {
  const {
    locale = "en-US",
    stopBehavior = "turn_only",
    configuredProfiles = [],
    aiPanelSide = "left"
  } = surfaceProps;
  const t = useMemo(() => createTranslator(locale), [locale]);
  const textLabels = useMemo(() => createSurfaceTextLabels(t), [t]);
  const runtime = useAiPanelSurfaceRuntime({
    desktopApi: surfaceProps.desktopApi,
    t,
    stopBehavior,
    defaultProfileId: surfaceProps.defaultProfileId,
    defaultProviderId: surfaceProps.defaultProviderId,
    defaultModelNames: surfaceProps.defaultModelNames,
    configuredProfiles,
    onDefaultProfileSelect: surfaceProps.onDefaultProfileSelect,
    fileMentionFallbackRoots: surfaceProps.fileMentionFallbackRoots,
    workbenchTabMentions: surfaceProps.workbenchTabMentions,
    onRequestProjectBind: surfaceProps.onRequestProjectBind,
  });
  const followWorkspaceRoot =
    runtime.boundProjectRootForActiveThread ?? runtime.state.activeThread?.cwd ?? null;
  useAgentWorkspaceFollow({
    enabled: runtime.state.followEnabled,
    detail: runtime.state.activeDetail,
    workspaceRoot: followWorkspaceRoot,
    onOpenFilePath: surfaceProps.onFollowOpenFilePath,
  });

  return (
    <AiPanelSurfaceView
      surfaceProps={surfaceProps}
      locale={locale}
      aiPanelSide={aiPanelSide}
      textLabels={textLabels}
      runtime={runtime}
    />
  );
};
