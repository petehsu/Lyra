import {
  PanelBottom,
  PanelTop,
  Pin,
  Plus,
  SplitSquareHorizontal,
  SplitSquareVertical,
  SquareTerminal,
  Star,
  X
} from "lucide-react";
import {
  useCallback,
  useState,
  type DragEvent as ReactDragEvent
} from "react";
import "xterm/css/xterm.css";

import {
  clearTerminalTabDragPayload,
  readTerminalTabDragPayload,
  setTerminalTabDragImage,
  writeTerminalTabDragPayload
} from "./drag-transfer";
import { TerminalPaneSurface } from "./pane-surface";
import type { TerminalDockProps } from "./types";
import { IdentityIconView, type ResolvedIdentityIcon } from "../identity";
import { LyraLogo } from "@renderer/ui/app";
import { AppButton, AppIconButton } from "@renderer/ui/components";
import { cn } from "@renderer/ui/utils";

const terminalTabDisplayTitles = (
  tabs: TerminalDockProps["model"]["dockTabs"]
): Readonly<Record<string, string>> => {
  const totals = new Map<string, number>();
  for (const tab of tabs) {
    totals.set(tab.title, (totals.get(tab.title) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const titles: Record<string, string> = {};
  for (const tab of tabs) {
    const nextSeen = (seen.get(tab.title) ?? 0) + 1;
    seen.set(tab.title, nextSeen);
    titles[tab.id] =
      (totals.get(tab.title) ?? 0) > 1 && nextSeen > 1
        ? `${tab.title} ${nextSeen}`
        : tab.title;
  }
  return titles;
};

const TerminalTabIcon = ({
  icon
}: {
  readonly icon?: ResolvedIdentityIcon | undefined;
}) => (
  <IdentityIconView
    className="lyra-terminal-tab-icon"
    imageClassName="lyra-terminal-tab-icon-image"
    iconUrl={icon?.url ?? null}
    label={icon?.label}
    fallback={
      icon?.renderHint === "lyra-logo"
        ? <LyraLogo className="lyra-terminal-tab-lyra-logo" alt="" />
        : <SquareTerminal size={13} />
    }
  />
);

export const TerminalDock = ({
  desktopApi,
  labels,
  themeSignature,
  uiThemeId,
  model,
  terminalIdentityByTabId = {},
  terminalPanelSide,
  onRequestCloseTab,
  onRequestTabContextMenu,
  onToggleTerminalPanelSide,
  onDropWorkspaceTerminalTab
}: TerminalDockProps) => {
  const activeDockTab = model.activeDockTab;
  const displayTitleByTabId = terminalTabDisplayTitles(model.dockTabs);
  const [isWorkspaceDropActive, setIsWorkspaceDropActive] = useState(false);
  const [dockDropIndex, setDockDropIndex] = useState<number | null>(null);

  const clearDragUiState = useCallback((): void => {
    setIsWorkspaceDropActive(false);
    setDockDropIndex(null);
  }, []);

  const resolveDockDropIndex = useCallback(
    (event: ReactDragEvent<HTMLElement>): number => {
      const host = event.currentTarget;
      const tabsHost = host.querySelector<HTMLElement>(".lyra-terminal-tabs");
      if (tabsHost === null) {
        return model.dockTabs.length;
      }

      const tabsRect = tabsHost.getBoundingClientRect();
      const inTabsArea =
        event.clientX >= tabsRect.left &&
        event.clientX <= tabsRect.right &&
        event.clientY >= tabsRect.top &&
        event.clientY <= tabsRect.bottom;
      if (inTabsArea === false) {
        return model.dockTabs.length;
      }

      const tabElements = Array.from(
        tabsHost.querySelectorAll<HTMLElement>(".lyra-terminal-tab[data-lyra-terminal-tab-id]")
      );
      if (tabElements.length === 0) {
        return 0;
      }

      for (let index = 0; index < tabElements.length; index += 1) {
        const tabElement = tabElements[index];
        if (tabElement === undefined) {
          continue;
        }
        const rect = tabElement.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          return index;
        }
      }

      return tabElements.length;
    },
    [model.dockTabs.length]
  );

  const onDockTabDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, tabId: string): void => {
      writeTerminalTabDragPayload(event.dataTransfer, {
        source: "dock",
        tabId
      });
      setTerminalTabDragImage(
        event.dataTransfer,
        event.currentTarget,
        event.clientX,
        event.clientY
      );
    },
    []
  );

  const onWorkspaceDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const payload = readTerminalTabDragPayload(event.dataTransfer);
      if (payload === null) {
        clearDragUiState();
        return;
      }
      const nextDropIndex = resolveDockDropIndex(event);
      if (payload.source === "workspace") {
        if (onDropWorkspaceTerminalTab === undefined) {
          clearDragUiState();
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDockDropIndex(nextDropIndex);
        if (isWorkspaceDropActive === false) {
          setIsWorkspaceDropActive(true);
        }
        return;
      }
      if (payload.source === "dock") {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDockDropIndex(nextDropIndex);
        if (isWorkspaceDropActive) {
          setIsWorkspaceDropActive(false);
        }
        return;
      }

      clearDragUiState();
    },
    [
      clearDragUiState,
      isWorkspaceDropActive,
      onDropWorkspaceTerminalTab,
      resolveDockDropIndex
    ]
  );

  const onWorkspaceDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const currentTarget = event.currentTarget;
    if (currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    clearDragUiState();
  }, [clearDragUiState]);

  const onWorkspaceDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const dropIndex = resolveDockDropIndex(event);
      const payload = readTerminalTabDragPayload(event.dataTransfer);
      clearDragUiState();
      clearTerminalTabDragPayload();
      if (payload === null) {
        return;
      }
      event.preventDefault();
      if (payload.source === "workspace") {
        if (onDropWorkspaceTerminalTab === undefined) {
          return;
        }
        onDropWorkspaceTerminalTab(payload.tabId, dropIndex);
        return;
      }
      if (payload.source === "dock") {
        model.reorderDockTab(payload.tabId, dropIndex);
      }
    },
    [
      clearDragUiState,
      model,
      onDropWorkspaceTerminalTab,
      resolveDockDropIndex
    ]
  );

  return (
    <section
      className={cn(
        "lyra-terminal-dock",
        isWorkspaceDropActive && "lyra-terminal-dock-workspace-drop-target"
      )}
      aria-label="terminal-dock"
      onDragOverCapture={onWorkspaceDragOver}
      onDragEnterCapture={onWorkspaceDragOver}
      onDragLeaveCapture={onWorkspaceDragLeave}
      onDropCapture={onWorkspaceDrop}
    >
      <aside className="lyra-terminal-side" aria-label="terminal-tabs-side">
        <nav
          className={cn(
            "lyra-terminal-tabs",
            dockDropIndex !== null && dockDropIndex >= model.dockTabs.length
              && "lyra-terminal-tabs-drop-end"
          )}
          aria-label="terminal-tabs"
        >
          {model.dockTabs.map((tab, index) => (
            <div
              key={tab.id}
              className={cn(
                "lyra-terminal-tab",
                "lyra-allow-web-drag",
                tab.id === activeDockTab?.id && "lyra-terminal-tab-active",
                dockDropIndex !== null && dockDropIndex === index
                  && "lyra-terminal-tab-drop-target-before"
              )}
              data-lyra-terminal-tab-id={tab.id}
              data-lyra-allow-web-drag="true"
              draggable
              onDragStart={(event: ReactDragEvent<HTMLDivElement>) => {
                onDockTabDragStart(event, tab.id);
              }}
              onDragEnd={() => {
                clearTerminalTabDragPayload();
                clearDragUiState();
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onRequestTabContextMenu({
                  tabId: tab.id,
                  anchorX: event.clientX,
                  anchorY: event.clientY
                });
              }}
            >
              <AppButton
                className="lyra-terminal-tab-main"
                variant="ghost"
                size="sm"
                data-lyra-allow-web-drag="true"
                draggable
                aria-label={displayTitleByTabId[tab.id] ?? tab.title}
                onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                  onDockTabDragStart(event, tab.id);
                }}
                onDragEnd={() => {
                  clearTerminalTabDragPayload();
                  clearDragUiState();
                }}
                onClick={() => {
                  model.setActiveTab(tab.id);
                }}
                onDoubleClick={() => {
                  const nextTitle = window.prompt(labels.renameTab, tab.title);
                  if (nextTitle !== null) {
                    model.renameTab(tab.id, nextTitle);
                  }
                }}
              >
                <TerminalTabIcon icon={terminalIdentityByTabId[tab.id]} />
                <span className="lyra-terminal-tab-title">{displayTitleByTabId[tab.id] ?? tab.title}</span>
                {tab.pinned ? (
                  <span className="lyra-terminal-tab-badge" title={labels.unpinTab} aria-hidden="true">
                    <Pin size={10} />
                  </span>
                ) : null}
                {tab.favorite ? (
                  <span className="lyra-terminal-tab-badge" title={labels.unfavoriteTab} aria-hidden="true">
                    <Star size={10} />
                  </span>
                ) : null}
              </AppButton>
              <AppIconButton
                className="lyra-terminal-tab-close"
                aria-label={labels.closeTab}
                title={labels.closeTab}
                onClick={() => {
                  onRequestCloseTab(tab.id);
                }}
              >
                <X size={12} aria-hidden="true" />
              </AppIconButton>
            </div>
          ))}
        </nav>
        <div className="lyra-terminal-toolbar-actions">
          <AppIconButton
            aria-label={labels.newTab}
            title={labels.newTab}
            onClick={() => {
              model.openTab();
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            aria-label={labels.splitHorizontal}
            disabled={activeDockTab === null}
            onClick={() => {
              model.splitActivePane("horizontal");
            }}
          >
            <SplitSquareVertical size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            aria-label={labels.splitVertical}
            disabled={activeDockTab === null}
            onClick={() => {
              model.splitActivePane("vertical");
            }}
          >
            <SplitSquareHorizontal size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            aria-label={
              terminalPanelSide === "top"
                ? labels.moveTerminalToBottom
                : labels.moveTerminalToTop
            }
            onClick={onToggleTerminalPanelSide}
          >
            {terminalPanelSide === "top" ? (
              <PanelBottom size={14} aria-hidden="true" />
            ) : (
              <PanelTop size={14} aria-hidden="true" />
            )}
          </AppIconButton>
        </div>
      </aside>

      <section className="lyra-terminal-stage">
        {activeDockTab === null ? (
          <section className="lyra-terminal-empty">
            <span>{labels.emptyDock}</span>
          </section>
        ) : (
          <section
            className={
              activeDockTab.orientation === "vertical"
                ? "lyra-terminal-panes lyra-terminal-panes-vertical"
                : "lyra-terminal-panes lyra-terminal-panes-horizontal"
            }
          >
            {model.activeDockPanes.map((pane) => (
              <TerminalPaneSurface
                key={pane.id}
                pane={pane}
                terminalTabId={activeDockTab.id}
                active={pane.id === activeDockTab.activePaneId}
                desktopApi={desktopApi}
                labels={labels}
                themeSignature={themeSignature}
                uiThemeId={uiThemeId}
                canClose={model.activeDockPanes.length > 1}
                onClose={() => {
                  model.closePane(activeDockTab.id, pane.id);
                }}
                onFocus={() => {
                  model.focusPane(activeDockTab.id, pane.id);
                }}
              />
            ))}
          </section>
        )}
      </section>
    </section>
  );
};
