import { useCallback, useEffect, useMemo, useRef } from "react";

import type { LyraDesktopApi, WorkbenchBrowserLayoutSnapshot } from "../../../shared/desktop-bridge";

type BrowserPageHostDescriptor = {
  readonly tabId: string;
  readonly zIndex: number;
  readonly isFocusedPane: boolean;
};

const toSnapshot = (
  descriptors: readonly BrowserPageHostDescriptor[],
  hostByTabId: ReadonlyMap<string, HTMLElement>
): WorkbenchBrowserLayoutSnapshot => ({
  windowWidth: Math.round(window.innerWidth),
  windowHeight: Math.round(window.innerHeight),
  layouts: descriptors.map((descriptor) => {
    const host = hostByTabId.get(descriptor.tabId);
    if (host === undefined) {
      return {
        tabId: descriptor.tabId,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
        zIndex: descriptor.zIndex,
        isFocusedPane: descriptor.isFocusedPane
      };
    }
    const rect = host.getBoundingClientRect();
    return {
      tabId: descriptor.tabId,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
      visible: rect.width > 0 && rect.height > 0,
      zIndex: descriptor.zIndex,
      isFocusedPane: descriptor.isFocusedPane
    };
  })
});

export const useWorkbenchBrowserLayoutSync = ({
  desktopApi,
  descriptors
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly descriptors: readonly BrowserPageHostDescriptor[];
}) => {
  const descriptorsRef = useRef(descriptors);
  const hostByTabIdRef = useRef(new Map<string, HTMLElement>());
  const observerByTabIdRef = useRef(new Map<string, ResizeObserver>());
  const frameRef = useRef<number | null>(null);
  const lastSnapshotKeyRef = useRef<string | null>(null);

  const scheduleSync = useCallback(() => {
    if (desktopApi === null) {
      return;
    }
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const snapshot = toSnapshot(descriptorsRef.current, hostByTabIdRef.current);
      const snapshotKey = JSON.stringify(snapshot);
      if (lastSnapshotKeyRef.current === snapshotKey) {
        return;
      }
      lastSnapshotKeyRef.current = snapshotKey;
      void desktopApi.workbenchBrowser.syncLayout(snapshot);
    });
  }, [desktopApi]);

  useEffect(() => {
    descriptorsRef.current = descriptors;
    scheduleSync();
  }, [descriptors, scheduleSync]);

  useEffect(() => {
    const handleWindowResize = (): void => {
      scheduleSync();
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [scheduleSync]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      for (const observer of observerByTabIdRef.current.values()) {
        observer.disconnect();
      }
      observerByTabIdRef.current.clear();
      hostByTabIdRef.current.clear();
      lastSnapshotKeyRef.current = null;
    },
    []
  );

  const registerPageHost = useCallback(
    (tabId: string, element: HTMLElement | null) => {
      const previousHost = hostByTabIdRef.current.get(tabId);
      const previousObserver = observerByTabIdRef.current.get(tabId);
      if (previousObserver !== undefined) {
        previousObserver.disconnect();
        observerByTabIdRef.current.delete(tabId);
      }
      if (element === null) {
        if (previousHost !== undefined) {
          hostByTabIdRef.current.delete(tabId);
          scheduleSync();
        }
        return;
      }
      hostByTabIdRef.current.set(tabId, element);
      const observer = new ResizeObserver(() => {
        scheduleSync();
      });
      observer.observe(element);
      observerByTabIdRef.current.set(tabId, observer);
      if (previousHost !== element) {
        scheduleSync();
      }
    },
    [scheduleSync]
  );

  return useMemo(
    () => ({
      registerPageHost,
      scheduleBrowserLayoutSync: scheduleSync
    }),
    [registerPageHost, scheduleSync]
  );
};
