import { utilityProcess } from "electron";

import type {
  LyraRuntimeClient,
  RuntimeEventListener,
  RuntimeRequestHandler
} from "../runtime-client";

// ─── Message protocol (shared with shared-process-main.ts) ─────────────────
// ponytail: 双向消息类型。import type 在构建时擦除，utility 入口零运行时依赖。

export type SharedProcessError = {
  readonly code: string;
  readonly message: string;
};

export type SharedProcessMessage =
  // main → utility
  | { readonly type: "request"; readonly id: string; readonly method: string; readonly payload: unknown }
  | { readonly type: "host-response"; readonly id: string; readonly ok: boolean; readonly result?: unknown; readonly error?: SharedProcessError }
  | { readonly type: "register-handler"; readonly method: string }
  | { readonly type: "unregister-handler"; readonly method: string }
  | { readonly type: "dispose" }
  // utility → main
  | { readonly type: "response"; readonly id: string; readonly ok: boolean; readonly result?: unknown; readonly error?: SharedProcessError }
  | { readonly type: "host-request"; readonly id: string; readonly method: string; readonly payload: unknown }
  | { readonly type: "event"; readonly event: string; readonly payload: unknown };

// ─── Proxy ──────────────────────────────────────────────────────────────────

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

const createId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toError = (error: SharedProcessError | undefined, fallback: string): Error =>
  Object.assign(new Error(error?.message ?? fallback), {
    ...(error?.code === undefined ? {} : { code: error.code })
  });

export type SharedProcessClientOptions = {
  readonly modulePath: string;
  readonly storageRoot: string;
  readonly agentStorageRoot: string;
  readonly serviceName?: string;
};

/**
 * 在 main 进程创建 LyraRuntimeClient 的 MessagePort proxy。
 *
 * 数据流:
 *   proxy.request() ──postMessage──→ utility: client.request() ──socket──→ lyrad
 *   proxy.registerHandler() ────────→ utility: client.registerHandler(wrapper)
 *                                        wrapper 把 daemon host-request 转发回 main 执行
 *   proxy.subscribe() ←──event────── utility: client.subscribe() ←──event── lyrad
 *
 * 消费者 (agent/terminal/lsp/performance) 零改动。
 */
export const createSharedProcessClient = (
  options: SharedProcessClientOptions
): LyraRuntimeClient => {
  const proc = utilityProcess.fork(options.modulePath, [], {
    serviceName: options.serviceName ?? "lyra-shared-process",
    env: {
      ...process.env,
      LYRA_SHARED_PROCESS_STORAGE_ROOT: options.storageRoot,
      LYRA_SHARED_PROCESS_AGENT_STORAGE_ROOT: options.agentStorageRoot
    }
  });

  const pendingRequests = new Map<string, PendingRequest>();
  const handlers = new Map<string, RuntimeRequestHandler>();
  const listeners = new Set<RuntimeEventListener>();
  let disposed = false;

  const post = (msg: SharedProcessMessage): void => {
    proc.postMessage(msg);
  };

  // Electron UtilityProcess "message" event passes the raw message directly
  // (not a MessageEvent with .data like parentPort.on in the child side)
  proc.on("message", (msg: SharedProcessMessage) => {
    // UtilityProcess lifecycle 期间可能 emit undefined/null 载荷
    if (typeof msg !== "object" || msg === null) return;
    switch (msg.type) {
      case "response": {
        const pending = pendingRequests.get(msg.id);
        if (pending === undefined) {
          return;
        }
        pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(toError(msg.error, "shared process request failed"));
        }
        return;
      }
      case "host-request": {
        // daemon → utility → main: 在 main 执行真正的 handler（可访问 Electron API）
        const handler = handlers.get(msg.method);
        if (handler === undefined) {
          post({
            type: "host-response",
            id: msg.id,
            ok: false,
            error: {
              code: "RUNTIME_HOST_METHOD_NOT_FOUND",
              message: `No handler registered for ${msg.method}`
            }
          });
          return;
        }
        void Promise.resolve(handler(msg.payload))
          .then((result) => {
            post({ type: "host-response", id: msg.id, ok: true, result });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            const code =
              error !== null
              && typeof error === "object"
              && typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : "RUNTIME_HOST_REQUEST_FAILED";
            post({
              type: "host-response",
              id: msg.id,
              ok: false,
              error: { code, message }
            });
          });
        return;
      }
      case "event": {
        for (const listener of listeners) {
          listener(msg.event, msg.payload);
        }
        return;
      }
    }
  });

  proc.on("exit", () => {
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error("Shared process exited unexpectedly"));
    }
    pendingRequests.clear();
  });

  return {
    request: <T>(method: string, payload: unknown): Promise<T> => {
      if (disposed) {
        return Promise.reject(new Error("Shared process client already disposed"));
      }
      const id = createId();
      return new Promise<T>((resolve, reject) => {
        pendingRequests.set(id, {
          resolve: (value) => resolve(value as T),
          reject
        });
        post({ type: "request", id, method, payload });
      });
    },
    registerRequestHandler: (method: string, handler: RuntimeRequestHandler) => {
      handlers.set(method, handler);
      post({ type: "register-handler", method });
    },
    unregisterRequestHandler: (method: string) => {
      handlers.delete(method);
      post({ type: "unregister-handler", method });
    },
    subscribe: (listener: RuntimeEventListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      post({ type: "dispose" });
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error("Shared process client disposed"));
      }
      pendingRequests.clear();
      handlers.clear();
      listeners.clear();
      if (proc.pid !== undefined) {
        proc.kill();
      }
    }
  };
};