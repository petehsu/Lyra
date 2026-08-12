import { BrowserWindow, ipcMain, type App } from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LYRA_CHANNELS, type AppUpdateStatus } from "../../shared/desktop-bridge";

export const SIGNED_CORE_UPDATE_FLAG = "LYRA_ENABLE_SIGNED_CORE_UPDATES";
const CORE_UPDATE_KILL_SWITCH = "LYRA_DISABLE_AUTO_UPDATE";

export const isSignedCoreAutoUpdateEnabled = (
  app: Pick<App, "isPackaged">,
  env: NodeJS.ProcessEnv = process.env
): boolean => (
  app.isPackaged
  && env[SIGNED_CORE_UPDATE_FLAG] === "1"
  && env[CORE_UPDATE_KILL_SWITCH] !== "1"
);

/**
 * electron-updater requires this file to know the publishing provider and
 * channel. Online/custom installers deliberately omit it, so treating that
 * packaging format as an updater failure only confuses people on a fresh
 * install.
 */
export const hasElectronUpdaterMetadata = (
  resourcesPath: string = process.resourcesPath ?? ""
): boolean => existsSync(join(resourcesPath, "app-update.yml"));

export const createAutoUpdateService = (
  app: App,
  getWindow: () => BrowserWindow | null = () => null,
  hasUpdaterMetadata: () => boolean = hasElectronUpdaterMetadata
): (() => void) => {
  const updaterSupported = app.isPackaged
    && process.env[CORE_UPDATE_KILL_SWITCH] !== "1"
    && hasUpdaterMetadata();
  let status: AppUpdateStatus = {
    state: updaterSupported ? "idle" : "unsupported",
    currentVersion: app.getVersion()
  };
  const publish = (next: AppUpdateStatus): AppUpdateStatus => {
    status = next;
    const window = getWindow();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(LYRA_CHANNELS.appUpdateStatusChanged, status);
    }
    return status;
  };
  const failure = (error: unknown): AppUpdateStatus => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[lyra-updater] ${message}`);
    return publish({ state: "error", currentVersion: app.getVersion(), error: message });
  };
  if (!updaterSupported) {
    ipcMain.handle(LYRA_CHANNELS.appUpdateReadStatus, () => status);
    ipcMain.handle(LYRA_CHANNELS.appUpdateCheck, () => status);
    ipcMain.handle(LYRA_CHANNELS.appUpdateDownload, () => status);
    ipcMain.handle(LYRA_CHANNELS.appUpdateInstall, () => undefined);
    return () => {
      ipcMain.removeHandler(LYRA_CHANNELS.appUpdateReadStatus);
      ipcMain.removeHandler(LYRA_CHANNELS.appUpdateCheck);
      ipcMain.removeHandler(LYRA_CHANNELS.appUpdateDownload);
      ipcMain.removeHandler(LYRA_CHANNELS.appUpdateInstall);
    };
  }

  // Checking only reads a small release manifest. Downloading and installing always
  // require an explicit action from the user.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const onChecking = (): void => { publish({ state: "checking", currentVersion: app.getVersion() }); };
  const updateDetails = (info: unknown): Pick<AppUpdateStatus, "availableVersion" | "releaseNotes"> => {
    if (typeof info !== "object" || info === null || typeof (info as { version?: unknown }).version !== "string") {
      return {};
    }
    const notes = (info as { releaseNotes?: unknown }).releaseNotes;
    return {
      availableVersion: (info as { version: string }).version,
      ...(typeof notes === "string" && notes.trim().length > 0 ? { releaseNotes: notes } : {})
    };
  };
  const onAvailable = (info: unknown): void => {
    publish({ state: "available", currentVersion: app.getVersion(), ...updateDetails(info) });
  };
  const onNotAvailable = (): void => { publish({ state: "idle", currentVersion: app.getVersion() }); };
  const onProgress = (progress: { percent: number }): void => {
    publish({ ...status, state: "downloading", progress: Math.min(100, Math.max(0, Math.round(progress.percent))) });
  };
  const onDownloaded = (info: unknown): void => {
    publish({ state: "ready", currentVersion: app.getVersion(), ...updateDetails(info), progress: 100 });
  };
  autoUpdater.on("checking-for-update", onChecking);
  autoUpdater.on("update-available", onAvailable);
  autoUpdater.on("update-not-available", onNotAvailable);
  autoUpdater.on("download-progress", onProgress);
  autoUpdater.on("update-downloaded", onDownloaded);
  autoUpdater.on("error", failure);

  const check = async (): Promise<AppUpdateStatus> => {
    try {
      await autoUpdater.checkForUpdates();
      return status;
    } catch (error) { return failure(error); }
  };
  const download = async (): Promise<AppUpdateStatus> => {
    if (status.state !== "available") return status;
    try {
      publish({ ...status, state: "downloading", progress: 0 });
      await autoUpdater.downloadUpdate();
      return status;
    } catch (error) { return failure(error); }
  };
  ipcMain.handle(LYRA_CHANNELS.appUpdateReadStatus, () => status);
  ipcMain.handle(LYRA_CHANNELS.appUpdateCheck, check);
  ipcMain.handle(LYRA_CHANNELS.appUpdateDownload, download);
  ipcMain.handle(LYRA_CHANNELS.appUpdateInstall, () => {
    if (status.state === "ready") autoUpdater.quitAndInstall();
  });
  queueMicrotask(() => { void check(); });
  return () => {
    ipcMain.removeHandler(LYRA_CHANNELS.appUpdateReadStatus);
    ipcMain.removeHandler(LYRA_CHANNELS.appUpdateCheck);
    ipcMain.removeHandler(LYRA_CHANNELS.appUpdateDownload);
    ipcMain.removeHandler(LYRA_CHANNELS.appUpdateInstall);
    autoUpdater.off("checking-for-update", onChecking);
    autoUpdater.off("update-available", onAvailable);
    autoUpdater.off("update-not-available", onNotAvailable);
    autoUpdater.off("download-progress", onProgress);
    autoUpdater.off("update-downloaded", onDownloaded);
    autoUpdater.off("error", failure);
  };
};
