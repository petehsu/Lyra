import type { App } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const autoUpdaterMock = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: false,
  checkForUpdates: vi.fn<() => Promise<void>>(),
  downloadUpdate: vi.fn<() => Promise<void>>(),
  quitAndInstall: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
}));

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}));

const existsSyncMock = vi.hoisted(() => vi.fn<() => boolean>());
const signedUpdaterMock = vi.hoisted(() => ({
  check: vi.fn(async () => ({ releaseVersion: "1.1.0" })),
  download: vi.fn(async (onProgress: (percent: number) => void) => {
    onProgress(50);
    return { releaseVersion: "1.1.0" };
  }),
  install: vi.fn(async () => undefined)
}));

vi.mock("electron", () => ({
  ipcMain: ipcMainMock,
  BrowserWindow: class {}
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
}));

import {
  createAutoUpdateService,
  hasElectronUpdaterMetadata,
  isSignedCoreAutoUpdateEnabled,
  SIGNED_CORE_UPDATE_FLAG,
} from "./service";

const packagedApp = { isPackaged: true, getVersion: () => "1.0.0" } as App;
const previewApp = { isPackaged: true, getVersion: () => "0.1.0-preview.9" } as App;
const developmentApp = { isPackaged: false, getVersion: () => "1.0.0" } as App;

const flushMicrotasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
};

describe("Core auto-update release gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoUpdaterMock.autoDownload = false;
    autoUpdaterMock.autoInstallOnAppQuit = false;
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined);
    autoUpdaterMock.downloadUpdate.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
    signedUpdaterMock.check.mockClear();
    signedUpdaterMock.download.mockClear();
    signedUpdaterMock.install.mockClear();
    delete process.env[SIGNED_CORE_UPDATE_FLAG];
    delete process.env.LYRA_DISABLE_AUTO_UPDATE;
  });

  afterEach(() => {
    delete process.env[SIGNED_CORE_UPDATE_FLAG];
    delete process.env.LYRA_DISABLE_AUTO_UPDATE;
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

  test("keeps development builds out of the updater", async () => {
    const dispose = createAutoUpdateService(developmentApp);
    await flushMicrotasks();

    expect(autoUpdaterMock.on).not.toHaveBeenCalled();
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();

    dispose();
    expect(autoUpdaterMock.off).not.toHaveBeenCalled();
  });

  test("checks every packaged build on startup without downloading or installing", async () => {
    const dispose = createAutoUpdateService(packagedApp, () => null, () => true);
    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false);
    expect(autoUpdaterMock.on).toHaveBeenCalledWith("error", expect.any(Function));

    await flushMicrotasks();
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce();

    dispose();
    expect(autoUpdaterMock.off).toHaveBeenCalledWith("error", expect.any(Function));
  });

  test("does not invoke electron-updater when an installer has no update metadata", async () => {
    existsSyncMock.mockReturnValue(false);
    const dispose = createAutoUpdateService(packagedApp, () => null, () => false);
    await flushMicrotasks();

    expect(autoUpdaterMock.on).not.toHaveBeenCalled();
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(ipcMainMock.handle).toHaveBeenCalledTimes(4);
    expect(hasElectronUpdaterMetadata("/custom/resources")).toBe(false);

    dispose();
  });

  test("uses the signed component updater for custom online and offline installations", async () => {
    const dispose = createAutoUpdateService(
      packagedApp,
      () => null,
      () => false,
      signedUpdaterMock
    );
    await flushMicrotasks();

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(signedUpdaterMock.check).toHaveBeenCalledOnce();
    const check = ipcMainMock.handle.mock.calls.find(([channel]) => channel === "lyra:app-update/check")?.[1];
    const download = ipcMainMock.handle.mock.calls.find(([channel]) => channel === "lyra:app-update/download")?.[1];
    const install = ipcMainMock.handle.mock.calls.find(([channel]) => channel === "lyra:app-update/install")?.[1];
    await check();
    await download();
    await install();
    expect(signedUpdaterMock.download).toHaveBeenCalledOnce();
    expect(signedUpdaterMock.install).toHaveBeenCalledOnce();

    dispose();
  });

  test("recognizes a newer numeric preview version", async () => {
    signedUpdaterMock.check.mockResolvedValueOnce({ releaseVersion: "0.1.0-preview.10" });
    const dispose = createAutoUpdateService(previewApp, () => null, () => false, signedUpdaterMock);
    await flushMicrotasks();
    const readStatus = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === "lyra:app-update/read-status"
    )?.[1];
    expect(readStatus()).toMatchObject({
      state: "available",
      currentVersion: "0.1.0-preview.9",
      availableVersion: "0.1.0-preview.10"
    });
    dispose();
  });
});
