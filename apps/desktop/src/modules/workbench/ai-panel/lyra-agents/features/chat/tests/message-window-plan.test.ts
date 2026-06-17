import { describe, expect, test } from "vitest";

import type { ChatMessage } from "../../../core/types";
import {
  createMessageWindowPlanConfig,
  planAdditionalRevealCount,
  planRevealCountFromEnd
} from "../message-window-plan";

const textMessage = (id: string, body: string): ChatMessage => ({
  id,
  author: "agent",
  blocks: [{ type: "text", id: `${id}-text`, body }]
});

const planConfig = createMessageWindowPlanConfig(560, {
  minRevealCount: 3,
  maxRevealCount: 40,
  messageGapPx: 24,
  fallbackHeightPx: 80
});

describe("message-window-plan", () => {
  test("reveals at least minRevealCount from the end", () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      textMessage(`m${index}`, `Message ${index}`)
    );
    const count = planRevealCountFromEnd(messages, 1, planConfig);
    expect(count).toBeGreaterThanOrEqual(planConfig.minRevealCount);
  });

  test("reveals more content for a larger height budget", () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      textMessage(`m${index}`, `Line ${index}\n`.repeat(6))
    );
    const small = planRevealCountFromEnd(messages, 400, planConfig);
    const large = planRevealCountFromEnd(messages, 4000, planConfig);
    expect(large).toBeGreaterThanOrEqual(small);
  });

  test("loads additional hidden messages up to the budget", () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      textMessage(`m${index}`, `Message ${index}`)
    );
    const additional = planAdditionalRevealCount(messages, 12, 1200, planConfig);
    expect(additional).toBeGreaterThanOrEqual(planConfig.minRevealCount);
    expect(additional).toBeLessThanOrEqual(30 - 12);
  });
});