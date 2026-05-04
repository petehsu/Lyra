import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { app } from "electron";

import { resolveCurrentDesktopTarget } from "../platform-target";
import type { CalculatorEvaluateRequest, CalculatorResult } from "./types";

type CalculatorBundleManifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly pythonBinary: string;
  readonly wheelhouseDir: string;
  readonly requirements: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly sha256?: string;
    readonly executable?: boolean;
  }[];
};

type CalculatorBundle = {
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly manifest: CalculatorBundleManifest;
};

type BrowserUseBundleManifest = {
  readonly target: string;
  readonly pythonBinary: string;
  readonly pythonArchive: string;
};

type BrowserUseBundle = {
  readonly rootPath: string;
  readonly manifest: BrowserUseBundleManifest;
};

type CalculatorInstallMarker = {
  readonly bundleVersion: string;
  readonly bundleRoot: string;
  readonly homeDir: string;
  readonly pythonPath: string;
  readonly manifestPath: string;
};

type PythonRunResult =
  | {
      readonly ok: true;
      readonly result: CalculatorResult;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_STDIO_BYTES = 1_000_000;
const MARKER_FILE = "install-state.json";

const isAccessible = async (candidatePath: string): Promise<boolean> => {
  try {
    await access(candidatePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveCalculatorResourceRoots = (): readonly string[] => {
  const appPath = app.getAppPath();
  const resourcesPath =
    typeof process.resourcesPath === "string" && process.resourcesPath.length > 0
      ? process.resourcesPath
      : "";
  return Array.from(
    new Set(
      [
        path.join(resourcesPath, "calculator"),
        path.join(resourcesPath, "resources", "calculator"),
        path.join(appPath, "resources", "calculator"),
        path.join(process.cwd(), "apps/desktop/resources/calculator")
      ].filter((value) => value.length > 0)
    )
  );
};

const resolveBrowserUseResourceRoots = (): readonly string[] => {
  const appPath = app.getAppPath();
  const resourcesPath =
    typeof process.resourcesPath === "string" && process.resourcesPath.length > 0
      ? process.resourcesPath
      : "";
  return Array.from(
    new Set(
      [
        path.join(resourcesPath, "browser-use"),
        path.join(resourcesPath, "resources", "browser-use"),
        path.join(appPath, "resources", "browser-use"),
        path.join(process.cwd(), "apps/desktop/resources/browser-use")
      ].filter((value) => value.length > 0)
    )
  );
};

const readCalculatorBundleManifest = async (
  root: string
): Promise<CalculatorBundleManifest | null> => {
  try {
    const raw = await readFile(path.join(root, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<CalculatorBundleManifest>;
    const requirements = Array.isArray(parsed.requirements)
      ? parsed.requirements.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const files = Array.isArray(parsed.files)
      ? parsed.files.flatMap((entry) => {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
          }
          const record = entry as Record<string, unknown>;
          if (typeof record.path !== "string" || record.path.trim().length === 0) {
            return [];
          }
          return [{
            path: record.path.trim(),
            ...(typeof record.sha256 === "string" && record.sha256.trim().length > 0
              ? { sha256: record.sha256.trim().toLowerCase() }
              : {}),
            ...(record.executable === true ? { executable: true } : {})
          }];
        })
      : [];
    if (
      typeof parsed.bundleVersion !== "string"
      || typeof parsed.target !== "string"
      || typeof parsed.pythonBinary !== "string"
      || typeof parsed.wheelhouseDir !== "string"
      || requirements.length === 0
      || files.length === 0
    ) {
      return null;
    }
    return {
      bundleVersion: parsed.bundleVersion,
      target: parsed.target,
      pythonBinary: parsed.pythonBinary,
      wheelhouseDir: parsed.wheelhouseDir,
      requirements,
      files
    };
  } catch {
    return null;
  }
};

const readBrowserUseBundleManifest = async (
  root: string
): Promise<BrowserUseBundleManifest | null> => {
  try {
    const raw = await readFile(path.join(root, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<BrowserUseBundleManifest>;
    if (
      typeof parsed.target !== "string"
      || typeof parsed.pythonBinary !== "string"
      || typeof parsed.pythonArchive !== "string"
    ) {
      return null;
    }
    return {
      target: parsed.target,
      pythonBinary: parsed.pythonBinary,
      pythonArchive: parsed.pythonArchive
    };
  } catch {
    return null;
  }
};

const resolveBundledCalculatorBundle = async (): Promise<CalculatorBundle | null> => {
  const target = resolveCurrentDesktopTarget();
  for (const root of resolveCalculatorResourceRoots()) {
    const targetRoot = path.join(root, target.id);
    const manifest = await readCalculatorBundleManifest(targetRoot);
    if (manifest === null || manifest.target !== target.id) {
      continue;
    }
    return {
      rootPath: targetRoot,
      manifestPath: path.join(targetRoot, "manifest.json"),
      manifest
    };
  }
  return null;
};

const resolveBundledBrowserUseBundle = async (): Promise<BrowserUseBundle | null> => {
  const target = resolveCurrentDesktopTarget();
  for (const root of resolveBrowserUseResourceRoots()) {
    const targetRoot = path.join(root, target.id);
    const manifest = await readBrowserUseBundleManifest(targetRoot);
    if (manifest === null || manifest.target !== target.id) {
      continue;
    }
    return {
      rootPath: targetRoot,
      manifest
    };
  }
  return null;
};

const resolveWorkerScriptCandidates = (): readonly string[] =>
  resolveCalculatorResourceRoots().map((root) => path.join(root, "python-worker.py"));

const resolveWorkerScriptPath = async (): Promise<string | null> => {
  for (const candidate of resolveWorkerScriptCandidates()) {
    if (await isAccessible(candidate)) {
      return candidate;
    }
  }
  return null;
};

const calculatorPythonEnv = (): NodeJS.ProcessEnv => ({
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
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  }
): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"]
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
            : `${command} ${args.join(" ")} failed (${code ?? "signal"})\n${stderr || stdout}`
        )
      );
    });
  });
};

const sha256File = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

const hasExecutable = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveInstallPaths = (storageRoot: string, bundleVersion: string) => {
  const runtimeRoot = path.join(storageRoot, "runtime");
  const homeDir = path.join(storageRoot, "home");
  const bundleRoot = path.join(runtimeRoot, bundleVersion);
  const markerPath = path.join(runtimeRoot, MARKER_FILE);
  return {
    runtimeRoot,
    homeDir,
    bundleRoot,
    markerPath
  };
};

const readInstallMarker = async (
  storageRoot: string
): Promise<CalculatorInstallMarker | null> => {
  try {
    const raw = await readFile(path.join(storageRoot, "runtime", MARKER_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<CalculatorInstallMarker>;
    if (
      typeof parsed.bundleVersion !== "string"
      || typeof parsed.bundleRoot !== "string"
      || typeof parsed.homeDir !== "string"
      || typeof parsed.pythonPath !== "string"
      || typeof parsed.manifestPath !== "string"
    ) {
      return null;
    }
    if (!(await hasExecutable(parsed.pythonPath))) {
      return null;
    }
    return parsed as CalculatorInstallMarker;
  } catch {
    return null;
  }
};

const writeInstallMarker = async (
  storageRoot: string,
  marker: CalculatorInstallMarker
): Promise<void> => {
  const { runtimeRoot, markerPath } = resolveInstallPaths(storageRoot, marker.bundleVersion);
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(markerPath, JSON.stringify(marker, null, 2), "utf8");
};

const validateCalculatorBundleFiles = async (bundle: CalculatorBundle): Promise<void> => {
  for (const file of bundle.manifest.files) {
    const filePath = path.join(bundle.rootPath, file.path);
    await access(filePath, constants.F_OK);
    if (file.sha256 !== undefined) {
      const digest = await sha256File(filePath);
      if (digest !== file.sha256) {
        throw new Error(`calculator bundle hash mismatch for ${file.path}`);
      }
    }
    if (file.executable === true && !(await hasExecutable(filePath))) {
      throw new Error(`calculator bundle executable bit missing for ${file.path}`);
    }
  }
};

const canImportCalculatorDependencies = async (pythonPath: string): Promise<boolean> => {
  try {
    await runProcess(
      pythonPath,
      ["-I", "-c", "import sympy, numpy, pint"],
      {
        env: calculatorPythonEnv(),
        timeoutMs: 15_000
      }
    );
    return true;
  } catch {
    return false;
  }
};

const materializeBundledCalculatorRuntime = async (
  storageRoot: string,
  calculatorBundle: CalculatorBundle,
  browserUseBundle: BrowserUseBundle
): Promise<CalculatorInstallMarker> => {
  const existing = await readInstallMarker(storageRoot);
  if (
    existing !== null
    && existing.bundleVersion === calculatorBundle.manifest.bundleVersion
    && await hasExecutable(existing.pythonPath)
    && await canImportCalculatorDependencies(existing.pythonPath)
  ) {
    return existing;
  }

  await validateCalculatorBundleFiles(calculatorBundle);
  const { runtimeRoot, homeDir, bundleRoot } = resolveInstallPaths(
    storageRoot,
    calculatorBundle.manifest.bundleVersion
  );
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });
  await runProcess(
    "tar",
    [
      "-xzf",
      path.join(browserUseBundle.rootPath, browserUseBundle.manifest.pythonArchive),
      "-C",
      bundleRoot
    ],
    { timeoutMs: 120_000 }
  );
  const pythonPath = path.join(bundleRoot, calculatorBundle.manifest.pythonBinary);
  await runProcess(
    pythonPath,
    ["-m", "ensurepip", "--upgrade"],
    {
      env: calculatorPythonEnv(),
      timeoutMs: 60_000
    }
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
      path.join(calculatorBundle.rootPath, calculatorBundle.manifest.wheelhouseDir),
      "--force-reinstall",
      ...calculatorBundle.manifest.requirements
    ],
    {
      env: calculatorPythonEnv(),
      timeoutMs: 180_000
    }
  );
  if (!(await canImportCalculatorDependencies(pythonPath))) {
    throw new Error("calculator Python dependencies were installed but could not be imported");
  }
  const marker: CalculatorInstallMarker = {
    bundleVersion: calculatorBundle.manifest.bundleVersion,
    bundleRoot,
    homeDir,
    pythonPath,
    manifestPath: calculatorBundle.manifestPath
  };
  await writeInstallMarker(storageRoot, marker);
  return marker;
};

const resolveBundledPythonCandidate = async (
  storageRoot: string
): Promise<string | null> => {
  const calculatorBundle = await resolveBundledCalculatorBundle();
  if (calculatorBundle === null) {
    return null;
  }
  const browserUseBundle = await resolveBundledBrowserUseBundle();
  if (browserUseBundle === null) {
    return null;
  }
  try {
    const marker = await materializeBundledCalculatorRuntime(
      storageRoot,
      calculatorBundle,
      browserUseBundle
    );
    return marker.pythonPath;
  } catch {
    return null;
  }
};

const runWorker = async (
  pythonPath: string,
  workerPath: string,
  request: CalculatorEvaluateRequest
): Promise<PythonRunResult> => {
  const timeoutMs = Math.max(1_000, Math.min(10_000, request.timeoutMs || DEFAULT_TIMEOUT_MS));
  return await new Promise((resolve) => {
    const child = spawn(pythonPath, ["-I", workerPath], {
      env: calculatorPythonEnv(),
      cwd: path.dirname(workerPath),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: PythonRunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };
    const timeoutHandle = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        message: `python calculator timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDIO_BYTES) {
        child.kill();
        finish({ ok: false, message: "python calculator output exceeded limit" });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDIO_BYTES) {
        child.kill();
        finish({ ok: false, message: "python calculator stderr exceeded limit" });
      }
    });
    child.once("error", (error) => {
      finish({ ok: false, message: error.message });
    });
    child.once("exit", (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        finish({
          ok: false,
          message: stderr.trim() || `python calculator exited with code ${String(code)}`
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as CalculatorResult;
        finish({ ok: true, result: parsed });
      } catch (error) {
        finish({
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    child.stdin.end(JSON.stringify(request));
  });
};

export const runPythonCalculator = async (
  storageRoot: string,
  request: CalculatorEvaluateRequest
): Promise<CalculatorResult> => {
  const startedAt = Date.now();
  const workerPath = await resolveWorkerScriptPath();
  if (workerPath === null) {
    return {
      ok: false,
      engine: "python",
      code: "PYTHON_WORKER_NOT_FOUND",
      message: "calculator python worker was not found",
      warnings: [],
      elapsedMs: Date.now() - startedAt
    };
  }

  const failures: string[] = [];
  const explicit = process.env.LYRA_CALCULATOR_PYTHON;
  const bundledPythonPath = await resolveBundledPythonCandidate(storageRoot);
  const pythonCandidates = [
    ...(typeof explicit === "string" && explicit.trim().length > 0 ? [explicit.trim()] : []),
    ...(bundledPythonPath === null ? [] : [bundledPythonPath]),
    "python3",
    "python"
  ];
  for (const pythonPath of pythonCandidates) {
    const result = await runWorker(pythonPath, workerPath, request);
    if (result.ok) {
      return result.result;
    }
    failures.push(`${pythonPath}: ${result.message}`);
  }

  return {
    ok: false,
    engine: "python",
    code: "PYTHON_UNAVAILABLE",
    message: failures.length > 0
      ? failures.join("; ")
      : "no python runtime candidates were available",
    warnings: [],
    elapsedMs: Date.now() - startedAt
  };
};
