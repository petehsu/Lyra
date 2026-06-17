import type { AgentImageAttachment } from "../../core/types";
import { CITATION_CHIP_ICON_SVGS } from "./citation-chip-dom";
import { imageAttachmentChipKind, imageAttachmentPreview, imageChipAriaLabel } from "./composer-image";

type ImageAttachmentChipViewProps = {
  image: AgentImageAttachment;
  onClick?: (() => void) | undefined;
};

export const ImageAttachmentChipView = ({ image, onClick }: ImageAttachmentChipViewProps) => {
  const kind = imageAttachmentChipKind(image);
  const preview = imageAttachmentPreview(image);
  const interactive = onClick !== undefined;
  const icon = kind === "workspace"
    ? CITATION_CHIP_ICON_SVGS.imageBrowser
    : kind === "window"
      ? CITATION_CHIP_ICON_SVGS.imageWindow
      : CITATION_CHIP_ICON_SVGS.imageFile;

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
      <span
        className="lyra-agents-citation-chip-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <span className="lyra-agents-citation-chip-preview-wrap">
        <span className="lyra-agents-citation-chip-preview">{preview}</span>
      </span>
    </span>
  );
};