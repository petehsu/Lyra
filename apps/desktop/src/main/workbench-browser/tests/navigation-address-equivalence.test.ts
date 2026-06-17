import { describe, expect, test } from "vitest";

import { areNavigationAddressesEquivalent } from "../view-manager-runtime/normalizers";

describe("navigation address equivalence", () => {
  test("treats googtrans hash variants as the same page", () => {
    expect(
      areNavigationAddressesEquivalent(
        "https://example.com/article",
        "https://example.com/article#googtrans(en|zh-CN)"
      )
    ).toBe(true);
  });

  test("treats Google Translate wrapper URLs as equivalent to embedded page", () => {
    expect(
      areNavigationAddressesEquivalent(
        "https://translate.google.com/translate?sl=auto&tl=zh-CN&u=https%3A%2F%2Fexample.com%2Farticle",
        "https://example.com/article"
      )
    ).toBe(true);
  });
});