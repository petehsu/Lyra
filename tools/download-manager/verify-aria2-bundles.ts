import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ARIA2_BUNDLE_TARGETS,
  readVerifiedAria2BundleManifest,
  resolveCurrentAria2BundleTarget
} from "../../apps/desktop/src/main/download-manager/aria2-runtime";

type KnownTargetId = (typeof ARIA2_BUNDLE_TARGETS)[number]["id"];

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/aria2");

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly timeoutMs?: number;
  }
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
      if (code === 0 && timedOut === false) {
        resolve(stdout);
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

const resolveCurrentTargetId = (): KnownTargetId => {
  const target = resolveCurrentAria2BundleTarget(process.platform, process.arch);
  if (target === null) {
    throw new Error(`unsupported current aria2 target ${process.platform}-${process.arch}`);
  }
  return target.id;
};

const parseTargets = (): readonly KnownTargetId[] => {
  if (process.argv.includes("--all-targets")) {
    return ARIA2_BUNDLE_TARGETS.map((target) => target.id);
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
  if (ids.length === 0) {
    throw new Error("--target cannot be empty");
  }
  return ids.map((id) => {
    if (ARIA2_BUNDLE_TARGETS.some((target) => target.id === id)) {
      return id as KnownTargetId;
    }
    throw new Error(`unknown aria2 target ${id}`);
  });
};

const verifyTarget = async (
  targetId: KnownTargetId,
  currentTargetId: KnownTargetId
): Promise<void> => {
  const target = ARIA2_BUNDLE_TARGETS.find((candidate) => candidate.id === targetId);
  if (target === undefined) {
    throw new Error(`unknown aria2 target ${targetId}`);
  }
  const manifestPath = path.join(BUNDLES_ROOT, target.id, "manifest.json");
  await access(manifestPath);
  const resolved = readVerifiedAria2BundleManifest(manifestPath, target, target.platform, {
    verifyAllFiles: true
  });
  if (resolved === null) {
    throw new Error(`invalid aria2 manifest for ${target.id}`);
  }
  if (target.id === currentTargetId) {
    const output = await runProcess(resolved.binaryPath, ["--version"], { timeoutMs: 10_000 });
    if (/aria2 version/u.test(output) === false) {
      throw new Error(`aria2 smoke test failed for ${target.id}`);
    }
  }
  process.stdout.write(`aria2 bundle verified for ${target.id}\n`);
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
  process.stderr.write(`[aria2 verify] ${message}\n`);
  process.exitCode = 1;
});
