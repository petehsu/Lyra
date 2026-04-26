import type { ReactNode } from "react";

import type { AiPanelSurfaceVariant } from "./types";
import { resolveAiPanelSurfaceClassName } from "./surface-layout";

type AiPanelSurfaceFrameProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly ariaLabel: string;
  readonly topbarTitle?: string | null;
  readonly topbarStart?: ReactNode;
  readonly topbarActions?: ReactNode;
  readonly children: ReactNode;
};

export const AiPanelSurfaceFrame = ({
  variant,
  ariaLabel,
  topbarTitle,
  topbarStart,
  topbarActions,
  children
}: AiPanelSurfaceFrameProps) => (
  <section
    className={resolveAiPanelSurfaceClassName(variant)}
    data-ai-panel-variant={variant}
    aria-label={ariaLabel}
  >
    <header
      className={
        topbarStart === undefined
          ? "lyra-ai-panel-topbar"
          : "lyra-ai-panel-topbar lyra-ai-panel-topbar-with-tabs"
      }
    >
      <div className="lyra-ai-panel-topbar-start">
        {topbarStart ?? (
          topbarTitle === null || topbarTitle === undefined ? null : (
            <span className="lyra-ai-panel-history-title">{topbarTitle}</span>
          )
        )}
      </div>
      {topbarActions}
    </header>

    <div className="lyra-ai-panel-content">{children}</div>
  </section>
);
