import { describe, expect, test } from "vitest";

import {
  parseLinuxDisplayBackendOverride,
  resolveLinuxDisplayBackendPolicy
} from "../display-backend-policy";

const baseInput = {
  sessionType: "wayland" as const,
  desktop: "unknown",
  inputMethod: "none" as const,
  hasWaylandDisplay: true,
  hasX11Display: true,
  recoveryActive: false,
  override: null
};

describe("linux display backend policy", () => {
  test("wayland + hyprland + fcitx5 routes to xwayland compatibility", () => {
    const result = resolveLinuxDisplayBackendPolicy({
      ...baseInput,
      desktop: "hyprland",
      inputMethod: "fcitx5"
    });
    expect(result).toEqual({
      backend: "x11",
      reason: "wayland-ime-candidate-position-compat"
    });
  });

  test("wayland + hyprland without an input method stays native wayland", () => {
    const result = resolveLinuxDisplayBackendPolicy({
      ...baseInput,
      desktop: "hyprland",
      inputMethod: "none"
    });
    expect(result).toEqual({ backend: "wayland", reason: "wayland-default" });
  });

  test("x11 sessions keep the native x11 path without wayland handling", () => {
    const result = resolveLinuxDisplayBackendPolicy({
      ...baseInput,
      sessionType: "x11",
      hasWaylandDisplay: false,
      desktop: "hyprland",
      inputMethod: "fcitx5"
    });
    expect(result).toEqual({ backend: "x11", reason: "x11-session-native" });
  });

  test("wayland + unknown compositor + fcitx5 takes the conservative xwayland path", () => {
    const result = resolveLinuxDisplayBackendPolicy({
      ...baseInput,
      desktop: "unknown",
      inputMethod: "fcitx5"
    });
    expect(result).toEqual({
      backend: "x11",
      reason: "wayland-ime-candidate-position-compat"
    });
  });

  test("wayland + gnome or kde + fcitx5 keeps the native text-input path", () => {
    for (const desktop of ["gnome", "kde"]) {
      expect(
        resolveLinuxDisplayBackendPolicy({ ...baseInput, desktop, inputMethod: "fcitx5" })
      ).toEqual({ backend: "wayland", reason: "wayland-default" });
    }
  });

  test("recovery falls back to x11 before the ime rule", () => {
    const result = resolveLinuxDisplayBackendPolicy({
      ...baseInput,
      desktop: "hyprland",
      inputMethod: "fcitx5",
      recoveryActive: true
    });
    expect(result).toEqual({ backend: "x11", reason: "recovery-fallback" });
  });

  test("user overrides beat every automatic rule", () => {
    expect(
      resolveLinuxDisplayBackendPolicy({
        ...baseInput,
        desktop: "hyprland",
        inputMethod: "fcitx5",
        override: "wayland"
      })
    ).toEqual({ backend: "wayland", reason: "user-override" });
    expect(
      resolveLinuxDisplayBackendPolicy({
        ...baseInput,
        desktop: "gnome",
        inputMethod: "none",
        override: "xwayland"
      })
    ).toEqual({ backend: "x11", reason: "user-override" });
  });

  test("wlroots-family compositors share the conservative rule", () => {
    for (const desktop of ["sway", "niri", "cosmic"]) {
      expect(
        resolveLinuxDisplayBackendPolicy({ ...baseInput, desktop, inputMethod: "fcitx5" }).reason
      ).toBe("wayland-ime-candidate-position-compat");
    }
  });

  test("override parsing accepts only auto, wayland, and xwayland", () => {
    expect(parseLinuxDisplayBackendOverride("auto")).toBe("auto");
    expect(parseLinuxDisplayBackendOverride("wayland")).toBe("wayland");
    expect(parseLinuxDisplayBackendOverride(" XWayland ")).toBe("xwayland");
    expect(parseLinuxDisplayBackendOverride("x11")).toBeNull();
    expect(parseLinuxDisplayBackendOverride("")).toBeNull();
    expect(parseLinuxDisplayBackendOverride(undefined)).toBeNull();
    expect(parseLinuxDisplayBackendOverride(42)).toBeNull();
  });
});
