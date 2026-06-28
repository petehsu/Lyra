export type FileManagerViewKind = "home" | "directory" | "trash" | "downloads";

export type FileManagerSpecialLocationId =
  | "home"
  | "desktop"
  | "documents"
  | "downloads"
  | "downloadManager"
  | "trash"
  | "favorites";

export type FileManagerFolderState = "empty" | "non-empty" | "unknown";

export type FileManagerEntryHydrationState = "pending" | "complete";

export type FileManagerEntryKind = "file" | "directory";

export type FileManagerLocationKind = "home" | "directory" | "trash" | "special";

export type FileManagerLocation = {
  readonly id: string;
  readonly title: string;
  readonly kind: FileManagerLocationKind;
  readonly path?: string;
  readonly specialId?: FileManagerSpecialLocationId;
};

export type FileManagerFavoriteKind = "path" | "web" | "agent-session";

export type FileManagerFavorite = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind?: FileManagerFavoriteKind;
  readonly specialId?: Exclude<FileManagerSpecialLocationId, "trash" | "favorites">;
  readonly url?: string;
  readonly faviconUrl?: string;
  readonly sessionId?: string;
  readonly workingDir?: string;
};

export type FileManagerRecentLocation = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly lastOpenedAt: string;
};

export type FileManagerDiskKind = "system" | "local" | "removable" | "external";

export type FileManagerDiskOsFlavor =
  | "alpine"
  | "arch"
  | "bodhi"
  | "centos"
  | "debian"
  | "openbsd"
  | "mint"
  | "opensuse"
  | "popos"
  | "redhat"
  | "rocky"
  | "linux"
  | "ubuntu"
  | "void"
  | "windows"
  | "macos"
  | "kali"
  | "fedora"
  | "zorin"
  | "unknown";

export type FileManagerDisk = {
  readonly id: string;
  readonly title: string;
  readonly mountPath: string;
  readonly devicePath?: string;
  readonly fileSystem: string;
  readonly kind: FileManagerDiskKind;
  readonly osFlavor?: FileManagerDiskOsFlavor;
  readonly totalBytes: number;
  readonly availableBytes: number;
  readonly usedBytes: number;
  readonly usageRatio: number;
  readonly isRemovable: boolean;
  readonly canEject: boolean;
};

export type FileManagerDevice = {
  readonly id: string;
  readonly title: string;
  readonly devicePath: string;
  readonly displayPath?: string;
  readonly fileSystem?: string;
  readonly kind: FileManagerDiskKind;
  readonly osFlavor?: FileManagerDiskOsFlavor;
  readonly totalBytes?: number;
  readonly isRemovable: boolean;
  readonly canMount: boolean;
  readonly canEject: boolean;
};

export type FileManagerBaseEntry = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: FileManagerEntryKind;
  readonly extension?: string;
  readonly isHidden: boolean;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
  readonly hydrationState?: FileManagerEntryHydrationState;
};

export type FileManagerDirectoryEntry = FileManagerBaseEntry & {
  readonly kind: "directory";
  readonly folderState: FileManagerFolderState;
};

export type FileManagerFileEntry = FileManagerBaseEntry & {
  readonly kind: "file";
};

export type FileManagerEntry = FileManagerDirectoryEntry | FileManagerFileEntry;

export type FileManagerTrashEntry = {
  readonly id: string;
  readonly name: string;
  readonly kind: FileManagerEntryKind;
  readonly trashedPath?: string;
  readonly originalPath?: string;
  readonly originalParentPath?: string;
  readonly extension?: string;
  readonly isHidden: boolean;
  readonly folderState?: FileManagerFolderState;
  readonly sizeBytes?: number;
  readonly deletedAt?: string;
};

export type FileManagerReadHomeResponse = {
  readonly location: FileManagerLocation;
  readonly systemLocations: readonly FileManagerLocation[];
  readonly favorites: readonly FileManagerFavorite[];
  readonly recentLocations: readonly FileManagerRecentLocation[];
  readonly disks: readonly FileManagerDisk[];
  readonly devices: readonly FileManagerDevice[];
};

export type FileManagerReadDirectoryRequest = {
  readonly path: string;
};

export type FileManagerReadDirectoryResponse = {
  readonly location: FileManagerLocation;
  readonly parentPath?: string;
  readonly entries: readonly FileManagerEntry[];
};

export type FileManagerDirectorySnapshot = FileManagerReadDirectoryResponse & {
  readonly generation: number;
};

export type FileManagerSubscribeDirectoryRequest = FileManagerReadDirectoryRequest;

export type FileManagerSubscribeDirectoryResponse = {
  readonly subscriptionId: string;
  readonly snapshot: FileManagerDirectorySnapshot;
};

export type FileManagerDirectoryPatchKind =
  | "create"
  | "update"
  | "remove"
  | "rename"
  | "reset";

export type FileManagerDirectoryPatch = {
  readonly subscriptionId: string;
  readonly directoryPath: string;
  readonly generation: number;
  readonly kind: FileManagerDirectoryPatchKind;
  readonly entry?: FileManagerEntry;
  readonly path?: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly snapshot?: FileManagerDirectorySnapshot;
  readonly errorMessage?: string;
};

export type FileManagerReadTrashResponse = {
  readonly location: FileManagerLocation;
  readonly entries: readonly FileManagerTrashEntry[];
};

export type FileManagerCreateFileRequest = {
  readonly parentPath: string;
  readonly name: string;
};

export type FileManagerCreateFolderRequest = {
  readonly parentPath: string;
  readonly name: string;
};

export type FileManagerMoveToTrashRequest = {
  readonly paths: readonly string[];
};

export type FileManagerRestoreFromTrashRequest = {
  readonly itemIds: readonly string[];
};

export type FileManagerEjectDeviceRequest = {
  readonly mountPath: string;
  readonly devicePath?: string;
  readonly kind: FileManagerDiskKind;
};

export type FileManagerMountDeviceRequest = {
  readonly devicePath: string;
  readonly kind: FileManagerDiskKind;
};

export type FileManagerEjectDeviceResult = {
  readonly ejected: boolean;
  readonly poweredOff: boolean;
  readonly strategy: string;
};

export type FileManagerMountDeviceResult = {
  readonly mounted: boolean;
  readonly mountPath?: string;
  readonly strategy: string;
};

export type FileManagerDirectoryMutationResponse = {
  readonly entry?: FileManagerEntry;
};

export type FileManagerFavoritesPayload = {
  readonly favorites: readonly FileManagerFavorite[];
};

export type FileManagerRecentLocationsPayload = {
  readonly recentLocations: readonly FileManagerRecentLocation[];
};

export type FileTextEncoding = "utf8" | "utf8-bom";

export type FileReadTextRequest = {
  readonly path: string;
};

export type FileReadResultKind = "text" | "unsupported";

export type FileReadTextResult = {
  readonly kind: "text";
  readonly path: string;
  readonly revision: string;
  readonly encoding: FileTextEncoding;
  readonly readOnly: boolean;
  readonly sizeBytes: number;
  readonly content: string;
};

export type FileReadUnsupportedResult = {
  readonly kind: "unsupported";
  readonly path: string;
  readonly reason: string;
  readonly readOnly: boolean;
  readonly sizeBytes: number;
};

export type FileReadResult = FileReadTextResult | FileReadUnsupportedResult;

export type FileWriteTextRequest = {
  readonly path: string;
  readonly content: string;
  readonly expectedRevision?: string;
  readonly encoding?: FileTextEncoding;
};

export type FileWriteTextSuccess = {
  readonly ok: true;
  readonly path: string;
  readonly revision: string;
  readonly encoding: FileTextEncoding;
  readonly savedAt: string;
};

export type FileRevisionConflictError = {
  readonly ok: false;
  readonly kind: "revision-conflict";
  readonly path: string;
  readonly expectedRevision?: string;
  readonly currentRevision: string;
  readonly message: string;
};

export type FileWriteResult = FileWriteTextSuccess | FileRevisionConflictError;

export type FileStatRequest = {
  readonly path: string;
};

export type FileStatResult = {
  readonly path: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly readOnly: boolean;
  readonly sizeBytes: number;
  readonly modifiedAt?: string;
  readonly revision?: string;
};

export type FileManagerSelectedAttachment = {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
};
