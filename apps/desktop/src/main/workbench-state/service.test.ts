import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
}));

import { createWorkbenchStateIpcBridge } from "./service";

describe("Workbench state IPC bridge", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(path.join(tmpdir(), "lyra-workbench-state-"));
    electronMock.ipcMain.on.mockClear();
    electronMock.ipcMain.removeListener.mockClear();
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  test("persists browser session state through the shared workbench state bridge", () => {
    const bridge = createWorkbenchStateIpcBridge(storageRoot);
    const snapshot = JSON.stringify({
      schemaVersion: 1,
      snapshotId: "browser-session-1",
      activeTabId: "browser-tab-1",
      tabs: []
    });
    const events: Array<{ readonly key: string; readonly json: string | null }> = [];
    const unsubscribe = bridge.subscribe((event) => events.push(event));

    bridge.writeState("browser-session", snapshot);

    expect(bridge.readState("browser-session")).toBe(snapshot);
    expect(events).toEqual([{ key: "browser-session", json: snapshot }]);

    unsubscribe();
    bridge.dispose();

    const reloadedBridge = createWorkbenchStateIpcBridge(storageRoot);
    expect(reloadedBridge.readState("browser-session")).toBe(snapshot);
    reloadedBridge.dispose();
  });
});
