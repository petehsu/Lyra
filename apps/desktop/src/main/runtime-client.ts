import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { resolveNativeResourceCandidates } from "./native-resource-paths";

const PROTOCOL_VERSION = 1;
const HANDSHAKE_METHOD = "runtime.handshake";

type RuntimeError = {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
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
export type RuntimeRequestHandler = (payload: unknown) => Promise<unknown> | unknown;

export type LyraRuntimeClientOptions = {
  readonly storageRoot: string;
};

export type LyraRuntimeClient = {
  readonly request: <T>(method: string, payload: unknown) => Promise<T>;
  readonly registerRequestHandler: (method: string, handler: RuntimeRequestHandler) => void;
  readonly unregisterRequestHandler: (method: string) => void;
  readonly subscribe: (listener: RuntimeEventListener) => () => void;
  readonly dispose: () => void;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const resolveSocketPath = (storageRoot: string): string => {
  if (process.platform === "win32") {
    const key = storageRoot.replace(/[^a-zA-Z0-9]/g, "_");
    return `\\\\.\\pipe\\lyra-runtime-${key}`;
  }
  return path.join(storageRoot, "runtime", "lyrad.sock");
};

const resolveRuntimeBinaryName = (): string =>
  process.platform === "win32" ? "lyrad.exe" : "lyrad";

export const resolveRuntimeBinaryCandidates = (cwd: string): readonly string[] =>
  resolveNativeResourceCandidates({
    cwd,
    moduleDir: __dirname,
    envVar: "LYRA_RUNTIME_BIN",
    fileNames: [resolveRuntimeBinaryName()],
  });

const resolveRuntimeBinaryPath = (): string => {
  const candidates = resolveRuntimeBinaryCandidates(process.cwd());
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`lyrad binary not found; tried paths:\n${candidates.join("\n")}`);
};

const resolveRuntimeWorkingDirectory = (): string => {
  return os.homedir();
};

const toError = (error: RuntimeError | undefined, fallback: string): Error =>
  Object.assign(new Error(error?.message ?? fallback), {
    ...(error?.code === undefined ? {} : { code: error.code }),
    ...(error?.details === undefined ? {} : { details: error.details })
  });

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
  const requestHandlers = new Map<string, RuntimeRequestHandler>();
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
    if (envelope.kind === "request") {
      const handler = requestHandlers.get(envelope.method);
      if (handler === undefined) {
        try {
          writeEnvelope({
            kind: "response",
            id: envelope.id,
            ok: false,
            error: {
              code: "RUNTIME_HOST_METHOD_NOT_FOUND",
              message: `No runtime host handler registered for ${envelope.method}`
            }
          });
        } catch (error) {
          console.warn("[lyra-runtime] failed to reply to runtime host request", error);
        }
        return;
      }

      void Promise.resolve(handler(envelope.payload))
        .then((result) => {
          writeEnvelope({
            kind: "response",
            id: envelope.id,
            ok: true,
            result
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const code =
            error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : "RUNTIME_HOST_REQUEST_FAILED";
          const details =
            error !== null && typeof error === "object" && "details" in (error as Record<string, unknown>)
              ? (error as { details?: unknown }).details
              : undefined;
          try {
            writeEnvelope({
              kind: "response",
              id: envelope.id,
              ok: false,
              error: {
                code,
                message,
                ...(details === undefined ? {} : { details })
              }
            });
          } catch (writeError) {
            console.warn("[lyra-runtime] failed to reply to runtime host request", writeError);
          }
        });
      return;
    }

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
      cwd: resolveRuntimeWorkingDirectory(),
      stdio: "pipe",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "",
        LYRA_JS_REPL_NODE_PATH: process.execPath,
        LYRA_JS_REPL_NODE_RUN_AS_NODE: "1"
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
    registerRequestHandler: (method: string, handler: RuntimeRequestHandler) => {
      requestHandlers.set(method, handler);
    },
    unregisterRequestHandler: (method: string) => {
      requestHandlers.delete(method);
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
      requestHandlers.clear();
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
