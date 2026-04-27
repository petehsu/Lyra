import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  BrowserUseRuntimeStatus,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import {
  createUnavailableBrowserUseRuntimeStatusForTests,
  useWorkbenchBrowserUseRuntimeStatus
} from "../use-workbench-browser-use-runtime-status";

describe("useWorkbenchBrowserUseRuntimeStatus", () => {
  test("reports unavailable when the desktop API is absent", async () => {
    const { result } = renderHook(() =>
      useWorkbenchBrowserUseRuntimeStatus(null)
    );

    await waitFor(() => {
      expect(result.current).toMatchObject({
        state: "unavailable",
        reason: "unsupported_platform",
        detail: "desktop api unavailable"
      });
    });
  });

  test("reads the runtime status and applies runtime events", async () => {
    const healthyStatus: BrowserUseRuntimeStatus = {
      state: "healthy",
      checkedAt: 100,
      bundleVersion: "1.0.0"
    };
    const unavailableStatus: BrowserUseRuntimeStatus = {
      state: "unavailable",
      checkedAt: 200,
      reason: "missing_bundle"
    };
    let listener!: (status: BrowserUseRuntimeStatus) => void;
    const unsubscribe = vi.fn();
    const desktopApi = {
      browserUse: {
        readRuntimeStatus: vi.fn().mockResolvedValue(healthyStatus),
        onRuntimeStatus: vi.fn((nextListener: (status: BrowserUseRuntimeStatus) => void) => {
          listener = nextListener;
          return unsubscribe;
        })
      }
    } as unknown as LyraDesktopApi;

    const { result, unmount } = renderHook(() =>
      useWorkbenchBrowserUseRuntimeStatus(desktopApi)
    );

    await waitFor(() => {
      expect(result.current).toEqual(healthyStatus);
    });

    act(() => {
      listener(unavailableStatus);
    });
    expect(result.current).toEqual(unavailableStatus);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("createUnavailableBrowserUseRuntimeStatusForTests", () => {
  test("creates a status payload with the supplied detail", () => {
    expect(createUnavailableBrowserUseRuntimeStatusForTests("missing")).toMatchObject({
      state: "unavailable",
      reason: "unsupported_platform",
      detail: "missing"
    });
  });
});
