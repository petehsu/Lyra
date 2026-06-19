import type {
  LyraDesktopApi,
  TerminalCreateRequest,
  TerminalCwdChangedEvent,
  TerminalSessionSnapshot
} from "../../../shared/desktop-bridge";
import type { ResolvedIdentityIcon } from "../identity";
import type {
  TerminalDockPaneState as TerminalDockPane,
  TerminalDockState,
  TerminalDockTabState as TerminalDockTab,
  TerminalFollowMode,
  TerminalTabPlacement,
  TerminalSplitDirection
} from "../shell/types";
import type { TerminalProfile, TerminalProfilePaneOptions } from "../terminal-profiles";
export type {
  TerminalDockPaneState as TerminalDockPane,
  TerminalDockState,
  TerminalDockTabState as TerminalDockTab,
  TerminalFollowMode,
  TerminalTabPlacement,
  TerminalSplitDirection
} from "../shell/types";

export type TerminalDockLabels = {
  readonly newTab: string;
  readonly newTabWithProfile: string;
  readonly profile: string;
  readonly splitHorizontal: string;
  readonly splitVertical: string;
  readonly moveTerminalToTop: string;
  readonly moveTerminalToBottom: string;
  readonly closeTab: string;
  readonly renameTab: string;
  readonly pinTab: string;
  readonly unpinTab: string;
  readonly favoriteTab: string;
  readonly unfavoriteTab: string;
  readonly exited: string;
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
    readonly shell?: string;
    readonly profileId?: string;
    readonly env?: TerminalProfilePaneOptions["env"];
    readonly startupCommand?: string;
    readonly mode?: "command" | "shell";
    readonly command?: string;
    readonly sourceAgentSessionId?: string;
  }) => {
    readonly tab: TerminalDockTab;
    readonly pane: TerminalDockPane;
  };
  readonly openTabWithProfile: (profile: TerminalProfile) => {
    readonly tab: TerminalDockTab;
    readonly pane: TerminalDockPane;
  };
  readonly renameTab: (tabId: string, title: string) => void;
  readonly toggleTabPinned: (tabId: string) => void;
  readonly toggleTabFavorite: (tabId: string) => void;
  readonly closeTab: (tabId: string) => void;
  readonly moveTabToWorkspace: (tabId: string) => void;
  readonly moveTabToDock: (tabId: string) => void;
  readonly reorderDockTab: (tabId: string, targetIndex: number) => void;
  readonly splitActivePane: (direction: TerminalSplitDirection) => void;
  readonly splitTab: (tabId: string, direction: TerminalSplitDirection) => void;
  readonly splitTabWithOptions: (
    tabId: string,
    direction: TerminalSplitDirection,
    options: {
      readonly title?: string;
      readonly cwd?: string;
      readonly shell?: string;
      readonly profileId?: string;
      readonly env?: TerminalProfilePaneOptions["env"];
      readonly startupCommand?: string;
      readonly mode?: "command" | "shell";
      readonly command?: string;
      readonly sourceAgentSessionId?: string;
    }
  ) => {
    readonly tab: TerminalDockTab;
    readonly pane: TerminalDockPane;
  } | null;
  readonly focusPane: (tabId: string, paneId: string) => void;
  readonly setPaneFollowMode: (tabId: string, paneId: string, followMode: TerminalFollowMode) => void;
  readonly closePane: (tabId: string, paneId: string) => void;
  readonly syncRestoredSessions: (snapshots: readonly TerminalSessionSnapshot[]) => void;
  readonly applyCwdChanged: (event: TerminalCwdChangedEvent) => void;
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
  readonly uiThemeId: string;
  readonly model: TerminalDockModel;
  readonly terminalIdentityByTabId?: Readonly<Record<string, ResolvedIdentityIcon>>;
  readonly terminalPanelSide: "top" | "bottom";
  readonly onRequestCloseTab: (tabId: string) => void;
  readonly onRequestTabContextMenu: (request: TerminalTabContextMenuRequest) => void;
  readonly onToggleTerminalPanelSide: () => void;
  readonly onDropWorkspaceTerminalTab?: (tabId: string, targetIndex: number) => void;
};
