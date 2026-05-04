import { memo } from "react";

import { LyraBrandLogo } from "../brand";
import { AiPanelEmptyGreetingRotator } from "./empty-greeting-rotator";

type AiPanelThreadViewProps = {
  readonly logoUrl: string;
  readonly blinkLogoUrl?: string | undefined;
  readonly emptyThreadLabel: string;
  readonly emptyGreetingLabels?: readonly string[] | undefined;
};

export const AiPanelThreadView = memo(({
  logoUrl,
  blinkLogoUrl,
  emptyThreadLabel,
  emptyGreetingLabels,
}: AiPanelThreadViewProps) => {
  return (
    <div className="lyra-ai-agent-empty-scene">
      <div className="lyra-ai-agent-empty-hero">
        <LyraBrandLogo
          logoUrl={logoUrl}
          blinkEyes
          {...(blinkLogoUrl === undefined ? {} : { blinkLogoUrl })}
          className="lyra-ai-agent-empty-logo"
        />
        <AiPanelEmptyGreetingRotator
          labels={emptyGreetingLabels}
          fallbackLabel={emptyThreadLabel}
        />
      </div>
    </div>
  );
});

AiPanelThreadView.displayName = "AiPanelThreadView";
