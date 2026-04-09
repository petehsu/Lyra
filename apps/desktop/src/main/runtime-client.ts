import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const HANDSHAKE_METHOD = "runtime.handshake";

type RuntimeError = {
  readonly code: string;
  readonly message: string;
};

type RuntimeEnvelope =
  | {
      readonly kind: "request";
      readonly id: string;
      readonly method: string;
      readonly payload: unknown;
    }
  | {
      readonly kind: "response";
      readonly id: string;
      readonly ok: boolean;
      readonly result?: unknown;
      readonly error?: RuntimeError;
    }
  | {
      readonly kind: "event";
      readonly event: string;
      readonly payload: unknown;
    };

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

export type RuntimeEventListener = (event: string, payload: unknown) => void;

export type LyraRuntimeClientOptions = {
  readonly storageRoot: string;
};

export type LyraRuntimeClient = {
  readonly request: <T>(method: string, payload: unknown) => Promise<T>;
  readonly subscribe: (listener: RuntimeEventListener) => () => void;
  readonly dispose: () => void;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const resolveSocketPath = (storageRoot: string): string => {
  if (process.platform === "win32") {
    const key = storageRoot.replace(/[^a-zA-Z0-9]/g, "_");
    return `\\\\.\\pipe\\lyra-ai-${key}`;
  }
  return path.join(storageRoot, "runtime", "lyrad.sock");
};

const resolveRuntimeBinaryName = (): string =>
  process.platform === "win32" ? "lyrad.exe" : "lyrad";

const resolveBaseRoots = (cwd: string): readonly string[] => {
  const runtimeDir = typeof __dirname === "string" ? __dirname : cwd;
  return Array.from(
    new Set([
      path.resolve(cwd),
      path.resolve(runtimeDir),
      path.resolve(runtimeDir, ".."),
      path.resolve(runtimeDir, "../.."),
      path.resolve(runtimeDir, "../../.."),
      path.resolve(runtimeDir, "../../../.."),
      path.resolve(runtimeDir, "../../../../..")
    ])
  );
};

const resolveRuntimeBinaryCandidates = (cwd: string): readonly string[] => {
  const binaryName = resolveRuntimeBinaryName();
  const baseRoots = resolveBaseRoots(cwd);
  const candidates: string[] = [];

  for (const baseRoot of baseRoots) {
    candidates.push(path.join(baseRoot, "target/debug", binaryName));
    candidates.push(path.join(baseRoot, "target/release", binaryName));
    candidates.push(path.join(baseRoot, "apps/desktop/native", binaryName));
  }

  const explicit = process.env.LYRA_RUNTIME_BIN;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    candidates.unshift(path.resolve(cwd, explicit.trim()));
  }

  return Array.from(new Set(candidates));
};

const resolveRuntimeBinaryPath = (): string => {
  const candidates = resolveRuntimeBinaryCandidates(process.cwd());
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`lyrad binary not found; tried paths:\n${candidates.join("\n")}`);
};

const toError = (error: RuntimeError | undefined, fallback: string): Error =>
  new Error(error?.message ?? fallback);

const createSocket = (socketPath: string): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.removeListener("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });

const ensureSocketParent = (socketPath: string): void => {
  if (process.platform === "win32") {
    return;
  }
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
};

const createRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createLyraRuntimeClient = (
  options: LyraRuntimeClientOptions
): LyraRuntimeClient => {
  const socketPath = resolveSocketPath(options.storageRoot);
  ensureSocketParent(socketPath);
  const binaryPath = resolveRuntimeBinaryPath();
  const pending = new Map<string, PendingRequest>();
  const listeners = new Set<RuntimeEventListener>();
  let socket: net.Socket | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let disposed = false;
  let startPromise: Promise<void> | null = null;

  const writeEnvelope = (envelope: RuntimeEnvelope): void => {
    if (socket === null || socket.destroyed) {
      throw new Error("Lyra runtime socket is not connected");
    }
    socket.write(`${JSON.stringify(envelope)}\n`);
  };

  const rejectAllPending = (reason: string): void => {
    for (const entry of pending.values()) {
      entry.reject(new Error(reason));
    }
    pending.clear();
  };

  const sendRequestUnsafe = async <T>(method: string, payload: unknown): Promise<T> => {
    const id = createRequestId();
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    writeEnvelope({ kind: "request", id, method, payload });
    return await promise as T;
  };

  const handleEnvelope = (envelope: RuntimeEnvelope): void => {
    if (envelope.kind === "response") {
      const pendingRequest = pending.get(envelope.id);
      if (pendingRequest === undefined) {
        return;
      }
      pending.delete(envelope.id);
      if (envelope.ok) {
        pendingRequest.resolve(envelope.result);
      } else {
        pendingRequest.reject(toError(envelope.error, "runtime request failed"));
      }
      return;
    }

    if (envelope.kind === "event") {
      for (const listener of listeners) {
        listener(envelope.event, envelope.payload);
      }
    }
  };

  const attachSocket = (connected: net.Socket): void => {
    socket = connected;
    connected.setEncoding("utf8");
    connected.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim().length === 0) {
          continue;
        }
        try {
          handleEnvelope(JSON.parse(part) as RuntimeEnvelope);
        } catch (error) {
          console.warn("[lyra-runtime] failed to decode runtime envelope", error);
        }
      }
    });
    connected.on("close", () => {
      socket = null;
      buffer = "";
      startPromise = null;
      if (disposed) {
        return;
      }
      rejectAllPending("Lyra runtime socket closed");
      console.warn("[lyra-runtime] runtime socket closed");
    });
    connected.on("error", (error) => {
      if (disposed) {
        return;
      }
      console.warn("[lyra-runtime] runtime socket error", error);
    });
  };

  const spawnDaemon = (): void => {
    if (child !== null && child.exitCode === null && child.killed === false) {
      return;
    }

    child = spawn(binaryPath, ["--socket", socketPath], {
      stdio: "pipe",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: ""
      }
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text.length > 0) {
        console.info(`[lyrad] ${text}`);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text.length > 0) {
        console.warn(`[lyrad] ${text}`);
      }
    });
    child.once("exit", (code, signal) => {
      if (disposed) {
        return;
      }
      child = null;
      socket = null;
      startPromise = null;
      rejectAllPending("Lyra runtime daemon exited");
      console.warn(
        `[lyra-runtime] runtime daemon exited code=${code ?? "null"} signal=${signal ?? "null"}`
      );
    });
  };

  const ensureStarted = async (): Promise<void> => {
    if (disposed) {
      throw new Error("Lyra runtime client already disposed");
    }
    if (socket !== null && socket.destroyed === false) {
      return;
    }
    if (startPromise !== null) {
      await startPromise;
      return;
    }

    startPromise = (async () => {
      spawnDaemon();

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const connected = await createSocket(socketPath);
          attachSocket(connected);
          const handshake = await sendRequestUnsafe<{ readonly protocolVersion: number }>(
            HANDSHAKE_METHOD,
            {
              protocolVersion: PROTOCOL_VERSION,
              clientName: `desktop-${os.hostname()}`
            }
          );
          if (handshake.protocolVersion !== PROTOCOL_VERSION) {
            throw new Error(
              `Lyra runtime protocol mismatch: expected ${PROTOCOL_VERSION}, got ${handshake.protocolVersion}`
            );
          }
          console.info(`[lyra-runtime] runtime daemon connected socket=${socketPath}`);
          return;
        } catch (error) {
          lastError = error;
          socket?.destroy();
          socket = null;
          await sleep(100);
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(`failed to connect to runtime socket ${socketPath}`);
    })();

    try {
      await startPromise;
    } finally {
      if (socket === null || socket.destroyed) {
        startPromise = null;
      }
    }
  };

  return {
    request: async <T>(method: string, payload: unknown): Promise<T> => {
      await ensureStarted();
      return await sendRequestUnsafe<T>(method, payload);
    },
    subscribe: (listener: RuntimeEventListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
      rejectAllPending("Lyra runtime client disposed");
      socket?.destroy();
      socket = null;
      startPromise = null;
      if (child !== null && child.killed === false) {
        child.kill();
      }
      child = null;
    }
  };
};
