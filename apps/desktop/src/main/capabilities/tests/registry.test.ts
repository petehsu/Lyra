import { describe, expect, test, vi } from "vitest";

import { validateCapabilityRegistrySnapshot } from "../../../../../../packages/capability-protocol/src";
import { CapabilityRegistry, AppRegistry } from "../registry";

describe("capability registry", () => {
  test("validates duplicate capability ids", () => {
    const appRegistry = new AppRegistry();
    appRegistry.register({
      id: "file-manager",
      title: "File Manager",
      version: "0.1.0",
      source: "builtin",
      permissions: ["filesystem:read"],
      capabilities: ["filesystem.read"],
      compatibility: { minApiVersion: "0.1.0" },
      contributes: { surfaces: ["workspace"] }
    });
    const registry = new CapabilityRegistry(vi.fn());
    const descriptor = {
      id: "filesystem.read",
      domain: "filesystem",
      kind: "resource",
      title: "Read",
      appId: "file-manager",
      operation: "read",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: { type: "object", required: ["path"] },
      outputSchema: { type: "object" }
    } as const;
    registry.register(descriptor, async () => ({ ok: true }));
    registry.register(descriptor, async () => ({ ok: true }));

    const issues = validateCapabilityRegistrySnapshot(registry.snapshot(appRegistry.list()));
    expect(issues).toEqual([]);
    expect(registry.list()).toHaveLength(1);
  });

  test("returns capability-not-found result for unknown ids", async () => {
    const registry = new CapabilityRegistry(vi.fn());
    const result = await registry.invoke({
      capabilityId: "filesystem.unknown",
      payload: {}
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CAPABILITY_NOT_FOUND");
  });

  test("waits for ask approval before invoking the handler", async () => {
    const events: unknown[] = [];
    const invoke = vi.fn(async () => ({ ok: true }));
    const registry = new CapabilityRegistry((event) => {
      events.push(event);
    });
    registry.register(
      {
        id: "filesystem.write",
        domain: "filesystem",
        kind: "action",
        title: "Write",
        appId: "file-manager",
        operation: "write",
        permissions: ["filesystem:write"],
        risk: "write",
        approvalMode: "ask",
        aiExposure: "full",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" }
      },
      invoke
    );

    const pending = registry.invoke({
      capabilityId: "filesystem.write",
      payload: { path: "/tmp/example.txt" },
      context: { aiSessionId: "session-1", aiTurnId: "turn-1" }
    });

    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    const approvalEvent = events.find(
      (event) =>
        typeof event === "object"
        && event !== null
        && (event as { phase?: unknown }).phase === "approval_requested"
    ) as { payload?: { approvalId?: string } };
    expect(approvalEvent.payload?.approvalId).toBeTypeOf("string");

    await registry.resolveApproval({
      approvalId: approvalEvent.payload?.approvalId ?? "",
      decision: "approved_once"
    });

    const result = await pending;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  test("rejects deny-mode capability calls before invoking the handler", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const registry = new CapabilityRegistry(vi.fn());
    registry.register(
      {
        id: "terminal.exec",
        domain: "terminal",
        kind: "action",
        title: "Exec",
        appId: "terminal",
        operation: "exec",
        permissions: ["terminal:exec"],
        risk: "command",
        approvalMode: "deny",
        aiExposure: "full",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" }
      },
      invoke
    );

    const result = await registry.invoke({
      capabilityId: "terminal.exec",
      payload: { command: "pwd" }
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CAPABILITY_APPROVAL_DENIED");
  });
});
