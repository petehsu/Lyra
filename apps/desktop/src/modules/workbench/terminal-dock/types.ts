import type {
  LyraDesktopApi,
  TerminalCreateRequest,
  TerminalSessionSnapshot
} from "../../../shared/desktop-bridge";
import type { TerminalThemePresetId } from "../terminal-theme";
import type {
  TerminalDockPaneState as TerminalDockPane,
  TerminalDockState,
  TerminalDockTabState as TerminalDockTab,
  TerminalTabPlacement,
  TerminalSplitDirection
} from "../shell/types";
export type {
  TerminalDockPaneState as TerminalDockPane,
  TerminalDockState,
  TerminalDockTabState as TerminalDockTab,
  TerminalTabPlacement,
  TerminalSplitDirection
} from "../shell/types";

export type TerminalDockLabels = {
  readonly newTab: string;
  readonly splitHorizontal: string;
  readonly splitVertical: string;
  readonly moveTerminalToTop: string;
  readonly moveTerminalToBottom: string;
  readonly closeTab: string;
  readonly emptyDock: string;
  readonly unavailable: string;
};

export type TerminalDockModel = {
  readonly state: TerminalDockState;
  readonly dockTabs: readonly TerminalDockTab[];
  readonly workspaceTabs: readonly TerminalDockTab[];
  readonly activeDockTab: TerminalDockTab | null;
  readonly activeDockPanes: readonly TerminalDockPane[];
  readonly restoreRequest: {
    readonly sessions: readonly TerminalCreateRequest[];
  };
  readonly findTab: (tabId: string) => TerminalDockTab | null;
  readonly getTabPanes: (tabId: string) => readonly TerminalDockPane[];
  readonly setActiveTab: (tabId: string) => void;
  readonly openTab: () => void;
  readonly openTabWithPlacement: (request?: {
    readonly placement?: TerminalTabPlacement;
    readonly title?: string;
    readonly cwd?: string;
  }) => {
    readonly tab: TerminalDockTab;
    readonly pane: TerminalDockPane;
  };
  readonly closeTab: (tabId: string) => void;
  readonly moveTabToWorkspace: (tabId: string) => void;
  readonly moveTabToDock: (tabId: string) => void;
  readonly reorderDockTab: (tabId: string, targetIndex: number) => void;
  readonly splitActivePane: (direction: TerminalSplitDirection) => void;
  readonly splitTab: (tabId: string, direction: TerminalSplitDirection) => void;
  readonly focusPane: (tabId: string, paneId: string) => void;
  readonly closePane: (tabId: string, paneId: string) => void;
  readonly syncRestoredSessions: (snapshots: readonly TerminalSessionSnapshot[]) => void;
};

export type TerminalTabContextMenuRequest = {
  readonly tabId: string;
  readonly anchorX: number;
  readonly anchorY: number;
};

export type TerminalDockProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: TerminalDockLabels;
  readonly themeSignature: string;
  readonly themePresetId: TerminalThemePresetId;
  readonly uiThemeId: string;
  readonly model: TerminalDockModel;
  readonly terminalPanelSide: "top" | "bottom";
  readonly onRequestCloseTab: (tabId: string) => void;
  readonly onRequestTabContextMenu: (request: TerminalTabContextMenuRequest) => void;
  readonly onToggleTerminalPanelSide: () => void;
  readonly onDropWorkspaceTerminalTab?: (tabId: string, targetIndex: number) => void;
};
