import { Plus, X } from "@lyra/icons";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
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
import { LyraAgentsApp } from "./lyra-agents/LyraAgentsApp";
import { t, formatMessage } from "@workbench/i18n";
import { useData } from "./lyra-agents/data/DataProvider";
import { HeaderControls } from "./lyra-agents/features/header/Header";
import { inlineContentMarkersToDisplayText } from "./lyra-agents/features/chat/message-citation";
import type { AiPanelSessionTab } from "./session-tabs";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";
import {
  closestChromeTabLayoutIndex,
  handleChromeTabCloseClick,
  handleChromeTabClosePointerDown,
  isMiddleClick,
  useChromeTabStripCloseLock,
  useChromeTabStripLayout
} from "../ui-primitives";

const AI_SESSION_TAB_DRAG_THRESHOLD_PX = 4;

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
  onReorderSessionTabs,
  aiPanelSide,
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel
}: {
  readonly desktopApi: AiPanelSurfaceProps["desktopApi"];
  readonly tabs: readonly AiPanelSessionTab[];
  readonly activeSessionTabId: string | null;
  readonly activeSessionId: string | null;
  readonly onActivateSessionTab?: (sessionId: string) => void;
  readonly onCloseSessionTab?: (sessionId: string) => void;
  readonly onReorderSessionTabs?: (sourceTabId: string, targetTabId: string) => void;
  readonly aiPanelSide?: AiPanelSurfaceProps["aiPanelSide"];
  readonly onToggleAiPanelSide?: () => void;
  readonly movePanelToLeftLabel?: string;
  readonly movePanelToRightLabel?: string;
}) => {
  const { session, isTurnRunning, createSession } = useData();
  const headerRef = useRef<HTMLElement | null>(null);
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
            title: t("aiPanel.defaultSessionTitle"),
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
  const closeLock = useChromeTabStripCloseLock({
    tabCount: visibleTabs.length,
    onCloseTab: (tabId) => {
      onCloseSessionTab?.(tabId);
    }
  });
  const layout = useChromeTabStripLayout({
    titles: visibleTabTitles,
    hostRef: headerRef,
    stripSelector: ".lyra-agents-session-tab-strip",
    addButtonSelector: ".lyra-agents-session-tab-add",
    titleSelector: ".lyra-agents-session-tab-title",
    closeLockedTabWidth: closeLock.closeLockedTabWidth
  });
  const listSpacerStyle = {
    width: `${Math.ceil(layout.contentWidth)}px`
  };

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
    const destinationIndex = closestChromeTabLayoutIndex(
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
    <header
      ref={headerRef}
      className="lyra-agents-header lyra-agents-session-tabs-header"
      onPointerLeave={closeLock.onClearCloseLock}
    >
      <div
        className={cn(
          "lyra-tab-strip",
          "lyra-agents-session-tab-strip",
          dragVisual !== null && "lyra-agents-session-tab-strip-sorting",
          closeLock.closeLockedTabWidth !== null && "lyra-tab-strip-close-lock"
        )}
        role="tablist"
        aria-label={t("aiPanel.sessionTabsAriaLabel")}
      >
        <div className="lyra-agents-session-tab-list">
          <div
            className="lyra-agents-session-tab-list-spacer"
            style={listSpacerStyle}
            aria-hidden="true"
          />
          {visibleTabs.map((tab, index) => {
            const active = tab.tabId === effectiveActiveTabId;
            const hasCurrentSnapshot =
              tab.sessionId !== null && tab.sessionId === currentSessionId;
            const rawTitle = hasCurrentSnapshot
              ? session.title.trim() || tab.title
              : tab.title.trim();
            const title = inlineContentMarkersToDisplayText(rawTitle).trim()
              || t("aiPanel.defaultSessionTitle");
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
            // Chrome-like: narrow tabs reuse the icon slot for close.
            const isNarrowTab =
              tabLayout !== undefined && tabLayout.width > 0 && tabLayout.width < 68;
            return (
              <div
                key={tab.tabId}
                className={cn(
                  "lyra-tab-item",
                  "lyra-agents-session-tab-item",
                  active && "lyra-tab-item-active",
                  active && "lyra-agents-session-tab-item-active",
                  running && "lyra-agents-session-tab-item-running",
                  isNarrowTab && "lyra-agents-session-tab-item-narrow",
                  draggingTabId === tab.tabId && "lyra-agents-session-tab-item-dragging"
                )}
                style={tabStyle}
                data-lyra-tab-id={tab.tabId}
                data-ai-session-tab-id={tab.tabId}
                onPointerMove={onTabPointerMove}
                onPointerUp={onTabPointerUp}
                onPointerCancel={onTabPointerUp}
                onMouseDown={(event) => {
                  if (isMiddleClick(event)) {
                    event.preventDefault();
                    closeLock.onCloseTab(tab.tabId, event);
                  }
                }}
                onAuxClick={(event) => {
                  if (isMiddleClick(event)) {
                    event.preventDefault();
                    closeLock.onCloseTab(tab.tabId, event);
                  }
                }}
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
                    if (event.button === 1) {
                      event.preventDefault();
                      return;
                    }
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
                  aria-label={formatMessage("aiPanel.closeSessionTabAriaLabel", { title })}
                  title={formatMessage("aiPanel.closeSessionTabAriaLabel", { title })}
                  onPointerDown={(event) => {
                    handleChromeTabClosePointerDown(event, (closeEvent) => {
                      closeLock.onCloseTab(tab.tabId, closeEvent);
                    });
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    handleChromeTabCloseClick(event, (closeEvent) => {
                      closeLock.onCloseTab(tab.tabId, closeEvent);
                    });
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </AppIconButton>
              </div>
            );
          })}
        </div>
        <AppIconButton
          className="lyra-tab-add lyra-agents-session-tab-add"
          style={{ transform: `translate3d(${Math.round(layout.addButtonX)}px, 0, 0)` }}
          aria-label={t("header.newSession")}
          title={t("header.newSession")}
          onClick={() => {
            void createSession();
          }}
        >
          <Plus size={14} aria-hidden="true" />
        </AppIconButton>
      </div>
      <HeaderControls
        showNewSessionButton={false}
        {...(aiPanelSide === undefined ? {} : { aiPanelSide })}
        {...(onToggleAiPanelSide === undefined ? {} : { onToggleAiPanelSide })}
        {...(movePanelToLeftLabel === undefined ? {} : { movePanelToLeftLabel })}
        {...(movePanelToRightLabel === undefined ? {} : { movePanelToRightLabel })}
      />
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
  onOpenPlanBoard,
  onOpenProjectPlanManager,
  onOpenAgentGit,
  onOpenSubagent,
  onRevealProjectPath,
  onOpenModelSettings,
  onOpenUrlInWorkbench,
  onOpenTerminalLiveSession,
  onOpenFile,
  onRevealPathInWorkbench,
  openDialog,
  title,
  aiPanelSide,
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel,
  composerCitationSinkRef,
  onSetActiveBrowserTab,
  resolveActiveWorkspaceTab,
  onPickFileFromFileManager,
  listWorkspaceTabs,
  listTerminalTabs,
  getTerminalTabPanes,
  onCloseTerminalTab,
  onFocusTerminalTabInDock,
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
      onOpenPlanBoard,
      onOpenProjectPlanManager,
      ...(onOpenAgentGit === undefined ? {} : { onOpenAgentGit }),
      ...(onOpenSubagent === undefined ? {} : { onOpenSubagent }),
      onRevealProjectPath,
      onOpenModelSettings,
      onOpenUrlInWorkbench,
      onOpenFile,
      onRevealPathInWorkbench,
      onOpenTerminalLiveSession,
      openDialog,
      composerCitationSinkRef,
      onSetActiveBrowserTab,
      resolveActiveWorkspaceTab,
      onPickFileFromFileManager,
      listWorkspaceTabs,
      listTerminalTabs,
      getTerminalTabPanes,
      onCloseTerminalTab,
      onFocusTerminalTabInDock,
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
              {...(aiPanelSide === undefined ? {} : { aiPanelSide })}
              {...(onToggleAiPanelSide === undefined ? {} : { onToggleAiPanelSide })}
              {...(movePanelToLeftLabel === undefined ? {} : { movePanelToLeftLabel })}
              {...(movePanelToRightLabel === undefined ? {} : { movePanelToRightLabel })}
            />
          }
        />
      </div>
    </AppPanel>
  );
};
