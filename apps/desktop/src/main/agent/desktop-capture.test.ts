import { describe, expect, test } from "vitest";

import {
  filePathFromPortalUri,
  interpretPortalScreenshot,
  pickDesktopCaptureSource
} from "./desktop-capture";

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

describe("interpretPortalScreenshot", () => {
  test("reads a file uri from a successful portal response", () => {
    expect(interpretPortalScreenshot({
      response: 0,
      results: { uri: "file:///tmp/out.png" }
    })).toEqual({ uri: "file:///tmp/out.png" });
    expect(filePathFromPortalUri("file:///tmp/out.png")).toBe("/tmp/out.png");
  });

  test("reports cancel, refusal, and timeout from the portal", () => {
    expect(interpretPortalScreenshot({ response: 1 })).toEqual({
      message: "The screenshot was cancelled."
    });
    expect(interpretPortalScreenshot({ response: 2 })).toEqual({
      message: "The screenshot portal refused the capture (2)."
    });
    expect(interpretPortalScreenshot({ response: "timeout" })).toEqual({
      message: "The screenshot portal did not answer."
    });
    const unavailable = interpretPortalScreenshot({
      error: "Screenshot portal client is unavailable: No module named gi"
    });
    expect("message" in unavailable ? unavailable.message : "").toContain("unavailable");
  });
});
