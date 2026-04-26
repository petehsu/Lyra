import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserTopologySnapshot,
  WorkbenchBrowserWebThemeSnapshot
} from "../../shared/desktop-bridge";
import type {
  WorkbenchTabExtractTextResult,
  WorkbenchVisualCaptureResult
} from "../../shared/workbench-observation";
import type {
  WorkbenchObservationBrowserDomSummary
} from "../workbench-observation/types";
import type {
  BrowserDomSummaryReadOptions,
  BrowserTextExtractOptions
} from "../workbench-observation/browser/types";

export type WorkbenchBrowserPublishEvent = (event: WorkbenchBrowserEvent) => void;

export type WorkbenchBrowserFrameDescriptor = {
  readonly frameTreeNodeId: number;
  readonly url: string;
  readonly origin: string;
  readonly name: string;
  readonly parentFrameTreeNodeId?: number;
  readonly isMainFrame: boolean;
};

export type WorkbenchBrowserFrameDomProbeCandidate = {
  readonly sourceKind: "iframe" | "embed" | "object";
  readonly documentUrl?: string;
  readonly mimeHint?: string;
  readonly formatHint: "pdf" | "unknown";
  readonly visibleRatio: number;
  readonly titleHint?: string;
};

export type WorkbenchBrowserFrameDomProbeResult = {
  readonly title?: string;
  readonly bodyText?: string;
  readonly selectionText?: string;
  readonly viewerKind?: "pdfjs" | "generic";
  readonly viewerDocumentUrl?: string;
  readonly viewerText?: string;
  readonly containerText?: string;
  readonly currentPageIndex?: number;
  readonly pageCount?: number;
  readonly visiblePageIndices?: readonly number[];
  readonly embeddedDocuments: readonly WorkbenchBrowserFrameDomProbeCandidate[];
};

export type WorkbenchBrowserSessionFetchRequest = {
  readonly url: string;
  readonly referrer?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
};

export type WorkbenchBrowserFrameGlobalBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WorkbenchBrowserSessionFetchResult = {
  readonly finalUrl: string;
  readonly status: number;
  readonly mimeType?: string;
  readonly body: Buffer;
};

export type WorkbenchBrowserNativeMouseButton = "left" | "middle" | "right";

export type WorkbenchBrowserNativeInputEvent =
  | {
      readonly type: "mouseMove" | "mouseDown" | "mouseUp";
      readonly x: number;
      readonly y: number;
      readonly button?: WorkbenchBrowserNativeMouseButton;
      readonly clickCount?: number;
      readonly delayMs?: number;
    }
  | {
      readonly type: "keyDown" | "keyUp" | "char";
      readonly keyCode: string;
      readonly modifiers?: readonly ("shift" | "control" | "alt" | "meta")[];
      readonly delayMs?: number;
    };

export type WorkbenchBrowserDebuggerEvent =
  | {
      readonly kind: "message";
      readonly method: string;
      readonly params: unknown;
      readonly sessionId?: string;
    }
  | {
      readonly kind: "detached";
      readonly reason: string;
    };

export type WorkbenchBrowserDebuggerSession = {
  readonly tabId: string;
  readonly pageAddress?: string;
  readonly sendCommand: (
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string,
  ) => Promise<Record<string, unknown>>;
  readonly subscribe: (
    listener: (event: WorkbenchBrowserDebuggerEvent) => void,
  ) => () => void;
  readonly focus: () => void;
  readonly close: () => Promise<void>;
};

export type WorkbenchBrowserViewManager = {
  readonly dispose: () => void;
  readonly syncTopology: (snapshot: WorkbenchBrowserTopologySnapshot) => void;
  readonly syncLayout: (snapshot: WorkbenchBrowserLayoutSnapshot) => void;
  readonly navigate: (
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<WorkbenchBrowserNavigateResult>;
  readonly goBack: (tabId: string) => void;
  readonly goForward: (tabId: string) => void;
  readonly reload: (tabId: string, ignoreCache?: boolean) => void;
  readonly stop: (tabId: string) => void;
  readonly readPageState: (
    request?: WorkbenchBrowserReadPageStateRequest
  ) => WorkbenchBrowserPageRuntimeState | null;
  readonly setElementPickerMode: (
    request: WorkbenchBrowserSetElementPickerModeRequest
  ) => Promise<void>;
  readonly applyWebTheme: (
    snapshot: WorkbenchBrowserWebThemeSnapshot
  ) => Promise<void>;
  readonly showAgentElementPickerTarget: (
    target: WorkbenchBrowserAgentTargetInfo
  ) => Promise<boolean>;
  readonly clearAgentElementPickerTarget: (
    tabId: string,
    options?: { readonly preserveManualMode?: boolean }
  ) => Promise<void>;
  readonly readActiveTabId: () => string | null;
  readonly listFrames: (tabId: string) => readonly WorkbenchBrowserFrameDescriptor[];
  readonly probeFrameDom: (
    tabId: string,
    frameTreeNodeId: number,
    options?: { readonly maxChars?: number }
  ) => Promise<WorkbenchBrowserFrameDomProbeResult>;
  readonly executeFrameScript: (
    tabId: string,
    request: {
      readonly script: string;
      readonly frameTreeNodeId?: number;
      readonly userGesture?: boolean;
      readonly timeoutMs?: number;
    }
  ) => Promise<unknown>;
  readonly dispatchNativeInput: (
    tabId: string,
    events: readonly WorkbenchBrowserNativeInputEvent[]
  ) => Promise<void>;
  readonly openDebuggerSession: (tabId: string) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly fetchWithTabSession: (
    tabId: string,
    request: WorkbenchBrowserSessionFetchRequest
  ) => Promise<WorkbenchBrowserSessionFetchResult>;
  readonly readPageDomSummary: (
    tabId: string,
    options?: BrowserDomSummaryReadOptions
  ) => Promise<WorkbenchObservationBrowserDomSummary>;
  readonly extractPageText: (
    tabId: string,
    options?: BrowserTextExtractOptions
  ) => Promise<WorkbenchTabExtractTextResult>;
  readonly capturePage: (tabId: string) => Promise<WorkbenchVisualCaptureResult>;
  readonly resolveFrameGlobalBounds: (
    tabId: string,
    frameTreeNodeId: number
  ) => Promise<WorkbenchBrowserFrameGlobalBounds | null>;
  readonly reapplyLayout: () => void;
  readonly toggleDevToolsForActivePage: () => boolean;
};

export type WorkbenchBrowserElementPickerController = {
  readonly dispose: () => Promise<void>;
  readonly setMode: (request: WorkbenchBrowserSetElementPickerModeRequest) => Promise<void>;
  readonly showAgentTarget: (target: WorkbenchBrowserAgentTargetInfo) => Promise<boolean>;
  readonly clearAgentTarget: (
    tabId: string,
    options?: { readonly preserveManualMode?: boolean }
  ) => Promise<void>;
  readonly handleActiveTabChanged: (activeTabId: string | null) => void;
  readonly handlePageNavigated: (tabId: string) => void;
  readonly handlePageClosed: (tabId: string) => void;
  readonly handleConsoleMessage: (tabId: string, message: string) => void;
  readonly readState: () => WorkbenchBrowserElementPickerState | null;
};
