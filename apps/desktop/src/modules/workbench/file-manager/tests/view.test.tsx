import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../../shell/titlebar-context";
import type { FileManagerAppState, FileManagerModel, FileManagerSurfaceLabels } from "../types";
import type {
  LyraDesktopApi,
  SearchIndexStatusResponse
} from "../../../../shared/desktop-bridge";
import { FileManagerSurface } from "../view";

const labels: FileManagerSurfaceLabels = {
  title: "Files",
  locationHome: "Home",
  locationDesktop: "Desktop",
  locationDocuments: "Documents",
  locationDownloads: "Downloads",
  downloadManagerTitle: "Download Manager",
  locationTrash: "Trash",
  homeSectionFavorites: "Favorites",
  homeSectionLocations: "Locations",
  homeSectionDevices: "Devices",
  homeSectionRecent: "Recent",
  navigationBack: "Back",
  navigationForward: "Forward",
  navigationUp: "Up",
  refresh: "Refresh",
  addFavorite: "Add favorite",
  removeFavorite: "Remove favorite",
  newFolder: "New folder",
  newFile: "New file",
  delete: "Delete",
  restore: "Restore",
  emptyTrash: "Empty trash",
  noRecentLocations: "No recent",
  emptyDirectory: "Empty directory",
  emptyTrashState: "Empty trash state",
  noFavorites: "No favorites",
  emptyDownloads: "No downloads",
  loading: "Loading",
  unavailable: "Unavailable",
  diskAvailable: "available",
  diskKindSystem: "System disk",
  diskKindLocal: "Local disk",
  diskKindRemovable: "Removable disk",
  diskKindExternal: "External disk",
  deviceUnmounted: "Unmounted",
  nameColumn: "Name",
  locationColumn: "Location",
  originalLocationColumn: "Original location",
  createPlaceholderFile: "File name",
  createPlaceholderDirectory: "Folder name",
  createConfirm: "Confirm",
  createCancel: "Cancel",
  contextOpen: "Open",
  contextMountDevice: "Mount device",
  contextMoveToTrash: "Move to trash",
  contextRestore: "Restore",
  contextEmptyTrash: "Empty trash",
  contextEjectDevice: "Eject",
  viewList: "List view",
  viewLarge: "Large view",
  downloadAddUrl: "Add download",
  downloadImportClipboard: "Import from clipboard",
  downloadImportExternalBrowser: "Import browser downloads",
  downloadUrlPlaceholder: "Paste URL",
  downloadOpenFile: "Open file",
  downloadRevealFile: "Reveal file",
  downloadPause: "Pause",
  downloadResume: "Resume",
  downloadCancel: "Cancel",
  downloadRetry: "Retry",
  downloadRemove: "Remove",
  downloadPauseAll: "Pause all",
  downloadResumeAll: "Resume all",
  downloadCancelAll: "Cancel all",
  downloadPriority: "Priority",
  downloadPriorityLow: "Low",
  downloadPriorityNormal: "Normal",
  downloadPriorityHigh: "High",
  downloadStateQueued: "Queued",
  downloadStateDownloading: "Downloading",
  downloadStatePaused: "Paused",
  downloadStateCompleted: "Completed",
  downloadStateFailed: "Failed",
  downloadStateCanceled: "Canceled",
  downloadSourceBrowser: "Browser",
  downloadSourceManual: "Manual",
  downloadConnections: "{count} connections",
  downloadUnknownSize: "Unknown",
  downloadSpeedIdle: "Idle",
  downloadDurationSeconds: "{seconds}s",
  downloadDurationMinutes: "{minutes}m {seconds}s",
  downloadDurationHours: "{hours}h {minutes}m",
  downloadEta: "{duration} left",
  downloadChecksumPending: "{algorithm} pending",
  downloadChecksumVerified: "{algorithm} verified",
  downloadChecksumFailed: "{algorithm} mismatch",
  downloadSettings: "Download settings",
  downloadSettingsSave: "Save download settings",
  downloadSettingsSpeedLimit: "Speed limit",
  downloadSettingsNoLimit: "No limit",
  downloadAdvancedOptions: "Advanced download options",
  downloadAdvancedCookie: "Cookie",
  downloadAdvancedHeaders: "Request headers",
  downloadAdvancedMirrors: "Mirror URLs",
  downloadAdvancedBtSelectedFiles: "BT file indexes",
  downloadAdvancedBtTrackers: "BT trackers",
  downloadAdvancedPartialFile: "Existing partial file",
  downloadAdvancedChecksumAlgorithm: "Checksum",
  downloadAdvancedChecksumNone: "None",
  downloadAdvancedChecksumExpected: "Checksum value",
  downloadAdvancedMaxRetries: "Max retries",
  downloadAdvancedRetryDelay: "Retry delay",
  downloadAdvancedProxyMode: "Proxy mode",
  downloadAdvancedProxyUrl: "Proxy URL",
  downloadSettingsSchedule: "Schedule",
  downloadSettingsScheduleEnabled: "Enable schedule",
  downloadSettingsScheduleStart: "Start",
  downloadSettingsScheduleEnd: "End",
  downloadSettingsScheduleOutsideAction: "Outside window",
  downloadSettingsSchedulePause: "Pause",
  downloadSettingsScheduleSpeedLimit: "Limit speed",
  downloadSettingsScheduleLimit: "Outside speed limit",
  downloadSettingsSaveRules: "Save rules",
  downloadSettingsAddSaveRule: "Add save rule",
  downloadSettingsRemoveSaveRule: "Remove save rule",
  downloadSettingsRuleEnabled: "Enabled",
  downloadSettingsRuleName: "Rule name",
  downloadSettingsRuleDirectory: "Save directory",
  downloadSettingsRuleExtensions: "Extensions",
  downloadSettingsRuleHosts: "Host contains",
  downloadSettingsRuleProtocols: "Protocols",
  downloadSettingsRuleTags: "Tags",
  downloadSettingsProxyMode: "Proxy mode",
  downloadSettingsProxySystem: "System",
  downloadSettingsProxyDirect: "Direct",
  downloadSettingsProxyHttp: "HTTP",
  downloadSettingsProxySocks5: "SOCKS5",
  downloadSettingsProxyUrl: "Proxy URL",
  downloadSettingsCookie: "Cookie",
  downloadSettingsHeaders: "Headers",
  downloadSettingsPostProcessing: "Post-processing",
  downloadSettingsAutoExtract: "Auto extract",
  downloadSettingsDeleteArchive: "Delete archive",
  downloadSettingsDetectSplitArchives: "Detect split archives",
  downloadSettingsExtractDirectory: "Extract directory",
  downloadSettingsBt: "BT",
  downloadSettingsBtDht: "DHT",
  downloadSettingsBtPeerExchange: "PEX",
  downloadSettingsBtLocalPeerDiscovery: "Local peer discovery",
  downloadSettingsBtSeedTime: "Seed time",
  downloadSettingsBtTrackers: "Trackers",
  downloadSettingsBtUploadLimit: "BT upload limit",
  downloadRemoteApi: "Remote API",
  downloadRemoteApiStart: "Start remote API",
  downloadRemoteApiStop: "Stop remote API",
  downloadRemoteApiRunning: "Running",
  downloadRemoteApiStopped: "Stopped",
  downloadRemoteApiHost: "Host",
  downloadRemoteApiPort: "Port",
  downloadRemoteApiAllowLan: "Allow LAN",
  downloadRemoteApiToken: "Token available",
  searchIndexTitle: "Local Index",
  searchIndexReady: "Complete",
  searchIndexBuilding: "Indexing",
  searchIndexIdle: "Not built",
  searchIndexFailed: "Failed",
  searchIndexUnavailable: "Index unavailable",
  searchIndexNeedsRebuild: "Reindex required",
  searchIndexRebuild: "Reindex",
  searchIndexRebuilding: "Reindexing",
  searchIndexStats: "{files} files · {contentFiles} content · {storage}",
  searchIndexPending: "{count} pending changes",
  searchIndexPhase: "Phase: {phase}",
  chooserBindProjectLabel: "Bind project",
  chooserSelectDirectoryPlaceholder: "Open a directory to bind"
};

const createState = (overrides: Partial<FileManagerAppState> = {}): FileManagerAppState => ({
  instanceId: "fm-1",
  status: "ready",
  viewKind: "directory",
  presentationMode: "list",
  title: "Files",
  iconKey: "file-manager-directory",
  currentLocation: {
    id: "project",
    title: "Project",
    kind: "directory",
    path: "/tmp/project"
  },
  parentPath: "/tmp",
  history: [
    {
      id: "tmp",
      title: "tmp",
      kind: "directory",
      path: "/tmp"
    },
    {
      id: "project",
      title: "Project",
      kind: "directory",
      path: "/tmp/project"
    }
  ],
  historyIndex: 1,
  systemLocations: [
    {
      id: "trash",
      title: "Trash",
      kind: "trash",
      specialId: "trash"
    }
  ],
  favorites: [],
  recentLocations: [],
  disks: [],
  devices: [],
  entries: [
    {
      id: "dir-1",
      name: "src",
      kind: "directory",
      path: "/tmp/project/src",
      folderState: "non-empty",
      isHidden: false
    },
    {
      id: "file-1",
      name: "README.md",
      kind: "file",
      path: "/tmp/project/README.md",
      isHidden: false
    }
  ],
  trashEntries: [],
  downloadTasks: [],
  downloadStatus: "ready",
  downloadUrlDraft: "",
  downloadAdvancedDraft: {
    advancedOpen: false,
    cookieHeader: "",
    headersText: "",
    mirrorsText: "",
    btSelectedFileIndexesText: "",
    btTrackerUrlsText: "",
    partialFilePath: "",
    checksumAlgorithm: "none",
    checksumExpected: "",
    maxRetries: "",
    retryDelaySeconds: "",
    proxyMode: "system",
    proxyUrl: ""
  },
  downloadErrorMessage: undefined,
  downloadSettings: null,
  downloadRemoteApiStatus: null,
  downloadSettingsOpen: false,
  downloadSettingsDraft: {
    speedLimitKibPerSecond: "",
    scheduleEnabled: false,
    scheduleStartTime: "00:00",
    scheduleEndTime: "23:59",
    scheduleOutsideAction: "pause",
    scheduleOutsideSpeedLimitKibPerSecond: "",
    proxyMode: "system",
    proxyUrl: "",
    defaultCookieHeader: "",
    defaultHeadersText: "",
    autoExtract: false,
    deleteArchiveAfterExtract: false,
    detectSplitArchives: true,
    extractDirectory: "",
    btDhtEnabled: true,
    btPeerExchangeEnabled: true,
    btLocalPeerDiscoveryEnabled: true,
    btSeedTimeMinutes: "0",
    btTrackerUrlsText: "",
    btUploadLimitKibPerSecond: "",
    remoteHost: "127.0.0.1",
    remotePort: "",
    remoteAllowLan: false,
    saveRules: []
  },
  downloadSettingsErrorMessage: undefined,
  directorySubscriptionId: undefined,
  directoryGeneration: undefined,
  selectedEntryId: "file-1",
  selectedTrashEntryId: undefined,
  createDraft: undefined,
  errorMessage: undefined,
  ...overrides
});

const createModel = (): FileManagerModel => ({
  createInstance: vi.fn(),
  getState: vi.fn(),
  ensureInstance: vi.fn(),
  syncExternalInstances: vi.fn(),
  syncTabInstances: vi.fn(),
  openHome: vi.fn().mockResolvedValue(undefined),
  openDirectory: vi.fn().mockResolvedValue(undefined),
  openTrash: vi.fn().mockResolvedValue(undefined),
  openDownloads: vi.fn().mockResolvedValue(undefined),
  goBack: vi.fn().mockResolvedValue(undefined),
  goForward: vi.fn().mockResolvedValue(undefined),
  goUp: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  setPresentationMode: vi.fn(),
  selectEntry: vi.fn(),
  selectTrashEntry: vi.fn(),
  beginCreateDraft: vi.fn(),
  updateCreateDraft: vi.fn(),
  cancelCreateDraft: vi.fn(),
  commitCreateDraft: vi.fn().mockResolvedValue(undefined),
  moveSelectionToTrash: vi.fn().mockResolvedValue(undefined),
  restoreSelectionFromTrash: vi.fn().mockResolvedValue(undefined),
  emptyTrash: vi.fn().mockResolvedValue(undefined),
  updateDownloadUrlDraft: vi.fn(),
  toggleDownloadAdvancedOptions: vi.fn(),
  updateDownloadAdvancedDraft: vi.fn(),
  submitDownloadUrlDraft: vi.fn().mockResolvedValue(undefined),
  submitDownloadText: vi.fn().mockResolvedValue(undefined),
  importExternalBrowserDownloads: vi.fn().mockResolvedValue(undefined),
  pauseDownload: vi.fn().mockResolvedValue(undefined),
  resumeDownload: vi.fn().mockResolvedValue(undefined),
  cancelDownload: vi.fn().mockResolvedValue(undefined),
  retryDownload: vi.fn().mockResolvedValue(undefined),
  removeDownload: vi.fn().mockResolvedValue(undefined),
  setDownloadPriority: vi.fn().mockResolvedValue(undefined),
  pauseAllDownloads: vi.fn().mockResolvedValue(undefined),
  resumeAllDownloads: vi.fn().mockResolvedValue(undefined),
  cancelAllDownloads: vi.fn().mockResolvedValue(undefined),
  openDownloadedFile: vi.fn().mockResolvedValue(undefined),
  revealDownloadedFile: vi.fn().mockResolvedValue(undefined),
  toggleDownloadSettings: vi.fn().mockResolvedValue(undefined),
  updateDownloadSettingsDraft: vi.fn(),
  addDownloadSaveRuleDraft: vi.fn(),
  removeDownloadSaveRuleDraft: vi.fn(),
  updateDownloadSaveRuleDraft: vi.fn(),
  saveDownloadSettings: vi.fn().mockResolvedValue(undefined),
  startDownloadRemoteApi: vi.fn().mockResolvedValue(undefined),
  stopDownloadRemoteApi: vi.fn().mockResolvedValue(undefined),
  toggleCurrentDirectoryFavorite: vi.fn().mockResolvedValue(undefined),
  openEntryContextMenu: vi.fn(),
  openFavoriteContextMenu: vi.fn(),
  openLocationContextMenu: vi.fn(),
  openRecentLocationContextMenu: vi.fn(),
  openDiskContextMenu: vi.fn(),
  openDeviceContextMenu: vi.fn(),
  openTrashEntryContextMenu: vi.fn(),
  openDirectoryContextMenu: vi.fn(),
  openTrashContextMenu: vi.fn()
});

const createSearchIndexStatus = (
  overrides: Partial<SearchIndexStatusResponse> = {}
): SearchIndexStatusResponse => ({
  state: "ready",
  engineVersion: "native-v3",
  phase: "ready",
  policyHash: "policy",
  policySource: ["builtin"],
  policyWarnings: [],
  indexedFiles: 42,
  indexedDirs: 8,
  indexedContentFiles: 7,
  storageBytes: 2048,
  snapshotBytes: 2048,
  deltaBytes: 0,
  pendingChanges: 0,
  skipped: {
    hidden: 0,
    vendor: 0,
    binaryOrTooLarge: 0,
    unreadable: 0,
    contentBudget: 0
  },
  roots: [
    {
      root: "/tmp/project",
      state: "ready",
      indexedFiles: 42,
      indexedDirs: 8,
      indexedContentFiles: 7,
      contentBytesIndexed: 1024,
      skipped: {
        hidden: 0,
        vendor: 0,
        binaryOrTooLarge: 0,
        unreadable: 0,
        contentBudget: 0
      },
      lastBuiltAt: "2026-06-10T00:00:00.000Z"
    }
  ],
  lastBuiltAt: "2026-06-10T00:00:00.000Z",
  progress: 1,
  ...overrides
});

const renderFileManagerSurface = (
  props: ComponentProps<typeof FileManagerSurface>
) => {
  const scopeId = "file-manager-test";
  return render(
    <WorkbenchTitlebarContextProvider activeScopeId={scopeId}>
      <WorkbenchTitlebarScopeProvider scopeId={scopeId}>
        <FileManagerSurface {...props} />
      </WorkbenchTitlebarScopeProvider>
      <WorkbenchTitlebarContextSlot />
    </WorkbenchTitlebarContextProvider>
  );
};

describe("FileManagerSurface", () => {
  test("routes toolbar actions through the file manager model", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    fireEvent.click(screen.getByLabelText("Back"));
    fireEvent.click(screen.getByLabelText("Large view"));
    fireEvent.click(screen.getByLabelText("New file"));
    fireEvent.click(screen.getByLabelText("Delete"));

    expect(model.goBack).toHaveBeenCalledWith("fm-1");
    expect(model.setPresentationMode).toHaveBeenCalledWith("fm-1", "large");
    expect(model.beginCreateDraft).toHaveBeenCalledWith("fm-1", "file");
    expect(model.moveSelectionToTrash).toHaveBeenCalledWith("fm-1");
  });

  test("opens files and directories from directory rows", () => {
    const model = createModel();
    const onOpenFile = vi.fn();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile
    });

    fireEvent.doubleClick(screen.getByText("README.md").closest("button")!);
    fireEvent.doubleClick(screen.getByText("src").closest("button")!);

    expect(onOpenFile).toHaveBeenCalledWith("/tmp/project/README.md");
    expect(model.openDirectory).toHaveBeenCalledWith("fm-1", "/tmp/project/src");
  });

  test("routes special trash locations and chooser confirmation", () => {
    const model = createModel();
    const onConfirm = vi.fn();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile: vi.fn(),
      chooser: {
        kind: "ai-project-bind",
        confirmLabel: "Bind",
        promptLabel: "Bind project",
        selectPlaceholder: "Open a directory",
        onConfirm
      }
    });

    fireEvent.click(screen.getByText("Trash"));
    fireEvent.click(screen.getByRole("button", { name: "Bind" }));

    expect(model.openTrash).toHaveBeenCalledWith("fm-1");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("opens the download manager from the file manager sidebar", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState(),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    fireEvent.click(screen.getByText("Download Manager"));

    expect(model.openDownloads).toHaveBeenCalledWith("fm-1");
  });

  test("shows real local search index status and can request reindex", async () => {
    const model = createModel();
    const readIndexStatus = vi.fn(async () => createSearchIndexStatus());
    const rebuildIndex = vi.fn(async () => ({
      status: createSearchIndexStatus({
        state: "building",
        phase: "indexing",
        progress: 0
      }),
      scopePreset: "home" as const,
      roots: ["/tmp/project"]
    }));
    renderFileManagerSurface({
      desktopApi: {
        search: {
          readIndexStatus,
          rebuildIndex
        }
      } as unknown as LyraDesktopApi,
      state: createState(),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    expect(await screen.findByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("42 files · 7 content · 2 KiB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reindex" }));

    await waitFor(() => {
      expect(rebuildIndex).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Indexing")).toBeInTheDocument();
  });

  test("routes download manager form and row actions", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        viewKind: "downloads",
        title: "Download Manager",
        iconKey: "file-manager-download-manager",
        currentLocation: {
          id: "download-manager",
          title: "Download Manager",
          kind: "special",
          specialId: "downloadManager"
        },
        parentPath: undefined,
        entries: [],
        selectedEntryId: undefined,
        downloadUrlDraft: "https://example.com/build.zip",
        downloadTasks: [
          {
            id: "download-1",
            url: "https://example.com/build.zip",
            fileName: "build.zip",
            savePath: "/tmp/build.zip",
            directory: "/tmp",
            protocol: "https",
            source: "manual",
            state: "downloading",
            receivedBytes: 512,
            totalBytes: 1024,
            speedBytesPerSecond: 256,
            estimatedRemainingMs: 120_000,
            priority: "normal",
            connectionsRequested: 1,
            connectionsActive: 1,
            canResume: true,
            checksum: {
              algorithm: "sha256",
              expected: "abc123",
              verified: true
            },
            createdAt: "2026-05-04T00:00:00.000Z",
            updatedAt: "2026-05-04T00:00:01.000Z",
            tags: []
          }
        ]
      }),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    fireEvent.change(screen.getByPlaceholderText("Paste URL"), {
      target: { value: "https://example.com/next.zip" }
    });
    fireEvent.submit(screen.getByPlaceholderText("Paste URL").closest("form")!);
    fireEvent.click(screen.getByLabelText("Pause"));
    fireEvent.click(screen.getByLabelText("Pause all"));
    fireEvent.click(screen.getByLabelText("Cancel"));
    fireEvent.click(screen.getByLabelText("Cancel all"));
    fireEvent.click(screen.getByRole("combobox", { name: "Priority: build.zip" }));
    fireEvent.click(screen.getByRole("option", { name: "High" }));

    expect(screen.getByText("2m 0s left")).toBeInTheDocument();
    expect(screen.getByText("SHA256 verified")).toBeInTheDocument();
    expect(model.updateDownloadUrlDraft).toHaveBeenCalledWith("fm-1", "https://example.com/next.zip");
    expect(model.submitDownloadUrlDraft).toHaveBeenCalledWith("fm-1");
    expect(model.pauseDownload).toHaveBeenCalledWith("download-1");
    expect(model.pauseAllDownloads).toHaveBeenCalledTimes(1);
    expect(model.cancelDownload).toHaveBeenCalledWith("download-1");
    expect(model.cancelAllDownloads).toHaveBeenCalledTimes(1);
    expect(model.setDownloadPriority).toHaveBeenCalledWith("download-1", "high");
  });

  test("routes advanced download draft edits", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        viewKind: "downloads",
        title: "Download Manager",
        iconKey: "file-manager-download-manager",
        currentLocation: {
          id: "download-manager",
          title: "Download Manager",
          kind: "special",
          specialId: "downloadManager"
        },
        parentPath: undefined,
        entries: [],
        selectedEntryId: undefined,
        downloadAdvancedDraft: {
          advancedOpen: true,
          cookieHeader: "",
          headersText: "",
          mirrorsText: "",
          btSelectedFileIndexesText: "",
          btTrackerUrlsText: "",
          partialFilePath: "",
          checksumAlgorithm: "sha256",
          checksumExpected: "",
          maxRetries: "",
          retryDelaySeconds: "",
          proxyMode: "http",
          proxyUrl: ""
        }
      }),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    fireEvent.change(screen.getByLabelText("Cookie"), {
      target: { value: "sid=1" }
    });
    fireEvent.change(screen.getByLabelText("Request headers"), {
      target: { value: "Authorization: Bearer token" }
    });
    fireEvent.change(screen.getByLabelText("Mirror URLs"), {
      target: { value: "https://mirror.example.com/file.zip" }
    });
    fireEvent.change(screen.getByLabelText("BT file indexes"), {
      target: { value: "1,3" }
    });
    fireEvent.change(screen.getByLabelText("BT trackers"), {
      target: { value: "udp://tracker.example.com:80/announce" }
    });
    fireEvent.change(screen.getByLabelText("Existing partial file"), {
      target: { value: "/tmp/file.zip.crdownload" }
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Checksum" }));
    fireEvent.click(screen.getByRole("option", { name: "SHA1" }));
    fireEvent.change(screen.getByLabelText("Checksum value"), {
      target: { value: "abc123" }
    });
    fireEvent.change(screen.getByLabelText("Max retries"), {
      target: { value: "5" }
    });
    fireEvent.change(screen.getByLabelText("Retry delay"), {
      target: { value: "3" }
    });
    fireEvent.change(screen.getByLabelText("Proxy URL"), {
      target: { value: "http://127.0.0.1:8080" }
    });

    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      cookieHeader: "sid=1"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      headersText: "Authorization: Bearer token"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      mirrorsText: "https://mirror.example.com/file.zip"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      btSelectedFileIndexesText: "1,3"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      btTrackerUrlsText: "udp://tracker.example.com:80/announce"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      partialFilePath: "/tmp/file.zip.crdownload"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      checksumAlgorithm: "sha1"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      checksumExpected: "abc123"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      maxRetries: "5"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      retryDelaySeconds: "3"
    });
    expect(model.updateDownloadAdvancedDraft).toHaveBeenCalledWith("fm-1", {
      proxyUrl: "http://127.0.0.1:8080"
    });
  });

  test("routes download settings edits and remote API actions", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        viewKind: "downloads",
        title: "Download Manager",
        iconKey: "file-manager-download-manager",
        currentLocation: {
          id: "download-manager",
          title: "Download Manager",
          kind: "special",
          specialId: "downloadManager"
        },
        parentPath: undefined,
        entries: [],
        selectedEntryId: undefined,
        downloadSettingsOpen: true,
        downloadSettingsDraft: {
          speedLimitKibPerSecond: "",
          scheduleEnabled: true,
          scheduleStartTime: "01:00",
          scheduleEndTime: "09:00",
          scheduleOutsideAction: "speed-limit",
          scheduleOutsideSpeedLimitKibPerSecond: "",
          proxyMode: "system",
          proxyUrl: "",
          defaultCookieHeader: "",
          defaultHeadersText: "",
          autoExtract: false,
          deleteArchiveAfterExtract: false,
          detectSplitArchives: true,
          extractDirectory: "",
          btDhtEnabled: true,
          btPeerExchangeEnabled: true,
          btLocalPeerDiscoveryEnabled: true,
          btSeedTimeMinutes: "0",
          btTrackerUrlsText: "",
          btUploadLimitKibPerSecond: "",
          remoteHost: "127.0.0.1",
          remotePort: "",
          remoteAllowLan: false,
          saveRules: [
            {
              id: "rule-1",
              enabled: true,
              name: "Archives",
              directory: "/tmp/archives",
              extensionsText: "zip",
              hostContainsText: "example.com",
              protocolsText: "https",
              tagsText: "archive"
            }
          ]
        }
      }),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    fireEvent.change(screen.getByLabelText("Speed limit"), {
      target: { value: "512" }
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "02:00" }
    });
    fireEvent.change(screen.getByLabelText("Outside speed limit"), {
      target: { value: "128" }
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Proxy mode" }));
    fireEvent.click(screen.getByRole("option", { name: "SOCKS5" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto extract" }));
    fireEvent.click(screen.getByLabelText("Add save rule"));
    fireEvent.change(screen.getByLabelText("Rule name"), {
      target: { value: "Installers" }
    });
    fireEvent.change(screen.getByLabelText("Save directory"), {
      target: { value: "/tmp/installers" }
    });
    fireEvent.click(screen.getByLabelText("Remove save rule: Archives"));
    fireEvent.click(screen.getByLabelText("Save download settings"));
    fireEvent.click(screen.getByLabelText("Start remote API"));

    expect(model.updateDownloadSettingsDraft).toHaveBeenCalledWith("fm-1", {
      speedLimitKibPerSecond: "512"
    });
    expect(model.updateDownloadSettingsDraft).toHaveBeenCalledWith("fm-1", {
      scheduleStartTime: "02:00"
    });
    expect(model.updateDownloadSettingsDraft).toHaveBeenCalledWith("fm-1", {
      scheduleOutsideSpeedLimitKibPerSecond: "128"
    });
    expect(model.updateDownloadSettingsDraft).toHaveBeenCalledWith("fm-1", {
      proxyMode: "socks5"
    });
    expect(model.updateDownloadSettingsDraft).toHaveBeenCalledWith("fm-1", {
      autoExtract: true
    });
    expect(model.addDownloadSaveRuleDraft).toHaveBeenCalledWith("fm-1");
    expect(model.updateDownloadSaveRuleDraft).toHaveBeenCalledWith("fm-1", "rule-1", {
      name: "Installers"
    });
    expect(model.updateDownloadSaveRuleDraft).toHaveBeenCalledWith("fm-1", "rule-1", {
      directory: "/tmp/installers"
    });
    expect(model.removeDownloadSaveRuleDraft).toHaveBeenCalledWith("fm-1", "rule-1");
    expect(model.saveDownloadSettings).toHaveBeenCalledWith("fm-1");
    expect(model.startDownloadRemoteApi).toHaveBeenCalledWith("fm-1");
  });

  test("shows a directory-selection placeholder before chooser confirmation is available", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        viewKind: "home",
        currentLocation: null,
        parentPath: undefined,
        entries: [],
        selectedEntryId: undefined
      }),
      labels,
      model,
      onOpenFile: vi.fn(),
      chooser: {
        kind: "ai-project-bind",
        confirmLabel: "Bind",
        promptLabel: "Bind project",
        selectPlaceholder: "Open a directory to bind",
        onConfirm: vi.fn()
      }
    });

    expect(screen.getByText("Open a directory to bind")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bind" })).toBeDisabled();
  });

  test("routes create draft input edits and keyboard decisions", () => {
    const model = createModel();
    renderFileManagerSurface({
      state: createState({
        createDraft: {
          kind: "file",
          value: "notes.md"
        }
      }),
      labels,
      model,
      onOpenFile: vi.fn()
    });

    const input = screen.getByPlaceholderText("File name");

    fireEvent.change(input, { target: { value: "plan.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(model.updateCreateDraft).toHaveBeenCalledWith("fm-1", "plan.md");
    expect(model.commitCreateDraft).toHaveBeenCalledWith("fm-1");
    expect(model.cancelCreateDraft).toHaveBeenCalledWith("fm-1");
  });
});
