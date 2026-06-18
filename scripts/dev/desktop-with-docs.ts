import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import * as readline from "node:readline";

import { spawnCommand } from "../desktop/spawn-command";

type ManagedProcess = {
  readonly name: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly docsPort?: number;
};

type StartProcessOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly docsPort?: number;
  readonly cwd?: string;
};

type DocsDevServer = {
  readonly processInfo: ManagedProcess | null;
  readonly entryAddress: string;
};

type NextDevLock = {
  readonly pid: number;
  readonly port: number;
  readonly hostname?: string;
  readonly appUrl?: string;
};

const repoRoot = path.resolve(__dirname, "../..");
const docsRoot = path.join(repoRoot, "web/docs");
const docsPort = 5174;
const rendererDevPort = 5173;
const docsHealthPath = "/docs";
const docsDevLockPath = path.join(docsRoot, ".next", "dev", "lock");
const docsNextBin = path.join(
  docsRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next"
);

const isBrokenPipeError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === "EPIPE";

const safeWrite = (output: NodeJS.WritableStream, text: string): void => {
  try {
    output.write(text);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
};

const docsEntryAddress = (port: number): string =>
  `http://localhost:${port}${docsHealthPath}`;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const probeDocsServer = async (port: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: docsHealthPath,
        timeout: 1_500
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 500;
        finish(status >= 200 && status < 500);
      }
    );
    request.once("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.once("error", () => finish(false));
  });

const isPortAvailable = async (port: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    server.once("error", () => finish(false));
    server.once("listening", () => {
      server.close(() => finish(true));
    });
    server.listen(port);
    server.unref();
  });

const readDocsDevLock = (): NextDevLock | null => {
  if (!fs.existsSync(docsDevLockPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(docsDevLockPath, "utf8")) as Partial<NextDevLock>;
    if (
      typeof parsed.pid === "number"
      && Number.isFinite(parsed.pid)
      && parsed.pid > 0
      && typeof parsed.port === "number"
      && Number.isFinite(parsed.port)
      && parsed.port > 0
    ) {
      return {
        pid: parsed.pid,
        port: parsed.port,
        ...(typeof parsed.hostname === "string" ? { hostname: parsed.hostname } : {}),
        ...(typeof parsed.appUrl === "string" ? { appUrl: parsed.appUrl } : {})
      };
    }
  } catch {
    return null;
  }
  return null;
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const parentPid = async (pid: number): Promise<number | null> => {
  if (process.platform === "win32") {
    return null;
  }
  return new Promise<number | null>((resolve) => {
    const child = spawn("ps", ["-o", "ppid=", "-p", String(pid)], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", () => resolve(null));
    child.once("exit", () => {
      const value = Number.parseInt(output.trim(), 10);
      resolve(Number.isFinite(value) && value > 1 ? value : null);
    });
  });
};

const terminateProcess = async (pid: number): Promise<void> => {
  if (!processExists(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processExists(pid)) {
      return;
    }
    await sleep(100);
  }
  if (processExists(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
};

const cleanupUnhealthyDocsLock = async (): Promise<DocsDevServer | null> => {
  const lock = readDocsDevLock();
  if (lock === null) {
    return null;
  }
  if (!processExists(lock.pid)) {
    fs.rmSync(docsDevLockPath, { force: true });
    return null;
  }
  if (await probeDocsServer(lock.port)) {
    return {
      processInfo: null,
      entryAddress: docsEntryAddress(lock.port)
    };
  }

  const parent = await parentPid(lock.pid);
  const targets = [...new Set([parent, lock.pid].filter((value): value is number => value !== null))];
  safeWrite(
    process.stdout,
    `[docs] found unhealthy existing Next dev server pid ${lock.pid} on port ${lock.port}; stopping stale docs server\n`
  );
  for (const pid of targets) {
    await terminateProcess(pid);
  }
  if (!processExists(lock.pid)) {
    fs.rmSync(docsDevLockPath, { force: true });
  }
  return null;
};

const resolveDocsPort = async (): Promise<{
  readonly port: number;
  readonly reuseExisting: boolean;
}> => {
  if (await probeDocsServer(docsPort)) {
    return { port: docsPort, reuseExisting: true };
  }
  if (await isPortAvailable(docsPort)) {
    return { port: docsPort, reuseExisting: false };
  }
  for (let candidate = docsPort + 1; candidate <= docsPort + 25; candidate += 1) {
    if (await isPortAvailable(candidate)) {
      return { port: candidate, reuseExisting: false };
    }
  }
  throw new Error(`no available docs dev port found near ${docsPort}`);
};

const runInstall = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawnCommand("npm", ["install"], {
      cwd: docsRoot,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docs dependency install failed (${signal ?? code ?? "unknown"})`));
    });
  });
};

const ensureDocsDependencies = async (): Promise<void> => {
  if (fs.existsSync(docsNextBin)) {
    return;
  }
  console.info("[docs] missing Next.js dependency, running npm --prefix web/docs install");
  await runInstall();
};

const prefixOutput = (
  stream: NodeJS.ReadableStream,
  processName: string,
  output: NodeJS.WritableStream
): void => {
  const lines = readline.createInterface({ input: stream });
  lines.on("line", (line) => {
    safeWrite(output, `[${processName}] ${line}\n`);
  });
};

const startProcess = (
  name: string,
  command: string,
  args: readonly string[],
  options: StartProcessOptions = {}
): ManagedProcess => {
  const child = spawnCommand(command, args, {
    cwd: options.cwd ?? repoRoot,
    detached: process.platform !== "win32",
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  prefixOutput(child.stdout, name, process.stdout);
  prefixOutput(child.stderr, name, process.stderr);

  child.once("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
  });

  return { name, child, docsPort: options.docsPort };
};

const startDocsServer = async (): Promise<DocsDevServer> => {
  const lockedServer = await cleanupUnhealthyDocsLock();
  if (lockedServer !== null) {
    safeWrite(
      process.stdout,
      `[docs] reusing existing dev server at ${lockedServer.entryAddress}\n`
    );
    return lockedServer;
  }
  const resolved = await resolveDocsPort();
  const entryAddress = docsEntryAddress(resolved.port);
  if (resolved.reuseExisting) {
    safeWrite(
      process.stdout,
      `[docs] reusing existing dev server at ${entryAddress}\n`
    );
    return { processInfo: null, entryAddress };
  }
  if (resolved.port !== docsPort) {
    safeWrite(
      process.stdout,
      `[docs] port ${docsPort} is occupied but not healthy; starting docs on ${entryAddress}\n`
    );
  }
  return {
    processInfo: startProcess(
      "docs",
      "npm",
      ["exec", "--", "next", "dev", "-p", String(resolved.port)],
      { cwd: docsRoot, docsPort: resolved.port }
    ),
    entryAddress
  };
};

const stopProcess = (processInfo: ManagedProcess, signal: NodeJS.Signals): void => {
  const { child } = processInfo;
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      console.error(`[${processInfo.name}] failed to stop: ${String(error)}`);
    }
  }
};

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals, exitCode: number): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const processInfo of processes) {
    stopProcess(processInfo, signal);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 500).unref();
};

const processes: ManagedProcess[] = [];

const main = async (): Promise<void> => {
  await ensureDocsDependencies();

  const docsServer = await startDocsServer();
  if (docsServer.processInfo !== null) {
    processes.push(docsServer.processInfo);
  }
  const desktopEnv: NodeJS.ProcessEnv = {
    ...process.env,
    LYRA_RENDERER_PORT: String(rendererDevPort),
    VITE_LYRA_DOCS_ENTRY_ADDRESS: docsServer.entryAddress
  };
  delete desktopEnv.ELECTRON_RUN_AS_NODE;
  processes.push(
    startProcess("desktop", "pnpm", ["--filter", "@lyra/desktop", "dev"], {
      env: desktopEnv
    })
  );

  for (const processInfo of processes) {
    processInfo.child.once("exit", (code, signal) => {
      void (async () => {
        if (shuttingDown) {
          return;
        }
        if (
          processInfo.name === "docs"
          && await probeDocsServer(processInfo.docsPort ?? docsPort)
        ) {
          const entryAddress = docsEntryAddress(processInfo.docsPort ?? docsPort);
          safeWrite(
            process.stdout,
            `[docs] dev process exited (${signal ?? code ?? "unknown"}), reusing existing server at ${entryAddress}\n`
          );
          return;
        }
        if (code === 0 && processInfo.name === "docs") {
          shutdown("SIGTERM", 0);
          return;
        }
        console.error(
          `[${processInfo.name}] exited (${signal ?? code ?? "unknown"}), stopping Lyra dev stack`
        );
        shutdown("SIGTERM", code ?? 1);
      })();
    });
  }
};

process.once("SIGINT", () => shutdown("SIGINT", 130));
process.once("SIGTERM", () => shutdown("SIGTERM", 143));

main().catch((error: unknown) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
