import { useCallback } from "react";
import {
  PanelBottomOpen,
  PanelTopOpen,
  Pencil,
  Pin,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Star,
  X
} from "lucide-react";

import type { I18nKey } from "../i18n";
import type { ContextMenuModel, ContextMenuItem } from "../context-menu";
import { disposeTerminalRendererForSession } from "../terminal-dock/pane-surface";
import type { TerminalDockModel } from "../terminal-dock/types";
import type { WorkspaceTabsModel } from "../workspace-tabs/types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

type UseTerminalWorkspaceActionsArgs = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly terminalModel: TerminalDockModel;
  readonly contextMenuModel: ContextMenuModel;
  readonly t: (key: I18nKey) => string;
};

export type TerminalWorkspaceActions = {
  readonly openTerminalTabInWorkspace: (
    terminalTabId: string,
    targetIndex?: number
  ) => void;
  readonly openTerminalTabInDock: (terminalTabId: string, targetIndex?: number) => void;
  readonly closeTerminalTabEverywhere: (terminalTabId: string) => void;
  readonly openDockTabContextMenu: (tabId: string, anchorX: number, anchorY: number) => void;
  readonly onWorkspaceTabContextMenu: (browserTabId: string, anchorX: number, anchorY: number) => void;
  readonly onBrowserTabClose: (tabId: string) => void;
};

export const useTerminalWorkspaceActions = ({
  desktopApi,
  tabsModel,
  terminalModel,
  contextMenuModel,
  t
}: UseTerminalWorkspaceActionsArgs): TerminalWorkspaceActions => {
  const openTerminalTabInWorkspace = useCallback((
    terminalTabId: string,
    targetIndex?: number
  ): void => {
    const targetTab = terminalModel.findTab(terminalTabId);
    if (targetTab === null) {
      return;
    }
    terminalModel.moveTabToWorkspace(terminalTabId);
    tabsModel.openTerminalTab(
      terminalTabId,
      targetTab.title,
      targetIndex === undefined ? undefined : { targetIndex }
    );
  }, [tabsModel, terminalModel]);

  const openTerminalTabInDock = useCallback((
    terminalTabId: string,
    targetIndex?: number
  ): void => {
    const targetTab = terminalModel.findTab(terminalTabId);
    if (targetTab === null) {
      return;
    }
    terminalModel.moveTabToDock(targetTab.id);
    if (targetIndex !== undefined) {
      terminalModel.reorderDockTab(targetTab.id, targetIndex);
    }
    tabsModel.closeTerminalTab(targetTab.id);
  }, [tabsModel, terminalModel]);

  const closeTerminalSessions = useCallback(async (sessionIds: readonly string[]): Promise<void> => {
    if (desktopApi === null || sessionIds.length === 0) {
      return;
    }
    await Promise.all(
      sessionIds.map((sessionId) =>
        desktopApi.terminal.closeSession({ sessionId }).catch((_error: unknown) => undefined)
      )
    );
    for (const sessionId of sessionIds) {
      disposeTerminalRendererForSession(sessionId);
    }
  }, [desktopApi]);

  const closeTerminalTabEverywhere = useCallback((terminalTabId: string): void => {
    const targetTab = terminalModel.findTab(terminalTabId);
    if (targetTab !== null) {
      const sessionIds = terminalModel.getTabPanes(targetTab.id).map((pane) => pane.sessionId);
      void closeTerminalSessions(sessionIds);
      terminalModel.closeTab(targetTab.id);
    }
    tabsModel.closeTerminalTab(terminalTabId);
  }, [closeTerminalSessions, tabsModel, terminalModel]);

  const openDockTabContextMenu = useCallback((tabId: string, anchorX: number, anchorY: number): void => {
    const targetTab = terminalModel.findTab(tabId);
    if (targetTab === null) {
      return;
    }

    const items: readonly ContextMenuItem[] = [
      {
        id: "rename-terminal",
        label: t("terminal.renameTab"),
        icon: <Pencil size={13} />,
        onSelect: () => {
          const nextTitle = window.prompt(t("terminal.renameTab"), targetTab.title);
          if (nextTitle !== null) {
            terminalModel.renameTab(tabId, nextTitle);
          }
        }
      },
      {
        id: "pin-terminal",
        label: targetTab.pinned ? t("terminal.unpinTab") : t("terminal.pinTab"),
        icon: <Pin size={13} />,
        onSelect: () => {
          terminalModel.toggleTabPinned(tabId);
        }
      },
      {
        id: "favorite-terminal",
        label: targetTab.favorite ? t("terminal.unfavoriteTab") : t("terminal.favoriteTab"),
        icon: <Star size={13} />,
        onSelect: () => {
          terminalModel.toggleTabFavorite(tabId);
        }
      },
      {
        id: "open-in-workspace",
        label: t("menu.openInWorkspace"),
        icon: <PanelTopOpen size={13} />,
        onSelect: () => {
          openTerminalTabInWorkspace(tabId);
        }
      },
      {
        id: "split-horizontal",
        label: t("terminal.splitHorizontal"),
        icon: <SplitSquareHorizontal size={13} />,
        onSelect: () => {
          terminalModel.splitTab(tabId, "horizontal");
        }
      },
      {
        id: "split-vertical",
        label: t("terminal.splitVertical"),
        icon: <SplitSquareVertical size={13} />,
        onSelect: () => {
          terminalModel.splitTab(tabId, "vertical");
        }
      },
      {
        id: "close-tab",
        label: t("menu.close"),
        icon: <X size={13} />,
        separatorBefore: true,
        danger: true,
        onSelect: () => {
          closeTerminalTabEverywhere(tabId);
        }
      }
    ];

    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items
    });
  }, [
    closeTerminalTabEverywhere,
    contextMenuModel,
    openTerminalTabInWorkspace,
    t,
    terminalModel
  ]);

  const onWorkspaceTabContextMenu = useCallback((browserTabId: string, anchorX: number, anchorY: number): void => {
    const tab = tabsModel.tabs.find((entry) => entry.id === browserTabId);
    if (tab === undefined || tab.pageKind !== "terminal" || tab.terminalTabId === undefined) {
      return;
    }

    const targetTab = terminalModel.findTab(tab.terminalTabId);
    if (targetTab === null) {
      return;
    }

    const items: readonly ContextMenuItem[] = [
      {
        id: "open-in-terminal-area",
        label: t("menu.openInTerminalArea"),
        icon: <PanelBottomOpen size={13} />,
        onSelect: () => {
          openTerminalTabInDock(targetTab.id);
        }
      },
      {
        id: "close-tab",
        label: t("menu.close"),
        icon: <X size={13} />,
        separatorBefore: true,
        danger: true,
        onSelect: () => {
          closeTerminalTabEverywhere(targetTab.id);
        }
      }
    ];

    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items
    });
  }, [
    closeTerminalTabEverywhere,
    contextMenuModel,
    openTerminalTabInDock,
    t,
    tabsModel,
    terminalModel
  ]);

  const onBrowserTabClose = useCallback((tabId: string): void => {
    const tab = tabsModel.tabs.find((entry) => entry.id === tabId);
    if (tab !== undefined && tab.pageKind === "terminal" && tab.terminalTabId !== undefined) {
      closeTerminalTabEverywhere(tab.terminalTabId);
      return;
    }

    tabsModel.closeTab(tabId);
  }, [closeTerminalTabEverywhere, tabsModel]);

  return {
    openTerminalTabInWorkspace,
    openTerminalTabInDock,
    closeTerminalTabEverywhere,
    openDockTabContextMenu,
    onWorkspaceTabContextMenu,
    onBrowserTabClose
  };
};
