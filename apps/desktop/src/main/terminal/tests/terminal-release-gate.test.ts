import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  type PortHandler = (event: { readonly data: unknown }) => void;
  const handlers = new Map<string, Handler>();
  class FakeMessagePortMain {
    peer: FakeMessagePortMain | null = null;
    messageHandler: PortHandler | null = null;
    closeHandler: (() => void) | null = null;

    on(event: "message" | "close", handler: PortHandler | (() => void)) {
      if (event === "message") {
        this.messageHandler = handler as PortHandler;
      } else {
        this.closeHandler = handler as () => void;
      }
    }

    start() {
      return undefined;
    }

    close() {
      this.closeHandler?.();
    }

    postMessage(data: unknown) {
      this.peer?.messageHandler?.({ data });
    }
  }
  class FakeMessageChannelMain {
    port1 = new FakeMessagePortMain();
    port2 = new FakeMessagePortMain();

    constructor() {
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  }
  return {
    handlers,
    MessageChannelMain: vi.fn(() => new FakeMessageChannelMain()),
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
  MessageChannelMain: electronMock.MessageChannelMain,
  ipcMain: electronMock.ipcMain
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient, RuntimeEventListener } from "../../runtime-client";
import { LYRA_PROMPT_READY_MARKER } from "../prompt-stream";
import { createTerminalIpcBridge } from "../service";

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "lyra-terminal-release-gate-"));
  roots.push(root);
  return root;
};

const snapshot = {
  sessionId: "terminal-session-1",
  title: "Terminal",
  cwd: "/workspace",
  shell: "/bin/zsh",
  cols: 80,
  rows: 24,
  createdAt: "2026-06-01T00:00:00.000Z",
  source: "user",
  mode: "shell",
  persist: true,
  running: true,
  exitCode: null
};

const createRuntimeClient = (
  request: LyraRuntimeClient["request"],
  listeners: RuntimeEventListener[] = []
): LyraRuntimeClient => ({
  request,
  subscribe: vi.fn((listener: RuntimeEventListener) => {
    listeners.push(listener);
    return () => undefined;
  }),
  registerRequestHandler: vi.fn(),
  unregisterRequestHandler: vi.fn(),
  dispose: vi.fn()
} as unknown as LyraRuntimeClient);

afterEach(async () => {
  electronMock.handlers.clear();
  electronMock.ipcMain.handle.mockClear();
  electronMock.ipcMain.removeHandler.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal release gate IPC bridge", () => {
  test("IPC contract methods inject storageRoot", async () => {
    const root = await createRoot();
    const request = vi.fn(async (method: string) => {
      if (method === "terminal.sessions.create") return snapshot;
      if (method === "terminal.sessions.restore") return [snapshot];
      if (
        method === "terminal.sessions.write" ||
        method === "terminal.sessions.resize" ||
        method === "terminal.sessions.close"
      ) {
        return undefined;
      }
      return { method };
    });
    const bridge = createTerminalIpcBridge(
      root,
      createRuntimeClient(request as LyraRuntimeClient["request"]),
      () => null
    );

    const cases: Array<readonly [string, string, Record<string, unknown>]> = [
      [LYRA_CHANNELS.terminalReadSession, "terminal.sessions.read", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalReadMemoryTimeline, "terminal.memory.readTimeline", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalReadEvents, "terminal.events.read", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalReadCommands, "terminal.commands.read", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalReadOutputRange, "terminal.output.readRange", { sessionId: "terminal-session-1", start: 0, end: 10 }],
      [LYRA_CHANNELS.terminalListArtifacts, "terminal.artifacts.list", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalReadScreen, "terminal.screen.read", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalWaitUntil, "terminal.waitUntil", { sessionId: "terminal-session-1", target: "output" }],
      [LYRA_CHANNELS.terminalInputExecute, "terminal.input.execute", { sessionId: "terminal-session-1", action: "runCommand" }],
      [LYRA_CHANNELS.terminalPermissionsEvaluate, "terminal.permissions.evaluate", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalPermissionsRespond, "terminal.permissions.respond", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalProcessesRead, "terminal.processes.read", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalProcessesSignal, "terminal.processes.signal", { sessionId: "terminal-session-1", signal: "SIGTERM" }],
      [LYRA_CHANNELS.terminalCommandStatus, "terminal.command.status", { sessionId: "terminal-session-1", commandId: "command-1" }],
      [LYRA_CHANNELS.terminalCommandWait, "terminal.command.wait", { sessionId: "terminal-session-1", commandId: "command-1" }],
      [LYRA_CHANNELS.terminalCommandReadOutput, "terminal.command.readOutput", { sessionId: "terminal-session-1", commandId: "command-1" }],
      [LYRA_CHANNELS.terminalMapRead, "terminal.map.read", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalActExecute, "terminal.act.execute", { sessionId: "terminal-session-1", action: "confirm" }],
      [LYRA_CHANNELS.terminalAttachmentsAttach, "terminal.attachments.attach", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalAttachmentsDetach, "terminal.attachments.detach", { sessionId: "terminal-session-1", attachmentId: "attachment-1" }],
      [LYRA_CHANNELS.terminalAttachmentsList, "terminal.attachments.list", { sessionId: "terminal-session-1" }],
      [LYRA_CHANNELS.terminalAttachmentsPause, "terminal.attachments.pause", { sessionId: "terminal-session-1", attachmentId: "attachment-1" }],
      [LYRA_CHANNELS.terminalAttachmentsResume, "terminal.attachments.resume", { sessionId: "terminal-session-1", attachmentId: "attachment-1" }]
    ];

    for (const [channel, method, payload] of cases) {
      const handler = electronMock.handlers.get(channel);
      if (handler === undefined) throw new Error(`missing handler ${channel}`);
      await expect(handler({}, payload)).resolves.toEqual({ method });
      expect(request).toHaveBeenLastCalledWith(method, expect.objectContaining({
        ...payload,
        storageRoot: root
      }));
    }

    bridge.dispose();
  });

  test("prompt reload writes with terminal kernel actor and storageRoot", async () => {
    const root = await createRoot();
    const listeners: RuntimeEventListener[] = [];
    const request = vi.fn(async (method: string) => {
      if (method === "terminal.sessions.create") return snapshot;
      return undefined;
    });
    const bridge = createTerminalIpcBridge(
      root,
      createRuntimeClient(request as LyraRuntimeClient["request"], listeners),
      () => null
    );

    await bridge.createSession({
      sessionId: "terminal-session-1",
      cols: 80,
      rows: 24,
      source: "agent"
    });
    listeners[0]?.("terminal.runtime", {
      kind: "data",
      sessionId: "terminal-session-1",
      data: `${LYRA_PROMPT_READY_MARKER}lyra % `
    });

    await expect(bridge.reloadPrompt({
      sessionId: "terminal-session-1",
      terminalThemePreset: "follow-app",
      uiThemeId: "lyra-dark",
      source: "system"
    })).resolves.toMatchObject({ applied: true, deferred: false });
    expect(request).toHaveBeenCalledWith("terminal.sessions.write", expect.objectContaining({
      sessionId: "terminal-session-1",
      source: "system",
      actor: { kind: "terminal_kernel" },
      correlation: { terminalToolName: "terminal.reloadPrompt" },
      storageRoot: root
    }));

    bridge.dispose();
  });

  test("data port accepts low-latency renderer input and batches plain typing", async () => {
    const root = await createRoot();
    const request = vi.fn(async (method: string) => {
      if (method === "terminal.sessions.write") return undefined;
      return snapshot;
    });
    const postMessage = vi.fn();
    const bridge = createTerminalIpcBridge(
      root,
      createRuntimeClient(request as LyraRuntimeClient["request"]),
      () => ({
        isDestroyed: () => false,
        webContents: { postMessage }
      }) as never
    );

    await electronMock.handlers.get(LYRA_CHANNELS.terminalConnectDataPort)?.({}, {});
    const transferredPorts = postMessage.mock.calls[0]?.[2] as Array<{
      readonly postMessage: (payload: unknown) => void;
    }> | undefined;
    const rendererPort = transferredPorts?.[0];
    if (rendererPort === undefined) {
      throw new Error("terminal data port was not transferred");
    }
    rendererPort.postMessage({
      kind: "input",
      request: { sessionId: "terminal-session-1", data: "l", source: "user" }
    });
    rendererPort.postMessage({
      kind: "input",
      request: { sessionId: "terminal-session-1", data: "s", source: "user" }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(request).toHaveBeenCalledWith("terminal.sessions.write", expect.objectContaining({
      sessionId: "terminal-session-1",
      data: "ls",
      source: "user",
      storageRoot: root
    }));

    bridge.dispose();
  });

  test("data port coalesces renderer input while runtime write is in flight", async () => {
    const root = await createRoot();
    const firstWrite = {
      release: null as (() => void) | null
    };
    let writeCount = 0;
    const request = vi.fn((method: string) => {
      if (method !== "terminal.sessions.write") {
        return Promise.resolve(snapshot);
      }
      writeCount += 1;
      if (writeCount === 1) {
        return new Promise<void>((resolve) => {
          firstWrite.release = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const postMessage = vi.fn();
    const bridge = createTerminalIpcBridge(
      root,
      createRuntimeClient(request as LyraRuntimeClient["request"]),
      () => ({
        isDestroyed: () => false,
        webContents: { postMessage }
      }) as never
    );

    await electronMock.handlers.get(LYRA_CHANNELS.terminalConnectDataPort)?.({}, {});
    const transferredPorts = postMessage.mock.calls[0]?.[2] as Array<{
      readonly postMessage: (payload: unknown) => void;
    }> | undefined;
    const rendererPort = transferredPorts?.[0];
    if (rendererPort === undefined) {
      throw new Error("terminal data port was not transferred");
    }

    rendererPort.postMessage({
      kind: "input",
      request: { sessionId: "terminal-session-1", data: "a", source: "user" }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith("terminal.sessions.write", expect.objectContaining({
      sessionId: "terminal-session-1",
      data: "a",
      source: "user",
      storageRoot: root
    }));

    for (const data of ["b", "c", "d"]) {
      rendererPort.postMessage({
        kind: "input",
        request: { sessionId: "terminal-session-1", data, source: "user" }
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(1);

    expect(firstWrite.release).not.toBeNull();
    firstWrite.release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("terminal.sessions.write", expect.objectContaining({
      sessionId: "terminal-session-1",
      data: "bcd",
      source: "user",
      storageRoot: root
    }));

    bridge.dispose();
  });

  test("human shell sessions are owned by the Rust terminal host", async () => {
    const root = await createRoot();
    const request = vi.fn(async (method: string) => {
      if (method === "terminal.sessions.create") return snapshot;
      if (method === "terminal.sessions.restore") return [snapshot];
      return undefined;
    });
    const bridge = createTerminalIpcBridge(
      root,
      createRuntimeClient(request as LyraRuntimeClient["request"]),
      () => null
    );

    await expect(bridge.createSession({
      sessionId: "terminal-session-1",
      cols: 80,
      rows: 24,
      source: "user",
      mode: "shell"
    })).resolves.toBe(snapshot);

    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.create",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        source: "user",
        mode: "shell",
        storageRoot: root
      })
    );
    expect(request).not.toHaveBeenCalledWith(
      "terminal.observer.create",
      expect.anything()
    );

    await expect(bridge.restoreSessions({
      sessions: [{
        sessionId: "terminal-session-1",
        cols: 80,
        rows: 24,
        source: "user",
        mode: "shell"
      }]
    })).resolves.toEqual([snapshot]);
    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.restore",
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            sessionId: "terminal-session-1",
            source: "user",
            mode: "shell",
            storageRoot: root
          })
        ]
      })
    );

    bridge.dispose();
  });

  test("runtime unavailable errors remain stable for bridge callers", async () => {
    const root = await createRoot();
    const bridge = createTerminalIpcBridge(
      root,
      createRuntimeClient(vi.fn(async () => {
        throw new Error("Runtime unavailable: lyrad disconnected");
      }) as LyraRuntimeClient["request"]),
      () => null
    );

    await expect(bridge.readScreen({ sessionId: "terminal-session-1" }))
      .rejects
      .toThrow("Runtime unavailable");
    bridge.dispose();
  });
});
