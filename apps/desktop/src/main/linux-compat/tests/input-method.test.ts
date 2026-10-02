import { describe, expect, test } from "vitest";

import {
  detectLinuxInputMethod,
  resolveInputMethodX11Env
} from "../input-method";

describe("linux input method detection", () => {
  test("reads XMODIFIERS before anything else", () => {
    expect(
      detectLinuxInputMethod({
        env: { XMODIFIERS: "@im=fcitx", GTK_IM_MODULE: "ibus" },
        processNames: ["ibus-daemon"]
      })
    ).toBe("fcitx5");
  });

  test("falls back to GTK_IM_MODULE then QT_IM_MODULE", () => {
    expect(detectLinuxInputMethod({ env: { GTK_IM_MODULE: "fcitx" } })).toBe("fcitx5");
    expect(detectLinuxInputMethod({ env: { QT_IM_MODULE: "ibus" } })).toBe("ibus");
  });

  test("detects input methods from process names when env vars are absent", () => {
    expect(
      detectLinuxInputMethod({ env: {}, processNames: ["hyprland", "fcitx5", "dunst"] })
    ).toBe("fcitx5");
    expect(
      detectLinuxInputMethod({ env: {}, processNames: ["gnome-shell", "ibus-daemon"] })
    ).toBe("ibus");
  });

  test("returns none when no signal exists", () => {
    expect(detectLinuxInputMethod({ env: {}, processNames: ["hyprland", "kitty"] })).toBe("none");
    expect(detectLinuxInputMethod({ env: {} })).toBe("none");
  });
});

describe("resolveInputMethodX11Env", () => {
  test("supplements fcitx variables for xwayland compatibility", () => {
    expect(resolveInputMethodX11Env({ inputMethod: "fcitx5", env: {} })).toEqual({
      GTK_IM_MODULE: "fcitx",
      XMODIFIERS: "@im=fcitx"
    });
  });

  test("supplements ibus variables for xwayland compatibility", () => {
    expect(resolveInputMethodX11Env({ inputMethod: "ibus", env: {} })).toEqual({
      GTK_IM_MODULE: "ibus",
      XMODIFIERS: "@im=ibus"
    });
  });

  test("keeps explicit user values and never injects for native wayland", () => {
    expect(
      resolveInputMethodX11Env({
        inputMethod: "fcitx5",
        env: { GTK_IM_MODULE: "fcitx", XMODIFIERS: "@im=fcitx" }
      })
    ).toEqual({});
    expect(resolveInputMethodX11Env({ inputMethod: "none", env: {} })).toEqual({});
  });
});
