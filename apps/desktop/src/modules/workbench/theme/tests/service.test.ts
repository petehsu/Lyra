import { afterEach, describe, expect, test, vi } from "vitest";

import {
  isWorkbenchThemeId,
  observeSystemPrefersDark,
  readSystemPrefersDark,
  resolveThemeVars,
  resolveWorkbenchThemeId
} from "../service";

type MatchMediaLike = {
  matches: boolean;
  addEventListener?: (type: string, listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: string, listener: (event: { matches: boolean }) => void) => void;
  addListener?: (listener: (event: { matches: boolean }) => void) => void;
  removeListener?: (listener: (event: { matches: boolean }) => void) => void;
};

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe("workbench theme service", () => {
  test("validates supported theme ids", () => {
    expect(isWorkbenchThemeId("one-dark")).toBe(true);
    expect(isWorkbenchThemeId("ayu-system")).toBe(true);
    expect(isWorkbenchThemeId("foo-theme")).toBe(false);
  });

  test("resolves *-system themes by prefersDark", () => {
    expect(resolveWorkbenchThemeId("one-system", true)).toBe("one-dark");
    expect(resolveWorkbenchThemeId("one-system", false)).toBe("one-light");
    expect(resolveWorkbenchThemeId("gruvbox-system", true)).toBe("gruvbox-dark");
    expect(resolveWorkbenchThemeId("gruvbox-system", false)).toBe("gruvbox-light");
  });

  test("readSystemPrefersDark returns false when matchMedia is unavailable", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(readSystemPrefersDark()).toBe(false);
  });

  test("observeSystemPrefersDark uses addEventListener when available", () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const media: MatchMediaLike = {
      matches: false,
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      removeEventListener: (_type, listener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      }
    };

    window.matchMedia = vi.fn(() => media as MediaQueryList);

    const onChange = vi.fn();
    const unsubscribe = observeSystemPrefersDark(onChange);

    expect(listeners).toHaveLength(1);
    listeners[0]?.({ matches: true });
    expect(onChange).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });

  test("observeSystemPrefersDark falls back to addListener/removeListener", () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const media: MatchMediaLike = {
      matches: false,
      addListener: (listener) => {
        listeners.push(listener);
      },
      removeListener: (listener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      }
    };

    window.matchMedia = vi.fn(() => media as unknown as MediaQueryList);

    const onChange = vi.fn();
    const unsubscribe = observeSystemPrefersDark(onChange);

    expect(listeners).toHaveLength(1);
    listeners[0]?.({ matches: true });
    expect(onChange).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });

  test("resolveThemeVars falls back to one-light vars for unknown theme", () => {
    const fallback = resolveThemeVars("one-light", false);
    const unknown = resolveThemeVars("unknown-theme" as never, false);
    expect(unknown).toEqual(fallback);
    expect(Object.keys(unknown).length).toBeGreaterThan(0);
  });
});
