import type {
  LspCompletionRequest,
  LspCompletionResult,
  LspDocumentRequest
} from "../../shared/desktop-bridge";

export type LspNativeBindings = {
  readonly registerEventCallback: (callback: (...args: unknown[]) => void) => void;
  readonly openDocument: (request: LspDocumentRequest) => void;
  readonly changeDocument: (request: LspDocumentRequest) => void;
  readonly saveDocument: (request: LspDocumentRequest) => void;
  readonly closeDocument: (request: LspDocumentRequest) => void;
  readonly completion: (request: LspCompletionRequest) => LspCompletionResult;
  readonly shutdown: () => void;
};

export type LspNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: LspNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
