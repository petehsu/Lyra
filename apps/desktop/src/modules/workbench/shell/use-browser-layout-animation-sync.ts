import { useCallback, useEffect } from "react";

import type { BrowserLayoutSyncOptions } from "./browser-layout-sync";
import type { PanelLayoutModel } from "./use-panel-layout";

type UseBrowserLayoutAnimationSyncParams = {
  readonly panelLayoutModel: PanelLayoutModel;
  readonly scheduleBrowserLayoutSync: (
    options?: BrowserLayoutSyncOptions
  ) => void;
  readonly stackedBrowserTabs: boolean;
  readonly activeTabId: string;
  readonly animationDurationMs: number;
  readonly animationSyncIntervalMs: number;
};

export const useBrowserLayoutAnimationSync = ({
  panelLayoutModel,
  scheduleBrowserLayoutSync,
  stackedBrowserTabs,
  activeTabId,
  animationDurationMs,
  animationSyncIntervalMs
}: UseBrowserLayoutAnimationSyncParams): (() => void) => {
  const beginBrowserLayoutAnimationSync = useCallback((): void => {
    scheduleBrowserLayoutSync({
      force: true,
      animatedLayoutDurationMs: animationDurationMs,
      animatedLayoutSyncIntervalMs: animationSyncIntervalMs
    });
  }, [
    animationDurationMs,
    animationSyncIntervalMs,
    scheduleBrowserLayoutSync
  ]);

  useEffect(() => {
    beginBrowserLayoutAnimationSync();
  }, [
    activeTabId,
    beginBrowserLayoutAnimationSync,
    panelLayoutModel.aiPanelSide,
    panelLayoutModel.cssVars,
    panelLayoutModel.terminalPanelSide,
    scheduleBrowserLayoutSync,
    stackedBrowserTabs
  ]);

  return beginBrowserLayoutAnimationSync;
};
