import { app } from "electron";
import { accessSync, constants, mkdirSync } from "node:fs";
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
  /** Scope-specific root containing components/ and system/. */
  readonly componentInstallRoot: string;
  /** Per-user root. User data and Electron state always remain here. */
  readonly lyraRoot: string;
  readonly dataRoot: string;
  readonly componentsRoot: string;
  readonly systemRoot: string;
  readonly electronRoot: string;
  readonly electronDesktopRoot: string;
  readonly modules: LyraModuleStorageRoots;
};

type LyraStorageRootResolutionOptions = {
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly executablePath?: string;
  readonly isPackaged?: boolean;
  /** Test/development-only managed root overrides. Packaged builds ignore them. */
  readonly env?: NodeJS.ProcessEnv;
  /** Test-only: bypass the system root writability check. */
  readonly systemRootWritableOverride?: boolean;
};

const isContainedPath = (
  candidate: string,
  root: string,
  platform: NodeJS.Platform
): boolean => {
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalize = (value: string): string => {
    const resolved = pathApi.resolve(value).replace(/[\\/]+$/u, "");
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const normalizedCandidate = normalize(candidate);
  const normalizedRoot = normalize(root);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${pathApi.sep}`);
};

const systemComponentRoot = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string | null => {
  if (platform === "darwin") {
    return "/Library/Application Support/Lyra";
  }
  if (platform === "linux") {
    return "/var/lib/lyra";
  }
  if (platform === "win32") {
    return path.win32.join(env.ProgramData ?? "C:\\ProgramData", "Lyra");
  }
  return null;
};

const systemProgramRoot = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string | null => {
  if (platform === "darwin") {
    return "/Applications/Lyra.app";
  }
  if (platform === "linux") {
    return "/opt/lyra";
  }
  if (platform === "win32") {
    return path.win32.join(env.ProgramFiles ?? "C:\\Program Files", "Lyra");
  }
  return null;
};

const normalizeDevelopmentOverride = (
  value: string | undefined,
  field: string,
  platform: NodeJS.Platform
): string | undefined => {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const pathApi = platform === "win32" ? path.win32 : path;
  if (!pathApi.isAbsolute(value)) {
    throw new Error(`${field} must be an absolute path.`);
  }
  const resolved = pathApi.resolve(value);
  if (resolved === pathApi.parse(resolved).root) {
    throw new Error(`${field} cannot be a filesystem root.`);
  }
  return resolved;
};

export const resolveLyraStorageRoots = (
  options: LyraStorageRootResolutionOptions = {}
): LyraStorageRoots => {
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const executablePath = options.executablePath ?? process.execPath;
  const isPackaged = options.isPackaged ?? false;
  const pathApi = platform === "win32" ? path.win32 : path;
  const lyraRoot = pathApi.join(homeDirectory, ".lyra");
  const packagedSystemProgram = systemProgramRoot(platform, environment);
  const packagedSystemRoot = systemComponentRoot(platform, environment);
  // ponytail: DMG installs land at /Applications too, but lack a PKG pre-creating
  // the system component root with writable permissions. Check writability before
  // committing to the system-level path; fall back to ~/.lyra when not writable.
  const systemRootWritable = options.systemRootWritableOverride ?? (packagedSystemRoot !== null && (() => {
    try {
      accessSync(packagedSystemRoot, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  })());
  const detectedSystemInstall = isPackaged
    && packagedSystemProgram !== null
    && packagedSystemRoot !== null
    && systemRootWritable
    && isContainedPath(executablePath, packagedSystemProgram, platform);
  const developmentInstallOverride = isPackaged
    ? undefined
    : normalizeDevelopmentOverride(
        environment.LYRA_COMPONENT_INSTALL_ROOT,
        "LYRA_COMPONENT_INSTALL_ROOT",
        platform
      );
  const componentInstallRoot = developmentInstallOverride
    ?? (detectedSystemInstall ? packagedSystemRoot! : lyraRoot);
  const developmentStateOverride = isPackaged
    ? undefined
    : normalizeDevelopmentOverride(
        environment.LYRA_COMPONENT_STATE_ROOT,
        "LYRA_COMPONENT_STATE_ROOT",
        platform
      );
  const dataRoot = path.join(lyraRoot, "data");
  const componentsRoot = pathApi.join(componentInstallRoot, "components");
  const systemRoot = developmentStateOverride
    ?? pathApi.join(componentInstallRoot, "system");
  const electronRoot = path.join(lyraRoot, "electron");
  const electronDesktopRoot = path.join(electronRoot, "desktop");

  return {
    componentInstallRoot,
    lyraRoot,
    dataRoot,
    componentsRoot,
    systemRoot,
    electronRoot,
    electronDesktopRoot,
    modules: {
      agent: path.join(dataRoot, "agent"),
      fileManager: path.join(dataRoot, "file-manager"),
      runtime: path.join(dataRoot, "runtime"),
      linuxCompat: path.join(dataRoot, "linux-compat"),
      terminal: path.join(dataRoot, "terminal"),
      workbenchState: path.join(dataRoot, "workbench-state"),
      uiuxPacks: path.join(dataRoot, "uiux-packs"),
      search: path.join(dataRoot, "search"),
      identity: path.join(dataRoot, "identity"),
      imageViewer: path.join(dataRoot, "image-viewer"),
      downloadManager: path.join(dataRoot, "download-manager"),
      loginManager: path.join(dataRoot, "login-manager")
    }
  };
};

export const ensureLyraStorageRoots = (roots: LyraStorageRoots): void => {
  const directories = [
    roots.componentInstallRoot,
    roots.lyraRoot,
    roots.dataRoot,
    roots.componentsRoot,
    roots.systemRoot,
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
