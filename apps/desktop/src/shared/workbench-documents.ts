export type WorkbenchDocumentFormat = "pdf" | "unknown";

export type WorkbenchEmbeddedDocumentSourceKind =
  | "top_level"
  | "iframe"
  | "embed"
  | "object"
  | "viewer_dom";

export type WorkbenchDocumentScope = "full" | "current_page" | "visible" | "page_range";

export type WorkbenchEmbeddedDocumentCandidate = {
  readonly candidateId: string;
  readonly tabId: string;
  readonly sourceKind: WorkbenchEmbeddedDocumentSourceKind;
  readonly frameTreeNodeId?: number;
  readonly frameUrl?: string;
  readonly documentUrl?: string;
  readonly mimeHint?: string;
  readonly formatHint: WorkbenchDocumentFormat;
  readonly visibleRatio: number;
  readonly titleHint?: string;
  readonly currentPageIndex?: number;
  readonly visiblePageIndices?: readonly number[];
  readonly pageCountHint?: number;
};

export type WorkbenchActiveDocumentHint = {
  readonly detected: true;
  readonly format: WorkbenchDocumentFormat;
  readonly sourceKind: WorkbenchEmbeddedDocumentSourceKind;
  readonly title?: string;
  readonly currentPageIndex?: number;
  readonly pageCount?: number;
  readonly preferredTool: "workbench.document.inspect" | "workbench.document.read";
};

export type WorkbenchDocumentInspectRequest = {
  readonly tabId?: string;
};

export type WorkbenchDocumentInspectResult = {
  readonly tabId: string;
  readonly documentId: string;
  readonly format: WorkbenchDocumentFormat;
  readonly sourceKind: WorkbenchEmbeddedDocumentSourceKind;
  readonly title?: string;
  readonly sourceUrl?: string;
  readonly mimeType?: string;
  readonly pageCount?: number;
  readonly currentPageIndex?: number;
  readonly visiblePageIndices?: readonly number[];
  readonly textAvailable?: boolean;
  readonly encrypted?: boolean;
  readonly metadataSource: "pdf:rust-probe" | "viewer:frame-dom" | "candidate-hint";
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
};

export type WorkbenchDocumentReadRequest = {
  readonly tabId?: string;
  readonly scope?: WorkbenchDocumentScope;
  readonly pageStart?: number;
  readonly pageEnd?: number;
  readonly maxChars?: number;
  readonly cursor?: number;
};

export type WorkbenchDocumentReadResult = {
  readonly tabId: string;
  readonly documentId: string;
  readonly format: WorkbenchDocumentFormat;
  readonly sourceKind: WorkbenchEmbeddedDocumentSourceKind;
  readonly title?: string;
  readonly sourceUrl?: string;
  readonly mimeType?: string;
  readonly pageCount?: number;
  readonly currentPageIndex?: number;
  readonly visiblePageIndices?: readonly number[];
  readonly scope: WorkbenchDocumentScope;
  readonly pageRange?: {
    readonly start: number;
    readonly end: number;
  };
  readonly text: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly totalChars: number;
  readonly truncated: boolean;
  readonly hasMore: boolean;
  readonly nextCursor?: number;
  readonly extractionMethod:
    | "pdf:rust-parser"
    | "viewer:frame-dom"
    | "viewer:visible-dom"
    | "viewer:container-dom";
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
};

export type WorkbenchDocumentSearchRequest = {
  readonly tabId?: string;
  readonly query: string;
  readonly maxMatches?: number;
};

export type WorkbenchDocumentSearchResult = {
  readonly tabId: string;
  readonly documentId: string;
  readonly format: WorkbenchDocumentFormat;
  readonly matches: readonly {
    readonly pageIndex?: number;
    readonly excerpt: string;
    readonly startChar?: number;
    readonly endChar?: number;
  }[];
  readonly truncated: boolean;
};
