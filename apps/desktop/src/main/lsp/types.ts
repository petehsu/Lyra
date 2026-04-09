import type {
  LspCompletionRequest,
  LspCompletionResult,
  LspDocumentRequest
} from "../../shared/desktop-bridge";

export type LspRuntimeBindings = {
  readonly openDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly changeDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly saveDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly closeDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly completion: (request: LspCompletionRequest) => Promise<LspCompletionResult>;
};

export type LspRuntimeLoadResult = {
  readonly loadedFrom: string;
};
