import type {
  HighlightRequest,
  HighlightSpan,
  LyraRenderDocument,
  RenderDocumentRequest
} from "../../shared/render";

export type RenderNativeBindings = {
  readonly renderDocumentJson: (input: string) => string;
  readonly highlightSpansJson: (input: string) => string;
  readonly invalidateRenderCache: () => void;
};

export type RenderNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: RenderNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type RenderService = {
  readonly renderDocument: (request: RenderDocumentRequest) => LyraRenderDocument;
  readonly highlightSpans: (request: HighlightRequest) => readonly HighlightSpan[];
  readonly invalidateCache: () => void;
  readonly dispose: () => void;
};