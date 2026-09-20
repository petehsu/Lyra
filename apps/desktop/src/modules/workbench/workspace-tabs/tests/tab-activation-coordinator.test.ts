import { describe, expect, test } from "vitest";

import {
  recordUserTabActivation,
  shouldSuppressAgentTabActivation
} from "../tab-activation-coordinator";

describe("tab-activation-coordinator", () => {
  test("does not suppress explicit Agent tab activation", () => {
    expect(shouldSuppressAgentTabActivation()).toBe(false);
    recordUserTabActivation();
    expect(shouldSuppressAgentTabActivation()).toBe(false);
  });
});
