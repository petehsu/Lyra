import { useCallback, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export const readJsReplEnabledFromConfig = (
  config: Record<string, unknown> | undefined
): boolean => {
  const features = config?.features;
  if (features !== null && typeof features === "object" && !Array.isArray(features)) {
    const value = (features as Record<string, unknown>).js_repl;
    return typeof value === "boolean" ? value : true;
  }
  return true;
};

export const useWorkbenchJsReplSetting = (
  desktopApi: LyraDesktopApi | null
): {
  readonly jsReplEnabled: boolean;
  readonly updateJsReplSetting: (enabled: boolean) => void;
} => {
  void desktopApi;
  const [jsReplEnabled, setJsReplEnabled] = useState(true);

  const updateJsReplSetting = useCallback((enabled: boolean): void => {
    setJsReplEnabled(enabled);
  }, []);

  return {
    jsReplEnabled,
    updateJsReplSetting
  };
};
