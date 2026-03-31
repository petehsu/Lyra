import type { FileManagerEntryIconKind } from "../file-manager/entry-icon-classifier";

export const SIDEBAR_FILE_CHIP_ICON_DEFS_ATTRIBUTE = "data-lyra-sidebar-file-chip-icon-defs";
export const SIDEBAR_FILE_CHIP_ICON_KIND_ATTRIBUTE = "data-lyra-sidebar-file-chip-icon-kind";

export const SIDEBAR_FILE_CHIP_ICON_KINDS: readonly FileManagerEntryIconKind[] = [
  "directory-empty",
  "directory-non-empty",
  "package-manifest",
  "dependency-lock",
  "config",
  "workflow",
  "container",
  "git-meta",
  "secret",
  "typescript",
  "javascript",
  "rust",
  "python",
  "shell",
  "code-generic",
  "json-data",
  "database",
  "spreadsheet",
  "presentation",
  "document",
  "markdown",
  "image",
  "video",
  "audio",
  "archive",
  "font",
  "binary",
  "certificate",
  "diff",
  "unknown"
] as const;

const FILE_CHIP_ICON_KINDS = new Set<FileManagerEntryIconKind>(SIDEBAR_FILE_CHIP_ICON_KINDS);

export const isSidebarFileChipIconKind = (
  value: string
): value is FileManagerEntryIconKind => FILE_CHIP_ICON_KINDS.has(value as FileManagerEntryIconKind);

export const resolveSidebarFileChipIconKind = (
  entryKind: "file" | "directory",
  iconKind?: FileManagerEntryIconKind
): FileManagerEntryIconKind => {
  if (iconKind !== undefined) {
    return iconKind;
  }

  return entryKind === "directory"
    ? "directory-non-empty"
    : "unknown";
};
