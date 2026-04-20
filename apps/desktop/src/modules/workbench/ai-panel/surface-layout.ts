import type { AiPanelSurfaceVariant } from "./types";

const SURFACE_VARIANT_CLASSNAME: Readonly<Record<AiPanelSurfaceVariant, string>> = {
  sidebar: "lyra-ai-panel-surface-sidebar",
  workspace: "lyra-ai-panel-surface-workspace",
  detached: "lyra-ai-panel-surface-detached"
};

export const resolveAiPanelSurfaceClassName = (variant: AiPanelSurfaceVariant): string =>
  `lyra-ai-panel-surface ${SURFACE_VARIANT_CLASSNAME[variant]}`;
