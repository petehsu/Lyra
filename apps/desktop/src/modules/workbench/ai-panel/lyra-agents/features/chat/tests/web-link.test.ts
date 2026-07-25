import { afterEach, describe, expect, test } from "vitest";

import type { WorkspaceTab } from "../../../../../workspace-tabs/types";
import {
  recordBrowserHistoryVisit
} from "../../../../../browser-history/service";
import { resetWorkbenchStateStorageForTests } from "../../../../../state-storage";
import {
  knownFaviconUrlForUrl,
  parseComposerHttpUrl,
  websiteLinkLabel
} from "../web-link";

const browserTab = (
  displayAddress: string,
  faviconUrl: string | undefined
): WorkspaceTab => ({
  id: displayAddress,
  title: displayAddress,
  pageKind: "page",
  inputValue: displayAddress,
  displayAddress,
  faviconUrl,
  query: undefined
});

describe("web links", () => {
  afterEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("accepts one absolute HTTP(S) URL and preserves its query and hash", () => {
    expect(parseComposerHttpUrl(" http://example.com/path ")).toBe(
      "http://example.com/path"
    );
    expect(parseComposerHttpUrl("https://example.com/search?q=Lyra#result")).toBe(
      "https://example.com/search?q=Lyra#result"
    );
  });

  test("rejects mixed text and non-HTTP protocols", () => {
    expect(parseComposerHttpUrl("Visit https://example.com")).toBeNull();
    expect(parseComposerHttpUrl("https://one.example https://two.example")).toBeNull();
    expect(parseComposerHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseComposerHttpUrl("data:text/plain,hello")).toBeNull();
    expect(parseComposerHttpUrl("ftp://example.com/file")).toBeNull();
  });

  test("prefers an exact-address favicon before another tab on the same origin", () => {
    const tabs = [
      browserTab("https://example.com/other", "https://example.com/origin.ico"),
      browserTab("https://example.com/current", "https://example.com/exact.ico")
    ];

    expect(knownFaviconUrlForUrl("https://example.com/current", tabs)).toBe(
      "https://example.com/exact.ico"
    );
  });

  test("returns null when no tab has a matching favicon", () => {
    const tabs = [
      browserTab("https://example.com/page", undefined),
      browserTab("https://other.example/page", "https://other.example/favicon.ico")
    ];

    expect(knownFaviconUrlForUrl("https://example.com/another", tabs)).toBeNull();
  });

  test("reuses a favicon from browser history before making a network request", () => {
    recordBrowserHistoryVisit({
      url: "https://docs.example.com/visited",
      title: "Docs",
      faviconUrl: "lyra-file://preview?path=docs.ico"
    });

    expect(knownFaviconUrlForUrl("https://docs.example.com/new", [])).toBe(
      "lyra-file://preview?path=docs.ico"
    );
  });

  test("uses a concise hostname label", () => {
    expect(websiteLinkLabel("https://www.example.com:8443/path")).toBe(
      "example.com:8443"
    );
  });
});
