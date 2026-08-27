/**
 * Bundled Git Bash (MinGit) resolver for the Lyra desktop app.
 *
 * Mirrors the aria2 runtime resolver pattern (aria2-runtime.ts): looks for
 * the bundled MinGit's bash.exe under several candidate roots (packaged
 * resourcesPath, dev cwd), falls back to PATH, and sets the
 * `LYRA_GIT_BASH_PATH` environment variable so the agent runtime's shell
 * detection (shell_kind.rs) and the elevated helper (elevated_helper.rs)
 * can find it without re-probing.
 *
 * Called from the Electron main process at startup.
 */

import { access, constants } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

type GitBashTarget = {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly bashPath: string;
};

const GIT_BASH_TARGETS: readonly GitBashTarget[] = [
  { id: "win32-x64", platform: "win32", arch: "x64", bashPath: "bin/bash.exe" },
  { id: "win32-arm64", platform: "win32", arch: "arm64", bashPath: "bin/bash.exe" }
];

const resolveCurrentTarget = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): GitBashTarget | null =>
  GIT_BASH_TARGETS.find((t) => t.platform === platform && t.arch === arch) ?? null;

/**
 * Build candidate root directories where the bundled Git tree might live.
 * Covers packaged (resourcesPath), dev (cwd), and app-relative layouts.
 */
const resolveGitBundleRoots = ({
  appPath,
  resourcesPath,
  cwd
}: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): readonly string[] => {
  const roots = [
    resourcesPath === undefined ? "" : path.join(resourcesPath, "git"),
    resourcesPath === undefined ? "" : path.join(resourcesPath, "resources", "git"),
    appPath === undefined ? "" : path.join(appPath, "resources", "git"),
    cwd === undefined ? "" : path.join(cwd, "apps/desktop/resources/git")
  ].filter((value) => value.length > 0);
  return Array.from(new Set(roots));
};

/**
 * Resolve candidate bash.exe paths from the bundled Git tree.
 */
const resolveBundledBashCandidates = (
  roots: readonly string[],
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): readonly string[] => {
  const target = resolveCurrentTarget(platform, arch);
  if (target === null) return [];
  return Array.from(new Set(
    roots.flatMap((root) => [
      path.join(root, target.id, target.bashPath),
      path.join(root, target.bashPath)
    ])
  ));
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Locate bash.exe on the system PATH using `where.exe` (Windows only).
 * Filters out WSL bash (system32/windowsapps paths).
 */
const resolvePathBash = async (): Promise<string | null> => {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await execFileAsync("where.exe", ["bash"], { timeout: 10_000 });
    for (const line of stdout.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const lower = trimmed.toLowerCase();
      // Skip WSL bash launcher
      if (lower.includes("system32") || lower.includes("windowsapps")) continue;
      return trimmed;
    }
  } catch {
    // where.exe not available or bash not on PATH
  }
  return null;
};

export type GitBashResolution = {
  readonly bashPath: string;
  readonly source: "bundled" | "path";
};

/**
 * Resolve the best available bash.exe: prefer the bundled MinGit, fall back
 * to a system PATH lookup. Returns `null` if no bash.exe is found (the
 * agent runtime will fall back to PowerShell or cmd.exe).
 *
 * Side effect: sets `process.env.LYRA_GIT_BASH_PATH` so the agent runtime
 * (shell_kind.rs) and the elevated helper (elevated_helper.rs) can find it
 * without re-probing.
 */
export const resolveGitBashPath = async ({
  appPath,
  resourcesPath,
  cwd
}: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): Promise<GitBashResolution | null> => {
  // 1. Check bundled MinGit
  const roots = resolveGitBundleRoots({ appPath, resourcesPath, cwd });
  const bundledCandidates = resolveBundledBashCandidates(roots, process.platform, process.arch);
  for (const candidate of bundledCandidates) {
    if (await fileExists(candidate)) {
      process.env.LYRA_GIT_BASH_PATH = candidate;
      return { bashPath: candidate, source: "bundled" };
    }
  }

  // 2. Fall back to PATH
  const pathBash = await resolvePathBash();
  if (pathBash !== null && await fileExists(pathBash)) {
    process.env.LYRA_GIT_BASH_PATH = pathBash;
    return { bashPath: pathBash, source: "path" };
  }

  // 3. No bash found — the agent runtime will use PowerShell or cmd
  return null;
};