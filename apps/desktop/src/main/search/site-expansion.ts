import type {
  SearchDeepBudgetPreset,
  SearchDeepCrawlPolicy,
  SearchDeepEdge,
  SearchDeepNode,
  SearchDeepNodeStatus
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import { resolveOfficialCategoryForUrl } from "./intelligence/official-site-resolver";
import { toResultMergeKey } from "./parse";
import type {
  SearchQueryUnderstanding,
  SearchSiteExpansionTarget,
  SearchSiteSeed
} from "./query-understanding";

export type SearchSiteStreamStartRequest = {
  readonly query: string;
  readonly understanding: SearchQueryUnderstanding;
  readonly budgetPreset: SearchDeepBudgetPreset;
  readonly seeds: readonly SearchSiteSeed[];
  readonly targets: readonly SearchSiteExpansionTarget[];
  readonly enableProactiveDomainGuessing: boolean;
  readonly crawlPolicy: SearchDeepCrawlPolicy;
};

export type SearchSiteDomain = {
  readonly registrableDomain: string;
  readonly finalUrl: string;
  readonly verificationScore: number;
  readonly verifiedFrom: "result" | "guessed" | "redirect";
  readonly guessSources: readonly string[];
  readonly isOfficialResult?: boolean;
};

export type SearchSiteSubdomain = {
  readonly hostname: string;
  readonly registrableDomain: string;
  readonly finalUrl: string;
  readonly verificationScore: number;
  readonly discoveredBy: "result" | "guess" | "sitemap" | "html";
  readonly isOfficialResult?: boolean;
};

export type SearchSitePage = {
  readonly url: string;
  readonly title: string;
  readonly canonicalUrl?: string;
  readonly hostname: string;
  readonly registrableDomain: string;
  readonly snippet?: string;
  readonly contentPreview?: string;
  readonly fetchDepth: number;
  readonly discoveredBy: "search" | "sitemap" | "html" | "redirect";
  readonly parentHost: string;
  readonly sourceEngineIds?: readonly string[];
  readonly isOfficialResult?: boolean;
};

export type SearchSiteStats = {
  readonly domainCandidates: number;
  readonly verifiedDomains: number;
  readonly discoveredSubdomains: number;
  readonly visitedPages: number;
  readonly queuedPages: number;
  readonly droppedPages: number;
  readonly guessAttempts: number;
};

export type SearchSiteStreamSnapshot = {
  readonly query: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly stats: SearchSiteStats;
  readonly domains: readonly SearchSiteDomain[];
  readonly subdomains: readonly SearchSiteSubdomain[];
  readonly pages: readonly SearchSitePage[];
  readonly done: boolean;
  readonly error?: string;
};

export type SearchSiteStreamStartResponse = {
  readonly streamId: string;
  readonly snapshot: SearchSiteStreamSnapshot;
};

export type SearchSiteStreamReadResponse = {
  readonly streamId: string;
  readonly snapshot: SearchSiteStreamSnapshot;
  readonly done: boolean;
  readonly error?: string;
};

export type SearchSiteStreamCancelResponse = {
  readonly removed: boolean;
};

export type SearchSiteGraphPatch = {
  readonly nodes: readonly SearchDeepNode[];
  readonly edges: readonly SearchDeepEdge[];
  readonly stats: SearchSiteStats & {
    readonly status: "idle" | "loading" | "ready" | "error";
    readonly error?: string;
  };
};

const createDomainNode = (domain: SearchSiteDomain): SearchDeepNode => ({
  id: `domain:${domain.registrableDomain}`,
  kind: "site_domain",
  title: domain.registrableDomain,
  subtitle: domain.verifiedFrom,
  status: "ready",
  score: domain.verificationScore,
  sourceKinds: ["web"],
  metadata: {
    registrableDomain: domain.registrableDomain,
    finalUrl: domain.finalUrl,
    verificationScore: domain.verificationScore,
    verifiedFrom: domain.verifiedFrom,
    guessSources: domain.guessSources,
    ...(domain.isOfficialResult === true ? { isOfficialResult: true } : {}),
    ...(domain.isOfficialResult === true ? { officialCategory: "official_homepage" } : {})
  }
});

const createSubdomainNode = (subdomain: SearchSiteSubdomain): SearchDeepNode => ({
  id: `subdomain:${subdomain.hostname}`,
  kind: "site_subdomain",
  title: subdomain.hostname,
  subtitle: subdomain.discoveredBy,
  status: "ready",
  score: subdomain.verificationScore,
  sourceKinds: ["web"],
  metadata: {
    hostname: subdomain.hostname,
    registrableDomain: subdomain.registrableDomain,
    finalUrl: subdomain.finalUrl,
    verificationScore: subdomain.verificationScore,
    discoveredBy: subdomain.discoveredBy,
    ...(subdomain.isOfficialResult === true ? { isOfficialResult: true } : {}),
    ...(subdomain.isOfficialResult === true
      ? { officialCategory: resolveOfficialCategoryForUrl(subdomain.finalUrl) }
      : {})
  }
});

const createPageNode = (page: SearchSitePage): SearchDeepNode => ({
  id: `page:${toResultMergeKey(page.canonicalUrl ?? page.url)}`,
  kind: "web_page",
  title: page.title,
  subtitle: page.url,
  status: "ready",
  score: Math.max(20, 120 - page.fetchDepth * 10),
  sourceKinds: ["web"],
  metadata: {
    url: page.url,
    ...(page.canonicalUrl === undefined ? {} : { canonicalUrl: page.canonicalUrl }),
    hostname: page.hostname,
    registrableDomain: page.registrableDomain,
    ...(page.snippet === undefined ? {} : { snippet: page.snippet }),
    ...(page.contentPreview === undefined ? {} : { contentPreview: page.contentPreview }),
    fetchDepth: page.fetchDepth,
    discoveredBy: page.discoveredBy,
    ...(page.sourceEngineIds === undefined ? {} : { sourceEngineIds: page.sourceEngineIds }),
    ...(page.isOfficialResult === true ? { isOfficialResult: true } : {}),
    ...(page.isOfficialResult === true
      ? { officialCategory: resolveOfficialCategoryForUrl(page.canonicalUrl ?? page.url) }
      : {})
  }
});

const resolveParentNodeId = (page: SearchSitePage): string =>
  page.parentHost === page.registrableDomain
    ? `domain:${page.registrableDomain}`
    : `subdomain:${page.parentHost}`;

export const toDeepSearchGraphPatch = (
  parentQueryNodeId: string,
  snapshot: SearchSiteStreamSnapshot
): SearchSiteGraphPatch => {
  const nodes: SearchDeepNode[] = [];
  const edges: SearchDeepEdge[] = [];

  for (const domain of snapshot.domains) {
    nodes.push(createDomainNode(domain));
    edges.push({
      id: `discover:${parentQueryNodeId}:domain:${domain.registrableDomain}`,
      sourceId: parentQueryNodeId,
      targetId: `domain:${domain.registrableDomain}`,
      kind: "discovered_from",
      reasonCode: domain.verifiedFrom === "guessed" ? "domain_guess" : "domain_verify",
      metadata: {
        guessSources: domain.guessSources,
        registrableDomain: domain.registrableDomain,
        finalUrl: domain.finalUrl
      }
    });
  }

  for (const subdomain of snapshot.subdomains) {
    nodes.push(createSubdomainNode(subdomain));
    edges.push({
      id: `domain:${subdomain.registrableDomain}:subdomain:${subdomain.hostname}`,
      sourceId: `domain:${subdomain.registrableDomain}`,
      targetId: `subdomain:${subdomain.hostname}`,
      kind: "hosts_subdomain",
      reasonCode: subdomain.discoveredBy === "guess" ? "subdomain_guess" : subdomain.discoveredBy === "sitemap" ? "sitemap_discovery" : "html_link_discovery",
      metadata: {
        discoveredBy: subdomain.discoveredBy,
        registrableDomain: subdomain.registrableDomain,
        finalUrl: subdomain.finalUrl
      }
    });
  }

  for (const page of snapshot.pages) {
    const pageNode = createPageNode(page);
    nodes.push(pageNode);
    edges.push({
      id: `${resolveParentNodeId(page)}:${pageNode.id}`,
      sourceId: resolveParentNodeId(page),
      targetId: pageNode.id,
      kind: "contains_page",
      reasonCode:
        page.discoveredBy === "sitemap"
          ? "sitemap_discovery"
          : page.discoveredBy === "html"
            ? "html_link_discovery"
            : page.discoveredBy === "redirect"
              ? "redirect_canonical"
              : "web_match",
      metadata: {
        registrableDomain: page.registrableDomain,
        discoveredBy: page.discoveredBy,
        finalUrl: page.url,
        ...(page.sourceEngineIds === undefined ? {} : { sourceEngineIds: page.sourceEngineIds })
      }
    });
  }

  return {
    nodes,
    edges,
    stats: {
      ...snapshot.stats,
      status: snapshot.status,
      ...(snapshot.error === undefined ? {} : { error: snapshot.error })
    }
  };
};

export const createSiteExpansionEngine = (options: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
}) => {
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await options.runtimeClient.request<T>(method, {
      storageRoot: options.storageRoot,
      ...((payload ?? {}) as Record<string, unknown>)
    });

  return {
    start: async (request: SearchSiteStreamStartRequest): Promise<SearchSiteStreamStartResponse> =>
      await requestRuntime<SearchSiteStreamStartResponse>("search.site.stream.start", request),
    read: async (streamId: string): Promise<SearchSiteStreamReadResponse> =>
      await requestRuntime<SearchSiteStreamReadResponse>("search.site.stream.read", { streamId }),
    cancel: async (streamId: string): Promise<SearchSiteStreamCancelResponse> =>
      await requestRuntime<SearchSiteStreamCancelResponse>("search.site.stream.cancel", { streamId })
  };
};
