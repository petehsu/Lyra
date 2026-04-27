import type { WorkbenchSplitTriggerMode } from "../preferences";
import type { WorkspaceTabsInteractionPolicy } from "../interaction-policy";
import type { WorkspaceTab } from "../workspace-tabs/types";

export type BrowserTabDropRequest = {
  readonly terminalTabId: string;
  readonly targetIndex: number;
};

export type BrowserTabStripProps = {
  readonly tabs: readonly WorkspaceTab[];
  readonly splitGroupTabIds?: readonly string[];
  readonly activeTabId: string;
  readonly goBackLabel: string;
  readonly goForwardLabel: string;
  readonly toggleTabStackLabel: string;
  readonly stackedMode: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly openNewTabLabel: string;
  readonly closeTabLabel: string;
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly interactionPolicy?: WorkspaceTabsInteractionPolicy;
  readonly isTabInSplit?: (tabId: string) => boolean;
  readonly onGoBack: () => void;
  readonly onGoForward: () => void;
  readonly onToggleStackedMode: () => void;
  readonly onTabContextMenu?: (
    tab: WorkspaceTab,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onDropTerminalDockTab?: (request: BrowserTabDropRequest) => void;
  readonly onReorderTabs?: (tabId: string, targetIndex: number) => void;
  readonly onSplitTabs?: (sourceTabId: string, targetTabId: string) => void;
  readonly onDetachTabFromSplit?: (tabId: string) => void;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onOpenNewTab: () => void;
};

export type SplitHoverTarget = {
  readonly tabId: string | null;
  readonly isInsideStrip: boolean;
};

export type RightDragState = {
  readonly tabId: string;
  readonly startX: number;
  readonly startY: number;
  readonly moved: boolean;
  readonly tabClassName: string;
  readonly tabMainClassName: string;
  readonly isCollapsed: boolean;
  readonly width: number;
};

export type RightDragPreview = {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
  readonly tabClassName: string;
  readonly tabMainClassName: string;
  readonly isCollapsed: boolean;
  readonly width: number;
};
