import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions
} from "node:child_process";
import fs from "node:fs";

import { resolveRuntimeBinaryCandidates } from "./runtime-client";

const WATCHER_GRACE_MS = 1_500;

let watcherBinaryPath: string | null | undefined;

const resolveWatcherBinaryPath = (): string | null => {
  if (watcherBinaryPath !== undefined) {
    return watcherBinaryPath;
  }
  const explicit =
    process.env.LYRA_DAEMON_WATCHER_BIN?.trim() || process.env.LYRA_RUNTIME_BIN?.trim();
  if (explicit !== undefined && explicit.length > 0 && fs.existsSync(explicit)) {
    watcherBinaryPath = explicit;
    return watcherBinaryPath;
  }
  const bundled = resolveRuntimeBinaryCandidates(process.cwd()).find((candidate) =>
    fs.existsSync(candidate)
  );
  watcherBinaryPath = bundled ?? null;
  return watcherBinaryPath;
};

const spawnParentWatcher = (pid: number): void => {
  const binaryPath = resolveWatcherBinaryPath();
  if (binaryPath === null) {
    return;
  }
  const watcher = spawn(
    binaryPath,
    [
      "--watch-parent",
      "--parent-pid",
      String(process.pid),
      "--target-pid",
      String(pid),
      "--target-group",
      "--grace-ms",
      String(WATCHER_GRACE_MS)
    ],
    {
      detached: process.platform !== "win32",
      stdio: "ignore"
    }
  );
  watcher.unref();
};

export function spawnManagedChildProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions & { readonly stdio: ["ignore", "pipe", "pipe"] }
): ChildProcessWithoutNullStreams;
export function spawnManagedChildProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess;
export function spawnManagedChildProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess {
  const child = spawn(command, [...args], {
    ...options,
    detached: options.detached ?? process.platform !== "win32"
  });
  if (typeof child.pid === "number") {
    spawnParentWatcher(child.pid);
  }
  return child;
}

export const terminateManagedChildProcess = (child: ChildProcess, force = false): void => {
  const pid = child.pid;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (typeof pid !== "number") {
    child.kill(force ? "SIGKILL" : "SIGTERM");
    return;
  }
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) {
      args.push("/F");
    }
    spawn("taskkill", args, { stdio: "ignore" }).unref();
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
};
