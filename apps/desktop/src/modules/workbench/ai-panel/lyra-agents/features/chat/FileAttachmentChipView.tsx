import { FileChipTypeIcon } from "./composer-chip-icon";
import type { AgentFileAttachment } from "./composer-file";
import { fileAttachmentChipAriaLabel } from "./composer-file";
import { inlineReferenceLabel } from "./message-citation";
import { ResourceChip } from "./ResourceChip";

type FileAttachmentChipViewProps = {
  file: AgentFileAttachment;
  onClick?: (() => void) | undefined;
};

export const FileAttachmentChipView = ({ file, onClick }: FileAttachmentChipViewProps) => {
  const preview = inlineReferenceLabel(file.preview);
  return (
    <ResourceChip
      className="lyra-agents-citation-chip-file"
      title={preview}
      ariaLabel={fileAttachmentChipAriaLabel({ ...file, preview })}
      icon={<FileChipTypeIcon name={file.name} kind={file.kind} />}
      label={preview}
      onActivate={onClick}
    />
  );
};
