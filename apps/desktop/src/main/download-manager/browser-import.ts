import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { resolveCurrentDesktopTarget } from "../platform-target";

export type ExternalBrowserDownloadCandidate = {
  readonly browser: string;
  readonly profile?: string | undefined;
  readonly url: string;
  readonly finalPath?: string | undefined;
  readonly partialFilePath?: string | undefined;
  readonly referrer?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly receivedBytes?: number | undefined;
  readonly totalBytes?: number | undefined;
  readonly state?: string | undefined;
  readonly startedAt?: string | undefined;
};

type BrowserUseBundleManifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly pythonBinary: string;
  readonly pythonArchive: string;
};

type BrowserUseBundle = {
  readonly rootPath: string;
  readonly manifest: BrowserUseBundleManifest;
};

type BrowserImportRuntimeMarker = {
  readonly bundleVersion: string;
  readonly bundleRoot: string;
  readonly pythonPath: string;
};

type BrowserProbeResult = {
  readonly ok?: boolean;
  readonly candidates?: readonly unknown[];
};

const DEFAULT_LIMIT = 24;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_STDIO_BYTES = 2_000_000;
const RUNTIME_MARKER_FILE = "install-state.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isAccessible = async (candidatePath: string, executable: boolean): Promise<boolean> => {
  try {
    await access(
      candidatePath,
      executable && process.platform !== "win32" ? constants.X_OK : constants.F_OK
    );
    return true;
  } catch {
    return false;
  }
};

const normalizeLimit = (value: number | undefined): number =>
  Math.max(1, Math.min(100, Math.round(value ?? DEFAULT_LIMIT)));

export const parseExternalBrowserProbeResult = (
  raw: string
): readonly ExternalBrowserDownloadCandidate[] => {
  const parsed = JSON.parse(raw) as BrowserProbeResult;
  if (parsed.ok !== true || Array.isArray(parsed.candidates) === false) {
    return [];
  }
  return parsed.candidates.flatMap((candidate) => {
    if (isRecord(candidate) === false) {
      return [];
    }
    const url = readString(candidate.url);
    const browser = readString(candidate.browser) ?? "Browser";
    if (url === undefined) {
      return [];
    }
    const profile = readString(candidate.profile);
    const finalPath = readString(candidate.finalPath);
    const partialFilePath = readString(candidate.partialFilePath);
    const referrer = readString(candidate.referrer);
    const mimeType = readString(candidate.mimeType);
    const receivedBytes = readNumber(candidate.receivedBytes);
    const totalBytes = readNumber(candidate.totalBytes);
    const state = readString(candidate.state);
    const startedAt = readString(candidate.startedAt);
    return [{
      browser,
      url,
      ...(profile === undefined ? {} : { profile }),
      ...(finalPath === undefined ? {} : { finalPath }),
      ...(partialFilePath === undefined ? {} : { partialFilePath }),
      ...(referrer === undefined ? {} : { referrer }),
      ...(mimeType === undefined ? {} : { mimeType }),
      ...(receivedBytes === undefined ? {} : { receivedBytes }),
      ...(totalBytes === undefined ? {} : { totalBytes }),
      ...(state === undefined ? {} : { state }),
      ...(startedAt === undefined ? {} : { startedAt })
    }];
  });
};

const downloadManagerPythonEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  DO_NOT_TRACK: "1",
  DISABLE_TELEMETRY: "1",
  ANONYMIZED_TELEMETRY: "false",
  PYTHONNOUSERSITE: "1",
  PYTHONDONTWRITEBYTECODE: "1"
});

const runProcess = async (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly timeoutMs?: number | undefined;
  } = {}
): Promise<string> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error: Error | null, output = ""): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(output);
    };
    const timeoutHandle = typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? setTimeout(() => {
          child.kill();
          finish(new Error(`${command} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_STDIO_BYTES) {
        child.kill();
        finish(new Error(`${command} stdout exceeded ${MAX_STDIO_BYTES} bytes`));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_STDIO_BYTES) {
        child.kill();
        finish(new Error(`${command} stderr exceeded ${MAX_STDIO_BYTES} bytes`));
      }
    });
    child.once("error", (error) => {
      finish(error);
    });
    child.once("exit", (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        finish(new Error(stderr.trim() || `${command} exited with ${code ?? "signal"}`));
        return;
      }
      finish(null, stdout);
    });
  });
};

const resolveBrowserUseResourceRoots = ({
  appPath,
  resourcesPath,
  cwd
}: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): readonly string[] => Array.from(new Set([
  resourcesPath === undefined ? "" : path.join(resourcesPath, "browser-use"),
  resourcesPath === undefined ? "" : path.join(resourcesPath, "resources", "browser-use"),
  appPath === undefined ? "" : path.join(appPath, "resources", "browser-use"),
  cwd === undefined ? "" : path.join(cwd, "apps/desktop/resources/browser-use")
].filter((value) => value.length > 0)));

const readBrowserUseManifest = async (
  manifestPath: string
): Promise<BrowserUseBundleManifest | null> => {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BrowserUseBundleManifest>;
    if (
      typeof parsed.bundleVersion !== "string"
      || typeof parsed.target !== "string"
      || typeof parsed.pythonBinary !== "string"
      || typeof parsed.pythonArchive !== "string"
    ) {
      return null;
    }
    return {
      bundleVersion: parsed.bundleVersion,
      target: parsed.target,
      pythonBinary: parsed.pythonBinary,
      pythonArchive: parsed.pythonArchive
    };
  } catch {
    return null;
  }
};

const resolveBrowserUseBundle = async (options: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): Promise<BrowserUseBundle | null> => {
  const target = resolveCurrentDesktopTarget();
  for (const root of resolveBrowserUseResourceRoots(options)) {
    const targetRoot = path.join(root, target.id);
    const manifest = await readBrowserUseManifest(path.join(targetRoot, "manifest.json"));
    if (manifest !== null && manifest.target === target.id) {
      return {
        rootPath: targetRoot,
        manifest
      };
    }
  }
  return null;
};

const resolveRuntimePaths = (storageRoot: string, bundleVersion: string) => {
  const runtimeRoot = path.join(storageRoot, "browser-import-runtime");
  const bundleRoot = path.join(runtimeRoot, bundleVersion);
  const markerPath = path.join(runtimeRoot, RUNTIME_MARKER_FILE);
  return {
    runtimeRoot,
    bundleRoot,
    markerPath
  };
};

const readRuntimeMarker = async (storageRoot: string): Promise<BrowserImportRuntimeMarker | null> => {
  try {
    const markerPath = path.join(storageRoot, "browser-import-runtime", RUNTIME_MARKER_FILE);
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as Partial<BrowserImportRuntimeMarker>;
    if (
      typeof parsed.bundleVersion !== "string"
      || typeof parsed.bundleRoot !== "string"
      || typeof parsed.pythonPath !== "string"
      || await isAccessible(parsed.pythonPath, true) === false
    ) {
      return null;
    }
    return parsed as BrowserImportRuntimeMarker;
  } catch {
    return null;
  }
};

const writeRuntimeMarker = async (
  storageRoot: string,
  marker: BrowserImportRuntimeMarker
): Promise<void> => {
  const { runtimeRoot, markerPath } = resolveRuntimePaths(storageRoot, marker.bundleVersion);
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(markerPath, JSON.stringify(marker, null, 2), "utf8");
};

const materializeBundledPython = async (
  storageRoot: string,
  bundle: BrowserUseBundle
): Promise<string | null> => {
  const existing = await readRuntimeMarker(storageRoot);
  if (
    existing !== null
    && existing.bundleVersion === bundle.manifest.bundleVersion
    && await isAccessible(existing.pythonPath, true)
  ) {
    return existing.pythonPath;
  }
  const { runtimeRoot, bundleRoot } = resolveRuntimePaths(storageRoot, bundle.manifest.bundleVersion);
  const archivePath = path.join(bundle.rootPath, bundle.manifest.pythonArchive);
  try {
    await access(archivePath, constants.F_OK);
    await mkdir(runtimeRoot, { recursive: true });
    await rm(bundleRoot, { recursive: true, force: true });
    await mkdir(bundleRoot, { recursive: true });
    await runProcess("tar", ["-xzf", archivePath, "-C", bundleRoot], {
      timeoutMs: 120_000
    });
    const pythonPath = path.join(bundleRoot, bundle.manifest.pythonBinary);
    if (await isAccessible(pythonPath, true) === false) {
      return null;
    }
    await writeRuntimeMarker(storageRoot, {
      bundleVersion: bundle.manifest.bundleVersion,
      bundleRoot,
      pythonPath
    });
    return pythonPath;
  } catch {
    return null;
  }
};

export const resolveDownloadManagerProbeScriptCandidates = ({
  appPath,
  resourcesPath,
  cwd
}: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): readonly string[] => Array.from(new Set([
  resourcesPath === undefined ? "" : path.join(resourcesPath, "download-manager", "browser_download_probe.py"),
  resourcesPath === undefined
    ? ""
    : path.join(resourcesPath, "resources", "download-manager", "browser_download_probe.py"),
  appPath === undefined
    ? ""
    : path.join(appPath, "resources", "download-manager", "browser_download_probe.py"),
  cwd === undefined
    ? ""
    : path.join(cwd, "apps/desktop/resources/download-manager/browser_download_probe.py")
].filter((value) => value.length > 0)));

const resolveProbeScriptPath = async (options: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): Promise<string | null> => {
  for (const candidate of resolveDownloadManagerProbeScriptCandidates(options)) {
    if (await isAccessible(candidate, false)) {
      return candidate;
    }
  }
  return null;
};

const runBrowserProbe = async (
  pythonPath: string,
  scriptPath: string,
  limit: number
): Promise<readonly ExternalBrowserDownloadCandidate[]> => {
  const stdout = await runProcess(
    pythonPath,
    ["-I", scriptPath, "--limit", String(limit)],
    {
      cwd: path.dirname(scriptPath),
      env: downloadManagerPythonEnv(),
      timeoutMs: DEFAULT_TIMEOUT_MS
    }
  );
  return parseExternalBrowserProbeResult(stdout);
};

export const scanExternalBrowserDownloads = async ({
  storageRoot,
  appPath,
  resourcesPath,
  cwd,
  limit
}: {
  readonly storageRoot: string;
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly limit?: number | undefined;
}): Promise<readonly ExternalBrowserDownloadCandidate[]> => {
  const scriptPath = await resolveProbeScriptPath({ appPath, resourcesPath, cwd });
  if (scriptPath === null) {
    throw new Error("External browser download probe was not found.");
  }
  const normalizedLimit = normalizeLimit(limit);
  const explicitPython = process.env.LYRA_DOWNLOAD_BROWSER_IMPORT_PYTHON?.trim();
  const browserUseBundle = await resolveBrowserUseBundle({ appPath, resourcesPath, cwd });
  const bundledPython = browserUseBundle === null
    ? null
    : await materializeBundledPython(storageRoot, browserUseBundle);
  const candidates = [
    ...(explicitPython === undefined || explicitPython.length === 0 ? [] : [explicitPython]),
    ...(bundledPython === null ? [] : [bundledPython]),
    "python3",
    "python"
  ];
  const failures: string[] = [];
  for (const pythonPath of candidates) {
    try {
      return await runBrowserProbe(pythonPath, scriptPath, normalizedLimit);
    } catch (error) {
      failures.push(`${pythonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    failures.length === 0
      ? "No Python runtime is available for external browser import."
      : `External browser import failed. ${failures.join("; ")}`
  );
};
