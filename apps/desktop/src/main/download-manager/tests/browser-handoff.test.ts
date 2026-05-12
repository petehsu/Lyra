import { describe, expect, test, vi } from "vitest";

import {
  buildCookieHeaderValue,
  collectBrowserDownloadHeaders,
  shouldHandoffBrowserDownload
} from "../browser-handoff";

describe("shouldHandoffBrowserDownload", () => {
  test("accepts HTTP and HTTPS URLs so they can be re-routed to the accelerator", () => {
    expect(shouldHandoffBrowserDownload("https://example.com/file.zip")).toBe(true);
    expect(shouldHandoffBrowserDownload("http://files.example.com/a.bin")).toBe(true);
  });

  test("rejects browser-internal schemes that the native stack cannot replay", () => {
    expect(shouldHandoffBrowserDownload("blob:https://example.com/uuid")).toBe(false);
    expect(shouldHandoffBrowserDownload("data:text/plain,hello")).toBe(false);
    expect(shouldHandoffBrowserDownload("file:///tmp/a")).toBe(false);
  });

  test("rejects non-HTTP transports so aria2/curl routing stays exclusive", () => {
    expect(shouldHandoffBrowserDownload("ftp://example.com/file")).toBe(false);
    expect(shouldHandoffBrowserDownload("magnet:?xt=urn:btih:abc")).toBe(false);
  });

  test("rejects malformed URLs", () => {
    expect(shouldHandoffBrowserDownload("not a url")).toBe(false);
    expect(shouldHandoffBrowserDownload("")).toBe(false);
  });
});

describe("buildCookieHeaderValue", () => {
  test("joins named cookie entries with the standard header separator", () => {
    expect(buildCookieHeaderValue([
      { name: "session", value: "abc" },
      { name: "csrf", value: "xyz" }
    ])).toBe("session=abc; csrf=xyz");
  });

  test("skips entries without a name and strips newline injections from values", () => {
    expect(buildCookieHeaderValue([
      { name: "", value: "skipme" },
      { name: "session", value: "ab\r\nc" },
      { name: "missing" }
    ])).toBe("session=abc; missing=");
  });

  test("returns undefined when there are no usable cookies", () => {
    expect(buildCookieHeaderValue([])).toBeUndefined();
    expect(buildCookieHeaderValue([{ name: "" }])).toBeUndefined();
  });
});

describe("collectBrowserDownloadHeaders", () => {
  test("aggregates referrer, user agent, and session cookies", async () => {
    const cookiesGet = vi.fn().mockResolvedValue([
      { name: "session", value: "abc" },
      { name: "tracker", value: "1" }
    ]);
    const headers = await collectBrowserDownloadHeaders({
      session: { cookies: { get: cookiesGet } as never },
      url: "https://example.com/file.zip",
      referrerHint: "https://example.com/page",
      userAgentHint: "LyraDesktop/1.0"
    });
    expect(headers).toEqual({
      Referer: "https://example.com/page",
      "User-Agent": "LyraDesktop/1.0",
      Cookie: "session=abc; tracker=1"
    });
    expect(cookiesGet).toHaveBeenCalledWith({ url: "https://example.com/file.zip" });
  });

  test("omits optional header fields when no hint is provided", async () => {
    const headers = await collectBrowserDownloadHeaders({
      session: undefined,
      url: "https://example.com/file.zip"
    });
    expect(headers).toEqual({});
  });

  test("tolerates cookie store failures and still returns available hints", async () => {
    const cookiesGet = vi.fn().mockRejectedValue(new Error("cookie jar exploded"));
    const headers = await collectBrowserDownloadHeaders({
      session: { cookies: { get: cookiesGet } as never },
      url: "https://example.com/file.zip",
      referrerHint: "https://example.com/page"
    });
    expect(headers).toEqual({ Referer: "https://example.com/page" });
  });
});
