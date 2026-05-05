import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    }
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../../runtime-client";
import { createAiIpcBridge } from "../service";

describe("AI IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
  });

  test("forwards Settings AI channels to runtime model config methods", async () => {
    const request = vi.fn(async (method: string, payload: unknown) => ({
      method,
      payload
    }));
    const bridge = createAiIpcBridge({
      runtimeClient: {
        request,
      } as unknown as LyraRuntimeClient
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiReadConfig)?.({})
    ).resolves.toEqual({
      method: "model.config.read",
      payload: {}
    });

    const upsertPayload = {
      id: "profile-openai",
      providerId: "openai",
      model: "gpt-5"
    };
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiUpsertProfile)?.({}, upsertPayload)
    ).resolves.toEqual({
      method: "model.profile.upsert",
      payload: upsertPayload
    });

    const discoverPayload = {
      providerId: "openai",
      model: "gpt-5"
    };
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.aiDiscoverModels)?.({}, discoverPayload)
    ).resolves.toEqual({
      method: "model.models.discover",
      payload: discoverPayload
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiReadConfig);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.aiDiscoverModels);
  });
});
