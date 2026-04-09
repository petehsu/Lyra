import { describe, expect, test, vi } from "vitest";

import type {
  SearchAggregateEngine,
  SearchAggregateResult
} from "../../../shared/desktop-bridge";

vi.mock("../providers", () => ({
  fetchEngineResults: vi.fn()
}));

import { fetchEngineResults } from "../providers";
import { aggregateSearch } from "../service";

const createEngine = (id: string): SearchAggregateEngine => ({
  id,
  label: id,
  accentColor: "#fff"
});

const createResult = (
  id: string,
  url: string,
  sourceEngineIds: readonly string[],
  overrides?: Partial<SearchAggregateResult>
): SearchAggregateResult => ({
  id,
  title: id,
  url,
  displayUrl: url,
  snippet: id,
  sourceEngineIds,
  ...overrides
});

describe("search aggregate service", () => {
  test("returns empty response for blank query", async () => {
    const response = await aggregateSearch({
      query: "   ",
      limitPerEngine: 5,
      engines: [createEngine("bing")]
    });

    expect(response.query).toBe("");
    expect(response.engineBuckets).toEqual([]);
    expect(response.blendedResults).toEqual([]);
    expect(fetchEngineResults).not.toHaveBeenCalled();
  });

  test("clamps engine count and per-engine limit", async () => {
    const mockedFetchEngineResults = vi.mocked(fetchEngineResults);
    mockedFetchEngineResults.mockResolvedValue({
      results: [],
      latencyMs: 1
    });

    const engines = Array.from({ length: 20 }, (_, index) =>
      createEngine(`engine-${index + 1}`)
    );

    await aggregateSearch({
      query: "lyra",
      limitPerEngine: 999,
      engines
    });

    expect(mockedFetchEngineResults).toHaveBeenCalledTimes(8);
    expect(mockedFetchEngineResults).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "engine-1" }),
      "lyra",
      10
    );
  });

  test("blends duplicate urls across engines and prioritizes multi-source results", async () => {
    const mockedFetchEngineResults = vi.mocked(fetchEngineResults);
    mockedFetchEngineResults
      .mockResolvedValueOnce({
        latencyMs: 10,
        results: [
          createResult("bing-1", "https://example.com/a", ["bing"]),
          createResult("bing-2", "https://example.com/b", ["bing"])
        ]
      })
      .mockResolvedValueOnce({
        latencyMs: 12,
        results: [
          createResult("brave-1", "https://example.com/a", ["brave"]),
          createResult("brave-2", "https://example.com/c", ["brave"])
        ]
      });

    const response = await aggregateSearch({
      query: "lyra",
      limitPerEngine: 5,
      engines: [createEngine("bing"), createEngine("brave")]
    });

    expect(response.engineBuckets).toHaveLength(2);
    expect(response.blendedResults.map((item) => item.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c"
    ]);

    const merged = response.blendedResults[0];
    expect([...(merged?.sourceEngineIds ?? [])].sort()).toEqual(["bing", "brave"]);
  });

  test("keeps provider errors in engine buckets", async () => {
    const mockedFetchEngineResults = vi.mocked(fetchEngineResults);
    mockedFetchEngineResults.mockResolvedValueOnce({
      latencyMs: 22,
      results: [],
      error: "timeout"
    });

    const response = await aggregateSearch({
      query: "lyra",
      limitPerEngine: 5,
      engines: [createEngine("duckduckgo")]
    });

    expect(response.engineBuckets[0]?.error).toBe("timeout");
    expect(response.blendedResults).toEqual([]);
  });

  test("boosts likely official site for navigational queries", async () => {
    const mockedFetchEngineResults = vi.mocked(fetchEngineResults);
    mockedFetchEngineResults.mockResolvedValue({
      latencyMs: 9,
      results: [
        createResult("wiki", "https://en.wikipedia.org/wiki/OpenAI", ["bing"], {
          title: "OpenAI - Wikipedia",
          snippet: "Encyclopedia entry"
        }),
        createResult("official", "https://openai.com/", ["bing"], {
          title: "OpenAI",
          snippet: "Official site"
        })
      ]
    });

    const response = await aggregateSearch({
      query: "openai 官网",
      limitPerEngine: 5,
      engines: [createEngine("bing")]
    });

    expect(response.blendedResults[0]?.url).toBe("https://openai.com/");
    expect(response.blendedResults[0]?.isOfficialResult).toBe(true);
    expect(response.blendedResults[0]?.officialCategory).toBe("official_homepage");
  });

  test("boosts docs pages when query is documentation-oriented", async () => {
    const mockedFetchEngineResults = vi.mocked(fetchEngineResults);
    mockedFetchEngineResults.mockResolvedValue({
      latencyMs: 11,
      results: [
        createResult("home", "https://platform.openai.com/", ["bing"], {
          title: "OpenAI Platform",
          snippet: "Build with OpenAI"
        }),
        createResult("docs", "https://platform.openai.com/docs/overview", ["bing"], {
          title: "OpenAI Docs",
          snippet: "API reference and guides"
        })
      ]
    });

    const response = await aggregateSearch({
      query: "openai docs",
      limitPerEngine: 5,
      engines: [createEngine("bing")]
    });

    expect(response.blendedResults[0]?.url).toBe("https://platform.openai.com/docs/overview");
    expect(response.blendedResults[0]?.officialCategory).toBe("official_docs");
  });
});
