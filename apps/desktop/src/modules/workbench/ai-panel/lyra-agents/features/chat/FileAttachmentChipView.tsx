import { CITATION_CHIP_ICON_SVGS } from "./citation-chip-dom";
import type { AgentFileAttachment } from "./composer-file";
import { fileAttachmentChipAriaLabel } from "./composer-file";

type FileAttachmentChipViewProps = {
  file: AgentFileAttachment;
  onClick?: (() => void) | undefined;
};

export const FileAttachmentChipView = ({ file, onClick }: FileAttachmentChipViewProps) => {
  const interactive = onClick !== undefined;

  return (
    <span
      className="lyra-agents-citation-chip lyra-agents-citation-chip-file"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={file.preview}
      aria-label={fileAttachmentChipAriaLabel(file)}
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
      <span
        className="lyra-agents-citation-chip-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: CITATION_CHIP_ICON_SVGS.file }}
      />
      <span className="lyra-agents-citation-chip-preview-wrap">
        <span className="lyra-agents-citation-chip-preview">{file.preview}</span>
      </span>
    </span>
  );
};