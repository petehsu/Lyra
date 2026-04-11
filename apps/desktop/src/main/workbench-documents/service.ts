import type {
  WorkbenchDocumentInspectRequest,
  WorkbenchDocumentInspectResult,
  WorkbenchDocumentReadRequest,
  WorkbenchDocumentReadResult,
  WorkbenchDocumentSearchRequest,
  WorkbenchDocumentSearchResult,
  WorkbenchEmbeddedDocumentCandidate
} from "../../shared/workbench-documents";
import type {
  DocsNativeBindings,
  NativeDocumentProbeRequest,
  NativeDocumentProbeResult,
  NativeDocumentReadRequest,
  NativeDocumentReadResult,
  NativeDocumentSearchRequest,
  NativeDocumentSearchResult
} from "../documents/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { WorkbenchDocumentsCache } from "./cache";
import { detectDocumentCandidates } from "./detector";
import { buildDocumentDiagnostics, createDocumentServiceError } from "./diagnostics";
import { readDocumentFallback, searchFallbackDocument } from "./fallback";
import { fetchDocumentBytes } from "./fetch";
import { resolveActiveDocumentCandidate } from "./resolver";
import type {
  CachedDocumentBytes,
  ResolvedDocumentTarget,
  WorkbenchDocumentsService
} from "./types";

const DEFAULT_MAX_CHARS = 28_000;
const DEFAULT_MAX_MATCHES = 20;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseDocsNativeError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^DOCS_ERROR::([^:]+)::([\s\S]+)$/);
  if (match === null) {
    return Object.assign(new Error(message), { code: "document_parse_failed" });
  }
  return Object.assign(new Error(match[2]), { code: match[1] });
};

const readActiveBrowserTabId = (browserBridge: WorkbenchBrowserIpcBridge): string => {
  const tabId = browserBridge.readActiveTabId();
  if (typeof tabId !== "string" || tabId.length === 0) {
    throw Object.assign(new Error("No active browser tab is available."), {
      code: "document_not_found"
    });
  }
  return tabId;
};

const buildCandidateCacheKey = (tabId: string): string => `candidates:${tabId}`;
const buildBytesCacheKey = (tabId: string, url: string): string => `bytes:${tabId}:${url}`;
const buildParsedCacheKey = (kind: string, tabId: string, candidateId: string, payload: string): string =>
  `parsed:${kind}:${tabId}:${candidateId}:${payload}`;

const normalizeReadScope = (value: WorkbenchDocumentReadRequest["scope"]): WorkbenchDocumentReadResult["scope"] => {
  if (value === "current_page" || value === "visible" || value === "page_range") {
    return value;
  }
  return "full";
};

const readJson = <T>(callback: () => string): T => JSON.parse(callback()) as T;

const invokeProbeNative = ({
  bindings,
  request
}: {
  readonly bindings: DocsNativeBindings;
  readonly request: NativeDocumentProbeRequest;
}): NativeDocumentProbeResult => {
  try {
    return readJson<NativeDocumentProbeResult>(() => bindings.probeDocumentJson(JSON.stringify(request)));
  } catch (error) {
    throw parseDocsNativeError(error);
  }
};

const invokeReadNative = ({
  bindings,
  request
}: {
  readonly bindings: DocsNativeBindings;
  readonly request: NativeDocumentReadRequest;
}): NativeDocumentReadResult => {
  try {
    return readJson<NativeDocumentReadResult>(() => bindings.readDocumentTextJson(JSON.stringify(request)));
  } catch (error) {
    throw parseDocsNativeError(error);
  }
};

const invokeSearchNative = ({
  bindings,
  request
}: {
  readonly bindings: DocsNativeBindings;
  readonly request: NativeDocumentSearchRequest;
}): NativeDocumentSearchResult => {
  try {
    return readJson<NativeDocumentSearchResult>(() => bindings.searchDocumentTextJson(JSON.stringify(request)));
  } catch (error) {
    throw parseDocsNativeError(error);
  }
};

const resolveTarget = async ({
  browserBridge,
  cache,
  tabId
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly cache: WorkbenchDocumentsCache;
  readonly tabId?: string;
}): Promise<ResolvedDocumentTarget> => {
  const resolvedTabId = tabId ?? readActiveBrowserTabId(browserBridge);
  const cacheKey = buildCandidateCacheKey(resolvedTabId);
  const cached = cache.candidates.read(cacheKey) as readonly WorkbenchEmbeddedDocumentCandidate[] | null;
  const candidates = cached ?? await detectDocumentCandidates({ browserBridge, tabId: resolvedTabId });
  if (cached === null) {
    cache.candidates.write(cacheKey, candidates);
  }
  const candidate = resolveActiveDocumentCandidate(candidates);
  if (candidate === null) {
    throw Object.assign(new Error("No active document was detected for this tab."), {
      code: "document_not_found"
    });
  }
  return {
    tabId: resolvedTabId,
    candidate
  };
};

export const createWorkbenchDocumentsService = ({
  browserBridge,
  docsNativeBindings
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly docsNativeBindings: DocsNativeBindings;
}): WorkbenchDocumentsService => {
  const cache = new WorkbenchDocumentsCache();

  return {
    dispose: () => {
      cache.clear();
    },
    detectActiveDocument: async (tabId?: string) => {
      try {
        const target = await resolveTarget({
          browserBridge,
          cache,
          ...(tabId === undefined ? {} : { tabId })
        });
        return target.candidate;
      } catch {
        return null;
      }
    },
    inspectDocument: async (request: WorkbenchDocumentInspectRequest): Promise<WorkbenchDocumentInspectResult> => {
      const target = await resolveTarget({
        browserBridge,
        cache,
        ...(request.tabId === undefined ? {} : { tabId: request.tabId })
      });

      if (target.candidate.formatHint !== "pdf" || target.candidate.documentUrl === undefined) {
        return {
          tabId: target.tabId,
          documentId: target.candidate.candidateId,
          format: target.candidate.formatHint,
          sourceKind: target.candidate.sourceKind,
          ...(target.candidate.titleHint === undefined ? {} : { title: target.candidate.titleHint }),
          ...(target.candidate.documentUrl === undefined ? {} : { sourceUrl: target.candidate.documentUrl }),
          ...(target.candidate.currentPageIndex === undefined
            ? {}
            : { currentPageIndex: target.candidate.currentPageIndex }),
          ...(target.candidate.visiblePageIndices === undefined
            ? {}
            : { visiblePageIndices: target.candidate.visiblePageIndices }),
          ...(target.candidate.pageCountHint === undefined ? {} : { pageCount: target.candidate.pageCountHint }),
          metadataSource:
            target.candidate.pageCountHint !== undefined
              ? "viewer:frame-dom"
              : "candidate-hint",
          fallbackUsed: true,
          fallbackReason: "document-metadata-candidate-fallback"
        };
      }

      const bytesCacheKey = buildBytesCacheKey(target.tabId, target.candidate.documentUrl);
      const cachedBytes = cache.bytes.read(bytesCacheKey) as CachedDocumentBytes | null;
      const bytes = cachedBytes ?? await fetchDocumentBytes({
        browserBridge,
        tabId: target.tabId,
        url: target.candidate.documentUrl,
        ...(target.candidate.frameUrl === undefined ? {} : { referrer: target.candidate.frameUrl })
      });
      if (cachedBytes === null) {
        cache.bytes.write(bytesCacheKey, bytes);
      }

      const nativeResult = invokeProbeNative({
        bindings: docsNativeBindings,
        request: {
          bytesBase64: bytes.body.toString("base64"),
          ...(bytes.mimeType === undefined ? {} : { mimeHint: bytes.mimeType }),
          urlHint: bytes.finalUrl
        }
      });

      return {
        tabId: target.tabId,
        documentId: target.candidate.candidateId,
        format: nativeResult.format,
        sourceKind: target.candidate.sourceKind,
        ...(target.candidate.titleHint === undefined ? {} : { title: target.candidate.titleHint }),
        sourceUrl: bytes.finalUrl,
        ...(bytes.mimeType === undefined ? {} : { mimeType: bytes.mimeType }),
        ...(nativeResult.pageCount === undefined
          ? target.candidate.pageCountHint === undefined
            ? {}
            : { pageCount: target.candidate.pageCountHint }
          : { pageCount: nativeResult.pageCount }),
        ...(target.candidate.currentPageIndex === undefined
          ? {}
          : { currentPageIndex: target.candidate.currentPageIndex }),
        ...(target.candidate.visiblePageIndices === undefined
          ? {}
          : { visiblePageIndices: target.candidate.visiblePageIndices }),
        textAvailable: nativeResult.textAvailable,
        encrypted: nativeResult.encrypted,
        metadataSource: "pdf:rust-probe",
        fallbackUsed: false
      };
    },
    readDocument: async (request: WorkbenchDocumentReadRequest): Promise<WorkbenchDocumentReadResult> => {
      const target = await resolveTarget({
        browserBridge,
        cache,
        ...(request.tabId === undefined ? {} : { tabId: request.tabId })
      });
      const scope = normalizeReadScope(request.scope);
      const maxChars = Math.max(1, Math.round(request.maxChars ?? DEFAULT_MAX_CHARS));
      const cursor = Math.max(0, Math.round(request.cursor ?? 0));

      const parsedCacheKey = buildParsedCacheKey(
        "read",
        target.tabId,
        target.candidate.candidateId,
        JSON.stringify({ scope, maxChars, cursor, pageStart: request.pageStart, pageEnd: request.pageEnd })
      );
      const cached = cache.parsed.read(parsedCacheKey) as WorkbenchDocumentReadResult | null;
      if (cached !== null) {
        return cached;
      }

      const buildFallback = async (reason: string): Promise<WorkbenchDocumentReadResult> => {
        const fallback = await readDocumentFallback({
          browserBridge,
          target,
          cursor,
          maxChars
        });
        if (fallback === null) {
          throw Object.assign(new Error("Document text is unavailable."), {
            code: "document_text_unavailable"
          });
        }
        const totalChars = cursor + fallback.text.length;
        return {
          tabId: target.tabId,
          documentId: target.candidate.candidateId,
          format: target.candidate.formatHint,
          sourceKind: target.candidate.sourceKind,
          ...(target.candidate.titleHint === undefined ? {} : { title: target.candidate.titleHint }),
          ...(target.candidate.documentUrl === undefined ? {} : { sourceUrl: target.candidate.documentUrl }),
          scope,
          ...(scope === "page_range" && typeof request.pageStart === "number"
            ? { pageRange: { start: request.pageStart, end: request.pageEnd ?? request.pageStart } }
            : {}),
          ...(fallback.pageCount === undefined ? {} : { pageCount: fallback.pageCount }),
          ...(fallback.currentPageIndex === undefined ? {} : { currentPageIndex: fallback.currentPageIndex }),
          ...(fallback.visiblePageIndices === undefined ? {} : { visiblePageIndices: fallback.visiblePageIndices }),
          text: fallback.text,
          startChar: cursor,
          endChar: cursor + fallback.text.length,
          totalChars,
          truncated: false,
          hasMore: false,
          extractionMethod: fallback.extractionMethod,
          fallbackUsed: true,
          fallbackReason: reason || fallback.fallbackReason
        };
      };

      try {
        if (target.candidate.formatHint !== "pdf" || target.candidate.documentUrl === undefined) {
          const result = await buildFallback("document-source-dom-fallback");
          cache.parsed.write(parsedCacheKey, result);
          return result;
        }

        const bytesCacheKey = buildBytesCacheKey(target.tabId, target.candidate.documentUrl);
        const cachedBytes = cache.bytes.read(bytesCacheKey) as { finalUrl: string; mimeType?: string; body: Buffer } | null;
        const bytes = cachedBytes ?? await fetchDocumentBytes({
          browserBridge,
          tabId: target.tabId,
          url: target.candidate.documentUrl,
          ...(target.candidate.frameUrl === undefined ? {} : { referrer: target.candidate.frameUrl })
        });
        if (cachedBytes === null) {
          cache.bytes.write(bytesCacheKey, bytes);
        }

        const nativeRequest: NativeDocumentReadRequest = {
          bytesBase64: bytes.body.toString("base64"),
          ...(bytes.mimeType === undefined ? {} : { mimeHint: bytes.mimeType }),
          urlHint: bytes.finalUrl,
          scope,
          ...(typeof request.pageStart === "number" ? { pageStart: request.pageStart } : {}),
          ...(typeof request.pageEnd === "number" ? { pageEnd: request.pageEnd } : {}),
          ...(target.candidate.visiblePageIndices === undefined
            ? {}
            : { visiblePages: target.candidate.visiblePageIndices }),
          ...(typeof target.candidate.currentPageIndex === "number"
            ? { currentPage: target.candidate.currentPageIndex }
            : {}),
          maxChars,
          cursor
        };
        const nativeResult = invokeReadNative({ bindings: docsNativeBindings, request: nativeRequest });
        const result: WorkbenchDocumentReadResult = {
          tabId: target.tabId,
          documentId: target.candidate.candidateId,
          format: nativeResult.format,
          sourceKind: target.candidate.sourceKind,
          ...(target.candidate.titleHint === undefined ? {} : { title: target.candidate.titleHint }),
          sourceUrl: bytes.finalUrl,
          ...(bytes.mimeType === undefined ? {} : { mimeType: bytes.mimeType }),
          ...(nativeResult.pageCount === undefined ? {} : { pageCount: nativeResult.pageCount }),
          ...(target.candidate.currentPageIndex === undefined
            ? {}
            : { currentPageIndex: target.candidate.currentPageIndex }),
          ...(target.candidate.visiblePageIndices === undefined
            ? {}
            : { visiblePageIndices: target.candidate.visiblePageIndices }),
          scope,
          ...(scope === "page_range" && typeof request.pageStart === "number"
            ? { pageRange: { start: request.pageStart, end: request.pageEnd ?? request.pageStart } }
            : {}),
          text: nativeResult.text,
          startChar: nativeResult.startChar,
          endChar: nativeResult.endChar,
          totalChars: nativeResult.totalChars,
          truncated: nativeResult.truncated,
          hasMore: nativeResult.hasMore,
          ...(typeof nativeResult.nextCursor === "number" ? { nextCursor: nativeResult.nextCursor } : {}),
          extractionMethod: "pdf:rust-parser",
          fallbackUsed: false,
          ...(nativeResult.emptyReason === undefined ? {} : { fallbackReason: nativeResult.emptyReason })
        };
        cache.parsed.write(parsedCacheKey, result);
        return result;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "document_unsupported_format" && target.candidate.documentUrl !== undefined) {
          let bytesForDiagnosis =
            cache.bytes.read(buildBytesCacheKey(target.tabId, target.candidate.documentUrl)) as
              | { finalUrl: string; mimeType?: string; body: Buffer }
              | null;
          if (bytesForDiagnosis === null) {
            try {
              bytesForDiagnosis = await fetchDocumentBytes({
                browserBridge,
                tabId: target.tabId,
                url: target.candidate.documentUrl,
                ...(target.candidate.frameUrl === undefined ? {} : { referrer: target.candidate.frameUrl })
              });
              cache.bytes.write(buildBytesCacheKey(target.tabId, target.candidate.documentUrl), bytesForDiagnosis);
            } catch {
              bytesForDiagnosis = null;
            }
          }
          throw createDocumentServiceError({
            code,
            message: error instanceof Error ? error.message : "document format is unsupported",
            details: buildDocumentDiagnostics({
              stage: "parse",
              target,
              ...(bytesForDiagnosis === null ? {} : { fetch: bytesForDiagnosis }),
              request: {
                scope,
                maxChars,
                cursor,
                ...(typeof request.pageStart === "number" ? { pageStart: request.pageStart } : {}),
                ...(typeof request.pageEnd === "number" ? { pageEnd: request.pageEnd } : {})
              },
              causeCode: code
            })
          });
        }
        const fallbackable = code === "document_parse_failed" || code === "document_unsupported_scheme" || code === "document_fetch_failed";
        if (!fallbackable) {
          throw error;
        }
        const result = await buildFallback(code);
        cache.parsed.write(parsedCacheKey, result);
        return result;
      }
    },
    searchDocument: async (request: WorkbenchDocumentSearchRequest): Promise<WorkbenchDocumentSearchResult> => {
      const target = await resolveTarget({
        browserBridge,
        cache,
        ...(request.tabId === undefined ? {} : { tabId: request.tabId })
      });
      const query = request.query.trim();
      if (query.length === 0) {
        throw new Error("query is required");
      }
      const maxMatches = Math.max(1, Math.round(request.maxMatches ?? DEFAULT_MAX_MATCHES));
      const parsedCacheKey = buildParsedCacheKey(
        "search",
        target.tabId,
        target.candidate.candidateId,
        JSON.stringify({ query, maxMatches })
      );
      const cached = cache.parsed.read(parsedCacheKey) as WorkbenchDocumentSearchResult | null;
      if (cached !== null) {
        return cached;
      }

      try {
        if (target.candidate.formatHint !== "pdf" || target.candidate.documentUrl === undefined) {
          const matches = await searchFallbackDocument({
            browserBridge,
            target,
            query,
            maxMatches
          });
          const result: WorkbenchDocumentSearchResult = {
            tabId: target.tabId,
            documentId: target.candidate.candidateId,
            format: target.candidate.formatHint,
            matches,
            truncated: matches.length >= maxMatches
          };
          cache.parsed.write(parsedCacheKey, result);
          return result;
        }

        const bytesCacheKey = buildBytesCacheKey(target.tabId, target.candidate.documentUrl);
        const cachedBytes = cache.bytes.read(bytesCacheKey) as { finalUrl: string; mimeType?: string; body: Buffer } | null;
        const bytes = cachedBytes ?? await fetchDocumentBytes({
          browserBridge,
          tabId: target.tabId,
          url: target.candidate.documentUrl,
          ...(target.candidate.frameUrl === undefined ? {} : { referrer: target.candidate.frameUrl })
        });
        if (cachedBytes === null) {
          cache.bytes.write(bytesCacheKey, bytes);
        }

        const nativeRequest: NativeDocumentSearchRequest = {
          bytesBase64: bytes.body.toString("base64"),
          ...(bytes.mimeType === undefined ? {} : { mimeHint: bytes.mimeType }),
          urlHint: bytes.finalUrl,
          query,
          maxMatches
        };
        const nativeResult = invokeSearchNative({ bindings: docsNativeBindings, request: nativeRequest });
        const result: WorkbenchDocumentSearchResult = {
          tabId: target.tabId,
          documentId: target.candidate.candidateId,
          format: nativeResult.format,
          matches: nativeResult.matches,
          truncated: nativeResult.truncated
        };
        cache.parsed.write(parsedCacheKey, result);
        return result;
      } catch {
        const matches = await searchFallbackDocument({
          browserBridge,
          target,
          query,
          maxMatches
        });
        const result: WorkbenchDocumentSearchResult = {
          tabId: target.tabId,
          documentId: target.candidate.candidateId,
          format: target.candidate.formatHint,
          matches,
          truncated: matches.length >= maxMatches
        };
        cache.parsed.write(parsedCacheKey, result);
        return result;
      }
    }
  };
};
