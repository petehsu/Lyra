import { useCallback, useEffect, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

type LyraConfigReadResponse = {
  readonly config?: Record<string, unknown>;
};

const createLyraRequestPayload = (
  method: string,
  params: Record<string, unknown> = {}
): Record<string, unknown> => ({
  method,
  params
});

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

  const syncJsReplSetting = useCallback(async () => {
    const lyraApi = desktopApi?.lyra ?? null;
    if (lyraApi === null) {
      setJsReplEnabled(true);
      return;
    }
    try {
      const response = await lyraApi.request<LyraConfigReadResponse>(
        createLyraRequestPayload("config/read")
      );
      setJsReplEnabled(readJsReplEnabledFromConfig(response.config));
    } catch (error) {
      console.warn(`[lyra-settings] failed to read js_repl setting ${String(error)}`);
    }
  }, [desktopApi]);

  const updateJsReplSetting = useCallback((enabled: boolean): void => {
    setJsReplEnabled(enabled);
    const lyraApi = desktopApi?.lyra ?? null;
    if (lyraApi === null) {
      return;
    }
    void lyraApi.request(createLyraRequestPayload("config/batchWrite", {
      edits: [
        {
          keyPath: "features.js_repl",
          value: enabled,
          mergeStrategy: "replace"
        }
      ],
      reloadUserConfig: true
    })).catch((error: unknown) => {
      console.warn(`[lyra-settings] failed to write js_repl setting ${String(error)}`);
      void syncJsReplSetting();
    });
  }, [desktopApi, syncJsReplSetting]);

  useEffect(() => {
    void syncJsReplSetting();
  }, [syncJsReplSetting]);

  return {
    jsReplEnabled,
    updateJsReplSetting
  };
};
