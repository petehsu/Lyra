import { ComposerChipIcon } from "./composer-chip-icon";
import type { AgentFileAttachment } from "./composer-file";
import { fileAttachmentChipAriaLabel } from "./composer-file";
import { ResourceChip } from "./ResourceChip";

type FileAttachmentChipViewProps = {
  file: AgentFileAttachment;
  onClick?: (() => void) | undefined;
};

export const FileAttachmentChipView = ({ file, onClick }: FileAttachmentChipViewProps) => {
  return (
    <ResourceChip
      className="lyra-agents-citation-chip-file"
      title={file.preview}
      ariaLabel={fileAttachmentChipAriaLabel(file)}
      icon={<ComposerChipIcon kind="file" />}
      label={file.preview}
      onActivate={onClick}
    />
  );
};
