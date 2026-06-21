import { X } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { IdentityIconView, useSessionIdentityIcon } from "../identity";
import { createRafCoalescer } from "../shell/raf-coalesce";
import {
  getIsLayoutResizing,
  subscribeLayoutResizeEnd
} from "../shell/use-panel-layout";
import { LyraAgentsApp } from "./lyra-agents/LyraAgentsApp";
import { t } from "./lyra-agents/core/i18n";
import { useData } from "./lyra-agents/data/DataProvider";
import { HeaderControls } from "./lyra-agents/features/header/Header";
import type { AiPanelSessionTab } from "./session-tabs";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";
import { estimateTabTitleContentWidth } from "../text-metrics";

const DEFAULT_SESSION_TITLE = "新会话";
const AI_SESSION_TAB_DRAG_THRESHOLD_PX = 4;
const AI_SESSION_TAB_CONTENT_MARGIN_TOTAL_PX = 18;
const AI_SESSION_TAB_MIN_WIDTH_PX = 120;
const AI_SESSION_TAB_MAX_WIDTH_PX = 220;
const AI_SESSION_TAB_OVERLAP_PX = 0;
const AI_SESSION_TAB_TITLE_BASE_WIDTH_PX = 52;
const AI_SESSION_TAB_TITLE_CHAR_WIDTH_PX = 7;

type AiSessionTabLayoutItem = {
  readonly width: number;
  readonly x: number;
  readonly contentWidth: number;
};

type AiSessionTabStripLayout = {
  readonly density: "regular";
  readonly items: readonly AiSessionTabLayoutItem[];
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

const preferredAiSessionTabTitleWidth = (
  title: string,
  titleFont?: string
): number => {
  if (titleFont === undefined) {
    return (
      AI_SESSION_TAB_TITLE_BASE_WIDTH_PX
      + title.trim().length * AI_SESSION_TAB_TITLE_CHAR_WIDTH_PX
    );
  }
  return estimateTabTitleContentWidth(title, {
    font: titleFont,
    baseWidthPx: AI_SESSION_TAB_TITLE_BASE_WIDTH_PX,
    charWidthFallbackPx: AI_SESSION_TAB_TITLE_CHAR_WIDTH_PX
  });
};

const computeAiSessionTabLayout = ({
  titles,
  stripWidth,
  titleFont
}: {
  readonly titles: readonly string[];
  readonly stripWidth: number;
  readonly titleFont?: string;
}): AiSessionTabStripLayout => {
  const contentWidth = Math.max(0, stripWidth);
  const tabCount = titles.length;
  if (tabCount <= 0) {
    return {
      density: "regular",
      items: [],
      contentWidth,
      totalTabsWidth: 0
    };
  }

  const preferredWidths = titles.map((title) =>
    Math.max(
      AI_SESSION_TAB_MIN_WIDTH_PX,
      Math.min(
        AI_SESSION_TAB_MAX_WIDTH_PX,
        preferredAiSessionTabTitleWidth(title, titleFont)
      )
    )
  );
  const preferredTotalWidth =
    preferredWidths.reduce((sum, width) => sum + width, 0)
    - Math.max(0, tabCount - 1) * AI_SESSION_TAB_OVERLAP_PX;
  const minTotalWidth =
    AI_SESSION_TAB_MIN_WIDTH_PX * tabCount
    - Math.max(0, tabCount - 1) * AI_SESSION_TAB_OVERLAP_PX;
  const widths =
    preferredTotalWidth <= contentWidth
      ? preferredWidths
      : contentWidth <= minTotalWidth
        ? Array.from({ length: tabCount }, () => AI_SESSION_TAB_MIN_WIDTH_PX)
        : (() => {
            const shrinkTarget = preferredTotalWidth - contentWidth;
            const shrinkableTotal = preferredWidths.reduce(
              (sum, width) => sum + Math.max(0, width - AI_SESSION_TAB_MIN_WIDTH_PX),
              0
            );
            return preferredWidths.map((width) => {
              const shrinkable = Math.max(0, width - AI_SESSION_TAB_MIN_WIDTH_PX);
              const shrink = shrinkableTotal <= 0
                ? 0
                : shrinkTarget * (shrinkable / shrinkableTotal);
              return Math.floor(Math.max(AI_SESSION_TAB_MIN_WIDTH_PX, width - shrink));
            });
          })();
  let x = 0;
  const items = widths.map((tabWidth) => {
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

const readAiSessionTabTitleFont = (strip: HTMLElement): string | undefined => {
  const sample = strip.querySelector<HTMLElement>(".lyra-agents-session-tab-title");
  if (sample === null) return undefined;
  const font = getComputedStyle(sample).font;
  return font.length > 0 ? font : undefined;
};

const useAiSessionTabLayout = (
  titles: readonly string[],
  stripRef: RefObject<HTMLDivElement>
): {
  readonly layout: AiSessionTabStripLayout;
} => {
  const [layout, setLayout] = useState<AiSessionTabStripLayout>(() =>
    computeAiSessionTabLayout({
      titles,
      stripWidth: 0
    })
  );

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (strip === null) {
      setLayout(computeAiSessionTabLayout({
        titles,
        stripWidth: 0
      }));
      return;
    }

    // Track the last measured width so resize ticks that don't actually change
    // the strip width skip the O(n) layout recompute + setState entirely.
    let lastStripWidth = -1;
    let lastTitleFont: string | undefined;
    const measure = (): void => {
      if (getIsLayoutResizing()) {
        return;
      }
      const stripWidth = strip.getBoundingClientRect().width;
      const titleFont = readAiSessionTabTitleFont(strip);
      if (stripWidth === lastStripWidth && titleFont === lastTitleFont) return;
      lastStripWidth = stripWidth;
      lastTitleFont = titleFont;
      setLayout(computeAiSessionTabLayout({
        titles,
        stripWidth,
        ...(titleFont === undefined ? {} : { titleFont })
      }));
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return subscribeLayoutResizeEnd(measure);
    }
    // Coalesce the resize storm into one measure per animation frame.
    const coalescer = createRafCoalescer(measure);
    const observer = new ResizeObserver(() => coalescer.schedule());
    observer.observe(strip);
    const unsubscribeResizeEnd = subscribeLayoutResizeEnd(() => {
      lastStripWidth = -1;
      lastTitleFont = undefined;
      measure();
    });
    return () => {
      observer.disconnect();
      coalescer.cancel();
      unsubscribeResizeEnd();
    };
  }, [stripRef, titles]);

  return {
    layout
  };
};

const SessionTabIdentityIcon = ({
  desktopApi,
  workingDir
}: {
  readonly desktopApi: AiPanelSurfaceProps["desktopApi"];
  readonly workingDir?: string | null;
}) => {
  const icon = useSessionIdentityIcon(desktopApi, workingDir);
  return (
    <IdentityIconView
      className="lyra-agents-session-tab-icon"
      imageClassName="lyra-agents-session-tab-image"
      iconUrl={icon.url}
      label={icon.label}
      fallback={<LyraLogo className="lyra-agents-session-tab-logo" alt="" />}
    />
  );
};

const AiPanelTabsHeader = ({
  desktopApi,
  tabs,
  activeSessionTabId,
  activeSessionId,
  onActivateSessionTab,
  onCloseSessionTab,
  onReorderSessionTabs
}: {
  readonly desktopApi: AiPanelSurfaceProps["desktopApi"];
  readonly tabs: readonly AiPanelSessionTab[];
  readonly activeSessionTabId: string | null;
  readonly activeSessionId: string | null;
  readonly onActivateSessionTab?: (sessionId: string) => void;
  readonly onCloseSessionTab?: (sessionId: string) => void;
  readonly onReorderSessionTabs?: (sourceTabId: string, targetTabId: string) => void;
}) => {
  const { session, isTurnRunning } = useData();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<AiSessionTabDragState | null>(null);
  const suppressNextClickRef = useRef<string | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragVisual, setDragVisual] = useState<AiSessionTabDragVisualState | null>(null);
  const currentSessionId = session.id?.trim() || null;
  const effectiveActiveTabId =
    activeSessionTabId
    ?? tabs.find((tab) => tab.sessionId === activeSessionId)?.tabId
    ?? currentSessionId
    ?? (tabs.length === 0 ? "__local-draft" : null);
  const currentTab: AiPanelSessionTab | null =
    currentSessionId === null
      ? null
      : ({
          tabId: currentSessionId,
          sessionId: currentSessionId,
          title: session.title,
          lastKnownStatus: isTurnRunning ? "running" : null,
          workingDir: session.workingDir,
          projectBound: session.projectBound,
          workingDirIsHome: session.workingDirIsHome
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
  const visibleTabTitlesKey = visibleTabs
    .map((tab) => `${tab.tabId}:${tab.title}`)
    .join("\n");
  const visibleTabTitles = useMemo(
    () => visibleTabs.map((tab) => tab.title),
    [visibleTabTitlesKey]
  );
  const { layout } = useAiSessionTabLayout(
    visibleTabTitles,
    stripRef
  );
  const listSpacerStyle = {
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
            const workingDir = hasCurrentSnapshot
              ? session.workingDir
              : tab.workingDir ?? tab.draftWorkingDir ?? null;
            const tabLayout = layout.items[index];
            const tabStyle = tabLayout === undefined
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
                  <SessionTabIdentityIcon desktopApi={desktopApi} workingDir={workingDir} />
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
      </div>
      <HeaderControls forceShowNewSessionButton />
    </header>
  );
};

export const AiPanelSurface = ({
  variant: _variant,
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
  onUpdateDraftWorkingDir,
  onOpenProjectTree,
  onRevealProjectPath,
  onOpenModelSettings,
  onOpenUrlInWorkbench,
  onOpenTerminalLiveSession,
  onOpenFile,
  onRevealPathInWorkbench,
  openDialog,
  locale,
  title,
  composerCitationSinkRef,
  onSetActiveBrowserTab,
  resolveActiveWorkspaceTab,
  onPickFileFromFileManager,
  listWorkspaceTabs,
  listTerminalTabs,
  locationControls,
  aiRichRenderingEnabled = true
}: AiPanelSurfaceProps) => {
  const activeTab =
    sessionTabs.find((tab) => tab.tabId === activeSessionTabId)
    ?? sessionTabs.find((tab) => tab.sessionId === activeSessionId)
    ?? null;
  const activeDraftTabId = activeTab?.sessionId === null ? activeTab.tabId : null;
  const updateActiveDraftWorkingDir = useCallback(
    (workingDir: string): void => {
      if (activeDraftTabId === null) return;
      onUpdateDraftWorkingDir?.(activeDraftTabId, workingDir);
    },
    [activeDraftTabId, onUpdateDraftWorkingDir]
  );
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
      onUpdateDraftWorkingDir: updateActiveDraftWorkingDir,
      onOpenProjectTree,
      onRevealProjectPath,
      onOpenModelSettings,
      onOpenUrlInWorkbench,
      onOpenFile,
      onRevealPathInWorkbench,
      onOpenTerminalLiveSession,
      openDialog,
      locale,
      composerCitationSinkRef,
      onSetActiveBrowserTab,
      resolveActiveWorkspaceTab,
      onPickFileFromFileManager,
      listWorkspaceTabs,
      listTerminalTabs,
      locationControls,
      aiRichRenderingEnabled
    }
  );

  return (
    <AppPanel placement="right" className="lyra-ai-panel-shell" aria-label={title}>
      {provider.error === null ? null : (
        <AppStatusMessage className="lyra-ai-panel-error" role="status" tone="error">
          {provider.error}
        </AppStatusMessage>
      )}
      {provider.turnFailureMessage === null ? null : (
        <AppStatusMessage className="lyra-ai-panel-turn-failure" role="status" tone="warning">
          <div className="lyra-ai-panel-turn-failure-row">
            <span>{provider.turnFailureMessage}</span>
            <AppButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void provider.retryFailedTurn();
              }}
            >
              {t("lyra-agents-turnFailure.retry")}
            </AppButton>
          </div>
        </AppStatusMessage>
      )}
      <div className="lyra-agents-host">
        <LyraAgentsApp
          data={provider.data}
          desktopApi={desktopApi}
          headerSlot={
            <AiPanelTabsHeader
              desktopApi={desktopApi}
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
