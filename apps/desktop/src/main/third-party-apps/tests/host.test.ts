import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;

  let nextWebContentsId = 40;
  const views: FakeWebContentsView[] = [];
  const sessions: FakeSession[] = [];
  const ipcHandlers = new Map<string, (...args: any[]) => unknown>();

  class FakeWebContents {
    readonly id = nextWebContentsId++;
    readonly listeners = new Map<string, Set<Listener>>();
    readonly loadURL = vi.fn(async () => undefined);
    readonly close = vi.fn();
    readonly setWindowOpenHandler = vi.fn();

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: Listener): this {
      this.listeners.get(event)?.delete(listener);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  class FakeWebContentsView {
    readonly webContents = new FakeWebContents();
    readonly setBounds = vi.fn();
    readonly setVisible = vi.fn();

    constructor(readonly options: Record<string, any>) {
      views.push(this);
    }
  }

  class FakeSession {
    beforeRequest: Listener | null = null;
    permissionRequest: Listener | null = null;
    permissionCheck: Listener | null = null;
    devicePermission: Listener | null = null;
    readonly listeners = new Map<string, Set<Listener>>();
    readonly webRequest = {
      onBeforeRequest: vi.fn((filterOrListener: unknown, listener?: Listener) => {
        this.beforeRequest = filterOrListener === null ? null : (listener ?? filterOrListener as Listener);
      })
    };
    readonly setPermissionRequestHandler = vi.fn((listener: Listener | null) => {
      this.permissionRequest = listener;
    });
    readonly setPermissionCheckHandler = vi.fn((listener: Listener | null) => {
      this.permissionCheck = listener;
    });
    readonly setDevicePermissionHandler = vi.fn((listener: Listener | null) => {
      this.devicePermission = listener;
    });
    readonly setDisplayMediaRequestHandler = vi.fn();

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: Listener): this {
      this.listeners.get(event)?.delete(listener);
      return this;
    }
  }

  return {
    views,
    sessions,
    ipcHandlers,
    WebContentsView: FakeWebContentsView,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
        ipcHandlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        ipcHandlers.delete(channel);
      })
    },
    session: {
      fromPartition: vi.fn((_partition: string, _options: unknown) => {
        const fakeSession = new FakeSession();
        sessions.push(fakeSession);
        return fakeSession;
      })
    }
  };
});

vi.mock("electron", () => electronMock);

import { createThirdPartyAppHost, isThirdPartyAppsEnabled } from "../host";

const temporaryDirectories: string[] = [];

afterEach(() => {
  electronMock.views.splice(0);
  electronMock.sessions.splice(0);
  electronMock.ipcHandlers.clear();
  vi.clearAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createFixture = (): { readonly root: string; readonly entry: string } => {
  const root = mkdtempSync(join(tmpdir(), "lyra-third-party-host-"));
  const entry = join(root, "index.html");
  writeFileSync(entry, "<!doctype html>");
  temporaryDirectories.push(root);
  return { root, entry };
};

describe("third-party application host", () => {
  test("is opt-in and creates a locked-down WebContentsView", async () => {
    expect(isThirdPartyAppsEnabled({})).toBe(false);
    expect(isThirdPartyAppsEnabled({ LYRA_ENABLE_THIRD_PARTY_APPS: "1" })).toBe(true);
    const fixture = createFixture();
    expect(() => createThirdPartyAppHost({
      appId: "example.notes",
      instanceId: "instance-1",
      appRoot: fixture.root,
      entryFile: fixture.entry,
      preloadPath: "/test/third-party-app.cjs"
    })).toThrow("disabled");

    const host = createThirdPartyAppHost({
      appId: "example.notes",
      instanceId: "instance-1",
      appRoot: fixture.root,
      entryFile: fixture.entry,
      featureEnabled: true,
      preloadPath: "/test/third-party-app.cjs"
    });
    const view = electronMock.views[0]!;
    const preferences = view.options.webPreferences;

    expect(preferences).toMatchObject({
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      partition: host.partition,
      preload: "/test/third-party-app.cjs",
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    });
    expect(host.partition.startsWith("persist:")).toBe(false);
    expect(preferences).not.toHaveProperty("enableRemoteModule");

    await host.load();
    expect(view.webContents.loadURL).toHaveBeenCalledWith(
      pathToFileURL(realpathSync(fixture.entry)).toString()
    );
    host.dispose();
    expect(view.webContents.close).toHaveBeenCalledOnce();
  });

  test("blocks ungranted requests, permissions, navigation, downloads, and RPC", async () => {
    const fixture = createFixture();
    const host = createThirdPartyAppHost({
      appId: "example.notes",
      instanceId: "instance-2",
      appRoot: fixture.root,
      entryFile: fixture.entry,
      featureEnabled: true,
      preloadPath: "/test/third-party-app.cjs"
    });
    const view = electronMock.views[0]!;
    const isolatedSession = electronMock.sessions[0]!;
    const request = (url: string): boolean => {
      let cancelled = false;
      isolatedSession.beforeRequest?.({ url }, (response: { cancel: boolean }) => {
        cancelled = response.cancel;
      });
      return cancelled;
    };

    expect(request(pathToFileURL(fixture.entry).toString())).toBe(false);
    expect(request("https://example.test/private")).toBe(true);

    for (const permission of ["clipboard-read", "clipboard-sanitized-write", "fileSystem"]) {
      let granted = true;
      isolatedSession.permissionRequest?.(view.webContents, permission, (value: boolean) => {
        granted = value;
      });
      expect(granted).toBe(false);
    }

    const navigationEvent = { preventDefault: vi.fn() };
    view.webContents.emit("will-navigate", navigationEvent, "https://example.test/");
    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();
    expect(view.webContents.setWindowOpenHandler.mock.calls[0]?.[0]({ url: "https://example.test" })).toEqual({ action: "deny" });

    const downloadEvent = { preventDefault: vi.fn() };
    for (const listener of isolatedSession.listeners.get("will-download") ?? []) {
      listener(downloadEvent);
    }
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce();

    const rpcHandler = [...electronMock.ipcHandlers.values()][0]!;
    await expect(rpcHandler(
      { sender: view.webContents },
      { method: "host.context", payload: null }
    )).resolves.toEqual({ appId: "example.notes", instanceId: "instance-2" });
    await expect(rpcHandler(
      { sender: view.webContents },
      { method: "core.private", payload: null }
    )).rejects.toThrow("not available");
    await expect(rpcHandler(
      { sender: { id: 999 } },
      { method: "host.context", payload: null }
    )).rejects.toThrow("denied");

    host.dispose();
    expect(electronMock.ipcHandlers.size).toBe(0);
    expect(isolatedSession.beforeRequest).toBeNull();
  });
});
