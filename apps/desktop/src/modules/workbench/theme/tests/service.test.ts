import { afterEach, describe, expect, test, vi } from "vitest";

import { WORKBENCH_BREAKPOINTS } from "../breakpoints";
import { WORKBENCH_FOUNDATION_TOKENS } from "../foundation";
import { WORKBENCH_SEMANTIC_TOKENS } from "../semantic";
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
    expect(isWorkbenchThemeId("lyra-dark")).toBe(true);
    expect(isWorkbenchThemeId("nova-system")).toBe(true);
    expect(isWorkbenchThemeId("foo-theme")).toBe(false);
  });

  test("resolves *-system themes by prefersDark", () => {
    expect(resolveWorkbenchThemeId("lyra-system", true)).toBe("lyra-dark");
    expect(resolveWorkbenchThemeId("lyra-system", false)).toBe("lyra-light");
    expect(resolveWorkbenchThemeId("terra-system", true)).toBe("terra-dark");
    expect(resolveWorkbenchThemeId("terra-system", false)).toBe("terra-light");
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

  test("resolveThemeVars falls back to lyra-light vars for unknown theme", () => {
    const fallback = resolveThemeVars("lyra-light", false);
    const unknown = resolveThemeVars("unknown-theme" as never, false);
    expect(unknown).toEqual(fallback);
    expect(Object.keys(unknown).length).toBeGreaterThan(0);
  });

  test("resolveThemeVars includes foundation and semantic tokens", () => {
    const vars = resolveThemeVars("lyra-light", false);
    expect(vars["--lyra-shell-titlebar-h"]).toBe("var(--lyra-control-h-34)");
    expect(vars["--lyra-control-h-default"]).toBe("var(--lyra-control-h-32)");
    expect(vars["--lyra-font-sans"]).toContain("IBM Plex Sans");
    expect(vars["--lyra-text-size-body"]).toBe("var(--lyra-text-size-13)");
  });

  test("exports breakpoint, foundation, and semantic token registries", () => {
    expect(WORKBENCH_BREAKPOINTS.compact).toBe("980px");
    expect(WORKBENCH_BREAKPOINTS.regular).toBe("1180px");
    expect(WORKBENCH_FOUNDATION_TOKENS["--lyra-space-10"]).toBe("10px");
    expect(WORKBENCH_SEMANTIC_TOKENS["--lyra-dialog-max-w"]).toBe("560px");
  });
});
