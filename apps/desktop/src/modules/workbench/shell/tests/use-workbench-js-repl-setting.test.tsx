import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import {
  readJsReplEnabledFromConfig,
  useWorkbenchJsReplSetting
} from "../use-workbench-js-repl-setting";

describe("useWorkbenchJsReplSetting", () => {
  test("reads js_repl from Lyra config", async () => {
    const request = vi.fn().mockResolvedValue({
      config: {
        features: {
          js_repl: false
        }
      }
    });
    const desktopApi = { lyra: { request } } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useWorkbenchJsReplSetting(desktopApi));

    await waitFor(() => {
      expect(result.current.jsReplEnabled).toBe(false);
    });
    expect(request).toHaveBeenCalledWith({ method: "config/read", params: {} });
  });

  test("writes js_repl changes and keeps local state optimistic", async () => {
    const request = vi.fn().mockResolvedValue({ config: {} });
    const desktopApi = { lyra: { request } } as unknown as LyraDesktopApi;
    const { result } = renderHook(() => useWorkbenchJsReplSetting(desktopApi));

    act(() => {
      result.current.updateJsReplSetting(false);
    });

    expect(result.current.jsReplEnabled).toBe(false);
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        method: "config/batchWrite",
        params: {
          edits: [
            {
              keyPath: "features.js_repl",
              value: false,
              mergeStrategy: "replace"
            }
          ],
          reloadUserConfig: true
        }
      });
    });
  });
});

describe("readJsReplEnabledFromConfig", () => {
  test("defaults to enabled when the config field is absent", () => {
    expect(readJsReplEnabledFromConfig(undefined)).toBe(true);
    expect(readJsReplEnabledFromConfig({ features: {} })).toBe(true);
  });
});
