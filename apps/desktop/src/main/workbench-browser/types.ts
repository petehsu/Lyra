import type {
  WorkbenchBrowserAgentElevationResult,
  WorkbenchBrowserAgentElevationCompletionResult,
  WorkbenchBrowserAuthChallengeSignal,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageDiagnosticsResult,
  BrowserSessionSnapshot,
  BrowserStorageStateRef,
  WorkbenchBrowserClearSiteDataRequest,
  WorkbenchBrowserClearSiteDataResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserStorageStateRequest,
  WorkbenchLumenFollowAudit,
  WorkbenchLumenStaleTarget,
  WorkbenchLumenTargetExplanation,
  WorkbenchLumenTargetRef,
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
  readonly formatHint: "pdf" | "docx" | "xlsx" | "pptx" | "image" | "unknown";
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

export type WorkbenchBrowserSemanticActionCapability =
  | "click"
  | "type"
  | "select"
  | "check"
  | "expand"
  | "open"
  | "menuitem";

export type WorkbenchBrowserSemanticTreeScope =
  | "document"
  | "shadow"
  | "frame"
  | "ax"
  | "visual";

export type WorkbenchBrowserSemanticFrame = {
  readonly frameRef: string;
  readonly frameTreeNodeId: number;
  readonly parentFrameRef?: string;
  readonly parentFrameTreeNodeId?: number;
  readonly isMainFrame: boolean;
  readonly url: string;
  readonly origin: string;
  readonly name: string;
  readonly bounds?: WorkbenchBrowserFrameGlobalBounds;
  readonly ownerSelectorPreview?: string;
  readonly ownerFrameTreeNodeId?: number;
  readonly domAccess: "direct" | "cdp" | "blocked" | "unknown";
  readonly accessibilityStatus: "available" | "partial" | "blocked" | "unknown";
  readonly blockedReason?: string;
  readonly matchConfidence?: "high" | "medium" | "low";
};

export type WorkbenchBrowserSemanticNode = {
  readonly nodeKey: string;
  readonly targetRef: string;
  readonly frameRef: string;
  readonly frameTreeNodeId: number;
  readonly elementId?: number;
  readonly tagName?: string;
  readonly role: string;
  readonly name: string;
  readonly label: string;
  readonly selectorPreview?: string;
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly source: readonly ("dom" | "ax" | "visual")[];
  readonly treeScope: WorkbenchBrowserSemanticTreeScope;
  readonly hostChain?: readonly string[];
  readonly hostChainFingerprint?: string;
  readonly actionCapabilities: readonly WorkbenchBrowserSemanticActionCapability[];
  readonly visibility: {
    readonly visible: boolean;
    readonly offscreen: boolean;
    readonly covered: boolean;
    readonly ariaHidden: boolean;
  };
  readonly state: {
    readonly focusable: boolean;
    readonly disabled: boolean;
    readonly editable: boolean;
    readonly checked?: boolean;
    readonly expanded?: boolean;
  };
  readonly confidence: number;
  readonly blockedReason?: string;
  readonly risk?: {
    readonly kind: "visualFallback";
    readonly message: string;
  };
};

export type WorkbenchBrowserSemanticEdge = {
  readonly from: string;
  readonly to: string;
  readonly kind: "contains" | "owns" | "shadow-host" | "frame-owner" | "ax-controls";
};

export type WorkbenchBrowserSemanticBlockedRegion = {
  readonly id: string;
  readonly kind:
    | "cross-origin"
    | "closed-shadow"
    | "captcha"
    | "permission-prompt"
    | "frame-unavailable"
    | "visual-fallback";
  readonly frameRef?: string;
  readonly frameTreeNodeId?: number;
  readonly bounds?: WorkbenchBrowserAgentElementBounds;
  readonly reason: string;
  readonly url?: string;
  readonly fallback?: "ax" | "visual" | "elevate" | "user";
  readonly confidence: "high" | "medium" | "low";
};

export type WorkbenchBrowserSemanticCoverage = {
  readonly domCoverage: number;
  readonly axCoverage: number;
  readonly frameCoverage: number;
  readonly shadowCoverage: number;
  readonly visualCoverage: number;
};

export type WorkbenchBrowserSemanticTree = {
  readonly nodes: readonly WorkbenchBrowserSemanticNode[];
  readonly edges: readonly WorkbenchBrowserSemanticEdge[];
  readonly frames: readonly WorkbenchBrowserSemanticFrame[];
  readonly warnings: readonly string[];
  readonly coverage: WorkbenchBrowserSemanticCoverage;
  readonly blockedRegions: readonly WorkbenchBrowserSemanticBlockedRegion[];
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
  | "interactiveOnly"
  | "picker"
  | "focus"
  | "hybrid"
  | "domFallback"
  | "visionFallback";

export type WorkbenchBrowserAgentTargetMode =
  | "isolated"
  | "live";

export type WorkbenchBrowserAgentAuthStateRequest =
  | "none"
  | "borrowLiveLogin";

export type WorkbenchBrowserAgentAuthStateStatus =
  | "liveProfile"
  | "isolatedProfile"
  | "borrowedLiveLogin"
  | "borrowLiveLoginUnavailable";

export type WorkbenchBrowserAgentModeReason =
  | "default_current_visible_browser"
  | "explicit_live"
  | "explicit_isolated"
  | "follow_toggle_enabled"
  | "user_authorized_live_login_state"
  | "isolated_login_state_unavailable";

export type WorkbenchBrowserAgentModeInfo = {
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly visibleFollow: boolean;
  readonly authState: WorkbenchBrowserAgentAuthStateStatus;
  readonly reason: WorkbenchBrowserAgentModeReason;
  readonly profilePartition: string;
  readonly liveLoginState?: {
    readonly borrowed: boolean;
    readonly sourceOrigin?: string;
    readonly cookieCount?: number;
    readonly localStorageItemCount?: number;
    readonly coverage: readonly ("cookies" | "localStorage")[];
    readonly unavailableReason?: string;
  };
};

export type WorkbenchBrowserAgentModeRequest = {
  readonly targetMode?: WorkbenchBrowserAgentTargetMode;
  readonly visibleFollow?: boolean;
  readonly authState?: WorkbenchBrowserAgentAuthStateRequest;
  readonly useLiveLoginState?: boolean;
};

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
  readonly target: WorkbenchLumenTargetRef;
  readonly frameRef: string;
  readonly semanticNodeKey?: string;
  readonly elementFingerprint: string;
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly actionHint?: string;
  readonly actionCapabilities?: readonly WorkbenchBrowserSemanticActionCapability[];
  readonly stateHint?: string;
  readonly tooltipText?: string;
  readonly textSnippet?: string;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly localBounds?: WorkbenchBrowserAgentElementBounds;
  readonly frameBounds?: WorkbenchBrowserAgentElementBounds;
  readonly focusable: boolean;
  readonly tabIndex?: number;
  readonly disabled: boolean;
  readonly editable: boolean;
  readonly visibility?: {
    readonly visible: boolean;
    readonly offscreen: boolean;
    readonly covered: boolean;
    readonly ariaHidden: boolean;
  };
  readonly checked?: boolean;
  readonly expanded?: boolean;
  readonly href?: string;
  readonly inputType?: string;
  readonly frameUrl?: string;
  readonly discoveryScope?: WorkbenchBrowserSemanticTreeScope;
  readonly hostChain?: readonly string[];
  readonly hostChainFingerprint?: string;
  readonly confidence?: number;
};

export type WorkbenchBrowserAgentObservation = {
  readonly ok: true;
  readonly kind: "lyraLumenMap";
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  readonly observationId: string;
  readonly mapEpoch: number;
  readonly strategy: WorkbenchBrowserAgentObserveStrategy;
  readonly url: string;
  readonly title: string;
  readonly targets: readonly WorkbenchLumenTargetRef[];
  readonly elements: readonly WorkbenchBrowserAgentElement[];
  readonly semanticTree?: WorkbenchBrowserSemanticTree;
  readonly coverage?: WorkbenchBrowserSemanticCoverage;
  readonly blockedRegions?: readonly WorkbenchBrowserSemanticBlockedRegion[];
  readonly activeElementId: number | null;
  readonly focusOrder: readonly number[];
  readonly authChallengeSignals?: readonly WorkbenchBrowserAuthChallengeSignal[];
  readonly warnings?: readonly string[];
  readonly nextRecommendedAction?: string;
};

export type WorkbenchBrowserAgentInteraction =
  | "hover"
  | "click"
  | "doubleClick"
  | "rightClick";

export type WorkbenchBrowserAgentVerification =
  | "none"
  | "full";

export type WorkbenchBrowserAgentPoint = {
  readonly x: number;
  readonly y: number;
  readonly reason?: string;
};

export type WorkbenchBrowserAgentScrollDirection =
  | "up"
  | "down"
  | "left"
  | "right";

export type WorkbenchBrowserAgentScrollBlock =
  | "start"
  | "center"
  | "end"
  | "nearest";

export type WorkbenchBrowserAgentScrollEffect = {
  readonly reason:
    | "target_offscreen"
    | "point_offscreen"
    | "explicit_scroll"
    | "ensure_visible";
  readonly scrolled: boolean;
  readonly method:
    | "wheel"
    | "scrollIntoView"
    | "scrollBy"
    | "containerScroll"
    | "none";
  readonly before: {
    readonly x: number;
    readonly y: number;
  };
  readonly after: {
    readonly x: number;
    readonly y: number;
  };
  readonly deltaX: number;
  readonly deltaY: number;
  readonly targetRef?: string;
  readonly elementId?: number;
  readonly beforeObservationId?: string;
  readonly afterObservationId?: string;
};

export type WorkbenchBrowserAgentScrollResult = {
  readonly ok: boolean;
  readonly kind: "lyraLumenScrollResult";
  readonly tabId: string;
  readonly inputMode: "chromium";
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  readonly direction?: WorkbenchBrowserAgentScrollDirection;
  readonly amount?: number;
  readonly pages?: number;
  readonly x?: number;
  readonly y?: number;
  readonly targetRef?: string;
  readonly elementId?: number;
  readonly beforeObservationId?: string;
  readonly afterObservationId?: string;
  readonly scrolled: boolean;
  readonly method: WorkbenchBrowserAgentScrollEffect["method"];
  readonly deltaX: number;
  readonly deltaY: number;
  readonly autoScroll?: WorkbenchBrowserAgentScrollEffect;
  readonly message?: string;
  readonly nextRecommendedAction?: string;
  readonly error?: {
    readonly kind: string;
    readonly message: string;
  };
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
  readonly browserMode?: WorkbenchBrowserAgentModeInfo;
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
  readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  readonly elementId?: number;
  readonly targetRef?: string;
  readonly x?: number;
  readonly y?: number;
  readonly beforeObservationId?: string;
  readonly afterObservationId?: string;
  readonly pageChanged?: boolean;
  readonly focusChanged?: boolean;
  readonly navigationStarted?: boolean;
  readonly verification?: WorkbenchBrowserAgentVerification;
  readonly inputValuePreview?: string;
  readonly inputTextChanged?: boolean;
  readonly inputAlreadyMatched?: boolean;
  readonly inputInsertionMethod?: string;
  readonly staleElement?: boolean;
  readonly staleTarget?: WorkbenchLumenStaleTarget;
  readonly nearestCandidates?: readonly WorkbenchBrowserAgentElement[];
  readonly autoScroll?: WorkbenchBrowserAgentScrollEffect;
  readonly message?: string;
  readonly nextRecommendedAction?: string;
  readonly error?: {
    readonly kind: string;
    readonly message: string;
  };
};

export type WorkbenchBrowserAgentFindResult = WorkbenchBrowserSearchInPageResult & {
  readonly ok: true;
  readonly kind: "lyraLumenFind";
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  readonly revealRect?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly nextRecommendedAction?: string;
};

export type WorkbenchBrowserAgentLocateResult = {
  readonly ok: true;
  readonly kind: "lyraLumenLocate";
  readonly tabId: string;
  readonly address: string;
  readonly title: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  readonly matched: boolean;
  readonly matchMode: "exact" | "semantic";
  readonly query: string;
  readonly anchorQuery?: string;
  readonly semanticScore?: number;
  readonly semanticReason?: string;
  readonly findResult?: WorkbenchBrowserAgentFindResult;
  readonly observationId?: string;
  readonly nearbyElements?: readonly WorkbenchBrowserAgentElement[];
  readonly nextRecommendedAction?: string;
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
  readonly readSessionSnapshot: () => BrowserSessionSnapshot | null;
  readonly readStorageState: (
    request?: WorkbenchBrowserStorageStateRequest
  ) => Promise<BrowserStorageStateRef>;
  readonly clearSiteData: (
    request: WorkbenchBrowserClearSiteDataRequest
  ) => Promise<WorkbenchBrowserClearSiteDataResult>;
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
  readonly readRenderedSnapshot: (payload: unknown) => Promise<unknown>;
  readonly resolveFrameGlobalBounds: (
    tabId: string,
    frameTreeNodeId: number
  ) => Promise<WorkbenchBrowserFrameGlobalBounds | null>;
  readonly reapplyLayout: () => void;
  readonly setModalOcclusionActive: (active: boolean) => void;
  readonly toggleDevToolsForActivePage: () => boolean;
  readonly observeAgentPage: (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
    }
  ) => Promise<WorkbenchBrowserAgentObservation>;
  readonly findAgentPage: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & WorkbenchBrowserSearchInPageRequest & {
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentFindResult>;
  readonly locateAgentPage: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly query: string;
      readonly matchMode?: "exact" | "semantic";
      readonly autoMap?: boolean;
      readonly nearbyLimit?: number;
      readonly reveal?: boolean;
      readonly caseSensitive?: boolean;
      readonly maxMatches?: number;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentLocateResult>;
  readonly actOnAgentElement: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly actOnAgentPoint: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly point: WorkbenchBrowserAgentPoint;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly focusAgentPage: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction: WorkbenchBrowserAgentFocusDirection;
      readonly steps?: number;
      readonly restoreFocus?: boolean;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentFocusResult>;
  readonly scrollAgentPage: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction?: WorkbenchBrowserAgentScrollDirection;
      readonly amount?: number;
      readonly pages?: number;
      readonly block?: WorkbenchBrowserAgentScrollBlock;
      readonly behavior?: "instant" | "smooth";
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly point?: WorkbenchBrowserAgentPoint;
      readonly autoMap?: boolean;
      readonly timeoutMs?: number;
      readonly reason?: "explicit_scroll" | "ensure_visible";
    }
  ) => Promise<WorkbenchBrowserAgentScrollResult>;
  readonly typeIntoAgentElement: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly text: string;
      readonly clear?: boolean;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly pressAgentKey: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly key: string;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly navigateAgentPage: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly url: string;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserNavigateResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  }>;
  readonly readAgentPage: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly maxChars?: number;
      readonly timeoutMs?: number;
    }
  ) => Promise<
    | (WorkbenchTabExtractTextResult & {
        readonly targetMode: WorkbenchBrowserAgentTargetMode;
        readonly browserMode?: WorkbenchBrowserAgentModeInfo;
        readonly content: string;
      })
    | (WorkbenchObservationBrowserDomSummary & {
        readonly targetMode: WorkbenchBrowserAgentTargetMode;
        readonly browserMode?: WorkbenchBrowserAgentModeInfo;
        readonly content: string;
      })
  >;
  readonly captureAgentPage: (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest
  ) => Promise<WorkbenchVisualCaptureResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  }>;
  readonly showAgentActivity: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly action: "wait";
      readonly durationMs?: number;
    }
  ) => Promise<{
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
    readonly action: "wait";
  }>;
  readonly readAgentFollowAudit: (
    tabId: string,
    request?: {
      readonly sessionId?: string;
      readonly turnId?: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly maxActions?: number;
      readonly includeFrames?: boolean;
    }
  ) => Promise<WorkbenchLumenFollowAudit>;
  readonly finishAgentFollowSessions: (
    request: {
      readonly turnId?: string;
      readonly status: "completed" | "cancelled" | "failed" | "interrupted";
      readonly reason?: string;
    }
  ) => void;
  readonly explainAgentTargetRef: (
    tabId: string,
    request: {
      readonly targetRef: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly maxCandidates?: number;
    }
  ) => Promise<WorkbenchLumenTargetExplanation>;
  readonly auditAgentPageDiagnostics: (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly includeConsole?: boolean;
      readonly includeNetwork?: boolean;
      readonly includeRuntime?: boolean;
      readonly severity?: "info" | "warning" | "error" | readonly ("info" | "warning" | "error")[];
      readonly since?: string | number;
      readonly maxEntries?: number;
      readonly domain?: string;
      readonly path?: string;
      readonly status?: number;
      readonly method?: string;
      readonly includeResponseBody?: boolean;
      readonly responseBodyMaxBytes?: number;
    }
  ) => Promise<WorkbenchBrowserPageDiagnosticsResult>;
  readonly elevateAgentPage: (
    tabId: string,
    request?: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly reason?: string;
    }
  ) => Promise<WorkbenchBrowserAgentElevationResult>;
  readonly completeElevationSession: (
    tabId: string,
    request?: {
      readonly liveTabId?: string;
      readonly elevationSessionId?: string;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentElevationCompletionResult>;
  readonly resolveSharedControlDecision: (
    tabId: string,
    request: {
      readonly decision: "continue_agent" | "user_takeover" | "use_isolated" | "cancel_task";
    }
  ) => Promise<{
    readonly ok: true;
    readonly tabId: string;
    readonly decision: "continue_agent" | "user_takeover" | "use_isolated" | "cancel_task";
  }>;
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
