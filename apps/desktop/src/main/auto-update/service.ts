import { BrowserWindow, ipcMain, type App } from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LYRA_CHANNELS, type AppUpdateStatus } from "../../shared/desktop-bridge";

export const SIGNED_CORE_UPDATE_FLAG = "LYRA_ENABLE_SIGNED_CORE_UPDATES";
const CORE_UPDATE_KILL_SWITCH = "LYRA_DISABLE_AUTO_UPDATE";

export type SignedComponentAppUpdater = {
  readonly check: () => Promise<{ readonly releaseVersion: string }>;
  readonly download: (onProgress: (percent: number) => void) => Promise<{ readonly releaseVersion: string }>;
  readonly install: () => Promise<void>;
};

const compareSemver = (left: string, right: string): number => {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value);
    if (match === null) return null;
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
      prerelease: match[4]?.split(".") ?? []
    };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  if (leftVersion === null || rightVersion === null) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.core[index]! - rightVersion.core[index]!;
    if (difference !== 0) return difference;
  }
  if (leftVersion.prerelease.length === 0) return rightVersion.prerelease.length === 0 ? 0 : 1;
  if (rightVersion.prerelease.length === 0) return -1;
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart.localeCompare(rightPart, "en");
  }
  return 0;
};

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
  hasUpdaterMetadata: () => boolean = hasElectronUpdaterMetadata,
  signedComponentUpdater?: SignedComponentAppUpdater
): (() => void) => {
  const updatesEnabled = app.isPackaged && process.env[CORE_UPDATE_KILL_SWITCH] !== "1";
  const electronUpdaterSupported = updatesEnabled && hasUpdaterMetadata();
  const signedUpdaterSupported = updatesEnabled && signedComponentUpdater !== undefined;
  let status: AppUpdateStatus = {
    state: electronUpdaterSupported || signedUpdaterSupported ? "idle" : "unsupported",
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
  if (!electronUpdaterSupported && !signedUpdaterSupported) {
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

  if (!electronUpdaterSupported && signedComponentUpdater !== undefined) {
    const check = async (): Promise<AppUpdateStatus> => {
      publish({ state: "checking", currentVersion: app.getVersion() });
      try {
        const result = await signedComponentUpdater.check();
        return publish(compareSemver(result.releaseVersion, app.getVersion()) <= 0
          ? { state: "idle", currentVersion: app.getVersion() }
          : { state: "available", currentVersion: app.getVersion(), availableVersion: result.releaseVersion });
      } catch (error) { return failure(error); }
    };
    const download = async (): Promise<AppUpdateStatus> => {
      if (status.state !== "available") return status;
      try {
        const availableVersion = status.availableVersion ?? app.getVersion();
        publish({ state: "downloading", currentVersion: app.getVersion(), availableVersion, progress: 0 });
        const result = await signedComponentUpdater.download((progress) => {
          publish({ state: "downloading", currentVersion: app.getVersion(), availableVersion, progress });
        });
        return publish({ state: "ready", currentVersion: app.getVersion(), availableVersion: result.releaseVersion, progress: 100 });
      } catch (error) { return failure(error); }
    };
    ipcMain.handle(LYRA_CHANNELS.appUpdateReadStatus, () => status);
    ipcMain.handle(LYRA_CHANNELS.appUpdateCheck, check);
    ipcMain.handle(LYRA_CHANNELS.appUpdateDownload, download);
    ipcMain.handle(LYRA_CHANNELS.appUpdateInstall, async () => {
      if (status.state === "ready") await signedComponentUpdater.install();
    });
    queueMicrotask(() => { void check(); });
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
