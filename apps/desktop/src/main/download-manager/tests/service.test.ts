import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  const defaultSession = {
    on: vi.fn(),
    off: vi.fn(),
    getUserAgent: vi.fn(() => "LyraTest/1.0")
  };
  return {
    handlers,
    defaultSession,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    },
    shell: {
      openPath: vi.fn(async () => ""),
      showItemInFolder: vi.fn()
    }
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
  session: {
    defaultSession: electronMock.defaultSession
  },
  shell: electronMock.shell
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../../runtime-client";
import { createDownloadManagerIpcBridge } from "../service";

type RuntimeListener = (event: string, payload: unknown) => void;

describe("Download manager IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    electronMock.defaultSession.on.mockClear();
    electronMock.defaultSession.off.mockClear();
    electronMock.shell.openPath.mockClear();
    electronMock.shell.showItemInFolder.mockClear();
  });

  test("forwards download IPC channels to runtime methods", async () => {
    const request = vi.fn(async (method: string, payload: unknown) => ({
      method,
      payload
    }));
    const bridge = createDownloadManagerIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn(() => vi.fn())
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-downloads-test",
      getWindow: () => null
    });
    await Promise.resolve();
    request.mockClear();

    await expect(electronMock.handlers.get(LYRA_CHANNELS.downloadsList)?.({})).resolves.toEqual({
      method: "download.list",
      payload: { storageRoot: "/tmp/lyra-downloads-test" }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.downloadsEnqueue)?.({}, { urls: ["https://example.com/a.zip"] })
    ).resolves.toEqual({
      method: "download.enqueue",
      payload: {
        urls: ["https://example.com/a.zip"],
        storageRoot: "/tmp/lyra-downloads-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.downloadsPause)?.({}, { taskId: " task-a " })
    ).resolves.toEqual({
      method: "download.pause",
      payload: {
        taskId: "task-a",
        storageRoot: "/tmp/lyra-downloads-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.downloadsSetPriority)?.({}, {
        taskId: "task-a",
        priority: "high"
      })
    ).resolves.toEqual({
      method: "download.set_priority",
      payload: {
        taskId: "task-a",
        priority: "high",
        storageRoot: "/tmp/lyra-downloads-test"
      }
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.downloadsRemoteStart)?.({}, { port: 17373 })
    ).resolves.toEqual({
      method: "download.remote.start",
      payload: {
        port: 17373,
        storageRoot: "/tmp/lyra-downloads-test"
      }
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.downloadsList);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.downloadsRemoteStart);
  });

  test("forwards runtime download events and keeps open/reveal in the shell", async () => {
    let runtimeListener: RuntimeListener | null = null;
    const send = vi.fn();
    const unsubscribe = vi.fn();
    const completedTask = {
      id: "task-a",
      state: "completed",
      savePath: "/tmp/a.zip"
    };
    const request = vi.fn(async (method: string) => (
      method === "download.list"
        ? { tasks: [completedTask] }
        : { method }
    ));
    const bridge = createDownloadManagerIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn((listener) => {
          runtimeListener = listener;
          return unsubscribe;
        })
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-downloads-test",
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send
        }
      }) as never
    });
    await Promise.resolve();

    expect(runtimeListener).not.toBeNull();
    const listener = runtimeListener as unknown as RuntimeListener;
    listener("download.runtime", {
      kind: "task-updated",
      task: completedTask
    });
    expect(send).toHaveBeenCalledWith(LYRA_CHANNELS.downloadsEvent, {
      kind: "task-updated",
      task: completedTask
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.downloadsOpenFile)?.({}, { taskId: "task-a" })
    ).resolves.toBe(true);
    expect(electronMock.shell.openPath).toHaveBeenCalledWith("/tmp/a.zip");

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.downloadsRevealFile)?.({}, { taskId: "task-a" })
    ).resolves.toBe(true);
    expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith("/tmp/a.zip");

    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalled();
    expect(electronMock.defaultSession.off).toHaveBeenCalled();
  });
});
