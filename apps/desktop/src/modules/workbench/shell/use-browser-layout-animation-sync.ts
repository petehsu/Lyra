import { useCallback, useEffect, useRef } from "react";

import type { BrowserLayoutSyncOptions } from "./browser-layout-sync";
import type { PanelLayoutModel } from "./use-panel-layout";

type UseBrowserLayoutAnimationSyncParams = {
  readonly panelLayoutModel: PanelLayoutModel;
  readonly scheduleBrowserLayoutSync: (
    options?: BrowserLayoutSyncOptions
  ) => void;
  readonly animationDurationMs: number;
  readonly animationSyncIntervalMs: number;
};

export const useBrowserLayoutAnimationSync = ({
  panelLayoutModel,
  scheduleBrowserLayoutSync,
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
    aiPanelSide: panelLayoutModel.aiPanelSide,
    cssVars: panelLayoutModel.cssVars,
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
