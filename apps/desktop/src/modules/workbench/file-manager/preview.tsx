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
  "avif",
  "tiff",
  "tif",
  "heic",
  "heif"
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

const resolvePreviewUrl = (entry: PreviewableEntry): string | null => {
  if (entry.kind === "file" && typeof entry.previewUrl === "string" && entry.previewUrl.length > 0) {
    return entry.previewUrl;
  }
  const previewPath = resolvePreviewPath(entry);
  return previewPath === null ? null : toFilePreviewUrl(previewPath);
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
  const src = useMemo(
    () => resolvePreviewUrl(entry),
    [entry]
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
