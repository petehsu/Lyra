/**
 * Download and stage MinGit (Git for Windows minimal edition) for bundling
 * with the Lyra desktop app on Windows.
 *
 * MinGit is a self-contained, ~50MB subset of Git for Windows that includes
 * bash.exe, git.exe, and core utilities — no GUI, no documentation. It
 * provides the Git Bash shell that Lyra's agent runtime uses for POSIX-
 * consistent command execution on Windows.
 *
 * Mirrors the aria2 bundling pattern (tools/download-manager/build-aria2-bundles.ts):
 * download the official GitHub release ZIP, extract into
 * apps/desktop/resources/git/<target>/, and write a manifest.json with
 * SHA-256 hashes per file.
 *
 * Usage:
 *   tsx tools/download-manager/build-git-bundles.ts              # current target
 *   tsx tools/download-manager/build-git-bundles.ts --all-targets # all Windows targets
 *   tsx tools/download-manager/build-git-bundles.ts --target=win32-x64
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  cp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type TargetConfig = {
  readonly id: string;
  /** GitHub release asset filename (always the 64-bit MinGit zip). */
  readonly asset: string;
};

type BundleFile = {
  readonly path: string;
  readonly sha256: string;
  readonly executable?: boolean;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/git");

// Pinned MinGit release. Update this when a new Git for Windows version is
// desired — the SHA-256 in the manifest will change, which the runtime
// verifier catches.
const GIT_VERSION = "2.49.0";
const GIT_RELEASE_TAG = `v${GIT_VERSION}.windows.1`;
const MINGIT_ASSET = `MinGit-${GIT_VERSION}-64-bit.zip`;
const GIT_RELEASE_URL = `https://github.com/git-for-windows/git/releases/download/${GIT_RELEASE_TAG}/${MINGIT_ASSET}`;

// Both Windows targets use the same 64-bit MinGit package. ARM64 runs it
// via x64 emulation (same approach as aria2's win32-arm64 target).
const TARGETS: Record<string, TargetConfig> = {
  "win32-x64": {
    id: "win32-x64",
    asset: MINGIT_ASSET
  },
  "win32-arm64": {
    id: "win32-arm64",
    asset: MINGIT_ASSET
  }
};

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
  }
): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : null;
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      if (code === 0 && timedOut === false) {
        resolve();
        return;
      }
      reject(
        new Error(
          timedOut
            ? `${command} ${args.join(" ")} timed out`
            : `${command} ${args.join(" ")} failed (${code ?? "signal"})\n${stderr}`
        )
      );
    });
  });
};

const resolveCurrentTarget = (): TargetConfig => {
  const targetId = `${process.platform}-${process.arch}`;
  const target = TARGETS[targetId];
  if (target === undefined) {
    throw new Error(
      `Git bundles are only needed on Windows. Current target ${targetId} is not supported. Use --target=win32-x64 or --all-targets.`
    );
  }
  return target;
};

const parseTargets = (): readonly TargetConfig[] => {
  const args = process.argv.slice(2);
  if (args.includes("--all-targets")) {
    return Object.values(TARGETS);
  }
  const targetArg = args.find((arg) => arg.startsWith("--target="));
  if (targetArg === undefined) {
    return [resolveCurrentTarget()];
  }
  const ids = targetArg
    .slice("--target=".length)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (ids.length === 0) {
    throw new Error("--target cannot be empty");
  }
  return ids.map((id) => {
    const target = TARGETS[id];
    if (target === undefined) {
      throw new Error(`unknown git target ${id}`);
    }
    return target;
  });
};

const fetchFile = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url);
  if (response.ok === false) {
    throw new Error(`failed to download ${url}: ${response.status}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const collectFiles = async (root: string, relativeRoot = ""): Promise<readonly string[]> => {
  const current = path.join(root, relativeRoot);
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

const normalizeRelativePath = (relativePath: string): string =>
  relativePath.replace(/\\/gu, "/");

const buildManifestFiles = async (targetRoot: string): Promise<readonly BundleFile[]> => {
  const relativeFiles = await collectFiles(targetRoot);
  const manifestFiles: BundleFile[] = [];
  for (const relativePath of relativeFiles) {
    if (normalizeRelativePath(relativePath) === "manifest.json") {
      continue;
    }
    const absolutePath = path.join(targetRoot, relativePath);
    const absoluteStat = await stat(absolutePath);
    manifestFiles.push({
      path: normalizeRelativePath(relativePath),
      sha256: await sha256File(absolutePath),
      ...(absoluteStat.mode & 0o111 ? { executable: true } : {})
    });
  }
  return manifestFiles;
};

const buildTargetBundle = async (target: TargetConfig): Promise<void> => {
  const targetRoot = path.join(BUNDLES_ROOT, target.id);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lyra-git-build-"));
  try {
    await rm(targetRoot, { recursive: true, force: true });
    await mkdir(targetRoot, { recursive: true });

    const downloadPath = path.join(tempRoot, target.asset);
    process.stdout.write(`Downloading MinGit from GitHub: ${target.asset}\n`);
    await fetchFile(GIT_RELEASE_URL, downloadPath);

    const extractedRoot = path.join(tempRoot, "extracted");
    await mkdir(extractedRoot, { recursive: true });
    // Use PowerShell to extract ZIP (available on all Windows; avoids
    // depending on an external unzip binary).
    await runProcess("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -Path '${downloadPath}' -DestinationPath '${extractedRoot}' -Force`
    ], { timeoutMs: 120_000 });

    // MinGit extracts to a flat structure: bin/bash.exe, cmd/git.exe,
    // mingw64/, usr/bin/, etc. Copy the entire tree.
    await cp(extractedRoot, targetRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });

    // Verify bash.exe exists
    const bashPath = path.join(targetRoot, "bin", "bash.exe");
    await access(bashPath, constants.F_OK);

    // Write manifest
    const manifestFiles = await buildManifestFiles(targetRoot);
    await writeFile(
      path.join(targetRoot, "manifest.json"),
      `${JSON.stringify({
        bundleVersion: `mingit-${GIT_VERSION}-${target.id}`,
        target: target.id,
        binary: "bin/bash.exe",
        gitBinary: "cmd/git.exe",
        source: target.id === "win32-arm64"
          ? `github.com/git-for-windows/git MinGit ${GIT_VERSION} 64-bit via Windows ARM64 x64 emulation`
          : `github.com/git-for-windows/git MinGit ${GIT_VERSION} 64-bit`,
        packages: [target.asset],
        files: manifestFiles
      }, null, 2)}\n`,
      "utf8"
    );

    process.stdout.write(`Git bundle created for ${target.id} (${manifestFiles.length} files)\n`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const targets = parseTargets();
  for (const target of targets) {
    await buildTargetBundle(target);
  }
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[git build] ${message}\n`);
  process.exitCode = 1;
});