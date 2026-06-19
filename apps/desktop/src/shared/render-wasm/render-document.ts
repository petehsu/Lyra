import type {
  LyraRenderDocument,
  RenderDocumentMode,
  RenderDocumentRequest,
  RenderTheme
} from "../render";
import {
  aliasCachedDocument,
  getCachedDocument,
  storeCachedDocument
} from "./render-cache";
import { getRenderWasmBindings } from "./wasm-loader";

export type RenderDocumentOptions = {
  readonly content: string;
  readonly streaming?: boolean;
  readonly theme?: RenderTheme;
  readonly enableMath?: boolean;
  readonly enableMermaid?: boolean;
  readonly highlightCode?: boolean;
  readonly locale?: string;
};

type RenderDocumentImpl = (
  request: RenderDocumentRequest
) => Promise<LyraRenderDocument>;

let testImpl: RenderDocumentImpl | null = null;

export const setRenderDocumentImplForTests = (impl: RenderDocumentImpl | null): void => {
  testImpl = impl;
};

const resolveMode = (streaming: boolean): RenderDocumentMode =>
  streaming ? "fragment" : "document";

export const buildRenderDocumentRequest = (
  options: RenderDocumentOptions,
  mode: RenderDocumentMode
): RenderDocumentRequest => ({
  content: options.content,
  mode,
  ...(options.theme === undefined ? {} : { theme: options.theme }),
  ...(options.enableMath === undefined ? {} : { enableMath: options.enableMath }),
  ...(options.enableMermaid === undefined ? {} : { enableMermaid: options.enableMermaid }),
  ...(options.highlightCode === undefined ? {} : { highlightCode: options.highlightCode }),
  ...(options.locale === undefined ? {} : { locale: options.locale })
});

export const resolveCachedDocument = (
  options: RenderDocumentOptions
): LyraRenderDocument | null => {
  const streaming = options.streaming === true;
  if (streaming) {
    return getCachedDocument(
      buildRenderDocumentRequest(options, "fragment")
    );
  }

  const documentCached = getCachedDocument(
    buildRenderDocumentRequest(options, "document")
  );
  if (documentCached !== null) {
    return documentCached;
  }

  return getCachedDocument(buildRenderDocumentRequest(options, "fragment"));
};

export const renderDocument = async (
  options: RenderDocumentOptions
): Promise<LyraRenderDocument> => {
  const streaming = options.streaming === true;
  const mode = resolveMode(streaming);
  const request = buildRenderDocumentRequest(options, mode);

  const cached = getCachedDocument(request);
  if (cached !== null) {
    return cached;
  }

  if (!streaming) {
    const fragmentRequest = buildRenderDocumentRequest(options, "fragment");
    const fragmentCached = aliasCachedDocument(fragmentRequest, request);
    if (fragmentCached !== null) {
      return fragmentCached;
    }
  }

  if (testImpl !== null) {
    const document = await testImpl(request);
    storeCachedDocument(request, document);
    return document;
  }

  const document = await renderDocumentViaRuntime(request);
  storeCachedDocument(request, document);
  return document;
};

const renderDocumentViaWasm = async (
  request: RenderDocumentRequest
): Promise<LyraRenderDocument> => {
  const bindings = await getRenderWasmBindings();
  const payload = JSON.stringify({
    content: request.content,
    mode: request.mode,
    theme: request.theme,
    enableMath: request.enableMath,
    enableMermaid: request.enableMermaid,
    highlightCode: request.highlightCode,
    locale: request.locale
  });
  return JSON.parse(bindings.render_document_json(payload)) as LyraRenderDocument;
};

const renderDocumentViaNativeBridge = async (
  request: RenderDocumentRequest
): Promise<LyraRenderDocument | null> => {
  const renderApi = window.lyraDesktop?.render;
  if (renderApi === undefined) {
    return null;
  }
  return renderApi.renderDocument(request);
};

const renderDocumentViaRuntime = async (
  request: RenderDocumentRequest
): Promise<LyraRenderDocument> => {
  // Desktop Electron: native NAPI is already bundled and avoids WASM load issues
  // (dynamic import + file:// / CSP). WASM remains for environments without native.
  const nativeDocument = await renderDocumentViaNativeBridge(request);
  if (nativeDocument !== null) {
    return nativeDocument;
  }
  return renderDocumentViaWasm(request);
};