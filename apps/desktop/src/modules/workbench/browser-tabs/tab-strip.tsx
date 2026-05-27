import { useMemo } from "react";

import { CLASSIC_WORKBENCH_INTERACTION_POLICIES } from "../interaction-policy";
import { createBrowserTabStripRenderModel } from "./tab-strip-render-model";
import type { BrowserTabStripProps } from "./tab-strip-types";
import { BrowserTabStripView } from "./tab-strip-view";
import { useBrowserTabStripAnimationState } from "./use-browser-tab-strip-animation-state";
import { useBrowserTabStripCloseLock } from "./use-browser-tab-strip-close-lock";
import { useBrowserTabStripLayoutState } from "./use-browser-tab-strip-layout-state";
import { useBrowserTabStripRuntime } from "./use-browser-tab-strip-runtime";

export type { BrowserTabDropRequest, BrowserTabStripProps } from "./tab-strip-types";

export const BrowserTabStrip = ({
  tabs,
  splitGroupTabIds = [],
  activeTabId,
  goBackLabel,
  goForwardLabel,
  toggleTabStackLabel,
  stackedMode,
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
  onToggleStackedMode,
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
  const animationState = useBrowserTabStripAnimationState(tabs);
  const layoutState = useBrowserTabStripLayoutState(tabs.length, runtime.navRef);
  const closeLock = useBrowserTabStripCloseLock({
    tabCount: tabs.length,
    navRef: runtime.navRef,
    onCloseTab
  });
  const renderModel = useMemo(
    () => createBrowserTabStripRenderModel({
      tabs,
      activeTabId,
      splitGroupTabIds,
      stackedMode,
      closeTabLabel,
      isTabInSplit,
      isTerminalDropActive: runtime.state.isTerminalDropActive,
      dropIndicatorX: runtime.state.dropIndicatorX,
      isSplitDropActive: runtime.state.isSplitDropActive,
      splitDropTargetTabId: runtime.state.splitDropTargetTabId,
      workspaceDragTabId: runtime.state.workspaceDragTabId,
      rightDragPreview: runtime.state.rightDragPreview,
      density: layoutState.density,
      closeLockedTabWidth: closeLock.closeLockedTabWidth
    }),
    [
      activeTabId,
      closeTabLabel,
      closeLock.closeLockedTabWidth,
      layoutState.density,
      isTabInSplit,
      runtime.state.dropIndicatorX,
      runtime.state.isSplitDropActive,
      runtime.state.isTerminalDropActive,
      runtime.state.rightDragPreview,
      runtime.state.splitDropTargetTabId,
      runtime.state.workspaceDragTabId,
      splitGroupTabIds,
      stackedMode,
      tabs
    ]
  );

  return (
    <BrowserTabStripView
      renderModel={renderModel}
      runtime={runtime}
      newlyAddedTabIds={animationState.newlyAddedTabIds}
      goBackLabel={goBackLabel}
      goForwardLabel={goForwardLabel}
      toggleTabStackLabel={toggleTabStackLabel}
      stackedMode={stackedMode}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      openNewTabLabel={openNewTabLabel}
      navigationControl={navigationControl}
      toolbarContextControl={toolbarContextControl}
      onGoBack={onGoBack}
      onGoForward={onGoForward}
      onToggleStackedMode={onToggleStackedMode}
      onActivateTab={onActivateTab}
      onCloseTab={closeLock.onCloseTab}
      onClearTabCloseLock={closeLock.onClearCloseLock}
      onOpenNewTab={onOpenNewTab}
    />
  );
};
