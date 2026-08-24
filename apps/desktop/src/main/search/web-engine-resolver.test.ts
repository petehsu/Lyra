import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  resetWebSearchEngineCacheForTests,
  resolveWebSearchEngine
} from "./web-engine-resolver";

beforeEach(() => {
  resetWebSearchEngineCacheForTests();
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  resetWebSearchEngineCacheForTests();
  vi.unstubAllGlobals();
});

describe("resolveWebSearchEngine", () => {
  test("probes engines with the user-selected Accept-Language", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveWebSearchEngine({
      query: "Lyra docs",
      locale: "en-US",
      engines: [{
        id: "example",
        label: "Example",
        accentColor: "#000000",
        searchUrlTemplate: "https://example.com/search?q={searchTerms}"
      }]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "accept-language": "en-US,en;q=0.9"
        })
      })
    );
  });

  test("normalizes malformed locale input before building request headers", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveWebSearchEngine({
      query: "Lyra docs",
      locale: "en-US\r\nX-Injected: value",
      engines: [{
        id: "example",
        label: "Example",
        accentColor: "#000000",
        searchUrlTemplate: "https://example.com/search?q={searchTerms}"
      }]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "accept-language": "en-US,en;q=0.9"
        })
      })
    );
  });

  test("returns Bing immediately and caches the fastest engine for the next search", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("bing.com")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const engines = [
      {
        id: "bing",
        label: "Bing",
        accentColor: "#008373",
        searchUrlTemplate: "https://www.bing.com/search?q={searchTerms}"
      },
      {
        id: "google",
        label: "Google",
        accentColor: "#4285F4",
        searchUrlTemplate: "https://www.google.com/search?q={searchTerms}"
      }
    ];

    const first = await resolveWebSearchEngine({
      query: "Lyra docs",
      locale: "en-US",
      engines
    });
    expect(first.engine.id).toBe("bing");
    expect(first.fallbackUsed).toBe(true);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await resolveWebSearchEngine({
      query: "Lyra browser",
      locale: "en-US",
      engines
    });
    expect(second.engine.id).toBe("google");
    expect(second.fallbackUsed).toBe(false);
  });
});
