import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useWorkbenchBrowserLayoutSync } from "../browser-layout-sync";

describe("useWorkbenchBrowserLayoutSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      window.clearTimeout(handle);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("throttles native page resizes while a panel animates", () => {
    const syncLayout = vi.fn();
    const desktopApi = {
      workbenchBrowser: { syncLayout }
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useWorkbenchBrowserLayoutSync({
        desktopApi,
        descriptors: [
          {
            tabId: "page-1",
            zIndex: 0,
            isFocusedPane: true
          }
        ]
      })
    );

    act(() => {
      vi.advanceTimersByTime(20);
    });
    syncLayout.mockClear();

    act(() => {
      result.current.scheduleBrowserLayoutSync({
        force: true,
        animatedLayoutDurationMs: 260,
        animatedLayoutSyncIntervalMs: 33
      });
      vi.advanceTimersByTime(32);
    });

    expect(syncLayout).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(syncLayout.mock.calls.length).toBeGreaterThan(1);
    expect(syncLayout.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
