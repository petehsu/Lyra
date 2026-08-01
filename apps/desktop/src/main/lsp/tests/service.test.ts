import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    }
  };
});

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: electronMock.ipcMain
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../../runtime-client";
import { createLspIpcBridge } from "../service";

const rustDocument = {
  sessionId: "session-1",
  filePath: "/workspace/src/main.rs",
  languageId: "rust" as const,
  content: "fn main() {}",
  version: 1
};

const createRuntimeClient = () => {
  const request = vi.fn(async (_method: string, _payload: unknown): Promise<unknown> =>
    undefined);
  const runtimeClient: LyraRuntimeClient = {
    request: async <T>(method: string, payload: unknown): Promise<T> =>
      await request(method, payload) as T,
    registerRequestHandler: vi.fn(),
    unregisterRequestHandler: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn()
  };
  return { request, runtimeClient };
};

beforeEach(() => {
  electronMock.handlers.clear();
  vi.clearAllMocks();
});

describe("LSP resource leases", () => {
  test("dispatches every Rust request under the rust-analyzer lease", async () => {
    const { request, runtimeClient } = createRuntimeClient();
    const events: string[] = [];
    request.mockImplementation(async (method: string) => {
      events.push(`runtime:${method}`);
      return undefined;
    });
    const withRustAnalyzerResource = async <T>(operation: () => Promise<T>): Promise<T> => {
      events.push("lease:acquire");
      try {
        return await operation();
      } finally {
        events.push("lease:release");
      }
    };
    const bridge = createLspIpcBridge(runtimeClient, () => null, {
      withRustAnalyzerResource
    });

    const calls = [
      [LYRA_CHANNELS.lspOpenDocument, rustDocument],
      [LYRA_CHANNELS.lspChangeDocument, { ...rustDocument, version: 2 }],
      [LYRA_CHANNELS.lspSaveDocument, { ...rustDocument, version: 2 }],
      [LYRA_CHANNELS.lspCompletion, {
        sessionId: rustDocument.sessionId,
        filePath: rustDocument.filePath,
        languageId: rustDocument.languageId,
        line: 0,
        column: 2,
        version: 2
      }],
      [LYRA_CHANNELS.lspCloseDocument, { ...rustDocument, version: 2 }]
    ] as const;
    for (const [channel, payload] of calls) {
      const handler = electronMock.handlers.get(channel);
      expect(handler).toBeDefined();
      await handler?.({}, payload);
    }

    expect(events).toEqual([
      "lease:acquire", "runtime:lsp.documents.open", "lease:release",
      "lease:acquire", "runtime:lsp.documents.change", "lease:release",
      "lease:acquire", "runtime:lsp.documents.save", "lease:release",
      "lease:acquire", "runtime:lsp.completion", "lease:release",
      "lease:acquire", "runtime:lsp.documents.close", "lease:release"
    ]);
    bridge.dispose();
  });

  test("does not lease unrelated language servers", async () => {
    const { request, runtimeClient } = createRuntimeClient();
    const leaseEntered = vi.fn();
    const withRustAnalyzerResource = async <T>(
      operation: () => Promise<T>
    ): Promise<T> => {
      leaseEntered();
      return await operation();
    };
    const bridge = createLspIpcBridge(runtimeClient, () => null, {
      withRustAnalyzerResource
    });
    const handler = electronMock.handlers.get(LYRA_CHANNELS.lspOpenDocument);

    await handler?.({}, {
      ...rustDocument,
      filePath: "/workspace/src/index.ts",
      languageId: "typescript"
    });

    expect(leaseEntered).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "lsp.documents.open",
      expect.objectContaining({ languageId: "typescript" })
    );
    bridge.dispose();
  });

  test("does not reach Runtime when resource activation holds the exclusive lock", async () => {
    const { request, runtimeClient } = createRuntimeClient();
    const pending = Object.assign(new Error("resource update pending"), {
      code: "RESOURCE_COMPONENT_UPDATE_PENDING"
    });
    const bridge = createLspIpcBridge(runtimeClient, () => null, {
      withRustAnalyzerResource: async () => {
        throw pending;
      }
    });
    const handler = electronMock.handlers.get(LYRA_CHANNELS.lspOpenDocument);

    await expect(handler?.({}, rustDocument)).rejects.toBe(pending);
    expect(request).not.toHaveBeenCalled();
    bridge.dispose();
  });
});
