import { describe, expect, test, vi } from "vitest";

import {
  createEmptySearchPayload,
  resolveManualWebSearchTargets,
  resolveNextSearchEngineSelection,
  resolveWebSearchTarget
} from "../service";

const engines = [
  {
    id: "google",
    label: "Google",
    accentColor: "#4285F4",
    searchUrlTemplate: "https://www.google.com/search?q={searchTerms}"
  },
  {
    id: "bing",
    label: "Bing",
    accentColor: "#008373",
    searchUrlTemplate: "https://www.bing.com/search?q={searchTerms}"
  }
] as const;

describe("web search resolver service", () => {
  test("returns null for blank queries", async () => {
    await expect(resolveWebSearchTarget({
      desktopApi: null,
      query: "  ",
      searchEngines: engines
    })).resolves.toBeNull();
  });

  test("uses the desktop resolver when available", async () => {
    const resolveWebSearchEngine = vi.fn(async () => ({
      engine: engines[1],
      searchUrl: "https://www.bing.com/search?q=lyra",
      fallbackUsed: false,
      latencyMs: 12
    }));

    const target = await resolveWebSearchTarget({
      desktopApi: {
        search: {
          resolveWebSearchEngine
        }
      } as never,
      query: "lyra",
      searchEngines: engines
    });

    expect(resolveWebSearchEngine).toHaveBeenCalledWith({
      query: "lyra",
      engines,
      locale: expect.any(String),
      timeoutMs: 1800
    });
    expect(target?.engine.id).toBe("bing");
    expect(target?.searchUrl).toBe("https://www.bing.com/search?q=lyra");
    expect(target?.fallbackUsed).toBe(false);
  });

  test("fixed mode opens the selected engine without calling the resolver", async () => {
    const resolveWebSearchEngine = vi.fn();
    const target = await resolveWebSearchTarget({
      desktopApi: {
        search: {
          resolveWebSearchEngine
        }
      } as never,
      query: "lyra",
      searchEngines: [engines[0]],
      mode: "fixed"
    });

    expect(resolveWebSearchEngine).not.toHaveBeenCalled();
    expect(target?.engine.id).toBe("google");
  });

  test("falls back to Bing without desktop API", async () => {
    const target = await resolveWebSearchTarget({
      desktopApi: null,
      query: "lyra docs",
      searchEngines: engines
    });

    expect(target?.engine.id).toBe("bing");
    expect(target?.searchUrl).toBe("https://www.bing.com/search?q=lyra%20docs");
    expect(target?.fallbackUsed).toBe(true);
  });
});

describe("manual web search selection", () => {
  test("builds only one target when stale preferences contain multiple engines", () => {
    const targets = resolveManualWebSearchTargets({
      query: "lyra docs",
      engineIds: ["bing", "google"],
      searchEngines: engines
    });

    expect(targets.map((target) => target.engine.id)).toEqual(["bing"]);
  });

  test("selecting auto clears manual engines", () => {
    expect(resolveNextSearchEngineSelection({
      currentMode: "manual",
      currentEngineIds: ["google", "bing"],
      clickedEngineId: "auto"
    })).toEqual({
      mode: "auto",
      engineIds: []
    });
  });

  test("selecting another engine replaces the previous selection", () => {
    expect(resolveNextSearchEngineSelection({
      currentMode: "manual",
      currentEngineIds: ["google"],
      clickedEngineId: "bing"
    })).toEqual({
      mode: "manual",
      engineIds: ["bing"]
    });
  });
});

describe("search payload helpers", () => {
  test("createEmptySearchPayload builds the empty shape", () => {
    const payload = createEmptySearchPayload({
      query: "lyra"
    });

    expect(payload.query).toBe("lyra");
    expect(payload.web.status).toBe("idle");
    expect(payload.web.payload.blendedResults).toEqual([]);
  });
});
