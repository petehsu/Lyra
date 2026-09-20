export type FileLocation = {
  readonly id: string;
  readonly title: string;
  readonly kind: "home" | "directory" | "trash" | "special";
  readonly path?: string;
  readonly specialId?: string;
};

export type FileEntry = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
};

export type FavoriteEntry = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: "path" | "web" | "agent-session";
  readonly url?: string;
  readonly sessionId?: string;
  readonly workingDir?: string;
};

export type TrashEntry = {
  readonly id: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly originalPath?: string;
  readonly sizeBytes?: number;
  readonly deletedAt?: string;
};

export type DownloadTask = {
  readonly id: string;
  readonly fileName: string;
  readonly state: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
};

export type HostInfo = {
  readonly name: string;
  readonly osName: string;
  readonly architecture: string;
  readonly cpuBrand: string;
  readonly memoryTotalBytes: number;
  readonly memoryUsedBytes: number;
};

export type DiskEntry = {
  readonly id: string;
  readonly title: string;
  readonly mountPath: string;
  readonly kind: string;
  readonly totalBytes: number;
  readonly availableBytes: number;
  readonly usedBytes: number;
  readonly usageRatio: number;
};

export type DeviceEntry = {
  readonly id: string;
  readonly title: string;
  readonly devicePath: string;
};

export type FilesModuleState = {
  readonly instanceId: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly viewKind: "home" | "directory" | "trash" | "downloads";
  readonly presentationMode: "list" | "large";
  readonly title: string;
  readonly currentLocation: FileLocation | null;
  readonly parentPath?: string;
  readonly historyLength: number;
  readonly historyIndex: number;
  readonly systemLocations: readonly FileLocation[];
  readonly favorites: readonly FavoriteEntry[];
  readonly recentLocations: readonly { readonly id: string; readonly title: string; readonly path: string }[];
  readonly hostInfo?: HostInfo;
  readonly disks: readonly DiskEntry[];
  readonly devices: readonly DeviceEntry[];
  readonly entries: readonly FileEntry[];
  readonly trashEntries: readonly TrashEntry[];
  readonly downloadTasks: readonly DownloadTask[];
  readonly selectedEntryId?: string;
  readonly selectedTrashEntryId?: string;
  readonly errorMessage?: string;
};

export type FilesMessages = {
  readonly home: string;
  readonly favorites: string;
  readonly downloads: string;
  readonly trash: string;
  readonly back: string;
  readonly forward: string;
  readonly up: string;
  readonly refresh: string;
  readonly list: string;
  readonly large: string;
  readonly addFavorite: string;
  readonly removeFavorite: string;
  readonly newFile: string;
  readonly newFolder: string;
  readonly name: string;
  readonly modified: string;
  readonly size: string;
  readonly location: string;
  readonly restore: string;
  readonly remove: string;
  readonly emptyTrash: string;
  readonly confirmMoveTitle: string;
  readonly confirmMoveBody: string;
  readonly confirmEmptyTitle: string;
  readonly confirmEmptyBody: string;
  readonly confirmMove: string;
  readonly confirmEmpty: string;
  readonly noItems: string;
  readonly loading: string;
  readonly retry: string;
  readonly create: string;
  readonly cancel: string;
  readonly createName: string;
  readonly recent: string;
  readonly locations: string;
  readonly disks: string;
  readonly hostProcessor: string;
  readonly hostMemory: string;
  readonly diskAvailable: string;
};
