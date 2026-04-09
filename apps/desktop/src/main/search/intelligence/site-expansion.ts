import type { SearchAggregateResult } from "../../../shared/desktop-bridge";
import type {
  SearchQueryUnderstanding,
  SearchSiteExpansionTarget,
  SearchSiteSeed,
  SearchSiteSeedExtraction
} from "./types";
import { calculateEntityMatch, getHostname, isHomepageLike } from "./official-site-resolver";
import { analyzeSearchQuery, compactWhitespace, normalizeForComparison } from "./query-understanding";

const COMMON_MULTI_LEVEL_SUFFIXES = [
  "com.cn",
  "com.hk",
  "com.tw",
  "co.jp",
  "co.kr",
  "co.uk",
  "com.au",
  "co.nz"
] as const;

const NON_CJK_TLDS = ["com", "ai", "io", "co", "dev", "app"] as const;
const CJK_TLDS = ["com", "cn", "com.cn", "ai"] as const;

const normalizeEntitySlug = (value: string): readonly string[] => {
  const normalized = compactWhitespace(normalizeForComparison(value));
  if (normalized.length === 0) {
    return [];
  }
  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const joined = tokens.join("");
  const hyphenated = tokens.join("-");
  return [...new Set([joined, hyphenated].filter((entry) => entry.length >= 2))];
};

export const toRegistrableDomain = (hostname: string): string => {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  const segments = normalized.split(".").filter((segment) => segment.length > 0);
  if (segments.length <= 2) {
    return normalized;
  }
  const lastTwo = segments.slice(-2).join(".");
  const lastThree = segments.slice(-3).join(".");
  if (COMMON_MULTI_LEVEL_SUFFIXES.includes(lastTwo as (typeof COMMON_MULTI_LEVEL_SUFFIXES)[number])) {
    return segments.slice(-3).join(".");
  }
  if (COMMON_MULTI_LEVEL_SUFFIXES.includes(lastThree as (typeof COMMON_MULTI_LEVEL_SUFFIXES)[number])) {
    return segments.slice(-4).join(".");
  }
  return segments.slice(-2).join(".");
};

const buildGuessedDomainSeeds = (understanding: SearchQueryUnderstanding): readonly SearchSiteSeed[] => {
  const slugs = normalizeEntitySlug(understanding.entityCandidate);
  if (slugs.length === 0) {
    return [];
  }
  const tlds = understanding.containsCjk ? CJK_TLDS : NON_CJK_TLDS;
  const guessed: SearchSiteSeed[] = [];
  for (const slug of slugs) {
    for (const tld of tlds) {
      const registrableDomain = `${slug}.${tld}`;
      guessed.push({
        registrableDomain,
        hostname: registrableDomain,
        url: `https://${registrableDomain}/`,
        title: understanding.entityCandidate,
        snippet: understanding.query,
        sourceEngineIds: [],
        isOfficialResult: true,
        guessSource: "guessed"
      });
    }
  }
  return guessed;
};

const scoreSeed = (seed: SearchSiteSeed, understanding: SearchQueryUnderstanding, index: number): number => {
  const syntheticResult: SearchAggregateResult = {
    id: seed.url,
    title: seed.title,
    url: seed.url,
    displayUrl: seed.hostname,
    snippet: seed.snippet,
    sourceEngineIds: seed.sourceEngineIds,
    ...(seed.isOfficialResult ? { isOfficialResult: true } : {})
  };
  const entityMatch = calculateEntityMatch(syntheticResult, understanding);
  let score = 20 + entityMatch * 55 + seed.sourceEngineIds.length * 10;
  if (seed.isOfficialResult) {
    score += 18;
  }
  if (seed.guessSource === "result") {
    score += Math.max(0, 12 - index * 2);
  }
  if (isHomepageLike(seed.url)) {
    score += 6;
  }
  return score;
};

export const extractSiteSeeds = (
  query: string,
  results: readonly SearchAggregateResult[]
): SearchSiteSeedExtraction => {
  const understanding = analyzeSearchQuery(query);
  const aggregated = new Map<string, SearchSiteSeed>();

  results.forEach((result) => {
    const hostname = getHostname(result.url);
    if (hostname.length === 0) {
      return;
    }
    const registrableDomain = toRegistrableDomain(hostname);
    const current = aggregated.get(`${result.url}:${registrableDomain}`);
    if (current !== undefined) {
      return;
    }
    aggregated.set(`${result.url}:${registrableDomain}`, {
      registrableDomain,
      hostname,
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      sourceEngineIds: result.sourceEngineIds,
      isOfficialResult: result.isOfficialResult === true,
      guessSource: "result"
    });
  });

  for (const guess of buildGuessedDomainSeeds(understanding)) {
    const key = `${guess.url}:${guess.registrableDomain}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, guess);
    }
  }

  const seeds = [...aggregated.values()];
  const grouped = new Map<string, SearchSiteSeed[]>();
  seeds.forEach((seed) => {
    const current = grouped.get(seed.registrableDomain);
    if (current === undefined) {
      grouped.set(seed.registrableDomain, [seed]);
    } else {
      current.push(seed);
    }
  });

  const targets = [...grouped.entries()]
    .map(([registrableDomain, domainSeeds]): SearchSiteExpansionTarget => {
      const score = domainSeeds.reduce((sum, seed, index) => sum + scoreSeed(seed, understanding, index), 0);
      const officialWeight = domainSeeds.reduce((sum, seed) => sum + (seed.isOfficialResult ? 1 : 0), 0);
      const guessSources = [...new Set(domainSeeds.map((seed) => seed.guessSource))];
      const candidateUrls = [...new Set(domainSeeds.map((seed) => seed.url))];
      const hostnames = [...new Set(domainSeeds.map((seed) => seed.hostname))];
      return {
        registrableDomain,
        candidateUrls,
        hostnames,
        score,
        officialWeight,
        guessSources,
        guessedOnly: domainSeeds.every((seed) => seed.guessSource === "guessed")
      };
    })
    .sort((left, right) => right.score - left.score || left.registrableDomain.localeCompare(right.registrableDomain, "zh-CN"));

  return {
    understanding,
    seeds,
    targets
  };
};

export const scoreDomainCandidate = (
  candidate: SearchSiteExpansionTarget,
  understanding: SearchQueryUnderstanding
): number => {
  let score = candidate.score + candidate.officialWeight * 18;
  const normalizedEntity = normalizeForComparison(understanding.entityCandidate).replace(/\s+/g, "");
  const normalizedDomain = candidate.registrableDomain.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  if (normalizedEntity.length > 0 && normalizedDomain.includes(normalizedEntity)) {
    score += 26;
  }
  if (understanding.officialHint || understanding.primaryIntent === "navigational") {
    score += 14;
  }
  if (candidate.guessedOnly) {
    score -= 8;
  }
  return score;
};

export const chooseExpansionTargets = (
  extraction: SearchSiteSeedExtraction,
  limit: number
): readonly SearchSiteExpansionTarget[] =>
  extraction.targets
    .map((candidate) => ({
      candidate,
      score: scoreDomainCandidate(candidate, extraction.understanding)
    }))
    .sort((left, right) => right.score - left.score || left.candidate.registrableDomain.localeCompare(right.candidate.registrableDomain, "zh-CN"))
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.candidate);
