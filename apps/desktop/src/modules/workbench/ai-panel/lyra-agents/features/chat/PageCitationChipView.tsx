import type { AgentPageCitation } from "../../../../../../shared/agent";
import { inlineReferenceLabel, pageCitationChipAriaLabel } from "./message-citation";
import { PageCitationTabIcon } from "./page-citation-tab-icon";
import { ResourceChip } from "./ResourceChip";

type PageCitationChipViewProps = {
  citation: AgentPageCitation;
  onClick?: (() => void) | undefined;
};

export const PageCitationChipView = ({ citation, onClick }: PageCitationChipViewProps) => {
  const preview = inlineReferenceLabel(citation.preview);
  return (
    <ResourceChip
      className="lyra-agents-citation-chip-page"
      title={preview}
      ariaLabel={pageCitationChipAriaLabel({ ...citation, preview })}
      icon={<PageCitationTabIcon citation={citation} />}
      label={preview}
      onActivate={onClick}
    />
  );
};
