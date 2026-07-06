import { describe, expect, test, vi } from "vitest";

import type { SharedProcessMessage } from "../shared-process-client";

// ─── Fake utility process ───────────────────────────────────────────────────
// 模拟 Electron UtilityProcess 的消息收发，不启动真实进程

type MessageHandler = (msg: SharedProcessMessage) => void;
type ExitHandler = () => void;

const createFakeUtilityProcess = () => {
  const sent: SharedProcessMessage[] = [];
  let messageHandler: MessageHandler | null = null;
  let exitHandler: ExitHandler | null = null;
  let killed = false;
  const pid = 42;

  const fakeProc = {
    pid,
    postMessage: vi.fn((msg: SharedProcessMessage) => {
      sent.push(msg);
    }),
    on: vi.fn((event: string, handler: MessageHandler | ExitHandler) => {
      if (event === "message") {
        messageHandler = handler as MessageHandler;
      } else if (event === "exit") {
        exitHandler = handler as ExitHandler;
      }
    }),
    kill: vi.fn(() => {
      killed = true;
    }),
  };

  // 从 "utility" 向 main 发送消息（Electron UtilityProcess message 事件传裸消息）
  const emitFromUtility = (msg: SharedProcessMessage): void => {
    messageHandler?.(msg);
  };

  const emitExit = (): void => {
    exitHandler?.();
  };

  const lastSent = (): SharedProcessMessage => sent[sent.length - 1]!;

  const findSent = (type: string): SharedProcessMessage | undefined =>
    sent.find((m) => m.type === type);

  return { fakeProc, sent, emitFromUtility, emitExit, lastSent, findSent, get killed() { return killed; } };
};

const electronMock = vi.hoisted(() => ({
  utilityProcess: { fork: vi.fn() },
}));

vi.mock("electron", () => ({
  utilityProcess: electronMock.utilityProcess,
}));

// 延迟导入，确保 mock 先生效
const { createSharedProcessClient } = await import("../shared-process-client");

describe("shared-process-client", () => {
  test("request 转发到 utility 并返回 response", async () => {
    const { fakeProc, emitFromUtility, findSent } = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    const promise = client.request<number>("test.method", { foo: 1 });

    // proxy 应该发送 request 消息
    const sent = findSent("request");
    expect(sent).toBeDefined();
    expect(sent?.type).toBe("request");
    if (sent?.type === "request") {
      expect(sent.method).toBe("test.method");
      expect(sent.payload).toEqual({ foo: 1 });
    }

    // 模拟 utility 回复
    if (sent?.type === "request") {
      emitFromUtility({ type: "response", id: sent.id, ok: true, result: 42 });
    }

    await expect(promise).resolves.toBe(42);
    client.dispose();
  });

  test("request error 正确传播", async () => {
    const { fakeProc, emitFromUtility, findSent } = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    const promise = client.request("fail.method", {});
    const sent = findSent("request");

    if (sent?.type === "request") {
      emitFromUtility({
        type: "response",
        id: sent.id,
        ok: false,
        error: { code: "TEST_ERROR", message: "boom" },
      });
    }

    await expect(promise).rejects.toThrow("boom");
    client.dispose();
  });

  test("registerRequestHandler → host-request 转发回 main 执行", async () => {
    const { fakeProc, emitFromUtility, findSent, sent } = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    const handler = vi.fn((payload: unknown) => Promise.resolve({ echoed: payload }));
    client.registerRequestHandler("host.test", handler);

    // proxy 应该通知 utility 注册 handler
    expect(findSent("register-handler")?.type).toBe("register-handler");

    // 模拟 utility 转发 daemon 的 host-request
    emitFromUtility({
      type: "host-request",
      id: "host-1",
      method: "host.test",
      payload: { input: "hello" },
    });

    // 等待异步 handler 执行
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalledWith({ input: "hello" });

    // proxy 应该回传 host-response
    const hostResponse = sent.find(
      (m) => m.type === "host-response" && (m as { id?: string }).id === "host-1"
    );
    expect(hostResponse).toBeDefined();
    if (hostResponse?.type === "host-response") {
      expect(hostResponse.ok).toBe(true);
      expect(hostResponse.result).toEqual({ echoed: { input: "hello" } });
    }

    client.dispose();
  });

  test("subscribe 接收 utility 转发的 event", () => {
    const { fakeProc, emitFromUtility } = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    const listener = vi.fn();
    client.subscribe(listener);

    emitFromUtility({ type: "event", event: "agent.runtime", payload: { kind: "test" } });

    expect(listener).toHaveBeenCalledWith("agent.runtime", { kind: "test" });
    client.dispose();
  });

  test("dispose 发送 dispose 消息并 kill 进程", () => {
    const ctx = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(ctx.fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    client.dispose();

    expect(ctx.findSent("dispose")?.type).toBe("dispose");
    expect(ctx.killed).toBe(true);
  });

  test("utility 进程退出时 reject 所有 pending requests", async () => {
    const { fakeProc, emitFromUtility, emitExit, findSent } = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    const promise = client.request("pending.method", {});
    const sent = findSent("request");

    // utility 进程意外退出
    emitExit();

    await expect(promise).rejects.toThrow("Shared process exited unexpectedly");
  });

  test("undefined 消息载荷不抛异常", () => {
    const { fakeProc, emitFromUtility } = createFakeUtilityProcess();
    electronMock.utilityProcess.fork.mockReturnValue(fakeProc);

    const client = createSharedProcessClient({
      modulePath: "/fake/shared-process.cjs",
      storageRoot: "/tmp/storage",
      agentStorageRoot: "/tmp/agent",
    });

    // UtilityProcess lifecycle 期间可能 emit undefined 裸载荷
    expect(() =>
      emitFromUtility(undefined as unknown as SharedProcessMessage)
    ).not.toThrow();
    client.dispose();
  });
});