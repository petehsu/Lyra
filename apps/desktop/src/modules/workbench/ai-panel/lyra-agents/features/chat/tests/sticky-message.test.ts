import { describe, expect, test } from "vitest";

import type { ChatMessage } from "../../../core/types";
import { CHAT_MESSAGE_GAP_PX } from "../chat-layout-constants";
import { createMessageHeightStore } from "../message-height-table";
import { nextStickyMessageId } from "../sticky-message";

const FALLBACK = 20;
const GAP = CHAT_MESSAGE_GAP_PX;

const makeMessages = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    author: index % 2 === 0 ? "agent" : "user",
    blocks: [{ type: "text", id: `text-${index + 1}`, body: `Message ${index + 1}` }]
  }));

describe("nextStickyMessageId", () => {
  test("returns the last user message fully above the sticky edge", () => {
    const messages = makeMessages(12);
    const ids = messages.map((message) => message.id);
    const store = createMessageHeightStore();
    for (const id of ids) store.setMeasured(id, FALLBACK);

    const stickyId = nextStickyMessageId(
      store,
      ids,
      messages,
      46,
      0,
      null,
      FALLBACK,
      GAP
    );
    expect(stickyId).toBe("message-2");
  });

  test("clears sticky when the anchored message crosses the edge", () => {
    const messages = makeMessages(12);
    const ids = messages.map((message) => message.id);
    const store = createMessageHeightStore();
    for (const id of ids) store.setMeasured(id, FALLBACK);

    const stickyId = nextStickyMessageId(
      store,
      ids,
      messages,
      40,
      0,
      "message-2",
      FALLBACK,
      GAP
    );
    expect(stickyId).toBeNull();
  });
});