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
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentRollbackPreview)?.({}, {
        sessionId: "session-1",
        messageId: "message-1"
      })
    ).resolves.toEqual({
      method: "agent.rollback.preview",
      payload: {
        sessionId: "session-1",
        messageId: "message-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentRollbackRestore)?.({}, {
        sessionId: "session-1",
        messageId: "message-1",
        mode: "taskAndWorkspace"
      })
    ).resolves.toEqual({
      method: "agent.rollback.restore",
      payload: {
        sessionId: "session-1",
        messageId: "message-1",
        mode: "taskAndWorkspace"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionSave)?.({}, {
        sessionId: "session-1",
        label: null
      })
    ).resolves.toEqual({
      method: "agent.session.save",
      payload: {
        sessionId: "session-1",
        label: null
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionRename)?.({}, {
        sessionId: "session-1",
        title: "Planning"
      })
    ).resolves.toEqual({
      method: "agent.session.rename",
      payload: {
        sessionId: "session-1",
        title: "Planning"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionArchive)?.({}, {
        sessionId: "session-1",
        archived: true
      })
    ).resolves.toEqual({
      method: "agent.session.archive",
      payload: {
        sessionId: "session-1",
        archived: true
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionDelete)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "agent.session.delete",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionBindProject)?.({}, {
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      })
    ).resolves.toEqual({
      method: "agent.session.bindProject",
      payload: {
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeModelsList)?.({}, { sessionId: "session-1" })
    ).resolves.toEqual({
      method: "jcode.models.list",
      payload: { sessionId: "session-1" }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeModelSwitch)?.({}, {
        sessionId: "session-1",
        model: "gpt-5"
      })
    ).resolves.toEqual({
      method: "jcode.model.switch",
      payload: {
        sessionId: "session-1",
        model: "gpt-5"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeProviderOptionsUpdate)?.({}, {
        sessionId: "session-1",
        reasoningEffort: "high"
      })
    ).resolves.toEqual({
      method: "jcode.provider.options.update",
      payload: {
        sessionId: "session-1",
        reasoningEffort: "high"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeImproveRun)?.({}, {
        sessionId: "session-1",
        planOnly: false
      })
    ).resolves.toEqual({
      method: "jcode.improve.run",
      payload: {
        sessionId: "session-1",
        planOnly: false
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeRefactorRun)?.({}, {
        sessionId: "session-1",
        planOnly: true
      })
    ).resolves.toEqual({
      method: "jcode.refactor.run",
      payload: {
        sessionId: "session-1",
        planOnly: true
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodePokeTrigger)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "jcode.poke.trigger",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeReviewRun)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "jcode.review.run",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeJudgeRun)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "jcode.judge.run",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeOvernightStart)?.({}, {
        sessionId: "session-1",
        durationMinutes: 240,
        mission: "Stabilize tests",
        inheritContext: true
      })
    ).resolves.toEqual({
      method: "jcode.overnight.start",
      payload: {
        sessionId: "session-1",
        durationMinutes: 240,
        mission: "Stabilize tests",
        inheritContext: true
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.jcodeOvernightStatus)?.({}, {
        runId: "overnight-1"
      })
    ).resolves.toEqual({
      method: "jcode.overnight.status",
      payload: {
        runId: "overnight-1"
      }
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentSessionCreate);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentTurnCancel);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentRollbackPreview);
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
