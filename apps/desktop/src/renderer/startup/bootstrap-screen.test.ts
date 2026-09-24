import { afterEach, describe, expect, test, vi } from "vitest";

import {
  LYRA_BOOTSTRAP_SCREEN_ID,
  dismissLyraBootstrapScreen,
  revealLyraBootstrapScreen
} from "./bootstrap-screen";

describe("lyra bootstrap screen", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.classList.remove("lyra-startup-ready");
    document.getElementById(LYRA_BOOTSTRAP_SCREEN_ID)?.remove();
    document.getElementById("lyra-bootstrap-logo")?.remove();
  });

  test("fades the background in after the logo, without a second screen", () => {
    vi.useFakeTimers();
    const screen = document.createElement("div");
    screen.id = LYRA_BOOTSTRAP_SCREEN_ID;
    document.body.append(screen);

    dismissLyraBootstrapScreen();
    expect(document.body.classList.contains("lyra-startup-ready")).toBe(true);
    expect(screen.hidden).toBe(false);

    vi.advanceTimersByTime(500);
    expect(screen.hidden).toBe(true);
    expect(screen.getAttribute("aria-busy")).toBe("false");

    revealLyraBootstrapScreen();
    expect(document.body.classList.contains("lyra-startup-ready")).toBe(false);
    expect(screen.hidden).toBe(false);
    expect(screen.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll(`#${LYRA_BOOTSTRAP_SCREEN_ID}`)).toHaveLength(1);
  });
});
