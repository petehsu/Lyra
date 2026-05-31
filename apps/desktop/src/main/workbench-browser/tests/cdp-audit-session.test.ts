import { describe, expect, test, vi } from "vitest";

import { createCdpAuditSession } from "../cdp-audit-session";
import type {
  WorkbenchBrowserDebuggerEvent,
  WorkbenchBrowserDebuggerSession
} from "../types";

const createFakeDebuggerSession = () => {
  const listeners = new Set<(event: WorkbenchBrowserDebuggerEvent) => void>();
  const sentCommands: string[] = [];
  const session: WorkbenchBrowserDebuggerSession = {
    tabId: "page-1",
    pageAddress: "http://localhost:5173/",
    sendCommand: vi.fn(async (method: string) => {
      sentCommands.push(method);
      if (method === "Network.getResponseBody") {
        return {
          body: "{\"error\":\"server exploded\"}",
          base64Encoded: false
        };
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            value: {
              navigation: {
                domContentLoadedMs: 12,
                loadMs: 40,
                resourceCount: 3
              },
              longTasks: [{ duration: 80 }]
            }
          }
        };
      }
      return {};
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    focus: vi.fn(),
    close: vi.fn(async () => undefined)
  };
  return {
    session,
    sentCommands,
    emit: (method: string, params: unknown) => {
      for (const listener of listeners) {
        listener({ kind: "message", method, params });
      }
    }
  };
};

describe("CdpAuditSession", () => {
  test("enables CDP domains and exposes runtime and network diagnostics", async () => {
    const fake = createFakeDebuggerSession();
    const emitted: unknown[] = [];
    const audit = createCdpAuditSession({
      tabId: "page-1",
      targetMode: "live",
      acquireDebugger: async () => fake.session,
      onDiagnostic: (entry) => {
        emitted.push(entry);
      }
    });

    await expect(audit.start()).resolves.toEqual({ available: true });
    expect(fake.sentCommands).toEqual(expect.arrayContaining([
      "Runtime.enable",
      "Log.enable",
      "Network.enable",
      "Page.enable",
      "DOM.enable",
      "Accessibility.enable"
    ]));

    fake.emit("Runtime.exceptionThrown", {
      timestamp: 1_765_000_000_000,
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "Error: client crashed" },
        url: "http://localhost:5173/src/App.tsx",
        lineNumber: 4,
        columnNumber: 10,
        stackTrace: {
          callFrames: [{
            functionName: "App",
            url: "http://localhost:5173/src/App.tsx",
            lineNumber: 4,
            columnNumber: 10
          }]
        }
      }
    });
    fake.emit("Network.requestWillBeSent", {
      requestId: "req-500",
      request: {
        url: "http://localhost:5173/api/users",
        method: "GET",
        headers: { Authorization: "secret" }
      }
    });
    fake.emit("Network.responseReceived", {
      requestId: "req-500",
      response: {
        url: "http://localhost:5173/api/users",
        status: 500,
        statusText: "Internal Server Error",
        mimeType: "application/json",
        headers: { "Content-Type": "application/json" }
      }
    });
    fake.emit("Network.loadingFinished", { requestId: "req-500" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = await audit.readDiagnostics({ maxEntries: 20 });
    expect(snapshot.available).toBe(true);
    expect(snapshot.summary.runtimeExceptions).toBe(1);
    expect(snapshot.summary.httpFailures).toBe(1);
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "runtime",
        message: "Error: client crashed",
        line: 5
      }),
      expect.objectContaining({
        source: "network",
        status: 500,
        failureKind: "http",
        responseBody: "{\"error\":\"server exploded\"}",
        requestHeaders: expect.objectContaining({
          Authorization: "[redacted]"
        })
      })
    ]));
    expect(emitted.length).toBeGreaterThanOrEqual(2);
  });

  test("reports unavailableReason when debugger attach fails", async () => {
    const audit = createCdpAuditSession({
      tabId: "page-1",
      targetMode: "live",
      acquireDebugger: async () => {
        throw new Error("debugger denied");
      },
      onDiagnostic: vi.fn()
    });

    await expect(audit.readDiagnostics()).resolves.toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining("debugger denied"),
      entries: []
    });
  });
});
