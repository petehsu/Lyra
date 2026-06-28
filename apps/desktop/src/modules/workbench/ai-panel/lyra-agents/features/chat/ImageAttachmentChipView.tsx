import type { AgentImageAttachment } from "../../core/types";
import {
  ComposerChipIcon,
  composerChipIconKindForImage
} from "./composer-chip-icon";
import { imageAttachmentChipKind, imageAttachmentPreview, imageChipAriaLabel } from "./composer-image";

type ImageAttachmentChipViewProps = {
  image: AgentImageAttachment;
  onClick?: (() => void) | undefined;
};

export const ImageAttachmentChipView = ({ image, onClick }: ImageAttachmentChipViewProps) => {
  const kind = imageAttachmentChipKind(image);
  const preview = imageAttachmentPreview(image);
  const interactive = onClick !== undefined;

  return (
    <span
      className={`lyra-agents-citation-chip lyra-agents-citation-chip-attachment lyra-agents-citation-chip-attachment-${kind}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={preview}
      aria-label={imageChipAriaLabel(image)}
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
      <ComposerChipIcon kind={composerChipIconKindForImage(image)} />
      <span className="lyra-agents-citation-chip-preview-wrap">
        <span className="lyra-agents-citation-chip-preview">{preview}</span>
      </span>
    </span>
  );
};
