import process from "node:process";

import { createLyraRuntimeClient } from "../runtime-client";
import type { SharedProcessMessage } from "./shared-process-client";

// ─── Utility process 入口 ───────────────────────────────────────────────────
// 在独立进程中创建真正的 LyraRuntimeClient (spawn lyrad + net socket)。
// 通过 process.parentPort 与 main 进程的 proxy 通信。

const storageRoot = process.env.LYRA_SHARED_PROCESS_STORAGE_ROOT;
const agentStorageRoot = process.env.LYRA_SHARED_PROCESS_AGENT_STORAGE_ROOT;
const expectedRuntimeComponentVersion =
  process.env.LYRA_RUNTIME_EXPECTED_COMPONENT_VERSION;

if (storageRoot === undefined || agentStorageRoot === undefined) {
  throw new Error("SharedProcess: storage roots not configured");
}

const client = createLyraRuntimeClient({
  storageRoot,
  agentStorageRoot,
  ...(expectedRuntimeComponentVersion === undefined
    ? {}
    : { expectedComponentVersion: expectedRuntimeComponentVersion })
});

type PendingHostRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

const pendingHostRequests = new Map<string, PendingHostRequest>();

// ponytail: process.parentPort 无 @types 定义，用结构化类型断言
type ParentPort = {
  readonly on: (
    event: "message",
    listener: (event: { readonly data: SharedProcessMessage }) => void
  ) => void;
  readonly postMessage: (message: SharedProcessMessage) => void;
};

const parentPort = (process as unknown as { readonly parentPort: ParentPort }).parentPort;

const post = (msg: SharedProcessMessage): void => {
  parentPort.postMessage(msg);
};

const createHostRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// 事件转发: daemon event → main
client.subscribe((eventName, payload) => {
  post({ type: "event", event: eventName, payload });
});

// 监听来自 main proxy 的消息
parentPort.on("message", (event: { readonly data: SharedProcessMessage }) => {
  const msg = event.data;
  switch (msg.type) {
    case "request": {
      // proxy.request() → 转发给 daemon
      client
        .request<unknown>(msg.method, msg.payload)
        .then((result) => {
          post({ type: "response", id: msg.id, ok: true, result });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          const code =
            error !== null
            && typeof error === "object"
            && typeof (error as { code?: unknown }).code === "string"
              ? (error as { code: string }).code
              : "RUNTIME_REQUEST_FAILED";
          post({ type: "response", id: msg.id, ok: false, error: { code, message } });
        });
      return;
    }
    case "register-handler": {
      // main 注册了 handler → utility 注册 wrapper
      // wrapper 收到 daemon host-request 时转发回 main 执行
      client.registerRequestHandler(msg.method, (payload: unknown) =>
        new Promise<unknown>((resolve, reject) => {
          const hostId = createHostRequestId();
          pendingHostRequests.set(hostId, { resolve, reject });
          post({ type: "host-request", id: hostId, method: msg.method, payload });
        })
      );
      return;
    }
    case "unregister-handler": {
      client.unregisterRequestHandler(msg.method);
      return;
    }
    case "host-response": {
      // main 执行完 handler 后回传结果
      const pending = pendingHostRequests.get(msg.id);
      if (pending === undefined) {
        return;
      }
      pendingHostRequests.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(
          Object.assign(new Error(msg.error?.message ?? "host request failed"), {
            ...(msg.error?.code === undefined ? {} : { code: msg.error.code })
          })
        );
      }
      return;
    }
    case "dispose": {
      client.dispose();
      post({ type: "disposed" });
      return;
    }
  }
});
