import { afterEach, describe, expect, test, vi } from "vitest";

import {
  readTabActivationCoordinatorStateForTests,
  recordUserTabActivation,
  resetTabActivationCoordinatorForTests,
  setBrowserFollowModeEnabled,
  shouldSuppressAgentTabActivation
} from "../tab-activation-coordinator";

describe("tab-activation-coordinator", () => {
  afterEach(() => {
    resetTabActivationCoordinatorForTests();
    vi.useRealTimers();
  });

  test("suppresses agent tab activation shortly after user activation when follow mode is off", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    recordUserTabActivation();

    expect(shouldSuppressAgentTabActivation()).toBe(true);

    vi.advanceTimersByTime(4_999);
    expect(shouldSuppressAgentTabActivation()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(shouldSuppressAgentTabActivation()).toBe(false);
  });

  test("does not suppress agent tab activation when follow mode is on", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    setBrowserFollowModeEnabled(true);
    recordUserTabActivation();

    expect(shouldSuppressAgentTabActivation()).toBe(false);
  });

  test("tracks follow mode state for tests", () => {
    setBrowserFollowModeEnabled(true);
    expect(readTabActivationCoordinatorStateForTests().browserFollowModeEnabled).toBe(true);
  });
});