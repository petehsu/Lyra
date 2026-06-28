import {
  Bot,
  Camera,
  File,
  FileImage,
  Monitor,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { createRoot, type Root } from "react-dom/client";

import type { AgentTranscriptCitation } from "../../../../../../shared/agent";
import type { AgentImageAttachment } from "../../core/types";
import { imageAttachmentChipKind } from "./composer-image";

export type ComposerChipIconKind =
  | AgentTranscriptCitation["role"]
  | "imageFile"
  | "imageBrowser"
  | "imageWindow"
  | "file";

const ICON_BY_KIND: Record<ComposerChipIconKind, LucideIcon> = {
  assistant: Bot,
  user: UserRound,
  imageFile: FileImage,
  imageBrowser: Camera,
  imageWindow: Monitor,
  file: File
};

export const composerChipIconKindForImage = (
  image: AgentImageAttachment
): ComposerChipIconKind => {
  const kind = imageAttachmentChipKind(image);
  if (kind === "workspace") {
    return "imageBrowser";
  }
  if (kind === "window") {
    return "imageWindow";
  }
  return "imageFile";
};

const ComposerChipIconSvg = ({
  kind
}: {
  readonly kind: ComposerChipIconKind;
}) => {
  const Icon = ICON_BY_KIND[kind];
  return <Icon size={12} strokeWidth={1.8} aria-hidden="true" />;
};

export const ComposerChipIcon = ({
  kind
}: {
  readonly kind: ComposerChipIconKind;
}) => (
  <span className="lyra-agents-citation-chip-icon" aria-hidden="true">
    <ComposerChipIconSvg kind={kind} />
  </span>
);

const iconRoots = new WeakMap<HTMLElement, Root>();

export const mountComposerChipIcon = (
  container: HTMLElement,
  kind: ComposerChipIconKind
): void => {
  let root = iconRoots.get(container);
  if (root === undefined) {
    root = createRoot(container);
    iconRoots.set(container, root);
  }
  root.render(<ComposerChipIconSvg kind={kind} />);
};
