import { FileTypeIcon as LyraFileTypeIcon } from "@lyra/icons/file-type";

/** Returns the shared file-type icon used by file manager and AI surfaces. */
export function FileTypeIcon({
  filename,
  size = 15,
}: {
  filename: string;
  size?: number;
}) {
  return <LyraFileTypeIcon name={filename} size={size} />;
}
