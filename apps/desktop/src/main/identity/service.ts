import { ipcMain } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  LYRA_CHANNELS,
  type IdentityIconSnapshot,
  type ProjectIdentityResolveRequest,
  type ProjectIdentitySnapshot
} from "../../shared/desktop-bridge";

const execFileAsync = promisify(execFile);

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_SVG_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 700;
const MAX_SCAN_DEPTH = 4;
const ICON_CACHE_DIR = "identity-icons";

const PROJECT_MARKERS = new Set([
  ".git",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "pnpm-workspace.yaml",
  "deno.json",
  "deno.jsonc",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "tauri.conf.json",
  "src-tauri"
]);

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
  ".cache",
  ".turbo",
  ".vite",
  "coverage",
  ".parcel-cache"
]);

const ICON_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".ico"
]);

const SEARCH_DIRS = [
  "public",
  "static",
  "assets",
  "resources",
  path.join("src", "assets"),
  path.join("app", "assets")
];

const toFilePreviewUrl = (filePath: string, mimeType: string): string =>
  `lyra-file://preview?path=${encodeURIComponent(filePath)}&contentType=${encodeURIComponent(mimeType)}`;

const mimeTypeForPath = (filePath: string): string | null => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  return null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const fileIconSnapshot = async (
  filePath: string,
  source: IdentityIconSnapshot["source"],
  label?: string
): Promise<IdentityIconSnapshot | null> => {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType === null) return null;
  try {
    const details = await stat(filePath);
    if (!details.isFile()) return null;
    const maxBytes = mimeType === "image/svg+xml" ? MAX_SVG_BYTES : MAX_ICON_BYTES;
    if (details.size <= 0 || details.size > maxBytes) return null;
    return {
      url: toFilePreviewUrl(filePath, mimeType),
      source,
      ...(label === undefined ? {} : { label }),
      path: filePath,
      updatedAt: new Date(details.mtimeMs).toISOString()
    };
  } catch {
    return null;
  }
};

const safeUserName = (): string => {
  try {
    return userInfo().username || process.env.USER || process.env.USERNAME || "";
  } catch {
    return process.env.USER || process.env.USERNAME || "";
  }
};

const readMacAccountPicture = async (): Promise<string | null> => {
  const username = safeUserName();
  if (username.trim().length === 0) return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/dscl", [
      ".",
      "-read",
      `/Users/${username}`,
      "Picture"
    ]);
    const match = stdout.match(/Picture:\s*(.+)\s*$/m);
    const filePath = match?.[1]?.trim();
    return filePath !== undefined && filePath.length > 0 ? filePath : null;
  } catch {
    return null;
  }
};

const readMacJpegPhoto = async (storageRoot: string): Promise<string | null> => {
  const username = safeUserName();
  if (username.trim().length === 0) return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/dscl", [
      ".",
      "-read",
      `/Users/${username}`,
      "JPEGPhoto"
    ], { maxBuffer: 1024 * 1024 });
    const hex = stdout
      .replace(/^JPEGPhoto:\s*/m, "")
      .replace(/[^0-9a-fA-F]/g, "");
    if (hex.length < 32 || hex.length % 2 !== 0) return null;
    const bytes = Buffer.from(hex, "hex");
    if (bytes.length <= 0 || bytes.length > MAX_ICON_BYTES) return null;
    const dir = path.join(storageRoot, ICON_CACHE_DIR);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "macos-user-photo.jpg");
    await writeFile(filePath, bytes);
    return filePath;
  } catch {
    return null;
  }
};

const windowsUserPictureCandidates = (): string[] => {
  const candidates: string[] = [];
  const appData = process.env.APPDATA;
  const programData = process.env.ProgramData;
  if (appData !== undefined) {
    candidates.push(path.join(appData, "Microsoft", "Windows", "AccountPictures"));
  }
  if (programData !== undefined) {
    candidates.push(path.join(programData, "Microsoft", "User Account Pictures"));
  }
  return candidates;
};

const newestImageInDirectory = async (directory: string): Promise<string | null> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const mimeType = mimeTypeForPath(filePath);
        if (mimeType === null) return null;
        try {
          const details = await stat(filePath);
          return { filePath, mtimeMs: details.mtimeMs };
        } catch {
          return null;
        }
      }));
    return files
      .filter((entry): entry is { readonly filePath: string; readonly mtimeMs: number } => entry !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null;
  } catch {
    return null;
  }
};

const readWindowsUserIcon = async (): Promise<string | null> => {
  for (const directory of windowsUserPictureCandidates()) {
    const candidate = await newestImageInDirectory(directory);
    if (candidate !== null) return candidate;
  }
  return null;
};

const readLinuxUserIcon = async (): Promise<string | null> => {
  const home = homedir();
  const username = safeUserName();
  const candidates = [
    path.join(home, ".face"),
    path.join(home, ".face.icon"),
    username.trim().length === 0 ? "" : path.join("/var/lib/AccountsService/icons", username)
  ].filter((entry) => entry.length > 0);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
};

const readUserIconPath = async (storageRoot: string): Promise<string | null> => {
  if (process.platform === "darwin") {
    return await readMacAccountPicture() ?? await readMacJpegPhoto(storageRoot);
  }
  if (process.platform === "win32") {
    return readWindowsUserIcon();
  }
  if (process.platform === "linux") {
    return readLinuxUserIcon();
  }
  return null;
};

const hasProjectMarker = async (directory: string): Promise<boolean> => {
  for (const marker of PROJECT_MARKERS) {
    if (await pathExists(path.join(directory, marker))) {
      return true;
    }
  }
  return false;
};

const directoryForInputPath = async (inputPath: string): Promise<string | null> => {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) return null;
  const absolute = path.resolve(trimmed);
  try {
    const details = await stat(absolute);
    return details.isDirectory() ? absolute : path.dirname(absolute);
  } catch {
    return absolute;
  }
};

const findProjectRoot = async (inputPath: string): Promise<string | null> => {
  let current = await directoryForInputPath(inputPath);
  if (current === null) return null;
  const stopAt = path.parse(current).root;
  for (let depth = 0; depth < 16; depth += 1) {
    if (await hasProjectMarker(current)) return current;
    if (current === stopAt) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
};

const projectNameFromRoot = (rootPath: string): string => {
  const base = path.basename(rootPath);
  return base.trim().length > 0 ? base : rootPath;
};

const resolveManifestIconPath = async (rootPath: string): Promise<string | null> => {
  const packagePath = path.join(rootPath, "package.json");
  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8")) as {
      readonly icon?: unknown;
      readonly icons?: unknown;
    };
    const icon = normalizeString(parsed.icon);
    if (icon !== null) {
      const candidate = path.resolve(rootPath, icon);
      if (await pathExists(candidate)) return candidate;
    }
  } catch {
    // Ignore malformed or absent manifests.
  }

  for (const manifestFile of ["manifest.json", "site.webmanifest"]) {
    try {
      const parsed = JSON.parse(await readFile(path.join(rootPath, "public", manifestFile), "utf8")) as {
        readonly icons?: readonly { readonly src?: unknown; readonly sizes?: unknown }[];
      };
      const icon = Array.isArray(parsed.icons)
        ? [...parsed.icons]
          .map((entry) => ({
            src: normalizeString(entry.src),
            score: normalizeString(entry.sizes)?.includes("512") === true ? 2 : 1
          }))
          .filter((entry): entry is { readonly src: string; readonly score: number } => entry.src !== null)
          .sort((a, b) => b.score - a.score)[0]
        : undefined;
      if (icon !== undefined) {
        const candidate = path.resolve(rootPath, "public", icon.src);
        if (await pathExists(candidate)) return candidate;
      }
    } catch {
      // Ignore malformed or absent web manifests.
    }
  }
  return null;
};

const scoreLogoName = (filePath: string): number => {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (base === "lyra-mark" || base === "lyra-logo") return 120;
  if (base.includes("lyra") && (base.includes("mark") || base.includes("logo"))) return 110;
  if (base === "logo") return 100;
  if (base === "icon") return 90;
  if (base === "favicon") return 80;
  if (base.includes("logo")) return 70;
  if (base.includes("icon")) return 60;
  if (base.includes("favicon")) return 50;
  return 0;
};

const scanForLogo = async (rootPath: string): Promise<string | null> => {
  const queue = [
    rootPath,
    ...SEARCH_DIRS.map((entry) => path.join(rootPath, entry))
  ].map((directory) => ({ directory, depth: 0 }));
  const visited = new Set<string>();
  const candidates: Array<{ readonly filePath: string; readonly score: number }> = [];
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_SCAN_FILES) {
    const item = queue.shift()!;
    if (visited.has(item.directory) || item.depth > MAX_SCAN_DEPTH) continue;
    visited.add(item.directory);
    let entries;
    try {
      entries = await readdir(item.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      inspected += 1;
      if (inspected > MAX_SCAN_FILES) break;
      const entryPath = path.join(item.directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          queue.push({ directory: entryPath, depth: item.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!ICON_EXTENSIONS.has(ext)) continue;
      const score = scoreLogoName(entryPath);
      if (score > 0) {
        candidates.push({ filePath: entryPath, score: score - item.depth });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.filePath ?? null;
};

export type IdentityIpcBridge = {
  readonly dispose: () => void;
  readonly readUserIcon: () => Promise<IdentityIconSnapshot | null>;
  readonly resolveProjectIdentity: (
    request: ProjectIdentityResolveRequest
  ) => Promise<ProjectIdentitySnapshot | null>;
};

export const createIdentityIpcBridge = (storageRoot: string): IdentityIpcBridge => {
  let userIconPromise: Promise<IdentityIconSnapshot | null> | null = null;
  const projectCache = new Map<string, Promise<ProjectIdentitySnapshot | null>>();

  const readUserIcon = async (): Promise<IdentityIconSnapshot | null> => {
    userIconPromise ??= (async () => {
      const iconPath = await readUserIconPath(storageRoot);
      return iconPath === null ? null : fileIconSnapshot(iconPath, "user");
    })();
    return userIconPromise;
  };

  const resolveProjectIdentity = async (
    request: ProjectIdentityResolveRequest
  ): Promise<ProjectIdentitySnapshot | null> => {
    const rawRequest = request as { readonly path?: unknown } | null | undefined;
    const inputPath = normalizeString(rawRequest?.path);
    if (inputPath === null) return null;
    const rootPath = await findProjectRoot(inputPath);
    if (rootPath === null) return null;
    const key = createHash("sha256").update(rootPath).digest("hex");
    let cached = projectCache.get(key);
    if (cached === undefined) {
      cached = (async () => {
        const name = projectNameFromRoot(rootPath);
        const explicitIcon = await resolveManifestIconPath(rootPath);
        const logoPath = explicitIcon ?? await scanForLogo(rootPath);
        const logo = logoPath === null ? null : await fileIconSnapshot(logoPath, "project", name);
        return {
          rootPath,
          name,
          logo
        };
      })();
      projectCache.set(key, cached);
    }
    return cached;
  };

  ipcMain.handle(LYRA_CHANNELS.identityReadUserIcon, () => readUserIcon());
  ipcMain.handle(LYRA_CHANNELS.identityResolveProject, (_event, payload: unknown) =>
    resolveProjectIdentity(payload as ProjectIdentityResolveRequest)
  );

  return {
    readUserIcon,
    resolveProjectIdentity,
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.identityReadUserIcon);
      ipcMain.removeHandler(LYRA_CHANNELS.identityResolveProject);
      projectCache.clear();
      userIconPromise = null;
    }
  };
};
