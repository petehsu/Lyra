import { describe, expect, test, vi } from "vitest";

import type {
  LyraRuntimeClient,
  RuntimeEventListener,
  RuntimeRequestHandler
} from "../../runtime-client";
import { createRestartableRuntimeClient } from "../restartable-client";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const fakeClient = (name: string) => {
  const handlers = new Map<string, RuntimeRequestHandler>();
  const listeners = new Set<RuntimeEventListener>();
  const request = vi.fn(async (method: string, _payload: unknown) => `${name}:${method}`);
  const dispose = vi.fn();
  const client: LyraRuntimeClient = {
    request: async <T>(method: string, payload: unknown): Promise<T> =>
      await request(method, payload) as T,
    registerRequestHandler: (method, handler) => {
      handlers.set(method, handler);
    },
    unregisterRequestHandler: (method) => {
      handlers.delete(method);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose
  };
  return {
    client,
    request,
    handlers,
    dispose,
    emit: (event: string, payload: unknown) => {
      for (const listener of listeners) {
        listener(event, payload);
      }
    }
  };
};

describe("restartable runtime client", () => {
  test("preserves host handlers and event listeners across a restart", async () => {
    const first = fakeClient("first");
    const second = fakeClient("second");
    const runtime = createRestartableRuntimeClient(() => first.client);
    const handler = vi.fn();
    const listener = vi.fn();
    runtime.client.registerRequestHandler("host.test", handler);
    runtime.client.subscribe(listener);

    await expect(runtime.client.request("before", {})).resolves.toBe("first:before");
    await runtime.restart(() => second.client);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.handlers.get("host.test")).toBe(handler);

    second.emit("runtime.test", { ok: true });
    expect(listener).toHaveBeenCalledWith("runtime.test", { ok: true });
    await expect(runtime.client.request("after", {})).resolves.toBe("second:after");
    runtime.dispose();
  });

  test("drains an in-flight request and queues new requests behind restart", async () => {
    const first = fakeClient("first");
    const second = fakeClient("second");
    const inFlight = deferred<string>();
    first.request.mockImplementationOnce(() => inFlight.promise);
    const runtime = createRestartableRuntimeClient(() => first.client);

    const pending = runtime.client.request("slow", {});
    const restart = runtime.restart(() => second.client);
    const queued = runtime.client.request("queued", {});
    await Promise.resolve();
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.request).not.toHaveBeenCalled();

    inFlight.resolve("done");
    await expect(pending).resolves.toBe("done");
    await restart;
    await expect(queued).resolves.toBe("second:queued");
    runtime.dispose();
  });

  test("can recover with another factory after replacement creation fails", async () => {
    const first = fakeClient("first");
    const recovered = fakeClient("recovered");
    const runtime = createRestartableRuntimeClient(() => first.client);

    await expect(runtime.restart(() => {
      throw new Error("replacement missing");
    })).rejects.toThrow("replacement missing");

    await runtime.restart(() => recovered.client);
    await expect(runtime.client.request("health", {})).resolves.toBe("recovered:health");
    runtime.dispose();
  });
});
