import { afterEach, describe, expect, test } from "vitest";

import {
  LYRA_BOOTSTRAP_SCREEN_ID,
  dismissLyraBootstrapScreen,
  revealLyraBootstrapScreen
} from "./bootstrap-screen";

describe("lyra bootstrap screen", () => {
  afterEach(() => {
    document.getElementById(LYRA_BOOTSTRAP_SCREEN_ID)?.remove();
  });

  test("dismisses the first-paint overlay without creating a second screen", () => {
    const screen = document.createElement("div");
    screen.id = LYRA_BOOTSTRAP_SCREEN_ID;
    document.body.append(screen);

    dismissLyraBootstrapScreen();
    expect(screen.hidden).toBe(true);
    expect(screen.getAttribute("aria-busy")).toBe("false");
    revealLyraBootstrapScreen();
    expect(screen.hidden).toBe(false);
    expect(screen.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll(`#${LYRA_BOOTSTRAP_SCREEN_ID}`)).toHaveLength(1);
  });
});
