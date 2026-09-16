import { describe, expect, test } from "vitest";

import { pickDesktopCaptureSource } from "./desktop-capture";

describe("pickDesktopCaptureSource", () => {
  test("focused-window ignores entire-screen sources and matches the Lyra title", () => {
    const picked = pickDesktopCaptureSource(
      [
        { id: "screen:0:0", name: "Entire Screen" },
        { id: "window:1:0", name: "Cursor" },
        { id: "window:2:0", name: "Lyra" }
      ],
      "focused-window",
      "Lyra"
    );
    expect(picked).toEqual({ id: "window:2:0", name: "Lyra" });
  });

  test("focused-window does not fall back to the screen thumbnail", () => {
    const picked = pickDesktopCaptureSource(
      [
        { id: "screen:0:0", name: "Entire Screen" },
        { id: "window:1:0", name: "Settings" }
      ],
      "focused-window",
      null
    );
    expect(picked).toEqual({ id: "window:1:0", name: "Settings" });
  });

  test("screen prefers the screen source", () => {
    const picked = pickDesktopCaptureSource(
      [
        { id: "window:1:0", name: "Lyra" },
        { id: "screen:0:0", name: "Entire Screen" }
      ],
      "screen",
      "Lyra"
    );
    expect(picked).toEqual({ id: "screen:0:0", name: "Entire Screen" });
  });
});
