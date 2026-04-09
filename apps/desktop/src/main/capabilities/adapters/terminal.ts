import type { LyraAppManifest } from "@lyra/capability-protocol";
import type {
  TerminalCapabilitySessionWriteRequest,
  TerminalExecRequest,
  TerminalIpcBridge
} from "../../terminal/types";
import type { CapabilityRegistry } from "../registry";

const TERMINAL_APP_ID = "terminal";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

export const registerTerminalCapabilities = (
  registry: CapabilityRegistry,
  bridge: TerminalIpcBridge
): LyraAppManifest => {
  registry.register(
    {
      id: "terminal.exec",
      domain: "terminal",
      kind: "action",
      title: "Execute Terminal Command",
      appId: TERMINAL_APP_ID,
      operation: "exec",
      permissions: ["terminal:exec"],
      risk: "command",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeoutMs: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      },
      eventSchema: {
        type: "object"
      }
    },
    async (request, context) => {
      const payload = asRecord(request.payload);
      const command = typeof payload.command === "string" ? payload.command.trim() : "";
      if (command.length === 0) {
        throw new Error("command is required");
      }
      const cwd = typeof payload.cwd === "string" && payload.cwd.trim().length > 0
        ? payload.cwd.trim()
        : request.context?.workspaceRoot;
      const timeoutMs = typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
        ? Math.max(1000, Math.round(payload.timeoutMs))
        : 90_000;
      context.emit({
        phase: "progress",
        payload: {
          status: "launching",
          command
        }
      });
      const result = await bridge.executeCommand({
        command,
        ...(cwd === undefined ? {} : { cwd }),
        timeoutMs
      } satisfies TerminalExecRequest);
      context.emit({
        phase: "progress",
        payload: {
          status: "collected-output",
          sessionId: result.sessionId,
          exitCode: result.exitCode
        }
      });
      return result;
    }
  );

  registry.register(
    {
      id: "terminal.session.start",
      domain: "terminal",
      kind: "action",
      title: "Start Terminal Session",
      appId: TERMINAL_APP_ID,
      operation: "session.start",
      description: "Open an interactive terminal session for app or automation workflows.",
      permissions: ["terminal:exec"],
      risk: "command",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["command", "shell"] },
          command: { type: "string" },
          title: { type: "string" },
          cwd: { type: "string" },
          cols: { type: "number" },
          rows: { type: "number" },
          shell: { type: "string" },
          persist: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const cwd = typeof payload.cwd === "string" && payload.cwd.trim().length > 0
        ? payload.cwd
        : request.context?.workspaceRoot;
      return await bridge.startCapabilitySession({
        ...(typeof payload.title === "string" ? { title: payload.title } : {}),
        ...(cwd === undefined ? {} : { cwd }),
        ...(typeof payload.cols === "number" ? { cols: payload.cols } : {}),
        ...(typeof payload.rows === "number" ? { rows: payload.rows } : {}),
        ...(typeof payload.shell === "string" ? { shell: payload.shell } : {}),
        ...(payload.mode === "command" || payload.mode === "shell" ? { mode: payload.mode } : {}),
        ...(typeof payload.command === "string" ? { command: payload.command } : {}),
        ...(typeof payload.persist === "boolean" ? { persist: payload.persist } : {})
      });
    }
  );

  registry.register(
    {
      id: "terminal.session.read",
      domain: "terminal",
      kind: "action",
      title: "Read Terminal Session Output",
      appId: TERMINAL_APP_ID,
      operation: "session.read",
      description: "Read incremental output from an existing terminal session.",
      permissions: ["terminal:exec"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId"],
        properties: {
          sessionId: { type: "string" },
          cursor: { type: "string" },
          maxBytes: { type: "number" },
          waitMs: { type: "number" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
      if (sessionId.length === 0) {
        throw new Error("sessionId is required");
      }
      return await bridge.readCapabilitySession({
        sessionId,
        ...(typeof payload.cursor === "string" ? { cursor: payload.cursor } : {}),
        ...(typeof payload.maxBytes === "number" ? { maxBytes: payload.maxBytes } : {}),
        ...(typeof payload.waitMs === "number" ? { waitMs: payload.waitMs } : {})
      });
    }
  );

  registry.register(
    {
      id: "terminal.session.write",
      domain: "terminal",
      kind: "action",
      title: "Write Terminal Session Input",
      appId: TERMINAL_APP_ID,
      operation: "session.write",
      description: "Send stdin text to an existing capability-owned terminal session.",
      permissions: ["terminal:exec"],
      risk: "command",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId"],
        properties: {
          sessionId: { type: "string" },
          data: { type: "string" },
          text: { type: "string" },
          keys: {
            type: "array",
            items: {
              type: "string",
              enum: ["enter", "escape", "tab", "ctrl_c", "ctrl_d", "up", "down", "left", "right", "page_up", "page_down", "home", "end"]
            }
          },
          appendNewline: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
      if (sessionId.length === 0) {
        throw new Error("sessionId is required");
      }
      const writeRequest: TerminalCapabilitySessionWriteRequest = { sessionId };
      if (typeof payload.data === "string") {
        Object.assign(writeRequest, { data: payload.data });
      }
      if (typeof payload.text === "string") {
        Object.assign(writeRequest, { text: payload.text });
      }
      if (Array.isArray(payload.keys)) {
        Object.assign(writeRequest, {
          keys: payload.keys as TerminalCapabilitySessionWriteRequest["keys"]
        });
      }
      if (typeof payload.appendNewline === "boolean") {
        Object.assign(writeRequest, { appendNewline: payload.appendNewline });
      }
      await bridge.writeCapabilitySession(writeRequest);
      return {
        written: true,
        sessionId
      };
    }
  );

  registry.register(
    {
      id: "terminal.session.close",
      domain: "terminal",
      kind: "action",
      title: "Close Terminal Session",
      appId: TERMINAL_APP_ID,
      operation: "session.close",
      description: "Close a capability-owned interactive terminal session.",
      permissions: ["terminal:exec"],
      risk: "command",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["sessionId"],
        properties: {
          sessionId: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
      if (sessionId.length === 0) {
        throw new Error("sessionId is required");
      }
      await bridge.closeCapabilitySession({ sessionId });
      return {
        closed: true,
        sessionId
      };
    }
  );

  return {
    id: TERMINAL_APP_ID,
    title: "Terminal",
    version: "0.1.0",
    source: "builtin",
    permissions: ["terminal:exec"],
    capabilities: [
      "terminal.exec",
      "terminal.session.start",
      "terminal.session.read",
      "terminal.session.write",
      "terminal.session.close"
    ],
    compatibility: {
      minApiVersion: "0.1.0",
      platforms: ["macos", "windows", "linux"]
    },
    contributes: {
      surfaces: ["workspace", "background"]
    }
  };
};
