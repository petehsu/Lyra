import type { App } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const autoUpdaterMock = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: false,
  checkForUpdatesAndNotify: vi.fn<() => Promise<void>>(),
  off: vi.fn(),
  on: vi.fn(),
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import {
  createAutoUpdateService,
  isSignedCoreAutoUpdateEnabled,
  SIGNED_CORE_UPDATE_FLAG,
} from "./service";

const packagedApp = { isPackaged: true } as App;
const developmentApp = { isPackaged: false } as App;

const flushMicrotasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
};

describe("Core auto-update release gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoUpdaterMock.autoDownload = false;
    autoUpdaterMock.autoInstallOnAppQuit = false;
    autoUpdaterMock.checkForUpdatesAndNotify.mockResolvedValue(undefined);
    delete process.env[SIGNED_CORE_UPDATE_FLAG];
  });

  afterEach(() => {
    delete process.env[SIGNED_CORE_UPDATE_FLAG];
  });

  test("requires both a packaged app and the exact signed-release opt-in", () => {
    expect(isSignedCoreAutoUpdateEnabled(packagedApp, {})).toBe(false);
    expect(isSignedCoreAutoUpdateEnabled(packagedApp, {
      [SIGNED_CORE_UPDATE_FLAG]: "true",
    })).toBe(false);
    expect(isSignedCoreAutoUpdateEnabled(developmentApp, {
      [SIGNED_CORE_UPDATE_FLAG]: "1",
    })).toBe(false);
    expect(isSignedCoreAutoUpdateEnabled(packagedApp, {
      [SIGNED_CORE_UPDATE_FLAG]: "1",
    })).toBe(true);
    expect(isSignedCoreAutoUpdateEnabled(packagedApp, {
      [SIGNED_CORE_UPDATE_FLAG]: "1",
      LYRA_DISABLE_AUTO_UPDATE: "1",
    })).toBe(false);
  });

  test("keeps unsigned packaged Beta builds on manual updates", async () => {
    const dispose = createAutoUpdateService(packagedApp);
    await flushMicrotasks();

    expect(autoUpdaterMock.on).not.toHaveBeenCalled();
    expect(autoUpdaterMock.checkForUpdatesAndNotify).not.toHaveBeenCalled();

    dispose();
    expect(autoUpdaterMock.off).not.toHaveBeenCalled();
  });

  test("checks for updates only after an explicitly enabled signed release", async () => {
    process.env[SIGNED_CORE_UPDATE_FLAG] = "1";

    const dispose = createAutoUpdateService(packagedApp);
    expect(autoUpdaterMock.autoDownload).toBe(true);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdaterMock.on).toHaveBeenCalledWith("error", expect.any(Function));

    await flushMicrotasks();
    expect(autoUpdaterMock.checkForUpdatesAndNotify).toHaveBeenCalledOnce();

    dispose();
    expect(autoUpdaterMock.off).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
