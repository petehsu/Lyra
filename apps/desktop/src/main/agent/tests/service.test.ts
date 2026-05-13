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
import { createAgentIpcBridge } from "../service";

type RuntimeListener = (event: string, payload: unknown) => void;

describe("Agent IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
  });

  test("forwards Agent IPC channels to runtime methods", async () => {
    const request = vi.fn(async (method: string, payload: unknown) => ({ method, payload }));
    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn(() => vi.fn())
      } as unknown as LyraRuntimeClient,
      getWindow: () => null
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionCreate)?.({}, { title: "Agent" })
    ).resolves.toEqual({
      method: "agent.session.create",
      payload: { title: "Agent" }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentTurnSend)?.({}, {
        sessionId: "session-1",
        text: "hello"
      })
    ).resolves.toEqual({
      method: "agent.turn.send",
      payload: {
        sessionId: "session-1",
        text: "hello"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentTurnCancel)?.({}, { sessionId: "session-1" })
    ).resolves.toEqual({
      method: "agent.turn.cancel",
      payload: { sessionId: "session-1" }
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentSessionCreate);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentTurnCancel);
  });

  test("forwards runtime Agent events to the renderer", () => {
    let runtimeListener: RuntimeListener | null = null;
    const unsubscribe = vi.fn();
    const send = vi.fn();
    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn((listener) => {
          runtimeListener = listener;
          return unsubscribe;
        })
      } as unknown as LyraRuntimeClient,
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send
        }
      }) as never
    });

    expect(runtimeListener).not.toBeNull();
    const listener = runtimeListener as unknown as RuntimeListener;
    listener("agent.runtime", {
      kind: "followStateChanged",
      sessionId: "session-1",
      follow: { running: true, activity: "Running" }
    });
    expect(send).toHaveBeenCalledWith(LYRA_CHANNELS.agentEvent, {
      kind: "followStateChanged",
      sessionId: "session-1",
      follow: { running: true, activity: "Running" }
    });

    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
