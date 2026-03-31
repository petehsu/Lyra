import { AlertTriangle, FileCode2, FileLock2 } from "lucide-react";

import type { FileEditorAppIconKey } from "./types";

const SIZE = 15;

const renderShell = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderFileEditorAppIcon = (iconKey: FileEditorAppIconKey) => {
  if (iconKey === "file-editor-readonly") {
    return renderShell(<FileLock2 size={SIZE} />);
  }
  if (iconKey === "file-editor-unsupported") {
    return renderShell(<AlertTriangle size={SIZE} />);
  }
  return renderShell(<FileCode2 size={SIZE} />);
};
