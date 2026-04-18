import { describe, expect, test, vi } from "vitest";

import {
  pointerStateForContext,
  readAgentSession,
} from "../service-modules/session-context-helpers";

describe("session context helpers", () => {
  test("readAgentSession returns null without session identifiers", () => {
    const registry = {
      read: vi.fn()
    };

    const session = readAgentSession(registry as any, undefined, "tab-1");
    expect(session).toBeNull();
    expect(registry.read).not.toHaveBeenCalled();
  });

  test("readAgentSession delegates to registry with session ids", () => {
    const expected = { pointer: { x: 1, y: 2 } };
    const registry = {
      read: vi.fn(() => expected)
    };

    const session = readAgentSession(
      registry as any,
      {
        agentSessionId: "session-1",
        agentTurnId: "turn-1"
      },
      "tab-1"
    );

    expect(session).toBe(expected);
    expect(registry.read).toHaveBeenCalledWith("session-1", "turn-1", "tab-1");
  });

  test("pointerStateForContext returns pointerState when available", () => {
    const registry = {
      read: vi.fn(() => ({
        pointer: { x: 32, y: 48, frameTreeNodeId: 1, updatedAt: 123 }
      }))
    };

    const pointerState = pointerStateForContext(
      registry as any,
      {
        agentSessionId: "session-2",
        agentTurnId: "turn-2"
      },
      "tab-2"
    );

    expect(pointerState).toEqual({
      pointerState: { x: 32, y: 48, frameTreeNodeId: 1, updatedAt: 123 }
    });
  });

  test("pointerStateForContext returns empty object without pointer", () => {
    const registry = {
      read: vi.fn(() => ({}))
    };

    const pointerState = pointerStateForContext(
      registry as any,
      {
        agentSessionId: "session-3",
        agentTurnId: "turn-3"
      },
      "tab-3"
    );

    expect(pointerState).toEqual({});
  });
});
