import { describe, expect, test } from "vitest";

import {
  createSearchIntelligenceEngine,
  searchIntelligenceEngine
} from "../query-understanding";

describe("search query understanding", () => {
  test("detects navigational official intent", () => {
    const understanding = searchIntelligenceEngine.understandQuery("OpenAI 官网");
    expect(understanding.primaryIntent).toBe("navigational");
    expect(understanding.officialHint).toBe(true);
    expect(understanding.entityCandidate.toLowerCase()).toContain("openai");
  });

  test("builds intent-aware query variants", () => {
    const engine = createSearchIntelligenceEngine();
    const variants = engine.buildDerivedQueryVariants("OpenAI api", new Set<string>(), 3);
    expect(variants.some((entry) => entry.query.toLowerCase().includes("docs"))).toBe(true);
  });

  test("scores official homepage above aggregator pages for navigational queries", () => {
    const understanding = searchIntelligenceEngine.understandQuery("openai 官网");
    expect(searchIntelligenceEngine.isOfficialResult({
      id: "official",
      title: "OpenAI",
      url: "https://openai.com/",
      displayUrl: "openai.com",
      snippet: "Official site",
      sourceEngineIds: ["bing"]
    }, understanding)).toBe(true);
    expect(searchIntelligenceEngine.isOfficialResult({
      id: "wiki",
      title: "OpenAI - Wikipedia",
      url: "https://en.wikipedia.org/wiki/OpenAI",
      displayUrl: "en.wikipedia.org/wiki/OpenAI",
      snippet: "Wikipedia entry",
      sourceEngineIds: ["bing"]
    }, understanding)).toBe(false);
    const officialScore = searchIntelligenceEngine.scoreAggregateResult({
      id: "official",
      title: "OpenAI",
      url: "https://openai.com/",
      displayUrl: "openai.com",
      snippet: "Official site",
      sourceEngineIds: ["bing"]
    }, understanding, 1);
    const wikiScore = searchIntelligenceEngine.scoreAggregateResult({
      id: "wiki",
      title: "OpenAI - Wikipedia",
      url: "https://en.wikipedia.org/wiki/OpenAI",
      displayUrl: "en.wikipedia.org/wiki/OpenAI",
      snippet: "Wikipedia entry",
      sourceEngineIds: ["bing"]
    }, understanding, 0);

    expect(officialScore).toBeGreaterThan(wikiScore);
  });

  test("classifies official result categories from result urls", () => {
    const understanding = searchIntelligenceEngine.understandQuery("openai docs");

    expect(searchIntelligenceEngine.getOfficialResultCategory({
      id: "home",
      title: "OpenAI",
      url: "https://openai.com/",
      displayUrl: "openai.com",
      snippet: "Official site",
      sourceEngineIds: ["bing"]
    }, understanding)).toBe("official_homepage");

    expect(searchIntelligenceEngine.getOfficialResultCategory({
      id: "docs",
      title: "OpenAI Docs",
      url: "https://platform.openai.com/docs/overview",
      displayUrl: "platform.openai.com/docs/overview",
      snippet: "API reference and guides",
      sourceEngineIds: ["bing"]
    }, understanding)).toBe("official_docs");

    expect(searchIntelligenceEngine.getOfficialResultCategory({
      id: "login",
      title: "OpenAI Login",
      url: "https://auth.openai.com/login",
      displayUrl: "auth.openai.com/login",
      snippet: "Sign in",
      sourceEngineIds: ["bing"]
    }, searchIntelligenceEngine.understandQuery("openai login"))).toBe("official_login");
  });
});
