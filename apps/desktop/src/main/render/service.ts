import type {
  HighlightRequest,
  HighlightSpan,
  LyraRenderDocument,
  RenderDocumentRequest
} from "../../shared/render";
import type { RenderNativeBindings, RenderService } from "./types";

const parseRenderError = (message: string): Error => {
  const match = /^RENDER_ERROR::([^:]+)::(.+)$/.exec(message);
  if (match === null) {
    return new Error(message);
  }
  return new Error(`${match[1]}: ${match[2]}`);
};

const readJson = <T>(read: () => string): T => {
  try {
    return JSON.parse(read()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw parseRenderError(message);
  }
};

export const createRenderService = (bindings: RenderNativeBindings): RenderService => {
  return {
    renderDocument: (request: RenderDocumentRequest): LyraRenderDocument => {
      return readJson(() => bindings.renderDocumentJson(JSON.stringify(request)));
    },
    highlightSpans: (request: HighlightRequest): readonly HighlightSpan[] => {
      return readJson(() => bindings.highlightSpansJson(JSON.stringify(request)));
    },
    invalidateCache: () => {
      bindings.invalidateRenderCache();
    },
    dispose: () => {}
  };
};