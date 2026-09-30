import { beforeEach, describe, expect, test, vi } from "vitest";
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());
vi.mock("electron", () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler),
  removeHandler: (channel: string) => handlers.delete(channel)
} }));
import { createSoftwareCapabilityHost } from "../software-capability-host";
import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";

describe("pushed software catalog", () => {
  beforeEach(() => handlers.clear());
  test("accepts only the active renderer and invalidates when its window changes", async () => {
    const send = vi.fn();
    let window = { isDestroyed: () => false, webContents: { send } };
    const host = createSoftwareCapabilityHost({ getWindow: () => window as never });
    const publish = handlers.get(LYRA_CHANNELS.softwareCapabilitiesSnapshot)!;
    const manifest = { id: "test", title: "Test", actions: [{ id: "read", inputSchema: { type: "object" } }] };
    publish({ sender: {} }, [manifest]);
    expect(host.snapshot().hostCapabilityAvailable).toBe(false);
    publish({ sender: window.webContents }, [manifest]);
    expect(host.snapshot().software).toEqual([manifest]);
    const result = await host.handlers["software.listCapabilities"]!({ includeSchemas: false });
    expect(result).toMatchObject({ software: [{ actions: [{ id: "read" }] }] });
    expect(JSON.stringify(result)).not.toContain("inputSchema");
    expect(send).not.toHaveBeenCalled();
    publish({ sender: window.webContents }, []);
    expect(host.snapshot().software).toEqual([]);
    publish({ sender: window.webContents }, [manifest]);
    window = { isDestroyed: () => false, webContents: { send } };
    expect(host.snapshot()).toEqual({ software: [], hostCapabilityAvailable: false });
    host.dispose();
    expect(handlers.has(LYRA_CHANNELS.softwareCapabilitiesSnapshot)).toBe(false);
  });
});
