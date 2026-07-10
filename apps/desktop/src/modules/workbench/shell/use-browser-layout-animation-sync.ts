import { useCallback, useEffect, useRef } from "react";

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
  const lastAnimatedLayoutKeyRef = useRef<string | null>(null);
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

  const animatedLayoutKey = JSON.stringify({
    activeTabId,
    aiPanelSide: panelLayoutModel.aiPanelSide,
    cssVars: panelLayoutModel.cssVars,
    stackedBrowserTabs,
    terminalPanelSide: panelLayoutModel.terminalPanelSide
  });

  useEffect(() => {
    if (lastAnimatedLayoutKeyRef.current === animatedLayoutKey) {
      return;
    }
    lastAnimatedLayoutKeyRef.current = animatedLayoutKey;
    beginBrowserLayoutAnimationSync();
  }, [animatedLayoutKey, beginBrowserLayoutAnimationSync]);

  return beginBrowserLayoutAnimationSync;
};
