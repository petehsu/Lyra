import type { SearchAggregateEngine, SearchAggregateResult } from "../../shared/desktop-bridge";

import {
  clip,
  containsBotChallenge,
  decodeJsLiteral,
  extractTagContent,
  resolveDuckDuckGoRedirect,
  stableResultId,
  stripHtmlTags,
  toDisplayUrl,
  toResultMergeKey
} from "./parse";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_SNIPPET_LENGTH = 260;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 Lyra/0.1";

type ProviderResult = {
  readonly results: readonly SearchAggregateResult[];
  readonly latencyMs: number;
  readonly error?: string;
};

type ProviderFetcher = (
  query: string,
  limit: number,
  engine: SearchAggregateEngine
) => Promise<readonly SearchAggregateResult[]>;

const fetchText = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
};

const createResult = (
  engineId: string,
  rank: number,
  rawUrl: string,
  rawTitle: string,
  rawSnippet: string
): SearchAggregateResult | null => {
  const title = stripHtmlTags(rawTitle);
  const snippet = clip(stripHtmlTags(rawSnippet), MAX_SNIPPET_LENGTH);

  if (title.length === 0) {
    return null;
  }

  let url: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    url = parsed.toString();
  } catch (_error) {
    return null;
  }

  return {
    id: stableResultId(engineId, rank, url),
    title,
    url,
    displayUrl: toDisplayUrl(url),
    snippet,
    sourceEngineIds: [engineId]
  };
};

const fetchBingRss: ProviderFetcher = async (query, limit, engine) => {
  const engineId = engine.id;
  const url = `https://www.bing.com/search?format=rss&count=${Math.max(limit, 10)}&q=${encodeURIComponent(query)}`;
  const xml = await fetchText(url);

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const results: SearchAggregateResult[] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (results.length >= limit) {
      break;
    }

    const item = items[index]?.[1];
    if (item === undefined) {
      continue;
    }

    const link = extractTagContent(item, "link");
    const title = extractTagContent(item, "title");
    const description = extractTagContent(item, "description");

    const result = createResult(engineId, index + 1, link, title, description);
    if (result !== null) {
      results.push(result);
    }
  }

  return results;
};

const fetchDuckDuckGoHtml: ProviderFetcher = async (query, limit, engine) => {
  const engineId = engine.id;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);

  if (containsBotChallenge(html)) {
    throw new Error("duckduckgo challenge required");
  }

  const anchorMatches = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const results: SearchAggregateResult[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < anchorMatches.length; index += 1) {
    if (results.length >= limit) {
      break;
    }

    const match = anchorMatches[index];
    if (match === undefined) {
      continue;
    }

    const rawHref = match[1] ?? "";
    const resolvedUrl = resolveDuckDuckGoRedirect(rawHref);
    if (resolvedUrl === null || /duckduckgo\.com\/y\.js/i.test(resolvedUrl)) {
      continue;
    }

    const dedupeKey = toResultMergeKey(resolvedUrl);
    if (seen.has(dedupeKey)) {
      continue;
    }

    const title = match[2] ?? "";
    const segmentStart = match.index ?? 0;
    const segment = html.slice(segmentStart, segmentStart + 1800);
    const snippetMatch =
      segment.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ??
      segment.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    const snippet = snippetMatch?.[1] ?? "";
    const result = createResult(engineId, index + 1, resolvedUrl, title, snippet);
    if (result !== null) {
      seen.add(dedupeKey);
      results.push(result);
    }
  }

  return results;
};

const readBracketSegment = (source: string, openBracketIndex: number): string => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openBracketIndex; index < source.length; index += 1) {
    const char = source[index] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBracketIndex + 1, index);
      }
      continue;
    }
  }

  return "";
};

const decodeJsUrl = (raw: string): string =>
  raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

const fetchBraveHtml: ProviderFetcher = async (query, limit, engine) => {
  const engineId = engine.id;
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  const html = await fetchText(url);

  const webStart = html.indexOf('web:{type:"search"');
  if (webStart < 0) {
    throw new Error("brave web section not found");
  }

  const resultsAnchor = html.indexOf("results:[", webStart);
  if (resultsAnchor < 0) {
    throw new Error("brave results not found");
  }

  const listStart = resultsAnchor + "results:".length;
  const resultsSegment = readBracketSegment(html, listStart);
  if (resultsSegment.length === 0) {
    return [];
  }

  const matches = [
    ...resultsSegment.matchAll(/title:"((?:\\.|[^"\\])*)",url:"((?:\\.|[^"\\])*)",full_title:[^,]*,description:"((?:\\.|[^"\\])*)"/g)
  ];

  const results: SearchAggregateResult[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < matches.length; index += 1) {
    if (results.length >= limit) {
      break;
    }

    const match = matches[index];
    if (match === undefined) {
      continue;
    }

    const decodedUrl = decodeJsUrl(match[2] ?? "");
    const dedupeKey = toResultMergeKey(decodedUrl);
    if (seen.has(dedupeKey)) {
      continue;
    }

    const result = createResult(engineId, index + 1, decodedUrl, decodeJsLiteral(match[1] ?? ""), decodeJsLiteral(match[3] ?? ""));
    if (result !== null) {
      seen.add(dedupeKey);
      results.push(result);
    }
  }

  return results;
};

const normalizeSearxngEndpoint = (value: string): string =>
  value.replace(/\/+$/, "");

const fetchSearxng: ProviderFetcher = async (query, limit, engine) => {
  const endpoint =
    typeof engine.endpoint === "string" && engine.endpoint.trim().length > 0
      ? normalizeSearxngEndpoint(engine.endpoint.trim())
      : "";
  if (endpoint.length === 0) {
    throw new Error("searxng endpoint is missing");
  }
  const url =
    `${endpoint}/search?format=json&q=${encodeURIComponent(query)}`
    + `&language=zh-CN&safesearch=0`;
  const payload = await fetchJson<{
    readonly results?: readonly {
      readonly url?: string;
      readonly title?: string;
      readonly content?: string;
    }[];
  }>(url);
  const rawResults = payload.results ?? [];
  const seen = new Set<string>();
  const results: SearchAggregateResult[] = [];
  for (let index = 0; index < rawResults.length; index += 1) {
    if (results.length >= limit) {
      break;
    }
    const raw = rawResults[index];
    if (raw === undefined || typeof raw.url !== "string") {
      continue;
    }
    const dedupeKey = toResultMergeKey(raw.url);
    if (seen.has(dedupeKey)) {
      continue;
    }
    const result = createResult(
      engine.id,
      index + 1,
      raw.url,
      raw.title ?? raw.url,
      raw.content ?? ""
    );
    if (result !== null) {
      seen.add(dedupeKey);
      results.push(result);
    }
  }
  return results;
};

const PROVIDERS: Record<string, ProviderFetcher> = {
  bing: fetchBingRss,
  duckduckgo: fetchDuckDuckGoHtml,
  brave: fetchBraveHtml,
  searxng: fetchSearxng
};

export const fetchEngineResults = async (
  engine: SearchAggregateEngine,
  query: string,
  limit: number
): Promise<ProviderResult> => {
  const startedAt = Date.now();
  const provider = PROVIDERS[engine.id];

  if (provider === undefined) {
    return {
      results: [],
      latencyMs: Date.now() - startedAt,
      error: `unsupported engine: ${engine.id}`
    };
  }

  try {
    const results = await provider(query, limit, engine);
    return {
      results,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "search provider failed";
    return {
      results: [],
      latencyMs: Date.now() - startedAt,
      error: message
    };
  }
};
