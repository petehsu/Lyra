import {
  FileCode2,
  FileJson,
  FileText,
  FileType,
  File,
  Palette,
  Braces,
  Hash,
  Cog,
} from "lucide-react";

/**
 * Returns a file-type-specific icon based on extension.
 * All icons use the same muted color — differentiation comes from shape only.
 */
export function FileTypeIcon({
  filename,
  size = 15,
}: {
  filename: string;
  size?: number;
}) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return renderIconForExt(ext, size);
}

function renderIconForExt(ext: string, size: number) {
  const props = { size, strokeWidth: 1.7, "aria-hidden": true as const };
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <FileCode2 {...props} />;
    case "css":
    case "scss":
    case "less":
      return <Palette {...props} />;
    case "html":
    case "htm":
      return <Braces {...props} />;
    case "json":
    case "jsonc":
      return <FileJson {...props} />;
    case "md":
    case "mdx":
      return <FileText {...props} />;
    case "rs":
    case "go":
    case "c":
    case "cpp":
    case "h":
      return <Cog {...props} />;
    case "py":
      return <Hash {...props} />;
    case "yaml":
    case "yml":
    case "toml":
      return <FileType {...props} />;
    default:
      return <File {...props} />;
  }
}
