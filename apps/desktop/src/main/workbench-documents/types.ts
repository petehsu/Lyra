import type {
  WorkbenchDocumentInspectRequest,
  WorkbenchDocumentInspectResult,
  WorkbenchDocumentReadRequest,
  WorkbenchDocumentReadResult,
  WorkbenchDocumentSearchRequest,
  WorkbenchDocumentSearchResult,
  WorkbenchEmbeddedDocumentCandidate
} from "../../shared/workbench-documents";

export type WorkbenchDocumentsService = {
  readonly dispose: () => void;
  readonly detectActiveDocument: (tabId?: string) => Promise<WorkbenchEmbeddedDocumentCandidate | null>;
  readonly inspectDocument: (request: WorkbenchDocumentInspectRequest) => Promise<WorkbenchDocumentInspectResult>;
  readonly readDocument: (request: WorkbenchDocumentReadRequest) => Promise<WorkbenchDocumentReadResult>;
  readonly searchDocument: (request: WorkbenchDocumentSearchRequest) => Promise<WorkbenchDocumentSearchResult>;
};

export type CachedDocumentBytes = {
  readonly finalUrl: string;
  readonly mimeType?: string;
  readonly body: Buffer;
};

export type ResolvedDocumentTarget = {
  readonly tabId: string;
  readonly candidate: WorkbenchEmbeddedDocumentCandidate;
};

export type DocumentFallbackResult = {
  readonly text: string;
  readonly currentPageIndex?: number;
  readonly visiblePageIndices?: readonly number[];
  readonly pageCount?: number;
  readonly extractionMethod: "viewer:frame-dom" | "viewer:visible-dom" | "viewer:container-dom";
  readonly fallbackReason: string;
};
