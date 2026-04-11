import type { WorkbenchActiveDocumentHint } from "./workbench-documents";

export type WorkbenchObservationAppId = string;

export type WorkbenchObservationPageKind =
  | "search"
  | "results"
  | "page"
  | "settings"
  | "terminal"
  | "app";

export type WorkbenchObservationSearchMode = "standard" | "deep";

export type WorkbenchObservationDetail = "summary" | "full";

export type WorkbenchObservationErrorCode =
  | "tab_not_found"
  | "unsupported_tab_kind"
  | "renderer_timeout"
  | "renderer_bridge_unavailable"
  | "browser_capture_unavailable"
  | "background_visual_capture_unsupported";

export type WorkbenchObservationError = {
  readonly code: WorkbenchObservationErrorCode;
  readonly message: string;
};

export type WorkbenchObservationKind =
  | "page"
  | "search-home"
  | "search-results"
  | "deep-search-results"
  | "file-editor"
  | "file-manager"
  | "terminal";

export type WorkbenchObservedTabDescriptor = {
  readonly tabId: string;
  readonly title: string;
  readonly pageKind: WorkbenchObservationPageKind;
  readonly appId?: WorkbenchObservationAppId;
  readonly appInstanceId?: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly focusedPane: boolean;
  readonly displayAddress?: string;
  readonly observable: boolean;
  readonly observationKind?: WorkbenchObservationKind;
};

export type WorkbenchTabsListRequest = {
  readonly scope?: "all" | "visible" | "active";
  readonly includeUnsupported?: boolean;
};

export type WorkbenchTabsListResult = {
  readonly activeTabId: string | null;
  readonly visibleTabIds: readonly string[];
  readonly tabs: readonly WorkbenchObservedTabDescriptor[];
};

export type WorkbenchWorkspaceReadRequest = {
  readonly detail?: WorkbenchObservationDetail;
  readonly includeVisual?: boolean;
};

export type WorkbenchVisualCaptureRequest = {
  readonly tabId: string;
};

export type WorkbenchTabExtractTextScope = "main" | "full";

export type WorkbenchTabExtractTextRequest = {
  readonly tabId: string;
  readonly scope?: WorkbenchTabExtractTextScope;
  readonly maxChars?: number;
  readonly cursor?: number;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly paneId?: string;
};

export type WorkbenchTabExtractTextResult = {
  readonly tabId: string;
  readonly scope: WorkbenchTabExtractTextScope;
  readonly text: string;
  readonly truncated: boolean;
  readonly startChar: number;
  readonly endChar: number;
  readonly totalChars: number;
  readonly hasMore: boolean;
  readonly nextCursor?: number;
  readonly extractionMethod: string;
};

export type WorkbenchVisualCaptureResult = {
  readonly tabId: string;
  readonly mimeType: "image/png";
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  readonly visibleOnly: boolean;
};

export type WorkbenchTabReadRequest = {
  readonly tabId: string;
  readonly detail?: WorkbenchObservationDetail;
  readonly maxChars?: number;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly paneId?: string;
  readonly includeVisual?: boolean;
};

export type WorkbenchBrowserLinkSummary = {
  readonly text: string;
  readonly href: string;
};

export type WorkbenchBrowserFormSummary = {
  readonly action?: string;
  readonly method?: string;
  readonly fields: readonly string[];
};

export type BrowserTabObservation = {
  readonly kind: "page";
  readonly title: string;
  readonly address: string;
  readonly faviconUrl?: string;
  readonly isLoading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly domTitle?: string;
  readonly documentLanguage?: string;
  readonly selectionText?: string;
  readonly headings: readonly string[];
  readonly mainTextExcerpt: string;
  readonly links: readonly WorkbenchBrowserLinkSummary[];
  readonly forms: readonly WorkbenchBrowserFormSummary[];
  readonly truncated: boolean;
  readonly activeDocument?: WorkbenchActiveDocumentHint;
};

export type FileEditorObservation = {
  readonly kind: "file-editor";
  readonly filePath: string;
  readonly title: string;
  readonly languageId: string;
  readonly status: string;
  readonly isDirty: boolean;
  readonly isReadOnly: boolean;
  readonly revision?: string;
  readonly diagnostics: readonly {
    readonly severity?: number;
    readonly message: string;
    readonly line?: number;
    readonly column?: number;
  }[];
  readonly content: string;
  readonly truncated: boolean;
};

export type FileManagerObservation = {
  readonly kind: "file-manager";
  readonly viewKind: string;
  readonly presentationMode: string;
  readonly currentLocation: {
    readonly kind: string;
    readonly path?: string;
    readonly title?: string;
  } | null;
  readonly selectedEntryId?: string;
  readonly entries: readonly {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly kind?: string;
    readonly sizeBytes?: number;
    readonly modifiedAt?: string;
  }[];
  readonly truncated: boolean;
};

export type TerminalObservation = {
  readonly kind: "terminal";
  readonly activePaneId: string;
  readonly panes: readonly {
    readonly paneId: string;
    readonly sessionId: string;
    readonly title: string;
    readonly cwd?: string;
    readonly shell?: string;
    readonly isActive: boolean;
  }[];
  readonly activeOutput: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly truncated: boolean;
};

export type SearchHomeObservation = {
  readonly kind: "search-home";
  readonly inputValue: string;
  readonly searchMode: WorkbenchObservationSearchMode;
  readonly hasResults: false;
};

export type SearchResultsObservation = {
  readonly kind: "search-results";
  readonly query: string;
  readonly searchMode: "standard";
  readonly webStatus: string;
  readonly localStatus: string;
  readonly blendedResults: readonly {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
  }[];
  readonly localResults: readonly {
    readonly path: string;
    readonly snippet?: string;
    readonly line?: number;
  }[];
  readonly truncated: boolean;
};

export type DeepSearchObservation = {
  readonly kind: "deep-search-results";
  readonly query: string;
  readonly budgetPreset: string;
  readonly status: string;
  readonly done: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly kind: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly truncated: boolean;
};

export type WorkbenchTabObservation =
  | BrowserTabObservation
  | FileEditorObservation
  | FileManagerObservation
  | TerminalObservation
  | SearchHomeObservation
  | SearchResultsObservation
  | DeepSearchObservation;

export type WorkbenchTabObservationResult = {
  readonly tab: WorkbenchObservedTabDescriptor;
  readonly observation: WorkbenchTabObservation;
  readonly visual?: WorkbenchVisualCaptureResult;
};

export type WorkbenchWorkspaceSnapshot = {
  readonly layoutMode: "single" | "split";
  readonly activeTabId: string | null;
  readonly focusedTabId: string | null;
  readonly visibleTabs: readonly WorkbenchTabObservationResult[];
};

export type WorkbenchObservationQueryRequest =
  | {
      readonly requestId: string;
      readonly method: "workbench.tabs.list_local";
      readonly payload: WorkbenchTabsListRequest;
    }
  | {
      readonly requestId: string;
      readonly method: "workbench.workspace.read_local";
      readonly payload: WorkbenchWorkspaceReadRequest;
    }
  | {
      readonly requestId: string;
      readonly method: "workbench.tab.read_local";
      readonly payload: WorkbenchTabReadRequest;
    };

export type WorkbenchObservationQueryResult = {
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: WorkbenchObservationError;
};
