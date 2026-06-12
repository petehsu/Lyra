import { describe, expect, test, vi } from "vitest";

import {
  applyLyraWindowMaterial,
  resolveLyraWindowMaterial,
  type LyraWindowMaterialTarget
} from "./window-material";

describe("window material", () => {
  test("falls back to opaque when disabled by env", () => {
    expect(
      resolveLyraWindowMaterial({
        platform: "darwin",
        env: { LYRA_DISABLE_WINDOW_MATERIAL: "1" }
      })
    ).toEqual({
      mode: "opaque",
      platform: "darwin",
      options: {
        backgroundColor: "#f6f5f6"
      }
    });
  });

  test("resolves native material options for supported platforms", () => {
    expect(resolveLyraWindowMaterial({ platform: "darwin", env: {} }).options).toEqual({
      transparent: true,
      vibrancy: "under-window",
      visualEffectState: "active"
    });
    expect(resolveLyraWindowMaterial({ platform: "win32", env: {} }).options).toEqual({
      backgroundMaterial: "mica"
    });
    expect(
      resolveLyraWindowMaterial({
        platform: "linux",
        env: { LYRA_ENABLE_LINUX_WINDOW_MATERIAL: "1" }
      }).options
    ).toMatchObject({ transparent: true });
  });

  test("keeps Linux opaque unless experimental material is enabled", () => {
    expect(resolveLyraWindowMaterial({ platform: "linux", env: {} })).toEqual({
      mode: "opaque",
      platform: "linux",
      options: {
        backgroundColor: "#f6f5f6"
      }
    });
  });

  test("applies native material and returns the active mode", () => {
    const target: LyraWindowMaterialTarget = {
      setBackgroundMaterial: vi.fn(),
      setVibrancy: vi.fn()
    };

    const mode = applyLyraWindowMaterial(target, {
      mode: "native",
      platform: "win32",
      options: { backgroundMaterial: "mica" }
    });

    expect(mode).toBe("native");
    expect(target.setBackgroundMaterial).toHaveBeenCalledWith("mica");
  });

  test("downgrades to opaque when native material application fails", () => {
    const target: LyraWindowMaterialTarget = {
      setBackgroundMaterial: vi.fn(() => {
        throw new Error("unsupported");
      }),
      setBackgroundColor: vi.fn()
    };

    const mode = applyLyraWindowMaterial(target, {
      mode: "native",
      platform: "win32",
      options: { backgroundMaterial: "mica" }
    });

    expect(mode).toBe("opaque");
    expect(target.setBackgroundColor).toHaveBeenCalledWith("#f6f5f6");
  });
});
