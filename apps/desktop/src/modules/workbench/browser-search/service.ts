import type {
  LyraDesktopApi,
} from "../../../shared/desktop-bridge";
import { getWorkbenchLocale } from "../i18n";

import type {
  AggregatedSearchPayload,
  BrowserSearchPayload,
  SearchEngineDefinition,
  WebSearchEngineDefinition
} from "./types";

const toEmptyAggregatedPayload = (query: string): AggregatedSearchPayload => ({
  query,
  blendedResults: [],
  engineBuckets: [],
  fetchedAt: new Date().toISOString(),
  elapsedMs: 0
});

const DEFAULT_WEB_SEARCH_RESOLVE_TIMEOUT_MS = 1800;

export const resolveSearchUrl = (
  engine: WebSearchEngineDefinition,
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

const isWebSearchEngine = (
  engine: SearchEngineDefinition
): engine is WebSearchEngineDefinition =>
  typeof engine.searchUrlTemplate === "string" && engine.searchUrlTemplate.trim().length > 0;

export const resolveWebSearchTarget = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly query: string;
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly mode?: "dynamic" | "fixed";
  readonly timeoutMs?: number;
}): Promise<{
  readonly engine: WebSearchEngineDefinition;
  readonly searchUrl: string;
  readonly fallbackUsed: boolean;
  readonly latencyMs?: number;
} | null> => {
  const query = options.query.trim();
  const engines = options.searchEngines.filter(isWebSearchEngine);
  if (query.length === 0 || engines.length === 0) {
    return null;
  }

  if (options.mode === "fixed" || engines.length === 1 || options.desktopApi === null) {
    const engine = options.mode === "fixed"
      ? engines[0]!
      : engines.find((candidate) => candidate.id === "bing") ?? engines[0]!;
    return {
      engine,
      searchUrl: resolveSearchUrl(engine, query),
      fallbackUsed: true
    };
  }

  const response = await options.desktopApi.search.resolveWebSearchEngine({
    query,
    engines,
    locale: getWorkbenchLocale(),
    timeoutMs: options.timeoutMs ?? DEFAULT_WEB_SEARCH_RESOLVE_TIMEOUT_MS
  });
  return {
    engine: response.engine,
    searchUrl: response.searchUrl,
    fallbackUsed: response.fallbackUsed,
    ...(response.latencyMs === undefined ? {} : { latencyMs: response.latencyMs })
  };
};

export const resolveManualWebSearchTargets = (options: {
  readonly query: string;
  readonly engineIds: readonly string[];
  readonly searchEngines: readonly SearchEngineDefinition[];
}): readonly {
  readonly engine: WebSearchEngineDefinition;
  readonly searchUrl: string;
}[] => {
  const query = options.query.trim();
  if (query.length === 0) {
    return [];
  }
  const engineById = new Map(
    options.searchEngines.filter(isWebSearchEngine).map((engine) => [engine.id, engine])
  );
  return options.engineIds
    .slice(0, 1)
    .map((engineId) => engineById.get(engineId))
    .filter((engine): engine is WebSearchEngineDefinition => engine !== undefined)
    .map((engine) => ({
      engine,
      searchUrl: resolveSearchUrl(engine, query)
    }));
};

export const resolveNextSearchEngineSelection = (options: {
  readonly currentMode: "auto" | "manual";
  readonly currentEngineIds: readonly string[];
  readonly clickedEngineId: string | "auto";
}): {
  readonly mode: "auto" | "manual";
  readonly engineIds: readonly string[];
} => {
  if (options.clickedEngineId === "auto") {
    return {
      mode: "auto",
      engineIds: []
    };
  }

  if (
    options.currentMode === "manual" &&
    options.currentEngineIds[0] === options.clickedEngineId
  ) {
    return { mode: "auto", engineIds: [] };
  }

  return {
    mode: "manual",
    engineIds: [options.clickedEngineId]
  };
};

export const createEmptySearchPayload = (options: {
  readonly query: string;
}): BrowserSearchPayload => {
  const query = options.query.trim();
  return {
    query,
    queryRequestId: "init",
    lastUpdatedAt: new Date().toISOString(),
    web: {
      status: "idle",
      payload: toEmptyAggregatedPayload(query)
    }
  };
};
