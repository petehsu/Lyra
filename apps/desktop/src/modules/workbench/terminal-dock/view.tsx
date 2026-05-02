import {
  PanelBottom,
  PanelTop,
  Plus,
  SplitSquareHorizontal,
  SplitSquareVertical,
  SquareTerminal,
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
import {
  ChromeIconButton,
  ChromeTabButton,
  ChromeTabFrame,
  ChromeToolbar,
  cx
} from "../ui-primitives";

export const TerminalDock = ({
  desktopApi,
  labels,
  themeSignature,
  themePresetId,
  uiThemeId,
  model,
  terminalPanelSide,
  onRequestCloseTab,
  onRequestTabContextMenu,
  onToggleTerminalPanelSide,
  onDropWorkspaceTerminalTab
}: TerminalDockProps) => {
  const activeDockTab = model.activeDockTab;
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
      className={cx(
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
          className={cx(
            "lyra-terminal-tabs",
            dockDropIndex !== null && dockDropIndex >= model.dockTabs.length
              && "lyra-terminal-tabs-drop-end"
          )}
          aria-label="terminal-tabs"
        >
          {model.dockTabs.map((tab, index) => (
            <ChromeTabFrame
              key={tab.id}
              className={cx(
                "lyra-terminal-tab",
                "lyra-allow-web-drag",
                tab.id === activeDockTab?.id && "lyra-terminal-tab-active",
                dockDropIndex !== null && dockDropIndex === index
                  && "lyra-terminal-tab-drop-target-before"
              )}
              data-lyra-terminal-tab-id={tab.id}
              allowWebDrag
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
              <ChromeTabButton
                className="lyra-terminal-tab-main"
                allowWebDrag
                draggable
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
              >
                <span className="lyra-terminal-tab-icon" aria-hidden="true">
                  <SquareTerminal size={13} />
                </span>
                <span className="lyra-terminal-tab-title">{tab.title}</span>
              </ChromeTabButton>
              <ChromeIconButton
                className="lyra-terminal-tab-close"
                aria-label={labels.closeTab}
                onClick={() => {
                  onRequestCloseTab(tab.id);
                }}
              >
                <X size={12} />
              </ChromeIconButton>
            </ChromeTabFrame>
          ))}
        </nav>
        <ChromeToolbar className="lyra-terminal-toolbar-actions">
          <ChromeIconButton aria-label={labels.newTab} onClick={model.openTab}>
            <Plus size={14} />
          </ChromeIconButton>
          <ChromeIconButton
            aria-label={labels.splitHorizontal}
            disabled={activeDockTab === null}
            onClick={() => {
              model.splitActivePane("horizontal");
            }}
          >
            <SplitSquareHorizontal size={14} />
          </ChromeIconButton>
          <ChromeIconButton
            aria-label={labels.splitVertical}
            disabled={activeDockTab === null}
            onClick={() => {
              model.splitActivePane("vertical");
            }}
          >
            <SplitSquareVertical size={14} />
          </ChromeIconButton>
          <ChromeIconButton
            aria-label={
              terminalPanelSide === "top"
                ? labels.moveTerminalToBottom
                : labels.moveTerminalToTop
            }
            onClick={onToggleTerminalPanelSide}
          >
            {terminalPanelSide === "top" ? (
              <PanelBottom size={14} />
            ) : (
              <PanelTop size={14} />
            )}
          </ChromeIconButton>
        </ChromeToolbar>
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
                active={pane.id === activeDockTab.activePaneId}
                desktopApi={desktopApi}
                labels={labels}
                themeSignature={themeSignature}
                themePresetId={themePresetId}
                uiThemeId={uiThemeId}
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
