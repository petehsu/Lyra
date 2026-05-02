import type {
  FileManagerDevice,
  FileManagerEntry,
  FileManagerFavorite,
  FileManagerDisk,
  FileManagerLocation,
  FileManagerRecentLocation,
  FileManagerTrashEntry,
  FileManagerViewKind
} from "../../../shared/file-manager";
import type { ContextMenuModel } from "../context-menu";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export type FileManagerAppId = "file-manager";

export type FileManagerAppIconKey =
  | "file-manager-home"
  | "file-manager-directory-empty"
  | "file-manager-directory-non-empty"
  | "file-manager-directory"
  | "file-manager-trash";

export type FileManagerCreateDraftKind = "file" | "directory";

export type FileManagerCreateDraft = {
  readonly kind: FileManagerCreateDraftKind;
  readonly value: string;
};

export type FileManagerStatus = "idle" | "loading" | "ready" | "error";

export type FileManagerPresentationMode = "list" | "large";

export type FileManagerAppState = {
  readonly instanceId: string;
  readonly status: FileManagerStatus;
  readonly viewKind: FileManagerViewKind;
  readonly presentationMode: FileManagerPresentationMode;
  readonly title: string;
  readonly iconKey: FileManagerAppIconKey;
  readonly currentLocation: FileManagerLocation | null;
  readonly parentPath: string | undefined;
  readonly history: readonly FileManagerLocation[];
  readonly historyIndex: number;
  readonly systemLocations: readonly FileManagerLocation[];
  readonly favorites: readonly FileManagerFavorite[];
  readonly recentLocations: readonly FileManagerRecentLocation[];
  readonly disks: readonly FileManagerDisk[];
  readonly devices: readonly FileManagerDevice[];
  readonly entries: readonly FileManagerEntry[];
  readonly trashEntries: readonly FileManagerTrashEntry[];
  readonly directorySubscriptionId: string | undefined;
  readonly directoryGeneration: number | undefined;
  readonly selectedEntryId: string | undefined;
  readonly selectedTrashEntryId: string | undefined;
  readonly createDraft: FileManagerCreateDraft | undefined;
  readonly errorMessage: string | undefined;
};

export type FileManagerSurfaceLabels = {
  readonly title: string;
  readonly locationHome: string;
  readonly locationDesktop: string;
  readonly locationDocuments: string;
  readonly locationDownloads: string;
  readonly locationTrash: string;
  readonly homeSectionFavorites: string;
  readonly homeSectionLocations: string;
  readonly homeSectionDevices: string;
  readonly homeSectionRecent: string;
  readonly navigationBack: string;
  readonly navigationForward: string;
  readonly navigationUp: string;
  readonly refresh: string;
  readonly addFavorite: string;
  readonly removeFavorite: string;
  readonly newFolder: string;
  readonly newFile: string;
  readonly delete: string;
  readonly restore: string;
  readonly emptyTrash: string;
  readonly noRecentLocations: string;
  readonly emptyDirectory: string;
  readonly emptyTrashState: string;
  readonly noFavorites: string;
  readonly loading: string;
  readonly unavailable: string;
  readonly diskAvailable: string;
  readonly diskKindSystem: string;
  readonly diskKindLocal: string;
  readonly diskKindRemovable: string;
  readonly diskKindExternal: string;
  readonly deviceUnmounted: string;
  readonly nameColumn: string;
  readonly locationColumn: string;
  readonly originalLocationColumn: string;
  readonly createPlaceholderFile: string;
  readonly createPlaceholderDirectory: string;
  readonly createConfirm: string;
  readonly createCancel: string;
  readonly contextOpen: string;
  readonly contextMountDevice: string;
  readonly contextMoveToTrash: string;
  readonly contextRestore: string;
  readonly contextEmptyTrash: string;
  readonly contextEjectDevice: string;
  readonly viewList: string;
  readonly viewLarge: string;
  readonly chooserBindProjectLabel: string;
  readonly chooserSelectDirectoryPlaceholder: string;
};

export type FileManagerChooserMode =
  | {
      readonly kind: "ai-project-bind";
      readonly confirmLabel: string;
      readonly onConfirm: () => void;
    };

export type FileManagerModel = {
  readonly createInstance: () => {
    readonly appId: FileManagerAppId;
    readonly appInstanceId: string;
    readonly title: string;
    readonly iconKey: FileManagerAppIconKey;
  };
  readonly getState: (instanceId: string) => FileManagerAppState | null;
  readonly ensureInstance: (instanceId: string) => void;
  readonly syncExternalInstances: (instanceIds: readonly string[]) => void;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
  readonly openHome: (instanceId: string, addToHistory?: boolean) => Promise<void>;
  readonly openDirectory: (instanceId: string, path: string, addToHistory?: boolean) => Promise<void>;
  readonly openTrash: (instanceId: string, addToHistory?: boolean) => Promise<void>;
  readonly goBack: (instanceId: string) => Promise<void>;
  readonly goForward: (instanceId: string) => Promise<void>;
  readonly goUp: (instanceId: string) => Promise<void>;
  readonly refresh: (instanceId: string) => Promise<void>;
  readonly setPresentationMode: (instanceId: string, mode: FileManagerPresentationMode) => void;
  readonly selectEntry: (instanceId: string, entryId: string) => void;
  readonly selectTrashEntry: (instanceId: string, entryId: string) => void;
  readonly beginCreateDraft: (instanceId: string, kind: FileManagerCreateDraftKind) => void;
  readonly updateCreateDraft: (instanceId: string, value: string) => void;
  readonly cancelCreateDraft: (instanceId: string) => void;
  readonly commitCreateDraft: (instanceId: string) => Promise<void>;
  readonly moveSelectionToTrash: (instanceId: string) => Promise<void>;
  readonly restoreSelectionFromTrash: (instanceId: string) => Promise<void>;
  readonly emptyTrash: (instanceId: string) => Promise<void>;
  readonly toggleCurrentDirectoryFavorite: (instanceId: string) => Promise<void>;
  readonly openEntryContextMenu: (instanceId: string, entryId: string, anchorX: number, anchorY: number) => void;
  readonly openFavoriteContextMenu: (
    instanceId: string,
    favorite: FileManagerFavorite,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly openLocationContextMenu: (
    instanceId: string,
    location: FileManagerLocation,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly openRecentLocationContextMenu: (
    instanceId: string,
    recent: FileManagerRecentLocation,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly openDiskContextMenu: (
    instanceId: string,
    disk: FileManagerDisk,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly openDeviceContextMenu: (
    instanceId: string,
    device: FileManagerDevice,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly openTrashEntryContextMenu: (instanceId: string, entryId: string, anchorX: number, anchorY: number) => void;
  readonly openDirectoryContextMenu: (instanceId: string, anchorX: number, anchorY: number) => void;
  readonly openTrashContextMenu: (instanceId: string, anchorX: number, anchorY: number) => void;
};

export type UseFileManagerModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly contextMenuModel: ContextMenuModel;
  readonly labels: FileManagerSurfaceLabels;
  readonly onMetaChange: (request: {
    readonly appId: FileManagerAppId;
    readonly appInstanceId: string;
    readonly title: string;
    readonly iconKey: FileManagerAppIconKey;
  }) => void;
};
