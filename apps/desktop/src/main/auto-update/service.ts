import type { App } from "electron";
import { autoUpdater } from "electron-updater";

export const createAutoUpdateService = (app: App): (() => void) => {
  if (!app.isPackaged || process.env.LYRA_DISABLE_AUTO_UPDATE === "1") {
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
