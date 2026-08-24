import type {
  SearchResolveWebEngineRequest,
  SearchResolveWebEngineResponse,
  SearchWebEngineDefinition
} from "../../shared/desktop-bridge";

const DEFAULT_TIMEOUT_MS = 1800;
const MIN_TIMEOUT_MS = 300;
const MAX_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedEngine = {
  readonly engineId: string;
  readonly latencyMs: number;
  readonly measuredAt: number;
};

const cachedEngines = new Map<string, CachedEngine>();
const refreshes = new Map<string, Promise<void>>();

const clampTimeout = (value: number | undefined): number => {
  if (value === undefined || Number.isFinite(value) === false) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
};

const toAcceptLanguage = (locale: string): string => {
  let normalized = "en-US";
  try {
    normalized = Intl.getCanonicalLocales(locale.trim())[0] ?? normalized;
  } catch {
    // IPC input is untrusted at this boundary. A valid default keeps the
    // request usable without allowing malformed header values through.
  }
  const language = normalized.split("-")[0] ?? "en";
  const fallbacks = [`${language};q=0.9`];
  if (normalized.toLowerCase() !== "en-us" && language.toLowerCase() !== "en") {
    fallbacks.push("en-US;q=0.8", "en;q=0.7");
  } else if (normalized.toLowerCase() !== "en-us") {
    fallbacks.push("en-US;q=0.8");
  }
  return [normalized, ...fallbacks].join(",");
};

export const resolveSearchUrl = (
  engine: SearchWebEngineDefinition,
  query: string,
  template = engine.searchUrlTemplate
): string => {
  const encoded = encodeURIComponent(query);
  if (template.includes("{searchTerms}")) {
    return template.replaceAll("{searchTerms}", encoded);
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}q=${encoded}`;
};

const isUsableEngine = (
  engine: SearchWebEngineDefinition
): engine is SearchWebEngineDefinition => {
  if (engine.id.trim().length === 0 || engine.label.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(resolveSearchUrl(engine, "lyra"));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
};

const probeEngine = async (
  engine: SearchWebEngineDefinition,
  locale: string,
  signal: AbortSignal
): Promise<{ readonly engine: SearchWebEngineDefinition; readonly latencyMs: number }> => {
  const startedAt = Date.now();
  const searchUrl = resolveSearchUrl(engine, "lyra");
  const url = engine.probeUrlTemplate === undefined
    ? new URL(searchUrl).origin
    : resolveSearchUrl(engine, "lyra", engine.probeUrlTemplate);
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal,
    headers: {
      accept: "text/html,*/*;q=0.8",
      "accept-language": toAcceptLanguage(locale),
      "user-agent":
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 Lyra/0.1"
    }
  });

  if (response.ok === false) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    engine,
    latencyMs: Date.now() - startedAt
  };
};

const buildCacheKey = (
  engines: readonly SearchWebEngineDefinition[],
  locale: string
): string => `${locale}:${engines.map((engine) => engine.id).sort().join(",")}`;

const refreshEngineCache = (
  cacheKey: string,
  engines: readonly SearchWebEngineDefinition[],
  locale: string,
  timeoutMs: number
): void => {
  if (refreshes.has(cacheKey)) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const refresh = Promise.any(
    engines.map((engine) => probeEngine(engine, locale, controller.signal))
  )
    .then((winner) => {
      cachedEngines.set(cacheKey, {
        engineId: winner.engine.id,
        latencyMs: winner.latencyMs,
        measuredAt: Date.now()
      });
      controller.abort();
    })
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timeout);
      refreshes.delete(cacheKey);
    });
  refreshes.set(cacheKey, refresh);
};

export const resolveWebSearchEngine = async (
  request: SearchResolveWebEngineRequest
): Promise<SearchResolveWebEngineResponse> => {
  const query = request.query.trim();
  const engines = request.engines.filter(isUsableEngine);

  if (query.length === 0 || engines.length === 0) {
    throw new Error("query and at least one valid search engine are required");
  }

  const timeoutMs = clampTimeout(request.timeoutMs);
  const fallbackEngine = engines.find((engine) => engine.id === "bing") ?? engines[0]!;
  const cacheKey = buildCacheKey(engines, request.locale);
  const cached = cachedEngines.get(cacheKey);
  const cachedEngine = cached === undefined
    ? undefined
    : engines.find((engine) => engine.id === cached.engineId);
  const cacheIsFresh = cached !== undefined && Date.now() - cached.measuredAt < CACHE_TTL_MS;

  if (!cacheIsFresh) {
    refreshEngineCache(cacheKey, engines, request.locale, timeoutMs);
  }

  const engine = cachedEngine ?? fallbackEngine;
  return {
    engine,
    searchUrl: resolveSearchUrl(engine, query),
    fallbackUsed: cachedEngine === undefined,
    ...(cachedEngine === undefined || cached === undefined
      ? {}
      : { latencyMs: cached.latencyMs })
  };
};

export const resetWebSearchEngineCacheForTests = (): void => {
  cachedEngines.clear();
  refreshes.clear();
};
