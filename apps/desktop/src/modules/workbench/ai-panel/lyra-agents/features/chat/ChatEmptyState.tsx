// ============================================================================
// ChatEmptyState — centered Lyra mark + project prompt for a brand-new session
// ============================================================================
//
// Rendered in the chat area before any messages exist. Clicking the highlighted
// directory name opens the project chooser. Until a directory is chosen the
// prompt reads "Home", matching the runtime's home-directory default — sessions
// are always bound (to a chosen project, or to Home by default).

import { useState } from "react";
import { AppButton } from "@renderer/ui/components";
import { LYRA_ASCII_LOGO } from "./ascii-logo";
import { t } from "@workbench/i18n";

export function ChatEmptyState({
  projectName,
  isHome,
  onChooseProject,
}: {
  projectName: string | null;
  isHome: boolean;
  onChooseProject: () => Promise<void> | void;
}) {
  const displayName = isHome || projectName === null || projectName.trim().length === 0
    ? t("lyra-agents-composer.workingDirHome")
    : projectName.trim();
  const [logoAnimationKey, setLogoAnimationKey] = useState(0);
  const [isLogoAnimating, setIsLogoAnimating] = useState(true);
  const replayLogoAnimation = (): void => {
    setLogoAnimationKey((current) => current + 1);
    setIsLogoAnimating(true);
  };

  return (
    <div className="lyra-agents-chat-empty" data-testid="lyra-agents-chat-empty">
      <AppButton
        key={logoAnimationKey}
        type="button"
        variant="ghost"
        className="lyra-agents-chat-empty-logo"
        aria-label={t("lyra-agents-empty.logoAction")}
        data-animate={isLogoAnimating}
        onAnimationEnd={() => setIsLogoAnimating(false)}
        onClick={replayLogoAnimation}
      >
        {LYRA_ASCII_LOGO}
      </AppButton>
      <p className="lyra-agents-chat-empty-question">
        {t("lyra-agents-empty.questionPrefix")}
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-chat-empty-project"
          onClick={() => void onChooseProject()}
        >
          {displayName}
        </AppButton>
        {t("lyra-agents-empty.questionSuffix")}
      </p>
    </div>
  );
}
