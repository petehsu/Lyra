import { useMemo } from "react";

import { CLASSIC_WORKBENCH_INTERACTION_POLICIES } from "../interaction-policy";
import {
  useChromeTabStripCloseLock,
  useChromeTabStripLayout
} from "../ui-primitives";
import type { BrowserTabStripProps } from "./tab-strip-types";
import { createBrowserTabStripRenderModel } from "./tab-strip-render-model";
import { BrowserTabStripView } from "./tab-strip-view";
import { useBrowserTabStripRuntime } from "./use-browser-tab-strip-runtime";

export type { BrowserTabDropRequest, BrowserTabStripProps } from "./tab-strip-types";

export const BrowserTabStrip = ({
  tabs,
  splitGroupTabIds = [],
  activeTabId,
  agentActiveTabId = null,
  terminalIdentityByTabId = {},
  workspaceAppIdentityByTabId = {},
  goBackLabel,
  goForwardLabel,
  canGoBack,
  canGoForward,
  openNewTabLabel,
  closeTabLabel,
  navigationControl,
  toolbarContextControl,
  splitTriggerMode,
  interactionPolicy = CLASSIC_WORKBENCH_INTERACTION_POLICIES.workspaceTabs,
  isTabInSplit,
  onGoBack,
  onGoForward,
  onTabContextMenu,
  onDropTerminalDockTab,
  onReorderTabs,
  onSplitTabs,
  onDetachTabFromSplit,
  onActivateTab,
  onCloseTab,
  onOpenNewTab
}: BrowserTabStripProps) => {
  const runtime = useBrowserTabStripRuntime({
    tabs,
    splitGroupTabIds,
    splitTriggerMode,
    interactionPolicy,
    onTabContextMenu,
    onDropTerminalDockTab,
    onReorderTabs,
    onSplitTabs,
    onDetachTabFromSplit
  });
  const tabTitles = useMemo(() => tabs.map((tab) => tab.title), [tabs]);
  const closeLock = useChromeTabStripCloseLock({
    tabCount: tabs.length,
    onCloseTab
  });
  const layout = useChromeTabStripLayout({
    titles: tabTitles,
    hostRef: runtime.navRef,
    stripSelector: ".lyra-browser-tab-strip",
    addButtonSelector: ".lyra-browser-tab-add",
    titleSelector: ".lyra-browser-tab-title",
    closeLockedTabWidth: closeLock.closeLockedTabWidth
  });
  const renderModel = useMemo(
    () => createBrowserTabStripRenderModel({
      tabs,
      activeTabId,
      agentActiveTabId,
      splitGroupTabIds,
      closeTabLabel,
      isTabInSplit,
      isTerminalDropActive: runtime.state.isTerminalDropActive,
      dropIndicatorX: runtime.state.dropIndicatorX,
      isSplitDropActive: runtime.state.isSplitDropActive,
      splitDropTargetTabId: runtime.state.splitDropTargetTabId,
      workspaceDragTabId: runtime.state.workspaceDragTabId,
      rightDragPreview: runtime.state.rightDragPreview,
      layout,
      closeLockedTabWidth: closeLock.closeLockedTabWidth
    }),
    [
      activeTabId,
      agentActiveTabId,
      closeTabLabel,
      closeLock.closeLockedTabWidth,
      layout,
      isTabInSplit,
      runtime.state.dropIndicatorX,
      runtime.state.isSplitDropActive,
      runtime.state.isTerminalDropActive,
      runtime.state.rightDragPreview,
      runtime.state.splitDropTargetTabId,
      runtime.state.workspaceDragTabId,
      splitGroupTabIds,
      tabs
    ]
  );

  return (
    <BrowserTabStripView
      renderModel={renderModel}
      runtime={runtime}
      goBackLabel={goBackLabel}
      goForwardLabel={goForwardLabel}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      openNewTabLabel={openNewTabLabel}
      terminalIdentityByTabId={terminalIdentityByTabId}
      workspaceAppIdentityByTabId={workspaceAppIdentityByTabId}
      navigationControl={navigationControl}
      toolbarContextControl={toolbarContextControl}
      onGoBack={onGoBack}
      onGoForward={onGoForward}
      onActivateTab={onActivateTab}
      onCloseTab={closeLock.onCloseTab}
      onClearTabCloseLock={closeLock.onClearCloseLock}
      onOpenNewTab={onOpenNewTab}
    />
  );
};
