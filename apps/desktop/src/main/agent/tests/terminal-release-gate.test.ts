import { describe, expect, test, vi } from "vitest";

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
  TERMINAL_AGENT_TOOL_ROUTES,
  mapTerminalAgentTool,
  terminalPermissionRisk
} from "../terminal-tools";

const terminalMemory = {
  eventLogPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/events.jsonl",
  summaryPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/summary.json",
  uiTimelinePath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/ui-timeline.jsonl",
  outputTextPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.txt",
  rawOutputPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.raw",
  lineIndexPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.lines.jsonl",
  errorIndexPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/outputs/session-output.errors.jsonl",
  commandsPath: "/tmp/lyra-agent-test/terminal-memory/sessions/private/commands.jsonl",
  truncatedByProjection: false
};

const createRuntimeClient = (registered: Map<string, (payload: unknown) => unknown>) => ({
  request: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  registerRequestHandler: vi.fn((method: string, handler: (payload: unknown) => unknown) => {
    registered.set(method, handler);
  }),
  unregisterRequestHandler: vi.fn()
}) as unknown as LyraRuntimeClient;

const createTerminalBridgeMock = () => ({
  createSession: vi.fn(async (request: { readonly sessionId?: string }) => ({
    sessionId: request.sessionId ?? "private-terminal-1",
    title: "Agent Terminal",
    shell: "/bin/zsh",
    cols: 80,
    rows: 24,
    createdAt: "2026-06-01T00:00:00.000Z",
    source: "agent",
    mode: "shell",
    persist: false,
    running: true,
    exitCode: null
  })),
  readObservation: vi.fn(async (request: { readonly sessionId: string }) => ({
    sessionId: request.sessionId,
    cursor: "12",
    output: "ready",
    running: true,
    exitCode: null,
    truncated: false,
    source: "agent",
    mode: "shell",
    memory: terminalMemory
  })),
  write: vi.fn(async () => undefined),
  closeSession: vi.fn(),
  dispose: vi.fn()
});

describe("terminal agent release gate", () => {
  test("tool routes keep schema names, host mapping, and permission policy in lockstep", () => {
    expect(Object.keys(TERMINAL_AGENT_TOOL_ROUTES)).toEqual(TERMINAL_AGENT_TOOL_NAMES);

    for (const name of TERMINAL_AGENT_TOOL_NAMES) {
      const route = TERMINAL_AGENT_TOOL_ROUTES[name];
      const mapped = mapTerminalAgentTool(name, {
        runtimeCancellation: {
          sessionId: "agent-1",
          turnId: "turn-1",
          toolCallId: "tool-1"
        }
      });
      expect(mapped).toMatchObject({
        method: route.method,
        displayName: "terminal",
        action: route.action,
        readOnly: route.readOnly
      });
      expect(mapped?.payload).toMatchObject({
        action: route.action,
        runtimeCancellation: {
          sessionId: "agent-1",
          turnId: "turn-1",
          toolCallId: "tool-1"
        }
      });
      const risk = terminalPermissionRisk(route.action, {});
      if (route.readOnly) {
        expect(risk).toBe("none");
      } else {
        expect(risk).not.toBe("none");
      }
    }

    expect(terminalPermissionRisk("write", { command: "npm test" })).toBe("shell");
  });

  test("UI terminal target resolution fails clearly when no pane is available", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const observationService = {
      listTerminalPanes: vi.fn(async () => ({ active: null, panes: [] })),
      focusTerminalPane: vi.fn()
    } as unknown as WorkbenchObservationService;
    const bridge = createAgentIpcBridge({
      runtimeClient: createRuntimeClient(registered),
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: createTerminalBridgeMock() as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService,
      workbenchState: createWorkbenchStateMock()
    });

    await expect(registered.get("terminal.read")?.({
      target: "ui",
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-read" }
    })).rejects.toThrow("No UI terminal pane is available");

    bridge.dispose();
  });

  test("terminal read tolerates null memory from host runtime", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const terminalBridge = createTerminalBridgeMock();
    const bridge = createAgentIpcBridge({
      runtimeClient: createRuntimeClient(registered),
      storageRoot: "/tmp/lyra-agent-test",
      terminalBridge: terminalBridge as never,
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => null,
      workbenchState: createWorkbenchStateMock()
    });

    const writeResult = await registered.get("terminal.write")?.({
      text: "echo ready",
      appendNewline: true,
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-write" }
    }) as { readonly target?: { readonly sessionId?: string } };
    const privateSessionId = writeResult.target?.sessionId ?? "private-terminal-1";
    terminalBridge.readObservation.mockResolvedValueOnce({
      sessionId: privateSessionId,
      cursor: "12",
      output: "ready",
      running: true,
      exitCode: null,
      truncated: false,
      source: "agent",
      mode: "shell",
      memory: null
    } as never);

    await expect(registered.get("terminal.read")?.({
      runtimeCancellation: { sessionId: "agent-1", turnId: "turn-1", toolCallId: "tool-read" }
    })).resolves.toMatchObject({
      sessionId: privateSessionId,
      output: "ready",
      running: true
    });

    bridge.dispose();
  });
});
