import type {
  WorkbenchBrowserAgentElevationResult,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageDiagnosticsResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchLumenFollowAudit,
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

export type WorkbenchBrowserAgentObserveStrategy =
  | "picker"
  | "focus"
  | "hybrid"
  | "domFallback"
  | "visionFallback";

export type WorkbenchBrowserAgentTargetMode =
  | "isolated"
  | "live";

export const WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID = "lyra-lumen-isolated";

export type WorkbenchBrowserAgentElementBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WorkbenchBrowserAgentElement = {
  readonly id: number;
  readonly targetRef: string;
  readonly stableId: string;
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly actionHint?: string;
  readonly stateHint?: string;
  readonly tooltipText?: string;
  readonly textSnippet?: string;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly focusable: boolean;
  readonly tabIndex?: number;
  readonly disabled: boolean;
  readonly editable: boolean;
  readonly href?: string;
  readonly inputType?: string;
  readonly frameUrl?: string;
  readonly discoveryScope?: "document" | "shadow" | "frame";
};

export type WorkbenchBrowserAgentObservation = {
  readonly ok: true;
  readonly kind: "lyraLumenMap";
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly observationId: string;
  readonly strategy: WorkbenchBrowserAgentObserveStrategy;
  readonly url: string;
  readonly title: string;
  readonly elements: readonly WorkbenchBrowserAgentElement[];
  readonly activeElementId: number | null;
  readonly focusOrder: readonly number[];
  readonly authChallengeSignals?: readonly {
    readonly kind:
      | "captcha"
      | "mfa"
      | "oauth_popup"
      | "login_wall"
      | "cross_origin_auth_frame";
    readonly confidence: "high" | "medium" | "low";
    readonly source: "dom" | "attribute" | "frame" | "browser";
    readonly label?: string;
    readonly url?: string;
  }[];
  readonly warnings?: readonly string[];
  readonly nextRecommendedAction?: string;
};

export type WorkbenchBrowserAgentInteraction =
  | "hover"
  | "click"
  | "doubleClick"
  | "rightClick";

export type WorkbenchBrowserAgentPoint = {
  readonly x: number;
  readonly y: number;
  readonly reason?: string;
};

export type WorkbenchBrowserAgentFocusDirection =
  | "next"
  | "previous"
  | "scan";

export type WorkbenchBrowserAgentFocusTrailEntry = {
  readonly step: number;
  readonly elementId: number | null;
  readonly role?: string;
  readonly label?: string;
};

export type WorkbenchBrowserAgentFocusResult = {
  readonly ok: boolean;
  readonly kind: "lyraLumenFocusResult";
  readonly tabId: string;
  readonly inputMode: "chromium";
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly direction: WorkbenchBrowserAgentFocusDirection;
  readonly steps: number;
  readonly activeElementId: number | null;
  readonly focusedElement?: WorkbenchBrowserAgentElement;
  readonly focusTrail?: readonly WorkbenchBrowserAgentFocusTrailEntry[];
  readonly beforeObservationId?: string;
  readonly afterObservationId?: string;
  readonly restored?: boolean;
  readonly message?: string;
  readonly nextRecommendedAction?: string;
  readonly error?: {
    readonly kind: string;
    readonly message: string;
  };
};

export type WorkbenchBrowserAgentActionResult = {
  readonly ok: boolean;
  readonly kind: "lyraLumenActionResult";
  readonly tabId: string;
  readonly inputMode: "chromium";
  readonly targetMode?: WorkbenchBrowserAgentTargetMode;
  readonly elementId?: number;
  readonly targetRef?: string;
  readonly x?: number;
  readonly y?: number;
  readonly beforeObservationId?: string;
  readonly afterObservationId?: string;
  readonly pageChanged?: boolean;
  readonly focusChanged?: boolean;
  readonly navigationStarted?: boolean;
  readonly staleElement?: boolean;
  readonly message?: string;
  readonly nextRecommendedAction?: string;
  readonly error?: {
    readonly kind: string;
    readonly message: string;
  };
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
  readonly searchInPage: (
    request: WorkbenchBrowserSearchInPageRequest
  ) => Promise<WorkbenchBrowserSearchInPageResult>;
  readonly setChromePopover: (
    request: WorkbenchBrowserChromePopoverRequest
  ) => Promise<void>;
  readonly setElementPickerMode: (
    request: WorkbenchBrowserSetElementPickerModeRequest
  ) => Promise<void>;
  readonly applyWebTheme: (
    snapshot: WorkbenchBrowserWebThemeSnapshot
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
  readonly observeAgentPage: (
    tabId: string,
    request?: {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentObservation>;
  readonly actOnAgentElement: (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly actOnAgentPoint: (
    tabId: string,
    request: {
      readonly point: WorkbenchBrowserAgentPoint;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly focusAgentPage: (
    tabId: string,
    request: {
      readonly direction: WorkbenchBrowserAgentFocusDirection;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly steps?: number;
      readonly restoreFocus?: boolean;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentFocusResult>;
  readonly typeIntoAgentElement: (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly text: string;
      readonly clear?: boolean;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly pressAgentKey: (
    tabId: string,
    request: {
      readonly key: string;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly navigateAgentPage: (
    tabId: string,
    request: {
      readonly url: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserNavigateResult & { readonly targetMode: WorkbenchBrowserAgentTargetMode }>;
  readonly readAgentPage: (
    tabId: string,
    request: {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly maxChars?: number;
      readonly timeoutMs?: number;
    }
  ) => Promise<
    | (WorkbenchTabExtractTextResult & {
        readonly targetMode: WorkbenchBrowserAgentTargetMode;
        readonly content: string;
      })
    | (WorkbenchObservationBrowserDomSummary & {
        readonly targetMode: WorkbenchBrowserAgentTargetMode;
        readonly content: string;
      })
  >;
  readonly captureAgentPage: (
    tabId: string,
    request?: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
    }
  ) => Promise<WorkbenchVisualCaptureResult & { readonly targetMode: WorkbenchBrowserAgentTargetMode }>;
  readonly showAgentActivity: (
    tabId: string,
    request: {
      readonly action: "wait";
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly durationMs?: number;
    }
  ) => Promise<{
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly action: "wait";
  }>;
  readonly readAgentFollowAudit: (
    tabId: string,
    request?: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly maxActions?: number;
    }
  ) => Promise<WorkbenchLumenFollowAudit>;
  readonly auditAgentPageDiagnostics: (
    tabId: string,
    request?: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly maxEntries?: number;
    }
  ) => Promise<WorkbenchBrowserPageDiagnosticsResult>;
  readonly elevateAgentPage: (
    tabId: string,
    request?: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly reason?: string;
    }
  ) => Promise<WorkbenchBrowserAgentElevationResult>;
};

export type WorkbenchBrowserElementPickerController = {
  readonly dispose: () => Promise<void>;
  readonly setMode: (request: WorkbenchBrowserSetElementPickerModeRequest) => Promise<void>;
  readonly handleActiveTabChanged: (activeTabId: string | null) => void;
  readonly handlePageNavigated: (tabId: string) => void;
  readonly handlePageClosed: (tabId: string) => void;
  readonly handleConsoleMessage: (tabId: string, message: string) => void;
  readonly readState: () => WorkbenchBrowserElementPickerState | null;
};
