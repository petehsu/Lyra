import { FileImage } from "lucide-react";

import type { ImageViewerAppIconKey } from "./types";

const SIZE = 15;

export const renderImageViewerAppIcon = (_iconKey: ImageViewerAppIconKey) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    <FileImage size={SIZE} />
  </span>
);
