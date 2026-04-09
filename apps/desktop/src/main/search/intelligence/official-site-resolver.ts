import type { SearchAggregateResult, SearchOfficialCategory } from "../../../shared/desktop-bridge";
import type { SearchQueryUnderstanding } from "./types";
import {
  NAVIGATION_MARKERS,
  clamp01,
  containsPhrase,
  normalizeForComparison,
  tokenizeQueryText
} from "./query-understanding";

const COMMON_NOISE_HOSTS = new Set([
  "wikipedia.org",
  "reddit.com",
  "youtube.com",
  "zhihu.com",
  "baike.baidu.com",
  "github.com",
  "amazon.com"
]);

const HOST_NOISE_LABELS = new Set([
  "www",
  "m",
  "mobile",
  "en",
  "zh",
  "cn",
  "docs",
  "developer",
  "developers",
  "help",
  "support",
  "blog",
  "login",
  "account",
  "app"
]);

export const getHostname = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
};

export const getPathname = (url: string): string => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch (_error) {
    return "/";
  }
};

const getNormalizedHostText = (hostname: string): string =>
  hostname
    .split(".")
    .filter((label) => label.length > 0 && HOST_NOISE_LABELS.has(label) === false)
    .join(" ");

const getEntityTokens = (understanding: SearchQueryUnderstanding): readonly string[] =>
  tokenizeQueryText(normalizeForComparison(understanding.entityCandidate));

export const calculateEntityMatch = (
  result: SearchAggregateResult,
  understanding: SearchQueryUnderstanding
): number => {
  const entityTokens = getEntityTokens(understanding);
  if (entityTokens.length === 0) {
    return 0;
  }
  const hostname = getHostname(result.url);
  const normalizedHost = getNormalizedHostText(hostname);
  const titleText = normalizeForComparison(result.title);
  const comparisonText = `${normalizedHost} ${titleText}`;
  const matchedTokens = entityTokens.filter((token) => comparisonText.includes(token));
  const coverage = matchedTokens.length / entityTokens.length;
  const compactEntity = entityTokens.join("");
  const compactHost = normalizedHost.replace(/\s+/g, "");
  if (compactEntity.length > 0 && compactHost.includes(compactEntity)) {
    return 1;
  }
  return clamp01(coverage);
};

export const isHomepageLike = (url: string): boolean => {
  const pathname = getPathname(url);
  return pathname === "/" || pathname === "" || pathname === "/index" || pathname === "/home";
};

export const pathContains = (url: string, markers: readonly string[]): boolean => {
  const pathname = getPathname(url);
  return markers.some((marker) => pathname.includes(marker));
};

const DOC_PATH_MARKERS = ["/docs", "/doc", "/api", "/developers", "/developer", "/sdk"] as const;
const LOGIN_PATH_MARKERS = ["/login", "/signin", "/sign-in", "/account", "/dashboard", "/auth"] as const;
const DOWNLOAD_PATH_MARKERS = ["/download", "/downloads", "/install", "/app", "/client"] as const;
const SUPPORT_PATH_MARKERS = ["/support", "/help", "/status", "/contact", "/community", "/forum"] as const;

const getRegistrableDomain = (hostname: string): string => {
  const labels = hostname.toLowerCase().split(".").filter((label) => label.length > 0);
  if (labels.length <= 2) {
    return hostname.toLowerCase();
  }
  return labels.slice(-2).join(".");
};

const getLeadingSubdomainLabel = (hostname: string): string | null => {
  const normalized = hostname.toLowerCase();
  const registrable = getRegistrableDomain(normalized);
  if (normalized === registrable) {
    return null;
  }
  const suffix = `.${registrable}`;
  if (normalized.endsWith(suffix) === false) {
    return null;
  }
  const left = normalized.slice(0, -suffix.length);
  const first = left.split(".").filter((part) => part.length > 0)[0];
  return first ?? null;
};

const titleContainsOfficialMarker = (result: SearchAggregateResult): boolean =>
  containsPhrase(normalizeForComparison(`${result.title} ${result.snippet}`), NAVIGATION_MARKERS);

export const isLikelyAggregatorHost = (url: string): boolean => {
  const hostname = getHostname(url);
  return COMMON_NOISE_HOSTS.has(hostname) || [...COMMON_NOISE_HOSTS].some((host) => hostname.endsWith(`.${host}`));
};

const isOfficialPropertyPath = (url: string): boolean =>
  pathContains(url, [
    "/docs",
    "/doc",
    "/api",
    "/developers",
    "/developer",
    "/sdk",
    "/login",
    "/signin",
    "/sign-in",
    "/account",
    "/dashboard",
    "/download",
    "/downloads",
    "/install",
    "/app",
    "/client"
  ]);

export const resolveOfficialCategoryForUrl = (url: string): SearchOfficialCategory => {
  const hostname = getHostname(url);
  const primarySubdomain = getLeadingSubdomainLabel(hostname);
  if (primarySubdomain !== null) {
    if (["docs", "developer", "developers", "api"].includes(primarySubdomain)) {
      return "official_docs";
    }
    if (["login", "account", "auth", "app"].includes(primarySubdomain)) {
      return "official_login";
    }
    if (["download", "downloads"].includes(primarySubdomain)) {
      return "official_download";
    }
    if (["support", "help", "status", "community", "forum"].includes(primarySubdomain)) {
      return "official_support";
    }
  }
  if (pathContains(url, DOC_PATH_MARKERS)) {
    return "official_docs";
  }
  if (pathContains(url, LOGIN_PATH_MARKERS)) {
    return "official_login";
  }
  if (pathContains(url, DOWNLOAD_PATH_MARKERS)) {
    return "official_download";
  }
  if (pathContains(url, SUPPORT_PATH_MARKERS)) {
    return "official_support";
  }
  if (primarySubdomain !== null || isHomepageLike(url) === false) {
    return "official_subsite";
  }
  return "official_homepage";
};

export const isOfficialResultForQuery = (
  result: SearchAggregateResult,
  understanding: SearchQueryUnderstanding
): boolean => {
  const entityMatch = calculateEntityMatch(result, understanding);
  if (isLikelyAggregatorHost(result.url)) {
    return false;
  }
  if (entityMatch >= 0.95) {
    return true;
  }
  if (entityMatch >= 0.7 && titleContainsOfficialMarker(result)) {
    return true;
  }
  return entityMatch >= 0.84 && isOfficialPropertyPath(result.url);
};

export const getOfficialResultCategoryForQuery = (
  result: SearchAggregateResult,
  understanding: SearchQueryUnderstanding
): SearchOfficialCategory | null =>
  isOfficialResultForQuery(result, understanding)
    ? resolveOfficialCategoryForUrl(result.url)
    : null;
