import type { AgentImageAttachment } from "../../core/types";
import {
  ComposerChipIcon,
  composerChipIconKindForImage
} from "./composer-chip-icon";
import { imageAttachmentChipKind, imageAttachmentPreview, imageChipAriaLabel } from "./composer-image";
import { ResourceChip } from "./ResourceChip";

type ImageAttachmentChipViewProps = {
  image: AgentImageAttachment;
  onClick?: (() => void) | undefined;
};

export const ImageAttachmentChipView = ({ image, onClick }: ImageAttachmentChipViewProps) => {
  const kind = imageAttachmentChipKind(image);
  const preview = imageAttachmentPreview(image);
  return (
    <ResourceChip
      className={`lyra-agents-citation-chip-attachment lyra-agents-citation-chip-attachment-${kind}`}
      title={preview}
      ariaLabel={imageChipAriaLabel(image)}
      icon={<ComposerChipIcon kind={composerChipIconKindForImage(image)} />}
      label={preview}
      onActivate={onClick}
    />
  );
};
