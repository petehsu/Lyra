import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TargetConfig = {
  readonly id: string;
  readonly pythonAsset: string;
  readonly pythonBinary: string;
  readonly pipPlatform: string;
  readonly sysPlatform: string;
  readonly osName: string;
  readonly platformSystem: string;
  readonly platformMachine: string;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/browser-use");
const WHEELHOUSE_HELPER = path.join(currentDir, "download_wheelhouse.py");
const SANITIZE_WHEEL_HELPER = path.join(currentDir, "sanitize_browser_use_wheel.py");
const PYTHON_BUILD_STANDALONE_RELEASE = "20260408";
const BROWSER_USE_PIN = "browser-use==0.12.6";
const PYTHON_FULL_VERSION = "3.12.13";
const DEFAULT_BUILD_PYTHON = process.env.BROWSER_USE_BUILD_PYTHON?.trim() || "python3.12";
const BLOCKED_WHEEL_PATTERNS = [/^posthog-/i];

const TARGETS: Record<string, TargetConfig> = {
  "darwin-x64": {
    id: "darwin-x64",
    pythonAsset: "cpython-3.12.13+20260408-x86_64-apple-darwin-install_only.tar.gz",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "macosx_10_13_x86_64",
    sysPlatform: "darwin",
    osName: "posix",
    platformSystem: "Darwin",
    platformMachine: "x86_64",
  },
  "darwin-arm64": {
    id: "darwin-arm64",
    pythonAsset: "cpython-3.12.13+20260408-aarch64-apple-darwin-install_only.tar.gz",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "macosx_11_0_arm64",
    sysPlatform: "darwin",
    osName: "posix",
    platformSystem: "Darwin",
    platformMachine: "arm64",
  },
  "linux-x64": {
    id: "linux-x64",
    pythonAsset: "cpython-3.12.13+20260408-x86_64-unknown-linux-gnu-install_only.tar.gz",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "manylinux2014_x86_64",
    sysPlatform: "linux",
    osName: "posix",
    platformSystem: "Linux",
    platformMachine: "x86_64",
  },
  "linux-arm64": {
    id: "linux-arm64",
    pythonAsset: "cpython-3.12.13+20260408-aarch64-unknown-linux-gnu-install_only.tar.gz",
    pythonBinary: "python/bin/python3.12",
    pipPlatform: "manylinux2014_aarch64",
    sysPlatform: "linux",
    osName: "posix",
    platformSystem: "Linux",
    platformMachine: "aarch64",
  },
  "win32-x64": {
    id: "win32-x64",
    pythonAsset: "cpython-3.12.13+20260408-x86_64-pc-windows-msvc-install_only.tar.gz",
    pythonBinary: "python/python.exe",
    pipPlatform: "win_amd64",
    sysPlatform: "win32",
    osName: "nt",
    platformSystem: "Windows",
    platformMachine: "AMD64",
  },
  "win32-arm64": {
    id: "win32-arm64",
    pythonAsset: "cpython-3.12.13+20260408-aarch64-pc-windows-msvc-install_only.tar.gz",
    pythonBinary: "python/python.exe",
    pipPlatform: "win_arm64",
    sysPlatform: "win32",
    osName: "nt",
    platformSystem: "Windows",
    platformMachine: "ARM64",
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
  await new Promise((resolve, reject) => {
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
        resolve(undefined);
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
      throw new Error(`unknown browser-use target ${id}`);
    }
    return target;
  });
};

const sha256File = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

const fetchFile = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
};

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const findSingleDirectory = async (root: string): Promise<string> => {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    throw new Error(`expected exactly one extracted directory under ${root}`);
  }
  return path.join(root, directories[0].name);
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

const isBlockedWheelFile = (fileName: string): boolean =>
  BLOCKED_WHEEL_PATTERNS.some((pattern) => pattern.test(path.basename(fileName)));

const removeBlockedWheelFiles = async (wheelhouseDir: string): Promise<void> => {
  const wheelhouseFiles = await readdir(wheelhouseDir);
  await Promise.all(
    wheelhouseFiles
      .filter(isBlockedWheelFile)
      .map((fileName) => rm(path.join(wheelhouseDir, fileName), { force: true })),
  );
};

const buildTargetBundle = async (target: TargetConfig): Promise<void> => {
  const targetRoot = path.join(BUNDLES_ROOT, target.id);
  const artifactsDir = path.join(targetRoot, "artifacts");
  const wheelhouseDir = path.join(targetRoot, "wheelhouse");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lyra-browser-use-build-"));
  const downloadPath = path.join(tempRoot, target.pythonAsset);
  const extractedRoot = path.join(tempRoot, "python-extracted");
  const normalizedRoot = path.join(tempRoot, "normalized");
  const normalizedPythonRoot = path.join(normalizedRoot, "python");
  const pythonArchiveRelativePath = path.join("artifacts", "python-runtime.tar.gz");

  try {
    await rm(targetRoot, { recursive: true, force: true });
    await mkdir(targetRoot, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await mkdir(wheelhouseDir, { recursive: true });
    await mkdir(extractedRoot, { recursive: true });
    await mkdir(normalizedRoot, { recursive: true });

    const pythonUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_STANDALONE_RELEASE}/${target.pythonAsset}`;
    await fetchFile(pythonUrl, downloadPath);
    await runProcess("tar", ["-xzf", downloadPath, "-C", extractedRoot], { timeoutMs: 120_000 });

    const directPythonRoot = path.join(extractedRoot, "python");
    const sourcePythonRoot = await pathExists(directPythonRoot)
      ? directPythonRoot
      : await findSingleDirectory(extractedRoot);
    await cp(sourcePythonRoot, normalizedPythonRoot, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });

    const pythonArchivePath = path.join(targetRoot, pythonArchiveRelativePath);
    await rm(pythonArchivePath, { force: true });
    await runProcess("tar", ["-czf", pythonArchivePath, "-C", normalizedRoot, "python"], { timeoutMs: 120_000 });

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
      "--root",
      BROWSER_USE_PIN,
    ];
    await runProcess(DEFAULT_BUILD_PYTHON, wheelhouseArgs, { timeoutMs: 900_000 });
    await removeBlockedWheelFiles(wheelhouseDir);

    const wheelhouseFiles = await readdir(wheelhouseDir);
    const browserUseWheelName = wheelhouseFiles.find((file) => /^browser_use-[^-]+-.*\.whl$/i.test(file));
    if (browserUseWheelName === undefined) {
      throw new Error(`failed to locate browser-use wheel under ${wheelhouseDir}`);
    }
    await runProcess(
      DEFAULT_BUILD_PYTHON,
      [SANITIZE_WHEEL_HELPER, path.join(wheelhouseDir, browserUseWheelName)],
      { timeoutMs: 30_000 },
    );

    const bundleVersion = `browser-use-0.12.6-python-${PYTHON_FULL_VERSION}-${target.id}`;
    const relativeFiles = await collectFiles(targetRoot);
    const manifestFiles = [];
    for (const relativePath of relativeFiles) {
      if (relativePath === "manifest.json") {
        continue;
      }
      if (isBlockedWheelFile(relativePath)) {
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
      bundleVersion,
      target: target.id,
      browserUsePin: BROWSER_USE_PIN,
      pythonBinary: target.pythonBinary,
      pythonArchive: pythonArchiveRelativePath.split(path.sep).join("/"),
      browserUseWheel: path.join("wheelhouse", browserUseWheelName).split(path.sep).join("/"),
      wheelhouseDir: "wheelhouse",
      files: manifestFiles,
    };

    await writeFile(
      path.join(targetRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`browser-use bundle created for ${target.id}\n`);
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
  process.stderr.write(`[browser-use build] ${message}\n`);
  process.exitCode = 1;
});
