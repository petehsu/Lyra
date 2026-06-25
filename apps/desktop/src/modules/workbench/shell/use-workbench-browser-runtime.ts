import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentRuntimeEvent,
  LyraDesktopApi,
  WorkbenchBrowserAgentActivityEvent,
  WorkbenchBrowserPageRuntimeState
} from "../../../shared/desktop-bridge";
import { browserPageRestoreStateEquals } from "../../../shared/workbench-browser";
import type {
  WorkspaceTabsModel,
  WorkspaceVisibleLayout
} from "../workspace-tabs";
import {
  recordBrowserHistoryVisit,
  toRecordableBrowserHistoryUrl
} from "../browser-history/service";
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

export type EmbeddedBrowserPageDescriptor = {
  readonly tabId: string;
  readonly address: string;
  readonly titleHint?: string;
};

export type BrowserAgentVisualState = {
  readonly active: boolean;
  readonly inputActive: boolean;
  readonly cursorVisible: boolean;
  readonly cursorPhase: NonNullable<WorkbenchBrowserAgentActivityEvent["cursorPhase"]>;
  readonly sharedControlState: NonNullable<WorkbenchBrowserAgentActivityEvent["sharedControlState"]>;
  readonly action: WorkbenchBrowserAgentActivityEvent["action"] | null;
  readonly interaction: WorkbenchBrowserAgentActivityEvent["interaction"] | null;
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
  readonly embeddedBrowserPages?: readonly EmbeddedBrowserPageDescriptor[];
  readonly onBrowserHistoryChange?: () => void;
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
  cursorVisible: false,
  cursorPhase: "idle",
  sharedControlState: "idle",
  action: null,
  interaction: null,
  tabId: null,
  targetMode: null,
  cursor: null
};

const EMPTY_EMBEDDED_BROWSER_PAGES: readonly EmbeddedBrowserPageDescriptor[] = [];

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
  && first.isHtmlFullscreen === second.isHtmlFullscreen
  && browserPageRestoreStateEquals(first.restoreState, second.restoreState);

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

export const shouldShowBrowserAgentActivityChrome = (
  event: Pick<
    WorkbenchBrowserAgentActivityEvent,
    "inputActive" | "sharedControlState"
  >
): boolean =>
  event.inputActive
  || event.sharedControlState === "locked_input"
  || event.sharedControlState === "user_interrupted"
  || event.sharedControlState === "awaiting_user_decision"
  || event.sharedControlState === "resuming";

export const resolveVisibleBrowserPageDescriptors = (
  tabs: WorkspaceTabsModel["tabs"],
  visibleWorkspaceLayout: WorkspaceVisibleLayout,
  embeddedBrowserPages: readonly EmbeddedBrowserPageDescriptor[] = EMPTY_EMBEDDED_BROWSER_PAGES
): readonly BrowserPageHostDescriptor[] =>
  [
    ...visibleWorkspaceLayout.visibleTabIds
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
    .filter((value): value is BrowserPageHostDescriptor => value !== null),
    ...embeddedBrowserPages.map((page, index) => ({
      tabId: page.tabId,
      zIndex: visibleWorkspaceLayout.visibleTabIds.length + index,
      isFocusedPane: false
    }))
  ];

export const useWorkbenchBrowserRuntime = ({
  desktopApi,
  tabsModel,
  activeBrowserTabId,
  activePageTabId,
  visibleWorkspaceLayout,
  embeddedBrowserPages = EMPTY_EMBEDDED_BROWSER_PAGES,
  onBrowserHistoryChange
}: UseWorkbenchBrowserRuntimeParams): WorkbenchBrowserRuntimeModel => {
  const [pageNavigationState, setPageNavigationState] =
    useState<PageNavigationState>(DEFAULT_PAGE_NAVIGATION_STATE);
  const [pageRuntimeStateByTabId, setPageRuntimeStateByTabId] = useState<
    Readonly<Record<string, WorkbenchBrowserPageRuntimeState>>
  >({});
  const [browserAgentVisualState, setBrowserAgentVisualState] =
    useState<BrowserAgentVisualState>(IDLE_BROWSER_AGENT_VISUAL_STATE);
  const pageHostByTabIdRef = useRef(new Map<string, HTMLElement>());
  const lastHistoryRecordByTabIdRef = useRef(
    new Map<string, { readonly url: string; readonly title: string; readonly faviconUrl?: string }>()
  );
  const browserAgentVisualTimerRef = useRef<number | null>(null);
  const browserAgentCursorSafetyTimerRef = useRef<number | null>(null);

  const activePageRuntimeState =
    activeBrowserTabId === null
      ? null
      : (pageRuntimeStateByTabId[activeBrowserTabId] ?? null);

  const visibleBrowserPageDescriptors = useMemo(
    () => resolveVisibleBrowserPageDescriptors(
      tabsModel.tabs,
      visibleWorkspaceLayout,
      embeddedBrowserPages
    ),
    [embeddedBrowserPages, tabsModel.tabs, visibleWorkspaceLayout]
  );
  const embeddedBrowserPageIds = useMemo(
    () => new Set(embeddedBrowserPages.map((page) => page.tabId)),
    [embeddedBrowserPages]
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

    const tabPages = tabsModel.tabs
      .filter((tab) => tab.pageKind === "page")
      .map((tab) => ({
        tabId: tab.id,
        address: tab.displayAddress,
        titleHint: tab.title,
        ...(tab.browserRestoreState === undefined
          ? {}
          : { restoreState: tab.browserRestoreState }),
        isActive: tab.id === activeBrowserTabId
      }));
    const embeddedPages = embeddedBrowserPages.map((page) => ({
      tabId: page.tabId,
      address: page.address,
      ...(page.titleHint === undefined ? {} : { titleHint: page.titleHint }),
      isActive: false
    }));
    void desktopApi.workbenchBrowser.syncTopology({
      activeTabId: activeBrowserTabId,
      pages: [...tabPages, ...embeddedPages]
    });
  }, [activeBrowserTabId, desktopApi, embeddedBrowserPages, tabsModel.tabs]);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }

    const hideBrowserAgentCursor = (): void => {
      if (browserAgentVisualTimerRef.current !== null) {
        window.clearTimeout(browserAgentVisualTimerRef.current);
        browserAgentVisualTimerRef.current = null;
      }
      if (browserAgentCursorSafetyTimerRef.current !== null) {
        window.clearTimeout(browserAgentCursorSafetyTimerRef.current);
        browserAgentCursorSafetyTimerRef.current = null;
      }
      setBrowserAgentVisualState(IDLE_BROWSER_AGENT_VISUAL_STATE);
    };

    const scheduleCursorSafetyHide = (): void => {
      if (browserAgentCursorSafetyTimerRef.current !== null) {
        window.clearTimeout(browserAgentCursorSafetyTimerRef.current);
      }
      browserAgentCursorSafetyTimerRef.current = window.setTimeout(() => {
        browserAgentCursorSafetyTimerRef.current = null;
        setBrowserAgentVisualState(IDLE_BROWSER_AGENT_VISUAL_STATE);
      }, 60_000);
    };

    const handleAgentRuntimeEvent = (event: AgentRuntimeEvent): void => {
      if (
        event.kind === "turnFinished"
        || event.kind === "turnFailed"
        || event.kind === "turnInterrupted"
        || (event.kind === "followStateChanged" && event.follow.running === false)
      ) {
        hideBrowserAgentCursor();
      }
    };

    const unsubscribeAgent = desktopApi.agent?.onEvent(handleAgentRuntimeEvent) ?? (() => undefined);
    const unsubscribeBrowser = desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind === "lumen-browser-activity" || event.kind === "agent-browser-activity") {
        const showActivityChrome = shouldShowBrowserAgentActivityChrome(event);
        if (!showActivityChrome && event.cursor === undefined) {
          return;
        }
        const host = pageHostByTabIdRef.current.get(event.tabId) ?? null;
        const nextCursor = host === null
          ? null
          : resolveBrowserAgentCursorViewportPoint(
              host.getBoundingClientRect(),
              event.cursor
            );
        if (browserAgentVisualTimerRef.current !== null) {
          window.clearTimeout(browserAgentVisualTimerRef.current);
        }
        scheduleCursorSafetyHide();
        setBrowserAgentVisualState((current) => {
          const sharedControlState = event.sharedControlState ?? (
            event.inputActive ? "locked_input" : "idle"
          );
          const retainedCursor =
            showActivityChrome
              ? nextCursor
                ?? (current.cursorVisible && current.tabId === event.tabId ? current.cursor : null)
              : nextCursor;
          return {
            active: showActivityChrome,
            inputActive: event.inputActive,
            cursorVisible: retainedCursor !== null,
            cursorPhase: event.cursorPhase ?? "idle",
            sharedControlState,
            action: event.action,
            interaction: event.interaction ?? null,
            tabId: event.tabId,
            targetMode: event.targetMode,
            cursor: retainedCursor
          };
        });
        const durationMs = Math.max(500, Math.min(8_000, Math.round(event.durationMs)));
        browserAgentVisualTimerRef.current = window.setTimeout(() => {
          browserAgentVisualTimerRef.current = null;
          setBrowserAgentVisualState((current) => {
            if (!current.cursorVisible || current.cursor === null) {
              return IDLE_BROWSER_AGENT_VISUAL_STATE;
            }
            return {
              ...current,
              active: false,
              inputActive: false,
              cursorPhase: "idle",
              sharedControlState:
                current.sharedControlState === "awaiting_user_decision"
                  || current.sharedControlState === "user_interrupted"
                  ? current.sharedControlState
                  : "idle",
              action: null,
              interaction: null,
              targetMode: null
            };
          });
        }, durationMs);
        return;
      }

      if (event.kind === "browser-shared-control-state") {
        setBrowserAgentVisualState((current) => ({
          ...current,
          active: event.state !== "idle",
          inputActive: event.state === "locked_input",
          cursorVisible: current.cursorVisible,
          sharedControlState: event.state,
          action: event.action ?? current.action,
          interaction: event.interaction ?? current.interaction,
          tabId: event.tabId,
          targetMode: "live"
        }));
        return;
      }

      if (event.kind === "browser-shared-control-interrupted") {
        setBrowserAgentVisualState((current) => ({
          ...current,
          active: true,
          inputActive: false,
          sharedControlState: event.sharedControlState,
          action: event.action ?? current.action,
          interaction: event.interaction ?? current.interaction,
          tabId: event.tabId,
          targetMode: "live"
        }));
        return;
      }

      if (event.kind === "page-runtime-state") {
        const recordableUrl = toRecordableBrowserHistoryUrl(event.page.address);
        if (
          recordableUrl !== null
          && event.page.isTombstoned !== true
          && embeddedBrowserPageIds.has(event.page.tabId) === false
        ) {
          const previousRecord = lastHistoryRecordByTabIdRef.current.get(event.page.tabId);
          const nextRecord = {
            url: recordableUrl,
            title: event.page.title,
            ...(event.page.faviconUrl === undefined ? {} : { faviconUrl: event.page.faviconUrl })
          };
          const countVisit = previousRecord?.url !== recordableUrl;
          const metadataChanged =
            previousRecord !== undefined
            && previousRecord.url === recordableUrl
            && (previousRecord.title !== event.page.title
              || previousRecord.faviconUrl !== event.page.faviconUrl);

          if (countVisit || metadataChanged) {
            const recorded = recordBrowserHistoryVisit({
              url: recordableUrl,
              title: event.page.title,
              faviconUrl: event.page.faviconUrl ?? null,
              countVisit
            });
            if (recorded !== null) {
              lastHistoryRecordByTabIdRef.current.set(event.page.tabId, nextRecord);
              onBrowserHistoryChange?.();
            }
          }
        }

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
            || browserPageRestoreStateEquals(
              currentTab.browserRestoreState,
              event.page.restoreState
            ) === false
          ) {
            tabsModel.syncPageRuntimeState(event.page.tabId, {
              address: event.page.address,
              title: event.page.title,
              ...(nextFaviconUrl === undefined
                ? {}
                : { faviconUrl: nextFaviconUrl }),
              ...(event.page.restoreState === undefined
                ? {}
                : { restoreState: event.page.restoreState })
            });
          }
        }
        return;
      }

      if (event.kind === "page-closed") {
        lastHistoryRecordByTabIdRef.current.delete(event.tabId);
        setPageRuntimeStateByTabId((current) => {
          const next = { ...current };
          delete next[event.tabId];
          return next;
        });
        return;
      }

      if (event.kind === "request-activate-tab") {
        const tabExists = tabsModel.tabs.some((tab) => tab.id === event.tabId);
        if (
          tabExists
          && tabsModel.activeTabId !== event.tabId
          && embeddedBrowserPageIds.has(event.tabId) === false
        ) {
          tabsModel.setActiveTab(event.tabId);
        }
        return;
      }

      if (event.kind === "request-open-tab") {
        tabsModel.openPageInNewTab(
          event.address,
          event.title,
          event.tabId === undefined ? undefined : { tabId: event.tabId }
        );
      }
      return undefined;
    });
    return () => {
      unsubscribeAgent();
      unsubscribeBrowser();
    };
  }, [desktopApi, embeddedBrowserPageIds, onBrowserHistoryChange, tabsModel]);

  useEffect(
    () => () => {
      if (browserAgentVisualTimerRef.current !== null) {
        window.clearTimeout(browserAgentVisualTimerRef.current);
        browserAgentVisualTimerRef.current = null;
      }
      if (browserAgentCursorSafetyTimerRef.current !== null) {
        window.clearTimeout(browserAgentCursorSafetyTimerRef.current);
        browserAgentCursorSafetyTimerRef.current = null;
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
      [
        ...tabsModel.tabs.filter((tab) => tab.pageKind === "page").map((tab) => tab.id),
        ...embeddedBrowserPages.map((page) => page.tabId)
      ]
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
  }, [embeddedBrowserPages, tabsModel.tabs]);

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
