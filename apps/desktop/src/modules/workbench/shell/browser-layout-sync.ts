import { useCallback, useEffect, useMemo, useRef } from "react";

import type { LyraDesktopApi, WorkbenchBrowserLayoutSnapshot } from "../../../shared/desktop-bridge";
import { getIsLayoutResizing } from "./use-panel-layout";
import { subscribeLayoutResizeEnd } from "./layout-resize-end";

export type BrowserLayoutSyncOptions = {
  readonly force?: boolean;
  readonly followUpFrames?: number;
  readonly animatedLayoutDurationMs?: number;
  readonly animatedLayoutSyncIntervalMs?: number;
};

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

const DEFAULT_ANIMATED_LAYOUT_SYNC_INTERVAL_MS = 33;
const ANIMATED_LAYOUT_FINAL_SYNC_DELAY_MS = 32;
/** Panel-splitter drags rely on RAF coalescing only (no extra throttle). */

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
  const pendingFrameForceRef = useRef(false);
  const pendingFrameFollowUpsRef = useRef(0);
  const animatedLayoutUntilRef = useRef(0);
  const animatedLayoutSyncIntervalMsRef = useRef(
    DEFAULT_ANIMATED_LAYOUT_SYNC_INTERVAL_MS
  );
  const animatedLayoutTimerRef = useRef<number | null>(null);
  const animatedLayoutFrameLoopRef = useRef<number | null>(null);
  const throttledSyncTimerRef = useRef<number | null>(null);
  const lastSyncAtRef = useRef(0);
  const lastSnapshotKeyRef = useRef<string | null>(null);
  const scheduleSync = useCallback((options?: BrowserLayoutSyncOptions) => {
    const followUpFrames = Math.max(0, Math.round(options?.followUpFrames ?? 0));
    const force = options?.force === true;
    const now = window.performance.now();
    const scheduleFrame = (forceFrame: boolean, remainingFollowUps: number): void => {
      if (desktopApi === null) {
        return;
      }
      pendingFrameForceRef.current =
        pendingFrameForceRef.current || forceFrame;
      pendingFrameFollowUpsRef.current = Math.max(
        pendingFrameFollowUpsRef.current,
        remainingFollowUps
      );
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pendingForce = pendingFrameForceRef.current;
        const pendingFollowUps = pendingFrameFollowUpsRef.current;
        pendingFrameForceRef.current = false;
        pendingFrameFollowUpsRef.current = 0;
        if (desktopApi === null) {
          return;
        }
        const snapshot = toSnapshot(descriptorsRef.current, hostByTabIdRef.current);
        const snapshotKey = JSON.stringify(snapshot);
        if (pendingForce === false && lastSnapshotKeyRef.current === snapshotKey) {
          if (pendingFollowUps > 0) {
            scheduleFrame(false, pendingFollowUps - 1);
          }
          return;
        }
        lastSnapshotKeyRef.current = snapshotKey;
        lastSyncAtRef.current = window.performance.now();
        void desktopApi.workbenchBrowser.syncLayout(snapshot);
        if (pendingFollowUps > 0) {
          scheduleFrame(false, pendingFollowUps - 1);
        }
      });
    };

    const animatedLayoutDurationMs = Math.max(
      0,
      Math.round(options?.animatedLayoutDurationMs ?? 0)
    );
    if (
      animatedLayoutDurationMs > 0
      && descriptorsRef.current.length > 0
    ) {
      animatedLayoutUntilRef.current = Math.max(
        animatedLayoutUntilRef.current,
        now + animatedLayoutDurationMs
      );
      animatedLayoutSyncIntervalMsRef.current = Math.max(
        16,
        Math.round(
          options?.animatedLayoutSyncIntervalMs
            ?? DEFAULT_ANIMATED_LAYOUT_SYNC_INTERVAL_MS
        )
      );
      if (animatedLayoutTimerRef.current !== null) {
        window.clearTimeout(animatedLayoutTimerRef.current);
      }
      if (animatedLayoutFrameLoopRef.current === null) {
        const tickAnimatedLayout = (): void => {
          animatedLayoutFrameLoopRef.current = null;
          if (window.performance.now() >= animatedLayoutUntilRef.current) {
            return;
          }
          scheduleFrame(true, 0);
          animatedLayoutFrameLoopRef.current =
            window.requestAnimationFrame(tickAnimatedLayout);
        };
        animatedLayoutFrameLoopRef.current =
          window.requestAnimationFrame(tickAnimatedLayout);
      }
      animatedLayoutTimerRef.current = window.setTimeout(() => {
        animatedLayoutTimerRef.current = null;
        scheduleSync({
          force: true,
          followUpFrames: 2
        });
      }, animatedLayoutDurationMs + ANIMATED_LAYOUT_FINAL_SYNC_DELAY_MS);
    }

    const animatedLayoutActive =
      force === false && now < animatedLayoutUntilRef.current;
    if (animatedLayoutActive) {
      const elapsedSinceLastSync = now - lastSyncAtRef.current;
      const remainingDelay =
        animatedLayoutSyncIntervalMsRef.current - elapsedSinceLastSync;
      if (remainingDelay > 0) {
        if (throttledSyncTimerRef.current === null) {
          throttledSyncTimerRef.current = window.setTimeout(() => {
            throttledSyncTimerRef.current = null;
            scheduleSync();
          }, remainingDelay);
        }
        return;
      }
    }

    if (desktopApi === null) {
      return;
    }
    scheduleFrame(force, followUpFrames);
  }, [desktopApi]);

  const requestLayoutSync = useCallback((): void => {
    // During splitter drags, coalesce to one sync per animation frame so the
    // embedded BrowserView tracks the sash without the old ~48ms throttle lag.
    scheduleSync(getIsLayoutResizing() ? { force: true } : undefined);
  }, [scheduleSync]);

  useEffect(() => {
    const unsubscribeResizeEnd = subscribeLayoutResizeEnd(() => {
      scheduleSync({
        force: true,
        followUpFrames: 2
      });
    });
    return unsubscribeResizeEnd;
  }, [scheduleSync]);

  useEffect(() => {
    descriptorsRef.current = descriptors;
    requestLayoutSync();
  }, [descriptors, requestLayoutSync]);

  useEffect(() => {
    const handleWindowResize = (): void => {
      requestLayoutSync();
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [requestLayoutSync]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (animatedLayoutTimerRef.current !== null) {
        window.clearTimeout(animatedLayoutTimerRef.current);
        animatedLayoutTimerRef.current = null;
      }
      if (animatedLayoutFrameLoopRef.current !== null) {
        window.cancelAnimationFrame(animatedLayoutFrameLoopRef.current);
        animatedLayoutFrameLoopRef.current = null;
      }
      if (throttledSyncTimerRef.current !== null) {
        window.clearTimeout(throttledSyncTimerRef.current);
        throttledSyncTimerRef.current = null;
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
          requestLayoutSync();
        }
        return;
      }
      hostByTabIdRef.current.set(tabId, element);
      const observer = new ResizeObserver(() => {
        requestLayoutSync();
      });
      observer.observe(element);
      observerByTabIdRef.current.set(tabId, observer);
      if (previousHost !== element) {
        requestLayoutSync();
      }
    },
    [requestLayoutSync]
  );

  return useMemo(
    () => ({
      registerPageHost,
      scheduleBrowserLayoutSync: scheduleSync
    }),
    [registerPageHost, scheduleSync]
  );
};
