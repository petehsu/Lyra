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
import type {
  DownloadManagerChecksumAlgorithm,
  DownloadManagerPriority,
  DownloadManagerProxySettings,
  DownloadManagerScheduleSettings,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerTask
} from "../../../shared/download-manager";
import type { ContextMenuModel } from "../context-menu";
import type {
  LyraDesktopApi,
  SearchIndexStatusResponse
} from "../../../shared/desktop-bridge";

export type FileManagerAppId = "file-manager";

export type FileManagerAppIconKey =
  | "file-manager-home"
  | "file-manager-directory-empty"
  | "file-manager-directory-non-empty"
  | "file-manager-directory"
  | "file-manager-download-manager"
  | "file-manager-trash";

export type FileManagerCreateDraftKind = "file" | "directory";

export type FileManagerCreateDraft = {
  readonly kind: FileManagerCreateDraftKind;
  readonly value: string;
};

export type FileManagerStatus = "idle" | "loading" | "ready" | "error";
export type FileManagerDownloadStatus = "idle" | "loading" | "ready" | "error";

export type FileManagerPresentationMode = "list" | "large";

export type FileManagerDownloadAdvancedDraft = {
  readonly advancedOpen: boolean;
  readonly cookieHeader: string;
  readonly headersText: string;
  readonly mirrorsText: string;
  readonly btSelectedFileIndexesText: string;
  readonly btTrackerUrlsText: string;
  readonly partialFilePath: string;
  readonly checksumAlgorithm: DownloadManagerChecksumAlgorithm | "none";
  readonly checksumExpected: string;
  readonly maxRetries: string;
  readonly retryDelaySeconds: string;
  readonly proxyMode: DownloadManagerProxySettings["mode"];
  readonly proxyUrl: string;
};

export type FileManagerDownloadSaveRuleDraft = {
  readonly id: string;
  readonly enabled: boolean;
  readonly name: string;
  readonly directory: string;
  readonly extensionsText: string;
  readonly hostContainsText: string;
  readonly protocolsText: string;
  readonly tagsText: string;
};

export type FileManagerDownloadSettingsDraft = {
  readonly speedLimitKibPerSecond: string;
  readonly scheduleEnabled: boolean;
  readonly scheduleStartTime: string;
  readonly scheduleEndTime: string;
  readonly scheduleOutsideAction: DownloadManagerScheduleSettings["outsideAction"];
  readonly scheduleOutsideSpeedLimitKibPerSecond: string;
  readonly proxyMode: DownloadManagerProxySettings["mode"];
  readonly proxyUrl: string;
  readonly defaultCookieHeader: string;
  readonly defaultHeadersText: string;
  readonly autoExtract: boolean;
  readonly deleteArchiveAfterExtract: boolean;
  readonly detectSplitArchives: boolean;
  readonly extractDirectory: string;
  readonly btDhtEnabled: boolean;
  readonly btPeerExchangeEnabled: boolean;
  readonly btLocalPeerDiscoveryEnabled: boolean;
  readonly btSeedTimeMinutes: string;
  readonly btTrackerUrlsText: string;
  readonly btUploadLimitKibPerSecond: string;
  readonly remoteHost: string;
  readonly remotePort: string;
  readonly remoteAllowLan: boolean;
  readonly saveRules: readonly FileManagerDownloadSaveRuleDraft[];
};

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
  readonly downloadTasks: readonly DownloadManagerTask[];
  readonly downloadStatus: FileManagerDownloadStatus;
  readonly downloadUrlDraft: string;
  readonly downloadAdvancedDraft: FileManagerDownloadAdvancedDraft;
  readonly downloadErrorMessage: string | undefined;
  readonly downloadSettings: DownloadManagerSettings | null;
  readonly downloadRemoteApiStatus: DownloadManagerRemoteApiStatus | null;
  readonly downloadSettingsOpen: boolean;
  readonly downloadSettingsDraft: FileManagerDownloadSettingsDraft;
  readonly downloadSettingsErrorMessage: string | undefined;
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
  readonly downloadManagerTitle: string;
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
  readonly emptyDownloads: string;
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
  readonly downloadAddUrl: string;
  readonly downloadImportClipboard: string;
  readonly downloadImportExternalBrowser: string;
  readonly downloadUrlPlaceholder: string;
  readonly downloadOpenFile: string;
  readonly downloadRevealFile: string;
  readonly downloadPause: string;
  readonly downloadResume: string;
  readonly downloadCancel: string;
  readonly downloadRetry: string;
  readonly downloadRemove: string;
  readonly downloadPauseAll: string;
  readonly downloadResumeAll: string;
  readonly downloadCancelAll: string;
  readonly downloadPriority: string;
  readonly downloadPriorityLow: string;
  readonly downloadPriorityNormal: string;
  readonly downloadPriorityHigh: string;
  readonly downloadStateQueued: string;
  readonly downloadStateDownloading: string;
  readonly downloadStatePaused: string;
  readonly downloadStateCompleted: string;
  readonly downloadStateFailed: string;
  readonly downloadStateCanceled: string;
  readonly downloadSourceBrowser: string;
  readonly downloadSourceManual: string;
  readonly downloadConnections: string;
  readonly downloadUnknownSize: string;
  readonly downloadSpeedIdle: string;
  readonly downloadDurationSeconds: string;
  readonly downloadDurationMinutes: string;
  readonly downloadDurationHours: string;
  readonly downloadEta: string;
  readonly downloadChecksumPending: string;
  readonly downloadChecksumVerified: string;
  readonly downloadChecksumFailed: string;
  readonly downloadSettings: string;
  readonly downloadSettingsSave: string;
  readonly downloadSettingsSpeedLimit: string;
  readonly downloadSettingsNoLimit: string;
  readonly downloadAdvancedOptions: string;
  readonly downloadAdvancedCookie: string;
  readonly downloadAdvancedHeaders: string;
  readonly downloadAdvancedMirrors: string;
  readonly downloadAdvancedBtSelectedFiles: string;
  readonly downloadAdvancedBtTrackers: string;
  readonly downloadAdvancedPartialFile: string;
  readonly downloadAdvancedChecksumAlgorithm: string;
  readonly downloadAdvancedChecksumNone: string;
  readonly downloadAdvancedChecksumExpected: string;
  readonly downloadAdvancedMaxRetries: string;
  readonly downloadAdvancedRetryDelay: string;
  readonly downloadAdvancedProxyMode: string;
  readonly downloadAdvancedProxyUrl: string;
  readonly downloadSettingsSchedule: string;
  readonly downloadSettingsScheduleEnabled: string;
  readonly downloadSettingsScheduleStart: string;
  readonly downloadSettingsScheduleEnd: string;
  readonly downloadSettingsScheduleOutsideAction: string;
  readonly downloadSettingsSchedulePause: string;
  readonly downloadSettingsScheduleSpeedLimit: string;
  readonly downloadSettingsScheduleLimit: string;
  readonly downloadSettingsSaveRules: string;
  readonly downloadSettingsAddSaveRule: string;
  readonly downloadSettingsRemoveSaveRule: string;
  readonly downloadSettingsRuleEnabled: string;
  readonly downloadSettingsRuleName: string;
  readonly downloadSettingsRuleDirectory: string;
  readonly downloadSettingsRuleExtensions: string;
  readonly downloadSettingsRuleHosts: string;
  readonly downloadSettingsRuleProtocols: string;
  readonly downloadSettingsRuleTags: string;
  readonly downloadSettingsProxyMode: string;
  readonly downloadSettingsProxySystem: string;
  readonly downloadSettingsProxyDirect: string;
  readonly downloadSettingsProxyHttp: string;
  readonly downloadSettingsProxySocks5: string;
  readonly downloadSettingsProxyUrl: string;
  readonly downloadSettingsCookie: string;
  readonly downloadSettingsHeaders: string;
  readonly downloadSettingsPostProcessing: string;
  readonly downloadSettingsAutoExtract: string;
  readonly downloadSettingsDeleteArchive: string;
  readonly downloadSettingsDetectSplitArchives: string;
  readonly downloadSettingsExtractDirectory: string;
  readonly downloadSettingsBt: string;
  readonly downloadSettingsBtDht: string;
  readonly downloadSettingsBtPeerExchange: string;
  readonly downloadSettingsBtLocalPeerDiscovery: string;
  readonly downloadSettingsBtSeedTime: string;
  readonly downloadSettingsBtTrackers: string;
  readonly downloadSettingsBtUploadLimit: string;
  readonly downloadRemoteApi: string;
  readonly downloadRemoteApiStart: string;
  readonly downloadRemoteApiStop: string;
  readonly downloadRemoteApiRunning: string;
  readonly downloadRemoteApiStopped: string;
  readonly downloadRemoteApiHost: string;
  readonly downloadRemoteApiPort: string;
  readonly downloadRemoteApiAllowLan: string;
  readonly downloadRemoteApiToken: string;
  readonly searchIndexTitle: string;
  readonly searchIndexReady: string;
  readonly searchIndexBuilding: string;
  readonly searchIndexIdle: string;
  readonly searchIndexFailed: string;
  readonly searchIndexUnavailable: string;
  readonly searchIndexNeedsRebuild: string;
  readonly searchIndexRebuild: string;
  readonly searchIndexRebuilding: string;
  readonly searchIndexStats: string;
  readonly searchIndexPending: string;
  readonly searchIndexPhase: string;
  readonly chooserBindProjectLabel: string;
  readonly chooserSelectDirectoryPlaceholder: string;
};

export type FileManagerSearchIndexModel = {
  readonly status: SearchIndexStatusResponse | null;
  readonly errorMessage: string | undefined;
  readonly rebuilding: boolean;
  readonly rebuildSearchIndex: () => Promise<void>;
};

export type FileManagerChooserMode =
  | {
      readonly kind: "ai-project-bind";
      readonly confirmLabel: string;
      readonly promptLabel: string;
      readonly selectPlaceholder: string;
      readonly onConfirm: () => void;
    }
  | {
      readonly kind: "ai-image-attach";
      readonly confirmLabel: string;
      readonly promptLabel: string;
      readonly selectPlaceholder: string;
      readonly onConfirm: () => void;
    }
  | {
      readonly kind: "ai-file-attach";
      readonly confirmLabel: string;
      readonly promptLabel: string;
      readonly selectPlaceholder: string;
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
  readonly openDownloads: (instanceId: string, addToHistory?: boolean) => Promise<void>;
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
  readonly updateDownloadUrlDraft: (instanceId: string, value: string) => void;
  readonly toggleDownloadAdvancedOptions: (instanceId: string) => void;
  readonly updateDownloadAdvancedDraft: (
    instanceId: string,
    patch: Partial<FileManagerDownloadAdvancedDraft>
  ) => void;
  readonly submitDownloadUrlDraft: (instanceId: string) => Promise<void>;
  readonly submitDownloadText: (instanceId: string, text: string) => Promise<void>;
  readonly importExternalBrowserDownloads: (instanceId: string) => Promise<void>;
  readonly pauseDownload: (taskId: string) => Promise<void>;
  readonly resumeDownload: (taskId: string) => Promise<void>;
  readonly cancelDownload: (taskId: string) => Promise<void>;
  readonly retryDownload: (taskId: string) => Promise<void>;
  readonly removeDownload: (taskId: string) => Promise<void>;
  readonly setDownloadPriority: (taskId: string, priority: DownloadManagerPriority) => Promise<void>;
  readonly pauseAllDownloads: () => Promise<void>;
  readonly resumeAllDownloads: () => Promise<void>;
  readonly cancelAllDownloads: () => Promise<void>;
  readonly openDownloadedFile: (taskId: string) => Promise<void>;
  readonly revealDownloadedFile: (taskId: string) => Promise<void>;
  readonly toggleDownloadSettings: (instanceId: string) => Promise<void>;
  readonly updateDownloadSettingsDraft: (
    instanceId: string,
    patch: Partial<FileManagerDownloadSettingsDraft>
  ) => void;
  readonly addDownloadSaveRuleDraft: (instanceId: string) => void;
  readonly removeDownloadSaveRuleDraft: (instanceId: string, ruleId: string) => void;
  readonly updateDownloadSaveRuleDraft: (
    instanceId: string,
    ruleId: string,
    patch: Partial<FileManagerDownloadSaveRuleDraft>
  ) => void;
  readonly saveDownloadSettings: (instanceId: string) => Promise<void>;
  readonly startDownloadRemoteApi: (instanceId: string) => Promise<void>;
  readonly stopDownloadRemoteApi: (instanceId: string) => Promise<void>;
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
