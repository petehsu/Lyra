import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BrowserUseAgentRunResult,
  BrowserUseStepResult,
} from "../../../shared/browser-use";
import type {
  BrowserUseCommandResult,
  BrowserUseRuntimeInstallState,
  BrowserUseRuntimeManager,
  BrowserUseRuntimePreflightResult,
} from "../types";
import {
  materializeBundledBrowserUseRuntime,
  readBrowserUseInstallMarker,
  readMaterializedBrowserUseManifest,
  resolveBrowserUseRuntimePaths,
  validateBundledBrowserUseManifest,
} from "./install";
import { resolveBundledBrowserUseBundle } from "./bundle";
import { withBrowserUsePrivacyEnv } from "./privacy-env";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const AGENT_RUNNER_PATH = path.join(currentDir, "agent-runner.py");
const DEFAULT_DAEMON_COMMAND_TIMEOUT_MS = 12_000;
const DAEMON_READY_TIMEOUT_MS = 8_000;

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly env?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly timeoutMs?: number;
  },
): Promise<{ readonly stdout: string; readonly stderr: string }> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options?.env,
      cwd: options?.cwd,
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
        resolve({ stdout, stderr });
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

const resolveSocketPath = (homeDir: string, sessionName: string): string => {
  if (process.platform === "win32") {
    let hash = 1;
    for (const char of sessionName) {
      hash = ((hash << 5) + hash) + char.charCodeAt(0);
      hash >>>= 0;
    }
    const port = 49152 + (hash % 16383);
    return `tcp://127.0.0.1:${port}`;
  }
  return path.join(homeDir, `${sessionName}.sock`);
};

const createRequestId = (): string => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const connectSocket = async (socketPath: string): Promise<net.Socket> => {
  if (socketPath.startsWith("tcp://")) {
    const url = new URL(socketPath);
    return await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: url.hostname, port: Number(url.port) }, () => resolve(socket));
      socket.once("error", reject);
    });
  }
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => resolve(socket));
    socket.once("error", reject);
  });
};

const sendDaemonCommand = async (
  homeDir: string,
  daemonSessionName: string,
  action: string,
  params: Record<string, unknown>,
  options?: {
    readonly timeoutMs?: number;
  },
): Promise<BrowserUseCommandResult> => {
  const socketPath = resolveSocketPath(homeDir, daemonSessionName);
  const socket = await connectSocket(socketPath);
  const request = {
    id: createRequestId(),
    action,
    params,
  };
  return await new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1_000, options?.timeoutMs ?? DEFAULT_DAEMON_COMMAND_TIMEOUT_MS);
    let buffer = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      try {
        socket.end();
      } catch {
        // ignore
      }
      callback();
    };
    const timeoutHandle = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      finish(() => {
        reject(new Error(`browser-use daemon command ${action} timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!buffer.endsWith("\n")) {
        return;
      }
      try {
        const response = JSON.parse(buffer.trimEnd()) as {
          readonly success?: boolean;
          readonly data?: Record<string, unknown>;
          readonly error?: string;
        };
        finish(() => {
          resolve({
            success: response.success === true,
            ...(response.data === undefined ? {} : { data: response.data }),
            ...(typeof response.error === "string" ? { error: response.error } : {}),
          });
        });
      } catch (error) {
        finish(() => reject(error));
      }
    });
    socket.once("error", (error) => {
      finish(() => reject(error));
    });
    socket.write(`${JSON.stringify(request)}\n`);
  });
};

const normalizeStepResults = (value: unknown): readonly BrowserUseStepResult[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const title = typeof record.title === "string" && record.title.trim().length > 0
      ? record.title.trim()
      : `Step ${index + 1}`;
    const status = record.status === "failed"
      ? "failed"
      : record.status === "running"
        ? "running"
        : "completed";
    return [{
      index,
      title,
      status,
      ...(typeof record.message === "string" && record.message.trim().length > 0
        ? { message: record.message.trim() }
        : {}),
    }];
  });
};

const createUnavailableRuntimeError = (message: string): Error =>
  Object.assign(new Error(message), {
    code: "browser_use_runtime_unavailable",
  });

export const createBrowserUseRuntimeManager = ({
  storageRoot,
}: {
  readonly storageRoot: string;
}): BrowserUseRuntimeManager => {
  const daemonProcesses = new Map<string, ReturnType<typeof spawn>>();

  const ensureInstalled = async (): Promise<BrowserUseRuntimeInstallState> => {
    const existing = await readBrowserUseInstallMarker(storageRoot);
    if (existing === null) {
      throw createUnavailableRuntimeError(
        "browser_use bundled runtime is unavailable until startup preflight succeeds.",
      );
    }
    const manifest = await readMaterializedBrowserUseManifest(existing);
    if (manifest === null || manifest.bundleVersion !== existing.bundleVersion) {
      throw createUnavailableRuntimeError(
        "browser_use bundled runtime marker is stale or invalid.",
      );
    }
    return existing;
  };

  const waitForDaemon = async (homeDir: string, daemonSessionName: string): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < DAEMON_READY_TIMEOUT_MS) {
      try {
        const result = await sendDaemonCommand(homeDir, daemonSessionName, "ping", {}, { timeoutMs: 1_200 });
        if (result.success) {
          return;
        }
      } catch {
        // ignore until ready
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`browser-use daemon ${daemonSessionName} did not become ready`);
  };

  return {
    dispose: async () => {
      for (const daemonSessionName of daemonProcesses.keys()) {
        try {
          daemonProcesses.get(daemonSessionName)?.kill();
        } catch {
          // ignore
        }
      }
      daemonProcesses.clear();
    },
    preflight: async (): Promise<BrowserUseRuntimePreflightResult> => {
      const bundle = await resolveBundledBrowserUseBundle(process.platform, process.arch);
      if (bundle === null) {
        return {
          ok: false,
          code: process.platform === "linux" || process.platform === "darwin" || process.platform === "win32"
            ? "missing_bundle"
            : "unsupported_platform",
          detail: `No bundled browser-use runtime found for ${process.platform}-${process.arch}.`,
        };
      }

      const manifestValidation = await validateBundledBrowserUseManifest(bundle);
      if (!manifestValidation.ok) {
        return manifestValidation;
      }

      const paths = resolveBrowserUseRuntimePaths(storageRoot, bundle.manifest.bundleVersion);
      await mkdir(paths.runtimeRoot, { recursive: true });
      await mkdir(paths.homeDir, { recursive: true });
      const installState = await materializeBundledBrowserUseRuntime(storageRoot, bundle);

      try {
        await runProcess(installState.pythonPath, ["--version"], {
          env: withBrowserUsePrivacyEnv(process.env, { BROWSER_USE_HOME: installState.homeDir }),
          timeoutMs: 2_000,
        });
        await runProcess(
          installState.pythonPath,
          [
            "-c",
            "from importlib.metadata import version; import browser_use.skill_cli.daemon; print(version('browser-use'))",
          ],
          {
            env: withBrowserUsePrivacyEnv(process.env, { BROWSER_USE_HOME: installState.homeDir }),
            timeoutMs: 3_000,
          },
        );
      } catch (error) {
        return {
          ok: false,
          code: "integrity_failed",
          detail: error instanceof Error ? error.message : String(error),
        };
      }

      const smokeSessionName = `preflight-${Date.now()}`;
      if (process.platform !== "win32") {
        await rm(resolveSocketPath(installState.homeDir, smokeSessionName), {
          force: true,
        }).catch(() => undefined);
      }
      try {
        const args = ["-m", "browser_use.skill_cli.daemon", "--session", smokeSessionName];
        const child = spawn(installState.pythonPath, args, {
          env: withBrowserUsePrivacyEnv(process.env, {
            BROWSER_USE_HOME: installState.homeDir,
            PYTHONUNBUFFERED: "1",
          }),
          detached: process.platform !== "win32",
          stdio: "ignore",
        });
        daemonProcesses.set(smokeSessionName, child);
        child.once("exit", () => {
          daemonProcesses.delete(smokeSessionName);
        });
        await waitForDaemon(installState.homeDir, smokeSessionName);
        await sendDaemonCommand(installState.homeDir, smokeSessionName, "shutdown", {}, { timeoutMs: 2_000 }).catch(() => undefined);
        daemonProcesses.get(smokeSessionName)?.kill();
        daemonProcesses.delete(smokeSessionName);
      } catch (error) {
        daemonProcesses.get(smokeSessionName)?.kill();
        daemonProcesses.delete(smokeSessionName);
        return {
          ok: false,
          code: "daemon_launch_failed",
          detail: error instanceof Error ? error.message : String(error),
        };
      }

      return {
        ok: true,
        installState,
      };
    },
    ensureInstalled,
    startDaemon: async ({ daemonSessionName, headed, profileName, cdpUrl }) => {
      const runtime = await ensureInstalled();
      if (daemonProcesses.has(daemonSessionName)) {
        return;
      }
      const args = ["-m", "browser_use.skill_cli.daemon", "--session", daemonSessionName];
      if (headed) {
        args.push("--headed");
      }
      if (typeof profileName === "string" && profileName.trim().length > 0) {
        args.push("--profile", profileName.trim());
      }
      if (typeof cdpUrl === "string" && cdpUrl.trim().length > 0) {
        args.push("--cdp-url", cdpUrl.trim());
      }
      const child = spawn(runtime.pythonPath, args, {
        env: withBrowserUsePrivacyEnv(process.env, {
          BROWSER_USE_HOME: runtime.homeDir,
          PYTHONUNBUFFERED: "1",
        }),
        detached: process.platform !== "win32",
        stdio: "ignore",
      });
      daemonProcesses.set(daemonSessionName, child);
      child.once("exit", () => {
        daemonProcesses.delete(daemonSessionName);
      });
      await waitForDaemon(runtime.homeDir, daemonSessionName);
    },
    stopDaemon: async (daemonSessionName) => {
      const runtime = await ensureInstalled();
      try {
        await sendDaemonCommand(runtime.homeDir, daemonSessionName, "shutdown", {});
      } catch {
        daemonProcesses.get(daemonSessionName)?.kill();
      }
      daemonProcesses.delete(daemonSessionName);
    },
    sendCommand: async (daemonSessionName, action, params = {}) => {
      const runtime = await ensureInstalled();
      try {
        return await sendDaemonCommand(runtime.homeDir, daemonSessionName, action, params);
      } catch (error) {
        if (error instanceof Error && /timed out|ENOENT|ECONNREFUSED|EPIPE|socket/i.test(error.message)) {
          daemonProcesses.get(daemonSessionName)?.kill();
          daemonProcesses.delete(daemonSessionName);
        }
        throw error;
      }
    },
    runAgentTask: async ({ daemonSessionName, task, maxSteps, model, cdpUrl }) => {
      const runtime = await ensureInstalled();
      const result = await runProcess(runtime.pythonPath, [AGENT_RUNNER_PATH], {
        env: withBrowserUsePrivacyEnv(process.env, {
          BROWSER_USE_HOME: runtime.homeDir,
          LYRA_BROWSER_USE_SESSION: daemonSessionName,
          LYRA_BROWSER_USE_TASK: task,
          LYRA_BROWSER_USE_MAX_STEPS: String(maxSteps),
          ...(typeof model === "string" && model.trim().length > 0
            ? { LYRA_BROWSER_USE_MODEL: model.trim() }
            : {}),
          ...(typeof cdpUrl === "string" && cdpUrl.trim().length > 0
            ? { LYRA_BROWSER_USE_CDP_URL: cdpUrl.trim() }
            : {}),
        }),
        timeoutMs: 20_000,
      });
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      return {
        sessionId: daemonSessionName,
        ok: parsed.ok === true,
        ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
        steps: normalizeStepResults(parsed.steps),
      } satisfies BrowserUseAgentRunResult;
    },
  };
};
