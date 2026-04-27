import { useEffect, useState } from "react";

import type {
  BrowserUseRuntimeStatus,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";

const createUnavailableBrowserUseRuntimeStatus = (
  detail: string
): BrowserUseRuntimeStatus => ({
  state: "unavailable",
  checkedAt: Date.now(),
  reason: "unsupported_platform",
  detail
});

export const useWorkbenchBrowserUseRuntimeStatus = (
  desktopApi: LyraDesktopApi | null
): BrowserUseRuntimeStatus => {
  const [browserUseRuntimeStatus, setBrowserUseRuntimeStatus] =
    useState<BrowserUseRuntimeStatus>({
      state: "checking",
      checkedAt: Date.now()
    });

  useEffect(() => {
    if (desktopApi === null || desktopApi.browserUse === undefined) {
      setBrowserUseRuntimeStatus(
        createUnavailableBrowserUseRuntimeStatus(
          desktopApi === null
            ? "desktop api unavailable"
            : "browser-use runtime status unavailable"
        )
      );
      return;
    }

    let cancelled = false;
    void desktopApi.browserUse
      .readRuntimeStatus()
      .then((status) => {
        if (!cancelled) {
          setBrowserUseRuntimeStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowserUseRuntimeStatus(
            createUnavailableBrowserUseRuntimeStatus(
              "browser-use runtime status unavailable"
            )
          );
        }
      });

    const unsubscribe = desktopApi.browserUse.onRuntimeStatus((status) => {
      if (!cancelled) {
        setBrowserUseRuntimeStatus(status);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [desktopApi]);

  return browserUseRuntimeStatus;
};

export const createUnavailableBrowserUseRuntimeStatusForTests =
  createUnavailableBrowserUseRuntimeStatus;
