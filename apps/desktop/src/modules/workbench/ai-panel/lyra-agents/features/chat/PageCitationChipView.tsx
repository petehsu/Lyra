import type { AgentPageCitation } from "../../../../../../shared/agent";
import { pageCitationChipAriaLabel } from "./message-citation";
import { PageCitationTabIcon } from "./page-citation-tab-icon";

type PageCitationChipViewProps = {
  citation: AgentPageCitation;
  onClick?: (() => void) | undefined;
};

export const PageCitationChipView = ({ citation, onClick }: PageCitationChipViewProps) => {
  const interactive = onClick !== undefined;

  return (
    <span
      className="lyra-agents-citation-chip lyra-agents-citation-chip-page"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={citation.preview}
      aria-label={pageCitationChipAriaLabel(citation)}
      onClick={interactive ? (event) => {
        event.stopPropagation();
        onClick();
        event.currentTarget.blur();
      } : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick();
      } : undefined}
    >
      <PageCitationTabIcon citation={citation} />
      <span className="lyra-agents-citation-chip-preview-wrap">
        <span className="lyra-agents-citation-chip-preview">{citation.preview}</span>
      </span>
    </span>
  );
};