import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

type ManagedProcess = {
  readonly name: string;
  readonly child: ChildProcessWithoutNullStreams;
};

const repoRoot = path.resolve(__dirname, "../..");
const docsRoot = path.join(repoRoot, "web/docs");
const docsNextBin = path.join(
  docsRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next"
);

const commandName = (command: string): string =>
  process.platform === "win32" ? `${command}.cmd` : command;

const runInstall = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandName("npm"), ["--prefix", "web/docs", "install"], {
      cwd: repoRoot,
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
    output.write(`[${processName}] ${line}\n`);
  });
};

const startProcess = (
  name: string,
  command: string,
  args: readonly string[]
): ManagedProcess => {
  const child = spawn(commandName(command), [...args], {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  prefixOutput(child.stdout, name, process.stdout);
  prefixOutput(child.stderr, name, process.stderr);

  child.once("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
  });

  return { name, child };
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

  processes.push(
    startProcess("docs", "npm", ["--prefix", "web/docs", "run", "dev"]),
    startProcess("desktop", "pnpm", ["--filter", "@lyra/desktop", "dev"])
  );

  for (const processInfo of processes) {
    processInfo.child.once("exit", (code, signal) => {
      if (shuttingDown) {
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
    });
  }
};

process.once("SIGINT", () => shutdown("SIGINT", 130));
process.once("SIGTERM", () => shutdown("SIGTERM", 143));

main().catch((error: unknown) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
