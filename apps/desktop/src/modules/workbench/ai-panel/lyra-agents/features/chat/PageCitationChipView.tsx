import type { AgentPageCitation } from "../../../../../../shared/agent";
import { pageCitationChipAriaLabel } from "./message-citation";
import { PageCitationTabIcon } from "./page-citation-tab-icon";
import { ResourceChip } from "./ResourceChip";

type PageCitationChipViewProps = {
  citation: AgentPageCitation;
  onClick?: (() => void) | undefined;
};

export const PageCitationChipView = ({ citation, onClick }: PageCitationChipViewProps) => {
  return (
    <ResourceChip
      className="lyra-agents-citation-chip-page"
      title={citation.preview}
      ariaLabel={pageCitationChipAriaLabel(citation)}
      icon={<PageCitationTabIcon citation={citation} />}
      label={citation.preview}
      onActivate={onClick}
    />
  );
};
