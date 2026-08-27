/**
 * Verify staged MinGit bundles: check manifest.json exists, re-compute
 * SHA-256 of every file, and run a bash --version smoke test on the
 * current target.
 *
 * Usage:
 *   tsx tools/download-manager/verify-git-bundles.ts              # current target
 *   tsx tools/download-manager/verify-git-bundles.ts --all-targets
 *   tsx tools/download-manager/verify-git-bundles.ts --target=win32-x64
 */

import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type GitTargetId = "win32-x64" | "win32-arm64";

const GIT_TARGETS: readonly GitTargetId[] = ["win32-x64", "win32-arm64"];

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/git");

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: { readonly timeoutMs?: number }
): Promise<string> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      if (code === 0 && timedOut === false) {
        resolve(stdout);
        return;
      }
      reject(new Error(
        timedOut
          ? `${command} ${args.join(" ")} timed out`
          : `${command} ${args.join(" ")} failed (${code ?? "signal"})\n${stderr || stdout}`
      ));
    });
  });
};

const resolveCurrentTargetId = (): GitTargetId => {
  const id = `${process.platform}-${process.arch}`;
  if (GIT_TARGETS.includes(id as GitTargetId)) {
    return id as GitTargetId;
  }
  // Non-Windows host — return the first target for manifest-only checks.
  return "win32-x64";
};

const parseTargets = (): readonly GitTargetId[] => {
  if (process.argv.includes("--all-targets")) {
    return GIT_TARGETS;
  }
  const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
  if (targetArg === undefined) {
    return [resolveCurrentTargetId()];
  }
  const ids = targetArg
    .slice("--target=".length)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (ids.length === 0) throw new Error("--target cannot be empty");
  return ids.map((id) => {
    if (GIT_TARGETS.includes(id as GitTargetId)) return id as GitTargetId;
    throw new Error(`unknown git target ${id}`);
  });
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const collectFiles = async (root: string, relativeRoot = ""): Promise<readonly string[]> => {
  const { readdir: rd } = await import("node:fs/promises");
  const current = path.join(root, relativeRoot);
  const entries = await rd(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

type ManifestFile = {
  readonly path: string;
  readonly sha256: string;
  readonly executable?: boolean;
};

type Manifest = {
  readonly bundleVersion: string;
  readonly target: string;
  readonly binary: string;
  readonly gitBinary?: string;
  readonly source: string;
  readonly packages: readonly string[];
  readonly files: readonly ManifestFile[];
};

const verifyTarget = async (
  targetId: GitTargetId,
  currentTargetId: GitTargetId
): Promise<void> => {
  const targetRoot = path.join(BUNDLES_ROOT, targetId);
  const manifestPath = path.join(targetRoot, "manifest.json");
  await access(manifestPath);

  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.target !== targetId) {
    throw new Error(`manifest target mismatch: expected ${targetId}, got ${manifest.target}`);
  }

  // Verify every file in the manifest
  for (const file of manifest.files) {
    const filePath = path.join(targetRoot, file.path.replace(/\//gu, path.sep));
    const hash = await sha256File(filePath);
    if (hash !== file.sha256) {
      throw new Error(`SHA-256 mismatch for ${file.path} in ${targetId}: expected ${file.sha256}, got ${hash}`);
    }
  }

  // Verify bash.exe exists at the expected path
  const bashPath = path.join(targetRoot, "bin", "bash.exe");
  await access(bashPath);

  // Smoke test: run bash --version on the current host target
  if (targetId === currentTargetId && process.platform === "win32") {
    const output = await runProcess(bashPath, ["--version"], { timeoutMs: 10_000 });
    if (/GNU bash/u.test(output) === false) {
      throw new Error(`bash smoke test failed for ${targetId}: ${output.slice(0, 200)}`);
    }
  }

  process.stdout.write(`Git bundle verified for ${targetId} (${manifest.files.length} files)\n`);
};

const main = async (): Promise<void> => {
  const targets = parseTargets();
  const currentTargetId = resolveCurrentTargetId();
  for (const targetId of targets) {
    await verifyTarget(targetId, currentTargetId);
  }
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[git verify] ${message}\n`);
  process.exitCode = 1;
});