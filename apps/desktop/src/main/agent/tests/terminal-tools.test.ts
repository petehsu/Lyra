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

import type { LyraRuntimeClient } from "../../runtime-client";
import type { WorkbenchObservationService } from "../../workbench-observation/types";
import { createAgentIpcBridge } from "../service";
import { createWorkbenchStateMock } from "./workbench-state-mock";
import {
  TERMINAL_AGENT_TOOL_NAMES,
  mapTerminalAgentTool,
  terminalPermissionRisk
} from "../terminal-tools";

const terminalToolNames = [
  "terminal_list",
  "terminal_create",
  "terminal_read",
  "terminal_screen",
  "terminal_wait",
  "terminal_write",
  "terminal_close",
  "terminal_events",
  "terminal_read_until",
  "terminal_run",
  "terminal_input",
  "terminal_keys",
  "terminal_resize",
  "terminal_signal",
  "terminal_processes",
  "terminal_command_status",
  "terminal_map",
  "terminal_act",
  "terminal_attach_agent",
  "terminal_detach_agent"
] as const;

const createRuntimeClient = (registered: Map<string, (payload: unknown) => unknown>) => ({
  request: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  registerRequestHandler: vi.fn((method: string, handler: (payload: unknown) => unknown) => {
    registered.set(method, handler);
  }),
  unregisterRequestHandler: vi.fn()
}) as unknown as LyraRuntimeClient;

const terminalMemory = {
  eventLogPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/events.jsonl",
  summaryPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/summary.json",
  uiTimelinePath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/ui-timeline.jsonl",
  outputTextPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.txt",
  rawOutputPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.raw",
  lineIndexPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.lines.jsonl",
  errorIndexPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.errors.jsonl",
  commandsPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/commands.jsonl"
};

const terminalLifecycle = (
  sessionId: string,
  overrides: Record<string, unknown> = {}
) => ({
  sessionId,
  state: "running",
  phase: "terminal_read",
  reason: null,
  terminalRunning: true,
  commandId: null,
  commandStatus: null,
  exitCode: null,
  signal: null,
  source: "agent",
  mode: "shell",
  waiting: false,
  background: false,
  ...overrides
});

const terminalScreen = {
  sessionId: "private-terminal-1",
  cursor: "screen-2",
  screenVersion: 2,
  rows: 24,
  cols: 80,
  mode: "normal",
  visibleText: "ready",
  visibleRows: [{ row: 0, text: "ready", wrapped: false }],
  scrollbackText: null,
  scrollbackCursor: "0",
  scrollbackRows: [],
  cursorPosition: { row: 0, col: 5, visible: true },
  cells: [],
  cellsTruncated: false,
  styles: [],
  links: [],
  inputModes: {
    applicationCursor: false,
    applicationKeypad: false,
    bracketedPaste: false,
    mouseReporting: "none",
    mouseEncoding: "default",
    lineWrap: true
  },
  selectedText: null,
  activeCommand: null,
  prompt: "$",
  regions: [],
  running: true,
  exitCode: null,
  truncated: false,
  memory: terminalMemory,
  lifecycle: terminalLifecycle("private-terminal-1", { phase: "screen_read" })
};

const createTerminalBridgeMock = (overrides: Record<string, unknown> = {}) => ({
  loadResult: { loadedFrom: "test" },
  createSession: vi.fn(async (request: { readonly sessionId?: string }) => ({
    sessionId: request.sessionId ?? "private-terminal-1",
    title: "Agent Terminal",
    shell: "/bin/zsh",
    cols: 80,
    rows: 24,
    createdAt: "1000",
    source: "agent",
    mode: "shell",
    persist: false,
    running: true,
    exitCode: null
  })),
  restoreSessions: vi.fn(),
  reloadPrompt: vi.fn(),
  write: vi.fn(),
  readObservation: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    cursor: "12",
    output: "ready",
    running: true,
    exitCode: null,
    truncated: false,
    source: "agent",
    mode: "shell",
    memory: terminalMemory,
    lifecycle: terminalLifecycle(request.sessionId)
  })),
  readScreen: vi.fn(async (request: { readonly sessionId: string }) => ({
    ...terminalScreen,
    sessionId: request.sessionId,
    lifecycle: terminalLifecycle(request.sessionId, { phase: "screen_read" })
  })),
  readEvents: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    cursor: "0",
    nextCursor: "2",
    hasMore: false,
    memory: terminalMemory,
    items: [
      {
        terminalSessionId: request.sessionId,
        seq: 1,
        kind: "output",
        actor: { kind: "process" },
        payload: { text: "ready" }
      }
    ]
  })),
  readCommands: vi.fn(),
  readOutputRange: vi.fn(),
  listArtifacts: vi.fn(),
  readMemoryTimeline: vi.fn(),
  waitUntil: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    matched: true,
    reason: "output",
    cursor: "13",
    screenCursor: "screen-2",
    commandId: "command-1",
    output: "ready",
    memory: terminalMemory,
    lifecycle: terminalLifecycle(request.sessionId, {
      state: "waiting",
      phase: "wait_until",
      reason: "output",
      waiting: true
    })
  })),
  executeInput: vi.fn(async (request: { readonly sessionId: string; readonly action: string }) => ({
    sessionId: request.sessionId,
    inputId: "input-1",
    action: request.action,
    status: "executed",
    events: [],
    memory: terminalMemory,
    lifecycle: terminalLifecycle(request.sessionId, {
      state: "inputSent",
      phase: `input:${request.action}`
    })
  })),
  evaluatePermission: vi.fn(),
  respondPermission: vi.fn(),
  readProcesses: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    pid: 42,
    foregroundPid: 42,
    running: true,
    exitCode: null,
    signal: null,
    processes: [{ pid: 42, foreground: true, running: true, name: "zsh" }],
    memory: terminalMemory,
    lifecycle: terminalLifecycle(request.sessionId, { phase: "processes_read" })
  })),
  signalProcess: vi.fn(async (request: { readonly sessionId: string; readonly signal: string }) => ({
    sessionId: request.sessionId,
    pid: 42,
    signal: request.signal,
    status: "sent",
    inputId: "input-signal",
    memory: terminalMemory
  })),
  readCommandStatus: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    commandId: "command-1",
    command: {
      commandId: "command-1",
      sessionId: request.sessionId,
      status: "running",
      exitCode: null,
      outputRange: { start: 0, end: 5 }
    },
    memory: terminalMemory,
    lifecycle: terminalLifecycle(request.sessionId, {
      phase: "command_status",
      commandId: "command-1",
      commandStatus: "running"
    })
  })),
  waitCommand: vi.fn(),
  readCommandOutput: vi.fn(),
  readMap: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    screen: {
      ...terminalScreen,
      sessionId: request.sessionId,
      lifecycle: terminalLifecycle(request.sessionId, { phase: "screen_read" })
    },
    regions: [
      {
        regionId: "region-1",
        kind: "button",
        text: "OK",
        rowStart: 1,
        rowEnd: 1,
        colStart: 1,
        colEnd: 2,
        confidence: 0.9,
        suggestedActions: ["confirm"]
      }
    ],
    stale: false,
    memory: terminalMemory
  })),
  executeAct: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    actId: "act-1",
    status: "executed",
    inputId: "input-act",
    screenCursor: "screen-3",
    map: {
      sessionId: request.sessionId,
      screen: {
        ...terminalScreen,
        sessionId: request.sessionId,
        screenVersion: 3,
        lifecycle: terminalLifecycle(request.sessionId, { phase: "screen_read" })
      },
      regions: [],
      memory: terminalMemory
    },
    memory: terminalMemory
  })),
  attachAgent: vi.fn(async (request: { readonly sessionId: string; readonly agentSessionId: string }) => ({
    sessionId: request.sessionId,
    attachment: {
      attachmentId: "attachment-1",
      terminalSessionId: request.sessionId,
      agentSessionId: request.agentSessionId,
      mode: "control",
      status: "active"
    },
    memory: terminalMemory
  })),
  detachAgent: vi.fn(async (request: { readonly sessionId: string; readonly attachmentId: string }) => ({
    sessionId: request.sessionId,
    attachmentId: request.attachmentId,
    status: "detached",
    memory: terminalMemory
  })),
  listAttachments: vi.fn(),
  pauseAttachment: vi.fn(),
  resumeAttachment: vi.fn(),
  resize: vi.fn(),
  closeSession: vi.fn(),
  dispose: vi.fn(),
  ...overrides
});

describe("terminal agent tools", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
  });

  test("mapping covers every terminal model tool", () => {
    expect(TERMINAL_AGENT_TOOL_NAMES).toEqual([...terminalToolNames]);

    for (const name of terminalToolNames) {
      const mapped = mapTerminalAgentTool(name, {
        sessionId: "terminal-1",
        runtimeCancellation: {
          sessionId: "agent-1",
          turnId: "turn-1",
          toolCallId: "tool-1"
        }
      });
      expect(mapped).not.toBeNull();
      expect(mapped?.displayName).toBe("terminal");
      expect(mapped?.payload.action).toBe(mapped?.action);
      expect(mapped?.payload.runtimeCancellation).toEqual({
        sessionId: "agent-1",
        turnId: "turn-1",
        toolCallId: "tool-1"
      });
    }
  });

  test("permission classifier separates read-only and mutating actions", () => {
    for (const action of [
      "list",
      "create",
      "read",
      "screen",
      "wait",
      "events",
      "read_until",
      "processes",
      "command_status",
      "map"
    ]) {
      expect(terminalPermissionRisk(action, {})).toBe("none");
    }

    expect(terminalPermissionRisk("create", { command: "npm test" })).toBe("shell");
    expect(terminalPermissionRisk("run", { command: "npm test" })).toBe("shell");
    expect(terminalPermissionRisk("close", { sessionId: "terminal-1" })).toBe("shell");
    expect(terminalPermissionRisk("act", { regionId: "region-1" })).toBe("dangerous");
  });

  test("host handlers route new tools through one terminal target resolver", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const terminalBridge = createTerminalBridgeMock();
    const bridge = createAgentIpcBridge({
      runtimeClient: createRuntimeClient(registered),
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: terminalBridge as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => ({ openTerminalPane: vi.fn() }) as never,
      workbenchState: createWorkbenchStateMock()
    });

    const created = await registered.get("terminal.create")?.({
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-create" }
    }) as { readonly sessionId: string };
    const privateSessionId = created.sessionId;

    await expect(registered.get("terminal.events.read")?.({
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-events" }
    })).resolves.toMatchObject({ sessionId: privateSessionId, events: expect.any(Array) });
    await expect(registered.get("terminal.waitUntil")?.({
      until: "output",
      text: "ready",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-wait" }
    })).resolves.toMatchObject({
      matched: true,
      reason: "output",
      lifecycle: expect.objectContaining({ state: "waiting", phase: "wait_until" })
    });
    await expect(registered.get("terminal.input.execute")?.({
      action: "run",
      command: "npm test",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-run" }
    })).resolves.toMatchObject({
      command: "npm test",
      commandId: expect.any(String),
      lifecycle: expect.objectContaining({ state: "inputSent", phase: "input:runCommand" })
    });
    await expect(registered.get("terminal.write")?.({
      keys: ["q", "escape"],
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-write-keys" }
    })).resolves.toMatchObject({ wrote: "q, escape" });
    await expect(registered.get("terminal.processes.read")?.({
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-processes" }
    })).resolves.toMatchObject({
      processes: expect.any(Array),
      lifecycle: expect.objectContaining({ phase: "processes_read" })
    });
    await expect(registered.get("terminal.command.status")?.({
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-status" }
    })).resolves.toMatchObject({
      commandId: "command-1",
      lifecycle: expect.objectContaining({ phase: "command_status", commandId: "command-1" })
    });
    await expect(registered.get("terminal.map.read")?.({
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-map" }
    })).resolves.toMatchObject({
      regions: expect.any(Array),
      lifecycle: expect.objectContaining({ phase: "screen_read" })
    });
    await expect(registered.get("terminal.act.execute")?.({
      operation: "confirm",
      regionId: "region-1",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-act" }
    })).resolves.toMatchObject({
      actId: "act-1",
      lifecycle: expect.objectContaining({ phase: "screen_read" })
    });
    await expect(registered.get("terminal.resize")?.({
      cols: 100,
      rows: 30,
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-resize" }
    })).resolves.toMatchObject({ screen: expect.objectContaining({ cols: 80 }) });
    await expect(registered.get("terminal.processes.signal")?.({
      signal: "SIGTERM",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-signal" }
    })).resolves.toMatchObject({ signal: "SIGTERM", status: "sent" });
    await expect(registered.get("terminal.attachments.attach")?.({
      mode: "control",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-attach" }
    })).resolves.toMatchObject({ attachment: expect.objectContaining({ mode: "control" }) });
    await expect(registered.get("terminal.attachments.detach")?.({
      attachmentId: "attachment-1",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-detach" }
    })).resolves.toMatchObject({ attachmentId: "attachment-1", status: "detached" });

    expect(terminalBridge.executeInput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: privateSessionId,
      action: "runCommand",
      correlation: expect.objectContaining({
        agentSessionId: "agent-1",
        runtimeTurnId: "turn-1",
        toolCallId: "tool-run",
        terminalToolName: "terminal_run",
        commandId: expect.any(String)
      })
    }));
    expect(terminalBridge.write).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: privateSessionId,
      keys: ["q", "escape"]
    }));
    expect(terminalBridge.waitUntil).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: privateSessionId,
      cursor: "12"
    }));
    expect(terminalBridge.attachAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentSessionId: "agent-1",
      runtimeTurnId: "turn-1",
      toolCallId: "tool-attach",
      correlation: expect.objectContaining({
        terminalToolName: "terminal_attach_agent"
      })
    }));

    bridge.dispose();
  });

  test("explicit ui target uses the visible Workbench terminal pane", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const terminalBridge = createTerminalBridgeMock();
    const terminalPane = {
      terminalTabId: "terminal-tab-1",
      paneId: "pane-1",
      sessionId: "ui-terminal-1",
      title: "UI Terminal",
      placement: "dock" as const
    };
    const observationService = {
      listTerminalPanes: vi.fn(async () => ({
        active: terminalPane,
        panes: [terminalPane]
      })),
      focusTerminalPane: vi.fn(async () => terminalPane)
    } as unknown as WorkbenchObservationService;
    const bridge = createAgentIpcBridge({
      runtimeClient: createRuntimeClient(registered),
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: terminalBridge as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService,
      workbenchState: createWorkbenchStateMock()
    });

    await expect(registered.get("terminal.events.read")?.({
      target: "ui",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-events" }
    })).resolves.toMatchObject({
      target: {
        type: "ui",
        sessionId: "ui-terminal-1",
        terminalTabId: "terminal-tab-1",
        paneId: "pane-1"
      }
    });
    expect(terminalBridge.readEvents).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "ui-terminal-1",
      correlation: expect.objectContaining({
        terminalTabId: "terminal-tab-1",
        paneId: "pane-1"
      })
    }));

    bridge.dispose();
  });

  test("ui terminal run opens a replacement when the active pane is stopped", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const stoppedPane = {
      terminalTabId: "terminal-tab-old",
      paneId: "pane-old",
      sessionId: "ui-terminal-stopped",
      title: "Task",
      placement: "dock" as const
    };
    const replacementPane = {
      terminalTabId: "terminal-tab-new",
      paneId: "pane-new",
      sessionId: "ui-terminal-new",
      title: "Agent Terminal",
      placement: "dock" as const
    };
    const terminalBridge = createTerminalBridgeMock({
      readObservation: vi.fn(async (request: { readonly sessionId: string }) => ({
        sessionId: request.sessionId,
        cursor: "12",
        output: request.sessionId === stoppedPane.sessionId ? "npm error ENOENT" : "ready",
        running: request.sessionId !== stoppedPane.sessionId,
        exitCode: request.sessionId === stoppedPane.sessionId ? 1 : null,
        truncated: false,
        source: "agent",
        mode: "shell",
        memory: terminalMemory
      }))
    });
    const observationService = {
      listTerminalPanes: vi.fn(async () => ({
        active: stoppedPane,
        panes: [stoppedPane]
      })),
      openTerminalPane: vi.fn(async () => replacementPane),
      focusTerminalPane: vi.fn(async (request: { readonly paneId: string }) =>
        request.paneId === replacementPane.paneId ? replacementPane : stoppedPane
      )
    } as unknown as WorkbenchObservationService;
    const bridge = createAgentIpcBridge({
      runtimeClient: createRuntimeClient(registered),
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: terminalBridge as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService,
      workbenchState: createWorkbenchStateMock()
    });

    await expect(registered.get("terminal.input.execute")?.({
      target: "ui",
      action: "run",
      command: "git config --global --list",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-run" }
    })).resolves.toMatchObject({
      target: {
        type: "ui",
        sessionId: replacementPane.sessionId,
        terminalTabId: replacementPane.terminalTabId,
        paneId: replacementPane.paneId
      },
      command: "git config --global --list"
    });
    expect(observationService.openTerminalPane).toHaveBeenCalledWith(expect.objectContaining({
      placement: "dock",
      title: "Agent Terminal"
    }));
    expect(terminalBridge.executeInput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: replacementPane.sessionId,
      action: "runCommand",
      command: "git config --global --list"
    }));

    bridge.dispose();
  });

  test("explicit stopped ui terminal target fails before writing", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const stoppedPane = {
      terminalTabId: "terminal-tab-old",
      paneId: "pane-old",
      sessionId: "ui-terminal-stopped",
      title: "Task",
      placement: "dock" as const
    };
    const terminalBridge = createTerminalBridgeMock({
      readObservation: vi.fn(async (request: { readonly sessionId: string }) => ({
        sessionId: request.sessionId,
        cursor: "12",
        output: "npm error ENOENT",
        running: false,
        exitCode: 1,
        truncated: false,
        source: "agent",
        mode: "shell",
        memory: terminalMemory
      }))
    });
    const observationService = {
      listTerminalPanes: vi.fn(async () => ({
        active: stoppedPane,
        panes: [stoppedPane]
      })),
      openTerminalPane: vi.fn(),
      focusTerminalPane: vi.fn(async () => stoppedPane)
    } as unknown as WorkbenchObservationService;
    const bridge = createAgentIpcBridge({
      runtimeClient: createRuntimeClient(registered),
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: terminalBridge as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService,
      workbenchState: createWorkbenchStateMock()
    });

    await expect(registered.get("terminal.input.execute")?.({
      target: "ui",
      sessionId: stoppedPane.sessionId,
      action: "run",
      command: "git config --global --list",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-run" }
    })).rejects.toThrow(/terminal_session_not_running/);
    expect(observationService.openTerminalPane).not.toHaveBeenCalled();
    expect(terminalBridge.executeInput).not.toHaveBeenCalled();

    bridge.dispose();
  });

  test("CLI follow keeps terminal tools private for inline CLI mirroring", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const runtimeClient = createRuntimeClient(registered);
    vi.mocked(runtimeClient.request).mockImplementation(async (method: string) => {
      if (method === "agent.cli.follow.read") {
        return {
          enabled: true,
          terminalSessionId: "cli-terminal-1",
          terminalTabId: "cli-tab-1",
          terminalPaneId: "cli-pane-1"
        };
      }
      return {};
    });
    const terminalBridge = createTerminalBridgeMock();
    const cliPane = {
      terminalTabId: "cli-tab-1",
      paneId: "cli-pane-1",
      sessionId: "cli-terminal-1",
      title: "Lyra",
      placement: "dock" as const
    };
    const observationService = {
      listTerminalPanes: vi.fn(async () => ({
        active: cliPane,
        panes: [cliPane]
      })),
      openTerminalPane: vi.fn(),
      focusTerminalPane: vi.fn()
    } as unknown as WorkbenchObservationService;
    const bridge = createAgentIpcBridge({
      runtimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: terminalBridge as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService,
      workbenchState: createWorkbenchStateMock()
    });

    await expect(registered.get("terminal.input.execute")?.({
      action: "run",
      command: "npm test",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-run" }
    })).resolves.toMatchObject({
      target: {
        type: "private",
        sessionId: expect.stringContaining("agent-terminal-agent-1-")
      },
      command: "npm test"
    });
    expect(observationService.openTerminalPane).not.toHaveBeenCalled();
    expect(observationService.focusTerminalPane).not.toHaveBeenCalled();
    expect(terminalBridge.createSession).toHaveBeenCalledWith(expect.objectContaining({
      source: "agent",
      mode: "command",
      command: "npm test"
    }));
    expect(terminalBridge.executeInput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringContaining("agent-terminal-agent-1-"),
      action: "runCommand"
    }));

    bridge.dispose();
  });
});
