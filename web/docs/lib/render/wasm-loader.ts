import type {
  HighlightRequest,
  HighlightSpan,
  LyraRenderDocument,
  RenderDocumentRequest,
  RenderWasmBindings
} from "./types";

type WasmModule = RenderWasmBindings & {
  readonly default: (moduleOrPath?: WebAssembly.Module | string) => Promise<unknown>;
};

const WASM_GLUE_URL = "/wasm/lyra_render_wasm.js";
const WASM_BINARY_URL = "/wasm/lyra_render_wasm_bg.wasm";

let initPromise: Promise<RenderWasmBindings> | null = null;

const loadWasmGlueModule = async (): Promise<WasmModule> => {
  const glueUrl = new URL(WASM_GLUE_URL, window.location.href).href;
  return (await import(/* webpackIgnore: true */ glueUrl)) as WasmModule;
};

const loadWasmModule = async (): Promise<RenderWasmBindings> => {
  if (typeof window === "undefined") {
    throw new Error("lyra-render-wasm is only available in the browser");
  }

  const module = await loadWasmGlueModule();

  await module.default(WASM_BINARY_URL);

  return {
    render_document_json: module.render_document_json,
    highlight_spans_json: module.highlight_spans_json,
    invalidate_render_cache: module.invalidate_render_cache
  };
};

export const getRenderWasmBindings = async (): Promise<RenderWasmBindings> => {
  if (initPromise === null) {
    initPromise = loadWasmModule();
  }
  return initPromise;
};

export const renderDocumentWasm = async (
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
  const json = bindings.render_document_json(payload);
  return JSON.parse(json) as LyraRenderDocument;
};

export const highlightSpansWasm = async (
  request: HighlightRequest
): Promise<readonly HighlightSpan[]> => {
  const bindings = await getRenderWasmBindings();
  const payload = JSON.stringify({
    language: request.language,
    source: request.source,
    theme: request.theme
  });
  const json = bindings.highlight_spans_json(payload);
  return JSON.parse(json) as readonly HighlightSpan[];
};

export const invalidateRenderCacheWasm = async (): Promise<void> => {
  const bindings = await getRenderWasmBindings();
  bindings.invalidate_render_cache();
};