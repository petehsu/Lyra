import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { App, BrowserWindow } from "electron";
import type { IpcMain } from "electron";

import { LYRA_CHANNELS, type ProductUninstallProgress } from "../../shared/desktop-bridge";
import type { LyraStorageRoots } from "../storage";
import {
  removeProductInstallation,
  resolvePackagedAppRoot,
  type ProductUninstallRequest
} from "./service";
import {
  registerWindowsUninstallEntry,
  removeWindowsUninstallEntries,
  windowsInstallLocation
} from "./windows-arp";

type ProductUninstallHostOptions = {
  readonly app: App;
  readonly ipcMain: IpcMain;
  readonly getWindow: () => BrowserWindow | null;
  readonly roots: LyraStorageRoots;
};

const argvWantsUninstaller = (argv: readonly string[]): boolean =>
  argv.some((value) => value === "--uninstall" || value === "-uninstall" || value === "/uninstall");

export const readForceUninstaller = (argv: readonly string[], env: NodeJS.ProcessEnv): boolean =>
  env.LYRA_UNINSTALLER_MODE === "1" || argvWantsUninstaller(argv);

const looksLikeLyraInstall = (appRoot: string, platform: NodeJS.Platform): boolean => {
  if (platform === "darwin") {
    return appRoot.toLowerCase().endsWith(".app");
  }
  if (typeof process.env.APPIMAGE === "string" && process.env.APPIMAGE === appRoot) {
    return true;
  }
  return existsSync(path.join(appRoot, "resources", "app.asar"))
    || existsSync(path.join(appRoot, "Uninstall Lyra.exe"));
};

const schedulePackagedAppRemoval = (
  app: App,
  appRoot: string | null,
  platform: NodeJS.Platform
): void => {
  if (appRoot === null || !looksLikeLyraInstall(appRoot, platform)) {
    return;
  }
  app.once("will-quit", () => {
    if (platform === "win32") {
      spawn(
        "cmd.exe",
        ["/d", "/c", `ping 127.0.0.1 -n 4 > nul & rmdir /s /q "${appRoot}"`],
        { detached: true, stdio: "ignore", windowsHide: true }
      ).unref();
      return;
    }
    spawn("/bin/rm", ["-rf", appRoot], { detached: true, stdio: "ignore" }).unref();
  });
};

export const registerProductUninstallIpc = (options: ProductUninstallHostOptions): (() => void) => {
  const sendProgress = (progress: ProductUninstallProgress): void => {
    const window = options.getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.appUninstallProgress, progress);
  };

  options.ipcMain.handle(
    LYRA_CHANNELS.appUninstallProduct,
    async (_event, value: unknown) => {
      const request: ProductUninstallRequest = {
        removeUserData: value !== null
          && typeof value === "object"
          && "removeUserData" in value
          && (value as { removeUserData?: unknown }).removeUserData === true
      };
      await removeProductInstallation({
        roots: options.roots,
        request,
        platform: process.platform,
        env: process.env,
        onProgress: sendProgress
      });
      options.app.removeAsDefaultProtocolClient("lyra");
      await removeWindowsUninstallEntries();
      schedulePackagedAppRemoval(
        options.app,
        resolvePackagedAppRoot({
          execPath: process.execPath,
          platform: process.platform,
          env: process.env,
          isPackaged: options.app.isPackaged
        }),
        process.platform
      );
    }
  );

  options.ipcMain.handle(
    LYRA_CHANNELS.appRegisterUninstall,
    async () => {
      await registerHostUninstallEntry(options.app);
    }
  );

  return () => {
    options.ipcMain.removeHandler(LYRA_CHANNELS.appUninstallProduct);
    options.ipcMain.removeHandler(LYRA_CHANNELS.appRegisterUninstall);
  };
};

export const registerHostUninstallEntry = async (app: App): Promise<void> => {
  if (!app.isPackaged || process.platform !== "win32") {
    return;
  }
  await registerWindowsUninstallEntry({
    executablePath: process.execPath,
    installLocation: windowsInstallLocation(process.execPath),
    version: app.getVersion()
  });
};

export const notifyOpenUninstaller = (getWindow: () => BrowserWindow | null): void => {
  const window = getWindow();
  if (window === null || window.isDestroyed()) {
    return;
  }
  window.webContents.send(LYRA_CHANNELS.appUninstallOpen);
};
