import { app } from "electron";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LyraModuleStorageRoots = {
  readonly fileManager: string;
  readonly ai: string;
  readonly mcp: string;
  readonly skills: string;
  readonly computer: string;
  readonly systemImages: string;
  readonly linuxCompat: string;
  readonly terminal: string;
  readonly workbenchState: string;
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
      fileManager: path.join(modulesRoot, "file-manager"),
      ai: path.join(modulesRoot, "ai"),
      mcp: path.join(modulesRoot, "mcp"),
      skills: path.join(modulesRoot, "skills"),
      computer: path.join(modulesRoot, "computer"),
      systemImages: path.join(modulesRoot, "system-images"),
      linuxCompat: path.join(modulesRoot, "linux-compat"),
      terminal: path.join(modulesRoot, "terminal"),
      workbenchState: path.join(modulesRoot, "workbench-state")
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
