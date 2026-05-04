import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type TargetConfig = {
  readonly id: string;
  readonly pythonBinary: string;
  readonly pipPlatform: string;
  readonly sysPlatform: string;
  readonly osName: string;
  readonly platformSystem: string;
  readonly platformMachine: string;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/calculator");
const WHEELHOUSE_HELPER = path.join(REPO_ROOT, "tools/browser-use/download_wheelhouse.py");
const PYTHON_FULL_VERSION = "3.12.13";
const DEFAULT_BUILD_PYTHON = process.env.CALCULATOR_BUILD_PYTHON?.trim() || "python3.12";
const REQUIREMENTS = [
  "sympy==1.14.0",
  "numpy==2.2.6",
  "pint==0.24.4",
] as const;

const TARGETS: Record<string, TargetConfig> = {
  "darwin-x64": {
    id: "darwin-x64",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "macosx_10_13_x86_64",
    sysPlatform: "darwin",
    osName: "posix",
    platformSystem: "Darwin",
    platformMachine: "x86_64",
  },
  "darwin-arm64": {
    id: "darwin-arm64",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "macosx_11_0_arm64",
    sysPlatform: "darwin",
    osName: "posix",
    platformSystem: "Darwin",
    platformMachine: "arm64",
  },
  "linux-x64": {
    id: "linux-x64",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "manylinux2014_x86_64",
    sysPlatform: "linux",
    osName: "posix",
    platformSystem: "Linux",
    platformMachine: "x86_64",
  },
  "linux-arm64": {
    id: "linux-arm64",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "manylinux2014_aarch64",
    sysPlatform: "linux",
    osName: "posix",
    platformSystem: "Linux",
    platformMachine: "aarch64",
  },
  "win32-x64": {
    id: "win32-x64",
    pythonBinary: "python/python.exe",
    pipPlatform: "win_amd64",
    sysPlatform: "win32",
    osName: "nt",
    platformSystem: "Windows",
    platformMachine: "AMD64",
  },
};

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  },
): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: options?.env,
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

const resolveCurrentTarget = (): TargetConfig => {
  const targetId = `${process.platform}-${process.arch}`;
  const target = TARGETS[targetId];
  if (target === undefined) {
    throw new Error(`unsupported current target ${targetId}`);
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
      throw new Error(`unknown calculator target ${id}`);
    }
    return target;
  });
};

const sha256File = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

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

const buildTargetBundle = async (target: TargetConfig): Promise<void> => {
  const targetRoot = path.join(BUNDLES_ROOT, target.id);
  const wheelhouseDir = path.join(targetRoot, "wheelhouse");
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(wheelhouseDir, { recursive: true });

  const wheelhouseArgs = [
    WHEELHOUSE_HELPER,
    "--dest",
    wheelhouseDir,
    "--platform",
    target.pipPlatform,
    "--python-version",
    "3.12",
    "--python-full-version",
    PYTHON_FULL_VERSION,
    "--sys-platform",
    target.sysPlatform,
    "--os-name",
    target.osName,
    "--platform-system",
    target.platformSystem,
    "--platform-machine",
    target.platformMachine,
    ...REQUIREMENTS.flatMap((requirement) => ["--root", requirement]),
  ];
  await runProcess(DEFAULT_BUILD_PYTHON, wheelhouseArgs, { timeoutMs: 900_000 });

  const relativeFiles = await collectFiles(targetRoot);
  const manifestFiles = [];
  for (const relativePath of relativeFiles) {
    if (relativePath === "manifest.json") {
      continue;
    }
    const absolutePath = path.join(targetRoot, relativePath);
    const absoluteStat = await stat(absolutePath);
    manifestFiles.push({
      path: relativePath.split(path.sep).join("/"),
      sha256: await sha256File(absolutePath),
      ...(absoluteStat.mode & 0o111 ? { executable: true } : {}),
    });
  }

  const manifest = {
    bundleVersion: `calculator-math-python-${PYTHON_FULL_VERSION}-sympy-1.14.0-numpy-2.2.6-pint-0.24.4-${target.id}`,
    target: target.id,
    pythonBinary: target.pythonBinary,
    wheelhouseDir: "wheelhouse",
    requirements: [...REQUIREMENTS],
    files: manifestFiles,
  };
  await writeFile(
    path.join(targetRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`calculator bundle created for ${target.id}\n`);
};

const main = async (): Promise<void> => {
  const targets = parseTargets();
  for (const target of targets) {
    await buildTargetBundle(target);
  }
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[calculator build] ${message}\n`);
  process.exitCode = 1;
});
