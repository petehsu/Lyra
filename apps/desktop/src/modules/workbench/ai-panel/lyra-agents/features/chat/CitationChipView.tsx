import type { AgentTranscriptCitation } from "../../../../../../shared/agent";
import { ComposerChipIcon } from "./composer-chip-icon";
import { citationChipAriaLabel } from "./message-citation";

type CitationChipViewProps = {
  citation: AgentTranscriptCitation;
  onClick?: (() => void) | undefined;
};

export const CitationChipView = ({ citation, onClick }: CitationChipViewProps) => {
  const interactive = onClick !== undefined;

  return (
    <span
      className={`lyra-agents-citation-chip lyra-agents-citation-chip-${citation.role}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={citation.preview}
      aria-label={citationChipAriaLabel(citation)}
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
      <ComposerChipIcon kind={citation.role} />
      <span className="lyra-agents-citation-chip-preview-wrap">
        <span className="lyra-agents-citation-chip-preview">{citation.preview}</span>
      </span>
    </span>
  );
};
