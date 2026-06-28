import {
  Binary,
  Container,
  Database,
  Download,
  File,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileCog,
  FileDiff,
  FileImage,
  FileJson2,
  FileLock2,
  FileSpreadsheet,
  FileText,
  FileType,
  FileType2,
  FileVideo2,
  Folder,
  FolderGit2,
  Folders,
  FolderOpen,
  Globe,
  HardDrive,
  History,
  House,
  ListChecks,
  MessageSquare,
  Monitor,
  Package,
  Palette,
  ScrollText,
  Sheet,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Workflow
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  FileManagerDevice,
  FileManagerDisk,
  FileManagerEntry,
  FileManagerFavorite,
  FileManagerLocation,
  FileManagerTrashEntry
} from "../../../shared/file-manager";
import { FILE_MANAGER_DISK_BRAND_ASSETS } from "./disk-brand-assets";
import {
  resolveFileManagerEntryIconKind,
  type FileManagerEntryIconKind
} from "./entry-icon-classifier";
import type { FileManagerAppIconKey } from "./types";

const DEFAULT_ICON_SIZE = 14;

const mergeClassNames = (...classNames: readonly (string | null | undefined)[]) =>
  classNames.filter(Boolean).join(" ");

const renderIcon = (node: ReactNode, className?: string) => (
  <span
    className={
      className === undefined
        ? "lyra-file-manager-icon-shell"
        : `lyra-file-manager-icon-shell ${className}`
    }
    aria-hidden="true"
  >
    {node}
  </span>
);

const renderFileTypeLabel = (label: string): ReactNode => (
  <span className="lyra-file-manager-icon-label">{label}</span>
);

export const renderFileManagerAppIcon = (iconKey: FileManagerAppIconKey) => {
  switch (iconKey) {
    case "file-manager-home":
      return renderIcon(<Folders size={DEFAULT_ICON_SIZE} />);
    case "file-manager-directory-empty":
      return renderIcon(<Folder size={DEFAULT_ICON_SIZE} />);
    case "file-manager-directory-non-empty":
      return renderIcon(<FolderOpen size={DEFAULT_ICON_SIZE} />);
    case "file-manager-download-manager":
      return renderIcon(<ListChecks size={DEFAULT_ICON_SIZE} />);
    case "file-manager-trash":
      return renderIcon(<Trash2 size={DEFAULT_ICON_SIZE} />);
    default:
      return renderIcon(<Folder size={DEFAULT_ICON_SIZE} />);
  }
};

export const renderFileManagerLocationIcon = (
  location: FileManagerLocation | FileManagerFavorite
) => {
  switch (location.specialId) {
    case "home":
      return renderIcon(<House size={DEFAULT_ICON_SIZE} />);
    case "desktop":
      return renderIcon(<Monitor size={DEFAULT_ICON_SIZE} />);
    case "documents":
      return renderIcon(<FilesIcon />);
    case "downloads":
      return renderIcon(<Download size={DEFAULT_ICON_SIZE} />);
    case "downloadManager":
      return renderIcon(<ListChecks size={DEFAULT_ICON_SIZE} />);
    case "trash":
      return renderIcon(<Trash2 size={DEFAULT_ICON_SIZE} />);
    case "favorites":
      return renderIcon(<Star size={DEFAULT_ICON_SIZE} />);
    default:
      return renderIcon(<FolderOpen size={DEFAULT_ICON_SIZE} />);
  }
};

export const renderFileManagerFavoriteIcon = (favorite: FileManagerFavorite) => {
  if (favorite.kind === "web") {
    const faviconUrl = favorite.faviconUrl?.trim();
    if (faviconUrl !== undefined && faviconUrl.length > 0) {
      return renderIcon(
        <img
          className="lyra-file-manager-favorite-favicon"
          src={faviconUrl}
          alt=""
          aria-hidden="true"
        />,
        "lyra-file-manager-icon-shell-favicon"
      );
    }
    return renderIcon(<Globe size={DEFAULT_ICON_SIZE} />);
  }

  if (favorite.kind === "agent-session") {
    return renderIcon(<MessageSquare size={DEFAULT_ICON_SIZE} />);
  }

  return renderFileManagerLocationIcon(favorite);
};

const renderFileIconByKind = (
  iconKind: FileManagerEntryIconKind,
  size = DEFAULT_ICON_SIZE
): ReactNode => {
  switch (iconKind) {
    case "directory-empty":
      return <Folder size={size} />;
    case "directory-non-empty":
      return <FolderOpen size={size} />;
    case "package-manifest":
      return <Package size={size} />;
    case "dependency-lock":
      return <FileLock2 size={size} />;
    case "config":
      return <FileCog size={size} />;
    case "workflow":
      return <Workflow size={size} />;
    case "container":
      return <Container size={size} />;
    case "git-meta":
      return <FolderGit2 size={size} />;
    case "secret":
      return <ShieldAlert size={size} />;
    case "react":
      return renderFileTypeLabel("R");
    case "vue":
      return renderFileTypeLabel("V");
    case "svelte":
      return renderFileTypeLabel("S");
    case "html":
      return renderFileTypeLabel("H");
    case "xml":
      return renderFileTypeLabel("<>");
    case "css":
      return renderFileTypeLabel("C");
    case "typescript":
      return renderFileTypeLabel("TS");
    case "javascript":
      return renderFileTypeLabel("JS");
    case "go":
      return renderFileTypeLabel("GO");
    case "java":
      return renderFileTypeLabel("J");
    case "c-cpp":
      return renderFileTypeLabel("C");
    case "csharp":
      return renderFileTypeLabel("C#");
    case "swift":
      return renderFileTypeLabel("S");
    case "php":
      return renderFileTypeLabel("P");
    case "ruby":
      return renderFileTypeLabel("RB");
    case "rust":
      return renderFileTypeLabel("RS");
    case "python":
      return renderFileTypeLabel("PY");
    case "notebook":
      return renderFileTypeLabel("NB");
    case "shell":
      return renderFileTypeLabel("$");
    case "code-generic":
      return <FileCode2 size={size} />;
    case "json-data":
      return <FileJson2 size={size} />;
    case "database":
      return <Database size={size} />;
    case "spreadsheet":
      return <FileSpreadsheet size={size} />;
    case "presentation":
      return <FileType size={size} />;
    case "document":
      return <FileText size={size} />;
    case "markdown":
      return <ScrollText size={size} />;
    case "image":
      return <FileImage size={size} />;
    case "video":
      return <FileVideo2 size={size} />;
    case "audio":
      return <FileAudio2 size={size} />;
    case "archive":
      return <FileArchive size={size} />;
    case "font":
      return <FileType size={size} />;
    case "design":
      return <Palette size={size} />;
    case "model":
      return <Package size={size} />;
    case "log":
      return <ScrollText size={size} />;
    case "binary":
      return <Binary size={size} />;
    case "certificate":
      return <ShieldCheck size={size} />;
    case "diff":
      return <FileDiff size={size} />;
    case "unknown":
    default:
      return <File size={size} />;
  }
};

export const renderFileManagerEntryIconByKind = (
  iconKind: FileManagerEntryIconKind,
  options?: {
    readonly className?: string;
    readonly size?: number;
  }
) => {
  const size = options?.size ?? DEFAULT_ICON_SIZE;
  return renderIcon(
    renderFileIconByKind(iconKind, size),
    mergeClassNames(`lyra-file-manager-icon-shell-kind-${iconKind}`, options?.className)
  );
};

type FileManagerStorageDevice =
  | Pick<FileManagerDisk, "kind" | "osFlavor">
  | Pick<FileManagerDevice, "kind" | "osFlavor">;

const renderBrandDiskIcon = (disk: FileManagerStorageDevice) => {
  if (disk.kind !== "system" || disk.osFlavor === undefined || disk.osFlavor === "unknown") {
    return null;
  }

  const brandAsset = FILE_MANAGER_DISK_BRAND_ASSETS[disk.osFlavor];
  if (brandAsset === undefined) {
    return null;
  }

  return renderIcon(
    <img
      className={
        brandAsset.tone === "adaptive"
          ? "lyra-file-manager-disk-brand-image lyra-file-manager-disk-brand-image-adaptive"
          : "lyra-file-manager-disk-brand-image"
      }
      src={brandAsset.url}
      alt=""
      aria-hidden="true"
    />,
    "lyra-file-manager-icon-shell-disk lyra-file-manager-icon-shell-disk-brand"
  );
};

export const renderFileManagerEntryIcon = (entry: FileManagerEntry | FileManagerTrashEntry) => {
  return renderFileManagerEntryIconByKind(resolveFileManagerEntryIconKind(entry));
};

const FilesIcon = () => <Sheet size={DEFAULT_ICON_SIZE} />;

const renderDiskGlyph = () => <HardDrive size={20} strokeWidth={1.85} />;

export const renderFileManagerDiskIcon = (disk: FileManagerDisk | FileManagerDevice) => {
  const brandIcon = renderBrandDiskIcon(disk);
  if (brandIcon !== null) {
    return brandIcon;
  }

  return renderIcon(
    renderDiskGlyph(),
    "lyra-file-manager-icon-shell-disk lyra-file-manager-icon-shell-disk-glyph"
  );
};

export const renderFileManagerSectionIcon = (
  section: "favorites" | "locations" | "devices" | "recent" | "downloads"
) => {
  if (section === "favorites") {
    return renderIcon(<Star size={DEFAULT_ICON_SIZE} />);
  }
  if (section === "downloads") {
    return renderIcon(<ListChecks size={DEFAULT_ICON_SIZE} />);
  }
  if (section === "devices") {
    return renderIcon(<HardDrive size={DEFAULT_ICON_SIZE} />);
  }
  if (section === "recent") {
    return renderIcon(<History size={DEFAULT_ICON_SIZE} />);
  }
  return renderIcon(<FolderOpen size={DEFAULT_ICON_SIZE} />);
};
