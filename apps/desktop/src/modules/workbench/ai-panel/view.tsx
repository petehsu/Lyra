import { Plus, X } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from "react";

import {
  AppButton,
  AppIconButton,
  AppPanel,
  AppStatusMessage
} from "@renderer/ui/components";
import { LyraLogo } from "@renderer/ui/app";
import { cn } from "@renderer/ui/utils";
import { LyraAgentsApp } from "./lyra-agents/LyraAgentsApp";
import { t } from "./lyra-agents/core/i18n";
import { useData } from "./lyra-agents/data/DataProvider";
import { HeaderControls } from "./lyra-agents/features/header/Header";
import type { AiPanelSessionTab } from "./session-tabs";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";

const DEFAULT_SESSION_TITLE = "新会话";
const AI_SESSION_TAB_DRAG_THRESHOLD_PX = 4;
const AI_SESSION_TAB_CONTENT_MARGIN_TOTAL_PX = 18;
const AI_SESSION_TAB_MIN_WIDTH_PX = 132;
const AI_SESSION_TAB_MAX_WIDTH_PX = 220;
const AI_SESSION_TAB_OVERLAP_PX = 1;
const AI_SESSION_TAB_ADD_BUTTON_FALLBACK_WIDTH_PX = 32;

type AiSessionTabLayoutItem = {
  readonly width: number;
  readonly x: number;
  readonly contentWidth: number;
};

type AiSessionTabStripLayout = {
  readonly density: "regular";
  readonly items: readonly AiSessionTabLayoutItem[];
  readonly addButtonX: number;
  readonly contentWidth: number;
  readonly totalTabsWidth: number;
};

type AiSessionTabDragState = {
  readonly tabId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startX: number;
  readonly positions: readonly number[];
  readonly lastTargetIndex: number;
  readonly moved: boolean;
};

type AiSessionTabDragVisualState = {
  readonly tabId: string;
  readonly x: number;
};

const computeAiSessionTabLayout = ({
  tabCount,
  stripWidth,
  addButtonWidth
}: {
  readonly tabCount: number;
  readonly stripWidth: number;
  readonly addButtonWidth: number;
}): AiSessionTabStripLayout => {
  const effectiveAddButtonWidth =
    addButtonWidth > 0 ? addButtonWidth : AI_SESSION_TAB_ADD_BUTTON_FALLBACK_WIDTH_PX;
  const contentWidth = Math.max(0, stripWidth - effectiveAddButtonWidth);
  if (tabCount <= 0) {
    return {
      density: "regular",
      items: [],
      addButtonX: contentWidth,
      contentWidth,
      totalTabsWidth: 0
    };
  }

  const idealTabWidth =
    (contentWidth + Math.max(0, tabCount - 1) * AI_SESSION_TAB_OVERLAP_PX) / tabCount;
  const tabWidth = Math.floor(Math.max(
    AI_SESSION_TAB_MIN_WIDTH_PX,
    Math.min(AI_SESSION_TAB_MAX_WIDTH_PX, idealTabWidth)
  ));
  let x = 0;
  const items = Array.from({ length: tabCount }, () => {
    const item = {
      width: tabWidth,
      x,
      contentWidth: Math.max(0, tabWidth - AI_SESSION_TAB_CONTENT_MARGIN_TOTAL_PX)
    };
    x += tabWidth - AI_SESSION_TAB_OVERLAP_PX;
    return item;
  });
  const totalTabsWidth = items.length === 0
    ? 0
    : Math.max(...items.map((item) => item.x + item.width));

  return {
    density: "regular",
    items,
    addButtonX: contentWidth,
    contentWidth,
    totalTabsWidth
  };
};

const closestAiSessionTabLayoutIndex = (
  value: number,
  items: readonly Pick<AiSessionTabLayoutItem, "x">[]
): number => {
  let closestDistance = Infinity;
  let closestIndex = -1;
  items.forEach((item, index) => {
    const distance = Math.abs(value - item.x);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
};

const useAiSessionTabLayout = (
  tabCount: number,
  stripRef: RefObject<HTMLDivElement>,
  addButtonRef: RefObject<HTMLButtonElement>
): {
  readonly layout: AiSessionTabStripLayout;
} => {
  const [layout, setLayout] = useState<AiSessionTabStripLayout>(() =>
    computeAiSessionTabLayout({
      tabCount,
      stripWidth: 0,
      addButtonWidth: 0
    })
  );

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (strip === null) {
      setLayout(computeAiSessionTabLayout({
        tabCount,
        stripWidth: 0,
        addButtonWidth: 0
      }));
      return;
    }

    const measure = (): void => {
      setLayout(computeAiSessionTabLayout({
        tabCount,
        stripWidth: strip.getBoundingClientRect().width,
        addButtonWidth: addButtonRef.current?.getBoundingClientRect().width ?? 0
      }));
    };
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    if (addButtonRef.current !== null) observer.observe(addButtonRef.current);
    return () => {
      observer.disconnect();
    };
  }, [addButtonRef, stripRef, tabCount]);

  return {
    layout
  };
};

const AiPanelTabsHeader = ({
  tabs,
  activeSessionTabId,
  activeSessionId,
  onActivateSessionTab,
  onCloseSessionTab,
  onReorderSessionTabs
}: {
  readonly tabs: readonly AiPanelSessionTab[];
  readonly activeSessionTabId: string | null;
  readonly activeSessionId: string | null;
  readonly onActivateSessionTab?: (sessionId: string) => void;
  readonly onCloseSessionTab?: (sessionId: string) => void;
  readonly onReorderSessionTabs?: (sourceTabId: string, targetTabId: string) => void;
}) => {
  const { session, isTurnRunning, createSession } = useData();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<AiSessionTabDragState | null>(null);
  const suppressNextClickRef = useRef<string | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragVisual, setDragVisual] = useState<AiSessionTabDragVisualState | null>(null);
  const newSessionLabel = t("header.newSession");
  const currentSessionId = session.id?.trim() || null;
  const effectiveActiveTabId =
    activeSessionTabId
    ?? tabs.find((tab) => tab.sessionId === activeSessionId)?.tabId
    ?? currentSessionId
    ?? (tabs.length === 0 ? "__local-draft" : null);
  const currentTab =
    currentSessionId === null
      ? null
      : ({
          tabId: currentSessionId,
          sessionId: currentSessionId,
          title: session.title,
          lastKnownStatus: isTurnRunning ? "running" : null
        } satisfies AiPanelSessionTab);
  const visibleTabs =
    currentTab !== null && tabs.some((tab) => tab.sessionId === currentTab.sessionId) === false
      ? [...tabs, currentTab]
      : tabs.length > 0
        ? tabs
        : [{
            tabId: "__local-draft",
            sessionId: null,
            title: DEFAULT_SESSION_TITLE,
            lastKnownStatus: null
          } satisfies AiPanelSessionTab];
  const activeIndex = Math.max(
    0,
    visibleTabs.findIndex((tab) => tab.tabId === effectiveActiveTabId)
  );
  const { layout } = useAiSessionTabLayout(
    visibleTabs.length,
    stripRef,
    addButtonRef
  );
  const listSpacerStyle: CSSProperties = {
    width: `${Math.ceil(Math.max(layout.contentWidth, layout.totalTabsWidth))}px`
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    const activeItem = layout.items[activeIndex];
    if (list === null || activeItem === undefined) return;
    const viewportWidth = list.getBoundingClientRect().width || layout.contentWidth;
    if (viewportWidth <= 0) return;
    const maxScrollLeft = Math.max(0, layout.totalTabsWidth - viewportWidth);
    const currentScrollLeft = list.scrollLeft;
    const activeLeft = activeItem.x;
    const activeRight = activeItem.x + activeItem.width;
    const nextScrollLeft =
      activeLeft < currentScrollLeft
        ? activeLeft
        : activeRight > currentScrollLeft + viewportWidth
          ? activeRight - viewportWidth
          : currentScrollLeft;
    list.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
  }, [activeIndex, layout]);

  const onTabListWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    const list = listRef.current;
    if (list === null || list.scrollWidth <= list.clientWidth) return;
    const delta =
      Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    list.scrollLeft += delta;
    event.preventDefault();
  }, []);

  const onTabPointerDown = useCallback((
    tab: AiPanelSessionTab,
    index: number,
    event: ReactPointerEvent<HTMLElement>
  ): void => {
    if (event.button !== 0 || onReorderSessionTabs === undefined) return;
    const item = layout.items[index];
    if (item === undefined) return;
    dragRef.current = {
      tabId: tab.tabId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startX: item.x,
      positions: layout.items.map((layoutItem) => layoutItem.x),
      lastTargetIndex: index,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [layout.items, onReorderSessionTabs]);

  const onTabPointerMove = useCallback((
    event: ReactPointerEvent<HTMLElement>
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startClientX;
    if (!drag.moved && Math.abs(deltaX) < AI_SESSION_TAB_DRAG_THRESHOLD_PX) return;
    const nextX = drag.startX + deltaX;
    setDraggingTabId(drag.tabId);
    setDragVisual({ tabId: drag.tabId, x: nextX });
    event.preventDefault();

    const currentIndex = visibleTabs.findIndex((tab) => tab.tabId === drag.tabId);
    const destinationIndex = closestAiSessionTabLayoutIndex(
      nextX,
      drag.positions.map((x) => ({ x, width: 0, contentWidth: 0 }))
    );
    const destination = visibleTabs[destinationIndex];
    dragRef.current = {
      ...drag,
      moved: true,
      lastTargetIndex: destinationIndex === -1 ? drag.lastTargetIndex : destinationIndex
    };
    if (
      currentIndex !== -1 &&
      destinationIndex !== -1 &&
      destinationIndex !== drag.lastTargetIndex &&
      currentIndex !== destinationIndex &&
      destination !== undefined
    ) {
      onReorderSessionTabs?.(drag.tabId, destination.tabId);
    }
  }, [layout.items, onReorderSessionTabs, visibleTabs]);

  const onTabPointerUp = useCallback((
    event: ReactPointerEvent<HTMLElement>
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingTabId(null);
    setDragVisual(null);
    if (drag.moved) {
      suppressNextClickRef.current = drag.tabId;
      window.setTimeout(() => {
        if (suppressNextClickRef.current === drag.tabId) {
          suppressNextClickRef.current = null;
        }
      }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <header className="lyra-agents-header lyra-agents-session-tabs-header">
      <div
        ref={stripRef}
        className={cn(
          "lyra-agents-session-tab-strip",
          dragVisual !== null && "lyra-agents-session-tab-strip-sorting"
        )}
        role="tablist"
        aria-label="AI sessions"
      >
        <div
          ref={listRef}
          className="lyra-agents-session-tab-list"
          onWheel={onTabListWheel}
        >
          <div
            className="lyra-agents-session-tab-list-spacer"
            style={listSpacerStyle}
            aria-hidden="true"
          />
          {visibleTabs.map((tab, index) => {
            const active = tab.tabId === effectiveActiveTabId;
            const hasCurrentSnapshot =
              tab.sessionId !== null && tab.sessionId === currentSessionId;
            const title = hasCurrentSnapshot
              ? session.title.trim() || tab.title || DEFAULT_SESSION_TITLE
              : tab.title.trim() || DEFAULT_SESSION_TITLE;
            const running = hasCurrentSnapshot ? isTurnRunning : tab.lastKnownStatus === "running";
            const tabLayout = layout.items[index];
            const tabStyle: CSSProperties | undefined = tabLayout === undefined
              ? undefined
              : {
                  width: `${Math.round(tabLayout.width)}px`,
                  transform:
                    dragVisual?.tabId === tab.tabId
                      ? `translate3d(${Math.round(dragVisual.x)}px, 0, 0)`
                      : `translate3d(${Math.round(tabLayout.x)}px, 0, 0)`
                };
            return (
              <div
                key={tab.tabId}
                className={cn(
                  "lyra-agents-session-tab-item",
                  active && "lyra-agents-session-tab-item-active",
                  running && "lyra-agents-session-tab-item-running",
                  draggingTabId === tab.tabId && "lyra-agents-session-tab-item-dragging"
                )}
                style={tabStyle}
                data-ai-session-tab-id={tab.tabId}
                onPointerMove={onTabPointerMove}
                onPointerUp={onTabPointerUp}
                onPointerCancel={onTabPointerUp}
              >
                <AppButton
                  className="lyra-agents-session-tab-main"
                  variant="ghost"
                  size="sm"
                  role="tab"
                  aria-selected={active}
                  aria-label={title}
                  title={title}
                  draggable={false}
                  onPointerDown={(event) => {
                    onTabPointerDown(tab, index, event);
                  }}
                  onClick={() => {
                    if (suppressNextClickRef.current === tab.tabId) {
                      suppressNextClickRef.current = null;
                      return;
                    }
                    onActivateSessionTab?.(tab.tabId);
                  }}
                >
                  <span className="lyra-agents-session-tab-icon" aria-hidden="true">
                    <LyraLogo className="lyra-agents-session-tab-logo" alt="" />
                  </span>
                  <span className="lyra-agents-session-tab-title">{title}</span>
                </AppButton>
                <AppIconButton
                  className="lyra-agents-session-tab-close"
                  aria-label={`Close session tab: ${title}`}
                  title={`Close session tab: ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseSessionTab?.(tab.tabId);
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </AppIconButton>
              </div>
            );
          })}
        </div>
        <AppIconButton
          ref={addButtonRef}
          className="lyra-agents-session-tab-add"
          style={{
            transform: `translate3d(${Math.round(layout.addButtonX)}px, 0, 0)`
          }}
          aria-label={newSessionLabel}
          title={newSessionLabel}
          onClick={() => {
          void createSession();
        }}
      >
        <Plus size={14} aria-hidden="true" />
      </AppIconButton>
      </div>
      <HeaderControls showNewSessionButton={false} />
    </header>
  );
};

export const AiPanelSurface = ({
  desktopApi,
  settingsAiModel,
  activeSessionTabId = null,
  activeSessionId = null,
  onActiveSessionChange,
  sessionTabs = [],
  onActivateSessionTab,
  onCloseSessionTab,
  onReorderSessionTabs,
  onCreateDraftSessionTab,
  onCreateSessionTab,
  onMissingSession,
  onSessionSnapshotChange,
  onRequestProjectBind,
  onOpenProjectTree,
  onOpenSelfDevLab,
  onOpenOvernightLab,
  onOpenModelSettings,
  onOpenUrlInWorkbench,
  onOpenTerminalLiveSession,
  onOpenFile,
  openDialog,
  locale,
  title
}: AiPanelSurfaceProps) => {
  const activeTab =
    sessionTabs.find((tab) => tab.tabId === activeSessionTabId)
    ?? sessionTabs.find((tab) => tab.sessionId === activeSessionId)
    ?? null;
  const provider = useLyraAgentDataProvider(
    desktopApi,
    settingsAiModel,
    activeSessionId,
    activeTab?.sessionId === null ? activeTab.draftWorkingDir ?? null : null,
    sessionTabs.length > 0,
    {
      onActiveSessionChange,
      onSessionSnapshotChange,
      onCreateDraftSessionTab,
      onCreateSessionTab,
      onMissingSession,
      onRequestProjectBind,
      onOpenProjectTree,
      onOpenSelfDevLab,
      onOpenOvernightLab,
      onOpenModelSettings,
      onOpenUrlInWorkbench,
      onOpenFile,
      onOpenTerminalLiveSession,
      openDialog,
      locale
    }
  );

  return (
    <AppPanel placement="right" className="lyra-ai-panel-shell" aria-label={title}>
      {provider.error === null ? null : (
        <AppStatusMessage className="lyra-ai-panel-error" role="status" tone="error">
          {provider.error}
        </AppStatusMessage>
      )}
      <div className="lyra-agents-host">
        <LyraAgentsApp
          data={provider.data}
          headerSlot={
            <AiPanelTabsHeader
              tabs={sessionTabs}
              activeSessionTabId={activeSessionTabId ?? null}
              activeSessionId={activeSessionId}
              {...(onActivateSessionTab === undefined ? {} : { onActivateSessionTab })}
              {...(onCloseSessionTab === undefined ? {} : { onCloseSessionTab })}
              {...(onReorderSessionTabs === undefined ? {} : { onReorderSessionTabs })}
            />
          }
          {...(locale === undefined ? {} : { locale })}
        />
      </div>
    </AppPanel>
  );
};
