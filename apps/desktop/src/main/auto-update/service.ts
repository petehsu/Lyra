import type { App } from "electron";
import { autoUpdater } from "electron-updater";

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

export const createAutoUpdateService = (app: App): (() => void) => {
  // The release pipeline must only set this flag for platform-signed Core builds.
  // Unsigned Beta packages remain manual-update-only even though they are packaged.
  if (!isSignedCoreAutoUpdateEnabled(app)) {
    return () => undefined;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const onError = (error: Error): void => {
    console.warn(`[lyra-updater] ${error.message}`);
  };
  autoUpdater.on("error", onError);

  queueMicrotask(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch(onError);
  });

  return () => {
    autoUpdater.off("error", onError);
  };
};
