import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useWorkbenchBrowserLayoutSync } from "../browser-layout-sync";
import { notifyLayoutDragFrame, notifyLayoutResizeEnd } from "../layout-resize-end";

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
      browserShell: { syncLayout }
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

  test("paces splitter drag frames and flushes exact bounds on resize end", () => {
    // The pacing math reads performance.now(); drive it from the fake clock.
    let fakeNow = 0;
    const perfSpy = vi
      .spyOn(window.performance, "now")
      .mockImplementation(() => fakeNow);

    const syncLayout = vi.fn();
    const desktopApi = {
      browserShell: { syncLayout }
    } as unknown as LyraDesktopApi;
    const { result, unmount } = renderHook(() =>
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

    const host = document.createElement("div");
    document.body.append(host);
    result.current.registerPageHost("page-1", host);

    let hostWidth = 200;
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: hostWidth,
          bottom: 600,
          width: hostWidth,
          height: 600,
          toJSON: () => ({})
        }) as DOMRect
      );

    try {
      // One drag frame per RAF; each frame re-arms the paced-sync window.
      for (let frame = 0; frame < 30; frame += 1) {
        fakeNow += 16;
        hostWidth += 4;
        act(() => {
          notifyLayoutDragFrame({
            leftWidth: 300 + frame * 4,
            bottomHeight: 200,
            appSidebarWidth: 220
          });
          vi.advanceTimersByTime(16);
        });
      }

      // ~480ms of dragging at 100ms pacing must stay far below one send per frame.
      const dragCalls = syncLayout.mock.calls.length;
      expect(dragCalls).toBeGreaterThan(1);
      expect(dragCalls).toBeLessThanOrEqual(6);

      syncLayout.mockClear();
      act(() => {
        notifyLayoutResizeEnd();
        vi.advanceTimersByTime(50);
      });
      expect(syncLayout).toHaveBeenCalled();
    } finally {
      perfSpy.mockRestore();
      rectSpy.mockRestore();
      host.remove();
    }

    unmount();
  });
});
