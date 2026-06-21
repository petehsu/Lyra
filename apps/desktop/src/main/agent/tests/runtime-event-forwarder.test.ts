import { describe, expect, test } from "vitest";

import type { AgentRenderDocument, AgentRuntimeEvent } from "../../../shared/agent";
import { mergeAgentRuntimeEvent } from "../runtime-event-forwarder";

const doc = (label: string): AgentRenderDocument => ({
  blocks: [{ type: "paragraph", spans: [{ type: "text", text: label }] }] as never
});

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

  test("keeps the incoming render snapshot instead of dropping it (freeze fix)", () => {
    const first = messageDelta("Hel", { renderDocument: doc("Hel"), renderRevision: 1 });
    const second = messageDelta("lo", { renderDocument: doc("Hello"), renderRevision: 2 });
    const merged = mergeAgentRuntimeEvent(first, second);
    expect(merged.kind).toBe("messageDelta");
    if (merged.kind === "messageDelta") {
      expect(merged.delta).toBe("Hello");
      // The latest non-empty snapshot must win; otherwise rich text freezes on
      // the first token's AST until a non-merged event forces a re-render.
      expect(merged.renderDocument).toEqual(doc("Hello"));
      expect(merged.renderRevision).toBe(2);
    }
  });

  test("retains the current snapshot when the incoming delta carries none", () => {
    const first = messageDelta("Hel", { renderDocument: doc("Hel"), renderRevision: 1 });
    const second = messageDelta("lo");
    const merged = mergeAgentRuntimeEvent(first, second);
    expect(merged.kind).toBe("messageDelta");
    if (merged.kind === "messageDelta") {
      expect(merged.delta).toBe("Hello");
      expect(merged.renderDocument).toEqual(doc("Hel"));
      expect(merged.renderRevision).toBe(1);
    }
  });

  test("replace deltas override entirely", () => {
    const first = messageDelta("stale", { renderDocument: doc("stale"), renderRevision: 1 });
    const second = messageDelta("fresh", { replace: true });
    const merged = mergeAgentRuntimeEvent(first, second);
    expect(merged.kind).toBe("messageDelta");
    if (merged.kind === "messageDelta") {
      expect(merged.delta).toBe("fresh");
      expect(merged.renderDocument).toBeUndefined();
    }
  });
});
