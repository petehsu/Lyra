import type { AgentPageCitation } from "../../../../../../shared/agent";
import { inlineReferenceLabel, pageCitationChipAriaLabel } from "./message-citation";
import { PageCitationTabIcon } from "./page-citation-tab-icon";
import { ResourceChip } from "./ResourceChip";
import { pageCitationWebUrl, websiteLinkLabel } from "./web-link-display";

type PageCitationChipViewProps = {
  citation: AgentPageCitation;
  onClick?: (() => void) | undefined;
};

export const PageCitationChipView = ({ citation, onClick }: PageCitationChipViewProps) => {
  const url = pageCitationWebUrl(citation);
  const preview = url === null ? inlineReferenceLabel(citation.preview) : websiteLinkLabel(url);
  return (
    <ResourceChip
      className="lyra-agents-citation-chip-page"
      title={url ?? preview}
      webLinkUrl={url ?? undefined}
      ariaLabel={pageCitationChipAriaLabel({ ...citation, preview })}
      icon={<PageCitationTabIcon citation={citation} />}
      label={preview}
      onActivate={onClick}
    />
  );
};
