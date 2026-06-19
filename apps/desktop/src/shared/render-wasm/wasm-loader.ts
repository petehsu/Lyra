export type RenderWasmBindings = {
  readonly render_document_json: (input: string) => string;
  readonly highlight_spans_json: (input: string) => string;
  readonly invalidate_render_cache: () => void;
};

type WasmModule = RenderWasmBindings & {
  readonly default: (moduleOrPath?: WebAssembly.Module | string) => Promise<unknown>;
};

const WASM_GLUE_URL = "/wasm/lyra_render_wasm.js";
const WASM_BINARY_URL = "/wasm/lyra_render_wasm_bg.wasm";

let initPromise: Promise<RenderWasmBindings> | null = null;

const loadWasmGlueModule = async (): Promise<WasmModule> => {
  const glueUrl = new URL(WASM_GLUE_URL, window.location.href).href;
  return (await import(/* @vite-ignore */ glueUrl)) as WasmModule;
};

const loadWasmModule = async (): Promise<RenderWasmBindings> => {
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

export const resetRenderWasmBindingsForTests = (): void => {
  initPromise = null;
};