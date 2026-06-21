import { describe, expect, test } from "vitest";

import { canonicalizeBrowserCitationUrls } from "../canonicalize-browser-url";

describe("canonicalizeBrowserCitationUrls", () => {
  test("prefers a valid frameUrl over a corrupted pageUrl", () => {
    const result = canonicalizeBrowserCitationUrls(
      "https://user.qzone.qq.com/http%20://user.qzone.qq.com/3434993851",
      "https://user.qzone.qq.com/3434993851"
    );
    expect(result).toEqual({
      pageUrl: "https://user.qzone.qq.com/3434993851",
      frameUrl: null
    });
  });

  test("collapses whitespace before parsing frame URLs", () => {
    const result = canonicalizeBrowserCitationUrls(
      "https://user.qzone.qq.com/bad-path",
      "http ://user.qzone.qq.com/3434993851"
    );
    expect(result?.pageUrl).toBe("http://user.qzone.qq.com/3434993851");
  });

  test("extracts an embedded http URL from a malformed pageUrl pathname", () => {
    const result = canonicalizeBrowserCitationUrls(
      "https://user.qzone.qq.com/http%3A%2F%2Fu.er.qzone.qq.com%2F3434993851",
      null
    );
    expect(result?.pageUrl).toBe("http://u.er.qzone.qq.com/3434993851");
  });

  test("returns null for non-http URLs", () => {
    expect(canonicalizeBrowserCitationUrls("not a url", null)).toBeNull();
  });
});