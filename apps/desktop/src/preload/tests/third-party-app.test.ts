import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  contextBridge: {
    exposeInMainWorld: vi.fn()
  },
  ipcRenderer: {
    invoke: vi.fn(async () => ({ ok: true }))
  }
}));

vi.mock("electron", () => electronMock);

const originalArgv = [...process.argv];
const channel = "lyra:third-party-app:0123456789abcdef0123456789abcdef";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = [...originalArgv, `--lyra-third-party-rpc-channel=${channel}`];
});

afterEach(() => {
  process.argv = [...originalArgv];
});

describe("third-party application preload", () => {
  test("exposes only the narrow window.lyra RPC surface", async () => {
    await import("../third-party-app");

    expect(electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledOnce();
    const [globalName, api] = electronMock.contextBridge.exposeInMainWorld.mock.calls[0]!;
    expect(globalName).toBe("lyra");
    expect(Object.keys(api as object)).toEqual(["invoke"]);
    expect(api).not.toHaveProperty("ipcRenderer");
    expect(api).not.toHaveProperty("lyraDesktop");

    await (api as { invoke: (method: string, payload: unknown) => Promise<unknown> })
      .invoke("host.context", null);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(channel, {
      method: "host.context",
      payload: null
    });
  });

  test("fails closed without an authenticated per-instance channel", async () => {
    process.argv = [...originalArgv];
    await import("../third-party-app");
    expect(electronMock.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
  });
});
