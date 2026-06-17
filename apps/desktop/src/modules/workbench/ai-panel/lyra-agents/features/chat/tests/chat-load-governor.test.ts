import { describe, expect, test } from "vitest";

import { createChatLoadGovernor, type ChatLoadGovernorConfig } from "../chat-load-governor";

const config: ChatLoadGovernorConfig = {
  initialBudgetViewportRatio: 0.8,
  loadBudgetViewportRatio: 1,
  minBudgetViewportRatio: 0.5,
  maxBudgetViewportRatio: 2.5,
  smoothFrameMs: 20,
  jankFrameMs: 32,
  fastPrependMs: 50,
  slowPrependMs: 120,
  increaseFactor: 1.25,
  decreaseFactor: 0.6,
  frameSampleSize: 24,
  minMultiplier: 0.5,
  maxMultiplier: 2
};

describe("createChatLoadGovernor", () => {
  test("defers loads while layout is resizing", () => {
    const governor = createChatLoadGovernor(config);
    expect(governor.shouldDeferLoad(true)).toBe(true);
    expect(governor.shouldDeferLoad(false)).toBe(false);
  });

  test("reduces budget multiplier after janky frames", () => {
    const governor = createChatLoadGovernor(config);
    for (let index = 0; index < 12; index += 1) {
      governor.recordFrameDelta(40);
    }
    expect(governor.multiplier()).toBeLessThan(1);
    expect(governor.requestLoadBudget(400)).toBeLessThan(400);
  });

  test("increases budget multiplier after fast prepend", () => {
    const governor = createChatLoadGovernor(config);
    governor.recordPrependDuration(20);
    expect(governor.multiplier()).toBeGreaterThan(1);
    expect(governor.requestLoadBudget(400)).toBeGreaterThan(400);
  });
});