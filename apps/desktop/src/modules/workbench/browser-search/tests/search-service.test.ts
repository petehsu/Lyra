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
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    accentColor: "#DE5833",
    searchUrlTemplate: "https://duckduckgo.com/?q={searchTerms}"
  },
  {
    id: "brave",
    label: "Brave Search",
    accentColor: "#FB542B",
    searchUrlTemplate: "https://search.brave.com/search?q={searchTerms}&source=web"
  },
  {
    id: "qwant",
    label: "Qwant",
    accentColor: "#5C97FF",
    searchUrlTemplate: "https://www.qwant.com/?q={searchTerms}&t=web"
  },
  {
    id: "mojeek",
    label: "Mojeek",
    accentColor: "#7BB92F",
    searchUrlTemplate: "https://www.mojeek.com/search?q={searchTerms}"
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
      locale: "zh-CN",
      timeoutMs: 1800
    });
    expect(target?.engine.id).toBe("bing");
    expect(target?.searchUrl).toBe("https://www.bing.com/search?q=lyra");
    expect(target?.fallbackUsed).toBe(false);
  });

  test("falls back to the first local template without desktop API", async () => {
    const target = await resolveWebSearchTarget({
      desktopApi: null,
      query: "lyra docs",
      searchEngines: engines
    });

    expect(target?.engine.id).toBe("google");
    expect(target?.searchUrl).toBe("https://www.google.com/search?q=lyra%20docs");
    expect(target?.fallbackUsed).toBe(true);
  });
});

describe("manual web search selection", () => {
  test("builds one target per selected engine in order", () => {
    const targets = resolveManualWebSearchTargets({
      query: "lyra docs",
      engineIds: ["bing", "google"],
      searchEngines: engines
    });

    expect(targets.map((target) => target.engine.id)).toEqual(["bing", "google"]);
    expect(targets.map((target) => target.searchUrl)).toEqual([
      "https://www.bing.com/search?q=lyra%20docs",
      "https://www.google.com/search?q=lyra%20docs"
    ]);
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

  test("selecting a fifth engine replaces the previous selected engine", () => {
    expect(resolveNextSearchEngineSelection({
      currentMode: "manual",
      currentEngineIds: ["google", "bing", "duckduckgo", "brave"],
      clickedEngineId: "mojeek"
    })).toEqual({
      mode: "manual",
      engineIds: ["google", "bing", "duckduckgo", "mojeek"]
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
