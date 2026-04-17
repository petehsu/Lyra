import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type { BrowserUseBundle, BrowserUseBundleManifest } from "./bundle";
import type { BrowserUseRuntimeInstallState, BrowserUseRuntimePreflightFailureCode } from "../types";

const MARKER_FILE = "install-state.json";

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly env?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly timeoutMs?: number;
  },
): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options?.env,
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      if (code === 0 && !timedOut) {
        resolve();
        return;
      }
      reject(
        new Error(
          timedOut
            ? `${command} ${args.join(" ")} timed out`
            : `${command} ${args.join(" ")} failed (${code ?? "signal"})\n${stderr || stdout}`,
        ),
      );
    });
  });
};

const resolvePythonBinary = (materializedRoot: string, pythonBinary: string): string =>
  path.join(materializedRoot, pythonBinary);

const hasExecutable = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const sha256File = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

export const resolveBrowserUseRuntimePaths = (storageRoot: string, bundleVersion?: string) => {
  const runtimeRoot = path.join(storageRoot, "runtime");
  const homeDir = path.join(storageRoot, "home");
  const bundleRoot = bundleVersion === undefined
    ? runtimeRoot
    : path.join(runtimeRoot, bundleVersion);
  const markerPath = path.join(runtimeRoot, MARKER_FILE);
  return {
    runtimeRoot,
    homeDir,
    bundleRoot,
    markerPath,
  };
};

export const readBrowserUseInstallMarker = async (
  storageRoot: string,
): Promise<BrowserUseRuntimeInstallState | null> => {
  const { markerPath } = resolveBrowserUseRuntimePaths(storageRoot);
  try {
    const raw = await readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BrowserUseRuntimeInstallState>;
    if (
      typeof parsed.pythonPath !== "string"
      || typeof parsed.homeDir !== "string"
      || typeof parsed.bundleVersion !== "string"
      || typeof parsed.bundleRoot !== "string"
      || typeof parsed.browserUsePin !== "string"
      || typeof parsed.manifestPath !== "string"
    ) {
      return null;
    }
    if (!(await hasExecutable(parsed.pythonPath))) {
      return null;
    }
    return parsed as BrowserUseRuntimeInstallState;
  } catch {
    return null;
  }
};

export const writeBrowserUseInstallMarker = async (
  storageRoot: string,
  state: BrowserUseRuntimeInstallState,
): Promise<void> => {
  const { runtimeRoot, markerPath } = resolveBrowserUseRuntimePaths(storageRoot);
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(markerPath, JSON.stringify(state, null, 2), "utf8");
};

export const validateBundledBrowserUseManifest = async (
  bundle: BrowserUseBundle,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: BrowserUseRuntimePreflightFailureCode; readonly detail: string }> => {
  const manifest = bundle.manifest;
  for (const file of manifest.files) {
    const filePath = path.join(bundle.rootPath, file.path);
    try {
      await access(filePath, constants.F_OK);
    } catch {
      return {
        ok: false,
        code: "integrity_failed",
        detail: `Missing browser-use bundle file: ${file.path}`,
      };
    }
    if (typeof file.sha256 === "string") {
      try {
        const digest = await sha256File(filePath);
        if (digest !== file.sha256.toLowerCase()) {
          return {
            ok: false,
            code: "integrity_failed",
            detail: `Hash mismatch for browser-use bundle file: ${file.path}`,
          };
        }
      } catch (error) {
        return {
          ok: false,
          code: "integrity_failed",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (file.executable === true && !(await hasExecutable(filePath))) {
      return {
        ok: false,
        code: "integrity_failed",
        detail: `Executable bit missing for browser-use bundle file: ${file.path}`,
      };
    }
  }
  return { ok: true };
};

export const materializeBundledBrowserUseRuntime = async (
  storageRoot: string,
  bundle: BrowserUseBundle,
): Promise<BrowserUseRuntimeInstallState> => {
  const existing = await readBrowserUseInstallMarker(storageRoot);
  if (existing !== null && existing.bundleVersion === bundle.manifest.bundleVersion && await hasExecutable(existing.pythonPath)) {
    return existing;
  }

  const { runtimeRoot, homeDir, bundleRoot } = resolveBrowserUseRuntimePaths(
    storageRoot,
    bundle.manifest.bundleVersion,
  );
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await rm(bundleRoot, { recursive: true, force: true });
  await cp(bundle.rootPath, bundleRoot, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  const pythonArchivePath = path.join(bundleRoot, bundle.manifest.pythonArchive);
  await runProcess(
    "tar",
    ["-xzf", pythonArchivePath, "-C", bundleRoot],
    { timeoutMs: 60_000 },
  );
  const pythonPath = resolvePythonBinary(bundleRoot, bundle.manifest.pythonBinary);
  await runProcess(
    pythonPath,
    ["-m", "ensurepip", "--upgrade"],
    {
      env: {
        ...process.env,
        BROWSER_USE_HOME: homeDir,
      },
      timeoutMs: 60_000,
    },
  ).catch(() => undefined);
  await runProcess(
    pythonPath,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-index",
      "--find-links",
      path.join(bundleRoot, bundle.manifest.wheelhouseDir),
      "--force-reinstall",
      path.join(bundleRoot, bundle.manifest.browserUseWheel),
    ],
    {
      env: {
        ...process.env,
        BROWSER_USE_HOME: homeDir,
      },
      timeoutMs: 180_000,
    },
  );
  const state: BrowserUseRuntimeInstallState = {
    pythonPath,
    homeDir,
    bundleVersion: bundle.manifest.bundleVersion,
    bundleRoot,
    browserUsePin: bundle.manifest.browserUsePin,
    manifestPath: path.join(bundleRoot, "manifest.json"),
  };
  await writeBrowserUseInstallMarker(storageRoot, state);
  return state;
};

export const readMaterializedBrowserUseManifest = async (
  installState: BrowserUseRuntimeInstallState,
): Promise<BrowserUseBundleManifest | null> => {
  try {
    const raw = await readFile(installState.manifestPath, "utf8");
    return JSON.parse(raw) as BrowserUseBundleManifest;
  } catch {
    return null;
  }
};
