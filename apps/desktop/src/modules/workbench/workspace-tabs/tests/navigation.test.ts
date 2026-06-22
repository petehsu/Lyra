import { describe, expect, test } from "vitest";

import { areNavigationAddressesEquivalent, looksLikeUrl, toSafeAddress } from "../navigation";

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

  test("treats transient navigation variants as equivalent", () => {
    expect(
      areNavigationAddressesEquivalent(
        "https://example.com/article",
        "https://example.com/article#googtrans(en|zh-CN)"
      )
    ).toBe(true);
    expect(
      areNavigationAddressesEquivalent(
        "https://www.dmit.io/clientarea.php?__cf_chl_rt_tk=first-token",
        "https://www.dmit.io/clientarea.php?__cf_chl_rt_tk=second-token"
      )
    ).toBe(true);
  });
});
