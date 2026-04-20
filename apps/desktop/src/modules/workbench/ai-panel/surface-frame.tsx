import type { ReactNode } from "react";

import type { AiPanelSurfaceVariant } from "./types";
import { resolveAiPanelSurfaceClassName } from "./surface-layout";

type AiPanelSurfaceFrameProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly ariaLabel: string;
  readonly topbarTitle?: string | null;
  readonly topbarActions?: ReactNode;
  readonly children: ReactNode;
};

export const AiPanelSurfaceFrame = ({
  variant,
  ariaLabel,
  topbarTitle,
  topbarActions,
  children
}: AiPanelSurfaceFrameProps) => (
  <section
    className={resolveAiPanelSurfaceClassName(variant)}
    data-ai-panel-variant={variant}
    aria-label={ariaLabel}
  >
    <header className="lyra-ai-panel-topbar">
      <div className="lyra-ai-panel-topbar-start">
        {topbarTitle === null || topbarTitle === undefined ? null : (
          <span className="lyra-ai-panel-history-title">{topbarTitle}</span>
        )}
      </div>
      {topbarActions}
    </header>

    <div className="lyra-ai-panel-content">{children}</div>
  </section>
);
