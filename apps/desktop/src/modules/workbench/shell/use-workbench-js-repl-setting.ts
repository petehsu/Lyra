import { useCallback, useEffect, useMemo, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

type LegacyLyraApi = {
  readonly request: (payload: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

const getLegacyLyraApi = (desktopApi: LyraDesktopApi | null): LegacyLyraApi | null => {
  if (desktopApi === null || typeof desktopApi !== "object") {
    return null;
  }
  const value = (desktopApi as unknown as { readonly lyra?: unknown }).lyra;
  if (value === null || typeof value !== "object") {
    return null;
  }
  const request = (value as { readonly request?: unknown }).request;
  return typeof request === "function"
    ? { request: request as LegacyLyraApi["request"] }
    : null;
};

const readConfigFromResponse = (response: unknown): Record<string, unknown> | undefined => {
  if (response === null || typeof response !== "object" || Array.isArray(response)) {
    return undefined;
  }
  const config = (response as { readonly config?: unknown }).config;
  return config !== null && typeof config === "object" && !Array.isArray(config)
    ? config as Record<string, unknown>
    : undefined;
};

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
  const [jsReplEnabled, setJsReplEnabled] = useState(true);
  const legacyLyraApi = useMemo(() => getLegacyLyraApi(desktopApi), [desktopApi]);

  useEffect(() => {
    if (legacyLyraApi === null) {
      return;
    }
    let disposed = false;
    void legacyLyraApi.request({ method: "config/read", params: {} })
      .then((response) => {
        if (!disposed) {
          setJsReplEnabled(readJsReplEnabledFromConfig(readConfigFromResponse(response)));
        }
      })
      .catch(() => {
        if (!disposed) {
          setJsReplEnabled(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [legacyLyraApi]);

  const updateJsReplSetting = useCallback((enabled: boolean): void => {
    setJsReplEnabled(enabled);
    void legacyLyraApi?.request({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "features.js_repl",
            value: enabled,
            mergeStrategy: "replace"
          }
        ],
        reloadUserConfig: true
      }
    });
  }, [legacyLyraApi]);

  return {
    jsReplEnabled,
    updateJsReplSetting
  };
};
