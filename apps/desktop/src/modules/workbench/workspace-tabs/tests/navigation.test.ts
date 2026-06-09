import { describe, expect, test } from "vitest";

import { looksLikeUrl, toSafeAddress } from "../navigation";

describe("workspace tab navigation", () => {
  test("preserves file urls instead of coercing them to https", () => {
    expect(looksLikeUrl("file:///Users/petehsu/Desktop/camera_photo.jpg")).toBe(true);
    expect(toSafeAddress("file:///Users/petehsu/Desktop/camera_photo.jpg")).toBe(
      "file:///Users/petehsu/Desktop/camera_photo.jpg"
    );
  });

  test("continues to normalize bare domains as https urls", () => {
    expect(toSafeAddress("example.com/docs")).toBe("https://example.com/docs");
  });
});
