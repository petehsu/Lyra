import { describe, expect, test } from "vitest";

import type { AgentRuntimeEvent } from "../../../shared/agent";
import { agentRuntimeEventKey, mergeAgentRuntimeEvent } from "../runtime-event-forwarder";

const messageDelta = (
  delta: string,
  extra: Partial<Extract<AgentRuntimeEvent, { kind: "messageDelta" }>> = {}
): AgentRuntimeEvent => ({
  kind: "messageDelta",
  sessionId: "session-1",
  messageId: "message-1",
  blockId: "text-0",
  delta,
  ...extra
});

describe("mergeAgentRuntimeEvent", () => {
  test("concatenates streamed deltas", () => {
    const merged = mergeAgentRuntimeEvent(messageDelta("Hel"), messageDelta("lo"));
    expect(merged.kind).toBe("messageDelta");
    if (merged.kind === "messageDelta") {
      expect(merged.delta).toBe("Hello");
    }
  });

  test("replace deltas override entirely", () => {
    const first = messageDelta("stale");
    const second = messageDelta("fresh", { replace: true });
    const merged = mergeAgentRuntimeEvent(first, second);
    expect(merged.kind).toBe("messageDelta");
    if (merged.kind === "messageDelta") {
      expect(merged.delta).toBe("fresh");
    }
  });

  test("uses one latest-wins key for a session snapshot", () => {
    const event = {
      kind: "sessionSnapshot",
      snapshot: { id: "session-1" }
    } as AgentRuntimeEvent;

    expect(agentRuntimeEventKey(event)).toBe("sessionSnapshot:session-1");
  });
});
