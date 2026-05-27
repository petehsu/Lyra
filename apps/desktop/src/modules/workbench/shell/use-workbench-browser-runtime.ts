import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  LyraDesktopApi,
  WorkbenchBrowserAgentActivityEvent,
  WorkbenchBrowserPageRuntimeState
} from "../../../shared/desktop-bridge";
import {
  areWebThemeSnapshotsEquivalent,
  buildWebThemeSnapshot,
  DEFAULT_WEB_THEME_SNAPSHOT
} from "../../../shared/web-theme";
import type { WorkbenchThemeVars } from "../theme";
import type {
  WorkspaceTabsModel,
  WorkspaceVisibleLayout
} from "../workspace-tabs";
import { useWorkbenchBrowserLayoutSync } from "./browser-layout-sync";

export type PageNavigationState = {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};

type BrowserPageHostDescriptor = {
  readonly tabId: string;
  readonly zIndex: number;
  readonly isFocusedPane: boolean;
};

export type BrowserAgentVisualState = {
  readonly active: boolean;
  readonly inputActive: boolean;
  readonly action: WorkbenchBrowserAgentActivityEvent["action"] | null;
  readonly tabId: string | null;
  readonly targetMode: WorkbenchBrowserAgentActivityEvent["targetMode"] | null;
  readonly cursor: {
    readonly x: number;
    readonly y: number;
  } | null;
};

type UseWorkbenchBrowserRuntimeParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly activeBrowserTabId: string | null;
  readonly activePageTabId: string;
  readonly visibleWorkspaceLayout: WorkspaceVisibleLayout;
  readonly themeVars: WorkbenchThemeVars;
  readonly forceWebPageThemingEnabled: boolean;
};

type WorkbenchBrowserRuntimeModel = {
  readonly activePageRuntimeState: WorkbenchBrowserPageRuntimeState | null;
  readonly browserAgentVisualState: BrowserAgentVisualState;
  readonly pageNavigationState: PageNavigationState;
  readonly registerPageHost: (tabId: string, element: HTMLElement | null) => void;
  readonly scheduleBrowserLayoutSync: (
    options?: {
      readonly force?: boolean;
      readonly followUpFrames?: number;
      readonly animatedLayoutDurationMs?: number;
      readonly animatedLayoutSyncIntervalMs?: number;
    }
  ) => void;
  readonly onGoBack: () => void;
  readonly onGoForward: () => void;
  readonly onReload: () => void;
};

const DEFAULT_PAGE_NAVIGATION_STATE: PageNavigationState = {
  canGoBack: false,
  canGoForward: false
};

const IDLE_BROWSER_AGENT_VISUAL_STATE: BrowserAgentVisualState = {
  active: false,
  inputActive: false,
  action: null,
  tabId: null,
  targetMode: null,
  cursor: null
};

const arePageRuntimeStatesEquivalent = (
  first: WorkbenchBrowserPageRuntimeState,
  second: WorkbenchBrowserPageRuntimeState
): boolean =>
  first.address === second.address
  && first.title === second.title
  && first.faviconUrl === second.faviconUrl
  && first.lifecycleState === second.lifecycleState
  && first.coreKey === second.coreKey
  && first.stateKey === second.stateKey
  && first.isTombstoned === second.isTombstoned
  && first.restoreReason === second.restoreReason
  && first.isActive === second.isActive
  && first.isVisible === second.isVisible
  && first.isLoading === second.isLoading
  && first.canGoBack === second.canGoBack
  && first.canGoForward === second.canGoForward
  && first.isHtmlFullscreen === second.isHtmlFullscreen;

export const resolveBrowserAgentCursorViewportPoint = (
  hostRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  cursor: WorkbenchBrowserAgentActivityEvent["cursor"]
): BrowserAgentVisualState["cursor"] => {
  if (cursor === undefined || hostRect.width <= 0 || hostRect.height <= 0) {
    return null;
  }
  return {
    x: hostRect.left + cursor.x,
    y: hostRect.top + cursor.y
  };
};

export const resolveVisibleBrowserPageDescriptors = (
  tabs: WorkspaceTabsModel["tabs"],
  visibleWorkspaceLayout: WorkspaceVisibleLayout
): readonly BrowserPageHostDescriptor[] =>
  visibleWorkspaceLayout.visibleTabIds
    .map((tabId, index) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (tab?.pageKind !== "page") {
        return null;
      }
      return {
        tabId,
        zIndex: index,
        isFocusedPane:
          visibleWorkspaceLayout.mode === "split"
            ? visibleWorkspaceLayout.focusedSplitTabId === tabId
            : visibleWorkspaceLayout.activeTabId === tabId
      };
    })
    .filter((value): value is BrowserPageHostDescriptor => value !== null);

export const useWorkbenchBrowserRuntime = ({
  desktopApi,
  tabsModel,
  activeBrowserTabId,
  activePageTabId,
  visibleWorkspaceLayout,
  themeVars,
  forceWebPageThemingEnabled
}: UseWorkbenchBrowserRuntimeParams): WorkbenchBrowserRuntimeModel => {
  const [pageNavigationState, setPageNavigationState] =
    useState<PageNavigationState>(DEFAULT_PAGE_NAVIGATION_STATE);
  const [pageRuntimeStateByTabId, setPageRuntimeStateByTabId] = useState<
    Readonly<Record<string, WorkbenchBrowserPageRuntimeState>>
  >({});
  const [browserAgentVisualState, setBrowserAgentVisualState] =
    useState<BrowserAgentVisualState>(IDLE_BROWSER_AGENT_VISUAL_STATE);
  const pageHostByTabIdRef = useRef(new Map<string, HTMLElement>());
  const browserAgentVisualTimerRef = useRef<number | null>(null);

  const activePageRuntimeState =
    activeBrowserTabId === null
      ? null
      : (pageRuntimeStateByTabId[activeBrowserTabId] ?? null);

  const visibleBrowserPageDescriptors = useMemo(
    () => resolveVisibleBrowserPageDescriptors(tabsModel.tabs, visibleWorkspaceLayout),
    [tabsModel.tabs, visibleWorkspaceLayout]
  );

  const {
    registerPageHost: registerPageHostForLayout,
    scheduleBrowserLayoutSync
  } =
    useWorkbenchBrowserLayoutSync({
      desktopApi,
      descriptors: visibleBrowserPageDescriptors
    });

  const registerPageHost = useCallback(
    (tabId: string, element: HTMLElement | null) => {
      if (element === null) {
        pageHostByTabIdRef.current.delete(tabId);
      } else {
        pageHostByTabIdRef.current.set(tabId, element);
      }
      registerPageHostForLayout(tabId, element);
    },
    [registerPageHostForLayout]
  );

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }

    const pages = tabsModel.tabs
      .filter((tab) => tab.pageKind === "page")
      .map((tab) => ({
        tabId: tab.id,
        address: tab.displayAddress,
        titleHint: tab.title,
        isActive: tab.id === activeBrowserTabId
      }));
    void desktopApi.workbenchBrowser.syncTopology({
      activeTabId: activeBrowserTabId,
      pages
    });
  }, [activeBrowserTabId, desktopApi, tabsModel.tabs]);

  const webThemeSnapshotRef = useRef(DEFAULT_WEB_THEME_SNAPSHOT);
  useEffect(() => {
    if (desktopApi === null) {
      return;
    }

    const nextSnapshot = buildWebThemeSnapshot({
      vars: themeVars,
      enabled: forceWebPageThemingEnabled,
      previousRevision: webThemeSnapshotRef.current.revision
    });
    if (areWebThemeSnapshotsEquivalent(webThemeSnapshotRef.current, nextSnapshot)) {
      return;
    }

    webThemeSnapshotRef.current = nextSnapshot;
    void desktopApi.workbenchBrowser.applyWebTheme(nextSnapshot);
  }, [desktopApi, forceWebPageThemingEnabled, themeVars]);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }

    return desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind === "lumen-browser-activity" || event.kind === "agent-browser-activity") {
        const host = pageHostByTabIdRef.current.get(event.tabId) ?? null;
        const cursor = host === null
          ? null
          : resolveBrowserAgentCursorViewportPoint(
              host.getBoundingClientRect(),
              event.cursor
            );
        if (browserAgentVisualTimerRef.current !== null) {
          window.clearTimeout(browserAgentVisualTimerRef.current);
        }
        setBrowserAgentVisualState({
          active: true,
          inputActive: event.inputActive,
          action: event.action,
          tabId: event.tabId,
          targetMode: event.targetMode,
          cursor
        });
        const durationMs = Math.max(500, Math.min(8_000, Math.round(event.durationMs)));
        browserAgentVisualTimerRef.current = window.setTimeout(() => {
          browserAgentVisualTimerRef.current = null;
          setBrowserAgentVisualState(IDLE_BROWSER_AGENT_VISUAL_STATE);
        }, durationMs);
        return;
      }

      if (event.kind === "page-runtime-state") {
        setPageRuntimeStateByTabId((current) => {
          const existing = current[event.page.tabId];
          if (
            existing !== undefined
            && arePageRuntimeStatesEquivalent(existing, event.page)
          ) {
            return current;
          }
          return {
            ...current,
            [event.page.tabId]: event.page
          };
        });

        const currentTab = tabsModel.tabs.find((tab) => tab.id === event.page.tabId);
        if (currentTab?.pageKind === "page") {
          const nextFaviconUrl = event.page.faviconUrl;
          if (
            currentTab.displayAddress !== event.page.address
            || currentTab.title !== event.page.title
            || currentTab.faviconUrl !== nextFaviconUrl
          ) {
            tabsModel.syncPageRuntimeState(event.page.tabId, {
              address: event.page.address,
              title: event.page.title,
              ...(nextFaviconUrl === undefined
                ? {}
                : { faviconUrl: nextFaviconUrl })
            });
          }
        }
        return;
      }

      if (event.kind === "page-closed") {
        setPageRuntimeStateByTabId((current) => {
          const next = { ...current };
          delete next[event.tabId];
          return next;
        });
        return;
      }

      if (event.kind === "request-open-tab") {
        tabsModel.openPageInNewTab(event.address, event.title);
      }
    });
  }, [desktopApi, tabsModel]);

  useEffect(
    () => () => {
      if (browserAgentVisualTimerRef.current !== null) {
        window.clearTimeout(browserAgentVisualTimerRef.current);
        browserAgentVisualTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (activePageTabId.length === 0) {
      setPageNavigationState(DEFAULT_PAGE_NAVIGATION_STATE);
      return;
    }

    const runtimeState = pageRuntimeStateByTabId[activePageTabId];
    if (runtimeState === undefined) {
      setPageNavigationState(DEFAULT_PAGE_NAVIGATION_STATE);
      return;
    }

    setPageNavigationState({
      canGoBack: runtimeState.canGoBack,
      canGoForward: runtimeState.canGoForward
    });
  }, [activePageTabId, pageRuntimeStateByTabId]);

  useEffect(() => {
    const validPageTabIds = new Set(
      tabsModel.tabs.filter((tab) => tab.pageKind === "page").map((tab) => tab.id)
    );
    setPageRuntimeStateByTabId((current) => {
      const nextEntries = Object.entries(current).filter(([tabId]) =>
        validPageTabIds.has(tabId)
      );
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [tabsModel.tabs]);

  const onGoBack = useCallback(() => {
    if (desktopApi === null || activePageTabId.length === 0) {
      return;
    }
    void desktopApi.workbenchBrowser.goBack({ tabId: activePageTabId });
  }, [activePageTabId, desktopApi]);

  const onGoForward = useCallback(() => {
    if (desktopApi === null || activePageTabId.length === 0) {
      return;
    }
    void desktopApi.workbenchBrowser.goForward({ tabId: activePageTabId });
  }, [activePageTabId, desktopApi]);

  const onReload = useCallback(() => {
    if (desktopApi === null || activePageTabId.length === 0) {
      return;
    }
    void desktopApi.workbenchBrowser.reload({ tabId: activePageTabId });
  }, [activePageTabId, desktopApi]);

  return {
    activePageRuntimeState,
    browserAgentVisualState,
    pageNavigationState,
    registerPageHost,
    scheduleBrowserLayoutSync,
    onGoBack,
    onGoForward,
    onReload
  };
};

export const arePageRuntimeStatesEquivalentForTests =
  arePageRuntimeStatesEquivalent;
