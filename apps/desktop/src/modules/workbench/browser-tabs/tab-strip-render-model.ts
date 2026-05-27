import type { CSSProperties } from "react";

import { cx } from "../ui-primitives";
import type { WorkspaceTab } from "../workspace-tabs/types";
import type { RightDragPreview } from "./tab-strip-types";

export type BrowserTabStripDensity = "regular" | "small" | "smaller" | "mini";

export type BrowserTabStripTabModel = {
  readonly tab: WorkspaceTab;
  readonly isCollapsed: boolean;
  readonly tabClassName: string;
  readonly tabMainClassName: string;
  readonly closeLabel: string;
};

export type BrowserTabStripPreviewModel = {
  readonly tab: WorkspaceTab;
  readonly shellStyle: CSSProperties;
  readonly tabClassName: string;
  readonly tabStyle: CSSProperties;
  readonly mainClassName: string;
  readonly isCollapsed: boolean;
};

export type BrowserTabStripRenderModel = {
  readonly navClassName: string;
  readonly navStyle?: CSSProperties | undefined;
  readonly stripClassName: string;
  readonly tabs: readonly BrowserTabStripTabModel[];
  readonly preview: BrowserTabStripPreviewModel | null;
};

type CreateBrowserTabStripRenderModelInput = {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly splitGroupTabIds: readonly string[];
  readonly stackedMode: boolean;
  readonly closeTabLabel: string;
  readonly isTabInSplit?: ((tabId: string) => boolean) | undefined;
  readonly isTerminalDropActive: boolean;
  readonly dropIndicatorX: number | null;
  readonly isSplitDropActive: boolean;
  readonly splitDropTargetTabId: string | null;
  readonly workspaceDragTabId: string | null;
  readonly rightDragPreview: RightDragPreview | null;
  readonly density?: BrowserTabStripDensity;
  readonly closeLockedTabWidth?: number | null;
};

export const createBrowserTabStripRenderModel = ({
  tabs,
  activeTabId,
  splitGroupTabIds,
  stackedMode,
  closeTabLabel,
  isTabInSplit,
  isTerminalDropActive,
  dropIndicatorX,
  isSplitDropActive,
  splitDropTargetTabId,
  workspaceDragTabId,
  rightDragPreview,
  density = "regular",
  closeLockedTabWidth = null
}: CreateBrowserTabStripRenderModelInput): BrowserTabStripRenderModel => {
  const splitGroupLookup = new Set(splitGroupTabIds);
  const isSplitGroupActive = splitGroupLookup.has(activeTabId);
  const isDraggingSplitGroup =
    workspaceDragTabId !== null && splitGroupLookup.has(workspaceDragTabId);

  const tabModels = tabs.map((tab, index): BrowserTabStripTabModel => {
    const isActive = tab.id === activeTabId;
    const isCollapsed = stackedMode && !isActive;
    const nextTab = tabs[index + 1];
    const isCurrentTabInSplit =
      splitGroupLookup.has(tab.id) || isTabInSplit?.(tab.id) === true;
    const isNextTabInSplit =
      nextTab !== undefined &&
      (splitGroupLookup.has(nextTab.id) || isTabInSplit?.(nextTab.id) === true);
    const isFocusedTabInActiveSplitGroup =
      isSplitGroupActive && isCurrentTabInSplit && isActive;
    const isTabInDraggingSplitGroup = isDraggingSplitGroup && isCurrentTabInSplit;

    return {
      tab,
      isCollapsed,
      closeLabel: `${closeTabLabel}-${tab.title}`,
      tabClassName: cx(
        "lyra-browser-tab-item",
        "lyra-browser-tab-item-drag-enabled",
        "lyra-allow-web-drag",
        isActive && "lyra-browser-tab-item-active",
        isCollapsed && "lyra-browser-tab-item-collapsed",
        splitDropTargetTabId === tab.id && "lyra-browser-tab-item-split-target",
        isCurrentTabInSplit && isSplitGroupActive
          && "lyra-browser-tab-item-split-group-active",
        isCurrentTabInSplit && isNextTabInSplit
          && "lyra-browser-tab-item-split-joined-next",
        workspaceDragTabId === tab.id && "lyra-browser-tab-item-dragging",
        isTabInDraggingSplitGroup && "lyra-browser-tab-item-split-group-dragging"
      ),
      tabMainClassName: cx(
        isCollapsed
          ? "lyra-browser-tab-main lyra-browser-tab-main-collapsed"
          : "lyra-browser-tab-main",
        isFocusedTabInActiveSplitGroup && "lyra-browser-tab-main-split-focused"
      )
    };
  });

  const previewTab = rightDragPreview === null
    ? null
    : tabs.find((tab) => tab.id === rightDragPreview.tabId) ?? null;
  const preview = rightDragPreview === null || previewTab === null
    ? null
    : {
        tab: previewTab,
        shellStyle: {
          transform: `translate(${rightDragPreview.x + 14}px, ${rightDragPreview.y + 10}px)`
        },
        tabClassName: `${rightDragPreview.tabClassName} lyra-browser-tab-right-drag-preview-tab`,
        tabStyle: {
          width: `${Math.round(rightDragPreview.width)}px`,
          minWidth: `${Math.round(rightDragPreview.width)}px`,
          maxWidth: `${Math.round(rightDragPreview.width)}px`
        },
        mainClassName: `${rightDragPreview.tabMainClassName} lyra-browser-tab-right-drag-preview-main`,
        isCollapsed: rightDragPreview.isCollapsed
      };

  const navStyle = {
    ...(dropIndicatorX === null
      ? {}
      : { "--lyra-browser-drop-indicator-x": `${dropIndicatorX}px` }),
    ...(closeLockedTabWidth === null
      ? {}
      : { "--lyra-browser-tab-close-lock-w": `${Math.round(closeLockedTabWidth)}px` })
  } as CSSProperties;

  return {
    navClassName: cx(
      "lyra-browser-tabs",
      isTerminalDropActive && "lyra-browser-tabs-terminal-drop-target",
      dropIndicatorX !== null && "lyra-browser-tabs-reorder-active",
      isSplitDropActive && "lyra-browser-tabs-split-drop-active"
    ),
    navStyle: Object.keys(navStyle).length === 0 ? undefined : navStyle,
    stripClassName: cx(
      "lyra-browser-tab-strip",
      stackedMode && "lyra-browser-tab-strip-stacked",
      density !== "regular" && `lyra-browser-tab-strip-density-${density}`,
      closeLockedTabWidth !== null && "lyra-browser-tab-strip-close-lock"
    ),
    tabs: tabModels,
    preview
  };
};
