import { describe, expect, test } from "vitest";

import {
  isTerminalAttachmentWriterMode,
  normalizeTerminalAttachmentAttachPayload,
  normalizeTerminalAttachmentMode,
  summarizeTerminalAttachmentResult,
  summarizeTerminalAttachments
} from "../terminal-attachments";

const actor = { kind: "agent" as const, agentSessionId: "agent-1" };
const correlation = {
  agentSessionId: "agent-1",
  terminalToolName: "terminal_attach_agent"
};

describe("terminal attachment helpers", () => {
  test("normalizes attach payloads without trusting unknown modes", () => {
    expect(normalizeTerminalAttachmentMode("CONTROL")).toBe("control");
    expect(normalizeTerminalAttachmentMode("surprise")).toBe("observe");
    expect(isTerminalAttachmentWriterMode("delegated")).toBe(true);
    expect(isTerminalAttachmentWriterMode("observe")).toBe(false);

    const payload = normalizeTerminalAttachmentAttachPayload({
      mode: "takeover",
      ttlMs: 124.8,
      permissionId: "permission-1",
      approved: true
    }, {
      sessionId: "terminal-1",
      agentSessionId: "agent-1",
      actor,
      correlation
    });

    expect(payload).toMatchObject({
      sessionId: "terminal-1",
      agentSessionId: "agent-1",
      mode: "takeover",
      ttlMs: 125,
      permissionId: "permission-1",
      approved: true
    });
  });

  test("summarizes permission and conflict responses from Rust", () => {
    const needsApproval = summarizeTerminalAttachmentResult({
      sessionId: "terminal-1",
      permissionId: "permission-1",
      status: "needsApproval",
      needsApproval: true,
      attachment: {
        attachmentId: "attachment-1",
        terminalSessionId: "terminal-1",
        agentSessionId: "agent-1",
        mode: "control",
        status: "paused",
        permissionId: "permission-1"
      }
    } as never);
    expect(needsApproval.needsApproval).toBe(true);
    expect(needsApproval.message).toContain("permission-1");

    const conflict = summarizeTerminalAttachmentResult({
      sessionId: "terminal-1",
      status: "conflict",
      conflictWithAttachmentId: "attachment-controller",
      attachment: {
        attachmentId: "attachment-2",
        terminalSessionId: "terminal-1",
        agentSessionId: "agent-2",
        mode: "control",
        status: "revoked"
      }
    } as never);
    expect(conflict.status).toBe("conflict");
    expect(conflict.conflictWithAttachmentId).toBe("attachment-controller");
  });

  test("summarizes controller, observers, and child agents for status UI", () => {
    const summary = summarizeTerminalAttachments([
      {
        attachmentId: "attachment-controller",
        terminalSessionId: "terminal-1",
        agentSessionId: "agent-1",
        mode: "control",
        status: "active"
      },
      {
        attachmentId: "attachment-observer",
        terminalSessionId: "terminal-1",
        agentSessionId: "agent-2",
        mode: "observe",
        status: "active"
      },
      {
        attachmentId: "attachment-child",
        terminalSessionId: "terminal-1",
        agentSessionId: "agent-child",
        mode: "delegated",
        status: "active",
        childAgentSessionId: "agent-child"
      } as never
    ]);

    expect(summary.status).toBe("controlled");
    expect(summary.controller?.attachmentId).toBe("attachment-controller");
    expect(summary.observers).toHaveLength(1);
    expect(summary.childAgents).toHaveLength(1);
    expect(summary.label).toContain("agent-1");
  });
});
