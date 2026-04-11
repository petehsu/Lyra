export type NativeDocumentFormat = "pdf" | "unknown";
export type NativeDocumentReadScope = "full" | "current_page" | "visible" | "page_range";

export type NativeDocumentProbeRequest = {
  readonly bytesBase64: string;
  readonly mimeHint?: string;
  readonly urlHint?: string;
};

export type NativeDocumentProbeResult = {
  readonly format: NativeDocumentFormat;
  readonly pageCount?: number;
  readonly encrypted: boolean;
  readonly textAvailable: boolean;
};

export type NativeDocumentReadRequest = {
  readonly bytesBase64: string;
  readonly mimeHint?: string;
  readonly urlHint?: string;
  readonly scope: NativeDocumentReadScope;
  readonly pageStart?: number;
  readonly pageEnd?: number;
  readonly visiblePages?: readonly number[];
  readonly currentPage?: number;
  readonly maxChars?: number;
  readonly cursor?: number;
};

export type NativeDocumentReadResult = {
  readonly format: NativeDocumentFormat;
  readonly pageCount?: number;
  readonly text: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly totalChars: number;
  readonly truncated: boolean;
  readonly hasMore: boolean;
  readonly nextCursor?: number;
  readonly extractionMethod: string;
  readonly emptyReason?: string;
};

export type NativeDocumentSearchRequest = {
  readonly bytesBase64: string;
  readonly mimeHint?: string;
  readonly urlHint?: string;
  readonly query: string;
  readonly maxMatches?: number;
};

export type NativeDocumentSearchResult = {
  readonly format: NativeDocumentFormat;
  readonly pageCount?: number;
  readonly matches: readonly {
    readonly pageIndex?: number;
    readonly excerpt: string;
    readonly startChar?: number;
    readonly endChar?: number;
  }[];
  readonly truncated: boolean;
};

export type DocsNativeBindings = {
  readonly probeDocumentJson: (input: string) => string;
  readonly readDocumentTextJson: (input: string) => string;
  readonly searchDocumentTextJson: (input: string) => string;
};

export type DocsNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: DocsNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
