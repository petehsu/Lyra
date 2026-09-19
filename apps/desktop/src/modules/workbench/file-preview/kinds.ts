import { isImageViewerSupportedPath } from "../image-viewer/path-utils";

export type FilePreviewKind = "markdown" | "mermaid" | "paper" | "html" | "svg" | "image";
export type FilePreviewLayout =
  | "source"
  | "split-horizontal"
  | "split-vertical"
  | "preview";

const extensionOf = (filePath: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const previewKindFromPath = (filePath: string): FilePreviewKind | null => {
  const extension = extensionOf(filePath);
  if (extension === "md" || extension === "mdx" || extension === "markdown") {
    return "markdown";
  }
  if (extension === "mmd" || extension === "mermaid") {
    return "mermaid";
  }
  if (extension === "pdf" || extension === "tex" || extension === "typ") {
    return "paper";
  }
  if (extension === "html" || extension === "htm") {
    return "html";
  }
  if (extension === "svg") {
    return "svg";
  }
  if (isImageViewerSupportedPath(filePath)) {
    return "image";
  }
  return null;
};

export const defaultPreviewLayout = (kind: FilePreviewKind | null): FilePreviewLayout =>
  kind === "paper" || kind === "svg" || kind === "image" ? "preview" : "source";

export const filePreviewUrl = (filePath: string, contentType?: string): string =>
  contentType === undefined
    ? `lyra-file://preview?path=${encodeURIComponent(filePath)}`
    : `lyra-file://preview?path=${encodeURIComponent(filePath)}&contentType=${encodeURIComponent(contentType)}`;
