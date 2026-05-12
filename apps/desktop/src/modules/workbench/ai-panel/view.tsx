import { PanelLeftOpen, PanelRightOpen } from "lucide-react";

import { createTranslator } from "../i18n";
import type { AiPanelSurfaceProps } from "./types";

export const AiPanelSurface = ({
  locale = "en-US",
  title,
  emptyThreadLabel,
  aiPanelSide = "left",
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel
}: AiPanelSurfaceProps) => {
  const t = createTranslator(locale);
  const moveLabel = aiPanelSide === "left"
    ? (movePanelToRightLabel ?? t("ai.movePanelToRight"))
    : (movePanelToLeftLabel ?? t("ai.movePanelToLeft"));
  const MoveIcon = aiPanelSide === "left" ? PanelRightOpen : PanelLeftOpen;

  return (
    <section className="lyra-ai-panel-shell" aria-label={title}>
      <header className="lyra-ai-panel-shell-header">
        <div className="lyra-ai-panel-shell-title">{title}</div>
        {onToggleAiPanelSide === undefined ? null : (
          <button
            className="lyra-ai-panel-shell-icon-button"
            type="button"
            title={moveLabel}
            aria-label={moveLabel}
            onClick={onToggleAiPanelSide}
          >
            <MoveIcon aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        )}
      </header>
      <div className="lyra-ai-panel-shell-body">
        <p>{emptyThreadLabel}</p>
      </div>
    </section>
  );
};
