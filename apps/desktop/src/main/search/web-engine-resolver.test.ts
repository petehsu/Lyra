import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveWebSearchEngine } from "./web-engine-resolver";

afterEach(() => {
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
      "https://example.com/search?q=Lyra%20docs",
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
      "https://example.com/search?q=Lyra%20docs",
      expect.objectContaining({
        headers: expect.objectContaining({
          "accept-language": "en-US,en;q=0.9"
        })
      })
    );
  });
});
