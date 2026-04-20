export type WorkbenchWebGraphEdgeType =
  | "dom_child"
  | "shadow_host"
  | "shadow_child"
  | "frame_embed"
  | "label_for"
  | "aria_controls"
  | "navigation_hint";

export type WorkbenchWebVisibilityState = "visible" | "offscreen" | "hidden";

export type WorkbenchWebElementBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WorkbenchWebSelectorAddress = {
  readonly frameTreeNodeId: number;
  readonly path: string;
};

export type WorkbenchWebElementSignature = {
  readonly tagName: string;
  readonly role?: string | undefined;
  readonly inputType?: string | undefined;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly testId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly textHash?: string | undefined;
  readonly structureHash?: string | undefined;
};

export type WorkbenchWebElementInteractable = {
  readonly clickable: boolean;
  readonly typable: boolean;
  readonly selectable: boolean;
  readonly focusable: boolean;
  readonly scrollable: boolean;
};

export type WorkbenchWebElementNode = {
  readonly nodeId: string;
  readonly frameTreeNodeId: number;
  readonly parentNodeId?: string | undefined;
  readonly tagName: string;
  readonly role?: string | undefined;
  readonly inputType?: string | undefined;
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly stableSignature: WorkbenchWebElementSignature;
  readonly interactable: WorkbenchWebElementInteractable;
  readonly visibilityState: WorkbenchWebVisibilityState;
  readonly bounds: WorkbenchWebElementBounds;
  readonly textSnippet?: string | undefined;
  readonly href?: string | undefined;
  readonly value?: string | undefined;
  readonly checked?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly frameUrl?: string | undefined;
  readonly widgetId?: string | undefined;
  readonly ownerWidgetId?: string | undefined;
  readonly widgetKind?: WorkbenchWebWidgetKind | undefined;
  readonly itemLabel?: string | undefined;
};

export type WorkbenchWebGraphEdge = {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relation: WorkbenchWebGraphEdgeType;
};

export type WorkbenchWebNodeHint = {
  readonly nodeId: string;
  readonly tagName: string;
  readonly role?: string | undefined;
  readonly inputType?: string | undefined;
  readonly textSnippet?: string | undefined;
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly visibilityState: WorkbenchWebVisibilityState;
  readonly interactable: WorkbenchWebElementInteractable;
};

export type WorkbenchWebGraphHighlights = {
  readonly typable: readonly WorkbenchWebNodeHint[];
  readonly clickable: readonly WorkbenchWebNodeHint[];
  readonly focusable: readonly WorkbenchWebNodeHint[];
};

export type WorkbenchWebGraphBuildRequest = {
  readonly tabId?: string | undefined;
  readonly detail?: "summary" | "full" | undefined;
  readonly forceRefresh?: boolean | undefined;
  readonly maxNodes?: number | undefined;
  readonly maxFrames?: number | undefined;
  readonly maxScrollSteps?: number | undefined;
  readonly maxBuildMs?: number | undefined;
};

export type WorkbenchWebGraphBuildBudget = {
  readonly maxNodes: number;
  readonly maxFrames: number;
  readonly maxScrollSteps: number;
  readonly maxBuildMs: number;
};

export type WorkbenchWebGraphBuildResult = {
  readonly tabId: string;
  readonly graphId: string;
  readonly address?: string | undefined;
  readonly builtAt: number;
  readonly budget: WorkbenchWebGraphBuildBudget;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly interactableCount: number;
  readonly truncated: boolean;
  readonly budgetExhausted: boolean;
  readonly detail: "summary" | "full";
  readonly highlights?: WorkbenchWebGraphHighlights | undefined;
  readonly nodes?: readonly WorkbenchWebElementNode[] | undefined;
  readonly edges?: readonly WorkbenchWebGraphEdge[] | undefined;
};

export type WorkbenchWebGraphQueryRequest = {
  readonly tabId?: string | undefined;
  readonly graphId?: string | undefined;
  readonly textContains?: string | undefined;
  readonly tagName?: string | undefined;
  readonly role?: string | undefined;
  readonly onlyInteractable?: boolean | undefined;
  readonly action?:
    | "click"
    | "type"
    | "select"
    | "focus"
    | "scroll"
    | "submit"
    | undefined;
  readonly maxResults?: number | undefined;
};

export type WorkbenchWebGraphQueryResult = {
  readonly tabId: string;
  readonly graphId: string;
  readonly totalMatched: number;
  readonly bestNode?: WorkbenchWebNodeHint | undefined;
  readonly nodes: readonly WorkbenchWebElementNode[];
  readonly edges: readonly WorkbenchWebGraphEdge[];
};

export type WorkbenchWebTargetIntent = {
  readonly operation: "click" | "hover" | "type" | "focus" | "select" | "submit";
  readonly desiredRoles?: readonly string[] | undefined;
  readonly desiredTags?: readonly string[] | undefined;
  readonly textHints?: readonly string[] | undefined;
  readonly placeholderHints?: readonly string[] | undefined;
  readonly allowContentEditable?: boolean | undefined;
};

export type WorkbenchWebTargetScanScope = "visible" | "nearby" | "expanded";

export type WorkbenchWebPageMode =
  | "chat"
  | "form"
  | "search"
  | "login"
  | "navigation"
  | "reader"
  | "settings"
  | "feed"
  | "unknown";

export type WorkbenchWebLayoutNode = {
  readonly nodeId: string;
  readonly frameTreeNodeId: number;
  readonly kind: "interactive" | "container";
  readonly tagName: string;
  readonly role?: string | undefined;
  readonly label?: string | undefined;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly widgetId?: string | undefined;
};

export type WorkbenchWebContainerNode = {
  readonly containerId: string;
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role?: string | undefined;
  readonly label?: string | undefined;
  readonly selectorAddress: WorkbenchWebSelectorAddress;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly memberNodeIds: readonly string[];
  readonly protected?: boolean | undefined;
};

export type WorkbenchWebWidgetKind =
  | "sidebar"
  | "history-list"
  | "history-item"
  | "composer"
  | "chat-composer"
  | "search-bar"
  | "login-form"
  | "toolbar"
  | "toggle-group"
  | "mode-switcher"
  | "pagination"
  | "menu"
  | "menu-trigger"
  | "menu-panel"
  | "dialog"
  | "form"
  | "navigation"
  | "list"
  | "list-item"
  | "card"
  | "panel"
  | "protected"
  | "unknown";

export type WorkbenchWebTargetDiscoveryMode =
  | "static"
  | "hover_revealed"
  | "action_revealed";

export type WorkbenchWebItemIdentity = {
  readonly label?: string | undefined;
  readonly title?: string | undefined;
};

export type WorkbenchWebSurfaceAffordanceHintKind =
  | "reveal"
  | "tooltip"
  | "cursor"
  | "state"
  | "focus";

export type WorkbenchWebSurfaceAffordanceHint = {
  readonly kind: WorkbenchWebSurfaceAffordanceHintKind;
  readonly label: string;
  readonly detail?: string | undefined;
};

export type WorkbenchWebSurfaceRegion = {
  readonly kind: "workflow" | "reveal";
  readonly label: string;
  readonly bounds: WorkbenchWebElementBounds;
};

export type WorkbenchWebFocusDiscoveryMode = "computed" | "probe_verified";

export type WorkbenchWebFocusRegionKind =
  | "navigation"
  | "history"
  | "workflow"
  | "composer"
  | "toolbar"
  | "menu"
  | "panel"
  | "unknown";

export type WorkbenchWebFocusNode = {
  readonly focusNodeId: string;
  readonly candidateId?: string | undefined;
  readonly widgetId?: string | undefined;
  readonly ownerWidgetId?: string | undefined;
  readonly widgetKind?: WorkbenchWebWidgetKind | undefined;
  readonly itemIdentity?: WorkbenchWebItemIdentity | undefined;
  readonly label: string;
  readonly actionLabel?: string | undefined;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly focusOrder: number;
  readonly focusRegionId: string;
  readonly discoveryMode: WorkbenchWebFocusDiscoveryMode;
  readonly confidence: number;
  readonly focusable: boolean;
  readonly clickable: boolean;
  readonly humanOperable: boolean;
  readonly pointerOnly?: boolean | undefined;
};

export type WorkbenchWebFocusRegion = {
  readonly regionId: string;
  readonly kind: WorkbenchWebFocusRegionKind;
  readonly label: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly nodeIds: readonly string[];
  readonly widgetIds: readonly string[];
  readonly primaryControlId?: string | undefined;
  readonly collapsed?: boolean | undefined;
  readonly confidence: number;
};

export type WorkbenchWebFocusAtlas = {
  readonly tabId: string;
  readonly pageMode: WorkbenchWebPageMode;
  readonly version: string;
  readonly builtAt: number;
  readonly activeFocusRegionId?: string | undefined;
  readonly nodes: readonly WorkbenchWebFocusNode[];
  readonly regions: readonly WorkbenchWebFocusRegion[];
  readonly skeleton: readonly string[];
};

export type WorkbenchWebFocusReadRequest = {
  readonly tabId?: string | undefined;
  readonly refresh?: boolean | undefined;
};

export type WorkbenchWebFocusReadResult = {
  readonly tabId: string;
  readonly refreshed: boolean;
  readonly cached: boolean;
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly diagnostics: {
    readonly durationMs: number;
    readonly candidateCount: number;
    readonly widgetCount: number;
  };
};

export type WorkbenchWebInterventionMode = "none" | "watch" | "active";

export type WorkbenchWebInterventionState = {
  readonly mode: WorkbenchWebInterventionMode;
  readonly label: string;
  readonly detail?: string | undefined;
};

export type WorkbenchWebNodeRef = {
  readonly nodeId: string;
  readonly revision: string;
  readonly scanSessionId?: string | undefined;
  readonly stableFingerprint?: WorkbenchWebElementSignature | undefined;
};

export type WorkbenchWebSkeletonRegionKind =
  | "header"
  | "sidebar"
  | "content"
  | "dialog"
  | "form"
  | "table"
  | "menu"
  | "list"
  | "composer"
  | "toolbar"
  | "unknown";

export type WorkbenchWebSkeletonRegion = {
  readonly regionId: string;
  readonly kind: WorkbenchWebSkeletonRegionKind;
  readonly label: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly nodeIds: readonly string[];
  readonly primaryNodeId?: string | undefined;
  readonly widgetIds: readonly string[];
  readonly revision: string;
  readonly confidence?: number | undefined;
};

export type WorkbenchWebSkeletonNodeCapabilities = {
  readonly clickable: boolean;
  readonly editable: boolean;
  readonly selectable: boolean;
  readonly checkable: boolean;
  readonly expandable: boolean;
  readonly uploadable: boolean;
  readonly downloadable: boolean;
  readonly keyboardReachable: boolean;
};

export type WorkbenchWebSkeletonNodeState = {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly readonly: boolean;
  readonly checked?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly invalid?: boolean | undefined;
};

export type WorkbenchWebSkeletonNode = {
  readonly nodeRef: WorkbenchWebNodeRef;
  readonly nodeId: string;
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly text?: string | undefined;
  readonly label?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly tag?: string | undefined;
  readonly selectorPreview: string;
  readonly capabilities: WorkbenchWebSkeletonNodeCapabilities;
  readonly state: WorkbenchWebSkeletonNodeState;
  readonly parentId?: string | undefined;
  readonly childrenIds?: readonly string[] | undefined;
  readonly groupId?: string | undefined;
  readonly regionId?: string | undefined;
  readonly labelFor?: string | undefined;
  readonly describedBy?: readonly string[] | undefined;
  readonly formOwner?: string | undefined;
  readonly stableFingerprint: WorkbenchWebElementSignature;
  readonly revision: string;
  readonly rect: WorkbenchWebElementBounds;
  readonly semanticallyActionable: boolean;
  readonly actuallyVisible: boolean;
  readonly hitTestPassed?: boolean | undefined;
  readonly interactableNow: boolean;
  readonly widgetId?: string | undefined;
  readonly widgetKind?: WorkbenchWebWidgetKind | undefined;
  readonly ownerWidgetId?: string | undefined;
  readonly focusOrder?: number | undefined;
  readonly humanOperableScore?: number | undefined;
  readonly withinCurrentWorkflow?: boolean | undefined;
};

export type WorkbenchWebSkeletonReadRequest = {
  readonly tabId?: string | undefined;
  readonly scope?: WorkbenchWebTargetScanScope | undefined;
  readonly maxNodes?: number | undefined;
  readonly refresh?: boolean | undefined;
};

export type WorkbenchWebSkeletonReadResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly pageMode: WorkbenchWebPageMode;
  readonly skeletonVersion: string;
  readonly activeRegionId?: string | undefined;
  readonly regions: readonly WorkbenchWebSkeletonRegion[];
  readonly nodes: readonly WorkbenchWebSkeletonNode[];
  readonly bestNode?: WorkbenchWebSkeletonNode | undefined;
  readonly intervention: WorkbenchWebInterventionState;
  readonly diagnostics: {
    readonly durationMs: number;
    readonly candidateCount: number;
    readonly regionCount: number;
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly expanded: boolean;
    readonly scrolled: boolean;
  };
};

export type WorkbenchWebQueryStateFilter = {
  readonly checked?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly readonly?: boolean | undefined;
  readonly visible?: boolean | undefined;
};

export type WorkbenchWebQueryRequest = {
  readonly tabId?: string | undefined;
  readonly role?: string | readonly string[] | undefined;
  readonly name?: string | undefined;
  readonly text?: string | undefined;
  readonly state?: WorkbenchWebQueryStateFilter | undefined;
  readonly within?: string | undefined;
  readonly near?: string | undefined;
  readonly regionId?: string | undefined;
  readonly groupId?: string | undefined;
  readonly index?: number | undefined;
  readonly maxResults?: number | undefined;
  readonly inDialog?: boolean | undefined;
  readonly underMenu?: boolean | undefined;
  readonly inTableRow?: boolean | undefined;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
  readonly currentSubgoal?: string | undefined;
  readonly refresh?: boolean | undefined;
};

export type WorkbenchWebQueryResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly pageMode: WorkbenchWebPageMode;
  readonly skeletonVersion: string;
  readonly activeRegionId?: string | undefined;
  readonly matches: readonly WorkbenchWebSkeletonNode[];
  readonly bestMatch?: WorkbenchWebSkeletonNode | undefined;
  readonly ambiguous: boolean;
  readonly querySatisfied: boolean;
  readonly diagnostics: {
    readonly durationMs: number;
    readonly candidateCount: number;
  };
};

export type WorkbenchWebContextReadScope = "node" | "neighborhood" | "region" | "page";

export type WorkbenchWebContextReadRequest = {
  readonly tabId?: string | undefined;
  readonly nodeRef?: WorkbenchWebNodeRef | undefined;
  readonly regionId?: string | undefined;
  readonly scope?: WorkbenchWebContextReadScope | undefined;
  readonly maxNodes?: number | undefined;
  readonly currentSubgoal?: string | undefined;
  readonly refresh?: boolean | undefined;
};

export type WorkbenchWebContextReadResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly pageMode: WorkbenchWebPageMode;
  readonly skeletonVersion: string;
  readonly activeRegionId?: string | undefined;
  readonly scope: WorkbenchWebContextReadScope;
  readonly node?: WorkbenchWebSkeletonNode | undefined;
  readonly region?: WorkbenchWebSkeletonRegion | undefined;
  readonly nodes: readonly WorkbenchWebSkeletonNode[];
  readonly diagnostics: {
    readonly durationMs: number;
    readonly candidateCount: number;
    readonly regionCount: number;
  };
};

export type WorkbenchWebOperabilityReadRequest = {
  readonly tabId?: string | undefined;
  readonly scope?: WorkbenchWebTargetScanScope | undefined;
  readonly maxTargets?: number | undefined;
  readonly refresh?: boolean | undefined;
};

export type WorkbenchWebSurfaceControl = {
  readonly controlId: string;
  readonly widgetId?: string | undefined;
  readonly ownerWidgetId?: string | undefined;
  readonly widgetKind?: WorkbenchWebWidgetKind | undefined;
  readonly itemIdentity?: WorkbenchWebItemIdentity | undefined;
  readonly label: string;
  readonly actionLabel?: string | undefined;
  readonly description?: string | undefined;
  readonly bounds: WorkbenchWebElementBounds;
  readonly hovered?: boolean | undefined;
  readonly active?: boolean | undefined;
  readonly revealed?: boolean | undefined;
  readonly humanOperable: boolean;
  readonly cursorStyle?: string | undefined;
  readonly tooltipText?: string | undefined;
  readonly focusOrder?: number | undefined;
  readonly focusRegionId?: string | undefined;
  readonly atlasConfidence?: number | undefined;
  readonly inActiveFocusRegion?: boolean | undefined;
};

export type WorkbenchWebSurfaceModel = {
  readonly pointerTargetId?: string | undefined;
  readonly hoverTargetId?: string | undefined;
  readonly activeWidgetId?: string | undefined;
  readonly activeItemId?: string | undefined;
  readonly controls: readonly WorkbenchWebSurfaceControl[];
  readonly hints: readonly WorkbenchWebSurfaceAffordanceHint[];
  readonly workflowRegion?: WorkbenchWebSurfaceRegion | undefined;
  readonly revealRegion?: WorkbenchWebSurfaceRegion | undefined;
};

export type WorkbenchWebWidgetDescriptor = {
  readonly widgetId: string;
  readonly kind: WorkbenchWebWidgetKind;
  readonly frameTreeNodeId: number;
  readonly containerId?: string | undefined;
  readonly parentWidgetId?: string | undefined;
  readonly ownerWidgetId?: string | undefined;
  readonly label?: string | undefined;
  readonly description?: string | undefined;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchWebElementBounds;
  readonly memberNodeIds: readonly string[];
  readonly primaryFieldNodeId?: string | undefined;
  readonly primaryActionNodeId?: string | undefined;
  readonly secondaryActionNodeIds?: readonly string[] | undefined;
  readonly requiresHoverReveal?: boolean | undefined;
  readonly opensPanel?: boolean | undefined;
  readonly transientRevealed?: boolean | undefined;
  readonly stateHint?: string | undefined;
  readonly itemIdentity?: WorkbenchWebItemIdentity | undefined;
  readonly protected?: boolean | undefined;
  readonly focusRegionId?: string | undefined;
  readonly atlasConfidence?: number | undefined;
};

export type WorkbenchWebTargetCandidateInteractable = {
  readonly clickable: boolean;
  readonly typable: boolean;
  readonly selectable: boolean;
  readonly focusable: boolean;
};

export type WorkbenchWebTargetCandidate = {
  readonly candidateId: string;
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role?: string | undefined;
  readonly inputType?: string | undefined;
  readonly selectorPreview: string;
  readonly textSnippet?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly visibilityState: "visible" | "nearby" | "offscreen" | "hidden";
  readonly interactable: WorkbenchWebTargetCandidateInteractable;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly affordanceLabel?: string | undefined;
  readonly affordanceAction?: string | undefined;
  readonly cursorStyle?: string | undefined;
  readonly tooltipText?: string | undefined;
  readonly stateHint?: string | undefined;
  readonly isHumanOperable?: boolean | undefined;
  readonly discoveryMode?: WorkbenchWebTargetDiscoveryMode | undefined;
  readonly widgetId?: string | undefined;
  readonly ownerWidgetId?: string | undefined;
  readonly widgetKind?: WorkbenchWebWidgetKind | undefined;
  readonly itemIdentity?: WorkbenchWebItemIdentity | undefined;
  readonly focusOrder?: number | undefined;
  readonly focusRegionId?: string | undefined;
  readonly atlasConfidence?: number | undefined;
  readonly inActiveFocusRegion?: boolean | undefined;
  readonly score: number;
  readonly humanOperableScore?: number | undefined;
  readonly keyboardReachable?: boolean | undefined;
  readonly withinCurrentWorkflow?: boolean | undefined;
};

export type WorkbenchWebTargetScanRequest = {
  readonly tabId?: string | undefined;
  readonly intent: WorkbenchWebTargetIntent;
  readonly readOnly?: boolean | undefined;
  readonly widgetId?: string | undefined;
  readonly regionId?: string | undefined;
  readonly currentSubgoal?: string | undefined;
  readonly scope?: WorkbenchWebTargetScanScope | undefined;
  readonly maxCandidates?: number | undefined;
  readonly continuationToken?: string | undefined;
};

export type WorkbenchWebTargetScanResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly pageMode: WorkbenchWebPageMode;
  readonly focusAtlasReady?: boolean | undefined;
  readonly focusAtlasVersion?: string | undefined;
  readonly activeFocusRegionId?: string | undefined;
  readonly surface?: WorkbenchWebSurfaceModel | undefined;
  readonly widgets?: readonly WorkbenchWebWidgetDescriptor[] | undefined;
  readonly bestCandidate?: WorkbenchWebTargetCandidate | undefined;
  readonly candidates: readonly WorkbenchWebTargetCandidate[];
  readonly truncated: boolean;
  readonly continuationToken?: string | undefined;
  readonly diagnostics: {
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly expanded: boolean;
    readonly scrolled: boolean;
    readonly durationMs: number;
  };
};

export type WorkbenchWebOperabilityReadResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly pageMode: WorkbenchWebPageMode;
  readonly focusAtlasReady: true;
  readonly focusAtlasVersion: string;
  readonly activeFocusRegionId?: string | undefined;
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly regions: readonly WorkbenchWebFocusRegion[];
  readonly surface?: WorkbenchWebSurfaceModel | undefined;
  readonly widgets: readonly WorkbenchWebWidgetDescriptor[];
  readonly bestCandidate?: WorkbenchWebTargetCandidate | undefined;
  readonly primaryTarget?: WorkbenchWebTargetCandidate | undefined;
  readonly topTargets: readonly WorkbenchWebTargetCandidate[];
  readonly candidates: readonly WorkbenchWebTargetCandidate[];
  readonly truncated: boolean;
  readonly continuationToken?: string | undefined;
  readonly intervention: WorkbenchWebInterventionState;
  readonly diagnostics: {
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly expanded: boolean;
    readonly scrolled: boolean;
    readonly durationMs: number;
  };
};

export type WorkbenchWebFocusProbeRequest = {
  readonly tabId?: string | undefined;
  readonly widgetId?: string | undefined;
  readonly focusRegionId?: string | undefined;
  readonly target?: WorkbenchWebActionTarget | undefined;
  readonly refresh?: boolean | undefined;
};

export type WorkbenchWebWidgetScanRequest = {
  readonly tabId?: string | undefined;
  readonly scope?: WorkbenchWebTargetScanScope | undefined;
  readonly maxWidgets?: number | undefined;
};

export type WorkbenchWebWidgetScanResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly pageMode: WorkbenchWebPageMode;
  readonly focusAtlasReady?: boolean | undefined;
  readonly focusAtlasVersion?: string | undefined;
  readonly activeFocusRegionId?: string | undefined;
  readonly surface?: WorkbenchWebSurfaceModel | undefined;
  readonly widgets: readonly WorkbenchWebWidgetDescriptor[];
  readonly layoutNodes: readonly WorkbenchWebLayoutNode[];
  readonly containerNodes: readonly WorkbenchWebContainerNode[];
  readonly truncated: boolean;
  readonly diagnostics: {
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly expanded: boolean;
    readonly scrolled: boolean;
    readonly durationMs: number;
  };
};

export type WorkbenchWebSafeActionKind =
  | "focus"
  | "hover"
  | "scroll_into_view"
  | "expand_probe";

export type WorkbenchWebMutateActionKind =
  | "click"
  | "type"
  | "clear_and_type"
  | "select_option"
  | "set_checked"
  | "submit_form"
  | "press_key";

export type WorkbenchWebNavigateActionKind =
  | "goto_url"
  | "open_link_node"
  | "history_back"
  | "history_forward"
  | "reload";

export type WorkbenchWebActionTarget = {
  readonly candidateId?: string | undefined;
  readonly scanSessionId?: string | undefined;
  readonly nodeId?: string | undefined;
  readonly index?: number | undefined;
  readonly nodeRef?: WorkbenchWebNodeRef | undefined;
  readonly cssSelector?: string | undefined;
  readonly selectorAddress?: WorkbenchWebSelectorAddress | undefined;
  readonly stableSignature?: WorkbenchWebElementSignature | undefined;
  readonly tagName?: string | undefined;
  readonly role?: string | undefined;
  readonly inputType?: string | undefined;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly testId?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly text?: string | undefined;
  readonly textContains?: string | undefined;
  readonly textSnippet?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly label?: string | undefined;
};

export type WorkbenchWebAction =
  | {
      readonly kind: WorkbenchWebSafeActionKind;
      readonly target: WorkbenchWebActionTarget;
    }
  | {
      readonly kind: "click";
      readonly target: WorkbenchWebActionTarget;
    }
  | {
      readonly kind: "type" | "clear_and_type";
      readonly target: WorkbenchWebActionTarget;
      readonly text: string;
      readonly submit?: boolean | undefined;
    }
  | {
      readonly kind: "select_option";
      readonly target: WorkbenchWebActionTarget;
      readonly value?: string | undefined;
      readonly text?: string | undefined;
      readonly index?: number | undefined;
    }
  | {
      readonly kind: "set_checked";
      readonly target: WorkbenchWebActionTarget;
      readonly checked: boolean;
    }
  | {
      readonly kind: "submit_form";
      readonly target: WorkbenchWebActionTarget;
    }
  | {
      readonly kind: "press_key";
      readonly target: WorkbenchWebActionTarget;
      readonly key: string;
      readonly code?: string | undefined;
      readonly ctrl?: boolean | undefined;
      readonly shift?: boolean | undefined;
      readonly alt?: boolean | undefined;
      readonly meta?: boolean | undefined;
    }
  | {
      readonly kind: "goto_url";
      readonly address: string;
      readonly target?: "active-tab" | "new-tab" | undefined;
    }
  | {
      readonly kind: "open_link_node";
      readonly target: WorkbenchWebActionTarget;
    }
  | {
      readonly kind: "history_back" | "history_forward" | "reload";
    };

export type WorkbenchWebActionRequest = {
  readonly tabId?: string | undefined;
  readonly graphId?: string | undefined;
  readonly action: WorkbenchWebAction;
  readonly constraints?: WorkbenchWebActionExecutionConstraints | undefined;
  readonly timeoutMs?: number | undefined;
  readonly waitForNavigationMs?: number | undefined;
};

export type WorkbenchWebActionExecution = {
  readonly frameTreeNodeId: number;
  readonly resolvedNodeId?: string | undefined;
  readonly resolvedSelectorAddress?: WorkbenchWebSelectorAddress | undefined;
  readonly method: string;
};

export type WorkbenchWebVerificationStateTransition =
  | "value_changed"
  | "menu_opened"
  | "region_expanded"
  | "state_changed"
  | "validation_changed"
  | "navigation_changed"
  | "model_changed"
  | "conversation_deleted"
  | "message_submitted"
  | "response_started"
  | "focus_changed"
  | "none";

export type WorkbenchWebActionResult = {
  readonly tabId: string;
  readonly graphId?: string | undefined;
  readonly scanSessionId?: string | undefined;
  readonly focusAtlasVersion?: string | undefined;
  readonly activeFocusRegionId?: string | undefined;
  readonly focusProbeVerified?: boolean | undefined;
  readonly focusDeltaObserved?: boolean | undefined;
  readonly actionKind: WorkbenchWebAction["kind"];
  readonly ok: boolean;
  readonly overlayShown?: boolean | undefined;
  readonly execution?: WorkbenchWebActionExecution | undefined;
  readonly note?: string | undefined;
  readonly submitted?: boolean | undefined;
  readonly draftOnly?: boolean | undefined;
  readonly submissionMethod?: "click" | "enter" | "none" | undefined;
  readonly verified?: boolean | undefined;
  readonly verification?: {
    readonly pageMode?: WorkbenchWebPageMode | undefined;
    readonly widgetId?: string | undefined;
    readonly widgetKind?: WorkbenchWebWidgetKind | undefined;
    readonly stateTransition?: WorkbenchWebVerificationStateTransition | undefined;
    readonly reason?: string | undefined;
    readonly cursorStyle?: string | undefined;
    readonly tooltipText?: string | undefined;
    readonly affordanceHints?: readonly WorkbenchWebSurfaceAffordanceHint[] | undefined;
  } | undefined;
};

export type WorkbenchWebScanAndActTargetHints = {
  readonly role?: string | readonly string[] | undefined;
  readonly name?: string | undefined;
  readonly text?: string | undefined;
  readonly textContains?: string | undefined;
  readonly textSnippet?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly label?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly within?: string | undefined;
  readonly near?: string | undefined;
  readonly regionId?: string | undefined;
  readonly groupId?: string | undefined;
  readonly index?: number | undefined;
  readonly state?: WorkbenchWebQueryStateFilter | undefined;
};

export type WorkbenchWebScanAndActGoal = {
  readonly expectedTransitions?: readonly WorkbenchWebVerificationStateTransition[] | undefined;
  readonly mustAdvance?: boolean | undefined;
};

export type WorkbenchWebScanAndActRequest = {
  readonly tabId?: string | undefined;
  readonly graphId?: string | undefined;
  readonly action: WorkbenchWebAction;
  readonly constraints?: WorkbenchWebActionExecutionConstraints | undefined;
  readonly timeoutMs?: number | undefined;
  readonly waitForNavigationMs?: number | undefined;
  readonly targetHints?: WorkbenchWebScanAndActTargetHints | undefined;
  readonly scope?: WorkbenchWebTargetScanScope | undefined;
  readonly maxCandidates?: number | undefined;
  readonly maxLatencyMs?: number | undefined;
  readonly followThroughSteps?: 0 | 1 | 2 | undefined;
  readonly goal?: WorkbenchWebScanAndActGoal | undefined;
};

export type WorkbenchWebScanAndActResult = {
  readonly tabId: string;
  readonly ok: boolean;
  readonly verified: boolean;
  readonly goalSatisfied: boolean;
  readonly actionResult: WorkbenchWebActionResult;
  readonly selectedCandidate?: WorkbenchWebTargetCandidate | undefined;
  readonly scanSessionId?: string | undefined;
  readonly cacheHit: boolean;
  readonly continuationApplied: boolean;
  readonly diagnostics: {
    readonly durationMs: number;
    readonly scanCount: number;
    readonly gateRetryCount: number;
    readonly actionAttempts: number;
    readonly maxLatencyMs: number;
    readonly scope: WorkbenchWebTargetScanScope;
    readonly maxCandidates: number;
    readonly goalGateSoftFailed: boolean;
    readonly scanSkipped: boolean;
  };
};

export type WorkbenchWebFocusProbeResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly pageMode: WorkbenchWebPageMode;
  readonly focusAtlasReady: true;
  readonly focusAtlasVersion: string;
  readonly activeFocusRegionId?: string | undefined;
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly probedTarget: WorkbenchWebTargetCandidate;
  readonly focusProbeVerified: boolean;
  readonly focusDeltaObserved: boolean;
  readonly intervention: WorkbenchWebInterventionState;
  readonly action: WorkbenchWebActionResult;
  readonly diagnostics: {
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly durationMs: number;
    readonly refreshed: boolean;
    readonly strategy: "best_candidate" | "focus_region" | "widget" | "target";
  };
};

export type WorkbenchWebWaitRequest = {
  readonly tabId?: string | undefined;
  readonly graphId?: string | undefined;
  readonly target: WorkbenchWebActionTarget;
  readonly state?: "present" | "visible" | "hidden" | undefined;
  readonly timeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
};

export type WorkbenchWebWaitResult = {
  readonly tabId: string;
  readonly graphId?: string | undefined;
  readonly scanSessionId?: string | undefined;
  readonly state: "present" | "visible" | "hidden";
  readonly satisfied: boolean;
  readonly elapsedMs: number;
  readonly overlayShown?: boolean | undefined;
  readonly execution?: WorkbenchWebActionExecution | undefined;
};

export type WorkbenchWebAutomationErrorCode =
  | "active_visible_page_required"
  | "tab_not_found"
  | "frame_not_found"
  | "node_not_found"
  | "widget_not_found"
  | "scan_session_not_found"
  | "candidate_not_found"
  | "candidate_stale"
  | "stale_node"
  | "not_interactable"
  | "pointer_intercepted"
  | "element_not_stable"
  | "cross_origin_frame_blocked"
  | "action_blocked_by_policy"
  | "postcondition_timeout"
  | "wrong_widget_target"
  | "no_state_transition"
  | "action_unverified"
  | "hover_reveal_required"
  | "reveal_not_observed"
  | "menu_not_opened"
  | "list_item_not_changed"
  | "mode_not_switched"
  | "workflow_not_advanced"
  | "goal_gate_soft_failed"
  | "page_mode_unknown"
  | "protected_verification_widget"
  | "overlay_unavailable"
  | "no_interactable_candidates"
  | "selector_budget_exhausted"
  | "script_execution_failed"
  | "budget_exhausted"
  | "invalid_request";

export type WorkbenchWebAutomationErrorStage =
  | "scan"
  | "resolve_node"
  | "precondition"
  | "execute"
  | "wait_postcondition";

export type WorkbenchWebAutomationErrorCategory =
  | "scan"
  | "target_resolution"
  | "precondition"
  | "execution"
  | "postcondition"
  | "policy"
  | "unknown";

export type WorkbenchWebActionExecutionConstraints = {
  readonly timeoutMs?: number | undefined;
  readonly waitForNavigationMs?: number | undefined;
  readonly strictness?: "strict" | "balanced" | "best_effort" | undefined;
  readonly retry?: {
    readonly maxAttempts?: number | undefined;
    readonly backoffMs?: number | undefined;
  } | undefined;
};

export type WorkbenchWebAutomationError = {
  readonly category: WorkbenchWebAutomationErrorCategory;
  readonly code: WorkbenchWebAutomationErrorCode;
  readonly message: string;
  readonly stage: WorkbenchWebAutomationErrorStage;
  readonly retryable: boolean;
  readonly diagnostics?: {
    readonly selectorAttempts?: readonly string[] | undefined;
    readonly candidateCount?: number | undefined;
    readonly frameTreeNodeId?: number | undefined;
    readonly timeoutMs?: number | undefined;
    readonly details?: Record<string, unknown> | undefined;
  };
};
