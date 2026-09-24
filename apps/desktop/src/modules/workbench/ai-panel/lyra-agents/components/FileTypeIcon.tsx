import { FileTypeIcon as LyraFileTypeIcon } from "@lyra/icons/file-type";

/** Returns the shared file-type icon used by file manager and AI surfaces. */
export function FileTypeIcon({
  filename,
  kind = "file",
  size = 15,
}: {
  filename: string;
  kind?: "file" | "folder" | "folder-open";
  size?: number;
}) {
  return <LyraFileTypeIcon name={filename} kind={kind} size={size} />;
}
