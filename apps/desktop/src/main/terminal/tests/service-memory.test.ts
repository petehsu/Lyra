import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

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

import {
  LYRA_CHANNELS,
  type TerminalArtifactsListResponse,
  type TerminalCommandsReadResponse,
  type TerminalEventsReadResponse,
  type TerminalMemoryTimelineReadResponse,
  type TerminalOutputRangeReadResponse,
  type TerminalReadResponse,
  type TerminalScreenReadResponse,
  type TerminalSessionSnapshot
} from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient, RuntimeEventListener } from "../../runtime-client";
import { LYRA_PROMPT_READY_MARKER } from "../prompt-stream";
import { createTerminalIpcBridge } from "../service";

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "lyra-terminal-service-memory-"));
  roots.push(root);
  return root;
};

afterEach(async () => {
  electronMock.handlers.clear();
  electronMock.ipcMain.handle.mockClear();
  electronMock.ipcMain.removeHandler.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal IPC bridge memory delegation", () => {
  test("passes storage root and memory correlation to Rust runtime", async () => {
    const listeners: RuntimeEventListener[] = [];
    const sentEvents: unknown[] = [];
    const root = await createRoot();
    const snapshot: TerminalSessionSnapshot = {
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
    const memory = {
      eventLogPath: join(root, "terminal-memory/sessions/terminal-session-1/events.jsonl"),
      summaryPath: join(root, "terminal-memory/sessions/terminal-session-1/summary.json"),
      uiTimelinePath: join(root, "terminal-memory/sessions/terminal-session-1/ui-timeline.jsonl"),
      outputTextPath: join(root, "terminal-memory/sessions/terminal-session-1/outputs/session-output.txt"),
      rawOutputPath: join(root, "terminal-memory/sessions/terminal-session-1/outputs/session-output.raw"),
      lineIndexPath: join(root, "terminal-memory/sessions/terminal-session-1/outputs/session-output.lines.jsonl"),
      errorIndexPath: join(root, "terminal-memory/sessions/terminal-session-1/outputs/session-output.errors.jsonl"),
      commandsPath: join(root, "terminal-memory/sessions/terminal-session-1/commands.jsonl"),
      eventSeqRange: { start: 1, end: 3 },
      outputByteRange: { start: 0, end: 12 },
      estimatedTokens: 4,
      lineCount: 1,
      errorCount: 0,
      truncatedByProjection: false
    };
    const timeline: TerminalMemoryTimelineReadResponse = {
      sessionId: "terminal-session-1",
      cursor: null,
      nextCursor: null,
      hasMore: false,
      summary: {
        terminalSessionId: "terminal-session-1",
        itemCount: 1,
        eventCount: 1,
        lineCount: 1,
        errorCount: 0,
        estimatedTokens: 4
      },
      memory,
      items: [
        {
          itemId: "terminal-timeline-terminal-session-1-1",
          terminalSessionId: "terminal-session-1",
          seq: 1,
          kind: "session_created",
          actorKind: "human_user",
          actorLabel: "Human",
          createdAt: "2026-06-01T00:00:00.000Z",
          title: "Session created"
        }
      ]
    };
    const events: TerminalEventsReadResponse = {
      sessionId: "terminal-session-1",
      cursor: "0",
      nextCursor: "1",
      hasMore: false,
      memory,
      items: [
        {
          eventId: "terminal-event-1",
          terminalSessionId: "terminal-session-1",
          seq: 1,
          kind: "session_created",
          actor: { kind: "human_user" },
          payload: { title: "Terminal" },
          createdAt: "2026-06-01T00:00:00.000Z",
          correlation: { terminalTabId: "tab-1" },
          visibility: "user_visible",
          modelContextPolicy: "include_as_runtime_state",
          uiPolicy: "show_as_status",
          auditPolicy: "full"
        }
      ]
    };
    const commands: TerminalCommandsReadResponse = {
      sessionId: "terminal-session-1",
      cursor: "0",
      nextCursor: "1",
      hasMore: false,
      memory,
      items: [
        {
          commandSeq: 1,
          commandId: "command-1",
          terminalSessionId: "terminal-session-1",
          commandText: "npm test",
          normalizedCommandText: "npm test",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          status: "running",
          exitCode: null,
          signal: null,
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.write" },
          confidence: 0.6,
          recordedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    };
    const outputRange: TerminalOutputRangeReadResponse = {
      sessionId: "terminal-session-1",
      raw: false,
      encoding: "utf8",
      requestedRange: { start: 0, end: 6 },
      range: { start: 0, end: 6 },
      nextStart: 6,
      byteLength: 6,
      totalBytes: 12,
      output: "prompt",
      truncated: false,
      memory
    };
    const artifacts: TerminalArtifactsListResponse = {
      sessionId: "terminal-session-1",
      memory,
      items: [
        {
          artifactId: "terminal-artifact-events-jsonl",
          label: "events.jsonl",
          path: memory.eventLogPath,
          kind: "journal",
          role: "event_journal",
          byteLength: 128,
          exists: true
        }
      ]
    };
    const screenResponse: TerminalScreenReadResponse = {
      sessionId: "terminal-session-1",
      cursor: "3",
      screenVersion: 3,
      rows: 24,
      cols: 80,
      mode: "normal",
      visibleText: "prompt % ",
      visibleRows: [{ row: 0, text: "prompt % ", wrapped: false }],
      scrollbackText: null,
      scrollbackCursor: "0",
      scrollbackRows: [],
      cursorPosition: { row: 0, col: 9, visible: true },
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
      prompt: null,
      regions: [],
      running: true,
      exitCode: null,
      truncated: false,
      memory
    };
    const attachment = {
      attachmentId: "attachment-1",
      terminalSessionId: "terminal-session-1",
      agentSessionId: "agent-1",
      runtimeTurnId: "turn-1",
      toolCallId: "tool-1",
      mode: "control",
      status: "active",
      permissionId: "permission-1",
      attachedAt: "2026-06-01T00:00:00.000Z"
    };
    const contractResponses = new Map<string, unknown>([
      [
        "terminal.waitUntil",
        {
          sessionId: "terminal-session-1",
          matched: false,
          reason: "timeout",
          cursor: "12",
          screenCursor: "3",
          memory
        }
      ],
      [
        "terminal.input.execute",
        {
          sessionId: "terminal-session-1",
          inputId: "input-1",
          action: "runCommand",
          status: "notImplemented",
          permissionId: "permission-1",
          events: [],
          memory
        }
      ],
      [
        "terminal.permissions.evaluate",
        {
          sessionId: "terminal-session-1",
          permissionId: "permission-1",
          decision: "needsApproval",
          risk: "shell",
          memory
        }
      ],
      [
        "terminal.permissions.respond",
        {
          sessionId: "terminal-session-1",
          permissionId: "permission-1",
          decision: "allow",
          memory
        }
      ],
      [
        "terminal.processes.read",
        {
          sessionId: "terminal-session-1",
          pid: 42,
          foregroundPid: 42,
          running: true,
          processes: [],
          memory
        }
      ],
      [
        "terminal.processes.signal",
        {
          sessionId: "terminal-session-1",
          pid: 42,
          signal: "SIGTERM",
          status: "notImplemented",
          permissionId: "permission-1",
          memory
        }
      ],
      [
        "terminal.command.status",
        {
          sessionId: "terminal-session-1",
          commandId: "command-1",
          command: null,
          memory
        }
      ],
      [
        "terminal.command.wait",
        {
          sessionId: "terminal-session-1",
          commandId: "command-1",
          status: "timeout",
          reason: "timeout",
          memory
        }
      ],
      [
        "terminal.command.readOutput",
        {
          ...outputRange,
          commandId: "command-1"
        }
      ],
      [
        "terminal.map.read",
        {
          sessionId: "terminal-session-1",
          screen: screenResponse,
          regions: [],
          memory
        }
      ],
      [
        "terminal.act.execute",
        {
          sessionId: "terminal-session-1",
          actId: "act-1",
          status: "notImplemented",
          permissionId: "permission-1",
          memory
        }
      ],
      [
        "terminal.attachments.attach",
        {
          sessionId: "terminal-session-1",
          attachment,
          permissionId: "permission-1",
          memory
        }
      ],
      [
        "terminal.attachments.detach",
        {
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          status: "detached",
          memory
        }
      ],
      [
        "terminal.attachments.list",
        {
          sessionId: "terminal-session-1",
          items: [attachment],
          memory
        }
      ],
      [
        "terminal.attachments.pause",
        {
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          status: "paused",
          memory
        }
      ],
      [
        "terminal.attachments.resume",
        {
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          status: "active",
          memory
        }
      ]
    ]);
    const request = vi.fn(async (method: string, payload: unknown) => {
      if (method === "terminal.sessions.create") {
        return snapshot;
      }
      if (method === "terminal.sessions.restore") {
        return [snapshot];
      }
      if (method === "terminal.sessions.write") {
        return undefined;
      }
      if (method === "terminal.sessions.resize") {
        return undefined;
      }
      if (method === "terminal.sessions.read") {
        return {
          sessionId: "terminal-session-1",
          cursor: "12",
          output: "prompt % ",
          running: true,
          exitCode: null,
          truncated: false,
          source: "user",
          mode: "shell",
          memory
        } satisfies TerminalReadResponse;
      }
      if (method === "terminal.sessions.close") {
        return undefined;
      }
      if (method === "terminal.memory.readTimeline") {
        return timeline;
      }
      if (method === "terminal.events.read") {
        return events;
      }
      if (method === "terminal.commands.read") {
        return commands;
      }
      if (method === "terminal.output.readRange") {
        return outputRange;
      }
      if (method === "terminal.artifacts.list") {
        return artifacts;
      }
      if (method === "terminal.screen.read") {
        return screenResponse;
      }
      if (contractResponses.has(method)) {
        return contractResponses.get(method);
      }
      throw new Error(`Unexpected runtime method ${method}`);
    });
    const runtimeClient = {
      request,
      subscribe: vi.fn((next: RuntimeEventListener) => {
        listeners.push(next);
        return () => {
          listeners.splice(listeners.indexOf(next), 1);
        };
      }),
      registerRequestHandler: vi.fn(),
      unregisterRequestHandler: vi.fn(),
      dispose: vi.fn()
    } as unknown as LyraRuntimeClient;
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: vi.fn((channel: string, event: unknown) => {
          sentEvents.push({ channel, event });
        })
      }
    };

    const bridge = createTerminalIpcBridge(root, runtimeClient, () => window as never);

    await bridge.createSession({
      sessionId: "terminal-session-1",
      title: "Terminal",
      cwd: "/workspace",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
      source: "agent",
      mode: "shell",
      persist: true,
      actor: { kind: "human_user" },
      correlation: { terminalTabId: "tab-1" }
    });
    await bridge.write({
      sessionId: "terminal-session-1",
      text: "npm test",
      appendNewline: true,
      source: "agent",
      actor: { kind: "agent", agentSessionId: "agent-1" },
      correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.write" }
    });
    const read = await bridge.readObservation({
      sessionId: "terminal-session-1",
      cursor: "0",
      maxBytes: 1024
    });
    expect(read.memory).toBe(memory);
    const screen = await bridge.readScreen({
      sessionId: "terminal-session-1",
      maxBytes: 1024
    });
    expect(screen.memory).toBe(memory);
    expect(screen.visibleText).toBe("prompt % ");

    const timelineHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalReadMemoryTimeline);
    if (timelineHandler === undefined) throw new Error("Expected timeline IPC handler");
    await expect(timelineHandler({}, {
      sessionId: "terminal-session-1",
      limit: 10
    })).resolves.toBe(timeline);
    const eventsHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalReadEvents);
    if (eventsHandler === undefined) throw new Error("Expected events IPC handler");
    await expect(eventsHandler({}, {
      sessionId: "terminal-session-1",
      cursor: "0",
      limit: 10,
      kinds: ["session_created"],
      actors: ["human_user"]
    })).resolves.toBe(events);
    await expect(bridge.readEvents({
      sessionId: "terminal-session-1",
      cursor: "0",
      limit: 10
    })).resolves.toBe(events);
    const commandsHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalReadCommands);
    if (commandsHandler === undefined) throw new Error("Expected commands IPC handler");
    await expect(commandsHandler({}, {
      sessionId: "terminal-session-1",
      cursor: "0",
      limit: 10,
      status: "running"
    })).resolves.toBe(commands);
    await expect(bridge.readCommands({
      sessionId: "terminal-session-1",
      cursor: "0",
      limit: 10
    })).resolves.toBe(commands);
    const outputRangeHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalReadOutputRange);
    if (outputRangeHandler === undefined) throw new Error("Expected output range IPC handler");
    await expect(outputRangeHandler({}, {
      sessionId: "terminal-session-1",
      start: 0,
      end: 6,
      raw: false
    })).resolves.toBe(outputRange);
    await expect(bridge.readOutputRange({
      sessionId: "terminal-session-1",
      start: 0,
      end: 6
    })).resolves.toBe(outputRange);
    const artifactsHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalListArtifacts);
    if (artifactsHandler === undefined) throw new Error("Expected artifacts IPC handler");
    await expect(artifactsHandler({}, {
      sessionId: "terminal-session-1"
    })).resolves.toBe(artifacts);
    await expect(bridge.listArtifacts({
      sessionId: "terminal-session-1"
    })).resolves.toBe(artifacts);

    await expect(bridge.readMemoryTimeline({
      sessionId: "terminal-session-1",
      limit: 10
    })).resolves.toBe(timeline);

    const restoreHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalRestoreSessions);
    if (restoreHandler === undefined) throw new Error("Expected restore IPC handler");
    await expect(restoreHandler({}, {
      sessions: [
        {
          sessionId: "terminal-session-1",
          cols: 80,
          rows: 24,
          source: "user",
          mode: "command",
          command: "true"
        }
      ]
    })).resolves.toEqual([snapshot]);

    const resizeHandler = electronMock.handlers.get(LYRA_CHANNELS.terminalResizeSession);
    if (resizeHandler === undefined) throw new Error("Expected resize IPC handler");
    await expect(resizeHandler({}, {
      sessionId: "terminal-session-1",
      cols: 100,
      rows: 30,
      actor: { kind: "agent", agentSessionId: "agent-1" },
      correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.resize" }
    })).resolves.toBeUndefined();
    await expect(bridge.resize({
      sessionId: "terminal-session-1",
      cols: 100,
      rows: 30,
      actor: { kind: "agent", agentSessionId: "agent-1" },
      correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.resize" }
    })).resolves.toBeUndefined();

    const contractCalls = [
      {
        channel: LYRA_CHANNELS.terminalWaitUntil,
        method: "terminal.waitUntil",
        payload: {
          sessionId: "terminal-session-1",
          target: "output",
          text: "ready",
          cursor: "0",
          timeoutMs: 50
        },
        bridgeCall: () => bridge.waitUntil({
          sessionId: "terminal-session-1",
          target: "output",
          text: "ready",
          cursor: "0",
          timeoutMs: 50
        })
      },
      {
        channel: LYRA_CHANNELS.terminalInputExecute,
        method: "terminal.input.execute",
        payload: {
          sessionId: "terminal-session-1",
          action: "runCommand",
          command: "npm test",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_run" }
        },
        bridgeCall: () => bridge.executeInput({
          sessionId: "terminal-session-1",
          action: "runCommand",
          command: "npm test",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_run" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalPermissionsEvaluate,
        method: "terminal.permissions.evaluate",
        payload: {
          sessionId: "terminal-session-1",
          action: "runCommand",
          risk: "shell",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_run" }
        },
        bridgeCall: () => bridge.evaluatePermission({
          sessionId: "terminal-session-1",
          action: "runCommand",
          risk: "shell",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_run" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalPermissionsRespond,
        method: "terminal.permissions.respond",
        payload: {
          sessionId: "terminal-session-1",
          permissionId: "permission-1",
          decision: "allow",
          actor: { kind: "human_user" },
          correlation: { permissionId: "permission-1" }
        },
        bridgeCall: () => bridge.respondPermission({
          sessionId: "terminal-session-1",
          permissionId: "permission-1",
          decision: "allow",
          actor: { kind: "human_user" },
          correlation: { permissionId: "permission-1" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalProcessesRead,
        method: "terminal.processes.read",
        payload: {
          sessionId: "terminal-session-1",
          includeTree: true
        },
        bridgeCall: () => bridge.readProcesses({
          sessionId: "terminal-session-1",
          includeTree: true
        })
      },
      {
        channel: LYRA_CHANNELS.terminalProcessesSignal,
        method: "terminal.processes.signal",
        payload: {
          sessionId: "terminal-session-1",
          pid: 42,
          signal: "SIGTERM",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_signal" }
        },
        bridgeCall: () => bridge.signalProcess({
          sessionId: "terminal-session-1",
          pid: 42,
          signal: "SIGTERM",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_signal" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalCommandStatus,
        method: "terminal.command.status",
        payload: {
          sessionId: "terminal-session-1",
          commandId: "command-1"
        },
        bridgeCall: () => bridge.readCommandStatus({
          sessionId: "terminal-session-1",
          commandId: "command-1"
        })
      },
      {
        channel: LYRA_CHANNELS.terminalCommandWait,
        method: "terminal.command.wait",
        payload: {
          sessionId: "terminal-session-1",
          commandId: "command-1",
          timeoutMs: 50
        },
        bridgeCall: () => bridge.waitCommand({
          sessionId: "terminal-session-1",
          commandId: "command-1",
          timeoutMs: 50
        })
      },
      {
        channel: LYRA_CHANNELS.terminalCommandReadOutput,
        method: "terminal.command.readOutput",
        payload: {
          sessionId: "terminal-session-1",
          commandId: "command-1",
          start: 0,
          end: 6
        },
        bridgeCall: () => bridge.readCommandOutput({
          sessionId: "terminal-session-1",
          commandId: "command-1",
          start: 0,
          end: 6
        })
      },
      {
        channel: LYRA_CHANNELS.terminalMapRead,
        method: "terminal.map.read",
        payload: {
          sessionId: "terminal-session-1",
          screenCursor: "3",
          maxRegions: 20
        },
        bridgeCall: () => bridge.readMap({
          sessionId: "terminal-session-1",
          screenCursor: "3",
          maxRegions: 20
        })
      },
      {
        channel: LYRA_CHANNELS.terminalActExecute,
        method: "terminal.act.execute",
        payload: {
          sessionId: "terminal-session-1",
          action: "confirm",
          regionId: "region-1",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_act" }
        },
        bridgeCall: () => bridge.executeAct({
          sessionId: "terminal-session-1",
          action: "confirm",
          regionId: "region-1",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_act" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalAttachmentsAttach,
        method: "terminal.attachments.attach",
        payload: {
          sessionId: "terminal-session-1",
          agentSessionId: "agent-1",
          runtimeTurnId: "turn-1",
          toolCallId: "tool-1",
          mode: "control",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_attach_agent" }
        },
        bridgeCall: () => bridge.attachAgent({
          sessionId: "terminal-session-1",
          agentSessionId: "agent-1",
          runtimeTurnId: "turn-1",
          toolCallId: "tool-1",
          mode: "control",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_attach_agent" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalAttachmentsDetach,
        method: "terminal.attachments.detach",
        payload: {
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_detach_agent" }
        },
        bridgeCall: () => bridge.detachAgent({
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          actor: { kind: "agent", agentSessionId: "agent-1" },
          correlation: { agentSessionId: "agent-1", terminalToolName: "terminal_detach_agent" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalAttachmentsList,
        method: "terminal.attachments.list",
        payload: {
          sessionId: "terminal-session-1",
          includeDetached: true
        },
        bridgeCall: () => bridge.listAttachments({
          sessionId: "terminal-session-1",
          includeDetached: true
        })
      },
      {
        channel: LYRA_CHANNELS.terminalAttachmentsPause,
        method: "terminal.attachments.pause",
        payload: {
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          actor: { kind: "human_user" },
          correlation: { terminalToolName: "terminal_attach_agent" }
        },
        bridgeCall: () => bridge.pauseAttachment({
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          actor: { kind: "human_user" },
          correlation: { terminalToolName: "terminal_attach_agent" }
        })
      },
      {
        channel: LYRA_CHANNELS.terminalAttachmentsResume,
        method: "terminal.attachments.resume",
        payload: {
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          actor: { kind: "human_user" },
          correlation: { terminalToolName: "terminal_attach_agent" }
        },
        bridgeCall: () => bridge.resumeAttachment({
          sessionId: "terminal-session-1",
          attachmentId: "attachment-1",
          actor: { kind: "human_user" },
          correlation: { terminalToolName: "terminal_attach_agent" }
        })
      }
    ];

    for (const call of contractCalls) {
      const response = contractResponses.get(call.method);
      if (response === undefined) throw new Error(`Expected contract response for ${call.method}`);
      const handler = electronMock.handlers.get(call.channel);
      if (handler === undefined) throw new Error(`Expected IPC handler for ${call.method}`);
      await expect(handler({}, call.payload)).resolves.toBe(response);
      await expect(call.bridgeCall()).resolves.toBe(response);
    }

    await bridge.closeSession({
      sessionId: "terminal-session-1",
      actor: { kind: "agent", agentSessionId: "agent-1" },
      correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.close" }
    });

    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.create",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        actor: { kind: "human_user" },
        correlation: { terminalTabId: "tab-1" }
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.write",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        actor: { kind: "agent", agentSessionId: "agent-1" },
        correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.write" }
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.read",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.memory.readTimeline",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        limit: 10
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.events.read",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        cursor: "0",
        limit: 10,
        kinds: ["session_created"],
        actors: ["human_user"]
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.events.read",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        cursor: "0",
        limit: 10
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.commands.read",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        cursor: "0",
        limit: 10,
        status: "running"
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.commands.read",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        cursor: "0",
        limit: 10
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.output.readRange",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        start: 0,
        end: 6,
        raw: false
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.output.readRange",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        start: 0,
        end: 6
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.artifacts.list",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.screen.read",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        maxBytes: 1024
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.restore",
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            sessionId: "terminal-session-1",
            storageRoot: root
          })
        ]
      })
    );
    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.resize",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        cols: 100,
        rows: 30
      })
    );
    for (const method of contractResponses.keys()) {
      expect(request).toHaveBeenCalledWith(
        method,
        expect.objectContaining({
          sessionId: "terminal-session-1",
          storageRoot: root
        })
      );
    }
    expect(request).toHaveBeenCalledWith(
      "terminal.sessions.close",
      expect.objectContaining({
        sessionId: "terminal-session-1",
        storageRoot: root,
        actor: { kind: "agent", agentSessionId: "agent-1" },
        correlation: { agentSessionId: "agent-1", terminalToolName: "terminal.close" }
      })
    );

    await expect(bridge.attachRenderer({ sessionId: "terminal-session-1" }))
      .resolves
      .toEqual({ sessionId: "terminal-session-1", attached: true });
    const next = listeners[0];
    if (next === undefined) throw new Error("Expected runtime listener");
    next("terminal.runtime", {
      kind: "data",
      sessionId: "terminal-session-1",
      data: `raw\r\n${LYRA_PROMPT_READY_MARKER}prompt % `
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
    expect(sentEvents).toContainEqual(expect.objectContaining({
      channel: LYRA_CHANNELS.terminalEvent,
      event: expect.objectContaining({
        kind: "data",
        sessionId: "terminal-session-1",
        data: "raw\r\nprompt % ",
        dataSeq: 1,
        byteLength: 14
      })
    }));
    await expect(bridge.ackData({
      sessionId: "terminal-session-1",
      dataSeq: 1,
      byteLength: 14
    })).resolves.toBeUndefined();
    sentEvents.length = 0;
    next("terminal.runtime", {
      kind: "data",
      sessionId: "terminal-session-1",
      data: "alpha"
    });
    next("terminal.runtime", {
      kind: "data",
      sessionId: "terminal-session-1",
      data: "beta"
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
    expect(sentEvents).toContainEqual(expect.objectContaining({
      channel: LYRA_CHANNELS.terminalEvent,
      event: expect.objectContaining({
        kind: "data",
        sessionId: "terminal-session-1",
        data: "alpha",
        dataSeq: 2,
        byteLength: 5
      })
    }));
    expect(sentEvents).toContainEqual(expect.objectContaining({
      channel: LYRA_CHANNELS.terminalEvent,
      event: expect.objectContaining({
        kind: "data",
        sessionId: "terminal-session-1",
        data: "beta",
        dataSeq: 3,
        byteLength: 4
      })
    }));
    await expect(bridge.ackData({
      sessionId: "terminal-session-1",
      dataSeq: 2,
      byteLength: 5
    })).resolves.toBeUndefined();
    await expect(bridge.ackData({
      sessionId: "terminal-session-1",
      dataSeq: 3,
      byteLength: 4
    })).resolves.toBeUndefined();
    await expect(bridge.detachRenderer({ sessionId: "terminal-session-1" }))
      .resolves
      .toBeUndefined();

    await expect(stat(join(root, "terminal-memory"))).rejects.toThrow();
    bridge.dispose();
    expect(runtimeClient.subscribe).toHaveBeenCalledOnce();
  });
});
