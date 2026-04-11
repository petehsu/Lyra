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
  readonly operation: "click" | "type" | "focus" | "select" | "submit";
  readonly desiredRoles?: readonly string[] | undefined;
  readonly desiredTags?: readonly string[] | undefined;
  readonly textHints?: readonly string[] | undefined;
  readonly placeholderHints?: readonly string[] | undefined;
  readonly allowContentEditable?: boolean | undefined;
};

export type WorkbenchWebTargetScanScope = "visible" | "nearby" | "expanded";

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
  readonly score: number;
};

export type WorkbenchWebTargetScanRequest = {
  readonly tabId?: string | undefined;
  readonly intent: WorkbenchWebTargetIntent;
  readonly scope?: WorkbenchWebTargetScanScope | undefined;
  readonly maxCandidates?: number | undefined;
  readonly continuationToken?: string | undefined;
};

export type WorkbenchWebTargetScanResult = {
  readonly tabId: string;
  readonly scanSessionId: string;
  readonly scope: WorkbenchWebTargetScanScope;
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
  readonly cssSelector?: string | undefined;
  readonly selectorAddress?: WorkbenchWebSelectorAddress | undefined;
  readonly stableSignature?: WorkbenchWebElementSignature | undefined;
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
  readonly timeoutMs?: number | undefined;
  readonly waitForNavigationMs?: number | undefined;
};

export type WorkbenchWebActionExecution = {
  readonly frameTreeNodeId: number;
  readonly resolvedNodeId?: string | undefined;
  readonly resolvedSelectorAddress?: WorkbenchWebSelectorAddress | undefined;
  readonly method: string;
};

export type WorkbenchWebActionResult = {
  readonly tabId: string;
  readonly graphId?: string | undefined;
  readonly scanSessionId?: string | undefined;
  readonly actionKind: WorkbenchWebAction["kind"];
  readonly ok: boolean;
  readonly overlayShown?: boolean | undefined;
  readonly execution?: WorkbenchWebActionExecution | undefined;
  readonly note?: string | undefined;
  readonly submitted?: boolean | undefined;
  readonly draftOnly?: boolean | undefined;
  readonly submissionMethod?: "click" | "enter" | "none" | undefined;
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

export type WorkbenchWebAutomationError = {
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
