const IMAGE_VIEWER_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "svg",
  "avif",
  "heic",
  "heif",
  "jxl",
  "exr",
  "hdr",
  "dpx",
  "cin",
  "dds",
  "tga",
  "psd",
  "psb",
  "fits",
  "fit",
  "dicom",
  "dcm",
  "cr2",
  "nef",
  "arw",
  "dng",
  "orf",
  "raf",
  "rw2"
]);

export const imageViewerSupportedExtensions = IMAGE_VIEWER_EXTENSIONS;

const extensionFromPath = (filePath: string): string => {
  const normalized = filePath.trim();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return "";
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
};

export const isImageViewerSupportedPath = (filePath: string): boolean =>
  IMAGE_VIEWER_EXTENSIONS.has(extensionFromPath(filePath));

export const titleFromImagePath = (filePath: string): string => {
  const normalized = filePath.replaceAll("\\", "/");
  const tail = normalized.split("/").pop();
  return tail === undefined || tail.length === 0 ? filePath : tail;
};

export const parentPathFromImagePath = (filePath: string): string | null => {
  const normalized = filePath.trim();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (slashIndex <= 0) {
    return null;
  }
  return normalized.slice(0, slashIndex);
};
