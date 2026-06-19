import type { LyraRenderDocument, RenderDocumentRequest } from "../render";

const DEFAULT_CAPACITY = 512;

const sessionCache = new Map<string, LyraRenderDocument>();

const stableSerialize = (request: RenderDocumentRequest): string =>
  JSON.stringify({
    content: request.content,
    mode: request.mode ?? "document",
    theme: request.theme ?? "dark",
    enableMath: request.enableMath ?? true,
    enableMermaid: request.enableMermaid ?? true,
    highlightCode: request.highlightCode ?? true,
    locale: request.locale ?? null
  });

export const renderCacheKey = (request: RenderDocumentRequest): string =>
  stableSerialize(request);

export const getCachedDocument = (request: RenderDocumentRequest): LyraRenderDocument | null => {
  return sessionCache.get(renderCacheKey(request)) ?? null;
};

export const storeCachedDocument = (
  request: RenderDocumentRequest,
  document: LyraRenderDocument
): void => {
  const key = renderCacheKey(request);
  if (sessionCache.size >= DEFAULT_CAPACITY && !sessionCache.has(key)) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) {
      sessionCache.delete(oldest);
    }
  }
  sessionCache.set(key, document);
};

export const aliasCachedDocument = (
  source: RenderDocumentRequest,
  target: RenderDocumentRequest
): LyraRenderDocument | null => {
  const document = getCachedDocument(source);
  if (document === null) {
    return null;
  }
  storeCachedDocument(target, document);
  return document;
};

export const invalidateSessionRenderCache = (): void => {
  sessionCache.clear();
};

export const resetSessionRenderCacheForTests = (): void => {
  sessionCache.clear();
};