import { Link2 } from "@lyra/icons";
import { createContext, useContext } from "react";

import { AppButton } from "@renderer/ui/components";
import { t } from "@workbench/i18n";

// Only transcript text supplies this action. File and plan previews share the
// renderer, but have no message to cite or scroll back to.
export const MarkdownCitationContext = createContext<
  ((target: HTMLElement, quotedText: string) => void) | null
>(null);

export function MarkdownCitationButton({ getTarget, getQuote }: {
  readonly getTarget: () => HTMLElement | null;
  readonly getQuote: (target: HTMLElement) => string;
}) {
  const cite = useContext(MarkdownCitationContext);
  if (cite === null) return null;
  const label = t("lyra-agents-message.citeSelection");
  return (
    <AppButton
      variant="ghost" size="icon" aria-label={label} title={label}
      onClick={() => {
        const target = getTarget();
        if (target !== null) cite(target, getQuote(target));
      }}
    ><Link2 size={16} aria-hidden="true" /></AppButton>
  );
}
