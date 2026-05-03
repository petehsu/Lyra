import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { app } from "electron";

import { resolveCurrentDesktopTarget } from "../platform-target";
import type { CalculatorEvaluateRequest, CalculatorResult } from "./types";

type CalculatorBundleManifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly pythonBinary: string;
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

const readCalculatorBundleManifest = async (
  root: string
): Promise<CalculatorBundleManifest | null> => {
  try {
    const raw = await readFile(path.join(root, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<CalculatorBundleManifest>;
    if (
      typeof parsed.bundleVersion !== "string"
      || typeof parsed.target !== "string"
      || typeof parsed.pythonBinary !== "string"
    ) {
      return null;
    }
    return {
      bundleVersion: parsed.bundleVersion,
      target: parsed.target,
      pythonBinary: parsed.pythonBinary
    };
  } catch {
    return null;
  }
};

const resolveBundledPythonCandidates = async (): Promise<readonly string[]> => {
  const target = resolveCurrentDesktopTarget();
  const candidates: string[] = [];
  for (const root of resolveCalculatorResourceRoots()) {
    const targetRoot = path.join(root, target.id);
    const manifest = await readCalculatorBundleManifest(targetRoot);
    if (manifest === null || manifest.target !== target.id) {
      continue;
    }
    candidates.push(path.join(targetRoot, manifest.pythonBinary));
  }
  return candidates;
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

const resolvePythonCandidates = async (): Promise<readonly string[]> => {
  const explicit = process.env.LYRA_CALCULATOR_PYTHON;
  return [
    ...(typeof explicit === "string" && explicit.trim().length > 0 ? [explicit.trim()] : []),
    ...(await resolveBundledPythonCandidates()),
    "python3",
    "python"
  ];
};

const calculatorPythonEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  DO_NOT_TRACK: "1",
  DISABLE_TELEMETRY: "1",
  ANONYMIZED_TELEMETRY: "false",
  PYTHONNOUSERSITE: "1",
  PYTHONDONTWRITEBYTECODE: "1"
});

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
  for (const pythonPath of await resolvePythonCandidates()) {
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
