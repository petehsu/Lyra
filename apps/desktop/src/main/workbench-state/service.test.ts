import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}));

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain
}));

import { createWorkbenchStateIpcBridge } from "./service";

describe("Workbench state IPC bridge", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(path.join(tmpdir(), "lyra-workbench-state-"));
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.on.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    electronMock.ipcMain.removeListener.mockClear();
    electronMock.BrowserWindow.getAllWindows.mockClear();
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  test("persists browser session state through the shared workbench state bridge", async () => {
    const bridge = await createWorkbenchStateIpcBridge(storageRoot);
    const snapshot = JSON.stringify({
      schemaVersion: 1,
      snapshotId: "browser-session-1",
      activeTabId: "browser-tab-1",
      tabs: []
    });
    const events: Array<{ readonly key: string; readonly json: string | null }> = [];
    const unsubscribe = bridge.subscribe((event) => events.push(event));

    bridge.writeState("browser-session", snapshot);
    await bridge.flush();

    expect(bridge.readState("browser-session")).toBe(snapshot);
    expect(events).toEqual([{ key: "browser-session", json: snapshot }]);

    unsubscribe();
    bridge.dispose();

    const reloadedBridge = await createWorkbenchStateIpcBridge(storageRoot);
    expect(reloadedBridge.readState("browser-session")).toBe(snapshot);
    reloadedBridge.dispose();
  });

  test("quarantines corrupt state files instead of silently reusing them", async () => {
    const filePath = path.join(storageRoot, "browser-session.v1.json");
    writeFileSync(filePath, "{ not-json", "utf8");

    const bridge = await createWorkbenchStateIpcBridge(storageRoot);

    expect(bridge.readState("browser-session")).toBeNull();
    expect(existsSync(filePath)).toBe(false);
    expect(readFileSync(`${filePath}.corrupt`, "utf8")).toBe("{ not-json");
    bridge.dispose();
  });
});
