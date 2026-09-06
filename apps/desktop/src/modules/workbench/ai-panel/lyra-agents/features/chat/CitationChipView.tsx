import type { AgentTranscriptCitation } from "../../../../../../shared/agent";
import { ComposerChipIcon } from "./composer-chip-icon";
import { citationChipAriaLabel } from "./message-citation";
import { ResourceChip } from "./ResourceChip";

type CitationChipViewProps = {
  citation: AgentTranscriptCitation;
  onClick?: (() => void) | undefined;
};

export const CitationChipView = ({ citation, onClick }: CitationChipViewProps) => {
  return (
    <ResourceChip
      className={`lyra-agents-citation-chip-${citation.role}`}
      title={citation.preview}
      ariaLabel={citationChipAriaLabel(citation)}
      icon={<ComposerChipIcon kind={citation.role} />}
      label={citation.preview}
      onActivate={onClick}
    />
  );
};
