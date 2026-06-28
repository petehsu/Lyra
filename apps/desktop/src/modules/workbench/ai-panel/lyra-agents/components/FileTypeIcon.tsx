import { resolveFileManagerEntryIconKind } from "../../../file-manager/entry-icon-classifier";
import { renderFileManagerEntryIconByKind } from "../../../file-manager/icon-registry";

/** Returns the shared file-type icon used by file manager and AI surfaces. */
export function FileTypeIcon({
  filename,
  size = 15,
}: {
  filename: string;
  size?: number;
}) {
  const name = filename.split(/[\\/]/).pop() ?? filename;
  const iconKind = resolveFileManagerEntryIconKind({
    id: filename,
    name,
    path: filename,
    kind: "file",
    isHidden: name.startsWith(".")
  });
  return renderFileManagerEntryIconByKind(iconKind, { size });
}
