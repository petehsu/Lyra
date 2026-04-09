import type { SearchIntentAwareQueryVariant, SearchIntentKind, SearchQueryUnderstanding } from "./types";

export const NAVIGATION_MARKERS = [
  "官网",
  "official",
  "official site",
  "official website",
  "site",
  "website",
  "homepage",
  "home page",
  "主页",
  "首页"
] as const;

export const LOGIN_MARKERS = [
  "login",
  "log in",
  "signin",
  "sign in",
  "account",
  "dashboard",
  "portal",
  "登录",
  "登陆"
] as const;

export const DOCS_MARKERS = [
  "docs",
  "documentation",
  "developer",
  "developers",
  "api",
  "sdk",
  "文档",
  "开发者",
  "接口"
] as const;

export const DOWNLOAD_MARKERS = [
  "download",
  "install",
  "installer",
  "app",
  "apk",
  "client",
  "下载",
  "安装",
  "客户端"
] as const;

const TRANSACTION_MARKERS = [
  "buy",
  "price",
  "pricing",
  "purchase",
  "order",
  "shop",
  "购买",
  "价格",
  "多少钱",
  "订阅",
  "预订"
] as const;

const LOCAL_MARKERS = [
  "near me",
  "nearby",
  "map",
  "maps",
  "address",
  "location",
  "phone",
  "附近",
  "地址",
  "电话",
  "地图"
] as const;

const FRESH_MARKERS = [
  "latest",
  "new",
  "news",
  "today",
  "release",
  "released",
  "更新",
  "最新",
  "新闻",
  "发布"
] as const;

const INFORMATION_MARKERS = [
  "how",
  "what",
  "why",
  "guide",
  "tutorial",
  "compare",
  "vs",
  "教程",
  "怎么",
  "是什么",
  "区别",
  "对比"
] as const;

const QUESTION_MARKERS = [
  "?",
  "？",
  "how",
  "what",
  "why",
  "who",
  "when",
  "where",
  "怎么",
  "为何",
  "什么",
  "谁",
  "哪里"
] as const;

const GENERIC_QUERY_MARKERS = [
  ...NAVIGATION_MARKERS,
  ...LOGIN_MARKERS,
  ...DOCS_MARKERS,
  ...DOWNLOAD_MARKERS,
  ...TRANSACTION_MARKERS,
  ...LOCAL_MARKERS,
  ...FRESH_MARKERS,
  ...INFORMATION_MARKERS
] as const;

export const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const containsPhrase = (text: string, phrases: readonly string[]): boolean =>
  phrases.some((phrase) => text.includes(phrase));

export const tokenizeQueryText = (value: string): readonly string[] =>
  (value.toLowerCase().match(/[a-z0-9\u4e00-\u9fff][a-z0-9._+\-\u4e00-\u9fff]{0,31}/g) ?? [])
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

export const containsCjkChars = (value: string): boolean => /[\u3400-\u9fff]/.test(value);

const looksLikeUrl = (value: string): boolean =>
  /^https?:\/\//i.test(value.trim()) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(value.trim());

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const normalizeForComparison = (value: string): string =>
  value
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripQueryMarkers = (query: string): string => {
  let output = query;
  [...GENERIC_QUERY_MARKERS]
    .sort((left, right) => right.length - left.length)
    .forEach((marker) => {
      output = output.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
    });
  return compactWhitespace(output);
};

const extractEntityCandidate = (query: string): string => {
  const trimmed = compactWhitespace(query);
  if (trimmed.length === 0) {
    return "";
  }
  if (looksLikeUrl(trimmed)) {
    try {
      const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      return compactWhitespace(parsed.hostname.replace(/^www\./i, "").split(".")[0] ?? "");
    } catch (_error) {
      return trimmed;
    }
  }
  const stripped = stripQueryMarkers(trimmed);
  return stripped.length > 0 ? stripped : trimmed;
};

const detectIntentScores = (normalizedQuery: string, tokenCount: number): Readonly<Record<SearchIntentKind, number>> => {
  const scores: Record<SearchIntentKind, number> = {
    navigational: 0.14,
    informational: 0.14,
    transactional: 0.1,
    local: 0.06,
    fresh: 0.06
  };

  if (containsPhrase(normalizedQuery, NAVIGATION_MARKERS)) {
    scores.navigational += 0.62;
  }
  if (containsPhrase(normalizedQuery, LOGIN_MARKERS)) {
    scores.navigational += 0.44;
    scores.transactional += 0.12;
  }
  if (containsPhrase(normalizedQuery, DOCS_MARKERS)) {
    scores.informational += 0.34;
    scores.navigational += 0.22;
  }
  if (containsPhrase(normalizedQuery, DOWNLOAD_MARKERS)) {
    scores.transactional += 0.56;
    scores.navigational += 0.18;
  }
  if (containsPhrase(normalizedQuery, TRANSACTION_MARKERS)) {
    scores.transactional += 0.5;
  }
  if (containsPhrase(normalizedQuery, LOCAL_MARKERS)) {
    scores.local += 0.7;
  }
  if (containsPhrase(normalizedQuery, FRESH_MARKERS)) {
    scores.fresh += 0.58;
  }
  if (containsPhrase(normalizedQuery, INFORMATION_MARKERS)) {
    scores.informational += 0.48;
  }
  if (containsPhrase(normalizedQuery, QUESTION_MARKERS)) {
    scores.informational += 0.24;
  }
  if (looksLikeUrl(normalizedQuery)) {
    scores.navigational += 0.86;
  }
  if (tokenCount <= 2 && containsPhrase(normalizedQuery, QUESTION_MARKERS) === false) {
    scores.navigational += 0.18;
  }
  return scores;
};

export const analyzeSearchQuery = (query: string): SearchQueryUnderstanding => {
  const normalizedQuery = normalizeForComparison(query);
  const tokens = tokenizeQueryText(normalizedQuery);
  const scores = detectIntentScores(normalizedQuery, tokens.length);
  const primaryIntent = (Object.entries(scores) as Array<[SearchIntentKind, number]>)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "informational";

  return {
    query,
    normalizedQuery,
    tokens,
    entityCandidate: extractEntityCandidate(query),
    primaryIntent,
    scores,
    officialHint: containsPhrase(normalizedQuery, NAVIGATION_MARKERS),
    docsHint: containsPhrase(normalizedQuery, DOCS_MARKERS),
    loginHint: containsPhrase(normalizedQuery, LOGIN_MARKERS),
    downloadHint: containsPhrase(normalizedQuery, DOWNLOAD_MARKERS),
    localHint: containsPhrase(normalizedQuery, LOCAL_MARKERS),
    freshHint: containsPhrase(normalizedQuery, FRESH_MARKERS),
    isQuestionLike: containsPhrase(normalizedQuery, QUESTION_MARKERS),
    containsCjk: containsCjkChars(query)
  };
};

export const buildIntentAwareQueryVariants = (
  query: string,
  existingKeys: ReadonlySet<string>,
  limit: number
): readonly SearchIntentAwareQueryVariant[] => {
  if (limit <= 0) {
    return [];
  }
  const understanding = analyzeSearchQuery(query);
  const entity = compactWhitespace(understanding.entityCandidate);
  if (entity.length === 0) {
    return [];
  }

  const variants: SearchIntentAwareQueryVariant[] = [];
  const pushVariant = (nextQuery: string, derivedToken: string): void => {
    const normalized = compactWhitespace(nextQuery);
    if (normalized.length === 0 || normalized.toLowerCase() === query.trim().toLowerCase()) {
      return;
    }
    if (existingKeys.has(normalized.toLowerCase())) {
      return;
    }
    if (variants.some((entry) => entry.query.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    variants.push({
      query: normalized,
      derivedToken,
      seedQuery: query
    });
  };

  if (
    understanding.primaryIntent === "navigational"
    || understanding.officialHint
    || understanding.docsHint
    || understanding.loginHint
    || understanding.downloadHint
  ) {
    pushVariant(
      understanding.containsCjk ? `${entity} 官网` : `${entity} official site`,
      understanding.containsCjk ? "官网" : "official"
    );
  }
  if (understanding.docsHint || understanding.primaryIntent === "informational") {
    pushVariant(
      understanding.containsCjk ? `${entity} 文档` : `${entity} docs`,
      understanding.containsCjk ? "文档" : "docs"
    );
  }
  if (understanding.loginHint) {
    pushVariant(
      understanding.containsCjk ? `${entity} 登录` : `${entity} login`,
      understanding.containsCjk ? "登录" : "login"
    );
  }
  if (understanding.downloadHint || understanding.primaryIntent === "transactional") {
    pushVariant(
      understanding.containsCjk ? `${entity} 下载` : `${entity} download`,
      understanding.containsCjk ? "下载" : "download"
    );
  }

  return variants.slice(0, limit);
};
