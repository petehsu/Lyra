import { useEffect, useMemo, useState } from "react";

import type { FileManagerEntry, FileManagerTrashEntry } from "../../../shared/file-manager";

const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif"
]);

type PreviewableEntry = FileManagerEntry | FileManagerTrashEntry;

const normalizeExtension = (value: string | undefined): string =>
  value?.trim().replace(/^\./, "").toLowerCase() ?? "";

const toFilePreviewUrl = (rawPath: string): string => {
  return `lyra-file://preview?path=${encodeURIComponent(rawPath)}`;
};

const resolvePreviewPath = (entry: PreviewableEntry): string | null => {
  if (entry.kind !== "file") {
    return null;
  }

  if ("trashedPath" in entry) {
    return entry.trashedPath ?? null;
  }

  if ("path" in entry) {
    return entry.path;
  }

  return null;
};

export const isPreviewableImageEntry = (entry: PreviewableEntry): boolean =>
  entry.kind === "file" &&
  PREVIEWABLE_IMAGE_EXTENSIONS.has(normalizeExtension(entry.extension));

export const FileManagerImagePreview = ({
  entry,
  className
}: {
  readonly entry: PreviewableEntry;
  readonly className?: string;
}) => {
  const previewPath = resolvePreviewPath(entry);
  const src = useMemo(
    () => (previewPath === null ? null : toFilePreviewUrl(previewPath)),
    [previewPath]
  );
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (src === null || hasError || isPreviewableImageEntry(entry) === false) {
    return null;
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      draggable={false}
      onError={() => {
        setHasError(true);
      }}
    />
  );
};
