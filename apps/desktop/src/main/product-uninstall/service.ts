import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProductUninstallProgress } from "../../shared/desktop-bridge";
import type { LyraStorageRoots } from "../storage";
import { listStagedCleanupTargets } from "../component-update";

export type ProductUninstallRequest = {
  readonly removeUserData: boolean;
};

const isPathInsideRoot = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
};

const isAllowedCleanupPath = (candidate: string, allowlist: readonly string[]): boolean =>
  allowlist.some((root) => candidate === root || isPathInsideRoot(root, candidate));

export const listProductFileTargets = (
  roots: LyraStorageRoots,
  removeUserData: boolean
): readonly string[] => {
  const targets = [
    ...listStagedCleanupTargets(roots.componentInstallRoot, roots.systemRoot),
    roots.electronRoot
  ];
  if (removeUserData) {
    targets.push(roots.dataRoot);
  }
  return targets;
};

export const listProductShortcutTargets = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env
): readonly string[] => {
  if (platform === "win32") {
    const profile = env.USERPROFILE ?? os.homedir();
    const appData = env.APPDATA ?? path.join(profile, "AppData", "Roaming");
    return [
      path.join(profile, "Desktop", "Lyra.lnk"),
      path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Lyra.lnk")
    ];
  }
  if (platform === "linux") {
    const home = env.HOME ?? os.homedir();
    const applications = path.join(home, ".local", "share", "applications");
    return [
      path.join(applications, "lyra.desktop"),
      path.join(applications, "Lyra.desktop"),
      path.join(applications, "dev.lyra.desktop.desktop"),
      path.join(applications, "lyra-installer.desktop")
    ];
  }
  return [];
};

export const resolvePackagedAppRoot = ({
  execPath,
  platform,
  env = process.env,
  isPackaged
}: {
  readonly execPath: string;
  readonly platform: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
}): string | null => {
  if (!isPackaged) {
    return null;
  }
  if (typeof env.APPIMAGE === "string" && env.APPIMAGE.length > 0) {
    return env.APPIMAGE;
  }
  if (platform === "darwin") {
    const marker = ".app/Contents/MacOS/";
    const index = execPath.toLowerCase().lastIndexOf(marker.toLowerCase());
    if (index >= 0) {
      return execPath.slice(0, index + 4);
    }
  }
  return path.dirname(execPath);
};

const tryRemoveEmptyDir = async (directory: string): Promise<void> => {
  try {
    const entries = await readdir(directory);
    if (entries.length === 0) {
      await rm(directory, { force: true });
    }
  } catch {
    return;
  }
};

export const removeProductInstallation = async ({
  roots,
  request,
  platform = process.platform,
  env = process.env,
  onProgress
}: {
  readonly roots: LyraStorageRoots;
  readonly request: ProductUninstallRequest;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly onProgress: (progress: ProductUninstallProgress) => void;
}): Promise<void> => {
  const fileTargets = listProductFileTargets(roots, request.removeUserData);
  const shortcutTargets = listProductShortcutTargets(platform, env);
  const allowlist = [
    roots.lyraRoot,
    roots.componentInstallRoot,
    roots.systemRoot,
    roots.electronRoot,
    roots.dataRoot,
    ...shortcutTargets
  ];
  const total = fileTargets.length + shortcutTargets.length + 2;
  let completed = 0;

  for (const target of fileTargets) {
    if (!isAllowedCleanupPath(target, allowlist)) {
      throw new Error(`Refusing to delete a path outside Lyra roots: ${target}`);
    }
    await rm(target, { recursive: true, force: true });
    completed += 1;
    onProgress({
      phase: "files",
      completed,
      total,
      label: path.basename(target)
    });
  }

  for (const target of shortcutTargets) {
    await rm(target, { recursive: true, force: true });
    completed += 1;
    onProgress({
      phase: "shortcuts",
      completed,
      total,
      label: path.basename(target)
    });
  }

  if (request.removeUserData) {
    await tryRemoveEmptyDir(roots.lyraRoot);
  } else {
    await tryRemoveEmptyDir(roots.systemRoot);
    await tryRemoveEmptyDir(roots.electronRoot);
  }

  completed += 1;
  onProgress({
    phase: "registry",
    completed,
    total,
    label: "host"
  });
  completed += 1;
  onProgress({
    phase: "complete",
    completed: total,
    total,
    label: "done"
  });
};
