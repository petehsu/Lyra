import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type BundleFile = {
  readonly path: string;
  readonly sha256: string;
  readonly executable?: boolean;
};

type BundleManifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly browserUsePin: string;
  readonly pythonBinary: string;
  readonly pythonArchive: string;
  readonly browserUseWheel: string;
  readonly wheelhouseDir: string;
  readonly files: readonly BundleFile[];
};

const TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
] as const;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/browser-use");

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

const sha256File = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

const ensureExists = async (filePath: string): Promise<void> => {
  await access(filePath);
};

const resolveCurrentTarget = (): (typeof TARGETS)[number] => {
  const target = `${process.platform}-${process.arch}`;
  if (TARGETS.includes(target as (typeof TARGETS)[number])) {
    return target as (typeof TARGETS)[number];
  }
  throw new Error(`unsupported current target ${target}`);
};

const validateManifest = async (targetRoot: string, manifest: BundleManifest): Promise<void> => {
  if (!manifest.bundleVersion.trim()) {
    throw new Error("missing bundleVersion");
  }
  if (!manifest.browserUsePin.trim()) {
    throw new Error("missing browserUsePin");
  }
  if (!manifest.pythonBinary.trim()) {
    throw new Error("missing pythonBinary");
  }
  if (!manifest.pythonArchive.trim()) {
    throw new Error("missing pythonArchive");
  }
  if (!manifest.browserUseWheel.trim()) {
    throw new Error("missing browserUseWheel");
  }
  if (!manifest.wheelhouseDir.trim()) {
    throw new Error("missing wheelhouseDir");
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
    await ensureExists(absolutePath);
    const actualHash = await sha256File(absolutePath);
    if (actualHash !== file.sha256) {
      throw new Error(`hash mismatch for ${file.path}`);
    }
    if (file.executable === true) {
      await access(absolutePath, constants.X_OK);
    }
  }
};

const smokeCurrentTargetBundle = async (
  targetRoot: string,
  manifest: BundleManifest,
): Promise<void> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lyra-browser-use-verify-"));
  const bundleCopyRoot = path.join(tempRoot, "bundle");
  const materializedRoot = path.join(tempRoot, "materialized");
  try {
    await cp(targetRoot, bundleCopyRoot, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    await mkdir(materializedRoot, { recursive: true });
    await runProcess(
      "tar",
      ["-xzf", path.join(bundleCopyRoot, manifest.pythonArchive), "-C", materializedRoot],
      { timeoutMs: 60_000 },
    );
    const pythonPath = path.join(materializedRoot, manifest.pythonBinary);
    await runProcess(pythonPath, ["--version"], { timeoutMs: 5_000 });
    await runProcess(
      pythonPath,
      ["-m", "ensurepip", "--upgrade"],
      { timeoutMs: 60_000 },
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
        path.join(bundleCopyRoot, manifest.wheelhouseDir),
        "--force-reinstall",
        path.join(bundleCopyRoot, manifest.browserUseWheel),
      ],
      {
        env: {
          ...process.env,
          BROWSER_USE_HOME: path.join(tempRoot, "home"),
        },
        timeoutMs: 180_000,
      },
    );
    await runProcess(
      pythonPath,
      ["-c", "import browser_use.skill_cli.daemon"],
      {
        env: {
          ...process.env,
          BROWSER_USE_HOME: path.join(tempRoot, "home"),
        },
        timeoutMs: 15_000,
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const allTargets = process.argv.includes("--all-targets");
  const targets = allTargets ? TARGETS : [resolveCurrentTarget()];
  const currentTarget = resolveCurrentTarget();
  for (const target of targets) {
    const targetRoot = path.join(BUNDLES_ROOT, target);
    const manifestPath = path.join(targetRoot, "manifest.json");
    await ensureExists(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BundleManifest;
    if (manifest.target !== target) {
      throw new Error(`target mismatch in ${manifestPath}: expected ${target}, got ${manifest.target}`);
    }
    await validateManifest(targetRoot, manifest);
    if (target === currentTarget) {
      await smokeCurrentTargetBundle(targetRoot, manifest);
    }
  }
  process.stdout.write(
    allTargets
      ? "browser-use bundles verified (current target smoked)\n"
      : `browser-use bundle verified for ${currentTarget}\n`,
  );
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[browser-use verify] ${message}\n`);
  process.exitCode = 1;
});
