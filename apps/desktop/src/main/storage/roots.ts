import { app } from "electron";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LyraModuleStorageRoots = {
  readonly agent: string;
  readonly fileManager: string;
  readonly runtime: string;
  readonly linuxCompat: string;
  readonly terminal: string;
  readonly workbenchState: string;
  readonly uiuxPacks: string;
  readonly search: string;
  readonly identity: string;
  readonly imageViewer: string;
  readonly downloadManager: string;
  readonly loginManager: string;
};

export type LyraStorageRoots = {
  readonly lyraRoot: string;
  readonly modulesRoot: string;
  readonly electronRoot: string;
  readonly electronDesktopRoot: string;
  readonly modules: LyraModuleStorageRoots;
};

export const resolveLyraStorageRoots = (): LyraStorageRoots => {
  const lyraRoot = path.join(os.homedir(), ".lyra");
  const modulesRoot = path.join(lyraRoot, "modules");
  const electronRoot = path.join(lyraRoot, "electron");
  const electronDesktopRoot = path.join(electronRoot, "desktop");

  return {
    lyraRoot,
    modulesRoot,
    electronRoot,
    electronDesktopRoot,
    modules: {
      agent: path.join(modulesRoot, "agent"),
      fileManager: path.join(modulesRoot, "file-manager"),
      runtime: path.join(modulesRoot, "runtime"),
      linuxCompat: path.join(modulesRoot, "linux-compat"),
      terminal: path.join(modulesRoot, "terminal"),
      workbenchState: path.join(modulesRoot, "workbench-state"),
      uiuxPacks: path.join(modulesRoot, "uiux-packs"),
      search: path.join(modulesRoot, "search"),
      identity: path.join(modulesRoot, "identity"),
      imageViewer: path.join(modulesRoot, "image-viewer"),
      downloadManager: path.join(modulesRoot, "download-manager"),
      loginManager: path.join(modulesRoot, "login-manager")
    }
  };
};

export const ensureLyraStorageRoots = (roots: LyraStorageRoots): void => {
  const directories = [
    roots.lyraRoot,
    roots.modulesRoot,
    roots.electronRoot,
    roots.electronDesktopRoot,
    ...Object.values(roots.modules)
  ];

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }
};

export const applyElectronStoragePaths = (roots: LyraStorageRoots): void => {
  app.setPath("userData", roots.electronDesktopRoot);
  app.setPath("sessionData", path.join(roots.electronDesktopRoot, "session"));
};
