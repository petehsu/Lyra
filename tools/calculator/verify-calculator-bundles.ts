import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type BundleFile = {
  readonly path: string;
  readonly sha256: string;
  readonly executable?: boolean;
};

type CalculatorManifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly pythonBinary: string;
  readonly wheelhouseDir: string;
  readonly requirements: readonly string[];
  readonly files: readonly BundleFile[];
};

type BrowserUseManifest = {
  readonly target: string;
  readonly pythonBinary: string;
  readonly pythonArchive: string;
};

const TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
] as const;

type KnownTarget = (typeof TARGETS)[number];

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const CALCULATOR_BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/calculator");
const BROWSER_USE_BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/browser-use");
const WORKER_PATH = path.join(CALCULATOR_BUNDLES_ROOT, "python-worker.py");

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly stdin?: string;
    readonly timeoutMs?: number;
  },
): Promise<string> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["pipe", "pipe", "pipe"],
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
        resolve(stdout);
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
    child.stdin.end(options?.stdin ?? "");
  });
};

const sha256File = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

const resolveCurrentTarget = (): KnownTarget => {
  const target = `${process.platform}-${process.arch}`;
  if (TARGETS.includes(target as KnownTarget)) {
    return target as KnownTarget;
  }
  throw new Error(`unsupported current target ${target}`);
};

const parseTargets = (): readonly KnownTarget[] => {
  if (process.argv.includes("--all-targets")) {
    return TARGETS;
  }
  const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
  if (targetArg === undefined) {
    return [resolveCurrentTarget()];
  }
  const targets = targetArg
    .slice("--target=".length)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (targets.length === 0) {
    throw new Error("--target cannot be empty");
  }
  return targets.map((target) => {
    if (TARGETS.includes(target as KnownTarget)) {
      return target as KnownTarget;
    }
    throw new Error(`unknown calculator target ${target}`);
  });
};

const readJsonFile = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

const validateCalculatorManifest = async (
  targetRoot: string,
  manifest: CalculatorManifest,
): Promise<void> => {
  if (!manifest.bundleVersion.trim()) {
    throw new Error("missing bundleVersion");
  }
  if (!manifest.pythonBinary.trim()) {
    throw new Error("missing pythonBinary");
  }
  if (!manifest.wheelhouseDir.trim()) {
    throw new Error("missing wheelhouseDir");
  }
  if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
    throw new Error("requirements list is empty");
  }
  for (const requiredPackage of ["sympy", "numpy", "pint"]) {
    if (!manifest.requirements.some((requirement) => requirement.toLowerCase().startsWith(requiredPackage))) {
      throw new Error(`missing calculator requirement: ${requiredPackage}`);
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("manifest files list is empty");
  }
  for (const file of manifest.files) {
    if (!file.path.trim()) {
      throw new Error("manifest file path is empty");
    }
    if (!file.sha256.trim()) {
      throw new Error(`missing sha256 for ${file.path}`);
    }
    const absolutePath = path.join(targetRoot, file.path);
    await access(absolutePath);
    const actualHash = await sha256File(absolutePath);
    if (actualHash !== file.sha256) {
      throw new Error(`hash mismatch for ${file.path}`);
    }
    if (file.executable === true) {
      await access(absolutePath, constants.X_OK);
    }
  }
  const wheelhouseFiles = await readdir(path.join(targetRoot, manifest.wheelhouseDir));
  for (const requiredWheel of ["sympy-", "numpy-", "pint-", "mpmath-"]) {
    if (!wheelhouseFiles.some((file) => file.toLowerCase().startsWith(requiredWheel))) {
      throw new Error(`missing wheelhouse file for ${requiredWheel.replace("-", "")}`);
    }
  }
};

const smokeCurrentTargetBundle = async (
  targetRoot: string,
  manifest: CalculatorManifest,
): Promise<void> => {
  const browserUseRoot = path.join(BROWSER_USE_BUNDLES_ROOT, manifest.target);
  const browserUseManifest = await readJsonFile<BrowserUseManifest>(
    path.join(browserUseRoot, "manifest.json"),
  );
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lyra-calculator-verify-"));
  const materializedRoot = path.join(tempRoot, "materialized");
  try {
    await mkdir(materializedRoot, { recursive: true });
    await runProcess(
      "tar",
      ["-xzf", path.join(browserUseRoot, browserUseManifest.pythonArchive), "-C", materializedRoot],
      { timeoutMs: 120_000 },
    );
    const pythonPath = path.join(materializedRoot, manifest.pythonBinary);
    await runProcess(pythonPath, ["--version"], { timeoutMs: 5_000 });
    await runProcess(pythonPath, ["-m", "ensurepip", "--upgrade"], { timeoutMs: 60_000 }).catch(() => undefined);
    await runProcess(
      pythonPath,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-index",
        "--find-links",
        path.join(targetRoot, manifest.wheelhouseDir),
        "--force-reinstall",
        ...manifest.requirements,
      ],
      {
        env: {
          ...process.env,
          PYTHONNOUSERSITE: "1",
          PYTHONDONTWRITEBYTECODE: "1",
        },
        timeoutMs: 180_000,
      },
    );
    await runProcess(pythonPath, ["-I", "-c", "import sympy, numpy, pint"], { timeoutMs: 15_000 });
    for (const request of [
      { expression: "simplify((x**2 - 1)/(x - 1))", mode: "symbolic", variables: {}, precision: 50, timeoutMs: 5000, wantSteps: false },
      { expression: "Matrix([[1,2],[3,4]]).det()", mode: "matrix", variables: {}, precision: 50, timeoutMs: 5000, wantSteps: false },
      { expression: "1 meter to foot", mode: "unit", variables: {}, precision: 50, timeoutMs: 5000, wantSteps: false },
    ]) {
      const output = await runProcess(
        pythonPath,
        ["-I", WORKER_PATH],
        {
          cwd: path.dirname(WORKER_PATH),
          stdin: JSON.stringify(request),
          timeoutMs: 15_000,
        },
      );
      const parsed = JSON.parse(output) as { readonly ok?: boolean; readonly message?: string };
      if (parsed.ok !== true) {
        throw new Error(`calculator worker smoke failed: ${parsed.message ?? output}`);
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const targets = parseTargets();
  const currentTarget = resolveCurrentTarget();
  await access(WORKER_PATH);
  for (const target of targets) {
    const targetRoot = path.join(CALCULATOR_BUNDLES_ROOT, target);
    const manifest = await readJsonFile<CalculatorManifest>(path.join(targetRoot, "manifest.json"));
    if (manifest.target !== target) {
      throw new Error(`manifest target mismatch for ${target}`);
    }
    await validateCalculatorManifest(targetRoot, manifest);
    if (target === currentTarget) {
      await smokeCurrentTargetBundle(targetRoot, manifest);
    }
    process.stdout.write(`calculator bundle verified for ${target}\n`);
  }
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[calculator verify] ${message}\n`);
  process.exitCode = 1;
});
